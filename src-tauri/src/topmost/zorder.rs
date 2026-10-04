//! Where the notch and overlay sit in the z-order, and putting them back at the top of the topmost
//! band. Only the z-order changes here: nothing is moved, resized, shown, hidden or activated.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetWindow, GetWindowLongPtrW, IsIconic, IsWindowVisible, SetWindowPos, GA_ROOTOWNER, GWL_EXSTYLE, GW_HWNDPREV,
    HWND_TOPMOST, SET_WINDOW_POS_FLAGS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, WS_EX_TOPMOST,
};

use super::px_rect;
use crate::dock::geometry::PxRect;
use crate::perception::window_watch::window_frame;

/// Z-order only: no move, no resize, no activation, any owner left where it is, and never
/// SWP_SHOWWINDOW, so a notch the learner hid stays hidden.
pub const RAISE_FLAGS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS(SWP_NOMOVE.0 | SWP_NOSIZE.0 | SWP_NOACTIVATE.0 | SWP_NOOWNERZORDER.0);
/// Most windows read above one surface. The topmost band rarely holds more than a few dozen; this only
/// bounds a walk that a z-order changing underneath it could stretch.
const MAX_WALK: usize = 1024;

/// A window above one of our surfaces, as far as covering it goes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Above {
    pub hwnd: isize,
    /// Its visible frame, physical px.
    pub rect: PxRect,
    /// Drawn on screen: visible, not minimized and not cloaked.
    pub shown: bool,
    pub topmost: bool,
    /// The top of its owner chain; itself when nothing owns it.
    pub root_owner: isize,
}

/// What a look at the z-order found.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Survey {
    /// A surface dropped out of the topmost band, so any window can come over it.
    pub lost_topmost: bool,
    /// The overlay is above the notch, where it could take the notch's clicks.
    pub out_of_order: bool,
    /// Windows covering part of a shown surface.
    pub coverers: Vec<isize>,
}

pub fn overlaps(a: PxRect, b: PxRect) -> bool {
    a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom()
}

/// The windows in `above` (all above a surface at `surface`) that cover part of it: shown, topmost and
/// not ours. `ours` are our surfaces; windows they own (a dropdown) belong above them.
pub fn coverers(surface: PxRect, ours: &[isize], above: &[Above]) -> Vec<isize> {
    let ours_or_owned = |window: &Above| ours.contains(&window.hwnd) || ours.contains(&window.root_owner);
    above
        .iter()
        .filter(|window| window.shown && window.topmost && !ours_or_owned(window) && overlaps(surface, window.rect))
        .map(|window| window.hwnd)
        .collect()
}

/// Whether putting the surfaces back on top would change anything: always when they left the topmost
/// band or swapped places, otherwise only for a covering window that a re-assert hasn't already failed
/// to get above (`unbeatable`: Start, the touch keyboard or Magnifier sit in higher z-bands).
pub fn worth_reasserting(survey: &Survey, unbeatable: &[isize]) -> bool {
    survey.lost_topmost || survey.out_of_order || survey.coverers.iter().any(|hwnd| !unbeatable.contains(hwnd))
}

/// Every window above `hwnd` in the z-order, nearest first.
pub fn windows_above(hwnd: HWND) -> Vec<HWND> {
    let mut above = Vec::new();
    let mut current = hwnd;
    while above.len() < MAX_WALK {
        // SAFETY: GetWindow tolerates stale handles. Past the top of the z-order it returns null (an
        // Err here), which is where the walk ends.
        let Ok(previous) = (unsafe { GetWindow(current, GW_HWNDPREV) }) else { break };
        if previous.is_invalid() {
            break;
        }
        above.push(previous);
        current = previous;
    }
    above
}

pub fn is_topmost(hwnd: HWND) -> bool {
    // SAFETY: reading a window's extended style has no preconditions.
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    style & WS_EX_TOPMOST.0 != 0
}

/// Cloaked windows (a suspended Store app, the hidden touch keyboard) count as visible but aren't drawn.
/// One that DWM can't say about counts as drawn.
fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let size = std::mem::size_of::<u32>() as u32;
    // SAFETY: `cloaked` is a valid out-parameter of the size passed; a stale handle simply fails.
    let read = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), size) };
    read.is_ok() && cloaked != 0
}

fn is_shown(hwnd: HWND) -> bool {
    // SAFETY: both tolerate stale handles.
    let visible = unsafe { IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() };
    visible && !is_cloaked(hwnd)
}

fn frame(hwnd: HWND) -> Option<PxRect> {
    window_frame(hwnd).map(|window| px_rect(&window.bounds))
}

fn describe(hwnd: HWND) -> Option<Above> {
    Some(Above {
        hwnd: hwnd.0 as isize,
        rect: frame(hwnd)?,
        shown: is_shown(hwnd),
        topmost: is_topmost(hwnd),
        // SAFETY: GetAncestor tolerates stale handles.
        root_owner: unsafe { GetAncestor(hwnd, GA_ROOTOWNER) }.0 as isize,
    })
}

/// The windows covering `surface`; none while it's hidden.
fn covering(surface: HWND, ours: &[isize]) -> Vec<isize> {
    let Some(rect) = frame(surface).filter(|_| is_shown(surface)) else { return Vec::new() };
    let above: Vec<Above> = windows_above(surface).into_iter().filter_map(describe).collect();
    coverers(rect, ours, &above)
}

/// Reads where the surfaces stand: `overlay` belongs just under `notch`, both above everything else.
pub fn survey(overlay: HWND, notch: HWND) -> Survey {
    let out_of_order = windows_above(notch).contains(&overlay);
    if !is_topmost(overlay) || !is_topmost(notch) {
        // Any window can come over it now, and putting it back fixes that whatever covers it.
        return Survey { lost_topmost: true, out_of_order, coverers: Vec::new() };
    }
    let ours = [overlay.0 as isize, notch.0 as isize];
    let mut coverers = covering(overlay, &ours);
    for hwnd in covering(notch, &ours) {
        if !coverers.contains(&hwnd) {
            coverers.push(hwnd);
        }
    }
    Survey { lost_topmost: false, out_of_order, coverers }
}

/// Puts `hwnd` at the top of the topmost band. Safe from any thread: SetWindowPos waits while the
/// window's own (UI) thread applies the change, and callers hold no lock that thread could need.
pub fn raise(hwnd: HWND) -> windows::core::Result<()> {
    // SAFETY: a stale handle simply fails; z-order only (RAISE_FLAGS).
    unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, RAISE_FLAGS) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::SWP_SHOWWINDOW;

    const SURFACE: PxRect = PxRect { x: 0, y: 0, width: 1920, height: 1080 };
    const NOTCH: isize = 2;
    const OVERLAY: isize = 1;
    const OURS: [isize; 2] = [OVERLAY, NOTCH];

    fn above(hwnd: isize, rect: PxRect) -> Above {
        Above { hwnd, rect, shown: true, topmost: true, root_owner: hwnd }
    }

    #[test]
    fn rects_overlap_only_when_they_share_pixels() {
        let a = PxRect { x: 0, y: 0, width: 10, height: 10 };
        assert!(overlaps(a, PxRect { x: 5, y: 5, width: 10, height: 10 }));
        assert!(!overlaps(a, PxRect { x: 10, y: 0, width: 10, height: 10 }), "touching edges");
        assert!(!overlaps(a, PxRect { x: -20, y: -20, width: 5, height: 5 }));
    }

    #[test]
    fn a_shown_topmost_window_over_the_surface_covers_it() {
        let menu = above(7, PxRect { x: 100, y: 100, width: 200, height: 300 });
        assert_eq!(coverers(SURFACE, &OURS, &[menu]), vec![7]);
    }

    #[test]
    fn hidden_cloaked_minimized_or_elsewhere_windows_do_not_cover() {
        let hidden = Above { shown: false, ..above(7, SURFACE) };
        let elsewhere = above(8, PxRect { x: 1920, y: 0, width: 1920, height: 1080 });
        assert!(coverers(SURFACE, &OURS, &[hidden, elsewhere]).is_empty());
    }

    #[test]
    fn our_own_surfaces_and_their_popups_belong_above() {
        let notch = above(NOTCH, SURFACE);
        let dropdown = Above { root_owner: NOTCH, ..above(9, SURFACE) };
        assert!(coverers(SURFACE, &OURS, &[notch, dropdown]).is_empty());
    }

    #[test]
    fn a_window_above_that_is_not_topmost_is_left_to_the_lost_topmost_check() {
        let normal = Above { topmost: false, ..above(7, SURFACE) };
        assert!(coverers(SURFACE, &OURS, &[normal]).is_empty());
    }

    #[test]
    fn reasserts_when_covered_dropped_from_the_topmost_band_or_out_of_order() {
        let covered = Survey { coverers: vec![7], ..Survey::default() };
        assert!(worth_reasserting(&covered, &[]));
        assert!(worth_reasserting(&Survey { lost_topmost: true, ..Survey::default() }, &[]));
        assert!(worth_reasserting(&Survey { out_of_order: true, ..Survey::default() }, &[]));
        assert!(!worth_reasserting(&Survey::default(), &[]), "nothing to fix");
    }

    #[test]
    fn does_not_keep_retrying_a_window_it_could_not_get_above() {
        let start_menu = Survey { coverers: vec![7], ..Survey::default() };
        assert!(!worth_reasserting(&start_menu, &[7]));
        let and_a_new_one = Survey { coverers: vec![7, 8], ..Survey::default() };
        assert!(worth_reasserting(&and_a_new_one, &[7]));
        let dropped_too = Survey { lost_topmost: true, coverers: vec![7], ..Survey::default() };
        assert!(worth_reasserting(&dropped_too, &[7]));
    }

    #[test]
    fn raising_never_moves_sizes_activates_or_shows() {
        for flag in [SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE, SWP_NOOWNERZORDER] {
            assert_eq!(RAISE_FLAGS.0 & flag.0, flag.0);
        }
        assert_eq!(RAISE_FLAGS.0 & SWP_SHOWWINDOW.0, 0);
    }
}

#[cfg(test)]
mod desktop_tests {
    //! Against real windows (invisible and off-screen, see `test_windows`).
    use super::*;
    use crate::topmost::test_windows::{patch, TestWindow};
    use windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, SetWindowPos, HWND_NOTOPMOST};

    /// The overlay, the notch inside it at the top, and both shown: as Hodeum lays them out.
    fn surfaces(index: i32) -> (TestWindow, TestWindow) {
        let overlay = TestWindow::new(patch(index, 0, 0, 1000, 600), None).show();
        let notch = TestWindow::new(patch(index, 300, 0, 400, 200), None).show();
        (overlay, notch)
    }

    #[test]
    fn a_topmost_window_raised_over_the_surfaces_is_seen_and_put_back_under_them() {
        let (overlay, notch) = surfaces(0);
        let rival = TestWindow::new(patch(0, 200, 100, 500, 400), None).show();
        raise(rival.0).expect("raise the rival");
        assert_eq!(survey(overlay.0, notch.0).coverers, vec![rival.id()]);

        raise(overlay.0).expect("raise the overlay");
        raise(notch.0).expect("raise the notch");

        assert_eq!(survey(overlay.0, notch.0), Survey::default());
        let above_rival = windows_above(rival.0);
        assert!(above_rival.contains(&overlay.0) && above_rival.contains(&notch.0));
        assert!(windows_above(overlay.0).contains(&notch.0), "the notch stays above the overlay");
    }

    #[test]
    fn an_overlay_above_the_notch_is_out_of_order_until_reasserted_bottom_up() {
        let notch = TestWindow::new(patch(1, 300, 0, 400, 200), None).show();
        let overlay = TestWindow::new(patch(1, 0, 0, 1000, 600), None).show();
        raise(overlay.0).expect("raise the overlay");
        assert!(survey(overlay.0, notch.0).out_of_order);

        raise(overlay.0).expect("raise the overlay");
        raise(notch.0).expect("raise the notch");
        assert!(!survey(overlay.0, notch.0).out_of_order);
    }

    #[test]
    fn a_surface_dropped_from_the_topmost_band_is_noticed_and_restored() {
        let (overlay, notch) = surfaces(2);
        // SAFETY: a window this test created; z-order only.
        unsafe { SetWindowPos(overlay.0, Some(HWND_NOTOPMOST), 0, 0, 0, 0, RAISE_FLAGS) }.expect("drop the overlay");
        assert!(!is_topmost(overlay.0));
        assert!(survey(overlay.0, notch.0).lost_topmost);

        raise(overlay.0).expect("raise the overlay");
        assert!(is_topmost(overlay.0));
    }

    #[test]
    fn a_hidden_notch_stays_hidden_when_put_back_on_top() {
        let notch = TestWindow::new(patch(3, 0, 0, 400, 200), None);
        raise(notch.0).expect("raise the hidden notch");
        // SAFETY: IsWindowVisible tolerates any handle.
        assert!(!unsafe { IsWindowVisible(notch.0) }.as_bool());
        assert!(is_topmost(notch.0));
    }

    #[test]
    fn hidden_windows_and_popups_the_notch_owns_never_count_as_covering() {
        let (overlay, notch) = surfaces(4);
        let hidden = TestWindow::new(patch(4, 0, 0, 1000, 600), None);
        let dropdown = TestWindow::new(patch(4, 350, 100, 200, 300), Some(notch.0)).show();
        raise(hidden.0).expect("raise the hidden window");
        raise(dropdown.0).expect("raise the dropdown");
        assert!(survey(overlay.0, notch.0).coverers.is_empty());
    }
}
