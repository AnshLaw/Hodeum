pub mod appbar;
pub mod geometry;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::surfaces::NOTCH;
use appbar::AppBar;
use geometry::{dock_rect, snap_dock, Dock, PxRect};

/// After the last move event, the drag is considered released.
const DRAG_SETTLE: Duration = Duration::from_millis(180);
/// A press that never moves the window isn't a drag.
const DRAG_GIVE_UP: Duration = Duration::from_secs(3);
const DRAG_POLL: Duration = Duration::from_millis(40);
const SNAPPED_EVENT: &str = "dock:snapped";

#[derive(Default)]
pub struct DockState {
    pub appbar: AppBar,
    dragging: AtomicBool,
    last_move: Mutex<Option<Instant>>,
}

#[derive(Clone, Serialize)]
struct Snapped {
    dock: Dock,
}

fn notch(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(NOTCH).ok_or_else(|| "notch window is missing".to_string())
}

fn monitor_rects(window: &WebviewWindow) -> Result<(PxRect, PxRect, f64), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "no monitor found".to_string())?;
    let full = PxRect { x: monitor.position().x, y: monitor.position().y, width: monitor.size().width, height: monitor.size().height };
    let area = monitor.work_area();
    let work = PxRect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
    Ok((full, work, monitor.scale_factor()))
}

fn place(window: &WebviewWindow, rect: PxRect) -> Result<(), String> {
    window.set_size(PhysicalSize::new(rect.width, rect.height)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())
}

/// Moves the notch window to a dock; side docks with `reserve` become an app bar.
#[tauri::command]
pub fn set_dock(app: AppHandle, dock: Dock, reserve: bool, state: State<'_, DockState>) -> Result<(), String> {
    state.dragging.store(false, Ordering::SeqCst);
    let window = notch(&app)?;
    let (full, work, scale) = monitor_rects(&window)?;
    if dock == Dock::Top || !reserve {
        state.appbar.release()?;
        return place(&window, dock_rect(dock, full, work, scale));
    }
    let width = dock_rect(dock, full, work, scale).width;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let granted = state.appbar.reserve(hwnd, dock, full, width)?;
    place(&window, granted)
}

#[tauri::command]
pub fn set_notch_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = notch(&app)?;
    if visible { window.show() } else { window.hide() }.map_err(|e| e.to_string())
}

/// Starts a native window drag; a watcher snaps to the nearest dock once movement settles.
#[tauri::command]
pub fn begin_notch_drag(app: AppHandle, state: State<'_, DockState>) -> Result<(), String> {
    *state.last_move.lock().map_err(|e| e.to_string())? = None;
    state.dragging.store(true, Ordering::SeqCst);
    notch(&app)?.start_dragging().map_err(|e| e.to_string())?;
    let handle = app.clone();
    thread::spawn(move || watch_drag(handle));
    Ok(())
}

/// Called from the window-event handler for every notch move.
pub fn on_notch_moved(app: &AppHandle) {
    let state = app.state::<DockState>();
    if state.dragging.load(Ordering::SeqCst) {
        if let Ok(mut last) = state.last_move.lock() {
            *last = Some(Instant::now());
        }
    }
}

fn watch_drag(app: AppHandle) {
    let started = Instant::now();
    loop {
        thread::sleep(DRAG_POLL);
        let state = app.state::<DockState>();
        if !state.dragging.load(Ordering::SeqCst) {
            return;
        }
        let last = state.last_move.lock().map(|l| *l).unwrap_or(None);
        match last {
            Some(moved) if moved.elapsed() >= DRAG_SETTLE => break,
            None if started.elapsed() >= DRAG_GIVE_UP => {
                state.dragging.store(false, Ordering::SeqCst);
                return;
            }
            _ => {}
        }
    }
    if let Err(error) = finish_drag(&app) {
        eprintln!("couldn't snap the notch after dragging: {error}");
    }
}

fn finish_drag(app: &AppHandle) -> Result<(), String> {
    app.state::<DockState>().dragging.store(false, Ordering::SeqCst);
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let (full, _, _) = monitor_rects(&notch(app)?)?;
    let dock = snap_dock(cursor.x, full);
    app.emit(SNAPPED_EVENT, Snapped { dock }).map_err(|e| e.to_string())
}
