use std::path::Path;
use std::sync::atomic::{AtomicIsize, Ordering};

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    IsWindow, GA_ROOT,
};

use crate::dock::geometry::PxRect;

const NO_TARGET: &str = "Click into the app you want to learn, then try again.";
const TEXT_BUFFER: usize = 512;
/// Desktop and taskbar surfaces are never the app being learned.
const SHELL_CLASSES: [&str; 4] = ["Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW"];

pub fn is_shell_class(class: &str) -> bool {
    SHELL_CLASSES.contains(&class)
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

fn class_name(hwnd: HWND) -> String {
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
    let pid = window_pid(hwnd);
    // SAFETY: the handle is closed below on every path.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.map_err(|e| e.to_string())?;
    let mut buffer = [0u16; TEXT_BUFFER];
    let mut len = buffer.len() as u32;
    // SAFETY: buffer and len describe a valid writable region.
    let result = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len) };
    // SAFETY: `process` came from OpenProcess above.
    unsafe { CloseHandle(process) }.map_err(|e| e.to_string())?;
    result.map_err(|e| e.to_string())?;
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    Ok(Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or(path))
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
/// shell, in which case the last external window we saw.
pub fn target_window(last_external: &AtomicIsize) -> Result<HWND, String> {
    // SAFETY: GetForegroundWindow has no preconditions.
    let foreground = root_window(unsafe { GetForegroundWindow() });
    let ours = window_pid(foreground) == std::process::id();
    if !foreground.is_invalid() && !ours && !is_shell_class(&class_name(foreground)) {
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
    use super::is_shell_class;

    #[test]
    fn treats_taskbar_and_desktop_as_shell() {
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(is_shell_class("WorkerW"));
        assert!(!is_shell_class("XLMAIN"));
    }
}
