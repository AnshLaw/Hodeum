use serde::Serialize;
use tauri::State;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindow, GetWindowLongPtrW, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::perception::foreground::{exe_stem, window_pid, window_title};
use crate::perception::{capture_frame, CapturedFrame, Perception};

/// Windows smaller than this (physical px) are tooltips and helpers, not apps.
const MIN_WINDOW_SIDE: u32 = 120;

/// An app window the learner can attach to a chat. Mirrors `WindowInfo` in `src/app/services.ts`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub app: String,
}

/// Whether a window is worth offering: someone else's, titled, on screen, and app-sized.
pub fn is_candidate(pid: u32, ours: u32, title: &str, minimized: bool, size: (u32, u32)) -> bool {
    pid != ours && !title.trim().is_empty() && !minimized && size.0 >= MIN_WINDOW_SIDE && size.1 >= MIN_WINDOW_SIDE
}

/// The Alt+Tab rule: overlays, tool palettes and owned popups aren't apps the learner switches to.
pub fn alt_tab_eligible(visible: bool, cloaked: bool, ex_style: u32, owned: bool) -> bool {
    let tool = ex_style & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) != 0;
    let app_window = ex_style & WS_EX_APPWINDOW.0 != 0;
    visible && !cloaked && !tool && (!owned || app_window)
}

pub fn is_switchable(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: all calls tolerate stale handles; `cloaked` is a u32 out-parameter of the size passed.
    unsafe {
        let visible = IsWindowVisible(hwnd).as_bool();
        let cloak_read = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), std::mem::size_of::<u32>() as u32);
        if let Err(error) = cloak_read {
            eprintln!("couldn't read whether a window is cloaked: {error}");
        }
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid());
        alt_tab_eligible(visible, cloaked != 0, ex_style, owned)
    }
}

fn candidate(window: &xcap::Window, ours: u32) -> Result<Option<WindowInfo>, xcap::XCapError> {
    let title = window.title()?;
    let size = (window.width()?, window.height()?);
    let hwnd = window.id()? as isize;
    if !is_candidate(window.pid()?, ours, &title, window.is_minimized()?, size) || !is_switchable(HWND(hwnd as *mut _)) {
        return Ok(None);
    }
    Ok(Some(info_for(hwnd)))
}

fn info_for(hwnd: isize) -> WindowInfo {
    let handle = HWND(hwnd as *mut _);
    let app = exe_stem(handle).unwrap_or_else(|error| {
        eprintln!("couldn't read the app's process name: {error}");
        String::new()
    });
    WindowInfo { id: hwnd.to_string(), title: window_title(handle), app }
}

fn parse_id(id: &str) -> Result<isize, String> {
    id.parse::<isize>().map_err(|_| format!("`{id}` isn't a window id"))
}

/// Open app windows, front to back.
#[tauri::command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ours = std::process::id();
        let mut found = Vec::new();
        for window in xcap::Window::all().map_err(|e| e.to_string())? {
            match candidate(&window, ours) {
                Ok(Some(info)) => found.push(info),
                Ok(None) => {}
                // Windows can close mid-scan; skip that one and keep the rest.
                Err(error) => eprintln!("skipping a window that couldn't be read: {error}"),
            }
        }
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The app the learner was in before opening Hodeum, if any.
#[tauri::command]
pub fn last_app_window(state: State<'_, Perception>) -> Option<WindowInfo> {
    state.learner_window().ok().map(info_for)
}

/// A capture of one chosen window for the local model. Hodeum's own windows are refused.
#[tauri::command]
pub async fn capture_window(id: String) -> Result<CapturedFrame, String> {
    let hwnd = parse_id(&id)?;
    if window_pid(HWND(hwnd as *mut _)) == std::process::id() {
        return Err("Hodey can't look at its own windows.".into());
    }
    tauri::async_runtime::spawn_blocking(move || capture_frame(hwnd)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_only_other_apps_titled_visible_windows() {
        assert!(is_candidate(10, 1, "Sales.xlsx - Excel", false, (1200, 800)));
        assert!(!is_candidate(1, 1, "Hodeum", false, (1200, 800)));
        assert!(!is_candidate(10, 1, "  ", false, (1200, 800)));
        assert!(!is_candidate(10, 1, "Excel", true, (1200, 800)));
        assert!(!is_candidate(10, 1, "Tooltip", false, (80, 30)));
    }

    #[test]
    fn follows_the_alt_tab_rule() {
        assert!(alt_tab_eligible(true, false, 0, false));
        assert!(!alt_tab_eligible(true, true, 0, false));
        assert!(!alt_tab_eligible(true, false, WS_EX_TOOLWINDOW.0, false));
        assert!(!alt_tab_eligible(true, false, WS_EX_NOACTIVATE.0, false));
        assert!(!alt_tab_eligible(true, false, 0, true));
        assert!(alt_tab_eligible(true, false, WS_EX_APPWINDOW.0, true));
        assert!(!alt_tab_eligible(false, false, 0, false));
    }

    #[test]
    fn rejects_ids_that_are_not_numbers() {
        assert!(parse_id("12345").is_ok());
        assert!(parse_id("abc").is_err());
    }
}
