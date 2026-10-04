//! Tells the overlay which window the learner is in and where it is, so guidance placed on one window
//! is never drawn over another app and never spills outside its own window.

use std::collections::HashMap;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic, IsWindow};

use super::foreground::{is_shell_window, root_window, window_pid};
use super::model::RectDto;
use super::Perception;
use crate::apps::identity::{identify_window, AppIdentity};

pub const LEARNER_WINDOW_EVENT: &str = "perception:learner-window";
/// Fast enough that a highlight leaves with its window as the learner switches apps.
const POLL_INTERVAL: Duration = Duration::from_millis(100);
/// Remembered windows before the memo starts over (closed windows' entries are never needed again).
const MEMO_LIMIT: usize = 256;

/// Mirrors `WindowRef` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowDto {
    pub id: isize,
    pub bounds: RectDto,
    /// Friendly app name ("Settings"); absent when unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    /// Stable app id ("settings"); absent when unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
}

impl WindowDto {
    pub fn with_identity(mut self, identity: &AppIdentity) -> Self {
        let present = |s: &str| (!s.is_empty()).then(|| s.to_string());
        self.app = present(&identity.name);
        self.app_id = present(&identity.id);
        self
    }
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
    Some(WindowDto { id: hwnd.0 as isize, bounds, app: None, app_id: None })
}

/// What doesn't change about a window while it's open, so the 100 ms poll reads it once per window.
#[derive(Default)]
struct WindowMemo {
    shell: HashMap<isize, bool>,
    identity: HashMap<isize, AppIdentity>,
}

impl WindowMemo {
    fn is_shell(&mut self, hwnd: HWND) -> bool {
        if self.shell.len() > MEMO_LIMIT {
            self.shell.clear();
        }
        *self.shell.entry(hwnd.0 as isize).or_insert_with(|| is_shell_window(hwnd))
    }

    fn identity(&mut self, hwnd: HWND) -> AppIdentity {
        if let Some(known) = self.identity.get(&(hwnd.0 as isize)) {
            return known.clone();
        }
        let identity = identify_window(hwnd);
        // An app still starting may not be identifiable yet; look again next time.
        if !identity.id.is_empty() {
            if self.identity.len() > MEMO_LIMIT {
                self.identity.clear();
            }
            self.identity.insert(hwnd.0 as isize, identity.clone());
        }
        identity
    }
}

/// What the learner is looking at: their front window, or the last one while Hodeum's own windows have
/// focus (the notch, the overlay during Point & Ask). None over the desktop, taskbar, Start, Search or
/// Alt+Tab, or when minimized; the last app stays the learner's app while they pass through the shell.
fn current_learner_window(last_external: &AtomicIsize, memo: &mut WindowMemo) -> Option<WindowDto> {
    // SAFETY: GetForegroundWindow has no preconditions.
    let foreground = root_window(unsafe { GetForegroundWindow() });
    if foreground.is_invalid() {
        return None;
    }
    let hwnd = if window_pid(foreground) == std::process::id() {
        HWND(last_external.load(Ordering::SeqCst) as *mut _)
    } else if memo.is_shell(foreground) {
        return None;
    } else {
        last_external.store(foreground.0 as isize, Ordering::SeqCst);
        foreground
    };
    // SAFETY: IsWindow and IsIconic accept stale handles.
    let alive = !hwnd.is_invalid() && unsafe { IsWindow(Some(hwnd)) }.as_bool() && !unsafe { IsIconic(hwnd) }.as_bool();
    if !alive {
        return None;
    }
    window_frame(hwnd).map(|frame| frame.with_identity(&memo.identity(hwnd)))
}

#[tauri::command]
pub fn learner_window(state: State<'_, Perception>) -> Option<WindowDto> {
    current_learner_window(&state.last_external(), &mut WindowMemo::default())
}

/// Reports the learner's window whenever it changes, moves or resizes.
pub fn spawn(app: AppHandle, last_external: Arc<AtomicIsize>) {
    thread::spawn(move || {
        let mut memo = WindowMemo::default();
        let mut reported: Option<Option<WindowDto>> = None;
        loop {
            let now = current_learner_window(&last_external, &mut memo);
            if reported.as_ref() != Some(&now) {
                // First, so the overlay is on the window's monitor by the time the pages hear of it.
                crate::topmost::on_learner_window(&app, now.as_ref());
                match app.emit(LEARNER_WINDOW_EVENT, &now) {
                    Ok(()) => reported = Some(now),
                    Err(error) => eprintln!("couldn't report the learner's window: {error}"),
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_app_and_app_id_in_camel_case_and_omits_unknown_ones() {
        let frame = WindowDto { id: 7, bounds: RectDto { x: 0.0, y: 0.0, width: 10.0, height: 10.0 }, app: None, app_id: None };
        let known = frame.clone().with_identity(&AppIdentity { id: "settings".into(), name: "Settings".into(), exe: "SystemSettings".into() });
        let json = serde_json::to_value(&known).unwrap();
        assert_eq!(json["app"], "Settings");
        assert_eq!(json["appId"], "settings");
        let unknown = frame.with_identity(&AppIdentity { id: String::new(), name: String::new(), exe: "ApplicationFrameHost".into() });
        let json = serde_json::to_value(&unknown).unwrap();
        assert!(json.get("app").is_none() && json.get("appId").is_none());
    }
}
