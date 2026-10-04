use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use std::sync::Mutex;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

use crate::dock::geometry::{PxRect, NOTCH_WINDOW};
use crate::perception::foreground::{root_window, window_pid};

use crate::hit_test::{HitRect, NotchHitRect};

pub const NOTCH: &str = "main_notch";
pub const OVERLAY: &str = "guidance_overlay";


/// A monitor in physical pixels, mirrored by `MonitorInfo` in `src/lib/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct MonitorInfo {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

/// Top-centre of the monitor for a window `window_width` physical pixels wide.
pub fn notch_origin(monitor: &MonitorInfo, window_width: u32) -> (i32, i32) {
    let offset = monitor.width.saturating_sub(window_width) / 2;
    (monitor.x + offset as i32, monitor.y)
}

fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window `{label}` is missing"))
}

fn monitor_of(win: &WebviewWindow) -> Result<MonitorInfo, String> {
    let current = win.current_monitor().map_err(|e| e.to_string())?;
    let monitor = match current {
        Some(m) => m,
        None => win
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "no monitor found".to_string())?,
    };
    Ok(MonitorInfo {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale: monitor.scale_factor(),
    })
}

fn place_notch(notch: &WebviewWindow, monitor: &MonitorInfo) -> tauri::Result<()> {
    // The pill animates inside a fixed window and the rest is click-through, so the window never
    // resizes per state (which is what makes transparent windows stutter).
    let width = (NOTCH_WINDOW.0 * monitor.scale).round() as u32;
    let height = (NOTCH_WINDOW.1 * monitor.scale).round() as u32;
    notch.set_size(PhysicalSize::new(width, height))?;
    let (x, y) = notch_origin(monitor, width);
    notch.set_position(PhysicalPosition::new(x, y))
}

fn place_overlay(overlay: &WebviewWindow, monitor: &MonitorInfo) -> tauri::Result<()> {
    overlay.set_position(PhysicalPosition::new(monitor.x, monitor.y))?;
    overlay.set_size(PhysicalSize::new(monitor.width, monitor.height))
}

/// Shows the overlay first so the notch stacks above it. Both are `focusable: false` in tauri.conf.json
/// (WS_EX_NOACTIVATE), so clicking them never takes focus from the learner's app.
pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let notch = window(app, NOTCH)?;
    let overlay = window(app, OVERLAY)?;
    let monitor = monitor_of(&notch)?;

    place_overlay(&overlay, &monitor)?;
    overlay.set_ignore_cursor_events(true)?;
    overlay.show()?;

    place_notch(&notch, &monitor)?;
    notch.set_ignore_cursor_events(true)?;
    notch.show()?;
    Ok(())
}

/// The learner's app that had focus before Hodeum briefly took it (goal field, Point & Ask).
#[derive(Default)]
pub struct FocusReturn(Mutex<isize>);

impl FocusReturn {
    /// Remembers the current foreground window if it belongs to another app.
    fn remember(&self) -> Result<(), String> {
        // SAFETY: GetForegroundWindow has no preconditions.
        let foreground = root_window(unsafe { GetForegroundWindow() });
        if !foreground.is_invalid() && window_pid(foreground) != std::process::id() {
            *self.0.lock().map_err(|e| e.to_string())? = foreground.0 as isize;
        }
        Ok(())
    }

    /// A pending hand-back now goes to `hwnd` (the app a Hode just brought forward) instead.
    pub fn redirect(&self, hwnd: isize) -> Result<(), String> {
        let mut saved = self.0.lock().map_err(|e| e.to_string())?;
        if *saved != 0 {
            *saved = hwnd;
        }
        Ok(())
    }

    /// Hands keyboard focus back so the learner can keep working without an extra click.
    fn restore(&self) -> Result<(), String> {
        let saved = std::mem::take(&mut *self.0.lock().map_err(|e| e.to_string())?);
        if saved != 0 {
            // SAFETY: a stale handle simply fails; Hodeum is foreground here, so the switch is allowed.
            let switched = unsafe { SetForegroundWindow(HWND(saved as *mut _)) };
            if !switched.as_bool() {
                eprintln!("couldn't return focus to the learner's app");
            }
        }
        Ok(())
    }
}

/// Tells the overlay to re-read its monitor (scale and origin) after moving.
const OVERLAY_MOVED_EVENT: &str = "overlay:moved";

/// Moves the overlay onto `monitor` if it isn't already covering it.
pub fn follow_monitor(app: &AppHandle, monitor: PxRect) -> Result<(), String> {
    let overlay = window(app, OVERLAY)?;
    let position = overlay.outer_position().map_err(|e| e.to_string())?;
    let size = overlay.outer_size().map_err(|e| e.to_string())?;
    let current = PxRect { x: position.x, y: position.y, width: size.width, height: size.height };
    if current == monitor {
        return Ok(());
    }
    overlay.set_position(PhysicalPosition::new(monitor.x, monitor.y)).map_err(|e| e.to_string())?;
    overlay.set_size(PhysicalSize::new(monitor.width, monitor.height)).map_err(|e| e.to_string())?;
    app.emit(OVERLAY_MOVED_EVENT, ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_notch_hit_rect(rect: HitRect, state: State<'_, NotchHitRect>) -> Result<(), String> {
    state.set(rect)
}

#[tauri::command]
pub fn set_notch_activatable(app: AppHandle, activatable: bool, focus: State<'_, FocusReturn>) -> Result<(), String> {
    let notch = window(&app, NOTCH)?;
    if activatable {
        focus.remember()?;
    }
    notch.set_focusable(activatable).map_err(|e| e.to_string())?;
    if activatable {
        notch.set_focus().map_err(|e| e.to_string())
    } else {
        focus.restore()
    }
}

#[tauri::command]
pub fn set_overlay_interactive(app: AppHandle, interactive: bool, focus: State<'_, FocusReturn>) -> Result<(), String> {
    let overlay = window(&app, OVERLAY)?;
    if interactive {
        focus.remember()?;
    }
    overlay
        .set_ignore_cursor_events(!interactive)
        .map_err(|e| e.to_string())?;
    overlay.set_focusable(interactive).map_err(|e| e.to_string())?;
    if interactive {
        overlay.set_focus().map_err(|e| e.to_string())
    } else {
        focus.restore()
    }
}

#[tauri::command]
pub fn monitor_info(app: AppHandle) -> Result<MonitorInfo, String> {
    monitor_of(&window(&app, OVERLAY)?)
}

#[cfg(test)]
mod tests {
    use super::{notch_origin, MonitorInfo};

    #[test]
    fn centres_the_notch_on_a_secondary_monitor() {
        let monitor = MonitorInfo { x: 1920, y: 0, width: 2560, height: 1440, scale: 1.25 };
        assert_eq!(notch_origin(&monitor, 750), (1920 + 905, 0));
    }

    #[test]
    fn pins_to_the_left_edge_when_wider_than_the_monitor() {
        let monitor = MonitorInfo { x: 0, y: 0, width: 500, height: 800, scale: 1.0 };
        assert_eq!(notch_origin(&monitor, 600), (0, 0));
    }
}
