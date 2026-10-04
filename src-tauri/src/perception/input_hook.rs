use std::ops::RangeInclusive;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_BROWSER_BACK, VK_CONTROL, VK_DIVIDE, VK_ESCAPE, VK_LEFT, VK_NUMPAD0, VK_OEM_1, VK_OEM_102, VK_OEM_3, VK_OEM_4, VK_OEM_8,
    VK_RETURN, VK_SPACE, VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, WindowFromPoint, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, LLKHF_INJECTED, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL,
    WH_MOUSE_LL, LLMHF_INJECTED, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN,
    WM_SYSKEYUP, WM_XBUTTONUP, XBUTTON1,
};
#[cfg(test)]
use windows::Win32::UI::WindowsAndMessaging::{WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, XBUTTON2};

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
/// Space this soon after a typed character is part of the text, not a commit.
const TYPING_WINDOW: Duration = Duration::from_secs(1);
/// Keys that separate typed words; they only commit when the learner isn't typing. Not Tab: after typing,
/// Tab commits (an Excel cell, a form field), so it must still be checked.
const WORD_SEPARATORS: [u16; 1] = [VK_SPACE.0];
const KEY_0: u16 = 0x30;
const KEY_9: u16 = 0x39;
const KEY_A: u16 = 0x41;
const KEY_Z: u16 = 0x5A;
/// Keys that type a character: digits, letters, the number pad and punctuation.
const TYPING_KEYS: [RangeInclusive<u16>; 6] =
    [KEY_0..=KEY_9, KEY_A..=KEY_Z, VK_NUMPAD0.0..=VK_DIVIDE.0, VK_OEM_1.0..=VK_OEM_3.0, VK_OEM_4.0..=VK_OEM_8.0, VK_OEM_102.0..=VK_OEM_102.0];
/// A key-press time that hasn't happened.
const NEVER: u64 = 0;
const NO_KEY: u32 = 0;

/// Key-press times in ms since `CLOCK` started, plus one so a real press is never `NEVER`. Only the
/// time is kept: which key was pressed is not recorded.
static CLOCK: OnceLock<Instant> = OnceLock::new();
/// The last physical key press (auto-repeat excluded): its click can sound like speech to the mic.
static LAST_KEY_DOWN: AtomicU64 = AtomicU64::new(NEVER);
/// The last physical press of a key that types a character.
static LAST_TYPED: AtomicU64 = AtomicU64::new(NEVER);
/// The key held down now, to tell auto-repeat (silent) from a new press.
static HELD_KEY: AtomicU32 = AtomicU32::new(NO_KEY);

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

pub fn is_typing_key(vk_code: u32) -> bool {
    u16::try_from(vk_code).is_ok_and(|vk| TYPING_KEYS.iter().any(|keys| keys.contains(&vk)))
}

/// Whether releasing this key commits something: Space right after typing is just text.
pub fn commits(vk_code: u32, since_typed: Option<Duration>) -> bool {
    let separator = WORD_SEPARATORS.iter().any(|&key| u32::from(key) == vk_code);
    is_action_key(vk_code) && !(separator && since_typed.is_some_and(|since| since < TYPING_WINDOW))
}

fn now_stamp() -> u64 {
    let elapsed = CLOCK.get_or_init(Instant::now).elapsed().as_millis();
    u64::try_from(elapsed).unwrap_or(u64::MAX).saturating_add(1)
}

/// How long ago a stamped key press was, at `now`; None if it never happened.
fn since(stamp: u64, now: u64) -> Option<Duration> {
    (stamp != NEVER).then(|| Duration::from_millis(now.saturating_sub(stamp)))
}

/// How long ago the learner last pressed a key (any key, auto-repeat and Hodey's own input excluded).
pub fn since_last_key() -> Option<Duration> {
    since(LAST_KEY_DOWN.load(Ordering::Relaxed), now_stamp())
}

fn since_typed() -> Option<Duration> {
    since(LAST_TYPED.load(Ordering::Relaxed), now_stamp())
}

/// A held key sends repeated key-downs; only the first is a new (audible) press.
fn is_repeat(held: u32, vk_code: u32) -> bool {
    held == vk_code
}

/// Notes when a physical key went down, for the voice noise gate and the typing check.
fn note_key(vk_code: u32, down: bool) {
    if !down {
        // Fails when another key is held now; that key's state is the one to keep.
        let _ = HELD_KEY.compare_exchange(vk_code, NO_KEY, Ordering::Relaxed, Ordering::Relaxed);
        return;
    }
    let now = now_stamp();
    if !is_repeat(HELD_KEY.swap(vk_code, Ordering::Relaxed), vk_code) {
        LAST_KEY_DOWN.store(now, Ordering::Relaxed);
    }
    if is_typing_key(vk_code) {
        LAST_TYPED.store(now, Ordering::Relaxed);
    }
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

/// Every physical mouse press (screen px), so the notch can close its menus on a click anywhere else.
static PRESSES: OnceLock<mpsc::Sender<(i32, i32)>> = OnceLock::new();

/// A button going down: where a click outside the notch starts.
pub fn is_press(message: u32) -> bool {
    matches!(message, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN)
}

fn report_press(point: POINT) {
    // Sending never blocks, so the hook still returns at once; a closed channel only means the watcher stopped.
    if let Some(Err(error)) = PRESSES.get().map(|presses| presses.send((point.x, point.y))) {
        eprintln!("couldn't report a mouse press to the notch: {error}");
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
        if is_press(wparam.0 as u32) {
            report_press(point);
        }
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
        if (down || up) && info.flags.0 & LLKHF_INJECTED.0 == 0 {
            note_key(vk_code, down);
        }
        if (down || up) && crate::hodey_key::on_key(vk_code, down) {
            return SWALLOW;
        }
        let alt = info.flags.0 & LLKHF_ALTDOWN.0 != 0;
        let report = if down {
            shortcut_input(vk_code, ctrl_down(), alt).map(Some)
        } else {
            (message == WM_KEYUP && commits(vk_code, since_typed())).then_some(None)
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
    let (presses, pressed) = mpsc::channel();
    PRESSES.set(presses).map_err(|_| "the input hook is already running".to_string())?;
    crate::hit_test::watch_presses(app.clone(), pressed);
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
    fn presses_are_button_downs_only() {
        assert!(is_press(WM_LBUTTONDOWN));
        assert!(is_press(WM_RBUTTONDOWN));
        assert!(!is_press(WM_LBUTTONUP));
        assert!(!is_press(WM_MOUSEMOVE));
    }

    #[test]
    fn recognizes_committing_keys_only() {
        assert!(is_action_key(0x0D)); // Enter
        assert!(is_action_key(0x09)); // Tab
        assert!(!is_action_key(0x41)); // A
    }

    #[test]
    fn space_while_typing_is_text_not_a_commit() {
        let typed = |ms| Some(Duration::from_millis(ms));
        assert!(!commits(0x20, typed(200)), "the space between typed words");
        assert!(commits(0x09, typed(200)), "tab after typing commits a cell or field");
        assert!(commits(0x20, typed(1_500)), "space on a focused button after a pause");
        assert!(commits(0x20, None), "nothing typed yet");
        assert!(commits(0x0D, typed(50)), "Enter always commits");
        assert!(commits(0x1B, typed(50)), "Escape always commits");
        assert!(!commits(0x41, None), "a letter is never a commit");
    }

    #[test]
    fn typing_keys_are_characters_only() {
        for vk in [0x41, 0x5A, 0x30, 0x39, 0x60, 0x6F, 0xBA, 0xBE, 0xC0, 0xDB, 0xDE, 0xE2] {
            assert!(is_typing_key(vk), "{vk:#x}");
        }
        for vk in [0x20, 0x09, 0x0D, 0x10, 0x11, 0x25, 0x70, 0xA3, 0x5B] {
            assert!(!is_typing_key(vk), "{vk:#x}");
        }
    }

    #[test]
    fn key_press_times_are_relative_and_never_is_none() {
        assert_eq!(since(NEVER, 5_000), None);
        assert_eq!(since(4_700, 5_000), Some(Duration::from_millis(300)));
        assert_eq!(since(5_001, 5_000), Some(Duration::ZERO), "a press stamped after the read is now");
        assert!(now_stamp() > NEVER);
    }

    #[test]
    fn auto_repeat_is_not_a_new_press() {
        assert!(is_repeat(0x41, 0x41));
        assert!(!is_repeat(NO_KEY, 0x41));
        assert!(!is_repeat(0x41, 0x42), "rolling over to the next key is a new press");
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
