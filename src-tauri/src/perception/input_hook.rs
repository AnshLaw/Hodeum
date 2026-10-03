use std::sync::{mpsc, OnceLock};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_ESCAPE, VK_RETURN, VK_SPACE, VK_TAB};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, WindowFromPoint, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL,
    WH_MOUSE_LL, WM_KEYUP, WM_LBUTTONUP, WM_RBUTTONUP,
};

use super::foreground::{root_window, window_pid};

/// Wait for the UI to settle after the last learner action before re-reading it.
const SETTLE: Duration = Duration::from_millis(350);
pub const LEARNER_ACTION_EVENT: &str = "perception:learner-action";
/// Keys that commit something in most apps. Only the key code is inspected; nothing typed is recorded.
const ACTION_KEYS: [u16; 4] = [VK_RETURN.0, VK_TAB.0, VK_ESCAPE.0, VK_SPACE.0];

static SIGNAL: OnceLock<mpsc::Sender<()>> = OnceLock::new();

pub fn is_action_key(vk_code: u32) -> bool {
    ACTION_KEYS.iter().any(|&key| u32::from(key) == vk_code)
}

fn is_own(hwnd: windows::Win32::Foundation::HWND) -> bool {
    window_pid(root_window(hwnd)) == std::process::id()
}

fn signal() {
    if let Some(sender) = SIGNAL.get() {
        // A send only fails once the debounce thread has exited at shutdown; nothing to recover.
        let _ = sender.send(());
    }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;
    if code >= 0 && (message == WM_LBUTTONUP || message == WM_RBUTTONUP) {
        // SAFETY: for WH_MOUSE_LL, lparam points to an MSLLHOOKSTRUCT for the duration of the call.
        let point: POINT = unsafe { (*(lparam.0 as *const MSLLHOOKSTRUCT)).pt };
        // SAFETY: WindowFromPoint has no preconditions.
        if !is_own(unsafe { WindowFromPoint(point) }) {
            signal();
        }
    }
    // SAFETY: forwarding the unmodified hook arguments, as required.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && wparam.0 as u32 == WM_KEYUP {
        // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT for the duration of the call.
        let vk_code = unsafe { (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode };
        // SAFETY: GetForegroundWindow has no preconditions.
        if is_action_key(vk_code) && !is_own(unsafe { GetForegroundWindow() }) {
            signal();
        }
    }
    // SAFETY: as above.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Hooks must sit on a thread with a message loop and return immediately; they only signal.
fn run_hooks() -> Result<(), String> {
    // SAFETY: standard low-level hook installation for this module; unhooked when the loop ends.
    unsafe {
        let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), Some(module.into()), 0).map_err(|e| e.to_string())?;
        let keys = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), Some(module.into()), 0).map_err(|e| e.to_string())?;
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
        UnhookWindowsHookEx(mouse).map_err(|e| e.to_string())?;
        UnhookWindowsHookEx(keys).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Collapses a burst of actions into one event once input has been quiet for `SETTLE`.
fn debounce(app: AppHandle, signals: mpsc::Receiver<()>) {
    while signals.recv().is_ok() {
        loop {
            match signals.recv_timeout(SETTLE) {
                Ok(()) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        if let Err(error) = app.emit(LEARNER_ACTION_EVENT, ()) {
            eprintln!("failed to emit {LEARNER_ACTION_EVENT}: {error}");
        }
    }
}

pub fn spawn(app: AppHandle) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    SIGNAL.set(sender).map_err(|_| "the input hook is already running".to_string())?;
    thread::spawn(move || debounce(app, receiver));
    thread::spawn(|| {
        if let Err(error) = run_hooks() {
            eprintln!("learner input hook stopped: {error}");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_action_key;

    #[test]
    fn recognizes_committing_keys_only() {
        assert!(is_action_key(0x0D)); // Enter
        assert!(is_action_key(0x09)); // Tab
        assert!(!is_action_key(0x41)); // A
    }
}
