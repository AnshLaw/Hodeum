//! Starting a Hode brings the pack's app forward, so Hodey reads Excel and not whatever had focus.

use tauri::State;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

use crate::apps::identity::{identify_window, AppIdentity};
use crate::chat_context::{app_windows, WindowInfo};
use crate::perception::foreground::window_title;
use crate::perception::Perception;
use crate::surfaces::FocusReturn;

/// Whether a window's app is the one asked for, by stable id ("settings") or friendly name ("Settings").
pub fn matches_app(identity: &AppIdentity, app: &str) -> bool {
    let app = app.trim();
    let same = |field: &str| !field.is_empty() && field.eq_ignore_ascii_case(app);
    !app.is_empty() && (same(&identity.id) || same(&identity.name))
}

/// The frontmost open window whose app passes `wanted`. Store apps are found by their frame, which is
/// the window to bring forward.
pub(crate) fn find_window(wanted: impl Fn(HWND, &AppIdentity) -> bool) -> Result<Option<(HWND, AppIdentity)>, String> {
    Ok(app_windows()?.into_iter().map(|h| (h, identify_window(h))).find(|(h, identity)| wanted(*h, identity)))
}

/// The frontmost open window of `app` (an app id or name).
pub(crate) fn find_app(app: &str) -> Result<Option<(HWND, AppIdentity)>, String> {
    find_window(|_, identity| matches_app(identity, app))
}

/// The frontmost window of `app` whose title mentions `hint` (the file it has open), ignoring case.
pub(crate) fn find_app_titled(app: &str, hint: &str) -> Result<Option<(HWND, AppIdentity)>, String> {
    let hint = hint.to_lowercase();
    find_window(|h, identity| matches_app(identity, app) && window_title(h).to_lowercase().contains(&hint))
}

/// Raises `hwnd`. Allowed because the learner just clicked Hodey; if Windows still refuses, borrow
/// the foreground thread's input state for the switch.
pub(crate) fn bring_forward(hwnd: HWND) -> Result<(), String> {
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

/// Makes `hwnd` the window Hodey reads, sends focus back to it after the notch, and raises it.
pub(crate) fn adopt(hwnd: HWND, identity: &AppIdentity, fallback_name: &str, perception: &Perception, focus: &FocusReturn) -> Result<WindowInfo, String> {
    let id = hwnd.0 as isize;
    perception.remember(id);
    focus.redirect(id)?;
    let app = if identity.name.is_empty() { fallback_name.to_string() } else { identity.name.clone() };
    if let Err(reason) = bring_forward(hwnd) {
        // Still usable: Hodey reads this window, and asks the learner to click into it if needed.
        eprintln!("couldn't bring {app} forward: {reason}");
    }
    Ok(WindowInfo { id: id.to_string(), title: window_title(hwnd), app })
}

/// Brings the app (an app id or name) forward and makes it the window Hodey reads. `None` when it isn't open.
#[tauri::command]
pub fn focus_app(app: String, perception: State<'_, Perception>, focus: State<'_, FocusReturn>) -> Result<Option<WindowInfo>, String> {
    let Some((hwnd, identity)) = find_app(&app)? else { return Ok(None) };
    adopt(hwnd, &identity, &app, &perception, &focus).map(Some)
}

#[cfg(test)]
mod tests {
    use super::matches_app;
    use crate::apps::identity::AppIdentity;

    fn app(id: &str, name: &str) -> AppIdentity {
        AppIdentity { id: id.into(), name: name.into(), exe: String::new() }
    }

    #[test]
    fn matches_apps_by_id_or_name_ignoring_case() {
        assert!(matches_app(&app("excel", "Excel"), "Excel"));
        assert!(matches_app(&app("file-explorer", "File Explorer"), "file-explorer"));
        assert!(matches_app(&app("settings", "Settings"), "settings"));
        assert!(matches_app(&app("whatsapp", "WhatsApp"), "WhatsApp"));
        assert!(!matches_app(&app("code", "VS Code"), "Excel"));
    }

    #[test]
    fn never_matches_unknown_apps_or_empty_requests() {
        assert!(!matches_app(&app("", ""), ""));
        assert!(!matches_app(&app("", ""), "Settings"));
        assert!(!matches_app(&app("excel", "Excel"), "  "));
    }
}
