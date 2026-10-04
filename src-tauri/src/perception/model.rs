use serde::{Deserialize, Serialize};

/// Mirrors `Rect` in `src/lib/types.ts` (physical screen pixels).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RectDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl RectDto {
    pub fn intersects(&self, other: &RectDto) -> bool {
        self.x < other.x + other.width
            && other.x < self.x + self.width
            && self.y < other.y + other.height
            && other.y < self.y + self.height
    }
}

/// Mirrors `UiElement` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ElementDto {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bounds: RectDto,
    pub source: &'static str,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    /// Ticked (TogglePattern On): check boxes, toggle switches, the field list's boxes. Separate from `selected`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    /// Where the control sits: "title bar", "tab strip", "tab '<name>'", "toolbar", "menu bar", "status bar", "page", or a named pane.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    /// Has keyboard focus.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused: Option<bool>,
}

/// Mirrors `ScreenObservation` in `src/lib/types.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub app: String,
    pub window_title: String,
    pub elements: Vec<ElementDto>,
    pub at: u64,
    /// The window that was read; guidance placed from this read is drawn only over it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<super::window_watch::WindowDto>,
    /// A stable id for the app ("excel", "file-explorer", "settings", "calculator", ...), for matching packs and app switches.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
}

/// The role vocabulary the web side and task packs use: one English spelling per control kind.
/// Besides the UIA control type names, the specific kinds English Windows reports ("toggle switch").
pub const KNOWN_ROLES: [&str; 47] = [
    "app bar", "app bar button", "app bar toggle button", "button", "calendar", "check box", "combo box", "custom",
    "data grid", "data item", "dialog", "document", "edit", "group", "header", "header item", "heading", "image",
    "link", "list", "list item", "menu", "menu bar", "menu item", "pane", "progress bar", "radio button",
    "scroll bar", "semantic zoom", "separator", "slider", "spinner", "split button", "status bar", "tab",
    "tab item", "table", "text", "thumb", "title bar", "toggle button", "toggle switch", "tool bar", "tool tip",
    "tree", "tree item", "window",
];

/// Spellings that differ by more than spacing ("edit box" in Excel, "hyperlink" elsewhere).
const ROLE_SYNONYMS: [(&str, &str); 3] = [("editbox", "edit"), ("hyperlink", "link"), ("tooltip", "tool tip")];

fn squashed(role: &str) -> String {
    role.chars().filter(|c| !c.is_whitespace()).collect()
}

/// A localized control type in the pack vocabulary ("CheckBox", "checkbox" -> "check box"), when it is one.
pub fn known_role(localized: &str) -> Option<&'static str> {
    let key = squashed(&localized.to_lowercase());
    if let Some((_, role)) = ROLE_SYNONYMS.iter().find(|(synonym, _)| *synonym == key) {
        return Some(role);
    }
    KNOWN_ROLES.iter().copied().find(|role| squashed(role) == key)
}

/// The element's role: its localized type when that names a known English role (keeps "toggle switch"),
/// else the English name of its control type, so other display languages and odd spellings still match packs.
pub fn normalize_role(type_role: &str, localized: &str) -> String {
    known_role(localized).unwrap_or(type_role).to_string()
}

/// Friendly app names for the notch; anything unknown keeps its executable stem.
/// The bare Store-app frame host ("ApplicationFrameHost") gets "", so app checks never block on it.
/// Whole windows are named by `apps::identity::identify_window`, which also reads AUMIDs.
pub fn app_name(exe_stem: &str) -> String {
    crate::apps::identity::name_for_exe(exe_stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_roles_to_pack_vocabulary() {
        assert_eq!(normalize_role("tab item", " Tab Item "), "tab item");
        assert_eq!(normalize_role("check box", "check box"), "check box");
    }

    #[test]
    fn maps_framework_spellings_to_one_role() {
        assert_eq!(normalize_role("check box", "checkbox"), "check box");
        assert_eq!(normalize_role("check box", "CheckBox"), "check box");
        assert_eq!(normalize_role("split button", "splitbutton"), "split button");
        assert_eq!(normalize_role("edit", "Edit Box"), "edit");
        assert_eq!(normalize_role("link", "hyperlink"), "link");
        assert_eq!(normalize_role("tab item", "tabitem"), "tab item");
    }

    #[test]
    fn keeps_specific_english_kinds() {
        assert_eq!(normalize_role("button", "toggle switch"), "toggle switch");
        assert_eq!(normalize_role("button", "app bar button"), "app bar button");
        assert_eq!(normalize_role("window", "dialog"), "dialog");
    }

    #[test]
    fn falls_back_to_the_control_type_for_other_languages() {
        assert_eq!(normalize_role("button", "Schaltfläche"), "button");
        assert_eq!(normalize_role("check box", "बॉक्स"), "check box");
        assert_eq!(normalize_role("pane", ""), "pane");
    }

    #[test]
    fn every_known_role_is_lowercase_and_unique() {
        for role in KNOWN_ROLES {
            assert_eq!(role, role.to_lowercase());
            assert_eq!(KNOWN_ROLES.iter().filter(|r| **r == role).count(), 1, "{role}");
        }
    }

    #[test]
    fn names_known_apps() {
        assert_eq!(app_name("EXCEL"), "Excel");
        assert_eq!(app_name("explorer"), "File Explorer");
        assert_eq!(app_name("blender"), "blender");
        assert_eq!(app_name("brave"), "Brave");
        assert_eq!(app_name("WhatsApp.Root"), "WhatsApp");
        assert_eq!(app_name("SystemSettings"), "Settings");
        assert_eq!(app_name("CalculatorApp"), "Calculator");
        assert_eq!(app_name("mspaint"), "Paint");
        assert_eq!(app_name("Notepad"), "Notepad");
        assert_eq!(app_name("ApplicationFrameHost"), "");
    }

    #[test]
    fn detects_rect_overlap() {
        let a = RectDto { x: 0.0, y: 0.0, width: 10.0, height: 10.0 };
        assert!(a.intersects(&RectDto { x: 5.0, y: 5.0, width: 10.0, height: 10.0 }));
        assert!(!a.intersects(&RectDto { x: 10.0, y: 0.0, width: 5.0, height: 5.0 }));
    }
}
