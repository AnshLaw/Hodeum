use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::hit_test::{HitRect, NotchHitRect};

pub const NOTCH: &str = "main_notch";
pub const OVERLAY: &str = "guidance_overlay";

/// Logical size of the notch window. The pill animates inside it; the rest is click-through,
/// so the window never has to resize per state (which is what makes transparent windows stutter).
const NOTCH_WINDOW_WIDTH: f64 = 600.0;
const NOTCH_WINDOW_HEIGHT: f64 = 340.0;

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
    let width = (NOTCH_WINDOW_WIDTH * monitor.scale).round() as u32;
    let height = (NOTCH_WINDOW_HEIGHT * monitor.scale).round() as u32;
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

#[tauri::command]
pub fn set_notch_hit_rect(rect: HitRect, state: State<'_, NotchHitRect>) -> Result<(), String> {
    state.set(rect)
}

#[tauri::command]
pub fn set_notch_activatable(app: AppHandle, activatable: bool) -> Result<(), String> {
    let notch = window(&app, NOTCH)?;
    notch.set_focusable(activatable).map_err(|e| e.to_string())?;
    if activatable {
        notch.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_overlay_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let overlay = window(&app, OVERLAY)?;
    overlay
        .set_ignore_cursor_events(!interactive)
        .map_err(|e| e.to_string())?;
    overlay.set_focusable(interactive).map_err(|e| e.to_string())?;
    if interactive {
        overlay.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
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
