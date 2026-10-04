//! Tells the overlay which window the learner is in and where it is, so guidance placed on one window
//! is never drawn over another app and never spills outside its own window.

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic, IsWindow};

use super::foreground::{class_name, is_shell_class, root_window, window_pid};
use super::model::RectDto;
use super::Perception;

pub const LEARNER_WINDOW_EVENT: &str = "perception:learner-window";
/// Fast enough that a highlight leaves with its window as the learner switches apps.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Mirrors `WindowRef` in `src/lib/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct WindowDto {
    pub id: isize,
    pub bounds: RectDto,
}

/// The window's visible frame in physical px: without the invisible resize borders, which on a
/// maximized window reach past the monitor's edge.
pub fn window_frame(hwnd: HWND) -> Option<WindowDto> {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid out-parameter of the size passed; both calls tolerate stale handles.
    unsafe {
        let dwm = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, (&mut rect as *mut RECT).cast(), std::mem::size_of::<RECT>() as u32);
        if dwm.is_err() {
            GetWindowRect(hwnd, &mut rect).ok()?;
        }
    }
    let bounds = RectDto {
        x: f64::from(rect.left),
        y: f64::from(rect.top),
        width: f64::from((rect.right - rect.left).max(0)),
        height: f64::from((rect.bottom - rect.top).max(0)),
    };
    Some(WindowDto { id: hwnd.0 as isize, bounds })
}

/// What the learner is looking at: their front window, or the last one while Hodeum's own windows have
/// focus (the notch, the overlay during Point & Ask). None over the desktop or taskbar, or when minimized.
fn current_learner_window(last_external: &AtomicIsize) -> Option<WindowDto> {
    // SAFETY: GetForegroundWindow has no preconditions.
    let foreground = root_window(unsafe { GetForegroundWindow() });
    if foreground.is_invalid() {
        return None;
    }
    let hwnd = if window_pid(foreground) == std::process::id() {
        HWND(last_external.load(Ordering::SeqCst) as *mut _)
    } else if is_shell_class(&class_name(foreground)) {
        return None;
    } else {
        last_external.store(foreground.0 as isize, Ordering::SeqCst);
        foreground
    };
    // SAFETY: IsWindow and IsIconic accept stale handles.
    let alive = !hwnd.is_invalid() && unsafe { IsWindow(Some(hwnd)) }.as_bool() && !unsafe { IsIconic(hwnd) }.as_bool();
    if alive {
        window_frame(hwnd)
    } else {
        None
    }
}

#[tauri::command]
pub fn learner_window(state: State<'_, Perception>) -> Option<WindowDto> {
    current_learner_window(&state.last_external())
}

/// Reports the learner's window whenever it changes, moves or resizes.
pub fn spawn(app: AppHandle, last_external: Arc<AtomicIsize>) {
    thread::spawn(move || {
        let mut reported: Option<Option<WindowDto>> = None;
        loop {
            let now = current_learner_window(&last_external);
            if reported != Some(now) {
                match app.emit(LEARNER_WINDOW_EVENT, now) {
                    Ok(()) => reported = Some(now),
                    Err(error) => eprintln!("couldn't report the learner's window: {error}"),
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}
