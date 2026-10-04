use serde::{Deserialize, Serialize};

/// Mirrors `Dock` in `src/features/dock/dock.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dock {
    Top,
    Left,
    Right,
}

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PxRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl PxRect {
    pub fn right(&self) -> i32 {
        self.x + self.width as i32
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.height as i32
    }
}

/// Logical size of the top notch window; the pill animates inside it. Tall enough for the iPhone mirror panel.
pub const NOTCH_WINDOW: (f64, f64) = (600.0, 620.0);
/// Logical width of the side sidebar window.
pub const SIDEBAR_WIDTH: f64 = 360.0;
/// Drops in the outer thirds of the monitor dock to that side; the middle docks to the top.
const SIDE_ZONE: f64 = 1.0 / 3.0;

fn scaled(logical: f64, scale: f64) -> u32 {
    (logical * scale).round() as u32
}

/// Window rect for a dock. Top is centred on the full monitor; sides fill the work area height.
pub fn dock_rect(dock: Dock, monitor: PxRect, work: PxRect, scale: f64) -> PxRect {
    match dock {
        Dock::Top => {
            let width = scaled(NOTCH_WINDOW.0, scale);
            let offset = monitor.width.saturating_sub(width) / 2;
            PxRect { x: monitor.x + offset as i32, y: monitor.y, width, height: scaled(NOTCH_WINDOW.1, scale) }
        }
        Dock::Left => PxRect { x: work.x, y: work.y, width: scaled(SIDEBAR_WIDTH, scale), height: work.height },
        Dock::Right => {
            let width = scaled(SIDEBAR_WIDTH, scale);
            PxRect { x: work.right() - width as i32, y: work.y, width, height: work.height }
        }
    }
}

/// Which dock a drag released at `cursor_x` should snap to.
pub fn snap_dock(cursor_x: f64, monitor: PxRect) -> Dock {
    let ratio = (cursor_x - f64::from(monitor.x)) / f64::from(monitor.width);
    if ratio < SIDE_ZONE {
        Dock::Left
    } else if ratio > 1.0 - SIDE_ZONE {
        Dock::Right
    } else {
        Dock::Top
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: PxRect = PxRect { x: 1920, y: 0, width: 2400, height: 1600 };
    const WORK: PxRect = PxRect { x: 1920, y: 0, width: 2400, height: 1540 };

    #[test]
    fn centres_the_notch_on_the_full_monitor() {
        assert_eq!(dock_rect(Dock::Top, MONITOR, WORK, 1.25), PxRect { x: 1920 + 825, y: 0, width: 750, height: 775 });
    }

    #[test]
    fn sidebars_fill_the_work_area_height_on_their_edge() {
        assert_eq!(dock_rect(Dock::Left, MONITOR, WORK, 1.25), PxRect { x: 1920, y: 0, width: 450, height: 1540 });
        assert_eq!(dock_rect(Dock::Right, MONITOR, WORK, 1.25), PxRect { x: 1920 + 2400 - 450, y: 0, width: 450, height: 1540 });
    }

    #[test]
    fn snaps_by_thirds() {
        assert_eq!(snap_dock(1920.0 + 100.0, MONITOR), Dock::Left);
        assert_eq!(snap_dock(1920.0 + 1200.0, MONITOR), Dock::Top);
        assert_eq!(snap_dock(1920.0 + 2300.0, MONITOR), Dock::Right);
    }
}
