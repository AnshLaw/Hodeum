//! The taskbar's Start button and search box, and the search box of an open Start menu or Search, read
//! through UI Automation although the taskbar is never the learner's window, so Hodey can point at where
//! to find an app.
//!
//! Measured on Windows 11 25H2 (dev PC, search box mode, two monitors): each taskbar's XAML island
//! ("Windows.UI.Input.InputSite.WindowClass") holds a "TaskbarFrame" pane whose children include the Button
//! "Start" (AutomationId "StartButton") and the Button "Search" ("SearchButton", 441x65 px as a box). A closed
//! Start menu and Search are cloaked CoreWindows; open, Start's search box is the Button "Search for apps,
//! settings, and documents" ("SearchBoxToggleButton") and Search's the Edit "Search box" ("SearchTextBox").
//! Windows 10's are Win32 children of the taskbar: class "Start", and a "TrayButton" named "Type here to
//! search" (or "Search" as an icon). Reading the island directly took 10-20 ms; a whole-subtree read of the
//! taskbar took 85-400 ms, almost all of it in the Win32 tray and task list.

use std::time::Instant;

use uiautomation::core::{UICacheRequest, UICondition};
use uiautomation::types::{ControlType, Handle, PropertyConditionFlags, TreeScope, UIProperty};
use uiautomation::variants::Variant;
use uiautomation::{UIAutomation, UIElement};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowRect, IsWindowVisible};

use super::foreground::{exe_stem, monitor_rect};
use super::model::{normalize_role, ElementDto, RectDto};
use super::uia::{err, rect_dto, type_role, UIA_CONFIDENCE, UIA_SOURCE};

/// A shell control Hodey can point at to find an app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// The taskbar's Start button.
    Start,
    /// The taskbar's search box, or its search button when the taskbar shows only the icon.
    Search,
    /// The search box of an open Start menu or Search.
    FlyoutSearch(Flyout),
}

/// A shell window that opens over the desktop with a search box of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flyout {
    StartMenu,
    Search,
}

/// One element as UI Automation described it.
#[derive(Debug, Clone, PartialEq)]
pub struct Seen {
    pub automation_id: String,
    pub class: String,
    pub name: String,
    pub control_type: ControlType,
    pub localized_type: String,
    pub bounds: RectDto,
    pub offscreen: bool,
    pub focused: bool,
}

/// The primary taskbar's number; the others count up from 2, left to right.
const PRIMARY: usize = 1;
const ID_PREFIX: &str = "shell:";
const TASKBAR: &str = "taskbar";
const START_MENU: &str = "Start menu";
const SEARCH_FLYOUT: &str = "Search";
const START_NAME: &str = "Start";
const SEARCH_NAME: &str = "Search";
/// Smaller than this (physical px) on either side is a layout host, not a control (closed menus report 1x1).
const MIN_SIDE_PX: f64 = 2.0;
/// Windows 11's Start button.
const START_ID: &str = "StartButton";
/// Windows 10's Start button is a Win32 window of this class.
const WIN10_START_CLASS: &str = "Start";
/// Windows 10's search box, Task View and Cortana buttons are all of this class; the name tells them apart.
const WIN10_TRAY_BUTTON_CLASS: &str = "TrayButton";
/// Windows 11's pinned and running apps: their AppIds can contain any word ("Search").
const TASK_LIST_ID_PREFIX: &str = "Appid:";
const TASK_LIST_CLASS: &str = "Taskbar.TaskListButtonAutomationPeer";
/// What a search control's AutomationId (Windows 11) or name (Windows 10, any flyout) contains.
const SEARCH_WORD: &str = "search";
/// Bing's picture of the day beside the search box ("SearchGleamButton"): not the box.
const GLEAM_WORD: &str = "gleam";
/// Kinds of control a search box is drawn as; its label and gleam picture are Text and Image.
const SEARCH_BOX_TYPES: [ControlType; 4] = [ControlType::Button, ControlType::SplitButton, ControlType::Edit, ControlType::ComboBox];
/// Start's search box (a button that hands over to Search) and Search's text box.
const FLYOUT_SEARCH_IDS: [&str; 2] = ["SearchBoxToggleButton", "SearchTextBox"];
/// Executable stems (lowercase) of the Start menu and of Search (Windows 11, Windows 10, Windows 10 with Cortana).
const START_MENU_PROCESSES: [&str; 1] = ["startmenuexperiencehost"];
const SEARCH_PROCESSES: [&str; 3] = ["searchhost", "searchapp", "searchui"];
/// Windows 11's taskbar draws its buttons in a XAML island: this child window, then its TaskbarFrame pane.
const ISLAND_CLASS: &str = "Windows.UI.Input.InputSite.WindowClass";
const FRAME_ID: &str = "TaskbarFrame";
/// Past this, a read is logged as slow.
const SLOW_READ_MS: u128 = 150;
/// Only what a target needs, fetched with the query that finds it.
const CACHED: [UIProperty; 8] = [
    UIProperty::AutomationId,
    UIProperty::ClassName,
    UIProperty::Name,
    UIProperty::ControlType,
    UIProperty::LocalizedControlType,
    UIProperty::BoundingRectangle,
    UIProperty::IsOffscreen,
    UIProperty::HasKeyboardFocus,
];

fn mentions(text: &str, word: &str) -> bool {
    text.to_lowercase().contains(word)
}

fn is_task_list_button(seen: &Seen) -> bool {
    seen.automation_id.starts_with(TASK_LIST_ID_PREFIX) || seen.class == TASK_LIST_CLASS
}

/// Which taskbar control this is, if it's one Hodey points at. Windows 11 is told by AutomationId, Windows 10
/// by class and (for the search box among its tray buttons) by name.
pub fn taskbar_target(seen: &Seen) -> Option<Target> {
    let id = seen.automation_id.as_str();
    if id == START_ID || seen.class == WIN10_START_CLASS {
        return Some(Target::Start);
    }
    if is_task_list_button(seen) || !SEARCH_BOX_TYPES.contains(&seen.control_type) {
        return None;
    }
    let windows_11 = mentions(id, SEARCH_WORD) && !mentions(id, GLEAM_WORD);
    let windows_10 = seen.class == WIN10_TRAY_BUTTON_CLASS && mentions(&seen.name, SEARCH_WORD);
    (windows_11 || windows_10).then_some(Target::Search)
}

/// The box an open Start menu or Search types into.
pub fn is_flyout_search_box(seen: &Seen) -> bool {
    FLYOUT_SEARCH_IDS.contains(&seen.automation_id.as_str())
        || (seen.control_type == ControlType::Edit && (mentions(&seen.automation_id, SEARCH_WORD) || mentions(&seen.name, SEARCH_WORD)))
}

/// On screen with a real size: an auto-hidden taskbar's buttons and a hidden search box are not.
pub fn on_screen(seen: &Seen) -> bool {
    !seen.offscreen && seen.bounds.width >= MIN_SIDE_PX && seen.bounds.height >= MIN_SIDE_PX
}

/// Whether the middle of `bounds` is on `area`. An auto-hidden taskbar slides off its monitor, leaving a 2 px
/// sliver, while UI Automation may still call its buttons on screen.
pub fn centre_within(bounds: &RectDto, area: &RectDto) -> bool {
    let (x, y) = (bounds.x + bounds.width / 2.0, bounds.y + bounds.height / 2.0);
    x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height
}

/// One taskbar's Start button and search box: the first of each on screen, Start first.
pub fn pick_taskbar(seen: &[Seen]) -> Vec<(Target, &Seen)> {
    let mut picked: Vec<(Target, &Seen)> = Vec::new();
    for (target, candidate) in seen.iter().filter(|s| on_screen(s)).filter_map(|s| taskbar_target(s).map(|t| (t, s))) {
        if !picked.iter().any(|(known, _)| *known == target) {
            picked.push((target, candidate));
        }
    }
    picked.sort_by_key(|(target, _)| *target != Target::Start);
    picked
}

/// "shell:start", "shell:search" (the primary taskbar's), "shell:search:2" (another monitor's), and the
/// flyouts' "shell:start-menu-search" and "shell:search-box".
pub fn target_id(target: Target, taskbar: usize) -> String {
    let kind = match target {
        Target::Start => "start",
        Target::Search => "search",
        Target::FlyoutSearch(Flyout::StartMenu) => "start-menu-search",
        Target::FlyoutSearch(Flyout::Search) => "search-box",
    };
    match target {
        Target::Start | Target::Search if taskbar > PRIMARY => format!("{ID_PREFIX}{kind}:{taskbar}"),
        _ => format!("{ID_PREFIX}{kind}"),
    }
}

fn container_of(target: Target) -> &'static str {
    match target {
        Target::Start | Target::Search => TASKBAR,
        Target::FlyoutSearch(Flyout::StartMenu) => START_MENU,
        Target::FlyoutSearch(Flyout::Search) => SEARCH_FLYOUT,
    }
}

/// The target as the web side's `UiElement`, like any other UI Automation element; None when it isn't on screen.
pub fn element(target: Target, taskbar: usize, seen: &Seen) -> Option<ElementDto> {
    if !on_screen(seen) {
        return None;
    }
    let name = seen.name.trim();
    let fallback = if target == Target::Start { START_NAME } else { SEARCH_NAME };
    Some(ElementDto {
        id: target_id(target, taskbar),
        name: if name.is_empty() { fallback } else { name }.to_string(),
        role: normalize_role(type_role(seen.control_type), &seen.localized_type),
        bounds: seen.bounds,
        source: UIA_SOURCE,
        confidence: UIA_CONFIDENCE,
        selected: None,
        checked: None,
        container: Some(container_of(target).to_string()),
        focused: seen.focused.then_some(true),
    })
}

/// Which flyout a shell CoreWindow is, by its process's executable stem.
pub fn flyout_of_exe(exe: &str) -> Option<Flyout> {
    let exe = exe.to_ascii_lowercase();
    if START_MENU_PROCESSES.contains(&exe.as_str()) {
        Some(Flyout::StartMenu)
    } else if SEARCH_PROCESSES.contains(&exe.as_str()) {
        Some(Flyout::Search)
    } else {
        None
    }
}

/// The primary taskbar first, then the others by where they sit (left to right, then top to bottom).
pub fn ordered<T>(primary: Option<T>, mut secondary: Vec<(T, (i32, i32))>) -> Vec<T> {
    secondary.sort_by_key(|(_, origin)| *origin);
    primary.into_iter().chain(secondary.into_iter().map(|(taskbar, _)| taskbar)).collect()
}

/// Why there is nothing to point at, from how many taskbars there are and how many Start or search controls
/// they have (on screen or not).
pub fn nothing_found_reason(taskbars: usize, recognised: usize) -> &'static str {
    match (taskbars, recognised) {
        (0, _) => "there's no taskbar window (Explorer may be restarting)",
        (_, 0) => "the taskbar has no Start button or search box Hodey recognises",
        _ => "the taskbar's buttons are off screen (auto-hidden, or under a full-screen app)",
    }
}

/// Top-level windows of `class`, in z-order. Stops at the first miss (FindWindowEx's "no more").
fn top_level_windows(class: PCWSTR) -> Vec<HWND> {
    let mut found = Vec::new();
    let mut after: Option<HWND> = None;
    // SAFETY: FindWindowExW takes any handle as the starting point and a static class name.
    while let Ok(hwnd) = unsafe { FindWindowExW(None, after, class, PCWSTR::null()) } {
        found.push(hwnd);
        after = Some(hwnd);
    }
    found
}

/// Where a window's top-left corner is, for ordering taskbars; unknown ones go last.
fn window_origin(hwnd: HWND) -> (i32, i32) {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid out-parameter; GetWindowRect tolerates stale handles.
    match unsafe { GetWindowRect(hwnd, &mut rect) } {
        Ok(()) => (rect.left, rect.top),
        Err(error) => {
            log::warn!("couldn't read where a taskbar is: {error}");
            (i32::MAX, i32::MAX)
        }
    }
}

/// The primary taskbar, then those on other monitors.
fn taskbars() -> Vec<HWND> {
    let primary = top_level_windows(w!("Shell_TrayWnd")).into_iter().next();
    let secondary = top_level_windows(w!("Shell_SecondaryTrayWnd")).into_iter().map(|hwnd| (hwnd, window_origin(hwnd))).collect();
    ordered(primary, secondary)
}

/// Shown: visible and not cloaked. Start and Search stay visible while closed, cloaked by the shell.
fn is_shown(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    // SAFETY: both calls tolerate stale handles; `cloaked` is a u32 out-parameter of the size passed.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return false;
        }
        if let Err(error) = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), std::mem::size_of::<u32>() as u32) {
            log::warn!("couldn't read whether a shell window is cloaked: {error}");
            return false;
        }
    }
    cloaked == 0
}

fn flyout_of_window(hwnd: HWND) -> Option<Flyout> {
    match exe_stem(hwnd) {
        Ok(exe) => flyout_of_exe(&exe),
        Err(error) => {
            log::warn!("couldn't read which process owns a shell window: {error}");
            None
        }
    }
}

/// The Start menu and Search windows that are open now.
fn open_flyouts() -> Vec<(Flyout, HWND)> {
    top_level_windows(w!("Windows.UI.Core.CoreWindow"))
        .into_iter()
        .filter(|hwnd| is_shown(*hwnd))
        .filter_map(|hwnd| flyout_of_window(hwnd).map(|flyout| (flyout, hwnd)))
        .collect()
}

/// A query's answer. UI Automation reports "nothing matched" as a null result, which arrives as an error
/// with a non-negative code; only negative codes (HRESULTs) are failures.
fn matched<T>(result: uiautomation::Result<T>) -> Result<Option<T>, String> {
    match result {
        Ok(found) => Ok(Some(found)),
        Err(error) if error.code() >= 0 => Ok(None),
        Err(error) => Err(err(error)),
    }
}

fn target_cache(automation: &UIAutomation) -> Result<UICacheRequest, String> {
    let cache = automation.create_cache_request().map_err(err)?;
    for property in CACHED {
        cache.add_property(property).map_err(err)?;
    }
    cache.set_tree_scope(TreeScope::Element).map_err(err)?;
    Ok(cache)
}

fn equals(automation: &UIAutomation, property: UIProperty, value: &str) -> Result<UICondition, String> {
    automation.create_property_condition(property, Variant::from(value), None).map_err(err)
}

/// Case-insensitive substring match (Windows 10 1809 and later).
fn contains(automation: &UIAutomation, property: UIProperty, value: &str) -> Result<UICondition, String> {
    automation.create_property_condition(property, Variant::from(value), Some(PropertyConditionFlags::All)).map_err(err)
}

fn any_of(automation: &UIAutomation, conditions: Vec<UICondition>) -> Result<UICondition, String> {
    let mut conditions = conditions.into_iter();
    let first = conditions.next().ok_or("a query needs at least one condition")?;
    conditions.try_fold(first, |all, next| automation.create_or_condition(all, next).map_err(err))
}

/// Anything on a taskbar that might be the Start button or search; `taskbar_target` decides.
fn taskbar_query(automation: &UIAutomation) -> Result<UICondition, String> {
    any_of(
        automation,
        vec![
            equals(automation, UIProperty::AutomationId, START_ID)?,
            contains(automation, UIProperty::AutomationId, SEARCH_WORD)?,
            equals(automation, UIProperty::ClassName, WIN10_START_CLASS)?,
            equals(automation, UIProperty::ClassName, WIN10_TRAY_BUTTON_CLASS)?,
        ],
    )
}

/// An open flyout's search box: its known ids, or an edit box about searching.
fn flyout_query(automation: &UIAutomation) -> Result<UICondition, String> {
    let edit = automation.create_property_condition(UIProperty::ControlType, Variant::from(ControlType::Edit as i32), None).map_err(err)?;
    let about_search = any_of(automation, vec![contains(automation, UIProperty::AutomationId, SEARCH_WORD)?, contains(automation, UIProperty::Name, SEARCH_WORD)?])?;
    let search_edit = automation.create_and_condition(edit, about_search).map_err(err)?;
    let mut known = FLYOUT_SEARCH_IDS.iter().map(|id| equals(automation, UIProperty::AutomationId, id)).collect::<Result<Vec<_>, _>>()?;
    known.push(search_edit);
    any_of(automation, known)
}

fn seen_of(element: &UIElement) -> Seen {
    let bounds = element.get_cached_bounding_rectangle().map(|rect| rect_dto(&rect));
    Seen {
        automation_id: element.get_cached_automation_id().unwrap_or_default(),
        class: element.get_cached_classname().unwrap_or_default(),
        name: element.get_cached_name().unwrap_or_default(),
        control_type: element.get_cached_control_type().unwrap_or(ControlType::Custom),
        localized_type: element.get_cached_localized_control_type().unwrap_or_default(),
        // No box or no screen state: treated as not on screen, so it's never pointed at.
        bounds: bounds.unwrap_or(RectDto { x: 0.0, y: 0.0, width: 0.0, height: 0.0 }),
        offscreen: element.is_cached_offscreen().unwrap_or(true),
        focused: element.has_cached_keyboard_focus().unwrap_or(false),
    }
}

/// Where a taskbar's buttons are and how deep to look: Windows 11's TaskbarFrame (found through its island
/// window, so Windows 10's slow Win32 children are never searched), else the island, else the taskbar itself.
fn button_parent(automation: &UIAutomation, taskbar: UIElement) -> Result<(UIElement, TreeScope), String> {
    let Some(island) = matched(taskbar.find_first(TreeScope::Children, &equals(automation, UIProperty::ClassName, ISLAND_CLASS)?))? else {
        return Ok((taskbar, TreeScope::Children));
    };
    match matched(island.find_first(TreeScope::Descendants, &equals(automation, UIProperty::AutomationId, FRAME_ID)?))? {
        Some(frame) => Ok((frame, TreeScope::Children)),
        None => Ok((island, TreeScope::Descendants)),
    }
}

/// The monitor a taskbar belongs to, in physical px.
fn taskbar_monitor(taskbar: HWND) -> Option<RectDto> {
    let monitor = monitor_rect(taskbar);
    if monitor.is_none() {
        log::warn!("couldn't read which monitor a taskbar is on, so an auto-hidden one can't be told apart");
    }
    monitor.map(|m| RectDto { x: f64::from(m.x), y: f64::from(m.y), width: f64::from(m.width), height: f64::from(m.height) })
}

/// A taskbar's controls that might be its Start button or search box; those past its monitor's edge count as off screen.
fn taskbar_candidates(automation: &UIAutomation, taskbar: HWND) -> Result<Vec<Seen>, String> {
    let root = automation.element_from_handle(Handle::from(taskbar.0 as isize)).map_err(err)?;
    let (parent, scope) = button_parent(automation, root)?;
    let found = matched(parent.find_all_build_cache(scope, &taskbar_query(automation)?, &target_cache(automation)?))?;
    let monitor = taskbar_monitor(taskbar);
    let mark_hidden = |mut seen: Seen| {
        seen.offscreen |= monitor.as_ref().is_some_and(|area| !centre_within(&seen.bounds, area));
        seen
    };
    Ok(found.unwrap_or_default().iter().map(seen_of).map(mark_hidden).collect())
}

/// Every taskbar's Start button and search box, and how many such controls they have on screen or not.
/// Failing to read the primary taskbar is an error; another monitor's is logged and skipped.
fn read_taskbars(automation: &UIAutomation, taskbars: &[HWND]) -> Result<(Vec<(Target, ElementDto)>, usize), String> {
    let mut targets = Vec::new();
    let mut recognised = 0;
    for (index, hwnd) in taskbars.iter().enumerate() {
        let number = index + PRIMARY;
        let seen = match taskbar_candidates(automation, *hwnd) {
            Ok(seen) => seen,
            Err(error) if number == PRIMARY => return Err(format!("Couldn't read the taskbar through UI Automation: {error}")),
            Err(error) => {
                log::warn!("couldn't read taskbar {number} (another monitor's): {error}");
                continue;
            }
        };
        recognised += seen.iter().filter(|s| taskbar_target(s).is_some()).count();
        targets.extend(pick_taskbar(&seen).into_iter().filter_map(|(target, s)| element(target, number, s).map(|dto| (target, dto))));
    }
    Ok((targets, recognised))
}

fn flyout_search_box(automation: &UIAutomation, window: HWND) -> Result<Option<Seen>, String> {
    let root = automation.element_from_handle(Handle::from(window.0 as isize)).map_err(err)?;
    let found = matched(root.find_first_build_cache(TreeScope::Descendants, &flyout_query(automation)?, &target_cache(automation)?))?;
    Ok(found.map(|element| seen_of(&element)).filter(is_flyout_search_box))
}

/// The search box of an open Start menu or Search, once each. One that closes mid-read is logged and skipped.
fn flyout_targets(automation: &UIAutomation) -> Vec<ElementDto> {
    let mut targets: Vec<ElementDto> = Vec::new();
    for (flyout, window) in open_flyouts() {
        let target = Target::FlyoutSearch(flyout);
        match flyout_search_box(automation, window) {
            Ok(Some(seen)) if !targets.iter().any(|known| known.id == target_id(target, PRIMARY)) => targets.extend(element(target, PRIMARY, &seen)),
            Ok(_) => {}
            Err(error) => log::warn!("couldn't read the open {flyout:?}'s search box: {error}"),
        }
    }
    targets
}

/// The taskbars' Start buttons and search boxes, and an open Start menu's or Search's search box, in
/// physical screen px. Empty, with the reason logged, when none is on screen; Err only when UI Automation fails.
pub fn read(automation: &UIAutomation) -> Result<Vec<ElementDto>, String> {
    let started = Instant::now();
    let taskbars = taskbars();
    let (on_taskbars, recognised) = read_taskbars(automation, &taskbars)?;
    let taskbar_search = on_taskbars.iter().any(|(target, _)| *target == Target::Search);
    let mut targets: Vec<ElementDto> = on_taskbars.into_iter().map(|(_, dto)| dto).collect();
    targets.extend(flyout_targets(automation));
    let elapsed = started.elapsed().as_millis();
    if elapsed > SLOW_READ_MS {
        log::warn!("reading the taskbar's Start button and search box took {elapsed} ms");
    }
    if targets.is_empty() {
        log::warn!("no Start button or search box to point at: {}", nothing_found_reason(taskbars.len(), recognised));
    } else if !taskbar_search {
        log::info!("the taskbar shows no search box or button (hidden in its settings?), so Hodey can point at Start but not search");
    }
    Ok(targets)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(automation_id: &str, class: &str, name: &str, control_type: ControlType, (x, y, width, height): (i32, i32, i32, i32)) -> Seen {
        Seen {
            automation_id: automation_id.into(),
            class: class.into(),
            name: name.into(),
            control_type,
            localized_type: String::new(),
            bounds: RectDto { x: f64::from(x), y: f64::from(y), width: f64::from(width), height: f64::from(height) },
            offscreen: false,
            focused: false,
        }
    }

    const BAR: (i32, i32, i32, i32) = (0, 1824, 89, 97);

    /// Windows 11 25H2 on the dev PC, search box mode, in tree order under TaskbarFrame.
    fn windows_11_taskbar() -> Vec<Seen> {
        vec![
            seen("WidgetsButton", "ToggleButton", "Widgets 47°F Mostly cloudy", ControlType::Button, (12, 1824, 305, 97)),
            seen("StartButton", "ToggleButton", "Start", ControlType::Button, (739, 1824, 91, 97)),
            seen("SearchButton", "ToggleButton", "Search", ControlType::Button, (833, 1840, 441, 65)),
            seen("TaskViewButton", "ToggleButton", "Task View", ControlType::Button, (1277, 1824, 89, 97)),
            seen("Appid: com.squirrel.Discord.Discord", "Taskbar.TaskListButtonAutomationPeer", "Discord - 1 running window", ControlType::Button, (1981, 1824, 89, 97)),
        ]
    }

    #[test]
    fn finds_windows_11_start_and_search_box() {
        let taskbar = windows_11_taskbar();
        let picked: Vec<_> = pick_taskbar(&taskbar).into_iter().map(|(target, seen)| (target, seen.automation_id.as_str())).collect();
        assert_eq!(picked, [(Target::Start, "StartButton"), (Target::Search, "SearchButton")]);
    }

    #[test]
    fn takes_windows_11_search_as_an_icon_or_a_box() {
        assert_eq!(taskbar_target(&seen("SearchButton", "ToggleButton", "Search", ControlType::Button, BAR)), Some(Target::Search));
        assert_eq!(taskbar_target(&seen("SearchBoxButton", "SearchBoxButton", "Search", ControlType::Button, BAR)), Some(Target::Search));
        assert_eq!(taskbar_target(&seen("SearchBox", "TextBox", "Type here to search", ControlType::Edit, BAR)), Some(Target::Search));
    }

    #[test]
    fn finds_windows_10_start_and_type_here_to_search() {
        assert_eq!(taskbar_target(&seen("", "Start", "Start", ControlType::Button, BAR)), Some(Target::Start));
        assert_eq!(taskbar_target(&seen("", "TrayButton", "Type here to search", ControlType::Button, BAR)), Some(Target::Search));
        assert_eq!(taskbar_target(&seen("", "TrayButton", "Search", ControlType::Button, BAR)), Some(Target::Search));
    }

    #[test]
    fn ignores_the_other_taskbar_buttons() {
        assert_eq!(taskbar_target(&seen("", "TrayButton", "Task View", ControlType::Button, BAR)), None);
        assert_eq!(taskbar_target(&seen("", "TrayButton", "Talk to Cortana", ControlType::Button, BAR)), None);
        assert_eq!(taskbar_target(&seen("TaskViewButton", "ToggleButton", "Task View", ControlType::Button, BAR)), None);
        assert_eq!(taskbar_target(&seen("SearchGleamButton", "Button", "Search - World Space Week", ControlType::Button, BAR)), None);
        assert_eq!(taskbar_target(&seen("SearchBoxTextBlock", "TextBlock", "Search", ControlType::Text, BAR)), None);
        assert_eq!(taskbar_target(&seen("Appid: voidtools.Everything.Search", "Taskbar.TaskListButtonAutomationPeer", "Search Everything pinned", ControlType::Button, BAR)), None);
    }

    #[test]
    fn skips_buttons_off_screen_or_without_a_size() {
        let mut hidden = windows_11_taskbar();
        hidden.iter_mut().for_each(|seen| seen.offscreen = true);
        assert!(pick_taskbar(&hidden).is_empty(), "an auto-hidden taskbar has nothing to point at");
        let mut no_search = windows_11_taskbar();
        no_search[2].bounds = RectDto { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
        let picked: Vec<_> = pick_taskbar(&no_search).into_iter().map(|(target, _)| target).collect();
        assert_eq!(picked, [Target::Start], "search hidden in the taskbar settings");
    }

    #[test]
    fn an_auto_hidden_taskbars_buttons_sit_past_the_screen_edge() {
        let main = RectDto { x: 0.0, y: 0.0, width: 3072.0, height: 1920.0 };
        assert!(centre_within(&RectDto { x: 739.0, y: 1824.0, width: 91.0, height: 97.0 }, &main));
        assert!(!centre_within(&RectDto { x: 739.0, y: 1918.0, width: 91.0, height: 97.0 }, &main), "slid down, a 2 px sliver left");
        assert!(!centre_within(&RectDto { x: -95.0, y: 400.0, width: 97.0, height: 91.0 }, &main), "slid left");
        let left_monitor = RectDto { x: -3200.0, y: 879.0, width: 3200.0, height: 1800.0 };
        assert!(centre_within(&RectDto { x: -2352.0, y: 2582.0, width: 91.0, height: 97.0 }, &left_monitor));
    }

    #[test]
    fn keeps_one_of_each_per_taskbar() {
        let mut twice = windows_11_taskbar();
        twice.push(seen("SearchButton", "ToggleButton", "Search", ControlType::Button, (2000, 1840, 441, 65)));
        let picked: Vec<_> = pick_taskbar(&twice).into_iter().map(|(target, seen)| (target, seen.bounds.x)).collect();
        assert_eq!(picked, [(Target::Start, 739.0), (Target::Search, 833.0)]);
    }

    #[test]
    fn finds_the_search_box_of_an_open_start_menu_or_search() {
        assert!(is_flyout_search_box(&seen("SearchTextBox", "RichEditBox", "Search box", ControlType::Edit, (921, 1840, 331, 65))));
        assert!(is_flyout_search_box(&seen("SearchBoxToggleButton", "ToggleButton", "Search for apps, settings, and documents", ControlType::Button, (760, 400, 1500, 70))));
        assert!(is_flyout_search_box(&seen("", "TextBox", "Search", ControlType::Edit, BAR)));
        assert!(!is_flyout_search_box(&seen("SearchBoxOnTaskbarGleamImage", "Image", "", ControlType::Image, BAR)));
        assert!(!is_flyout_search_box(&seen("ShowHideCompanion", "ToggleButton", "Mobile device", ControlType::Button, BAR)));
        assert!(!is_flyout_search_box(&seen("", "TextBox", "Rename", ControlType::Edit, BAR)));
    }

    #[test]
    fn names_the_start_and_search_flyouts_by_process() {
        assert_eq!(flyout_of_exe("StartMenuExperienceHost"), Some(Flyout::StartMenu));
        assert_eq!(flyout_of_exe("SearchHost"), Some(Flyout::Search));
        assert_eq!(flyout_of_exe("SearchApp"), Some(Flyout::Search));
        assert_eq!(flyout_of_exe("SearchUI"), Some(Flyout::Search));
        assert_eq!(flyout_of_exe("ShellExperienceHost"), None);
        assert_eq!(flyout_of_exe("explorer"), None);
    }

    #[test]
    fn gives_stable_shell_ids() {
        assert_eq!(target_id(Target::Start, 1), "shell:start");
        assert_eq!(target_id(Target::Search, 1), "shell:search");
        assert_eq!(target_id(Target::Start, 2), "shell:start:2");
        assert_eq!(target_id(Target::Search, 3), "shell:search:3");
        assert_eq!(target_id(Target::FlyoutSearch(Flyout::StartMenu), 1), "shell:start-menu-search");
        assert_eq!(target_id(Target::FlyoutSearch(Flyout::Search), 1), "shell:search-box");
    }

    #[test]
    fn reports_a_target_like_any_other_uia_element() {
        let search = seen("SearchButton", "ToggleButton", "Search", ControlType::Button, (833, 1840, 441, 65));
        let dto = element(Target::Search, 1, &search).expect("on screen");
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["id"], "shell:search");
        assert_eq!(json["name"], "Search");
        assert_eq!(json["role"], "button");
        assert_eq!(json["source"], "uia");
        assert_eq!(json["container"], "taskbar");
        assert_eq!(json["bounds"], serde_json::json!({ "x": 833.0, "y": 1840.0, "width": 441.0, "height": 65.0 }));
        assert!(json["confidence"].as_f64().unwrap() > 0.9);
        assert!(json.get("checked").is_none() && json.get("selected").is_none() && json.get("focused").is_none());
    }

    #[test]
    fn names_the_flyout_box_and_says_when_it_has_focus() {
        let mut box_ = seen("SearchTextBox", "RichEditBox", "Search box", ControlType::Edit, (921, 1840, 331, 65));
        box_.focused = true;
        let dto = element(Target::FlyoutSearch(Flyout::Search), 1, &box_).expect("on screen");
        assert_eq!((dto.id.as_str(), dto.role.as_str(), dto.container.as_deref(), dto.focused), ("shell:search-box", "edit", Some("Search"), Some(true)));
        let start_menu = seen("SearchBoxToggleButton", "ToggleButton", "", ControlType::Button, (760, 400, 1500, 70));
        let dto = element(Target::FlyoutSearch(Flyout::StartMenu), 1, &start_menu).expect("on screen");
        assert_eq!((dto.name.as_str(), dto.container.as_deref()), ("Search", Some("Start menu")), "a nameless box is still the search box");
    }

    #[test]
    fn keeps_the_english_role_whatever_the_display_language() {
        let mut start = seen("StartButton", "ToggleButton", "Start", ControlType::Button, BAR);
        start.localized_type = "Schaltfläche".into();
        assert_eq!(element(Target::Start, 1, &start).map(|dto| dto.role), Some("button".to_string()));
    }

    #[test]
    fn reports_nothing_off_screen() {
        let mut start = seen("StartButton", "ToggleButton", "Start", ControlType::Button, BAR);
        start.offscreen = true;
        assert_eq!(element(Target::Start, 1, &start), None);
        let closed_menu_box = seen("SearchBoxToggleButton", "ToggleButton", "Search for apps, settings, and documents", ControlType::Button, (0, 0, 1, 1));
        assert_eq!(element(Target::FlyoutSearch(Flyout::StartMenu), 1, &closed_menu_box), None);
    }

    #[test]
    fn puts_the_primary_taskbar_first_then_the_others_left_to_right() {
        assert_eq!(ordered(Some('p'), vec![('r', (3072, 0)), ('l', (-3200, 2582)), ('b', (0, 1920))]), ['p', 'l', 'b', 'r']);
        assert_eq!(ordered(None, vec![('r', (3072, 0)), ('l', (-3200, 0))]), ['l', 'r']);
    }

    #[test]
    fn says_why_nothing_was_found() {
        assert!(nothing_found_reason(0, 0).contains("no taskbar"));
        assert!(nothing_found_reason(1, 0).contains("no Start button or search"));
        assert!(nothing_found_reason(2, 4).contains("off screen"));
    }

    #[test]
    fn treats_an_unmatched_query_as_nothing_found_and_a_failure_as_an_error() {
        assert_eq!(matched::<u8>(Ok(7)), Ok(Some(7)));
        assert_eq!(matched::<u8>(Err(uiautomation::Error::new(0, ""))), Ok(None));
        assert!(matched::<u8>(Err(uiautomation::Error::new(-2147220991, "UIA_E_ELEMENTNOTAVAILABLE"))).unwrap_err().contains("UIA_E_ELEMENTNOTAVAILABLE"));
    }

    /// Live check on this PC (read-only):
    /// `cargo test --lib live_shell_targets -- --ignored --nocapture`. Prints each taskbar's candidates, then
    /// what `shell_targets` returns and how long it took. Open Start or Search first to see their boxes.
    #[test]
    #[ignore]
    fn live_shell_targets() {
        // SAFETY: a process-wide flag set before any window or UIA call; physical px like the app.
        let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::SetProcessDPIAware() };
        let automation = UIAutomation::new().expect("UI Automation");
        for (index, taskbar) in taskbars().into_iter().enumerate() {
            let started = Instant::now();
            let candidates = taskbar_candidates(&automation, taskbar).expect("taskbar");
            println!("taskbar {} read in {} ms", index + PRIMARY, started.elapsed().as_millis());
            for candidate in candidates {
                println!("  {candidate:?}");
            }
        }
        let started = Instant::now();
        let open = open_flyouts();
        println!("open flyouts {open:?} found in {} ms; their boxes {:?}", started.elapsed().as_millis(), flyout_targets(&automation));
        // Closed ones too: the query still finds their (off-screen) boxes, which shows it works.
        for window in top_level_windows(w!("Windows.UI.Core.CoreWindow")) {
            if let Some(flyout) = flyout_of_window(window) {
                let started = Instant::now();
                let found = flyout_search_box(&automation, window);
                println!("{flyout:?} shown={} box read in {} ms: {found:?}", is_shown(window), started.elapsed().as_millis());
            }
        }
        for _ in 0..3 {
            let started = Instant::now();
            let targets = read(&automation).expect("shell targets");
            println!("{} ms: {}", started.elapsed().as_millis(), serde_json::to_string(&targets).unwrap());
        }
    }
}
