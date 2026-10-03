use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::dock::geometry::PxRect;
use crate::perception::Perception;
use crate::surfaces::NOTCH;

/// The desktop app: dashboard, Hodes, learning paths, chat and settings.
pub const APP: &str = "hodeum_app";
/// Carries the notch's rect in the app's own CSS px, so the app can grow out of it.
const UNFOLD_EVENT: &str = "app:unfold";
/// Logical gap above the app so the top notch stays visible over it.
const TOP_GAP: f64 = 56.0;

/// A rect in CSS (logical) px relative to some window's client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Window-local CSS px -> screen physical px.
pub fn to_screen(rect: CssRect, origin: (i32, i32), scale: f64) -> CssRect {
    CssRect {
        x: f64::from(origin.0) + rect.x * scale,
        y: f64::from(origin.1) + rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
    }
}

/// Screen physical px -> window-local CSS px.
pub fn to_local(rect: CssRect, origin: (i32, i32), scale: f64) -> CssRect {
    CssRect {
        x: (rect.x - f64::from(origin.0)) / scale,
        y: (rect.y - f64::from(origin.1)) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
    }
}

/// Centred horizontally in the work area, just below the notch when it fits, else centred.
pub fn app_origin(work: PxRect, size: (u32, u32), scale: f64) -> (i32, i32) {
    let x = work.x + (work.width.saturating_sub(size.0) / 2) as i32;
    let gap = (TOP_GAP * scale).round() as u32;
    let y = if size.1 + gap <= work.height { work.y + gap as i32 } else { work.y + (work.height.saturating_sub(size.1) / 2) as i32 };
    (x, y)
}

fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label).ok_or_else(|| format!("window `{label}` is missing"))
}

/// The notch's rect on screen, from its CSS rect inside the notch window.
fn notch_on_screen(app: &AppHandle, from: CssRect) -> Result<CssRect, String> {
    let notch = window(app, NOTCH)?;
    let origin = notch.inner_position().map_err(|e| e.to_string())?;
    let scale = notch.scale_factor().map_err(|e| e.to_string())?;
    Ok(to_screen(from, (origin.x, origin.y), scale))
}

/// Places the app on the notch's monitor unless the learner already moved or maximized it.
fn place(app_window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    if app_window.is_visible().map_err(|e| e.to_string())? || app_window.is_maximized().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let notch = window(app, NOTCH)?;
    let Some(monitor) = notch.current_monitor().map_err(|e| e.to_string())? else { return Ok(()) };
    let area = monitor.work_area();
    let work = PxRect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
    let size = app_window.outer_size().map_err(|e| e.to_string())?;
    let (x, y) = app_origin(work, (size.width, size.height), monitor.scale_factor());
    app_window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}

/// Shows the app, growing out of `from` (the notch, in notch CSS px) when given.
pub fn show(app: &AppHandle, from: Option<CssRect>) -> Result<(), String> {
    app.state::<Perception>().remember_learner_window();
    let app_window = window(app, APP)?;
    place(&app_window, app)?;
    let origin_screen = from.map(|rect| notch_on_screen(app, rect)).transpose()?;
    app_window.unminimize().map_err(|e| e.to_string())?;
    app_window.show().map_err(|e| e.to_string())?;
    app_window.set_focus().map_err(|e| e.to_string())?;
    let inner = app_window.inner_position().map_err(|e| e.to_string())?;
    let scale = app_window.scale_factor().map_err(|e| e.to_string())?;
    let local = origin_screen.map(|rect| to_local(rect, (inner.x, inner.y), scale));
    app_window.emit_to(APP, UNFOLD_EVENT, local).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_app_window(app: AppHandle, from: Option<CssRect>) -> Result<(), String> {
    show(&app, from)
}

/// Closing the app only hides it: Hodey keeps running in the notch.
pub fn keep_alive(app: &AppHandle) -> Result<(), String> {
    let app_window = window(app, APP)?;
    let handle = app_window.clone();
    app_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = handle.hide() {
                eprintln!("couldn't hide the Hodeum app: {error}");
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: PxRect = PxRect { x: 0, y: 0, width: 1920, height: 1040 };

    #[test]
    fn places_the_app_below_the_notch_or_centres_it_when_short() {
        assert_eq!(app_origin(WORK, (1120, 740), 1.0), (400, 56));
        assert_eq!(app_origin(WORK, (1680, 1110), 1.5), (120, 0));
    }

    #[test]
    fn round_trips_between_window_and_screen_coordinates() {
        let rect = CssRect { x: 10.0, y: 4.0, width: 200.0, height: 40.0 };
        let screen = to_screen(rect, (660, 0), 1.5);
        assert_eq!(screen, CssRect { x: 675.0, y: 6.0, width: 300.0, height: 60.0 });
        assert_eq!(to_local(screen, (660, 0), 1.5), rect);
    }
}
