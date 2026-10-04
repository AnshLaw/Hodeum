use serde::{Deserialize, Serialize};

/// Mirrors `Dock` in `src/features/dock/dock.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Dock {
    #[default]
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
/// Logical width of the top notch window while it holds the iPhone mirror beside Hodey's guidance.
/// Fits the largest phone panel `src/components/notch/phone-layout.ts` lays out.
pub const PHONE_NOTCH_WIDTH: f64 = 840.0;
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

/// The top notch window while the iPhone mirror is open: wider, and reaching the bottom of the work
/// area so the whole phone fits. The extra space is click-through like the rest of the window.
pub fn tall_notch_rect(monitor: PxRect, work: PxRect, scale: f64) -> PxRect {
    let width = scaled(PHONE_NOTCH_WIDTH, scale).min(monitor.width);
    let offset = monitor.width.saturating_sub(width) / 2;
    let to_work_bottom = (work.bottom() - monitor.y).max(0) as u32;
    let height = to_work_bottom.max(scaled(NOTCH_WINDOW.1, scale));
    PxRect { x: monitor.x + offset as i32, y: monitor.y, width, height }
}

/// The top dock's window rect, tall while the iPhone mirror is open.
pub fn top_rect(tall: bool, monitor: PxRect, work: PxRect, scale: f64) -> PxRect {
    if tall {
        tall_notch_rect(monitor, work, scale)
    } else {
        dock_rect(Dock::Top, monitor, work, scale)
    }
}

/// Where the notch window goes back to when it's docked at the top but isn't there (a drop, a show, a
/// style, size or DPI change moved it). `None` when it's already home, and always for side docks.
pub fn reanchor_top(dock: Dock, tall: bool, current: PxRect, monitor: PxRect, work: PxRect, scale: f64) -> Option<PxRect> {
    if dock != Dock::Top {
        return None;
    }
    let home = top_rect(tall, monitor, work, scale);
    (current != home).then_some(home)
}

/// What finishing a drag does with the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropAction {
    /// Dropped back into the dock it came from: the UI sees no change of dock and never re-places
    /// the window, so the shell puts it back itself.
    ReturnHome,
    /// Dropped into a new dock: the UI owns that preference and moves the window there.
    Redock,
}

pub fn drop_action(previous: Dock, snapped: Dock) -> DropAction {
    if previous == snapped {
        DropAction::ReturnHome
    } else {
        DropAction::Redock
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
    fn tall_notch_is_wider_centred_and_reaches_the_work_area_bottom() {
        assert_eq!(tall_notch_rect(MONITOR, WORK, 1.25), PxRect { x: 1920 + 675, y: 0, width: 1050, height: 1540 });
        assert_eq!(top_rect(true, MONITOR, WORK, 1.25), tall_notch_rect(MONITOR, WORK, 1.25));
        assert_eq!(top_rect(false, MONITOR, WORK, 1.25), dock_rect(Dock::Top, MONITOR, WORK, 1.25));
    }

    #[test]
    fn tall_notch_stays_on_a_small_monitor() {
        let monitor = PxRect { x: 0, y: 0, width: 800, height: 600 };
        let work = PxRect { x: 0, y: 0, width: 800, height: 560 };
        // Never narrower than the monitor allows, never shorter than the normal notch window.
        assert_eq!(tall_notch_rect(monitor, work, 1.0), PxRect { x: 0, y: 0, width: 800, height: 620 });
    }

    #[test]
    fn snaps_by_thirds() {
        assert_eq!(snap_dock(1920.0 + 100.0, MONITOR), Dock::Left);
        assert_eq!(snap_dock(1920.0 + 1200.0, MONITOR), Dock::Top);
        assert_eq!(snap_dock(1920.0 + 2300.0, MONITOR), Dock::Right);
    }

    #[test]
    fn a_drop_back_into_the_same_dock_is_placed_natively() {
        // The UI only re-places the window when its dock preference changes, so it never would.
        assert_eq!(drop_action(Dock::Top, Dock::Top), DropAction::ReturnHome);
        assert_eq!(drop_action(Dock::Left, Dock::Left), DropAction::ReturnHome);
        assert_eq!(drop_action(Dock::Top, Dock::Right), DropAction::Redock);
        assert_eq!(drop_action(Dock::Right, Dock::Top), DropAction::Redock);
    }

    #[test]
    fn a_top_notch_left_mid_screen_goes_back_to_the_top_centre() {
        let mid_screen = PxRect { x: 1920 + 825, y: 400, width: 750, height: 775 };
        let home = dock_rect(Dock::Top, MONITOR, WORK, 1.25);
        assert_eq!(reanchor_top(Dock::Top, false, mid_screen, MONITOR, WORK, 1.25), Some(home));
    }

    #[test]
    fn a_top_notch_still_tall_after_the_phone_closed_shrinks_back() {
        let tall = tall_notch_rect(MONITOR, WORK, 1.25);
        assert_eq!(reanchor_top(Dock::Top, false, tall, MONITOR, WORK, 1.25), Some(dock_rect(Dock::Top, MONITOR, WORK, 1.25)));
        assert_eq!(reanchor_top(Dock::Top, true, tall, MONITOR, WORK, 1.25), None);
    }

    #[test]
    fn a_top_notch_after_a_dpi_change_is_resized_for_the_new_scale() {
        let at_old_scale = dock_rect(Dock::Top, MONITOR, WORK, 1.0);
        assert_eq!(reanchor_top(Dock::Top, false, at_old_scale, MONITOR, WORK, 1.5), Some(dock_rect(Dock::Top, MONITOR, WORK, 1.5)));
    }

    #[test]
    fn leaves_a_top_notch_in_place_and_never_moves_a_sidebar() {
        let home = dock_rect(Dock::Top, MONITOR, WORK, 1.25);
        assert_eq!(reanchor_top(Dock::Top, false, home, MONITOR, WORK, 1.25), None);
        let anywhere = PxRect { x: 2500, y: 300, width: 450, height: 1540 };
        assert_eq!(reanchor_top(Dock::Left, false, anywhere, MONITOR, WORK, 1.25), None);
        assert_eq!(reanchor_top(Dock::Right, false, anywhere, MONITOR, WORK, 1.25), None);
    }
}
