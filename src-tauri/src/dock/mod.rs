pub mod appbar;
pub mod arrange;
pub mod geometry;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::surfaces::NOTCH;
use appbar::AppBar;
use arrange::Arranged;
use geometry::{dock_rect, snap_dock, top_rect, Dock, PxRect};

/// ~60 Hz: the window tracks the cursor smoothly while dragging.
const DRAG_POLL: Duration = Duration::from_millis(16);
const SNAPPED_EVENT: &str = "dock:snapped";

#[derive(Default)]
pub struct DockState {
    appbar: AppBar,
    arranged: Arranged,
    dragging: AtomicBool,
    /// Where the notch window is docked now.
    current: Mutex<Dock>,
    /// The iPhone mirror is open: the top notch window is tall enough to show the whole phone.
    tall: AtomicBool,
}

impl DockState {
    fn dock(&self) -> Result<Dock, String> {
        self.current.lock().map(|dock| *dock).map_err(|e| e.to_string())
    }

    fn set_current(&self, dock: Dock) -> Result<(), String> {
        *self.current.lock().map_err(|e| e.to_string())? = dock;
        Ok(())
    }

    /// Gives the sidebar's screen space back and returns moved windows to where they were.
    pub fn release_space(&self) -> Result<(), String> {
        self.appbar.release()?;
        self.arranged.restore()
    }
}

/// The work area left beside a granted sidebar strip.
pub fn free_beside(dock: Dock, work: PxRect, strip: PxRect) -> PxRect {
    match dock {
        Dock::Right => PxRect { x: work.x, width: (strip.x - work.x).max(0) as u32, ..work },
        _ => PxRect { x: strip.right(), width: (work.right() - strip.right()).max(0) as u32, ..work },
    }
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

/// Moves and resizes in one step, so the centred notch never jumps sideways between the two.
fn place_at_once(window: &WebviewWindow, rect: PxRect) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    arrange::set_rect(windows::Win32::Foundation::HWND(hwnd as *mut _), rect)
}

/// How long, and how often, to keep the window where we put it while the shell applies a work-area change.
const HOLD_FOR: Duration = Duration::from_millis(1500);
const HOLD_POLL: Duration = Duration::from_millis(40);

/// After the work area changes, Windows re-snaps full-height windows at a screen edge into the new
/// area a moment later, which would push the sidebar beside its own reserved strip. Put it back.
fn hold_position(app: AppHandle, rect: PxRect) {
    thread::spawn(move || {
        let Ok(window) = notch(&app) else { return };
        let started = std::time::Instant::now();
        while started.elapsed() < HOLD_FOR && !app.state::<DockState>().dragging.load(Ordering::SeqCst) {
            thread::sleep(HOLD_POLL);
            let moved = window.outer_position().is_ok_and(|p| (p.x, p.y) != (rect.x, rect.y));
            if moved {
                if let Err(error) = place(&window, rect) {
                    eprintln!("couldn't keep the sidebar in place: {error}");
                    return;
                }
            }
        }
    });
}

/// Moves the notch window to a dock; side docks with `reserve` become an app bar (copilot mode).
#[tauri::command]
pub fn set_dock(app: AppHandle, dock: Dock, reserve: bool, state: State<'_, DockState>) -> Result<(), String> {
    state.dragging.store(false, Ordering::SeqCst);
    state.set_current(dock)?;
    let window = notch(&app)?;
    if dock == Dock::Top || !reserve {
        state.release_space()?;
        // Read the work area only after giving our strip back, or we'd dock beside our own old reservation.
        let (full, work, scale) = monitor_rects(&window)?;
        let rect = if dock == Dock::Top { top_rect(state.tall.load(Ordering::SeqCst), full, work, scale) } else { dock_rect(dock, full, work, scale) };
        place(&window, rect)?;
        hold_position(app.clone(), rect);
        return Ok(());
    }
    let (full, work, scale) = monitor_rects(&window)?;
    let width = dock_rect(dock, full, work, scale).width;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let granted = state.appbar.reserve(hwnd, dock, full, width)?;
    place(&window, granted)?;
    // Copilot: maximized windows reflow on their own; move normal ones that overlap the sidebar.
    let strip = PxRect { y: work.y, height: work.height, ..granted };
    hold_position(app.clone(), granted);
    state.arranged.make_room(strip, free_beside(dock, work, strip))
}

/// Grows the top notch window to hold the whole iPhone mirror, or shrinks it back once the mirror's
/// closing animation is done. Side docks already span the work area and keep their size.
#[tauri::command]
pub fn set_notch_tall(app: AppHandle, tall: bool, state: State<'_, DockState>) -> Result<(), String> {
    state.tall.store(tall, Ordering::SeqCst);
    if state.dock()? != Dock::Top || state.dragging.load(Ordering::SeqCst) {
        return Ok(());
    }
    let window = notch(&app)?;
    let (full, work, scale) = monitor_rects(&window)?;
    place_at_once(&window, top_rect(tall, full, work, scale))
}

#[tauri::command]
pub fn set_notch_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let window = notch(&app)?;
    if visible { window.show() } else { window.hide() }.map_err(|e| e.to_string())
}

fn left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    // SAFETY: GetAsyncKeyState has no preconditions; the high bit means "currently pressed".
    (unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON.0)) } as u16 & 0x8000) != 0
}

/// Moves the notch with the cursor while the left button is held, then snaps to the nearest dock.
/// Done by hand because Windows' modal move loop ignores this undecorated, non-activating window.
#[tauri::command]
pub fn begin_notch_drag(app: AppHandle, state: State<'_, DockState>) -> Result<(), String> {
    if state.dragging.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let window = notch(&app)?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let origin = window.outer_position().map_err(|e| e.to_string())?;
    let grab = (cursor.x - f64::from(origin.x), cursor.y - f64::from(origin.y));
    let handle = app.clone();
    thread::spawn(move || follow_cursor(handle, grab));
    Ok(())
}

fn follow_cursor(app: AppHandle, grab: (f64, f64)) {
    let result = (|| -> Result<(), String> {
        let window = notch(&app)?;
        while left_button_down() && app.state::<DockState>().dragging.load(Ordering::SeqCst) {
            let cursor = app.cursor_position().map_err(|e| e.to_string())?;
            let position = PhysicalPosition::new((cursor.x - grab.0).round() as i32, (cursor.y - grab.1).round() as i32);
            window.set_position(position).map_err(|e| e.to_string())?;
            thread::sleep(DRAG_POLL);
        }
        finish_drag(&app)
    })();
    if let Err(error) = result {
        app.state::<DockState>().dragging.store(false, Ordering::SeqCst);
        eprintln!("couldn't drag the notch: {error}");
    }
}

fn finish_drag(app: &AppHandle) -> Result<(), String> {
    app.state::<DockState>().dragging.store(false, Ordering::SeqCst);
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let (full, _, _) = monitor_rects(&notch(app)?)?;
    let dock = snap_dock(cursor.x, full);
    app.emit(SNAPPED_EVENT, Snapped { dock }).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: PxRect = PxRect { x: 0, y: 0, width: 1920, height: 1040 };

    #[test]
    fn leaves_the_rest_of_the_work_area_beside_the_sidebar() {
        let left = PxRect { x: 0, y: 0, width: 360, height: 1040 };
        assert_eq!(free_beside(Dock::Left, WORK, left), PxRect { x: 360, y: 0, width: 1560, height: 1040 });
        let right = PxRect { x: 1560, y: 0, width: 360, height: 1040 };
        assert_eq!(free_beside(Dock::Right, WORK, right), PxRect { x: 0, y: 0, width: 1560, height: 1040 });
    }
}
