//! The overlay covers the monitor the learner's window is on and moves when that changes, so guidance
//! can be drawn over any app on any screen. Physical px throughout; once told it moved
//! (`overlay:moved`), the overlay page re-reads its monitor's origin and scale (`monitor_info`) and
//! converts to its own CSS px with them (`toOverlay` in src/lib/coords.ts).

use std::cmp::Reverse;

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, SetWindowPos, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
};

use crate::dock::geometry::PxRect;

/// Moving onto a monitor with another scale makes the window resize itself for the new DPI on the way
/// (WM_DPICHANGED), so where it landed is read back and set again: the second try fits.
const PLACE_ATTEMPTS: usize = 3;
/// Position and size only: z-order, activation and visibility are left alone.
const PLACE_FLAGS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS(SWP_NOZORDER.0 | SWP_NOACTIVATE.0 | SWP_NOOWNERZORDER.0);

fn rect_of(r: RECT) -> PxRect {
    PxRect { x: r.left, y: r.top, width: (r.right - r.left).max(0) as u32, height: (r.bottom - r.top).max(0) as u32 }
}

fn overlap_area(a: PxRect, b: PxRect) -> i64 {
    let width = i64::from(a.right().min(b.right())) - i64::from(a.x.max(b.x));
    let height = i64::from(a.bottom().min(b.bottom())) - i64::from(a.y.max(b.y));
    width.max(0) * height.max(0)
}

/// The squared gap between two rects; 0 when they touch or overlap.
fn gap_sq(a: PxRect, b: PxRect) -> i64 {
    let dx = (i64::from(b.x) - i64::from(a.right())).max(i64::from(a.x) - i64::from(b.right())).max(0);
    let dy = (i64::from(b.y) - i64::from(a.bottom())).max(i64::from(a.y) - i64::from(b.bottom())).max(0);
    dx * dx + dy * dy
}

/// The monitor the overlay should cover for a learner window at `window`: the one showing most of it,
/// else the nearest one, the rule Windows itself uses (MonitorFromRect, MONITOR_DEFAULTTONEAREST). The
/// first of equals wins. None only without monitors.
pub fn monitor_for(window: PxRect, monitors: &[PxRect]) -> Option<PxRect> {
    let most = monitors.iter().copied().min_by_key(|&monitor| Reverse(overlap_area(window, monitor)))?;
    if overlap_area(window, most) > 0 {
        return Some(most);
    }
    monitors.iter().copied().min_by_key(|&monitor| gap_sq(window, monitor))
}

unsafe extern "system" fn collect_monitor(_monitor: HMONITOR, _dc: HDC, rect: *mut RECT, found: LPARAM) -> BOOL {
    // SAFETY: `found` is the Vec monitor_rects passes in, alive for the whole enumeration, and `rect` is
    // this monitor's rect for the duration of the call.
    unsafe { (*(found.0 as *mut Vec<PxRect>)).push(rect_of(*rect)) };
    BOOL(1)
}

/// Every monitor's full rect (not just its work area), physical px.
pub fn monitor_rects() -> Result<Vec<PxRect>, String> {
    let mut found: Vec<PxRect> = Vec::new();
    let into = LPARAM(&mut found as *mut Vec<PxRect> as isize);
    // SAFETY: the callback only pushes onto `found`, which outlives the call.
    if !unsafe { EnumDisplayMonitors(None, None, Some(collect_monitor), into) }.as_bool() {
        return Err(format!("couldn't list the monitors: {}", windows::core::Error::from_thread()));
    }
    Ok(found)
}

fn window_rect(hwnd: HWND) -> Result<PxRect, String> {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid out-parameter; a stale handle simply fails.
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| format!("couldn't read where the overlay is: {e}"))?;
    Ok(rect_of(rect))
}

fn set_rect(hwnd: HWND, rect: PxRect) -> Result<(), String> {
    // SAFETY: a stale handle simply fails. Like `zorder::raise`, safe from a thread holding no lock the
    // window's UI thread could be waiting on.
    unsafe { SetWindowPos(hwnd, None, rect.x, rect.y, rect.width as i32, rect.height as i32, PLACE_FLAGS) }
        .map_err(|e| format!("couldn't move the overlay: {e}"))
}

/// Moves and sizes `overlay` to cover `monitor` exactly; Ok(true) when it had to move.
pub fn cover(overlay: HWND, monitor: PxRect) -> Result<bool, String> {
    if window_rect(overlay)? == monitor {
        return Ok(false);
    }
    for _ in 0..PLACE_ATTEMPTS {
        set_rect(overlay, monitor)?;
        if window_rect(overlay)? == monitor {
            return Ok(true);
        }
    }
    Err(format!("the overlay didn't settle on the monitor at {monitor:?} in {PLACE_ATTEMPTS} tries"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1920x1080 primary at 100 % and, to its left and a little higher, a 2560x1440 monitor at 125 %.
    const PRIMARY: PxRect = PxRect { x: 0, y: 0, width: 1920, height: 1080 };
    const LEFT: PxRect = PxRect { x: -2560, y: -360, width: 2560, height: 1440 };
    const MONITORS: [PxRect; 2] = [PRIMARY, LEFT];

    #[test]
    fn covers_the_monitor_the_learners_window_is_on() {
        let on_left = PxRect { x: -2000, y: 0, width: 1200, height: 800 };
        assert_eq!(monitor_for(on_left, &MONITORS), Some(LEFT));
        let on_primary = PxRect { x: 200, y: 100, width: 1200, height: 800 };
        assert_eq!(monitor_for(on_primary, &MONITORS), Some(PRIMARY));
    }

    #[test]
    fn a_window_across_two_monitors_goes_with_its_larger_part() {
        let mostly_primary = PxRect { x: -300, y: 100, width: 1200, height: 800 };
        assert_eq!(monitor_for(mostly_primary, &MONITORS), Some(PRIMARY));
        let mostly_left = PxRect { x: -900, y: 100, width: 1200, height: 800 };
        assert_eq!(monitor_for(mostly_left, &MONITORS), Some(LEFT));
    }

    #[test]
    fn a_maximized_window_stays_on_its_own_monitor() {
        // Its visible frame is the work area, flush against the neighbouring monitor.
        let maximized = PxRect { x: 0, y: 0, width: 1920, height: 1032 };
        assert_eq!(monitor_for(maximized, &MONITORS), Some(PRIMARY));
    }

    #[test]
    fn a_window_off_every_monitor_goes_to_the_nearest() {
        let below_primary = PxRect { x: 500, y: 1500, width: 400, height: 300 };
        assert_eq!(monitor_for(below_primary, &MONITORS), Some(PRIMARY));
        let far_left = PxRect { x: -4000, y: 0, width: 400, height: 300 };
        assert_eq!(monitor_for(far_left, &MONITORS), Some(LEFT));
    }

    #[test]
    fn no_monitor_no_choice() {
        assert_eq!(monitor_for(PRIMARY, &[]), None);
    }
}

#[cfg(test)]
mod desktop_tests {
    //! Against this PC's monitors and a real window (invisible and off-screen, see `test_windows`).
    use super::*;
    use crate::topmost::test_windows::{patch, TestWindow};

    #[test]
    fn lists_this_pcs_monitors_with_the_primary_at_the_origin() {
        let monitors = monitor_rects().expect("monitors");
        assert!(monitors.iter().any(|m| m.x == 0 && m.y == 0 && m.width > 0 && m.height > 0), "{monitors:?}");
    }

    #[test]
    fn covers_a_monitor_exactly_and_only_moves_when_it_has_to() {
        let overlay = TestWindow::new(patch(5, 0, 0, 800, 600), None);
        let monitor = patch(5, 100, 50, 1200, 700);
        assert_eq!(cover(overlay.0, monitor), Ok(true));
        assert_eq!(cover(overlay.0, monitor), Ok(false), "already there");
    }
}
