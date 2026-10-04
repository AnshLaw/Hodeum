//! The control names a screen read is asked to find (the current lesson step's target and success
//! controls), and which of them a walk cut short still lacks.

use std::collections::HashSet;

use super::model::ElementDto;

/// At most this many names per read (`MAX_WANTED_NAMES` in src/features/hode/wanted.ts sends no more),
/// so a request can't turn one read into many searches.
pub const MAX_WANTED: usize = 8;
/// A lesson name with this is a pattern ("Display is *"): UI Automation can't search for it by name.
const WILDCARD: char = '*';

/// Names compare as the lesson's signals compare them (src/features/hode/signals.ts): trimmed, in any
/// case, with "…" read as "...".
fn name_key(name: &str) -> String {
    name.trim().to_lowercase().replace('…', "...")
}

/// The names a read was asked to find: trimmed, without blanks, patterns or repeats, at most MAX_WANTED.
pub fn wanted_names(want: &[String]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for name in want.iter().map(|name| name.trim()) {
        if names.len() == MAX_WANTED {
            break;
        }
        let usable = !name.is_empty() && !name.contains(WILDCARD);
        if usable && !names.iter().any(|kept| name_key(kept) == name_key(name)) {
            names.push(name.to_string());
        }
    }
    names
}

/// The wanted names no element of the read has.
pub fn unmatched<'a>(wanted: &'a [String], elements: &[ElementDto]) -> Vec<&'a str> {
    if wanted.is_empty() {
        return Vec::new();
    }
    let read: HashSet<String> = elements.iter().map(|element| name_key(&element.name)).collect();
    wanted.iter().map(String::as_str).filter(|name| !read.contains(&name_key(name))).collect()
}

/// A searched-out control the read already holds: the same name (as signals compare names) in the same box.
pub fn already_read(elements: &[ElementDto], candidate: &ElementDto) -> bool {
    let key = name_key(&candidate.name);
    elements.iter().any(|element| element.bounds == candidate.bounds && name_key(&element.name) == key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::perception::model::RectDto;

    const BOX: RectDto = RectDto { x: 10.0, y: 20.0, width: 80.0, height: 24.0 };

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| name.to_string()).collect()
    }

    fn element(name: &str, bounds: RectDto) -> ElementDto {
        ElementDto { id: "uia:1".into(), name: name.into(), role: "button".into(), bounds, source: "uia", confidence: 0.95, selected: None, checked: None, container: None, focused: None }
    }

    #[test]
    fn keeps_trimmed_names_without_blanks_or_patterns() {
        assert_eq!(wanted_names(&names(&[" File name: ", "", "  ", "Display is *", "Save"])), names(&["File name:", "Save"]));
    }

    #[test]
    fn keeps_the_first_spelling_of_a_name_asked_for_twice() {
        assert_eq!(wanted_names(&names(&["Save as", "SAVE AS", "Compress to...", "Compress to…"])), names(&["Save as", "Compress to..."]));
    }

    #[test]
    fn takes_at_most_the_cap() {
        let many: Vec<String> = (0..MAX_WANTED * 3).map(|i| format!("Control {i}")).collect();
        assert_eq!(wanted_names(&many), many[..MAX_WANTED].to_vec());
    }

    #[test]
    fn a_name_the_read_has_in_any_case_needs_no_search() {
        let read = [element("File", BOX), element("save as", BOX), element("Compress to…", BOX)];
        let wanted = names(&["Save as", "File name:", "Compress to...", "file"]);
        assert_eq!(unmatched(&wanted, &read), vec!["File name:"]);
    }

    #[test]
    fn every_name_needs_a_search_in_an_empty_read_and_none_when_nothing_is_wanted() {
        let wanted = names(&["Save", "File name:"]);
        assert_eq!(unmatched(&wanted, &[]), vec!["Save", "File name:"]);
        assert!(unmatched(&[], &[element("Save", BOX)]).is_empty());
    }

    #[test]
    fn a_searched_out_control_already_read_is_the_same_name_in_the_same_box() {
        let read = [element("Save", BOX)];
        assert!(already_read(&read, &element("SAVE", BOX)));
        assert!(!already_read(&read, &element("Save", RectDto { y: 400.0, ..BOX })));
        assert!(!already_read(&read, &element("Cancel", BOX)));
    }
}
