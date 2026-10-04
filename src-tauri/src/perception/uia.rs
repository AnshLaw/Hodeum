use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use uiautomation::core::UICacheRequest;
use uiautomation::types::{ControlType, Handle, ToggleState, TreeScope, UIProperty};
use uiautomation::variants::Value;
use uiautomation::{UIAutomation, UIElement, UITreeWalker};
use windows::Win32::Foundation::HWND;

use super::foreground;
use super::model::{normalize_role, ElementDto, RectDto};
use super::press::{self, PressRequest, Seen, SeenElement};

pub const MAX_ELEMENTS: usize = 1500;
pub const MAX_DEPTH: usize = 40;
/// A web page gets its own, smaller allowance so a long page can't crowd out the app's own controls.
pub const MAX_DOCUMENT_ELEMENTS: usize = 250;
pub const MAX_DOCUMENT_DEPTH: usize = 25;
/// A read must not hold up the learner's next step: past this, what was read so far is returned.
pub const WALK_BUDGET: Duration = Duration::from_millis(400);
const UIA_CONFIDENCE: f64 = 0.95;
/// Spreadsheet cells can hold tens of thousands of nodes and are never teaching targets at this level.
const PRUNED: [ControlType; 3] = [ControlType::DataGrid, ControlType::DataItem, ControlType::Table];
/// Apps whose document body is the learner's own text or cells, not controls (by executable stem).
const TEXT_DOCUMENT_APPS: [&str; 2] = ["winword", "excel"];
/// Windows 11 XAML menus (Explorer's right-click menu, Notepad's File menu) hang under an offscreen
/// 1x1 host of this class, while the menu itself is on screen.
const POPUP_CLASS: &str = "Popup";
/// File Explorer's and the file dialogs' file list: every row holds four cells of its own.
const ITEMS_VIEW: &str = "Items View";
const MAX_CONTAINER_NAME_CHARS: usize = 40;
const TITLE_BAR_CLASSES: [&str; 2] = ["BrowserCaptionButtonContainer", "WindowsCaptionButton"];
const TAB_STRIP_CLASS: &str = "TabStrip";
const CACHED: [UIProperty; 12] = [
    UIProperty::Name,
    UIProperty::ControlType,
    UIProperty::LocalizedControlType,
    UIProperty::BoundingRectangle,
    UIProperty::IsOffscreen,
    UIProperty::ClassName,
    UIProperty::ProcessId,
    UIProperty::HasKeyboardFocus,
    UIProperty::IsTogglePatternAvailable,
    UIProperty::ToggleToggleState,
    UIProperty::IsSelectionItemPatternAvailable,
    UIProperty::SelectionItemIsSelected,
];

fn err(e: uiautomation::Error) -> String {
    e.to_string()
}

/// Whether an element is reported and whether its children are walked. Offscreen subtrees (collapsed
/// menus, hidden tabs) are skipped, except the zero-size popup hosts that open menus hang under.
pub fn walk_decision(offscreen: bool, size: Option<(i32, i32)>, class: &str) -> (bool, bool) {
    if !offscreen {
        return (true, true);
    }
    let tiny = size.map_or(true, |(width, height)| width <= 1 || height <= 1);
    (false, tiny || class == POPUP_CLASS)
}

/// (checked, selected): ticked comes from the Toggle pattern only, selected from SelectionItem only.
/// UIA answers a default `false` for a pattern an element lacks, so availability decides, not the value.
pub fn tick_and_selection(toggle_available: bool, toggle: Option<i32>, selection_available: bool, selected: Option<bool>) -> (Option<bool>, Option<bool>) {
    let checked = match toggle.filter(|_| toggle_available) {
        Some(state) if state == ToggleState::On as i32 => Some(true),
        Some(state) if state == ToggleState::Off as i32 => Some(false),
        _ => None,
    };
    (checked, selected.filter(|_| selection_available))
}

const TYPE_ROLES: [(ControlType, &str); 41] = [
    (ControlType::Button, "button"), (ControlType::Calendar, "calendar"), (ControlType::CheckBox, "check box"),
    (ControlType::ComboBox, "combo box"), (ControlType::Edit, "edit"), (ControlType::Hyperlink, "link"),
    (ControlType::Image, "image"), (ControlType::ListItem, "list item"), (ControlType::List, "list"),
    (ControlType::Menu, "menu"), (ControlType::MenuBar, "menu bar"), (ControlType::MenuItem, "menu item"),
    (ControlType::ProgressBar, "progress bar"), (ControlType::RadioButton, "radio button"), (ControlType::ScrollBar, "scroll bar"),
    (ControlType::Slider, "slider"), (ControlType::Spinner, "spinner"), (ControlType::StatusBar, "status bar"),
    (ControlType::Tab, "tab"), (ControlType::TabItem, "tab item"), (ControlType::Text, "text"),
    (ControlType::ToolBar, "tool bar"), (ControlType::ToolTip, "tool tip"), (ControlType::Tree, "tree"),
    (ControlType::TreeItem, "tree item"), (ControlType::Custom, "custom"), (ControlType::Group, "group"),
    (ControlType::Thumb, "thumb"), (ControlType::DataGrid, "data grid"), (ControlType::DataItem, "data item"),
    (ControlType::Document, "document"), (ControlType::SplitButton, "split button"), (ControlType::Window, "window"),
    (ControlType::Pane, "pane"), (ControlType::Header, "header"), (ControlType::HeaderItem, "header item"),
    (ControlType::Table, "table"), (ControlType::TitleBar, "title bar"), (ControlType::Separator, "separator"),
    (ControlType::SemanticZoom, "semantic zoom"), (ControlType::AppBar, "app bar"),
];

/// The English role of a control type, whatever the display language.
pub fn type_role(control_type: ControlType) -> &'static str {
    TYPE_ROLES.iter().find(|(known, _)| *known == control_type).map_or("custom", |(_, role)| role)
}

fn clip(name: &str) -> String {
    name.chars().take(MAX_CONTAINER_NAME_CHARS).collect()
}

/// Where an element's children sit, so two controls with one name ("Close") can be told apart:
/// the window's title bar, a browser tab, a toolbar, the page.
pub fn container_for(control_type: ControlType, class: &str, name: &str, parent: Option<&str>) -> Option<String> {
    if control_type == ControlType::TitleBar || TITLE_BAR_CLASSES.contains(&class) {
        return Some("title bar".into());
    }
    if control_type == ControlType::Tab || class.contains(TAB_STRIP_CLASS) {
        return Some("tab strip".into());
    }
    let name = name.trim();
    match control_type {
        ControlType::TabItem if name.is_empty() => Some("tab".into()),
        ControlType::TabItem => Some(format!("tab '{}'", clip(name))),
        ControlType::ToolBar if name.is_empty() => Some("toolbar".into()),
        ControlType::ToolBar => Some(clip(name)),
        ControlType::MenuBar => Some("menu bar".into()),
        ControlType::StatusBar => Some("status bar".into()),
        ControlType::Document => Some("page".into()),
        ControlType::Pane | ControlType::Group if !name.is_empty() && name.chars().count() <= MAX_CONTAINER_NAME_CHARS => Some(name.into()),
        _ => parent.map(str::to_string),
    }
}

/// What part of the window a walk is in, for the rules that depend on an ancestor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Scope {
    App,
    /// Inside Explorer's file list.
    ItemsView,
    /// Inside a web page, this many levels below its Document.
    Page { depth: usize },
}

/// How a walk treats an element's children.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Descent {
    Skip,
    Now(Scope),
    /// A web page: walked after the app's own controls, so a long page can't use up the budget first.
    Later(Scope),
}

pub fn descent(control_type: ControlType, name: &str, scope: Scope, text_documents: bool) -> Descent {
    if PRUNED.contains(&control_type) {
        return Descent::Skip;
    }
    match (control_type, scope) {
        (ControlType::Document, _) if text_documents => Descent::Skip,
        (ControlType::Document, Scope::App | Scope::ItemsView) => Descent::Later(Scope::Page { depth: 1 }),
        (_, Scope::Page { depth }) if depth >= MAX_DOCUMENT_DEPTH => Descent::Skip,
        (_, Scope::Page { depth }) => Descent::Now(Scope::Page { depth: depth + 1 }),
        // The row is the target; its Name/Date/Type/Size cells only slow the read.
        (ControlType::ListItem, Scope::ItemsView) => Descent::Skip,
        (ControlType::List, _) if name.trim() == ITEMS_VIEW => Descent::Now(Scope::ItemsView),
        _ => Descent::Now(scope),
    }
}

/// Word's and Excel's document bodies are text and cells, never walked.
pub fn has_text_documents(exe_stem: &str) -> bool {
    TEXT_DOCUMENT_APPS.contains(&exe_stem.to_ascii_lowercase().as_str())
}

/// Point & Ask: a subtree whose real box lies outside the asked-about region holds nothing to report.
/// Zero-size hosts (popup menus) don't bound their children, so they are always walked.
pub fn outside_region(region: Option<&RectDto>, bounds: Option<&RectDto>) -> bool {
    match (region, bounds) {
        (Some(region), Some(bounds)) if bounds.width > 1.0 && bounds.height > 1.0 => !region.intersects(bounds),
        _ => false,
    }
}

/// Owns a UI Automation client; must live on one MTA thread.
pub struct UiaReader {
    automation: UIAutomation,
    walker: UITreeWalker,
    cache: UICacheRequest,
    /// The same properties for all of an element's children, fetched in one cross-process call.
    children_cache: UICacheRequest,
    /// The latest read's elements, for Agent · Do it for me to press one of them.
    seen: RefCell<Option<Seen>>,
}

/// Elements by the id the web side gets, with the box and process each had when read.
pub type ReadElements = HashMap<String, SeenElement>;

/// How a read went, for the slow-read log and the live checks.
#[derive(Debug, Default, Clone, Copy)]
pub struct WalkStats {
    pub visited: usize,
    /// Elements that disappeared between being listed and having their children read.
    pub lost: usize,
    pub cut_by_budget: bool,
    pub elapsed_ms: u128,
}

fn cache_request(automation: &UIAutomation, scope: TreeScope) -> Result<UICacheRequest, String> {
    let cache = automation.create_cache_request().map_err(err)?;
    for property in CACHED {
        cache.add_property(property).map_err(err)?;
    }
    cache.set_tree_scope(scope).map_err(err)?;
    Ok(cache)
}

impl UiaReader {
    pub fn new() -> Result<Self, String> {
        let automation = UIAutomation::new().map_err(err)?;
        let walker = automation.get_control_view_walker().map_err(err)?;
        // A new cache request's tree filter is the control view, matching the walker.
        let cache = cache_request(&automation, TreeScope::Element)?;
        let children_cache = cache_request(&automation, TreeScope::Children)?;
        Ok(Self { automation, walker, cache, children_cache, seen: RefCell::new(None) })
    }

    /// Reads the window's controls; logs when the time budget cut the read short.
    pub fn read(&self, hwnd: isize, region: Option<RectDto>) -> Result<(Vec<ElementDto>, ReadElements), String> {
        let (elements, handles, stats) = self.read_with_stats(hwnd, region, WALK_BUDGET)?;
        if stats.cut_by_budget {
            eprintln!("UIA read stopped at its {} ms budget: {} elements from {} visited", WALK_BUDGET.as_millis(), elements.len(), stats.visited);
        }
        Ok((elements, handles))
    }

    /// Depth-first walk of the window's control view, one batched request per parent.
    pub fn read_with_stats(&self, hwnd: isize, region: Option<RectDto>, budget: Duration) -> Result<(Vec<ElementDto>, ReadElements, WalkStats), String> {
        let started = Instant::now();
        let root = self.automation.element_from_handle(Handle::from(hwnd)).map_err(err)?;
        let root = root.build_updated_cache(&self.cache).map_err(err)?;
        let mut walk = Walk::new(self, region, text_documents(hwnd), started + budget);
        walk.stack.push(Node { element: root, depth: 0, scope: Scope::App, container: None });
        walk.run();
        walk.stats.elapsed_ms = started.elapsed().as_millis();
        Ok((walk.out, walk.handles, walk.stats))
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

    /// The element's control-view children with their properties, or None when it has gone away.
    fn children(&self, element: &UIElement) -> Option<Vec<UIElement>> {
        let updated = element.build_updated_cache(&self.children_cache).ok()?;
        // A leaf's cached children are a null array, which the crate reports as an error: no children.
        Some(updated.get_cached_children().unwrap_or_default())
    }
}

fn text_documents(hwnd: isize) -> bool {
    match foreground::exe_stem(HWND(hwnd as *mut _)) {
        Ok(stem) => has_text_documents(&stem),
        Err(error) => {
            eprintln!("couldn't read the app's process name, so its documents are walked: {error}");
            false
        }
    }
}

struct Node {
    element: UIElement,
    depth: usize,
    scope: Scope,
    /// Where this element sits, from its ancestors.
    container: Option<Rc<str>>,
}

/// One read in progress.
struct Walk<'a> {
    reader: &'a UiaReader,
    region: Option<RectDto>,
    text_documents: bool,
    deadline: Instant,
    stack: Vec<Node>,
    /// Pages whose children are read once the app's own controls are done, in document order.
    later: Vec<Node>,
    out: Vec<ElementDto>,
    handles: ReadElements,
    page_reported: usize,
    sequence: usize,
    stats: WalkStats,
}

impl<'a> Walk<'a> {
    fn new(reader: &'a UiaReader, region: Option<RectDto>, text_documents: bool, deadline: Instant) -> Self {
        Self { reader, region, text_documents, deadline, stack: Vec::new(), later: Vec::new(), out: Vec::new(), handles: ReadElements::new(), page_reported: 0, sequence: 0, stats: WalkStats::default() }
    }

    fn run(&mut self) {
        while let Some(node) = self.next() {
            if self.out.len() >= MAX_ELEMENTS {
                break;
            }
            if Instant::now() >= self.deadline {
                self.stats.cut_by_budget = true;
                break;
            }
            self.visit(node);
        }
    }

    fn next(&mut self) -> Option<Node> {
        while self.stack.is_empty() && !self.later.is_empty() {
            let page = self.later.remove(0);
            self.push_children(&page.element, page.depth + 1, page.scope, page.container);
        }
        self.stack.pop()
    }

    fn visit(&mut self, node: Node) {
        self.stats.visited += 1;
        let in_page = matches!(node.scope, Scope::Page { .. });
        if in_page && self.page_reported >= MAX_DOCUMENT_ELEMENTS {
            return;
        }
        let element = &node.element;
        let bounds = element.get_cached_bounding_rectangle().ok().map(|r| rect_dto(&r));
        if outside_region(self.region.as_ref(), bounds.as_ref()) {
            return;
        }
        let class = element.get_cached_classname().unwrap_or_default();
        let offscreen = element.is_cached_offscreen().unwrap_or(true);
        let (report, descend) = walk_decision(offscreen, bounds.map(|b| (b.width as i32, b.height as i32)), &class);
        if report {
            self.report(&node, in_page);
        }
        if descend && node.depth < MAX_DEPTH {
            self.descend(node, &class);
        }
    }

    fn report(&mut self, node: &Node, in_page: bool) {
        self.sequence += 1;
        let Some(dto) = describe(&node.element, self.sequence, node.container.as_deref()) else { return };
        if self.region.map_or(false, |region| !region.intersects(&dto.bounds)) {
            return;
        }
        let pid = node.element.get_cached_process_id().ok().and_then(|pid| u32::try_from(pid).ok());
        self.handles.insert(dto.id.clone(), SeenElement { element: node.element.clone(), bounds: dto.bounds, pid });
        self.out.push(dto);
        if in_page {
            self.page_reported += 1;
        }
    }

    fn descend(&mut self, node: Node, class: &str) {
        let element = &node.element;
        let control_type = element.get_cached_control_type().unwrap_or(ControlType::Custom);
        let name = element.get_cached_name().unwrap_or_default();
        let container = container_for(control_type, class, &name, node.container.as_deref()).map(Rc::from);
        match descent(control_type, &name, node.scope, self.text_documents) {
            Descent::Skip => {}
            Descent::Now(scope) => self.push_children(element, node.depth + 1, scope, container),
            Descent::Later(scope) => self.later.push(Node { element: node.element, depth: node.depth, scope, container }),
        }
    }

    fn push_children(&mut self, element: &UIElement, depth: usize, scope: Scope, container: Option<Rc<str>>) {
        let Some(children) = self.reader.children(element) else {
            self.stats.lost += 1;
            return;
        };
        // Reverse so the first child is popped first (document order).
        let nodes = children.into_iter().rev().map(|element| Node { element, depth, scope, container: container.clone() });
        self.stack.extend(nodes);
    }
}

fn rect_dto(rect: &uiautomation::types::Rect) -> RectDto {
    RectDto { x: f64::from(rect.get_left()), y: f64::from(rect.get_top()), width: f64::from(rect.get_width()), height: f64::from(rect.get_height()) }
}

fn cached_bool(element: &UIElement, property: UIProperty) -> Option<bool> {
    match element.get_cached_property_value(property).ok()?.get_value().ok()? {
        Value::BOOL(value) => Some(value),
        _ => None,
    }
}

fn cached_i32(element: &UIElement, property: UIProperty) -> Option<i32> {
    match element.get_cached_property_value(property).ok()?.get_value().ok()? {
        Value::I4(value) => Some(value),
        _ => None,
    }
}

fn role_of(element: &UIElement) -> String {
    let type_name = element.get_cached_control_type().map(type_role).unwrap_or("custom");
    normalize_role(type_name, &element.get_cached_localized_control_type().unwrap_or_default())
}

/// A reportable element: named, with a real box. Unnamed containers are still walked.
fn describe(element: &UIElement, sequence: usize, container: Option<&str>) -> Option<ElementDto> {
    let rect = element.get_cached_bounding_rectangle().ok()?;
    let name = element.get_cached_name().unwrap_or_default().trim().to_string();
    if rect.get_width() <= 0 || rect.get_height() <= 0 || name.is_empty() {
        return None;
    }
    let (checked, selected) = tick_and_selection(
        cached_bool(element, UIProperty::IsTogglePatternAvailable).unwrap_or(false),
        cached_i32(element, UIProperty::ToggleToggleState),
        cached_bool(element, UIProperty::IsSelectionItemPatternAvailable).unwrap_or(false),
        cached_bool(element, UIProperty::SelectionItemIsSelected),
    );
    Some(ElementDto {
        id: format!("uia:{sequence}"),
        role: role_of(element),
        name,
        bounds: rect_dto(&rect),
        source: "uia",
        confidence: UIA_CONFIDENCE,
        selected,
        checked,
        container: container.map(str::to_string),
        // Only the focused control says so; everything else leaves the field out.
        focused: cached_bool(element, UIProperty::HasKeyboardFocus).filter(|focused| *focused),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ON: i32 = ToggleState::On as i32;
    const OFF: i32 = ToggleState::Off as i32;
    const INDETERMINATE: i32 = ToggleState::Indeterminate as i32;

    #[test]
    fn reports_on_screen_elements_and_walks_their_children() {
        assert_eq!(walk_decision(false, Some((120, 30)), "Button"), (true, true));
    }

    #[test]
    fn walks_into_the_offscreen_hosts_of_open_popup_menus() {
        assert_eq!(walk_decision(true, Some((1, 1)), "Popup"), (false, true));
        assert_eq!(walk_decision(true, Some((1, 1)), ""), (false, true));
        assert_eq!(walk_decision(true, Some((0, 0)), "PopupHost"), (false, true));
        assert_eq!(walk_decision(true, None, ""), (false, true));
        assert_eq!(walk_decision(true, Some((400, 300)), "Popup"), (false, true));
    }

    #[test]
    fn skips_real_offscreen_subtrees() {
        assert_eq!(walk_decision(true, Some((400, 300)), "Pane"), (false, false));
        assert_eq!(walk_decision(true, Some((2, 40)), "TabItem"), (false, false));
    }

    #[test]
    fn a_ticked_box_is_checked_even_though_selection_defaults_to_false() {
        assert_eq!(tick_and_selection(true, Some(ON), false, Some(false)), (Some(true), None));
    }

    #[test]
    fn an_unticked_box_is_unchecked() {
        assert_eq!(tick_and_selection(true, Some(OFF), false, Some(false)), (Some(false), None));
    }

    #[test]
    fn selection_comes_only_from_selection_items() {
        assert_eq!(tick_and_selection(false, Some(OFF), true, Some(true)), (None, Some(true)));
        assert_eq!(tick_and_selection(false, None, true, Some(false)), (None, Some(false)));
    }

    #[test]
    fn plain_controls_are_neither_checked_nor_selected() {
        assert_eq!(tick_and_selection(false, Some(OFF), false, Some(false)), (None, None));
        assert_eq!(tick_and_selection(true, Some(INDETERMINATE), false, None), (None, None));
    }

    #[test]
    fn roles_come_from_the_control_type_in_english() {
        assert_eq!(type_role(ControlType::CheckBox), "check box");
        assert_eq!(type_role(ControlType::Hyperlink), "link");
        assert_eq!(type_role(ControlType::SplitButton), "split button");
        assert_eq!(normalize_role(type_role(ControlType::CheckBox), "Kontrollkästchen"), "check box");
        assert_eq!(normalize_role(type_role(ControlType::Button), "toggle switch"), "toggle switch");
    }

    #[test]
    fn every_control_type_role_is_in_the_pack_vocabulary() {
        for (_, role) in TYPE_ROLES {
            assert_eq!(super::super::model::known_role(role), Some(role), "{role}");
        }
    }

    #[test]
    fn caption_buttons_sit_in_the_title_bar() {
        assert_eq!(container_for(ControlType::Pane, "BrowserCaptionButtonContainer", "", None).as_deref(), Some("title bar"));
        assert_eq!(container_for(ControlType::TitleBar, "", "Calculator", Some("Calculator")).as_deref(), Some("title bar"));
    }

    #[test]
    fn tabs_and_their_buttons_are_told_apart() {
        assert_eq!(container_for(ControlType::Pane, "BraveHorizontalTabStripRegionView", "", None).as_deref(), Some("tab strip"));
        assert_eq!(container_for(ControlType::Tab, "", "", None).as_deref(), Some("tab strip"));
        assert_eq!(container_for(ControlType::TabItem, "Tab", "(148) YouTube", Some("tab strip")).as_deref(), Some("tab '(148) YouTube'"));
        assert_eq!(container_for(ControlType::TabItem, "Tab", " ", Some("tab strip")).as_deref(), Some("tab"));
    }

    #[test]
    fn bars_and_pages_name_their_region() {
        assert_eq!(container_for(ControlType::ToolBar, "", "", None).as_deref(), Some("toolbar"));
        assert_eq!(container_for(ControlType::ToolBar, "", "Bookmarks", None).as_deref(), Some("Bookmarks"));
        assert_eq!(container_for(ControlType::MenuBar, "", "Application", None).as_deref(), Some("menu bar"));
        assert_eq!(container_for(ControlType::StatusBar, "", "Status Bar", None).as_deref(), Some("status bar"));
        assert_eq!(container_for(ControlType::Document, "", "YouTube", Some("Brave")).as_deref(), Some("page"));
    }

    #[test]
    fn short_named_panes_name_their_region_and_everything_else_inherits() {
        assert_eq!(container_for(ControlType::Group, "", "Navigation", Some("page")).as_deref(), Some("Navigation"));
        let long = "x".repeat(MAX_CONTAINER_NAME_CHARS + 1);
        assert_eq!(container_for(ControlType::Pane, "", &long, Some("page")).as_deref(), Some("page"));
        assert_eq!(container_for(ControlType::Pane, "", "", Some("page")).as_deref(), Some("page"));
        assert_eq!(container_for(ControlType::Button, "", "Close", Some("tab strip")).as_deref(), Some("tab strip"));
        assert_eq!(container_for(ControlType::Button, "", "Close", None), None);
    }

    #[test]
    fn prunes_cells_and_tables() {
        assert_eq!(descent(ControlType::DataGrid, "", Scope::App, false), Descent::Skip);
        assert_eq!(descent(ControlType::Table, "", Scope::Page { depth: 2 }, false), Descent::Skip);
        assert_eq!(descent(ControlType::Pane, "", Scope::App, false), Descent::Now(Scope::App));
    }

    #[test]
    fn walks_web_pages_after_the_app_with_their_own_depth() {
        assert_eq!(descent(ControlType::Document, "YouTube", Scope::App, false), Descent::Later(Scope::Page { depth: 1 }));
        assert_eq!(descent(ControlType::Group, "", Scope::Page { depth: 1 }, false), Descent::Now(Scope::Page { depth: 2 }));
        assert_eq!(descent(ControlType::Document, "frame", Scope::Page { depth: 3 }, false), Descent::Now(Scope::Page { depth: 4 }));
        assert_eq!(descent(ControlType::Group, "", Scope::Page { depth: MAX_DOCUMENT_DEPTH }, false), Descent::Skip);
    }

    #[test]
    fn never_walks_word_or_excel_document_bodies() {
        assert!(has_text_documents("WINWORD"));
        assert!(has_text_documents("EXCEL"));
        assert!(!has_text_documents("brave"));
        assert_eq!(descent(ControlType::Document, "Book1", Scope::App, true), Descent::Skip);
    }

    #[test]
    fn keeps_explorer_rows_but_not_their_cells() {
        assert_eq!(descent(ControlType::List, "Items View", Scope::App, false), Descent::Now(Scope::ItemsView));
        assert_eq!(descent(ControlType::Group, "Today", Scope::ItemsView, false), Descent::Now(Scope::ItemsView));
        assert_eq!(descent(ControlType::ListItem, "beach.txt", Scope::ItemsView, false), Descent::Skip);
        assert_eq!(descent(ControlType::ListItem, "Standard Calculator", Scope::App, false), Descent::Now(Scope::App));
    }

    /// The first top-level window whose title contains `needle` (case-insensitive).
    fn window_titled(automation: &UIAutomation, needle: &str) -> Option<isize> {
        let root = automation.get_root_element().ok()?;
        let windows = root.find_all(TreeScope::Children, &automation.create_true_condition().ok()?).ok()?;
        let needle = needle.to_lowercase();
        let window = windows.into_iter().find(|w| w.get_name().map_or(false, |name| name.to_lowercase().contains(&needle)))?;
        window.get_native_window_handle().ok().map(Into::into)
    }

    /// Live check on this PC: `HODEUM_UIA_TITLE=<part of a window title> cargo test --lib live_read -- --ignored --nocapture`.
    /// HODEUM_UIA_GREP limits the printed lines and HODEUM_UIA_BUDGET_MS overrides the time budget.
    #[test]
    #[ignore]
    fn live_read_window_by_title() {
        // Physical pixels like the app (the test binary has no DPI manifest); exact on the primary monitor.
        // SAFETY: a process-wide flag set before any window or UIA call.
        let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::SetProcessDPIAware() };
        let title = std::env::var("HODEUM_UIA_TITLE").expect("set HODEUM_UIA_TITLE");
        let grep = std::env::var("HODEUM_UIA_GREP").ok().map(|g| g.to_lowercase());
        let reader = UiaReader::new().expect("UI Automation");
        let hwnd = window_titled(&reader.automation, &title).expect("no window with that title");
        let budget = std::env::var("HODEUM_UIA_BUDGET_MS").ok().and_then(|ms| ms.parse().ok()).map_or(WALK_BUDGET, Duration::from_millis);
        let (elements, handles, stats) = reader.read_with_stats(hwnd, None, budget).expect("read");
        for e in &elements {
            let pid = handles.get(&e.id).and_then(|h| h.pid);
            let b = e.bounds;
            let line = format!("[{}] '{}' checked={:?} selected={:?} container={:?} focused={:?} pid={pid:?} at={},{},{}x{}", e.role, e.name, e.checked, e.selected, e.container, e.focused, b.x, b.y, b.width, b.height);
            if grep.as_ref().map_or(true, |g| line.to_lowercase().contains(g)) {
                println!("{line}");
            }
        }
        println!("== hwnd={hwnd} {} reported, {stats:?}", elements.len());
    }

    /// Live check of Agent clicks in a Store app, whose controls live in another process than the frame:
    /// `HODEUM_UIA_TITLE=Calculator HODEUM_UIA_PRESS=Five cargo test --lib live_press -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_press_by_title() {
        const READ_AT: u64 = 1_000;
        // SAFETY: a process-wide flag set before any window or UIA call.
        let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::SetProcessDPIAware() };
        let title = std::env::var("HODEUM_UIA_TITLE").expect("set HODEUM_UIA_TITLE");
        let target = std::env::var("HODEUM_UIA_PRESS").expect("set HODEUM_UIA_PRESS");
        let reader = UiaReader::new().expect("UI Automation");
        let hwnd = window_titled(&reader.automation, &title).expect("no window with that title");
        let (elements, handles) = reader.read(hwnd, None).expect("read");
        let element = elements.iter().find(|e| e.name == target).expect("no control with that name");
        let frame_pid = foreground::window_pid(HWND(hwnd as *mut _));
        println!("frame pid {frame_pid}, control pid {:?}", handles.get(&element.id).and_then(|h| h.pid));
        reader.remember(Seen { at: READ_AT, pid: frame_pid, elements: handles });
        let request = PressRequest { element_id: element.id.clone(), name: target, observed_at: READ_AT, button: press::PressButton::Left };
        reader.press(&request, READ_AT).expect("press");
    }

    #[test]
    fn point_and_ask_skips_subtrees_outside_the_region() {
        let region = RectDto { x: 100.0, y: 100.0, width: 200.0, height: 100.0 };
        let far = RectDto { x: 600.0, y: 600.0, width: 50.0, height: 20.0 };
        let near = RectDto { x: 150.0, y: 120.0, width: 50.0, height: 20.0 };
        let popup_host = RectDto { x: 0.0, y: 0.0, width: 1.0, height: 1.0 };
        assert!(outside_region(Some(&region), Some(&far)));
        assert!(!outside_region(Some(&region), Some(&near)));
        assert!(!outside_region(Some(&region), Some(&popup_host)));
        assert!(!outside_region(None, Some(&far)));
        assert!(!outside_region(Some(&region), None));
    }
}
