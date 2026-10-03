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
}

/// Mirrors `ScreenObservation` in `src/lib/types.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub app: String,
    pub window_title: String,
    pub elements: Vec<ElementDto>,
    pub at: u64,
}

/// UIA localized control types ("Tab Item", "check box") -> task-pack role vocabulary ("tab item").
pub fn normalize_role(localized: &str) -> String {
    localized.trim().to_lowercase()
}

/// Friendly app names for the notch; anything unknown keeps its executable stem.
pub fn app_name(exe_stem: &str) -> String {
    match exe_stem.to_ascii_lowercase().as_str() {
        "excel" => "Excel".into(),
        "explorer" => "File Explorer".into(),
        "winword" => "Word".into(),
        "powerpnt" => "PowerPoint".into(),
        "code" => "VS Code".into(),
        _ => exe_stem.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_roles_to_pack_vocabulary() {
        assert_eq!(normalize_role(" Tab Item "), "tab item");
        assert_eq!(normalize_role("check box"), "check box");
    }

    #[test]
    fn names_known_apps() {
        assert_eq!(app_name("EXCEL"), "Excel");
        assert_eq!(app_name("explorer"), "File Explorer");
        assert_eq!(app_name("blender"), "blender");
    }

    #[test]
    fn detects_rect_overlap() {
        let a = RectDto { x: 0.0, y: 0.0, width: 10.0, height: 10.0 };
        assert!(a.intersects(&RectDto { x: 5.0, y: 5.0, width: 10.0, height: 10.0 }));
        assert!(!a.intersects(&RectDto { x: 10.0, y: 0.0, width: 5.0, height: 5.0 }));
    }
}
