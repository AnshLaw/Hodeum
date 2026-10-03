use std::sync::Mutex;

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABE_LEFT, ABE_RIGHT, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::WM_APP;

use super::geometry::{Dock, PxRect};

/// Notification id for app-bar messages (we don't act on them; registration requires one).
const APPBAR_CALLBACK: u32 = WM_APP + 0x48;

/// The strip to propose to the shell for a side app bar of `width` on `monitor`.
pub fn proposed_rect(dock: Dock, monitor: PxRect, width: u32) -> PxRect {
    let x = match dock {
        Dock::Right => monitor.right() - width as i32,
        _ => monitor.x,
    };
    PxRect { x, y: monitor.y, width, height: monitor.height }
}

fn to_rect(r: PxRect) -> RECT {
    RECT { left: r.x, top: r.y, right: r.right(), bottom: r.bottom() }
}

fn from_rect(r: RECT) -> PxRect {
    PxRect { x: r.left, y: r.top, width: (r.right - r.left).max(0) as u32, height: (r.bottom - r.top).max(0) as u32 }
}

/// A Windows app bar: while registered, maximized windows shrink to sit beside the sidebar.
#[derive(Default)]
pub struct AppBar {
    registered: Mutex<Option<isize>>,
}

impl AppBar {
    /// Registers (once) and reserves a side strip; returns the rect the shell granted.
    pub fn reserve(&self, hwnd: isize, dock: Dock, monitor: PxRect, width: u32) -> Result<PxRect, String> {
        let mut registered = self.registered.lock().map_err(|e| e.to_string())?;
        let mut data = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: HWND(hwnd as *mut _),
            uCallbackMessage: APPBAR_CALLBACK,
            ..Default::default()
        };
        // SAFETY: `data` is a correctly sized APPBARDATA for a window owned by this process.
        unsafe {
            if registered.is_none() {
                if SHAppBarMessage(ABM_NEW, &mut data) == 0 {
                    return Err("Windows refused to reserve space for the sidebar.".into());
                }
                *registered = Some(hwnd);
            }
            data.uEdge = if dock == Dock::Right { ABE_RIGHT } else { ABE_LEFT };
            data.rc = to_rect(proposed_rect(dock, monitor, width));
            SHAppBarMessage(ABM_QUERYPOS, &mut data);
            // QUERYPOS may move the inner edge (e.g. for another app bar); restore our width from the outer edge.
            if dock == Dock::Right {
                data.rc.left = data.rc.right - width as i32;
            } else {
                data.rc.right = data.rc.left + width as i32;
            }
            SHAppBarMessage(ABM_SETPOS, &mut data);
        }
        Ok(from_rect(data.rc))
    }

    /// Gives the reserved space back. Safe to call when nothing is registered.
    pub fn release(&self) -> Result<(), String> {
        let mut registered = self.registered.lock().map_err(|e| e.to_string())?;
        if let Some(hwnd) = registered.take() {
            let mut data = APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: HWND(hwnd as *mut _), ..Default::default() };
            // SAFETY: as above; ABM_REMOVE only needs the size and window.
            unsafe { SHAppBarMessage(ABM_REMOVE, &mut data) };
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proposes_a_full_height_strip_on_the_chosen_edge() {
        let monitor = PxRect { x: 0, y: 0, width: 1920, height: 1080 };
        assert_eq!(proposed_rect(Dock::Left, monitor, 450), PxRect { x: 0, y: 0, width: 450, height: 1080 });
        assert_eq!(proposed_rect(Dock::Right, monitor, 450), PxRect { x: 1470, y: 0, width: 450, height: 1080 });
    }
}
