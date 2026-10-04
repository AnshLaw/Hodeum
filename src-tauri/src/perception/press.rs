//! Agent · Do it for me: Hodey clicks a control for the learner, but only the one it saw.

use serde::Deserialize;
use uiautomation::types::{ControlType, Point, TreeScope, UIProperty};
use uiautomation::variants::Variant;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

use super::model::RectDto;

/// UI Automation boxes shift by a pixel or two between reads (DPI rounding, focus borders).
const BOX_TOLERANCE_PX: f64 = 2.0;
/// The element under the centre is often a label or icon inside the control; its parents are checked too.
const MAX_ANCESTORS: usize = 4;
pub const MOVED: &str = "That control moved before Hodey could click it, so this step is yours.";

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PressButton {
    Left,
    Right,
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

fn box_of(element: &UIElement) -> Result<RectDto, String> {
    let rect = element.get_bounding_rectangle().map_err(err)?;
    Ok(RectDto { x: f64::from(rect.get_left()), y: f64::from(rect.get_top()), width: f64::from(rect.get_width()), height: f64::from(rect.get_height()) })
}

/// The element at the centre of `bounds`, or the nearest parent with exactly that box. Anything else
/// (a dialog on top, a scrolled list) means the screen changed, and Hodey must not click blindly.
fn element_at(automation: &UIAutomation, walker: &UITreeWalker, bounds: &RectDto) -> Result<UIElement, String> {
    let (x, y) = centre(bounds);
    let mut element = automation.element_from_point(Point::new(x, y)).map_err(err)?;
    for _ in 0..=MAX_ANCESTORS {
        if same_box(&box_of(&element)?, bounds) {
            return Ok(element);
        }
        element = walker.get_parent(&element).map_err(|_| MOVED.to_string())?;
    }
    Err(MOVED.into())
}

/// A right-click on a list means "on the selected items" (File Explorer's context menu for those files).
fn selected_item(automation: &UIAutomation, list: &UIElement) -> Option<UIElement> {
    let condition = automation.create_property_condition(UIProperty::SelectionItemIsSelected, Variant::from(true), None).ok()?;
    list.find_first(TreeScope::Descendants, &condition).ok()
}

/// Clicks the control Hodey saw at `bounds`, moving the pointer there so the learner sees it happen.
pub fn press(automation: &UIAutomation, walker: &UITreeWalker, bounds: &RectDto, button: PressButton) -> Result<(), String> {
    let element = element_at(automation, walker, bounds)?;
    let is_list = element.get_control_type().map(|t| t == ControlType::List).unwrap_or(false);
    let target = match button {
        PressButton::Right if is_list => selected_item(automation, &element).unwrap_or(element),
        _ => element,
    };
    match button {
        PressButton::Left => target.click(),
        PressButton::Right => target.right_click(),
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
}
