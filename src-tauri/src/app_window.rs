use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent};

use crate::dock::geometry::PxRect;
use crate::hit_test::{HitRect, NotchHitRect};
use crate::perception::Perception;
use crate::surfaces::NOTCH;

/// The desktop app: dashboard, Hodes, learning paths, chat and settings.
pub const APP: &str = "hodeum_app";
/// Carries the notch's rect in the app's own CSS px, so the app can grow out of it.
const UNFOLD_EVENT: &str = "app:unfold";
/// Asks the app to fold back into the notch and hide (it owns the animation and tells the notch).
const FOLD_EVENT: &str = "app:fold";
/// Logical gap above the app. The notch steps aside while the app is open, so the app sits just under
/// where the notch was and grows straight out of it.
const TOP_GAP: f64 = 8.0;

/// Placed once on the notch's monitor; after that the learner's own position, size and maximize stick.
static PLACED: AtomicBool = AtomicBool::new(false);

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

/// The rect to grow out of: the caller's, else the notch pill's last box while the notch is on screen
/// (the tray and the Hodey key don't know it). None means the app just fades in.
pub fn unfold_origin(from: Option<CssRect>, pill: HitRect, notch_visible: bool) -> Option<CssRect> {
    from.or_else(|| {
        let usable = notch_visible && pill.width > 0.0 && pill.height > 0.0;
        usable.then_some(CssRect { x: pill.x, y: pill.y, width: pill.width, height: pill.height })
    })
}

#[derive(Debug, PartialEq)]
pub enum Toggle {
    Show,
    Fold,
}

/// The Hodey key + A: folds the app away when the learner is in it, otherwise brings it up.
pub fn toggle_action(visible: bool, minimized: bool, focused: bool) -> Toggle {
    if visible && !minimized && focused {
        Toggle::Fold
    } else {
        Toggle::Show
    }
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

/// Places the app on the notch's monitor the first time; after that it stays where the learner left it.
fn place(app_window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    if PLACED.load(Ordering::SeqCst) || app_window.is_maximized().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let notch = window(app, NOTCH)?;
    let Some(monitor) = notch.current_monitor().map_err(|e| e.to_string())? else { return Ok(()) };
    let area = monitor.work_area();
    let work = PxRect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
    let size = app_window.outer_size().map_err(|e| e.to_string())?;
    let (x, y) = app_origin(work, (size.width, size.height), monitor.scale_factor());
    app_window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    PLACED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Shows the app, growing out of `from` (the notch, in notch CSS px) or else the notch's last pill.
/// The app then tells the notch to step aside (see `notchWindow` in src/features/dock/dock.ts).
pub fn show(app: &AppHandle, from: Option<CssRect>) -> Result<(), String> {
    app.state::<Perception>().remember_learner_window();
    let app_window = window(app, APP)?;
    place(&app_window, app)?;
    let notch_visible = window(app, NOTCH)?.is_visible().map_err(|e| e.to_string())?;
    let origin = unfold_origin(from, app.state::<NotchHitRect>().get()?, notch_visible);
    let origin_screen = origin.map(|rect| notch_on_screen(app, rect)).transpose()?;
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

fn request_fold(app_window: &WebviewWindow) -> Result<(), String> {
    app_window.emit_to(APP, FOLD_EVENT, ()).map_err(|e| e.to_string())
}

/// The Hodey key + A.
pub fn toggle(app: &AppHandle) -> Result<(), String> {
    let app_window = window(app, APP)?;
    let visible = app_window.is_visible().map_err(|e| e.to_string())?;
    let minimized = app_window.is_minimized().map_err(|e| e.to_string())?;
    let focused = app_window.is_focused().map_err(|e| e.to_string())?;
    match toggle_action(visible, minimized, focused) {
        Toggle::Show => show(app, None),
        Toggle::Fold => request_fold(&app_window),
    }
}

/// Closing the app (Alt+F4, the taskbar) folds it back into the notch and hides it: Hodey keeps running.
pub fn keep_alive(app: &AppHandle) -> Result<(), String> {
    let app_window = window(app, APP)?;
    let handle = app_window.clone();
    app_window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = request_fold(&handle) {
                eprintln!("couldn't fold the Hodeum app away, hiding it instead: {error}");
                if let Err(error) = handle.hide() {
                    eprintln!("couldn't hide the Hodeum app: {error}");
                }
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
        assert_eq!(app_origin(WORK, (1120, 740), 1.0), (400, 8));
        assert_eq!(app_origin(WORK, (1680, 1110), 1.5), (120, 0));
    }

    #[test]
    fn grows_out_of_the_given_rect_or_the_visible_notch_pill() {
        let given = CssRect { x: 1.0, y: 2.0, width: 3.0, height: 4.0 };
        let pill = HitRect { x: 200.0, y: 0.0, width: 220.0, height: 36.0 };
        assert_eq!(unfold_origin(Some(given), pill, false), Some(given));
        assert_eq!(unfold_origin(None, pill, true), Some(CssRect { x: 200.0, y: 0.0, width: 220.0, height: 36.0 }));
        assert_eq!(unfold_origin(None, pill, false), None);
        assert_eq!(unfold_origin(None, HitRect::default(), true), None);
    }

    #[test]
    fn the_hodey_key_folds_the_app_only_when_the_learner_is_in_it() {
        assert_eq!(toggle_action(true, false, true), Toggle::Fold);
        assert_eq!(toggle_action(true, false, false), Toggle::Show);
        assert_eq!(toggle_action(true, true, false), Toggle::Show);
        assert_eq!(toggle_action(false, false, false), Toggle::Show);
    }

    #[test]
    fn round_trips_between_window_and_screen_coordinates() {
        let rect = CssRect { x: 10.0, y: 4.0, width: 200.0, height: 40.0 };
        let screen = to_screen(rect, (660, 0), 1.5);
        assert_eq!(screen, CssRect { x: 675.0, y: 6.0, width: 300.0, height: 60.0 });
        assert_eq!(to_local(screen, (660, 0), 1.5), rect);
    }
}
