use std::path::Path;
use std::sync::atomic::{AtomicIsize, Ordering};

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    IsWindow, GA_ROOT,
};

use crate::dock::geometry::PxRect;

const NO_TARGET: &str = "Click into the app you want to learn, then try again.";
const TEXT_BUFFER: usize = 512;
/// Desktop, taskbar and transient shell surfaces are never the app being learned. Measured on Windows 11
/// 25H2: Task View and Alt+Tab are XamlExplorerHostIslandWindow (briefly ForegroundStaging first), Win+T
/// thumbnails are XamlExplorerHostIslandWindow, the tray overflow is TopLevelWindowForOverflowXamlIsland.
/// The rest are older or unmeasured names for the same surfaces.
const SHELL_CLASSES: [&str; 11] = [
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Progman",
    "WorkerW",
    "XamlExplorerHostIslandWindow",
    "ForegroundStaging",
    "MultitaskingViewFrame",
    "TopLevelWindowForOverflowXamlIsland",
    "NotifyIconOverflowWindow",
    "TaskListThumbnailWnd",
    "ControlCenterWindow",
];
/// Processes whose windows are shell flyouts: Start and Search (measured: Win opens SearchHost's
/// CoreWindow "Search"), the notification centre (measured: ShellExperienceHost), quick settings.
const SHELL_PROCESSES: [&str; 5] = ["startmenuexperiencehost", "searchhost", "searchapp", "shellexperiencehost", "shellhost"];
/// The class of a Store app's content window, inside its ApplicationFrameWindow (or on its own while suspended).
pub const CORE_WINDOW_CLASS: &str = "Windows.UI.Core.CoreWindow";
/// The frame ApplicationFrameHost draws around Store apps (Settings, Calculator).
pub const FRAME_CLASS: &str = "ApplicationFrameWindow";

pub fn is_shell_class(class: &str) -> bool {
    SHELL_CLASSES.contains(&class)
}

/// A shell surface the learner passes through (Start, Search, Alt+Tab, the taskbar), never their app.
/// `exe` is the process's executable stem, any case.
pub fn is_transient_shell(class: &str, exe: &str) -> bool {
    let exe = exe.to_ascii_lowercase();
    is_shell_class(class) || SHELL_PROCESSES.contains(&exe.as_str())
}

/// Whether the window is a shell surface; reads its process only when the class alone can't tell.
pub fn is_shell_window(hwnd: HWND) -> bool {
    let class = class_name(hwnd);
    if is_shell_class(&class) {
        return true;
    }
    match exe_stem(hwnd) {
        Ok(exe) => is_transient_shell(&class, &exe),
        Err(error) => {
            // Elevated apps can refuse the query; they're still apps, not shell.
            eprintln!("couldn't read a window's process to check for the shell: {error}");
            false
        }
    }
}

pub fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: GetWindowThreadProcessId only writes the pid out-parameter.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

pub fn root_window(hwnd: HWND) -> HWND {
    // SAFETY: GetAncestor tolerates any handle and returns null for invalid ones.
    unsafe { GetAncestor(hwnd, GA_ROOT) }
}

pub fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; TEXT_BUFFER];
    // SAFETY: the buffer outlives the call and its length is passed implicitly by the slice.
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..len.max(0) as usize])
}

pub fn window_title(hwnd: HWND) -> String {
    let mut buffer = [0u16; TEXT_BUFFER];
    // SAFETY: as above.
    let len = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..len.max(0) as usize])
}

/// Executable stem of the process owning `hwnd` ("EXCEL"), or an error if it can't be opened.
pub fn exe_stem(hwnd: HWND) -> Result<String, String> {
    let path = exe_path(window_pid(hwnd))?;
    Ok(Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(path))
}

/// Full path of process `pid`'s executable, or an error if it can't be opened (elevated or exited).
pub fn exe_path(pid: u32) -> Result<String, String> {
    // SAFETY: the handle is closed below on every path.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.map_err(|e| e.to_string())?;
    let mut buffer = [0u16; TEXT_BUFFER];
    let mut len = buffer.len() as u32;
    // SAFETY: buffer and len describe a valid writable region.
    let result = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len) };
    // SAFETY: `process` came from OpenProcess above.
    unsafe { CloseHandle(process) }.map_err(|e| e.to_string())?;
    result.map_err(|e| e.to_string())?;
    Ok(String::from_utf16_lossy(&buffer[..len as usize]))
}

unsafe extern "system" fn collect_core_window(hwnd: HWND, found: LPARAM) -> BOOL {
    // SAFETY: `found` is the &mut HWND passed to EnumChildWindows below, alive for the whole enumeration.
    let found = unsafe { &mut *(found.0 as *mut HWND) };
    if class_name(hwnd) == CORE_WINDOW_CLASS {
        *found = hwnd;
        return BOOL(0);
    }
    BOOL(1)
}

/// The content window of a Store app's frame: the CoreWindow child, owned by the app's own process.
/// None while the app is suspended or minimized (its CoreWindow is then a separate top-level window).
pub fn core_window_child(frame: HWND) -> Option<HWND> {
    let mut found = HWND::default();
    // SAFETY: the callback only writes `found`, which outlives the call. The result only says whether
    // the walk stopped early, which `found` already tells.
    let _ = unsafe { EnumChildWindows(Some(frame), Some(collect_core_window), LPARAM(&mut found as *mut HWND as isize)) };
    (!found.is_invalid()).then_some(found)
}

/// Physical bounds of the monitor showing most of `hwnd`.
pub fn monitor_rect(hwnd: HWND) -> Option<PxRect> {
    // SAFETY: MonitorFromWindow tolerates any handle; MONITORINFO is correctly sized before the call.
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let r = info.rcMonitor;
        Some(PxRect { x: r.left, y: r.top, width: (r.right - r.left).max(0) as u32, height: (r.bottom - r.top).max(0) as u32 })
    }
}

/// The app the learner is working in: the foreground window, unless that's Hodeum itself or the
/// shell (taskbar, Start, Alt+Tab), in which case the last external window we saw.
pub fn target_window(last_external: &AtomicIsize) -> Result<HWND, String> {
    // SAFETY: GetForegroundWindow has no preconditions.
    let foreground = root_window(unsafe { GetForegroundWindow() });
    let ours = window_pid(foreground) == std::process::id();
    if !foreground.is_invalid() && !ours && !is_shell_window(foreground) {
        last_external.store(foreground.0 as isize, Ordering::SeqCst);
        return Ok(foreground);
    }
    let last = HWND(last_external.load(Ordering::SeqCst) as *mut _);
    // SAFETY: IsWindow accepts stale handles and reports whether they are still alive.
    if last.is_invalid() || !unsafe { IsWindow(Some(last)) }.as_bool() {
        return Err(NO_TARGET.into());
    }
    Ok(last)
}

#[cfg(test)]
mod tests {
    use super::{is_shell_class, is_transient_shell};

    #[test]
    fn treats_taskbar_and_desktop_as_shell() {
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(is_shell_class("WorkerW"));
        assert!(!is_shell_class("XLMAIN"));
    }

    #[test]
    fn treats_start_search_and_switchers_as_transient_shell() {
        // As measured with Win, Win+S, Win+Tab, Alt+Tab, Win+N, Win+T and the tray overflow.
        assert!(is_transient_shell("Windows.UI.Core.CoreWindow", "SearchHost"));
        assert!(is_transient_shell("Windows.UI.Core.CoreWindow", "StartMenuExperienceHost"));
        assert!(is_transient_shell("Windows.UI.Core.CoreWindow", "ShellExperienceHost"));
        assert!(is_transient_shell("XamlExplorerHostIslandWindow", "explorer"));
        assert!(is_transient_shell("ForegroundStaging", "explorer"));
        assert!(is_transient_shell("TopLevelWindowForOverflowXamlIsland", "explorer"));
        assert!(is_transient_shell("Shell_TrayWnd", "explorer"));
    }

    #[test]
    fn keeps_real_apps_including_store_apps_and_file_explorer() {
        assert!(!is_transient_shell("CabinetWClass", "explorer"));
        assert!(!is_transient_shell("ApplicationFrameWindow", "ApplicationFrameHost"));
        assert!(!is_transient_shell("Windows.UI.Core.CoreWindow", "CalculatorApp"));
        assert!(!is_transient_shell("XLMAIN", "EXCEL"));
        assert!(!is_transient_shell("Chrome_WidgetWin_1", "brave"));
    }
}
