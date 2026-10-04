//! HTML to plain text, and the few hundred characters of a page that answer the question.

use std::sync::OnceLock;

use regex::Regex;
use scraper::{ElementRef, Html, Node, Selector};

use super::scrub::key_words;

/// Where a help page keeps its article, best first.
const MAIN_SELECTORS: [&str; 4] = ["main", "article", "[role=main]", "body"];
/// Page furniture, never the answer.
const SKIPPED: [&str; 13] = ["nav", "header", "footer", "aside", "script", "style", "noscript", "svg", "form", "template", "iframe", "button", "select"];
const HEADINGS: [&str; 4] = ["h1", "h2", "h3", "h4"];
const BLOCKS: [&str; 16] = ["p", "div", "section", "ol", "ul", "dl", "dd", "dt", "tr", "table", "pre", "blockquote", "h5", "h6", "br", "figure"];
/// A section's key-word matches outweigh how list-like it is.
const WORD_WEIGHT: f64 = 3.0;
/// Numbered steps are what the learner needs: they outweigh bullets (often tab strips and menus).
const STEP_WEIGHT: f64 = 2.0;
const BULLET_WEIGHT: f64 = 0.5;
/// Only the first few list lines count, so a long link list can't win on length.
const MAX_LIST_LINES: usize = 3;

fn selector(css: &str) -> Selector {
    Selector::parse(css).expect("built-in selector is valid")
}

/// Whitespace collapsed to single spaces.
pub fn squash(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// At most `max` characters, cut at a word and marked with an ellipsis.
pub fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    let at_word = cut.rfind(char::is_whitespace).map_or(cut.as_str(), |i| &cut[..i]);
    format!("{}…", at_word.trim_end())
}

/// Markup out and every entity decoded (`&hellip;`, `&#8217;`…), whitespace collapsed.
pub fn plain(html: &str) -> String {
    let fragment = Html::parse_fragment(html);
    squash(&fragment.root_element().text().collect::<String>())
}

fn walk(element: ElementRef, out: &mut String) {
    let name = element.value().name();
    if SKIPPED.contains(&name) || element.value().attr("aria-hidden") == Some("true") || element.value().attr("hidden").is_some() {
        return;
    }
    let heading = HEADINGS.contains(&name);
    match name {
        _ if heading => out.push_str("\n## "),
        "li" => out.push_str(&list_marker(element)),
        _ if BLOCKS.contains(&name) => out.push('\n'),
        _ => {}
    }
    for child in element.children() {
        match child.value() {
            // Line breaks in the source are layout, not structure; only elements start lines.
            Node::Text(text) => out.push_str(&text.replace(['\n', '\r', '\t'], " ")),
            Node::Element(_) => {
                if let Some(child) = ElementRef::wrap(child) {
                    walk(child, out);
                }
            }
            _ => {}
        }
    }
    if heading || name == "li" || BLOCKS.contains(&name) {
        out.push('\n');
    }
}

/// "1. " for the n-th item of an ordered list, "- " otherwise.
fn list_marker(item: ElementRef) -> String {
    let ordered = item.parent().and_then(ElementRef::wrap).is_some_and(|p| p.value().name() == "ol");
    if !ordered {
        return "\n- ".into();
    }
    let position = item.prev_siblings().filter_map(ElementRef::wrap).filter(|e| e.value().name() == "li").count() + 1;
    format!("\n{position}. ")
}

fn lines_of(root: ElementRef) -> String {
    let mut out = String::new();
    walk(root, &mut out);
    let mut lines: Vec<String> = Vec::new();
    // A marker alone on its line ("1." or "##" before a <p>) belongs to the next line of text.
    let mut marker: Option<String> = None;
    for line in out.lines().map(squash).filter(|line| !line.is_empty()) {
        if is_marker(&line) {
            marker = Some(line);
            continue;
        }
        lines.push(marker.take().map_or(line.clone(), |m| format!("{m} {line}")));
    }
    lines.join("\n")
}

fn is_marker(line: &str) -> bool {
    line == "##" || line == "-" || (line.ends_with('.') && line.len() > 1 && line[..line.len() - 1].chars().all(|c| c.is_ascii_digit()))
}

/// The page's title and its article as lines of text: `## ` headings, `- ` list items, paragraphs.
pub fn page_text(html: &str) -> (String, String) {
    let document = Html::parse_document(html);
    let title = document.select(&selector("title")).next().map(|t| squash(&t.text().collect::<String>())).unwrap_or_default();
    let text = MAIN_SELECTORS.iter().find_map(|css| document.select(&selector(css)).next()).map(lines_of).unwrap_or_default();
    (title, text)
}

/// A snippet of HTML (an answer body) as lines, so list items don't run together.
pub fn fragment_text(html: &str) -> String {
    lines_of(Html::parse_fragment(html).root_element())
}

fn is_heading(line: &str) -> bool {
    line.starts_with('#')
}

fn is_step(line: &str) -> bool {
    static NUMBERED: OnceLock<Regex> = OnceLock::new();
    NUMBERED.get_or_init(|| Regex::new(r"^\d+[.)]\s").expect("built-in pattern is valid")).is_match(line)
}

fn is_bullet(line: &str) -> bool {
    line.starts_with("- ") || line.starts_with("* ")
}

/// Sections start at each heading; text before the first heading is a section too.
fn sections(text: &str) -> Vec<Vec<&str>> {
    let mut out: Vec<Vec<&str>> = vec![Vec::new()];
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if is_heading(line) && out.last().is_some_and(|s| !s.is_empty()) {
            out.push(Vec::new());
        }
        out.last_mut().expect("there is always a section").push(line);
    }
    out.retain(|s| !s.is_empty());
    out
}

/// How many sections mention each word: a word found in one section says more than one found in all.
fn spread(all: &[Vec<&str>], words: &[String]) -> Vec<usize> {
    let lowered: Vec<String> = all.iter().map(|s| s.join(" ").to_lowercase()).collect();
    words.iter().map(|w| lowered.iter().filter(|s| s.contains(w.as_str())).count()).collect()
}

/// Rarer shared words weigh more (sections / sections-with-word, as in BM25's IDF), plus a little
/// for numbered or bulleted steps. Zero when no word is shared.
fn score(section: &[&str], words: &[String], spread: &[usize], sections: usize) -> f64 {
    let lower = section.join(" ").to_lowercase();
    let shared: f64 = words.iter().zip(spread).filter(|(w, _)| lower.contains(w.as_str())).map(|(_, &n)| sections as f64 / n.max(1) as f64).sum();
    if shared == 0.0 {
        return 0.0;
    }
    let steps = section.iter().filter(|l| is_step(l)).count().min(MAX_LIST_LINES);
    let bullets = section.iter().filter(|l| is_bullet(l)).count().min(MAX_LIST_LINES);
    shared * WORD_WEIGHT + steps as f64 * STEP_WEIGHT + bullets as f64 * BULLET_WEIGHT
}

/// A section too long to keep whole and without numbered steps (a shortcut table, a link list) is cut
/// to its heading and the lines that mention the question. Steps are kept whole: every step matters.
fn focus<'a>(section: Vec<&'a str>, words: &[String], max: usize) -> Vec<&'a str> {
    let size: usize = section.iter().map(|l| l.chars().count() + 1).sum();
    if size <= max || section.iter().any(|l| is_step(l)) {
        return section;
    }
    section
        .iter()
        .enumerate()
        .filter(|(i, line)| (*i == 0 && is_heading(line)) || {
            let lower = line.to_lowercase();
            words.iter().any(|w| lower.contains(w.as_str()))
        })
        .map(|(_, line)| *line)
        .collect()
}

/// The sections that best match the query, in page order, within `max` characters.
pub fn best_excerpt(text: &str, query: &str, max: usize) -> String {
    let mut words = key_words(query);
    words.sort();
    words.dedup();
    let all: Vec<Vec<&str>> = sections(text).into_iter().map(|s| focus(s, &words, max)).filter(|s| !s.is_empty()).collect();
    let spread = spread(&all, &words);
    let mut ranked: Vec<(usize, f64)> = all.iter().enumerate().map(|(i, s)| (i, score(s, &words, &spread, all.len()))).filter(|(_, s)| *s > 0.0).collect();
    if ranked.is_empty() {
        return clip(&squash(text), max);
    }
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let (mut picked, mut used) = (Vec::new(), 0);
    for (index, _) in ranked {
        let size = all[index].join("\n").chars().count();
        if used > 0 && used + size > max {
            continue;
        }
        picked.push(index);
        used += size;
    }
    picked.sort_unstable();
    let joined = picked.iter().map(|&i| all[i].join("\n")).collect::<Vec<_>>().join("\n");
    clip(&joined, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS_PAGE: &str = include_str!("fixtures/ms_freeze.html");

    #[test]
    fn decodes_every_entity() {
        assert_eq!(plain("Pivot &hellip; it&#8217;s <b>here</b> &amp; &nbsp;there"), "Pivot … it’s here & there");
    }

    #[test]
    fn keeps_list_items_apart_and_skips_furniture_without_a_main() {
        assert_eq!(fragment_text("<p>Do this:</p><ol><li>Select <code>A1</code></li><li>Press F2</li></ol><ul><li>Tip</li></ul>"), "Do this:\n1. Select A1\n2. Press F2\n- Tip");
        assert_eq!(fragment_text("<ol>\n <li>\n  <p>Select the\n cells.</p>\n  <p>Note</p>\n </li>\n <li><p>Select OK.</p></li>\n</ol>"), "1. Select the cells.\nNote\n2. Select OK.");
        let (_, text) = page_text("<html><body><nav>Menu</nav><h2>Rename</h2><p>Press F2.</p><footer>Legal</footer></body></html>");
        assert_eq!(text, "## Rename\nPress F2.");
    }

    #[test]
    fn clips_at_a_word() {
        assert_eq!(clip("select the third column", 12), "select the…");
        assert_eq!(clip("short", 12), "short");
    }

    #[test]
    fn reads_the_article_and_drops_page_furniture() {
        let (title, text) = page_text(MS_PAGE);
        assert!(title.starts_with("Freeze panes to lock rows and columns"), "{title}");
        assert!(text.contains("Select View > Freeze Panes > Freeze Panes."), "{text}");
        assert!(text.contains("## Freeze rows or columns"), "{text}");
        assert!(!text.contains("Sign in"), "{text}");
        assert!(!text.contains("window.dataLayer"), "{text}");
    }

    #[test]
    fn keeps_the_section_that_answers_within_budget() {
        let (_, text) = page_text(MS_PAGE);
        let excerpt = best_excerpt(&text, "unfreeze panes excel", 400);
        assert!(excerpt.contains("Unfreeze Panes"), "{excerpt}");
        assert!(excerpt.chars().count() <= 401);
    }

    #[test]
    fn prefers_the_numbered_steps_over_a_tab_strip() {
        let text = "## Create a PivotTable\n- Windows\n- Web\n- macOS\nA PivotTable summarizes data.\n## Create a PivotTable in Excel for Windows\n1. Select the cells.\n2. Select Insert > PivotTable.\n3. Select OK.";
        let excerpt = best_excerpt(text, "make a pivot table in excel", 80);
        assert!(excerpt.starts_with("## Create a PivotTable in Excel for Windows\n1. Select the cells."), "{excerpt}");
    }

    #[test]
    fn cuts_a_long_table_to_the_rows_that_answer() {
        let mut text = String::from("## Windows shortcuts");
        for i in 0..60 {
            text.push_str(&format!("\nDo thing number {i} Ctrl + {i}"));
        }
        text.push_str("\nOpen a new tab, and jump to it Ctrl + t");
        let excerpt = best_excerpt(&text, "open a new tab in brave", 200);
        assert_eq!(excerpt, "## Windows shortcuts\nOpen a new tab, and jump to it Ctrl + t");
    }

    #[test]
    fn ranks_sections_and_keeps_page_order() {
        let text = "Intro about Excel\n## Pin a chat\n1. Click the chat\n2. Click Pin\n## Archive a chat\n1. Click Archive\n## Related";
        assert_eq!(best_excerpt(text, "pin a chat", 1_000), "## Pin a chat\n1. Click the chat\n2. Click Pin\n## Archive a chat\n1. Click Archive");
        let short = best_excerpt(text, "pin", 40);
        assert!(short.starts_with("## Pin a chat\n1. Click the chat") && short.ends_with('…') && !short.contains("Archive"), "{short}");
    }
}
