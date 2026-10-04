//! Reads the top one or two results so the model sees the help page's steps, not a search snippet.
//! A direct fetch with local extraction first; Jina Reader (only the public URL is sent) for pages
//! that build their text with JavaScript.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use regex::Regex;
use tauri::async_runtime;

use super::body::{content_type, is_html, read_capped};
use super::guard::{page_client, readable, shareable};
use super::limits::memory;
use super::source::{failure, SourceError, SourceId};
use super::text::{best_excerpt, page_text, squash};
use super::{WebPage, WebResult};

const READ_PAGES: usize = 2;
/// About 700 tokens for two pages: room left for the screenshot in the model's context.
pub const PAGE_CHARS: usize = 1_200;
/// A source that already sent this much page text (Exa highlights, an answer body) isn't re-read.
const ENOUGH_BODY_CHARS: usize = 400;
/// Less than this from a direct fetch means the page is built by JavaScript.
const MIN_DIRECT_CHARS: usize = 300;
/// The WhatsApp FAQ page is 1.2 MB of HTML; anything far beyond that isn't a help article and isn't read.
const MAX_PAGE_BYTES: usize = 3_000_000;
const JINA_URL: &str = "https://r.jina.ai/";
const JINA_REMOVE: &str = "nav, header, footer, aside";
const JINA_CONTENT_MARKER: &str = "Markdown Content:";
const JINA_HEADER_PREFIXES: [&str; 3] = ["Title:", "URL Source:", "Warning:"];
/// Vendor help centres first: their steps match what the learner sees.
const OFFICIAL_HOSTS: [&str; 8] = ["support.microsoft.com", "learn.microsoft.com", "faq.whatsapp.com", "support.google.com", "support.brave.app", "support.brave.com", "support.mozilla.org", "superuser.com"];
/// Vendor help centres whose own page beats a search engine's highlights of it (server-rendered).
const PAGE_FIRST_HOSTS: [&str; 5] = ["support.microsoft.com", "learn.microsoft.com", "support.google.com", "support.brave.app", "support.mozilla.org"];
/// Help centres that build their text with JavaScript: a direct fetch (1.2 MB for WhatsApp's) finds no steps.
const SCRIPTED_HOSTS: [&str; 1] = ["faq.whatsapp.com"];
/// Videos and social pages have no steps to read.
const UNREADABLE_HOSTS: [&str; 5] = ["youtube.com", "youtu.be", "tiktok.com", "facebook.com", "instagram.com"];

pub fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url).ok()?.host_str().map(str::to_lowercase)
}

fn on(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// Which results to read: official help first, then search order; never videos.
pub fn reading_order(results: &[WebResult]) -> Vec<usize> {
    let mut readable: Vec<(usize, bool)> = results
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            let host = host_of(&r.url)?;
            (!UNREADABLE_HOSTS.iter().any(|d| on(&host, d))).then(|| (i, OFFICIAL_HOSTS.iter().any(|d| on(&host, d))))
        })
        .collect();
    readable.sort_by_key(|(i, official)| (!official, *i));
    readable.into_iter().take(READ_PAGES).map(|(i, _)| i).collect()
}

/// Jina's markdown without its header lines, link targets, images or bold markers.
pub fn jina_text(markdown: &str) -> String {
    static IMAGE: OnceLock<Regex> = OnceLock::new();
    static LINK: OnceLock<Regex> = OnceLock::new();
    let content = markdown.split_once(JINA_CONTENT_MARKER).map_or(markdown, |(_, rest)| rest);
    let image = IMAGE.get_or_init(|| Regex::new(r"!\[[^\]]*\]\([^)]*\)").expect("built-in pattern is valid"));
    let link = LINK.get_or_init(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").expect("built-in pattern is valid"));
    let text = link.replace_all(&image.replace_all(content, ""), "$1").replace("**", "");
    text.lines()
        .map(squash)
        .filter(|l| !l.is_empty() && !JINA_HEADER_PREFIXES.iter().any(|p| l.starts_with(p)))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The response text, refused past `MAX_PAGE_BYTES`; `id` names a service whose limits apply (none for a plain page).
async fn body_of(response: reqwest::Response, id: Option<SourceId>) -> Result<String, SourceError> {
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(id.map_or(SourceError::Http(status), |id| SourceError::from_status(id, status)));
    }
    read_capped(response, MAX_PAGE_BYTES).await
}

/// A help site's own answer as HTML: a download or anything else that isn't a web page is never read.
async fn page_html(response: reqwest::Response) -> Result<String, SourceError> {
    if response.status().is_success() && !is_html(content_type(&response)) {
        return Err(SourceError::NotHtml);
    }
    body_of(response, None).await
}

/// Pages are fetched with their own client: https only, public addresses only, redirects re-checked.
fn reader() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT.get_or_init(|| page_client(super::USER_AGENT, super::REQUEST_TIMEOUT, super::CONNECT_TIMEOUT, &OFFICIAL_HOSTS)).as_ref().map_err(Clone::clone)
}

/// Only official help sites are fetched directly; any other result is read through its own text or Jina.
async fn fetch_direct(url: &reqwest::Url) -> Result<String, SourceError> {
    let client = reader().map_err(SourceError::Parse)?;
    let response = client.get(url.clone()).header("Accept", "text/html").send().await.map_err(SourceError::from_reqwest)?;
    Ok(page_text(&page_html(response).await?).1)
}

async fn fetch_jina(client: &reqwest::Client, url: &reqwest::Url) -> Result<String, SourceError> {
    if let Some(left) = memory().cooldowns.remaining(SourceId::Jina, Instant::now()) {
        return Err(SourceError::CoolingDown(left));
    }
    let request = client.get(format!("{JINA_URL}{url}")).header("X-Retain-Images", "none").header("X-Remove-Selector", JINA_REMOVE);
    let outcome = match request.send().await {
        Ok(response) => body_of(response, Some(SourceId::Jina)).await,
        Err(e) => Err(SourceError::from_reqwest(e)),
    };
    if let Some(rest) = outcome.as_ref().err().and_then(SourceError::rest) {
        memory().cooldowns.rest(SourceId::Jina, Instant::now(), rest);
    }
    Ok(jina_text(&outcome?))
}

/// One result's most relevant text: a vendor help page itself, else the source's own long text
/// (Exa highlights, an answer body), else the page, else Jina's copy of it.
async fn read_one(client: &'static reqwest::Client, result: WebResult, query: String) -> Result<WebPage, String> {
    let page = |text: &str| WebPage { title: result.title.clone(), url: result.url.clone(), text: best_excerpt(text, &query, PAGE_CHARS) };
    let host = host_of(&result.url).unwrap_or_default();
    let has_body = result.body.chars().count() >= ENOUGH_BODY_CHARS;
    if has_body && !PAGE_FIRST_HOSTS.iter().any(|d| on(&host, d)) {
        return Ok(page(&result.body));
    }
    let Ok(url) = reqwest::Url::parse(&result.url) else {
        return if has_body { Ok(page(&result.body)) } else { Err(format!("{}: not a web address", result.url)) };
    };
    if !SCRIPTED_HOSTS.iter().any(|d| on(&host, d)) && readable(&url, &OFFICIAL_HOSTS) {
        match fetch_direct(&url).await {
            Ok(text) if text.chars().count() >= MIN_DIRECT_CHARS => return Ok(page(&text)),
            Ok(_) => {}
            Err(e) => log::warn!("reading {host} directly failed: {}", e.reason()),
        }
    }
    if has_body {
        return Ok(page(&result.body));
    }
    if !shareable(&url) {
        return Err(format!("{host}: not a public https page"));
    }
    let text = fetch_jina(client, &url).await.map_err(|e| failure(SourceId::Jina, &e))?;
    if text.is_empty() {
        return Err(format!("{}: the page had no text", SourceId::Jina.label()));
    }
    Ok(page(&text))
}

/// Up to two pages read at the same time, within `budget`; what couldn't be read is reported.
pub async fn read_pages(client: &'static reqwest::Client, results: &[WebResult], query: &str, budget: Duration) -> (Vec<WebPage>, Vec<String>) {
    let deadline = Instant::now() + budget;
    let handles: Vec<_> = reading_order(results).into_iter().map(|i| async_runtime::spawn(read_one(client, results[i].clone(), query.to_string()))).collect();
    let (mut pages, mut failures) = (Vec::new(), Vec::new());
    for mut handle in handles {
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, &mut handle).await {
            Ok(Ok(Ok(page))) => pages.push(page),
            Ok(Ok(Err(why))) => failures.push(why),
            Ok(Err(e)) => failures.push(format!("reading a page stopped: {e}")),
            Err(_) => {
                handle.abort();
                failures.push("reading a page: no answer in time".into());
            }
        }
    }
    (pages, failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(url: &str) -> WebResult {
        WebResult { title: "t".into(), url: url.into(), snippet: String::new(), source: String::new(), body: String::new() }
    }

    #[test]
    fn reads_official_help_first_and_never_videos() {
        let results = [result("https://www.youtube.com/watch?v=1"), result("https://blog.example.com/pin"), result("https://faq.whatsapp.com/645907560577342/"), result("https://other.example.com")];
        assert_eq!(reading_order(&results), vec![2, 1]);
    }

    fn answer(status: u16, content_type: &str, body: impl Into<reqwest::Body>) -> reqwest::Response {
        let built = tauri::http::Response::builder().status(status).header("Content-Type", content_type).body(body.into());
        reqwest::Response::from(built.expect("a valid test response"))
    }

    #[test]
    fn reads_a_help_page_only_when_it_is_html() {
        let html = async_runtime::block_on(page_html(answer(200, "text/html; charset=utf-8", "<p>Select View</p>")));
        assert_eq!(html, Ok("<p>Select View</p>".into()));
        let pdf = async_runtime::block_on(page_html(answer(200, "application/pdf", "%PDF-1.7")));
        assert_eq!(pdf, Err(SourceError::NotHtml));
        let missing = async_runtime::block_on(page_html(answer(404, "text/html", "<p>Not found</p>")));
        assert_eq!(missing, Err(SourceError::Http(404)));
    }

    #[test]
    fn refuses_a_page_bigger_than_any_help_article() {
        let read = async_runtime::block_on(page_html(answer(200, "text/html", "x".repeat(MAX_PAGE_BYTES + 1))));
        assert_eq!(read, Err(SourceError::TooLarge(MAX_PAGE_BYTES)));
    }

    #[test]
    fn cleans_jina_markdown() {
        let markdown = "Title: How to pin\n\nURL Source: https://faq.whatsapp.com/1\n\nWarning: cached\n\nMarkdown Content:\nCopy link\n\n## Pin a chat\n\n1.   Click **Pin**.\n![icon](https://x/i.png)\n*   How to [pin a message](https://faq.whatsapp.com/2)";
        assert_eq!(jina_text(markdown), "Copy link\n## Pin a chat\n1. Click Pin.\n* How to pin a message");
    }
}
