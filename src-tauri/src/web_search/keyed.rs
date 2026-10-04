//! Optional search keys the learner set up: Tavily (free tier, no card), Exa, Brave Search. Read like
//! the cloud keys: Windows Credential Manager (`Hodeum/<provider>`) first, then the environment
//! (and `.env.local` in dev builds). Keys never reach the webview.

use serde_json::{json, Value};

use super::body::{read_capped, MAX_ANSWER_BYTES};
use super::source::{json_body, with_params, SourceError, SourceId};
use super::text::{clip, plain, squash};
use super::WebResult;

const SERVICE: &str = "Hodeum";
/// In asking order: the first configured one is tried first.
const KEYS: [(SourceId, &str, &str); 3] = [(SourceId::Tavily, "tavily", "HODEUM_TAVILY_API_KEY"), (SourceId::ExaKeyed, "exa", "HODEUM_EXA_API_KEY"), (SourceId::Brave, "brave", "HODEUM_BRAVE_API_KEY")];
const TAVILY_URL: &str = "https://api.tavily.com/search";
const BRAVE_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const RESULTS: u32 = 5;
const SNIPPET_CHARS: usize = 300;

fn stored(provider: &str) -> Option<String> {
    let entry = match keyring::Entry::new(SERVICE, provider) {
        Ok(entry) => entry,
        Err(e) => {
            log::warn!("couldn't open the credential store for {provider}: {e}");
            return None;
        }
    };
    match entry.get_password() {
        Ok(key) => Some(key),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            log::warn!("reading the {provider} search key failed: {e}");
            None
        }
    }
}

/// The saved key wins over the environment; blank values count as missing.
fn resolve(stored: Option<String>, env: Option<String>) -> Option<String> {
    let clean = |v: Option<String>| v.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    clean(stored).or_else(|| clean(env))
}

pub fn key(id: SourceId) -> Option<String> {
    let (_, provider, env) = KEYS.iter().find(|(k, _, _)| *k == id)?;
    resolve(stored(provider), crate::cloud::dev_env::var(env))
}

/// The keyed sources that have a key, in asking order.
pub fn configured() -> Vec<SourceId> {
    KEYS.iter().map(|(id, _, _)| *id).filter(|id| key(*id).is_some()).collect()
}

fn result(id: SourceId, title: &str, url: &str, text: &str) -> Option<WebResult> {
    let body = plain(text);
    url.starts_with("https://").then(|| WebResult { title: plain(title), url: url.into(), snippet: clip(&squash(&body), SNIPPET_CHARS), source: id.label().into(), body })
}

fn items<'a>(json: &'a Value, pointer: &str) -> &'a [Value] {
    json.pointer(pointer).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn text<'a>(item: &'a Value, key: &str) -> &'a str {
    item.get(key).and_then(Value::as_str).unwrap_or_default()
}

pub fn parse_tavily(json: &Value) -> Vec<WebResult> {
    items(json, "/results").iter().filter_map(|r| result(SourceId::Tavily, text(r, "title"), text(r, "url"), text(r, "content"))).collect()
}

pub fn parse_brave(json: &Value) -> Vec<WebResult> {
    items(json, "/web/results").iter().filter_map(|r| result(SourceId::Brave, text(r, "title"), text(r, "url"), text(r, "description"))).collect()
}

async fn read_json(id: SourceId, request: reqwest::RequestBuilder) -> Result<Value, SourceError> {
    let response = request.header("Accept", "application/json").send().await.map_err(SourceError::from_reqwest)?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(SourceError::from_status(id, status));
    }
    let body = read_capped(response, MAX_ANSWER_BYTES).await?;
    serde_json::from_str(&body).map_err(|e| SourceError::Parse(e.to_string()))
}

pub async fn search(client: &reqwest::Client, id: SourceId, query: &str) -> Result<Vec<WebResult>, SourceError> {
    let key = key(id).ok_or(SourceError::NoKey)?;
    match id {
        SourceId::Tavily => {
            let body = json!({ "query": query, "search_depth": "basic", "max_results": RESULTS, "include_answer": false });
            Ok(parse_tavily(&read_json(id, json_body(client.post(TAVILY_URL).bearer_auth(&key), &body)).await?))
        }
        SourceId::Brave => Ok(parse_brave(&read_json(id, client.get(with_params(BRAVE_URL, &[("q", query)])?).header("X-Subscription-Token", &key)).await?)),
        SourceId::ExaKeyed => super::exa::search(client, query, Some(&key)).await,
        _ => Err(SourceError::NoKey),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_key_wins_and_blank_is_missing() {
        assert_eq!(resolve(Some("saved".into()), Some("env".into())), Some("saved".into()));
        assert_eq!(resolve(Some(" ".into()), Some(" env ".into())), Some("env".into()));
        assert_eq!(resolve(None, None), None);
    }

    #[test]
    fn reads_tavily_and_brave_results_and_drops_odd_links() {
        let tavily = json!({ "results": [{ "title": "Create a PivotTable", "url": "https://support.microsoft.com/p", "content": "Select Insert &gt; PivotTable." }, { "title": "x", "url": "javascript:alert(1)" }] });
        let found = parse_tavily(&tavily);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].body, "Select Insert > PivotTable.");
        let brave = json!({ "web": { "results": [{ "title": "Insert a worksheet", "url": "https://support.microsoft.com/w", "description": "Select <strong>Shift+F11</strong>." }] } });
        assert_eq!(parse_brave(&brave)[0].snippet, "Select Shift+F11.");
    }
}
