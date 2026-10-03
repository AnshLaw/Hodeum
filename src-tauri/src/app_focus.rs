//! Starting a Hode brings the pack's app forward, so Hodey reads Excel and not whatever had focus.

use tauri::State;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

use crate::chat_context::{app_windows, WindowInfo};
use crate::perception::foreground::{exe_stem, window_title};
use crate::perception::model::app_name;
use crate::perception::Perception;
use crate::surfaces::FocusReturn;

/// Whether a window's process maps to the app a task pack names (e.g. EXCEL -> "Excel").
pub fn is_app(exe: &str, app: &str) -> bool {
    !exe.is_empty() && app_name(exe).eq_ignore_ascii_case(app)
}

/// The frontmost open window of `app`.
fn find_app(app: &str) -> Result<Option<HWND>, String> {
    Ok(app_windows()?.into_iter().find(|&h| exe_stem(h).is_ok_and(|exe| is_app(&exe, app))))
}

/// Raises `hwnd`. Allowed because the learner just clicked Hodey; if Windows still refuses, borrow
/// the foreground thread's input state for the switch.
fn bring_forward(hwnd: HWND) -> Result<(), String> {
    // SAFETY: all calls tolerate stale handles; thread input is detached on every path.
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(hwnd).as_bool() {
            return Ok(());
        }
        let foreground_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let ours = GetCurrentThreadId();
        let attached = AttachThreadInput(ours, foreground_thread, true).as_bool();
        BringWindowToTop(hwnd).map_err(|e| e.to_string())?;
        let switched = SetForegroundWindow(hwnd).as_bool();
        if attached {
            let _ = AttachThreadInput(ours, foreground_thread, false);
        }
        if switched { Ok(()) } else { Err("Windows wouldn't switch to the app".into()) }
    }
}

/// Brings the app forward and makes it the window Hodey reads. `None` when it isn't open.
#[tauri::command]
pub fn focus_app(app: String, perception: State<'_, Perception>, focus: State<'_, FocusReturn>) -> Result<Option<WindowInfo>, String> {
    let Some(hwnd) = find_app(&app)? else { return Ok(None) };
    let id = hwnd.0 as isize;
    perception.remember(id);
    focus.redirect(id)?;
    if let Err(reason) = bring_forward(hwnd) {
        // Still usable: Hodey reads this window, and asks the learner to click into it if needed.
        eprintln!("couldn't bring {app} forward: {reason}");
    }
    Ok(Some(WindowInfo { id: id.to_string(), title: window_title(hwnd), app }))
}

#[cfg(test)]
mod tests {
    use super::is_app;

    #[test]
    fn matches_packs_to_processes() {
        assert!(is_app("EXCEL", "Excel"));
        assert!(is_app("explorer", "File Explorer"));
        assert!(!is_app("Code", "Excel"));
        assert!(!is_app("", "Excel"));
        assert!(is_app("msedge", "Edge"));
        assert!(is_app("chrome", "Chrome"));
    }
}
