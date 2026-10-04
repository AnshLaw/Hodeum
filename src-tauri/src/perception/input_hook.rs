use std::sync::{mpsc, OnceLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_BROWSER_BACK, VK_CONTROL, VK_ESCAPE, VK_LEFT, VK_RETURN, VK_SPACE, VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, WindowFromPoint, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL,
    WH_MOUSE_LL, LLMHF_INJECTED, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONUP, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONUP,
    XBUTTON1,
};
#[cfg(test)]
use windows::Win32::UI::WindowsAndMessaging::{WM_LBUTTONDOWN, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, XBUTTON2};

use super::foreground::{root_window, window_pid};

/// Wait for the UI to settle after the last learner action before re-reading it.
const SETTLE: Duration = Duration::from_millis(350);
pub const LEARNER_ACTION_EVENT: &str = "perception:learner-action";
/// Keys that commit something in most apps. Only the key code is inspected; nothing typed is recorded.
const ACTION_KEYS: [u16; 4] = [VK_RETURN.0, VK_TAB.0, VK_ESCAPE.0, VK_SPACE.0];
/// Z, as in Ctrl+Z (undo).
const UNDO_KEY: u32 = 0x5A;
/// A burst of input longer than this keeps only its newest entries.
const MAX_INPUTS_PER_EVENT: usize = 16;

/// Mirrors `LearnerInput` in `src/lib/types.ts`: what the learner did, for stuck detection.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LearnerInput {
    Click { at: PointDto, button: MouseButton },
    Undo,
    Back,
}

/// Physical screen pixels, like UI Automation bounds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PointDto {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
}

/// `None` is a committing key: worth a re-read, with nothing more to report.
static SIGNAL: OnceLock<mpsc::Sender<Option<LearnerInput>>> = OnceLock::new();

pub fn is_action_key(vk_code: u32) -> bool {
    ACTION_KEYS.iter().any(|&key| u32::from(key) == vk_code)
}

/// Undo (Ctrl+Z) and back (Alt+Left, the Back key). Every other key is ignored.
pub fn shortcut_input(vk_code: u32, ctrl: bool, alt: bool) -> Option<LearnerInput> {
    if vk_code == UNDO_KEY && ctrl && !alt {
        return Some(LearnerInput::Undo);
    }
    let back = vk_code == u32::from(VK_BROWSER_BACK.0) || (vk_code == u32::from(VK_LEFT.0) && alt);
    back.then_some(LearnerInput::Back)
}

/// A finished click and where it landed, or the mouse's back button.
pub fn mouse_input(message: u32, x_button: u16, at: PointDto) -> Option<LearnerInput> {
    match message {
        WM_LBUTTONUP => Some(LearnerInput::Click { at, button: MouseButton::Left }),
        WM_RBUTTONUP => Some(LearnerInput::Click { at, button: MouseButton::Right }),
        WM_XBUTTONUP if x_button == XBUTTON1 => Some(LearnerInput::Back),
        _ => None,
    }
}

fn is_own(hwnd: windows::Win32::Foundation::HWND) -> bool {
    window_pid(root_window(hwnd)) == std::process::id()
}

fn signal(input: Option<LearnerInput>) {
    if let Some(sender) = SIGNAL.get() {
        // A send only fails once the debounce thread has exited at shutdown; nothing to recover.
        let _ = sender.send(input);
    }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        // SAFETY: for WH_MOUSE_LL, lparam points to an MSLLHOOKSTRUCT for the duration of the call.
        let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        // Synthesized clicks (Hodey's own, in Agent · Do it for me) are not the learner's actions.
        if info.flags & LLMHF_INJECTED != 0 {
            // SAFETY: forwarding the unmodified hook arguments, as required.
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
        let point: POINT = info.pt;
        let x_button = (info.mouseData >> 16) as u16;
        let at = PointDto { x: f64::from(point.x), y: f64::from(point.y) };
        // SAFETY: WindowFromPoint has no preconditions.
        if let Some(input) = mouse_input(wparam.0 as u32, x_button, at).filter(|_| !is_own(unsafe { WindowFromPoint(point) })) {
            signal(Some(input));
        }
    }
    // SAFETY: forwarding the unmodified hook arguments, as required.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Returned instead of passing a key on: the Hodey key's letter commands never reach the app.
const SWALLOW: LRESULT = LRESULT(1);

/// High bit of `GetAsyncKeyState`: the key is down right now.
fn ctrl_down() -> bool {
    // SAFETY: GetAsyncKeyState has no preconditions.
    let state = unsafe { GetAsyncKeyState(i32::from(VK_CONTROL.0)) };
    state < 0
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;
    if code >= 0 {
        // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT for the duration of the call.
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let vk_code = info.vkCode;
        let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        let up = message == WM_KEYUP || message == WM_SYSKEYUP;
        if (down || up) && crate::hodey_key::on_key(vk_code, down) {
            return SWALLOW;
        }
        let alt = info.flags.0 & LLKHF_ALTDOWN.0 != 0;
        let report = if down {
            shortcut_input(vk_code, ctrl_down(), alt).map(Some)
        } else {
            (message == WM_KEYUP && is_action_key(vk_code)).then_some(None)
        };
        // SAFETY: GetForegroundWindow has no preconditions.
        if let Some(input) = report.filter(|_| !is_own(unsafe { GetForegroundWindow() })) {
            signal(input);
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

/// Adds one report to a burst, dropping the oldest once the burst is full.
fn collect(inputs: &mut Vec<LearnerInput>, input: Option<LearnerInput>) {
    let Some(input) = input else { return };
    if inputs.len() == MAX_INPUTS_PER_EVENT {
        inputs.remove(0);
    }
    inputs.push(input);
}

/// Collapses a burst of actions into one event once input has been quiet for `SETTLE`; the event
/// carries the burst's clicks and undo/back, oldest first.
fn debounce(app: AppHandle, signals: mpsc::Receiver<Option<LearnerInput>>) {
    while let Ok(first) = signals.recv() {
        let mut inputs = Vec::new();
        collect(&mut inputs, first);
        loop {
            match signals.recv_timeout(SETTLE) {
                Ok(input) => collect(&mut inputs, input),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        if let Err(error) = app.emit(LEARNER_ACTION_EVENT, inputs) {
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
    use super::*;

    #[test]
    fn recognizes_committing_keys_only() {
        assert!(is_action_key(0x0D)); // Enter
        assert!(is_action_key(0x09)); // Tab
        assert!(!is_action_key(0x41)); // A
    }

    #[test]
    fn reports_undo_and_back_shortcuts_only() {
        assert_eq!(shortcut_input(0x5A, true, false), Some(LearnerInput::Undo)); // Ctrl+Z
        assert_eq!(shortcut_input(0x5A, false, false), None); // a typed z
        assert_eq!(shortcut_input(0x25, false, true), Some(LearnerInput::Back)); // Alt+Left
        assert_eq!(shortcut_input(0x25, false, false), None); // Left arrow
        assert_eq!(shortcut_input(0xA6, false, false), Some(LearnerInput::Back)); // Browser Back key
    }

    #[test]
    fn reports_where_a_click_landed_and_the_mouse_back_button() {
        let at = PointDto { x: 10.0, y: 20.0 };
        assert_eq!(mouse_input(WM_LBUTTONUP, 0, at), Some(LearnerInput::Click { at, button: MouseButton::Left }));
        assert_eq!(mouse_input(WM_RBUTTONUP, 0, at), Some(LearnerInput::Click { at, button: MouseButton::Right }));
        assert_eq!(mouse_input(WM_XBUTTONUP, XBUTTON1, at), Some(LearnerInput::Back));
        assert_eq!(mouse_input(WM_XBUTTONUP, XBUTTON2, at), None);
    }

    #[test]
    fn pointer_movement_wheel_and_button_presses_are_never_learner_actions() {
        let at = PointDto { x: 10.0, y: 20.0 };
        for message in [WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_MOUSEHWHEEL, WM_LBUTTONDOWN, WM_RBUTTONDOWN] {
            assert_eq!(mouse_input(message, 0, at), None, "message {message:#x}");
        }
    }

    #[test]
    fn serializes_inputs_the_way_the_web_side_reads_them() {
        let click = LearnerInput::Click { at: PointDto { x: 1.0, y: 2.0 }, button: MouseButton::Right };
        assert_eq!(serde_json::to_string(&click).unwrap(), r#"{"kind":"click","at":{"x":1.0,"y":2.0},"button":"right"}"#);
        assert_eq!(serde_json::to_string(&LearnerInput::Undo).unwrap(), r#"{"kind":"undo"}"#);
    }

    #[test]
    fn keeps_the_newest_inputs_of_a_long_burst() {
        let mut inputs = Vec::new();
        for _ in 0..MAX_INPUTS_PER_EVENT {
            collect(&mut inputs, Some(LearnerInput::Undo));
        }
        collect(&mut inputs, None);
        collect(&mut inputs, Some(LearnerInput::Back));
        assert_eq!(inputs.len(), MAX_INPUTS_PER_EVENT);
        assert_eq!(inputs.last(), Some(&LearnerInput::Back));
    }
}
