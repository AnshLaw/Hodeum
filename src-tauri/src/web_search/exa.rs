//! Exa's hosted MCP search, called directly over HTTP (one JSON-RPC `tools/call`, no session).
//! It works without a key for casual use; a key (`x-api-key`) lifts the limit.

use serde_json::{json, Value};

use super::body::{read_capped, MAX_ANSWER_BYTES};
use super::source::{json_body, SourceError, SourceId};
use super::text::{clip, squash};
use super::WebResult;

pub const URL: &str = "https://mcp.exa.ai/mcp";
const TOOL: &str = "web_search_exa";
const RESULTS: u32 = 5;
const OBJECTIVE: &str = "Official help-center steps for a person using this app on a Windows PC. Rank vendor support pages (Microsoft, Google, WhatsApp, Brave, Mozilla) first, then trusted how-to answers; skip videos and forums without answers. Pull the numbered steps with the exact menu, tab and button names.";
const RESULT_SEPARATOR: &str = "\n---\n";
const SNIPPET_CHARS: usize = 300;

pub fn request_body(query: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": TOOL, "arguments": { "query": query, "numResults": RESULTS, "objective": OBJECTIVE } } })
}

fn limited(message: &str) -> bool {
    message.to_lowercase().contains("rate limit")
}

/// The JSON-RPC message in an SSE stream (`data:` line) or a plain JSON body.
fn message(body: &str) -> Result<Value, SourceError> {
    let data = body.lines().find_map(|line| line.strip_prefix("data:")).unwrap_or(body);
    serde_json::from_str(data.trim()).map_err(|e| SourceError::Parse(format!("not JSON-RPC: {e}")))
}

fn block(text: &str, id: SourceId) -> Option<WebResult> {
    let field = |name: &str| text.lines().find_map(|line| line.strip_prefix(name)).map(str::trim).unwrap_or_default().to_string();
    let url = field("URL:");
    if !url.starts_with("https://") {
        return None;
    }
    let highlights = text.split_once("Highlights:").map(|(_, rest)| rest.trim()).unwrap_or_default();
    let body = highlights.lines().map(str::trim).filter(|l| *l != "...").collect::<Vec<_>>().join("\n");
    Some(WebResult { title: field("Title:"), url, snippet: clip(&squash(&body), SNIPPET_CHARS), source: id.label().into(), body })
}

/// Results from an Exa reply; a rate-limit message becomes `RateLimited`.
pub fn parse(body: &str, id: SourceId) -> Result<Vec<WebResult>, SourceError> {
    let message = message(body)?;
    if let Some(error) = message.get("error") {
        let text = error.get("message").and_then(Value::as_str).unwrap_or("unknown error");
        return Err(if limited(text) { SourceError::RateLimited(id.cooldown()) } else { SourceError::Parse(text.into()) });
    }
    let text = message.pointer("/result/content/0/text").and_then(Value::as_str).unwrap_or_default();
    if message.pointer("/result/isError").and_then(Value::as_bool) == Some(true) {
        return Err(if limited(text) { SourceError::RateLimited(id.cooldown()) } else { SourceError::Parse(clip(text, SNIPPET_CHARS)) });
    }
    Ok(text.split(RESULT_SEPARATOR).filter_map(|b| block(b, id)).collect())
}

pub async fn search(client: &reqwest::Client, query: &str, key: Option<&str>) -> Result<Vec<WebResult>, SourceError> {
    let id = if key.is_some() { SourceId::ExaKeyed } else { SourceId::Exa };
    let mut request = json_body(client.post(URL), &request_body(query)).header("Accept", "application/json, text/event-stream");
    if let Some(key) = key {
        request = request.header("x-api-key", key);
    }
    let response = request.send().await.map_err(|e| SourceError::from_reqwest(&e))?;
    let status = response.status().as_u16();
    let body = read_capped(response, MAX_ANSWER_BYTES).await;
    if !(200..300).contains(&status) {
        // The free tier explains its limit in the body as well as with 429.
        return Err(if body.as_deref().is_ok_and(limited) { SourceError::RateLimited(id.cooldown()) } else { SourceError::from_status(id, status) });
    }
    parse(&body?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPLY: &str = include_str!("fixtures/exa_freeze.txt");

    #[test]
    fn reads_titles_links_and_highlights_from_the_event_stream() {
        let results = parse(REPLY, SourceId::Exa).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[1].title, "Freeze panes to lock rows and columns");
        assert_eq!(results[1].url, "https://support.microsoft.com/en-us/excel/get-started/freeze-panes-to-lock-rows-and-columns");
        assert!(results[1].body.contains("2. Select View > Freeze Panes > Freeze Panes."));
        assert!(!results[1].body.contains("\n...\n"));
        assert!(results[0].snippet.chars().count() <= SNIPPET_CHARS + 1);
        assert_eq!(results[0].source, "Exa (free)");
    }

    #[test]
    fn treats_the_free_limit_as_a_rest_not_a_failure() {
        let error = r#"event: message
data: {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key."}}"#;
        assert_eq!(parse(error, SourceId::Exa), Err(SourceError::RateLimited(SourceId::Exa.cooldown())));
        let tool_error = r#"{"jsonrpc":"2.0","id":1,"result":{"isError":true,"content":[{"type":"text","text":"Rate limit exceeded"}]}}"#;
        assert_eq!(parse(tool_error, SourceId::Exa), Err(SourceError::RateLimited(SourceId::Exa.cooldown())));
        assert!(matches!(parse("<html>", SourceId::Exa), Err(SourceError::Parse(_))));
    }

    #[test]
    fn asks_with_the_required_objective() {
        let body = request_body("excel freeze top row");
        assert_eq!(body.pointer("/params/arguments/query").and_then(Value::as_str), Some("excel freeze top row"));
        assert!(body.pointer("/params/arguments/objective").is_some());
    }
}
