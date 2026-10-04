//! Copilot mode: windows overlapping the sidebar's strip move aside, and move back when it closes.

use std::sync::Mutex;

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, IsIconic, IsZoomed, SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
};

use super::geometry::PxRect;
use crate::chat_context::app_windows;

/// Where a window sits once moved out of the way: shifted into `free`, and narrowed only if it can't fit.
/// `None` when it doesn't overlap `strip` and can stay put.
pub fn fit_beside(window: PxRect, strip: PxRect, free: PxRect) -> Option<PxRect> {
    let overlaps = window.x < strip.right() && window.right() > strip.x && window.y < strip.bottom() && window.bottom() > strip.y;
    if !overlaps {
        return None;
    }
    let width = window.width.min(free.width);
    let x = window.x.clamp(free.x, free.right() - width as i32);
    Some(PxRect { x, width, ..window })
}

/// The visible frame inside a window rect (Windows 10+ adds invisible resize borders), as insets.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Insets {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

fn rect_of(r: RECT) -> PxRect {
    PxRect { x: r.left, y: r.top, width: (r.right - r.left).max(0) as u32, height: (r.bottom - r.top).max(0) as u32 }
}

fn outer_and_insets(hwnd: HWND) -> Option<(PxRect, Insets)> {
    let mut outer = RECT::default();
    let mut visible = RECT::default();
    // SAFETY: both RECTs are valid out-parameters of the size passed.
    unsafe {
        GetWindowRect(hwnd, &mut outer).ok()?;
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, (&mut visible as *mut RECT).cast(), std::mem::size_of::<RECT>() as u32).is_err() {
            visible = outer;
        }
    }
    let insets = Insets { left: visible.left - outer.left, top: visible.top - outer.top, right: outer.right - visible.right, bottom: outer.bottom - visible.bottom };
    Some((rect_of(visible), insets))
}

fn outer_rect(visible: PxRect, insets: Insets) -> PxRect {
    PxRect {
        x: visible.x - insets.left,
        y: visible.y - insets.top,
        width: (visible.width as i32 + insets.left + insets.right).max(0) as u32,
        height: (visible.height as i32 + insets.top + insets.bottom).max(0) as u32,
    }
}

pub(super) fn set_rect(hwnd: HWND, r: PxRect) -> Result<(), String> {
    // SAFETY: a stale handle simply fails; no z-order or activation change.
    unsafe { SetWindowPos(hwnd, None, r.x, r.y, r.width as i32, r.height as i32, SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER) }
        .map_err(|e| e.to_string())
}

/// Other apps' normal (not maximized or minimized) windows.
fn movable_windows() -> Result<Vec<HWND>, String> {
    // SAFETY: IsZoomed / IsIconic tolerate any handle.
    Ok(app_windows()?.into_iter().filter(|&h| !unsafe { IsZoomed(h) }.as_bool() && !unsafe { IsIconic(h) }.as_bool()).collect())
}

struct Moved {
    hwnd: isize,
    original: PxRect,
    placed: PxRect,
}

/// Windows moved for the sidebar, so they can go back where the learner had them.
#[derive(Default)]
pub struct Arranged(Mutex<Vec<Moved>>);

impl Arranged {
    /// Moves every window overlapping `strip` into `free`, remembering where each one was.
    pub fn make_room(&self, strip: PxRect, free: PxRect) -> Result<(), String> {
        let mut moved = self.0.lock().map_err(|e| e.to_string())?;
        for hwnd in movable_windows()? {
            let Some((visible, insets)) = outer_and_insets(hwnd) else { continue };
            let Some(target) = fit_beside(visible, strip, free) else { continue };
            let placed = outer_rect(target, insets);
            if let Err(error) = set_rect(hwnd, placed) {
                eprintln!("couldn't move a window aside for the sidebar: {error}");
                continue;
            }
            let id = hwnd.0 as isize;
            match moved.iter_mut().find(|m| m.hwnd == id) {
                Some(entry) => entry.placed = placed,
                None => moved.push(Moved { hwnd: id, original: outer_rect(visible, insets), placed }),
            }
        }
        Ok(())
    }

    /// Puts moved windows back, except any the learner has moved or resized since.
    pub fn restore(&self) -> Result<(), String> {
        let moved = std::mem::take(&mut *self.0.lock().map_err(|e| e.to_string())?);
        for entry in moved {
            let hwnd = HWND(entry.hwnd as *mut _);
            let Some((visible, insets)) = outer_and_insets(hwnd) else { continue };
            if should_restore(outer_rect(visible, insets), entry.placed) {
                if let Err(error) = set_rect(hwnd, entry.original) {
                    eprintln!("couldn't put a window back after the sidebar closed: {error}");
                }
            }
        }
        Ok(())
    }
}

/// Only windows still exactly where Hodeum put them go back; anything else the learner chose.
pub fn should_restore(current: PxRect, placed: PxRect) -> bool {
    current == placed
}

#[cfg(test)]
mod tests {
    use super::*;

    const STRIP: PxRect = PxRect { x: 0, y: 0, width: 360, height: 1040 };
    const FREE: PxRect = PxRect { x: 360, y: 0, width: 1560, height: 1040 };

    #[test]
    fn leaves_windows_clear_of_the_sidebar_alone() {
        assert_eq!(fit_beside(PxRect { x: 400, y: 100, width: 800, height: 600 }, STRIP, FREE), None);
    }

    #[test]
    fn slides_overlapping_windows_over_keeping_their_size() {
        let moved = fit_beside(PxRect { x: 100, y: 100, width: 800, height: 600 }, STRIP, FREE);
        assert_eq!(moved, Some(PxRect { x: 360, y: 100, width: 800, height: 600 }));
    }

    #[test]
    fn narrows_windows_too_wide_for_the_rest_of_the_screen() {
        let moved = fit_beside(PxRect { x: 0, y: 0, width: 1900, height: 1000 }, STRIP, FREE);
        assert_eq!(moved, Some(PxRect { x: 360, y: 0, width: 1560, height: 1000 }));
    }

    #[test]
    fn works_for_a_right_hand_sidebar() {
        let strip = PxRect { x: 1560, y: 0, width: 360, height: 1040 };
        let free = PxRect { x: 0, y: 0, width: 1560, height: 1040 };
        let moved = fit_beside(PxRect { x: 1200, y: 50, width: 600, height: 400 }, strip, free);
        assert_eq!(moved, Some(PxRect { x: 960, y: 50, width: 600, height: 400 }));
    }

    #[test]
    fn restores_only_untouched_windows() {
        let placed = PxRect { x: 360, y: 100, width: 800, height: 600 };
        assert!(should_restore(placed, placed));
        assert!(!should_restore(PxRect { x: 500, ..placed }, placed));
    }
}
