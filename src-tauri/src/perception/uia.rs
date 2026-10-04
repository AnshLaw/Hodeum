use std::cell::RefCell;
use std::collections::HashMap;

use uiautomation::core::UICacheRequest;
use uiautomation::types::{ControlType, Handle, ToggleState, TreeScope, UIProperty};
use uiautomation::variants::Value;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

use super::model::{normalize_role, ElementDto, RectDto};
use super::press::{self, PressRequest, Seen};

pub const MAX_ELEMENTS: usize = 1500;
pub const MAX_DEPTH: usize = 40;
const UIA_CONFIDENCE: f64 = 0.95;
/// Spreadsheet cells and document bodies can hold tens of thousands of nodes and are never
/// teaching targets at this level, so their subtrees are skipped.
const PRUNED: [ControlType; 4] = [ControlType::DataGrid, ControlType::DataItem, ControlType::Table, ControlType::Document];
const CACHED: [UIProperty; 7] = [
    UIProperty::Name,
    UIProperty::ControlType,
    UIProperty::LocalizedControlType,
    UIProperty::BoundingRectangle,
    UIProperty::IsOffscreen,
    UIProperty::SelectionItemIsSelected,
    UIProperty::ToggleToggleState,
];

pub fn is_pruned(control_type: ControlType) -> bool {
    PRUNED.contains(&control_type)
}

fn err(e: uiautomation::Error) -> String {
    e.to_string()
}

/// Owns a UI Automation client; must live on one MTA thread.
pub struct UiaReader {
    automation: UIAutomation,
    walker: UITreeWalker,
    cache: UICacheRequest,
    /// The latest read's elements, for Agent · Do it for me to press one of them.
    seen: RefCell<Option<Seen>>,
}

/// Elements by the id the web side gets, with the box each had when read.
pub type ReadElements = HashMap<String, (UIElement, RectDto)>;

impl UiaReader {
    pub fn new() -> Result<Self, String> {
        let automation = UIAutomation::new().map_err(err)?;
        let walker = automation.get_control_view_walker().map_err(err)?;
        let cache = automation.create_cache_request().map_err(err)?;
        for property in CACHED {
            cache.add_property(property).map_err(err)?;
        }
        cache.set_tree_scope(TreeScope::Element).map_err(err)?;
        Ok(Self { automation, walker, cache, seen: RefCell::new(None) })
    }

    /// Depth-first walk of the window's control view, batching property reads through the cache.
    pub fn read(&self, hwnd: isize, region: Option<RectDto>) -> Result<(Vec<ElementDto>, ReadElements), String> {
        let root = self.automation.element_from_handle(Handle::from(hwnd)).map_err(err)?;
        let root = root.build_updated_cache(&self.cache).map_err(err)?;
        let mut out = Vec::new();
        let mut handles = ReadElements::new();
        let mut stack = vec![(root, 0usize)];
        let mut sequence = 0usize;
        while let Some((element, depth)) = stack.pop() {
            if out.len() >= MAX_ELEMENTS {
                break;
            }
            // Offscreen subtrees (collapsed menus, hidden tabs) are skipped entirely.
            if element.is_cached_offscreen().unwrap_or(true) {
                continue;
            }
            sequence += 1;
            if let Some(dto) = describe(&element, sequence).filter(|d| region.map_or(true, |r| r.intersects(&d.bounds))) {
                handles.insert(dto.id.clone(), (element.clone(), dto.bounds));
                out.push(dto);
            }
            let pruned = element.get_cached_control_type().map(is_pruned).unwrap_or(false);
            if depth < MAX_DEPTH && !pruned {
                self.push_children(&element, depth + 1, &mut stack);
            }
        }
        Ok((out, handles))
    }

    /// Replaces the elements a press may target with this read's.
    pub fn remember(&self, seen: Seen) {
        self.seen.replace(Some(seen));
    }

    /// Agent · Do it for me: clicks one element of the latest read, once; any later press needs a new read.
    pub fn press(&self, request: &PressRequest, now: u64) -> Result<(), String> {
        let seen = self.seen.take().ok_or(press::STALE)?;
        press::press(&self.automation, &self.walker, &seen, request, now)
    }

    fn push_children(&self, element: &UIElement, depth: usize, stack: &mut Vec<(UIElement, usize)>) {
        let mut children = Vec::new();
        let mut next = self.walker.get_first_child_build_cache(element, &self.cache);
        while let Ok(child) = next {
            next = self.walker.get_next_sibling_build_cache(&child, &self.cache);
            children.push(child);
        }
        // Reverse so the first child is popped first (document order).
        stack.extend(children.into_iter().rev().map(|child| (child, depth)));
    }
}

fn is_selected(element: &UIElement) -> Option<bool> {
    let selected = element.get_cached_property_value(UIProperty::SelectionItemIsSelected).ok()?.get_value().ok();
    if let Some(Value::BOOL(value)) = selected {
        return Some(value);
    }
    let toggle = element.get_cached_property_value(UIProperty::ToggleToggleState).ok()?.get_value().ok();
    match toggle {
        Some(Value::I4(state)) => Some(state == ToggleState::On as i32),
        _ => None,
    }
}

/// A reportable element: on-screen, named, with a real box. Unnamed containers are still walked.
fn describe(element: &UIElement, sequence: usize) -> Option<ElementDto> {
    let rect = element.get_cached_bounding_rectangle().ok()?;
    let name = element.get_cached_name().unwrap_or_default().trim().to_string();
    if rect.get_width() <= 0 || rect.get_height() <= 0 || name.is_empty() {
        return None;
    }
    Some(ElementDto {
        checked: None,
        container: None,
        focused: None,
        id: format!("uia:{sequence}"),
        role: normalize_role(&element.get_cached_localized_control_type().unwrap_or_default()),
        name,
        bounds: RectDto {
            x: f64::from(rect.get_left()),
            y: f64::from(rect.get_top()),
            width: f64::from(rect.get_width()),
            height: f64::from(rect.get_height()),
        },
        source: "uia",
        confidence: UIA_CONFIDENCE,
        selected: is_selected(element),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_cell_and_document_subtrees_only() {
        assert!(is_pruned(ControlType::DataGrid));
        assert!(is_pruned(ControlType::Document));
        assert!(!is_pruned(ControlType::TabItem));
        assert!(!is_pruned(ControlType::Pane));
    }
}
