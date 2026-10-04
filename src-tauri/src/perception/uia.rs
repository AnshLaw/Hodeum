use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use uiautomation::core::UICacheRequest;
use uiautomation::types::{ControlType, Handle, PropertyConditionFlags, ToggleState, TreeScope, UIProperty};
use uiautomation::variants::{Value, Variant};
use uiautomation::{UIAutomation, UIElement, UITreeWalker};
use windows::Win32::Foundation::HWND;

use super::foreground;
use super::model::{normalize_role, ElementDto, RectDto};
use super::press::{self, PressRequest, Seen, SeenElement};
use super::wanted::{already_read, unmatched, wanted_names};

pub const MAX_ELEMENTS: usize = 1500;
pub const MAX_DEPTH: usize = 40;
/// A web page gets its own, smaller allowance so a long page can't crowd out the app's own controls.
pub const MAX_DOCUMENT_ELEMENTS: usize = 250;
pub const MAX_DOCUMENT_DEPTH: usize = 25;
/// A read must not hold up the learner's next step: past this, what was read so far is returned.
pub const WALK_BUDGET: Duration = Duration::from_millis(400);
/// After a walk cut short, the time for searching out the wanted controls it didn't read, all names together.
/// A dialog that just opened, a shell view or a big ribbon can be slow to walk at first.
pub const SEARCH_BUDGET: Duration = Duration::from_millis(400);
/// UI Automation answers "nothing there" with an empty success, which the crate reports as an error of code 0.
const NOTHING_FOUND: i32 = 0;
pub(super) const UIA_CONFIDENCE: f64 = 0.95;
/// `UiElement.source` for everything read through UI Automation.
pub(super) const UIA_SOURCE: &str = "uia";
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

pub(super) fn err(e: uiautomation::Error) -> String {
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

/// What a walk reads of an element on its way down (see `Walk::visit` and `Walk::descend`).
#[derive(Debug, Clone)]
pub struct Waypoint {
    pub control_type: ControlType,
    pub name: String,
    pub class: String,
    pub offscreen: bool,
    pub bounds: Option<RectDto>,
}

/// Where a walk would have reported a searched-out control.
#[derive(Debug, PartialEq)]
pub struct Reached {
    pub container: Option<String>,
}

/// Replays the walk's rules down a searched-out control's ancestors, the window first: where the walk
/// would have reported the control, or None when the walk never reports it there (outside the asked-about
/// region, under an offscreen subtree, or among the cells, file-row details and document text it skips).
pub fn reach(path: &[Waypoint], region: Option<&RectDto>, text_documents: bool) -> Option<Reached> {
    let mut scope = Scope::App;
    let mut container: Option<String> = None;
    for waypoint in path {
        let size = waypoint.bounds.map(|b| (b.width as i32, b.height as i32));
        let (_, descends) = walk_decision(waypoint.offscreen, size, &waypoint.class);
        if outside_region(region, waypoint.bounds.as_ref()) || !descends {
            return None;
        }
        container = container_for(waypoint.control_type, &waypoint.class, &waypoint.name, container.as_deref());
        scope = match descent(waypoint.control_type, &waypoint.name, scope, text_documents) {
            Descent::Skip => return None,
            Descent::Now(next) | Descent::Later(next) => next,
        };
    }
    Some(Reached { container })
}

/// Owns a UI Automation client; must live on one MTA thread.
pub struct UiaReader {
    automation: UIAutomation,
    walker: UITreeWalker,
    cache: UICacheRequest,
    /// The same properties for all of an element's children, fetched in one cross-process call.
    children_cache: UICacheRequest,
    /// The walk's properties plus the runtime id, which picks the window out among a found control's ancestors.
    search_cache: UICacheRequest,
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

impl WalkStats {
    /// Whether the walk may have missed a control a search can find: its budget or element cap cut it short,
    /// or controls went away under it. A complete walk met every control a search would be allowed to add.
    pub fn incomplete(&self, reported: usize) -> bool {
        self.cut_by_budget || self.lost > 0 || reported >= MAX_ELEMENTS
    }
}

/// How a read's search went, for the log: counts only, never names, which can be the learner's own content.
#[derive(Debug, Default, Clone, Copy)]
pub struct SearchStats {
    /// Wanted names the walk hadn't read.
    pub missing: usize,
    /// Of those, the ones searched for before the search's budget ran out.
    pub searched: usize,
    /// Controls the search added to the read.
    pub found: usize,
    pub elapsed_ms: u128,
}

/// One read of a window: its elements by id, and how its walk and search went.
pub struct Read {
    pub elements: Vec<ElementDto>,
    pub handles: ReadElements,
    pub walk: WalkStats,
    pub search: SearchStats,
}

fn cache_request(automation: &UIAutomation, scope: TreeScope) -> Result<UICacheRequest, String> {
    let cache = automation.create_cache_request().map_err(err)?;
    for property in CACHED {
        cache.add_property(property).map_err(err)?;
    }
    cache.set_tree_scope(scope).map_err(err)?;
    Ok(cache)
}

fn search_cache_request(automation: &UIAutomation) -> Result<UICacheRequest, String> {
    let cache = cache_request(automation, TreeScope::Element)?;
    cache.add_property(UIProperty::RuntimeId).map_err(err)?;
    Ok(cache)
}

impl UiaReader {
    pub fn new() -> Result<Self, String> {
        let automation = UIAutomation::new().map_err(err)?;
        let walker = automation.get_control_view_walker().map_err(err)?;
        // A new cache request's tree filter is the control view, matching the walker.
        let cache = cache_request(&automation, TreeScope::Element)?;
        let children_cache = cache_request(&automation, TreeScope::Children)?;
        let search_cache = search_cache_request(&automation)?;
        Ok(Self { automation, walker, cache, children_cache, search_cache, seen: RefCell::new(None) })
    }

    /// Reads the window's controls. `want` names controls (the current lesson step's) to search out if the walk
    /// is cut short before reading them. Logs when the walk's budget cut it short, and what a search found.
    pub fn read(&self, hwnd: isize, region: Option<RectDto>, want: &[String]) -> Result<(Vec<ElementDto>, ReadElements), String> {
        let read = self.read_with_stats(hwnd, region, want, WALK_BUDGET)?;
        if read.walk.cut_by_budget {
            let walked = read.elements.len() - read.search.found;
            log::info!("UIA read stopped at its {} ms budget: {walked} elements from {} visited", WALK_BUDGET.as_millis(), read.walk.visited);
        }
        if read.search.missing > 0 {
            let SearchStats { missing, searched, found, elapsed_ms } = read.search;
            log::info!("UIA search found {found} of {missing} wanted controls the walk missed, searching {searched} in {elapsed_ms} ms (budget {} ms)", SEARCH_BUDGET.as_millis());
        }
        Ok((read.elements, read.handles))
    }

    /// Depth-first walk of the window's control view, one batched request per parent; when the walk is cut
    /// short, a search for the `want`ed names it didn't read.
    pub fn read_with_stats(&self, hwnd: isize, region: Option<RectDto>, want: &[String], budget: Duration) -> Result<Read, String> {
        let started = Instant::now();
        let root = self.automation.element_from_handle(Handle::from(hwnd)).map_err(err)?;
        let root = root.build_updated_cache(&self.cache).map_err(err)?;
        let mut walk = Walk::new(self, region, text_documents(hwnd), started + budget);
        walk.stack.push(Node { element: root.clone(), depth: 0, scope: Scope::App, container: None });
        walk.run();
        walk.stats.elapsed_ms = started.elapsed().as_millis();
        let search = if walk.stats.incomplete(walk.out.len()) { walk.search_out(&root, &wanted_names(want), SEARCH_BUDGET) } else { SearchStats::default() };
        Ok(Read { elements: walk.out, handles: walk.handles, walk: walk.stats, search })
    }

    /// The client, for reads outside the learner's window (the taskbar).
    pub fn automation(&self) -> &UIAutomation {
        &self.automation
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

    /// The first on-screen control below `root` named `name` (in any case): one UI Automation search instead of
    /// a walk, cached like a walked control.
    fn find_on_screen(&self, root: &UIElement, name: &str) -> uiautomation::Result<Option<UIElement>> {
        let named = self.automation.create_property_condition(UIProperty::Name, Variant::from(name), Some(PropertyConditionFlags::IgnoreCase))?;
        let on_screen = self.automation.create_property_condition(UIProperty::IsOffscreen, Variant::from(false), None)?;
        let condition = self.automation.create_and_condition(named, on_screen)?;
        found(root.find_first_build_cache(TreeScope::Descendants, &condition, &self.search_cache))
    }

    /// `hit`'s ancestors as a walk meets them, the window first; None when the window isn't among the first
    /// MAX_DEPTH of them (the walk goes no deeper) or isn't an ancestor at all (the window changed meanwhile).
    fn ancestry(&self, hit: &UIElement, window_id: &[i32]) -> uiautomation::Result<Option<Vec<Waypoint>>> {
        let mut path = Vec::new();
        let mut current = hit.clone();
        while path.len() < MAX_DEPTH {
            let Some(parent) = found(self.walker.get_parent_build_cache(&current, &self.search_cache))? else {
                return Ok(None);
            };
            path.push(Waypoint::of(&parent));
            if cached_runtime_id(&parent).as_deref() == Some(window_id) {
                path.reverse();
                return Ok(Some(path));
            }
            current = parent;
        }
        Ok(None)
    }
}

/// A lookup's element, or None when UI Automation found nothing there.
fn found(result: uiautomation::Result<UIElement>) -> uiautomation::Result<Option<UIElement>> {
    match result {
        Ok(element) => Ok(Some(element)),
        Err(error) if error.code() == NOTHING_FOUND => Ok(None),
        Err(error) => Err(error),
    }
}

fn cached_runtime_id(element: &UIElement) -> Option<Vec<i32>> {
    match element.get_cached_property_value(UIProperty::RuntimeId).ok()?.get_value().ok()? {
        Value::ArrayI4(id) => Some(id),
        _ => None,
    }
}

/// The window's runtime id, to pick it out among a found control's ancestors; None (logged) when it's gone.
fn window_id(root: &UIElement) -> Option<Vec<i32>> {
    match root.get_runtime_id() {
        Ok(id) => Some(id),
        Err(error) => {
            log::warn!("couldn't identify the window to search it for the step's controls: {error}");
            None
        }
    }
}

impl Waypoint {
    fn of(element: &UIElement) -> Self {
        Self {
            control_type: element.get_cached_control_type().unwrap_or(ControlType::Custom),
            name: element.get_cached_name().unwrap_or_default(),
            class: element.get_cached_classname().unwrap_or_default(),
            offscreen: element.is_cached_offscreen().unwrap_or(true),
            bounds: element.get_cached_bounding_rectangle().ok().map(|r| rect_dto(&r)),
        }
    }
}

fn text_documents(hwnd: isize) -> bool {
    match foreground::exe_stem(HWND(hwnd as *mut _)) {
        Ok(stem) => has_text_documents(&stem),
        Err(error) => {
            log::warn!("couldn't read the app's process name, so its documents are walked: {error}");
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
        self.keep(&node.element, dto);
        if in_page {
            self.page_reported += 1;
        }
    }

    /// Adds an element to the read, with its handle so Agent · Do it for me can press it.
    fn keep(&mut self, element: &UIElement, dto: ElementDto) {
        let pid = element.get_cached_process_id().ok().and_then(|pid| u32::try_from(pid).ok());
        self.handles.insert(dto.id.clone(), SeenElement { element: element.clone(), bounds: dto.bounds, pid });
        self.out.push(dto);
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

/// After a walk cut short: searching out the wanted controls it didn't read.
impl Walk<'_> {
    /// Searches the window for each `wanted` name the walk didn't read, adding the first on-screen control of
    /// that name the walk would have reported had it had the time. No new search starts after `budget`.
    fn search_out(&mut self, root: &UIElement, wanted: &[String], budget: Duration) -> SearchStats {
        let started = Instant::now();
        let missing = unmatched(wanted, &self.out);
        let mut stats = SearchStats { missing: missing.len(), ..SearchStats::default() };
        let window = if missing.is_empty() { None } else { window_id(root) };
        if let Some(window) = window {
            for name in missing {
                if started.elapsed() >= budget {
                    break;
                }
                stats.searched += 1;
                stats.found += usize::from(self.search_one(root, &window, name));
            }
        }
        stats.elapsed_ms = started.elapsed().as_millis();
        stats
    }

    /// Adds the first on-screen control named `name` when the walk would have reported it where it is.
    fn search_one(&mut self, root: &UIElement, window: &[i32], name: &str) -> bool {
        let hit = match self.reader.find_on_screen(root, name) {
            Ok(Some(hit)) => hit,
            Ok(None) => return false,
            Err(error) => {
                log::warn!("UIA search for one of the step's controls failed: {error}");
                return false;
            }
        };
        let path = match self.reader.ancestry(&hit, window) {
            Ok(Some(path)) => path,
            Ok(None) => return false,
            Err(error) => {
                log::warn!("couldn't read where a found control sits in the window: {error}");
                return false;
            }
        };
        let Some(reached) = reach(&path, self.region.as_ref(), self.text_documents) else { return false };
        self.add_found(&hit, reached.container)
    }

    /// The found control, built like a walked one, unless it is offscreen, outside the region or already read.
    fn add_found(&mut self, hit: &UIElement, container: Option<String>) -> bool {
        if hit.is_cached_offscreen().unwrap_or(true) {
            return false;
        }
        self.sequence += 1;
        let Some(dto) = describe(hit, self.sequence, container.as_deref()) else { return false };
        let outside = self.region.map_or(false, |region| !region.intersects(&dto.bounds));
        if outside || already_read(&self.out, &dto) {
            return false;
        }
        self.keep(hit, dto);
        true
    }
}

pub(super) fn rect_dto(rect: &uiautomation::types::Rect) -> RectDto {
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
        source: UIA_SOURCE,
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
    /// HODEUM_UIA_GREP limits the printed lines and HODEUM_UIA_BUDGET_MS overrides the walk's time budget.
    /// HODEUM_UIA_WANT (comma-separated: "File name:,Save") names controls to search out when the walk is cut
    /// short; a budget of 1 ms cuts it short.
    #[test]
    #[ignore]
    fn live_read_window_by_title() {
        // Physical pixels like the app (the test binary has no DPI manifest); exact on the primary monitor.
        // SAFETY: a process-wide flag set before any window or UIA call.
        let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::SetProcessDPIAware() };
        let title = std::env::var("HODEUM_UIA_TITLE").expect("set HODEUM_UIA_TITLE");
        let grep = std::env::var("HODEUM_UIA_GREP").ok().map(|g| g.to_lowercase());
        let want: Vec<String> = std::env::var("HODEUM_UIA_WANT").map(|names| names.split(',').map(str::to_string).collect()).unwrap_or_default();
        let reader = UiaReader::new().expect("UI Automation");
        let hwnd = window_titled(&reader.automation, &title).expect("no window with that title");
        let budget = std::env::var("HODEUM_UIA_BUDGET_MS").ok().and_then(|ms| ms.parse().ok()).map_or(WALK_BUDGET, Duration::from_millis);
        let read = reader.read_with_stats(hwnd, None, &want, budget).expect("read");
        for e in &read.elements {
            let pid = read.handles.get(&e.id).and_then(|h| h.pid);
            let b = e.bounds;
            let line = format!("{} [{}] '{}' checked={:?} selected={:?} container={:?} focused={:?} pid={pid:?} at={},{},{}x{}", e.id, e.role, e.name, e.checked, e.selected, e.container, e.focused, b.x, b.y, b.width, b.height);
            if grep.as_ref().map_or(true, |g| line.to_lowercase().contains(g)) {
                println!("{line}");
            }
        }
        println!("== hwnd={hwnd} {} reported, {:?}, {:?}", read.elements.len(), read.walk, read.search);
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
        let (elements, handles) = reader.read(hwnd, None, &[]).expect("read");
        let element = elements.iter().find(|e| e.name == target).expect("no control with that name");
        let frame_pid = foreground::window_pid(HWND(hwnd as *mut _));
        println!("frame pid {frame_pid}, control pid {:?}", handles.get(&element.id).and_then(|h| h.pid));
        reader.remember(Seen { at: READ_AT, pid: frame_pid, elements: handles });
        let request = PressRequest { element_id: element.id.clone(), name: target, observed_at: READ_AT, button: press::PressButton::Left };
        reader.press(&request, READ_AT).expect("press");
    }

    const SCREEN: RectDto = RectDto { x: 0.0, y: 0.0, width: 1280.0, height: 800.0 };

    fn waypoint(control_type: ControlType, name: &str, class: &str) -> Waypoint {
        Waypoint { control_type, name: name.into(), class: class.into(), offscreen: false, bounds: Some(SCREEN) }
    }

    fn container_at(path: &[Waypoint]) -> Option<String> {
        reach(path, None, false).expect("reached").container
    }

    #[test]
    fn a_searched_out_control_sits_where_the_walk_would_have_put_it() {
        let dialog = [waypoint(ControlType::Window, "Save As", "#32770"), waypoint(ControlType::Pane, "", "DUIViewWndClassName"), waypoint(ControlType::ComboBox, "File name:", "AppControlHost")];
        assert_eq!(reach(&dialog, None, false), Some(Reached { container: None }));
        assert_eq!(container_at(&[waypoint(ControlType::Window, "Untitled - Notepad", "Notepad"), waypoint(ControlType::TitleBar, "", "")]).as_deref(), Some("title bar"));
        assert_eq!(container_at(&[waypoint(ControlType::Window, "Settings", ""), waypoint(ControlType::Group, "Choose your mode", "")]).as_deref(), Some("Choose your mode"));
        assert_eq!(container_at(&[waypoint(ControlType::Window, "YouTube - Brave", "Chrome_WidgetWin_1"), waypoint(ControlType::Document, "YouTube", "")]).as_deref(), Some("page"));
    }

    #[test]
    fn never_adds_what_the_walk_skips_on_purpose() {
        let window = waypoint(ControlType::Window, "Book1 - Excel", "XLMAIN");
        // A column heading named like a field ("Region") inside the sheet's grid.
        assert_eq!(reach(&[window.clone(), waypoint(ControlType::DataGrid, "Grid", "")], None, false), None);
        // A file row's details in Explorer, and Word's or Excel's document body.
        assert_eq!(reach(&[window.clone(), waypoint(ControlType::List, "Items View", ""), waypoint(ControlType::ListItem, "beach.zip", "")], None, false), None);
        assert_eq!(reach(&[window, waypoint(ControlType::Document, "Book1", "")], None, true), None);
    }

    #[test]
    fn never_adds_a_control_under_a_hidden_subtree_but_finds_open_menus() {
        let window = waypoint(ControlType::Window, "Untitled - Notepad", "Notepad");
        let hidden = Waypoint { offscreen: true, bounds: Some(RectDto { x: 0.0, y: 0.0, width: 400.0, height: 300.0 }), ..waypoint(ControlType::Pane, "", "") };
        assert_eq!(reach(&[window.clone(), hidden], None, false), None);
        let popup_host = Waypoint { offscreen: true, bounds: Some(RectDto { x: 0.0, y: 0.0, width: 1.0, height: 1.0 }), ..waypoint(ControlType::Window, "", "Popup") };
        assert!(reach(&[window, popup_host, waypoint(ControlType::Menu, "File", "")], None, false).is_some());
    }

    #[test]
    fn keeps_a_searched_out_control_to_the_asked_about_region() {
        let region = RectDto { x: 0.0, y: 0.0, width: 100.0, height: 100.0 };
        let window = waypoint(ControlType::Window, "Untitled - Notepad", "Notepad");
        let far = Waypoint { bounds: Some(RectDto { x: 600.0, y: 600.0, width: 200.0, height: 100.0 }), ..waypoint(ControlType::Pane, "", "") };
        assert_eq!(reach(&[window.clone(), far], Some(&region), false), None);
        assert!(reach(&[window], Some(&region), false).is_some());
    }

    #[test]
    fn only_a_walk_cut_short_can_have_missed_a_control() {
        let complete = WalkStats { visited: 79, lost: 0, cut_by_budget: false, elapsed_ms: 120 };
        assert!(!complete.incomplete(79));
        assert!(WalkStats { cut_by_budget: true, ..complete }.incomplete(16));
        assert!(WalkStats { lost: 1, ..complete }.incomplete(78));
        assert!(complete.incomplete(MAX_ELEMENTS));
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
