//! Web search for the local model. Only a scrubbed, generic query leaves the PC: no screenshot,
//! window titles, chat history, cookies or account; results come back as plain text.
//!
//! General search engines block programs, so by default Hodey asks two public APIs built for them:
//! Stack Exchange (Super User how-tos) and Microsoft Learn. With `HODEUM_BRAVE_API_KEY` set it uses
//! Brave Search for full web results instead.

use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;

const MAX_QUERY_CHARS: usize = 120;
const MAX_RESULTS: usize = 5;
const MAX_SNIPPET_CHARS: usize = 300;
const TIMEOUT: Duration = Duration::from_secs(8);
const STACK_URL: &str = "https://api.stackexchange.com/2.3/search/excerpts";
const STACK_PAGE: &str = "3";
const LEARN_URL: &str = "https://learn.microsoft.com/api/search";
const LEARN_PAGE: &str = "2";
const BRAVE_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_KEY_ENV: &str = "HODEUM_BRAVE_API_KEY";
/// Identifies the app, not the person: no version, machine or account details.
const USER_AGENT: &str = "Hodeum";

/// Mirrors `WebResult` in `src/providers/web/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WebResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct WebSearch {
    /// Exactly what was sent, shown to the learner.
    pub query: String,
    pub results: Vec<WebResult>,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("built-in pattern is valid"))
}

/// Removes anything personal a query might carry: emails, links, file paths, long numbers, the
/// Windows user name, and file names. What's left is capped and trimmed.
pub fn scrub_query(query: &str, user_name: &str) -> String {
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    static PATH: OnceLock<Regex> = OnceLock::new();
    static FILE: OnceLock<Regex> = OnceLock::new();
    static DIGITS: OnceLock<Regex> = OnceLock::new();
    let mut text = re(&EMAIL, r"\S+@\S+").replace_all(query, " ").into_owned();
    text = re(&URL, r"(?i)\b(?:https?://|www\.)\S+").replace_all(&text, " ").into_owned();
    text = re(&PATH, r#"(?i)(?:\b[a-z]:[\\/]|\\\\|~/|/(?:users|home)/)[^\s"']*"#).replace_all(&text, " ").into_owned();
    text = re(&FILE, r"\b[\w-]+\.(?:xlsx?|docx?|pptx?|pdf|csv|txt|png|jpe?g|zip)\b").replace_all(&text, " ").into_owned();
    text = re(&DIGITS, r"\d{5,}").replace_all(&text, " ").into_owned();
    if user_name.chars().count() >= 3 {
        text = Regex::new(&format!("(?i){}", regex::escape(user_name))).map(|r| r.replace_all(&text, " ").into_owned()).unwrap_or(text);
    }
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.chars().take(MAX_QUERY_CHARS).collect::<String>().trim().to_string()
}

/// Words too common to show a result is about the question.
const STOPWORDS: [&str; 24] = ["the", "and", "for", "how", "what", "with", "into", "from", "this", "that", "can", "does", "you", "your", "are", "new", "use", "using", "make", "get", "set", "way", "add", "in"];
/// A result must mention at least this many of the question's key words.
const MIN_SHARED_WORDS: usize = 2;

fn key_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2 && !STOPWORDS.contains(w))
        .map(str::to_string)
        .collect()
}

/// Keeps results that share enough key words with the query, so loosely related pages don't mislead.
pub fn relevant(results: Vec<WebResult>, query: &str) -> Vec<WebResult> {
    let words = key_words(query);
    let needed = MIN_SHARED_WORDS.min(words.len());
    results
        .into_iter()
        .filter(|r| {
            let haystack = format!("{} {}", r.title, r.snippet).to_lowercase();
            words.iter().filter(|w| haystack.contains(w.as_str())).count() >= needed
        })
        .collect()
}

/// Markup and entities out, whitespace collapsed, length capped.
fn plain(html: &str) -> String {
    static TAG: OnceLock<Regex> = OnceLock::new();
    let text = re(&TAG, r"<[^>]*>").replace_all(html, " ");
    let decoded = text.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_SNIPPET_CHARS).collect()
}

fn text_at<'a>(item: &'a Value, key: &str) -> &'a str {
    item.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// Stack Exchange search excerpts: question titles with the matching question or answer text.
pub fn parse_stack(json: &Value) -> Vec<WebResult> {
    let items = json.get("items").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    items
        .iter()
        .filter_map(|item| {
            let id = item.get("question_id")?.as_u64()?;
            Some(WebResult { title: plain(text_at(item, "title")), url: format!("https://superuser.com/q/{id}"), snippet: plain(text_at(item, "excerpt")) })
        })
        .collect()
}

/// Microsoft Learn search results.
pub fn parse_learn(json: &Value) -> Vec<WebResult> {
    let items = json.get("results").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    items
        .iter()
        .filter(|item| text_at(item, "url").starts_with("https://"))
        .map(|item| WebResult { title: plain(text_at(item, "title")), url: text_at(item, "url").to_string(), snippet: plain(text_at(item, "description")) })
        .collect()
}

/// Brave Search web results.
pub fn parse_brave(json: &Value) -> Vec<WebResult> {
    let items = json.pointer("/web/results").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    items
        .iter()
        .filter(|item| text_at(item, "url").starts_with("https://"))
        .map(|item| WebResult { title: plain(text_at(item, "title")), url: text_at(item, "url").to_string(), snippet: plain(text_at(item, "description")) })
        .collect()
}

async fn get_json(client: &reqwest::Client, url: &str, params: &[(&str, &str)], key: Option<&str>) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(url, params).map_err(|e| e.to_string())?;
    let mut request = client.get(url).header("Accept", "application/json");
    if let Some(key) = key {
        request = request.header("X-Subscription-Token", key);
    }
    let response = request.send().await.map_err(|e| format!("Couldn't reach the web: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The search service answered {}", response.status()));
    }
    serde_json::from_str(&response.text().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Stack Exchange and Microsoft Learn at the same time, so a slow one can't double the wait; one
/// failing still leaves the other.
async fn keyless(client: &reqwest::Client, query: &str) -> Result<Vec<WebResult>, String> {
    let (stack_client, stack_query) = (client.clone(), query.to_string());
    let stack = tauri::async_runtime::spawn(async move {
        let params = [("order", "desc"), ("sort", "relevance"), ("q", stack_query.as_str()), ("site", "superuser"), ("pagesize", STACK_PAGE)];
        get_json(&stack_client, STACK_URL, &params, None).await
    });
    let learn = [("search", query), ("locale", "en-us"), ("$top", LEARN_PAGE)];
    let learn = get_json(client, LEARN_URL, &learn, None).await;
    let stack = stack.await.map_err(|e| format!("The Stack Exchange search stopped: {e}")).and_then(|result| result);
    match (stack, learn) {
        (Err(a), Err(b)) => Err(format!("{a}; {b}")),
        (stack, learn) => {
            for error in [stack.as_ref().err(), learn.as_ref().err()].into_iter().flatten() {
                eprintln!("one web search source failed: {error}");
            }
            let mut results = stack.map(|j| parse_stack(&j)).unwrap_or_default();
            results.extend(learn.map(|j| parse_learn(&j)).unwrap_or_default());
            Ok(results)
        }
    }
}

/// Searches the web for a generic how-to query. Errors are learner-readable.
#[tauri::command]
pub async fn web_search(query: String) -> Result<WebSearch, String> {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let query = scrub_query(&query, &user);
    if query.is_empty() {
        return Err("There was nothing safe to search for.".into());
    }
    let client = reqwest::Client::builder().user_agent(USER_AGENT).timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
    let mut results: Vec<WebResult> = match std::env::var(BRAVE_KEY_ENV).ok().filter(|k| !k.is_empty()) {
        Some(key) => parse_brave(&get_json(&client, BRAVE_URL, &[("q", query.as_str())], Some(&key)).await?),
        None => keyless(&client, &query).await?,
    };
    results = relevant(results, &query);
    results.truncate(MAX_RESULTS);
    Ok(WebSearch { results, query })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scrubs_personal_details_from_queries() {
        let query = r"anshr asked: email anshr@example.com about C:\Users\anshr\Q3-salaries.xlsx see https://intranet/x 4111111111111111 pivot table";
        assert_eq!(scrub_query(query, "anshr"), "asked: email about see pivot table");
    }

    #[test]
    fn caps_long_queries() {
        let capped = scrub_query(&"word ".repeat(100), "");
        assert!(capped.chars().count() <= MAX_QUERY_CHARS && capped.chars().count() > MAX_QUERY_CHARS - "word ".len());
    }

    #[test]
    fn drops_results_that_are_not_about_the_question() {
        let result = |title: &str| WebResult { title: title.into(), url: "https://x".into(), snippet: String::new() };
        let kept = relevant(vec![result("Accessing Cloud PCs"), result("Insert a worksheet in Excel")], "shortcut to insert a new worksheet in excel");
        assert_eq!(kept, vec![result("Insert a worksheet in Excel")]);
    }

    #[test]
    fn reads_stack_exchange_excerpts() {
        let body = json!({ "items": [{ "question_id": 42, "title": "Freeze top row &amp; column", "excerpt": "Go to <span class=\"highlight\">View</span> &gt; Freeze Panes" }] });
        assert_eq!(parse_stack(&body), vec![WebResult { title: "Freeze top row & column".into(), url: "https://superuser.com/q/42".into(), snippet: "Go to View > Freeze Panes".into() }]);
    }

    #[test]
    fn reads_learn_and_brave_results_and_drops_odd_links() {
        let learn = json!({ "results": [{ "title": "Keyboard shortcuts", "url": "https://learn.microsoft.com/k", "description": "Shift+F11 inserts a sheet." }, { "title": "x", "url": "javascript:alert(1)" }] });
        assert_eq!(parse_learn(&learn).len(), 1);
        let brave = json!({ "web": { "results": [{ "title": "Insert a worksheet", "url": "https://support.microsoft.com/w", "description": "Select <strong>Shift+F11</strong>." }] } });
        assert_eq!(parse_brave(&brave)[0].snippet, "Select Shift+F11 .");
    }
}
