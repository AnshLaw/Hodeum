//! Web search for the local model. Only a scrubbed, generic query leaves the PC (plus the public
//! links of results, to read them): no screenshot, window titles, chat history, cookies or account.
//!
//! Sources, first relevant answer wins, the next one starting if the current one is slow:
//! a search key the learner set up (Tavily, Exa or Brave), Exa's free hosted search, DuckDuckGo's
//! HTML page, then Stack Exchange accepted answers. The top one or two pages are then read so the
//! model sees the steps themselves. Answers are remembered for a day; a source that says to slow
//! down is left alone for a while. The offline help index runs in the webview, before any of this.

mod chain;
mod ddg;
mod exa;
mod keyed;
mod limits;
#[cfg(test)]
mod live;
mod guard;
mod read;
mod scrub;
mod source;
mod stack;
mod text;

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;

use chain::{first_hit, Failures};
use limits::memory;
use scrub::{cache_key, relevant, scrub_query};
use source::{failure, SourceError, SourceId};

const MAX_RESULTS: usize = 5;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
/// Exa answers in about 1.8 s; past this the next source starts too.
const HEDGE: Duration = Duration::from_millis(2_500);
const SEARCH_BUDGET: Duration = Duration::from_millis(4_500);
/// Search plus reading; spoken questions wait at most 6 s in the webview.
const TOTAL_BUDGET: Duration = Duration::from_millis(5_500);
/// Not worth starting a page read with less time than this.
const MIN_READ_TIME: Duration = Duration::from_millis(800);
/// DuckDuckGo turns to bot checks after a few quick calls.
const DDG_MIN_GAP: Duration = Duration::from_secs(20);
/// Identifies the app, not the person: no version, machine or account details.
const USER_AGENT: &str = "Hodeum";

/// Mirrors `WebResult` in `src/providers/web/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WebResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    /// Which search service found it.
    pub source: String,
    /// The source's own longer text (Exa highlights, an answer body); read instead of fetching.
    #[serde(skip)]
    pub body: String,
}

/// The part of a result's page that answers the question. Mirrors `WebPage` in types.ts.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WebPage {
    pub title: String,
    pub url: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebSearch {
    /// Exactly what was sent, shown to the learner.
    pub query: String,
    /// The service whose results these are; empty when none found anything.
    pub provider: String,
    pub results: Vec<WebResult>,
    pub pages: Vec<WebPage>,
    /// Answered from memory: nothing left the PC this time.
    pub cached: bool,
    /// Why sources or page reads didn't help, e.g. "DuckDuckGo: blocked automated searches".
    pub failures: Vec<String>,
}

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| reqwest::Client::builder().user_agent(USER_AGENT).timeout(REQUEST_TIMEOUT).connect_timeout(CONNECT_TIMEOUT).build().map_err(|e| format!("couldn't set up web access: {e}")))
        .as_ref()
        .map_err(Clone::clone)
}

fn chain_ids() -> Vec<SourceId> {
    let mut ids = keyed::configured();
    ids.extend([SourceId::Exa, SourceId::DuckDuckGo, SourceId::StackExchange]);
    ids
}

/// Whether `id` may be asked now; DuckDuckGo is also spaced out so it doesn't start blocking.
fn may_ask(id: SourceId) -> Result<(), SourceError> {
    let (mut memory, now) = (memory(), Instant::now());
    if let Some(left) = memory.cooldowns.remaining(id, now) {
        return Err(SourceError::CoolingDown(left));
    }
    if id == SourceId::DuckDuckGo {
        memory.cooldowns.rest(id, now, DDG_MIN_GAP);
    }
    Ok(())
}

fn rest_after(id: SourceId, error: &SourceError) {
    let rest = if *error == SourceError::Blocked { Some(id.cooldown()) } else { error.rest() };
    if let Some(rest) = rest {
        memory().cooldowns.rest(id, Instant::now(), rest);
    }
}

/// One source's relevant results, resting it when it asks.
async fn ask(client: &'static reqwest::Client, id: SourceId, query: String) -> chain::Outcome {
    may_ask(id)?;
    let outcome = match id {
        SourceId::Exa => exa::search(client, &query, None).await,
        SourceId::DuckDuckGo => ddg::search(client, &query).await,
        SourceId::StackExchange => stack::search(client, &query, |wait| memory().cooldowns.rest(id, Instant::now(), wait)).await,
        SourceId::Tavily | SourceId::ExaKeyed | SourceId::Brave => keyed::search(client, id, &query).await,
        SourceId::Jina => Err(SourceError::Parse("Jina Reader reads pages; it doesn't search".into())),
    };
    if let Err(error) = &outcome {
        rest_after(id, error);
    }
    let mut kept = relevant(outcome?, &query);
    kept.truncate(MAX_RESULTS);
    Ok(kept)
}

fn readable(failures: &Failures) -> Vec<String> {
    failures.iter().map(|(id, error)| failure(*id, error)).collect()
}

/// No hit: an empty answer if any source answered at all, otherwise an error naming every reason.
fn without_hit(query: &str, failures: Failures) -> Result<WebSearch, String> {
    let reasons = readable(&failures);
    if failures.iter().any(|(_, e)| *e == SourceError::NothingRelevant) {
        return Ok(WebSearch { query: query.into(), provider: String::new(), results: vec![], pages: vec![], cached: false, failures: reasons });
    }
    Err(format!("No search service could answer: {}", reasons.join("; ")))
}

/// The source chain, then a read of the best pages in whatever time is left.
pub async fn search(client: &'static reqwest::Client, query: &str) -> Result<WebSearch, String> {
    let started = Instant::now();
    let owned = query.to_string();
    let (hit, failures) = first_hit(&chain_ids(), HEDGE, SEARCH_BUDGET, move |id| ask(client, id, owned.clone())).await;
    for line in readable(&failures) {
        eprintln!("web search: {line}");
    }
    let Some(hit) = hit else { return without_hit(query, failures) };
    let mut reasons = readable(&failures);
    let left = TOTAL_BUDGET.saturating_sub(started.elapsed());
    let pages = if left >= MIN_READ_TIME {
        let (pages, read_failures) = read::read_pages(client, &hit.results, query, left).await;
        reasons.extend(read_failures);
        pages
    } else {
        reasons.push("reading pages: no time left".into());
        Vec::new()
    };
    Ok(WebSearch { query: query.into(), provider: hit.id.label().into(), results: hit.results, pages, cached: false, failures: reasons })
}

/// Searches the web for a generic how-to query. Errors are learner-readable.
#[tauri::command]
pub async fn web_search(query: String) -> Result<WebSearch, String> {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let query = scrub_query(&query, &user);
    if query.is_empty() {
        return Err("There was nothing safe to search for.".into());
    }
    let key = cache_key(&query);
    let remembered = memory().cache.get(&key, Instant::now());
    if let Some(found) = remembered {
        return Ok(WebSearch { query, cached: true, failures: Vec::new(), ..found });
    }
    let found = search(client()?, &query).await?;
    if !found.results.is_empty() {
        memory().cache.put(key, Instant::now(), found.clone());
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_answer_when_a_source_answered_otherwise_every_reason() {
        let answered = vec![(SourceId::Exa, SourceError::RateLimited(SourceId::Exa.cooldown())), (SourceId::DuckDuckGo, SourceError::NothingRelevant)];
        let empty = without_hit("q", answered).unwrap();
        assert!(empty.results.is_empty());
        assert_eq!(empty.failures, vec!["Exa (free): rate-limited, resting 15 min", "DuckDuckGo: nothing relevant"]);
        let unreachable = vec![(SourceId::Exa, SourceError::Network("timed out".into())), (SourceId::DuckDuckGo, SourceError::Blocked)];
        assert_eq!(without_hit("q", unreachable).unwrap_err(), "No search service could answer: Exa (free): unreachable (timed out); DuckDuckGo: blocked automated searches");
    }

    #[test]
    fn results_serialise_without_the_long_source_text() {
        let result = WebResult { title: "t".into(), url: "https://x".into(), snippet: "s".into(), source: "Exa".into(), body: "long".into() };
        let json = serde_json::to_value(&result).unwrap();
        assert!(json.get("body").is_none());
        assert_eq!(json["source"], "Exa");
    }

    #[test]
    fn keyless_sources_are_always_in_the_chain_in_order() {
        let ids = chain_ids();
        let tail: Vec<_> = ids.iter().rev().take(3).rev().copied().collect();
        assert_eq!(tail, vec![SourceId::Exa, SourceId::DuckDuckGo, SourceId::StackExchange]);
    }
}
