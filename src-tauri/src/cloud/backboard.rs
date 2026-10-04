//! Opt-in Backboard learning memory (PRD 18.1). One assistant per Hodian, one thread per Hode, and
//! only the compact end-of-Hode summary is ever sent. The key stays here (`keys::read`).
//!
//! Endpoints, header and bodies follow docs.backboard.io (API reference, fetched 2026-10-03):
//! `POST /assistants`, `POST /assistants/{id}/threads`, `POST /threads/{id}/messages` with
//! `memory: "Auto" | "Readonly"`, and `POST /assistants/{id}/memories/search`.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::keys;

const BASE_URL: &str = "https://app.backboard.io/api";
const KEY_HEADER: &str = "X-API-Key";
/// Adding a message runs Backboard's model to extract memories, so it gets longer than a search.
const TIMEOUT: Duration = Duration::from_secs(20);
const ASSISTANT_NAME: &str = "Hodeum learner";
const ASSISTANT_PROMPT: &str = "You keep learning notes for one Hodeum learner: skills practised, steps they needed help with, preferred language and how much help to start with. Messages are compact JSON summaries, never transcripts.";
/// Backboard's add-message memory modes Hodeum uses ("off" would make the call pointless).
const MEMORY_MODES: [&str; 2] = ["Auto", "Readonly"];
/// Backboard accepts 1 to 50 search results.
const MAX_SEARCH_LIMIT: u32 = 50;
/// A summary is a few hundred characters; this stops anything larger from leaving the PC.
const MAX_CONTENT_CHARS: usize = 2000;
const MAX_QUERY_CHARS: usize = 300;
/// Backboard ids are UUIDs; anything longer or with other characters is refused before a URL is built.
const MAX_ID_CHARS: usize = 64;

/// A POST to Backboard: path under `BASE_URL` and its JSON body. Built without I/O so it's testable.
#[derive(Debug, PartialEq)]
pub struct Request {
    pub path: String,
    pub body: Value,
}

/// Mirrors `BackboardMemory` in src/providers/memory/backboard-memory.ts.
#[derive(Debug, PartialEq, Serialize)]
pub struct MemoryItem {
    pub content: String,
}

fn valid_id<'a>(id: &'a str, what: &str) -> Result<&'a str, String> {
    let ok = !id.is_empty() && id.len() <= MAX_ID_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(id)
    } else {
        Err(format!("invalid Backboard {what} id"))
    }
}

pub fn create_assistant_request() -> Request {
    Request { path: "/assistants".into(), body: json!({ "name": ASSISTANT_NAME, "system_prompt": ASSISTANT_PROMPT }) }
}

pub fn create_thread_request(assistant_id: &str) -> Result<Request, String> {
    let id = valid_id(assistant_id, "assistant")?;
    Ok(Request { path: format!("/assistants/{id}/threads"), body: json!({}) })
}

pub fn add_message_request(thread_id: &str, content: &str, memory: &str) -> Result<Request, String> {
    let id = valid_id(thread_id, "thread")?;
    if !MEMORY_MODES.contains(&memory) {
        return Err(format!("unsupported Backboard memory mode \"{memory}\""));
    }
    if content.trim().is_empty() || content.chars().count() > MAX_CONTENT_CHARS {
        return Err("a learning summary must be non-empty and compact".into());
    }
    Ok(Request { path: format!("/threads/{id}/messages"), body: json!({ "content": content, "memory": memory, "stream": false }) })
}

pub fn search_memories_request(assistant_id: &str, query: &str, limit: u32) -> Result<Request, String> {
    let id = valid_id(assistant_id, "assistant")?;
    let query: String = query.chars().take(MAX_QUERY_CHARS).collect();
    if query.trim().is_empty() {
        return Err("a memory search needs a query".into());
    }
    Ok(Request { path: format!("/assistants/{id}/memories/search"), body: json!({ "query": query, "limit": limit.clamp(1, MAX_SEARCH_LIMIT) }) })
}

/// A required string field of a response, e.g. `assistant_id` or `thread_id`.
pub fn parse_id(response: &Value, field: &str) -> Result<String, String> {
    let id = response.get(field).and_then(Value::as_str).ok_or_else(|| format!("Backboard's reply had no {field}"))?;
    valid_id(id, field).map(str::to_string)
}

/// `{ "memories": [{ "content": ... }] }`; entries without text are skipped.
pub fn parse_memories(response: &Value) -> Vec<MemoryItem> {
    let items = response.get("memories").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    items
        .iter()
        .filter_map(|item| item.get("content").and_then(Value::as_str))
        .filter(|content| !content.trim().is_empty())
        .map(|content| MemoryItem { content: content.to_string() })
        .collect()
}

async fn post(request: Request) -> Result<Value, String> {
    let key = keys::read("backboard").ok_or("No Backboard key is saved")?;
    let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
    let response = client
        .post(format!("{BASE_URL}{}", request.path))
        .header(KEY_HEADER, key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(request.body.to_string())
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Backboard: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Backboard's reply was unreadable: {e}"))?;
    if !status.is_success() {
        return Err(format!("Backboard answered {status}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Backboard's reply wasn't JSON: {e}"))
}

#[tauri::command]
pub async fn backboard_create_assistant() -> Result<String, String> {
    parse_id(&post(create_assistant_request()).await?, "assistant_id")
}

#[tauri::command]
pub async fn backboard_create_thread(assistant_id: String) -> Result<String, String> {
    parse_id(&post(create_thread_request(&assistant_id)?).await?, "thread_id")
}

#[tauri::command]
pub async fn backboard_add_message(thread_id: String, content: String, memory: String) -> Result<(), String> {
    post(add_message_request(&thread_id, &content, &memory)?).await.map(|_| ())
}

#[tauri::command]
pub async fn backboard_search_memories(assistant_id: String, query: String, limit: u32) -> Result<Vec<MemoryItem>, String> {
    Ok(parse_memories(&post(search_memories_request(&assistant_id, &query, limit)?).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASSISTANT: &str = "123e4567-e89b-12d3-a456-426655440000";

    #[test]
    fn builds_the_assistant_and_thread_requests() {
        let assistant = create_assistant_request();
        assert_eq!(assistant.path, "/assistants");
        assert_eq!(assistant.body["name"], ASSISTANT_NAME);
        assert_eq!(create_thread_request(ASSISTANT).unwrap(), Request { path: format!("/assistants/{ASSISTANT}/threads"), body: json!({}) });
    }

    #[test]
    fn builds_an_add_message_request_with_the_memory_mode() {
        let request = add_message_request("thread-1", "{\"hode\":\"Make a PivotTable\"}", "Auto").unwrap();
        assert_eq!(request.path, "/threads/thread-1/messages");
        assert_eq!(request.body, json!({ "content": "{\"hode\":\"Make a PivotTable\"}", "memory": "Auto", "stream": false }));
        assert!(add_message_request("thread-1", "summary", "Readonly").is_ok());
        assert!(add_message_request("thread-1", "summary", "off").is_err());
        assert!(add_message_request("thread-1", " ", "Auto").is_err());
        assert!(add_message_request("thread-1", &"x".repeat(MAX_CONTENT_CHARS + 1), "Auto").is_err());
    }

    #[test]
    fn builds_a_search_request_with_a_clamped_limit() {
        let request = search_memories_request(ASSISTANT, "Make a PivotTable excel.pivot.create", 500).unwrap();
        assert_eq!(request.path, format!("/assistants/{ASSISTANT}/memories/search"));
        assert_eq!(request.body, json!({ "query": "Make a PivotTable excel.pivot.create", "limit": MAX_SEARCH_LIMIT }));
        assert_eq!(search_memories_request(ASSISTANT, "q", 0).unwrap().body["limit"], 1);
        assert!(search_memories_request(ASSISTANT, "  ", 5).is_err());
    }

    #[test]
    fn refuses_ids_that_would_change_the_url() {
        for bad in ["", "../assistants", "a/b", "a?b", "a b", &"a".repeat(MAX_ID_CHARS + 1)] {
            assert!(create_thread_request(bad).is_err(), "{bad}");
            assert!(add_message_request(bad, "summary", "Auto").is_err(), "{bad}");
            assert!(search_memories_request(bad, "q", 5).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_ids_and_memories_from_replies() {
        let assistant = json!({ "assistant_id": ASSISTANT, "name": ASSISTANT_NAME, "created_at": "2026-10-03T00:00:00Z" });
        assert_eq!(parse_id(&assistant, "assistant_id").unwrap(), ASSISTANT);
        assert!(parse_id(&json!({ "thread_id": "bad/id" }), "thread_id").is_err());
        assert!(parse_id(&json!({}), "thread_id").is_err());
        let found = json!({ "memories": [{ "id": "m1", "content": "Needed help selecting the range", "score": 0.9 }, { "id": "m2", "content": "" }], "total_count": 2 });
        assert_eq!(parse_memories(&found), vec![MemoryItem { content: "Needed help selecting the range".into() }]);
        assert!(parse_memories(&json!({})).is_empty());
    }
}
