//! Agent · Do it for me: Hodey clicks a control for the learner, but only the exact element a recent
//! screen read reported, re-verified at the moment of the click.

use std::collections::HashMap;

use serde::Deserialize;
use uiautomation::inputs::Mouse;
use uiautomation::types::{ControlType, Point, TreeScope, UIProperty};
use uiautomation::variants::Variant;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

use super::model::RectDto;

/// UI Automation boxes shift by a pixel or two between reads (DPI rounding, focus borders).
const BOX_TOLERANCE_PX: f64 = 2.0;
/// The element under the centre is often a label or icon inside the control; its parents are checked too.
const MAX_ANCESTORS: usize = 4;
/// A press must follow its screen read closely: the preview plus planning, never an old read.
pub const MAX_READ_AGE_MS: u64 = 20_000;
pub const MOVED: &str = "That control moved before Hodey could click it, so this step is yours.";
pub const STALE: &str = "The screen changed before Hodey could click, so this step is yours.";
pub const NO_SELECTION: &str = "Nothing is selected to right-click, so this step is yours.";

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PressButton {
    Left,
    Right,
}

/// The latest screen read's elements, by the ids the web side was given, with the box each had.
pub struct Seen {
    pub at: u64,
    /// The learner's app: every press must land in this process.
    pub pid: u32,
    pub elements: HashMap<String, (UIElement, RectDto)>,
}

pub struct PressRequest {
    pub element_id: String,
    pub name: String,
    pub observed_at: u64,
    pub button: PressButton,
}

fn err(e: uiautomation::Error) -> String {
    e.to_string()
}

pub fn same_box(a: &RectDto, b: &RectDto) -> bool {
    [(a.x, b.x), (a.y, b.y), (a.width, b.width), (a.height, b.height)].iter().all(|(p, q)| (p - q).abs() <= BOX_TOLERANCE_PX)
}

pub fn centre(bounds: &RectDto) -> (i32, i32) {
    ((bounds.x + bounds.width / 2.0).round() as i32, (bounds.y + bounds.height / 2.0).round() as i32)
}

fn inside(inner: &RectDto, outer: &RectDto) -> bool {
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

/// Only the latest read, and only while it's fresh.
pub fn check_read(seen_at: u64, observed_at: u64, now: u64) -> Result<(), &'static str> {
    if seen_at != observed_at || now.saturating_sub(seen_at) > MAX_READ_AGE_MS {
        return Err(STALE);
    }
    Ok(())
}

fn box_of(element: &UIElement) -> Result<RectDto, String> {
    let rect = element.get_bounding_rectangle().map_err(err)?;
    Ok(RectDto { x: f64::from(rect.get_left()), y: f64::from(rect.get_top()), width: f64::from(rect.get_width()), height: f64::from(rect.get_height()) })
}

/// The same control, still in the learner's app, on screen, in the same place, under nothing else.
fn verify(automation: &UIAutomation, walker: &UITreeWalker, element: &UIElement, seen_box: &RectDto, name: &str, pid: u32) -> Result<RectDto, String> {
    let now_box = box_of(element)?;
    let same = !element.is_offscreen().map_err(err)?
        && element.get_name().map_err(err)?.trim() == name
        && element.get_process_id().map_err(err)? == pid
        && same_box(&now_box, seen_box);
    if !same {
        return Err(MOVED.into());
    }
    let (x, y) = centre(&now_box);
    let mut hit = automation.element_from_point(Point::new(x, y)).map_err(err)?;
    for _ in 0..=MAX_ANCESTORS {
        if automation.compare_elements(&hit, element).map_err(err)? {
            return Ok(now_box);
        }
        hit = walker.get_parent(&hit).map_err(|_| MOVED.to_string())?;
    }
    Err(MOVED.into())
}

/// A right-click on a list means "on the selected items" (File Explorer's menu for those files): a
/// selected item that's visible inside the list, never anywhere else.
fn selected_item_box(automation: &UIAutomation, list: &UIElement, list_box: &RectDto) -> Result<RectDto, String> {
    let condition = automation.create_property_condition(UIProperty::SelectionItemIsSelected, Variant::from(true), None).map_err(err)?;
    let item = list.find_first(TreeScope::Descendants, &condition).map_err(|_| NO_SELECTION.to_string())?;
    let item_box = box_of(&item)?;
    if item.is_offscreen().map_err(err)? || !inside(&item_box, list_box) {
        return Err(NO_SELECTION.into());
    }
    Ok(item_box)
}

/// Clicks the element `request` names from `seen`, moving the pointer there so the learner sees it.
pub fn press(automation: &UIAutomation, walker: &UITreeWalker, seen: &Seen, request: &PressRequest, now: u64) -> Result<(), String> {
    check_read(seen.at, request.observed_at, now)?;
    let (element, seen_box) = seen.elements.get(&request.element_id).ok_or(STALE)?;
    let element_box = verify(automation, walker, element, seen_box, &request.name, seen.pid)?;
    let is_list = element.get_control_type().map(|t| t == ControlType::List).unwrap_or(false);
    let click_box = match request.button {
        PressButton::Right if is_list => selected_item_box(automation, element, &element_box)?,
        _ => element_box,
    };
    let (x, y) = centre(&click_box);
    let mouse = Mouse::default();
    match request.button {
        PressButton::Left => mouse.click(&Point::new(x, y)),
        PressButton::Right => mouse.right_click(&Point::new(x, y)),
    }
    .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOX: RectDto = RectDto { x: 100.0, y: 40.0, width: 60.0, height: 24.0 };

    #[test]
    fn treats_a_pixel_of_drift_as_the_same_control() {
        assert!(same_box(&BOX, &RectDto { x: 101.0, y: 39.0, ..BOX }));
        assert!(!same_box(&BOX, &RectDto { x: 110.0, ..BOX }));
        assert!(!same_box(&BOX, &RectDto { width: 120.0, ..BOX }));
    }

    #[test]
    fn clicks_the_middle_of_the_box() {
        assert_eq!(centre(&BOX), (130, 52));
    }

    #[test]
    fn reads_the_button_the_web_side_sends() {
        assert_eq!(serde_json::from_str::<PressButton>(r#""right""#).unwrap(), PressButton::Right);
        assert_eq!(serde_json::from_str::<PressButton>(r#""left""#).unwrap(), PressButton::Left);
    }

    #[test]
    fn presses_only_from_the_latest_fresh_read() {
        assert_eq!(check_read(1_000, 1_000, 2_000), Ok(()));
        assert_eq!(check_read(1_000, 999, 2_000), Err(STALE));
        assert_eq!(check_read(1_000, 1_000, 1_000 + MAX_READ_AGE_MS + 1), Err(STALE));
    }

    #[test]
    fn a_selected_item_must_sit_inside_its_list() {
        assert!(inside(&RectDto { x: 110.0, y: 45.0, width: 20.0, height: 10.0 }, &BOX));
        assert!(!inside(&RectDto { x: 90.0, y: 45.0, width: 20.0, height: 10.0 }, &BOX));
    }
}
