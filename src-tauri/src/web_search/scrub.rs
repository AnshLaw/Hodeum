//! The only path a query takes off the PC, and the key-word helpers used to judge results.

use std::sync::OnceLock;

use regex::Regex;

use super::WebResult;

pub const MAX_QUERY_CHARS: usize = 120;
/// A card, phone, ID or PIN number, however it's spaced: a digit, two or more digits, spaces or dashes,
/// then a digit ("4111 1111 1111 1111", "555-123-4567", "4321"). The rule src/providers/cloud/redact.ts
/// applies before anything reaches Gemini; "2", "150" and "100%" stay, so how-to questions keep them.
const SECRET_NUMBER: &str = r"\d[\d\s-]{2,}\d";
/// Shorter user names are too likely to be part of ordinary words.
const MIN_USER_NAME_CHARS: usize = 3;
/// Words too common to show a result is about the question.
const STOPWORDS: [&str; 23] = ["the", "and", "for", "how", "what", "with", "into", "from", "this", "that", "can", "does", "you", "your", "are", "new", "use", "using", "make", "get", "set", "way", "add"];
/// A result must mention at least this many of the question's key words.
const MIN_SHARED_WORDS: usize = 2;
/// Shortest word that counts as a key word.
const MIN_KEY_WORD_CHARS: usize = 3;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("built-in pattern is valid"))
}

/// Removes anything personal a query might carry: emails, links, file paths, numbers of four or more
/// digits (spaced or not), the Windows user name (as a whole word), and file names. What's left is
/// capped and trimmed.
pub fn scrub_query(query: &str, user_name: &str) -> String {
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    static PATH: OnceLock<Regex> = OnceLock::new();
    static FILE: OnceLock<Regex> = OnceLock::new();
    static DIGITS: OnceLock<Regex> = OnceLock::new();
    let mut text = re(&EMAIL, r"\S+@\S+").replace_all(query, " ").into_owned();
    text = re(&URL, r"(?i)\b(?:https?://|www\.)\S+").replace_all(&text, " ").into_owned();
    text = re(&PATH, r#"(?i)(?:\b[a-z]:[\\/]|\\\\|~/|/(?:users|home)/)[^\s"']*"#).replace_all(&text, " ").into_owned();
    text = re(&FILE, r"(?i)\b[\w-]+\.(?:xlsx?|docx?|pptx?|pdf|csv|txt|png|jpe?g|zip)\b").replace_all(&text, " ").into_owned();
    text = re(&DIGITS, SECRET_NUMBER).replace_all(&text, " ").into_owned();
    if user_name.chars().count() >= MIN_USER_NAME_CHARS {
        match Regex::new(&format!(r"(?i)\b{}\b", regex::escape(user_name))) {
            Ok(name) => text = name.replace_all(&text, " ").into_owned(),
            Err(_) => {
                // The error would quote the pattern, and with it the name. Without the filter nothing is sent.
                log::error!("couldn't build the user-name filter, so nothing was searched");
                return String::new();
            }
        }
    }
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.chars().take(MAX_QUERY_CHARS).collect::<String>().trim().to_string()
}

pub fn key_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= MIN_KEY_WORD_CHARS && !STOPWORDS.contains(w))
        .map(str::to_string)
        .collect()
}

/// The same question asked with other filler or word order shares one cache entry.
pub fn cache_key(query: &str) -> String {
    let mut words = key_words(query);
    words.sort();
    words.dedup();
    words.join(" ")
}

/// Keeps results that share enough key words with the query, so loosely related pages don't mislead.
pub fn relevant(results: Vec<WebResult>, query: &str) -> Vec<WebResult> {
    let words = key_words(query);
    let needed = MIN_SHARED_WORDS.min(words.len());
    results
        .into_iter()
        .filter(|r| {
            let haystack = format!("{} {} {}", r.title, r.snippet, r.body).to_lowercase();
            words.iter().filter(|w| haystack.contains(w.as_str())).count() >= needed
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(title: &str) -> WebResult {
        WebResult { title: title.into(), url: "https://x".into(), snippet: String::new(), source: String::new(), body: String::new() }
    }

    #[test]
    fn scrubs_personal_details_from_queries() {
        let query = r"anshr asked: email anshr@example.com about C:\Users\anshr\Q3-salaries.xlsx see https://intranet/x 4111111111111111 pivot table";
        assert_eq!(scrub_query(query, "anshr"), "asked: email about see pivot table");
    }

    #[test]
    fn scrubs_file_names_whatever_the_case_of_their_extension() {
        assert_eq!(scrub_query("open Q3-salaries.XLSX and scan_0001.PDF in excel", ""), "open and in excel");
    }

    #[test]
    fn scrubs_card_phone_and_id_numbers_however_they_are_spaced() {
        assert_eq!(scrub_query("pay with card 4111 1111 1111 1111 in excel", ""), "pay with card in excel");
        assert_eq!(scrub_query("call 555-123-4567 from whatsapp", ""), "call from whatsapp");
        assert_eq!(scrub_query("ssn 123-45-6789 in a form", ""), "ssn in a form");
        assert_eq!(scrub_query("change pin 4321 in settings", ""), "change pin in settings");
        assert!(!scrub_query("message +91 98765 43210 on whatsapp", "").contains("98765"));
    }

    #[test]
    fn keeps_the_short_numbers_how_to_questions_need() {
        assert_eq!(scrub_query("how to sum 2 columns in excel", ""), "how to sum 2 columns in excel");
        assert_eq!(scrub_query("zoom 150 in brave", ""), "zoom 150 in brave");
        assert_eq!(scrub_query("set zoom to 100% on windows 11", ""), "set zoom to 100% on windows 11");
    }

    #[test]
    fn removes_the_user_name_only_as_a_whole_word() {
        assert_eq!(scrub_query("user account settings for User", "user"), "account settings for");
        assert_eq!(scrub_query("ansh changes the anshr folder", "ansh"), "changes the anshr folder");
    }

    #[test]
    fn caps_long_queries() {
        let capped = scrub_query(&"word ".repeat(100), "");
        assert!(capped.chars().count() <= MAX_QUERY_CHARS && capped.chars().count() > MAX_QUERY_CHARS - "word ".len());
    }

    #[test]
    fn drops_results_that_are_not_about_the_question() {
        let kept = relevant(vec![result("Accessing Cloud PCs"), result("Insert a worksheet in Excel")], "shortcut to insert a new worksheet in excel");
        assert_eq!(kept, vec![result("Insert a worksheet in Excel")]);
    }

    #[test]
    fn one_cache_entry_per_question_whatever_the_filler() {
        assert_eq!(cache_key("How do I make a Pivot Table in Excel?"), cache_key("excel pivot table"));
        assert_ne!(cache_key("excel pivot table"), cache_key("excel freeze panes"));
    }
}
