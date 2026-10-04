//! Opt-in Gemini reasoning (PRD §10.1). Only text leaves the PC: the lesson step, the skill level
//! and UI Automation labels with their rectangles. No screenshot, audio or learner words.

use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::header::RETRY_AFTER;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};

use super::gemini_guard::{backoff, retry_delay, Guard};

const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
/// Dev builds only: overrides the model chosen in Settings > Cloud.
const MODEL_ENV: &str = "GEMINI_MODEL";
/// Must match `DEFAULT_GEMINI_MODEL` in src/data/settings.ts.
const DEFAULT_MODEL: &str = "gemini-3.5-flash-lite";
/// Longer than any Gemini model id; the id goes into the request URL.
const MAX_MODEL_CHARS: usize = 80;
/// A slow cloud answer is worse than the local one; the policy then cools Gemini down.
const TIMEOUT: Duration = Duration::from_secs(6);
/// The model list is checked before the first request; past this the chosen model is simply tried.
const LIST_WAIT: Duration = Duration::from_secs(2);
/// Gemini 3 models think by default; a tutor's next step needs little of it.
const GEMINI_3_PREFIX: &str = "gemini-3";
const THINKING_LEVEL: &str = "low";
/// Far above any real request (40 controls); stops runaway payloads.
const MAX_REQUEST_CHARS: usize = 16_000;
const MAX_ERROR_CHARS: usize = 200;
/// Must match `visionReplySchema` kinds in src/providers/vision/schema.ts.
const KINDS: [&str; 4] = ["guide", "answer", "clarify", "complete"];

/// Mirrors `GeminiRequest` in src/providers/cloud/gemini-reasoner.ts. Unknown fields (an image) are refused.
#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct GeminiRequest {
    pub system: String,
    pub prompt: String,
}

/// Letters, digits, `-`, `.` and `_` only, so the id is safe inside the request URL.
pub fn valid_model(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_MODEL_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

/// The model for one request: the dev override, else the learner's choice, else the default.
pub fn model_id(setting: Option<String>, env: Option<String>, dev: bool) -> Result<String, String> {
    let clean = |v: Option<String>| v.map(|m| m.trim().to_string()).filter(|m| !m.is_empty());
    let env = if dev { clean(env) } else { None };
    let model = env.or_else(|| clean(setting)).unwrap_or_else(|| DEFAULT_MODEL.to_string());
    if !valid_model(&model) {
        return Err(format!("\"{model}\" isn't a Gemini model id"));
    }
    Ok(model)
}

pub fn endpoint(model: &str) -> String {
    format!("{API_BASE}/{model}:generateContent")
}

fn response_schema() -> Value {
    json!({
        "type": "OBJECT",
        "properties": {
            "kind": { "type": "STRING", "enum": KINDS },
            "speech": { "type": "STRING" },
            "target_index": { "type": "INTEGER" },
            "confidence": { "type": "NUMBER" }
        },
        "required": ["kind", "speech", "target_index", "confidence"],
        "propertyOrdering": ["kind", "speech", "target_index", "confidence"]
    })
}

pub fn validate(request: &GeminiRequest) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("Nothing to ask Gemini.".into());
    }
    if request.system.chars().count() + request.prompt.chars().count() > MAX_REQUEST_CHARS {
        return Err("The Gemini request is too large.".into());
    }
    Ok(())
}

/// The generateContent body: text parts only, JSON output constrained to the teaching-action schema.
pub fn build_body(request: &GeminiRequest, model: &str) -> Value {
    let mut config = json!({ "responseMimeType": "application/json", "responseSchema": response_schema() });
    if model.starts_with(GEMINI_3_PREFIX) {
        config["thinkingConfig"] = json!({ "thinkingLevel": THINKING_LEVEL });
    }
    json!({
        "systemInstruction": { "parts": [{ "text": request.system }] },
        "contents": [{ "role": "user", "parts": [{ "text": request.prompt }] }],
        "generationConfig": config
    })
}

/// The first non-thought text part of the first candidate, parsed as JSON.
pub fn extract_reply(response: &Value) -> Result<Value, String> {
    let Some(candidate) = response.pointer("/candidates/0") else {
        let reason = response.pointer("/promptFeedback/blockReason").and_then(Value::as_str).unwrap_or("no candidates");
        return Err(format!("Gemini gave no answer ({reason})"));
    };
    let parts = candidate.pointer("/content/parts").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    let text = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) != Some(true))
        .find_map(|part| part.get("text").and_then(Value::as_str))
        .ok_or_else(|| {
            let finish = candidate.get("finishReason").and_then(Value::as_str).unwrap_or("unknown");
            format!("Gemini's answer had no text (finish reason {finish})")
        })?;
    serde_json::from_str(text).map_err(|e| format!("Gemini's answer isn't JSON ({e}): {}", truncate(text)))
}

fn truncate(text: &str) -> String {
    text.chars().take(MAX_ERROR_CHARS).collect()
}

/// reqwest's top-level message ("error sending request") hides why; the cause chain says it.
fn describe(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("no answer within {}s", TIMEOUT.as_secs());
    }
    let error = error.without_url();
    let mut message = error.to_string();
    let mut cause = std::error::Error::source(&error);
    while let Some(inner) = cause {
        message = format!("{message}: {inner}");
        cause = inner.source();
    }
    message
}

/// Why a request failed: an HTTP status worth acting on (404, 429, 503), or anything else.
enum Failure {
    Status { status: StatusCode, body: String, retry_after: Option<String> },
    Other(String),
}

impl Failure {
    fn message(&self) -> String {
        match self {
            Failure::Status { status, body, .. } => format!("Gemini answered {status}: {}", truncate(body)),
            Failure::Other(message) => message.clone(),
        }
    }
}

static GUARD: LazyLock<Mutex<Guard>> = LazyLock::new(Mutex::default);

/// The guard holds only counters and timestamps, so state left by a panicking holder is still usable.
fn guard() -> MutexGuard<'static, Guard> {
    GUARD.lock().unwrap_or_else(PoisonError::into_inner)
}

async fn post(key: &str, model: &str, body: &Value) -> Result<Value, Failure> {
    let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| Failure::Other(e.to_string()))?;
    let sent = client.post(endpoint(model)).header("x-goog-api-key", key).header("Content-Type", "application/json").body(body.to_string()).send().await;
    let response = sent.map_err(|e| Failure::Other(format!("Couldn't reach Gemini: {}", describe(e))))?;
    let status = response.status();
    let retry_after = response.headers().get(RETRY_AFTER).and_then(|v| v.to_str().ok()).map(str::to_string);
    let text = response.text().await.map_err(|e| Failure::Other(format!("Gemini's answer was cut off: {}", describe(e))))?;
    if !status.is_success() {
        return Err(Failure::Status { status, body: text, retry_after });
    }
    serde_json::from_str(&text).map_err(|e| Failure::Other(format!("Gemini's response isn't JSON: {e}")))
}

fn entropy() -> u32 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or_default()
}

/// One request, and one jittered retry if Gemini is overloaded (503). Every attempt counts toward the RPM.
async fn send(key: &str, model: &str, body: &Value) -> Result<Value, Failure> {
    guard().admit(model, Instant::now()).map_err(Failure::Other)?;
    match post(key, model, body).await {
        Err(Failure::Status { status: StatusCode::SERVICE_UNAVAILABLE, .. }) => {
            tokio::time::sleep(backoff(entropy())).await;
            guard().admit(model, Instant::now()).map_err(Failure::Other)?;
            post(key, model, body).await
        }
        other => other,
    }
}

/// Learns which models exist once per session. A slow or failed list just leaves the 404 check to do it.
async fn learn_models() {
    if !guard().needs_list() {
        return;
    }
    match tokio::time::timeout(LIST_WAIT, super::catalog::gemini_list_models()).await {
        Ok(Ok(models)) => guard().set_listed(models.into_iter().map(|model| model.id).collect()),
        Ok(Err(e)) => eprintln!("couldn't list Gemini models; trusting the chosen one: {e}"),
        Err(_) => eprintln!("listing Gemini models took over {}s; trusting the chosen one", LIST_WAIT.as_secs()),
    }
}

/// The chosen model if Google has it, else the default; a 404 retires the model for the session.
async fn ask(key: &str, chosen: &str, request: &GeminiRequest) -> Result<Value, Failure> {
    learn_models().await;
    let model = guard().usable(chosen, DEFAULT_MODEL);
    if model != chosen {
        eprintln!("Gemini has no model \"{chosen}\"; asking {model}");
    }
    match send(key, &model, &build_body(request, &model)).await {
        Err(Failure::Status { status: StatusCode::NOT_FOUND, .. }) if model != DEFAULT_MODEL => {
            eprintln!("Gemini answered 404 for \"{model}\"; using {DEFAULT_MODEL} from now on");
            guard().mark_unavailable(&model);
            send(key, DEFAULT_MODEL, &build_body(request, DEFAULT_MODEL)).await
        }
        other => other,
    }
}

/// A 429 pauses Gemini for as long as Google asked, so the next steps go local without a request.
fn explain(failure: Failure) -> String {
    match failure {
        Failure::Status { status: StatusCode::TOO_MANY_REQUESTS, body, retry_after } => {
            let wait = guard().pause(Instant::now(), retry_delay(&body, retry_after.as_deref()));
            format!("Gemini's rate limit was reached (429); local reasoning for the next {}s", wait.as_secs())
        }
        other => other.message(),
    }
}

/// Asks Gemini for the next teaching action. The key is read here and never returned.
#[tauri::command]
pub async fn gemini_reason(request: GeminiRequest, model: Option<String>) -> Result<Value, String> {
    validate(&request)?;
    let model = model_id(model, super::dev_env::var(MODEL_ENV), cfg!(debug_assertions))?;
    let key = super::keys::read("gemini").ok_or("No Gemini key is saved.")?;
    let response = ask(&key, &model, &request).await.map_err(explain).inspect_err(|e| eprintln!("Gemini request failed: {e}"))?;
    extract_reply(&response).inspect_err(|e| eprintln!("Gemini reply unusable: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> GeminiRequest {
        GeminiRequest { system: "You are Hodey.".into(), prompt: "Current step: Open the Insert tab.".into() }
    }

    #[test]
    fn model_comes_from_settings_with_a_dev_only_env_override() {
        assert_eq!(model_id(None, None, true), Ok(DEFAULT_MODEL.to_string()));
        assert_eq!(model_id(Some(" gemini-3.7-flash ".into()), None, false), Ok("gemini-3.7-flash".to_string()));
        assert_eq!(model_id(Some("".into()), None, false), Ok(DEFAULT_MODEL.to_string()));
        assert_eq!(model_id(Some("gemini-3.7-flash".into()), Some("gemini-2.5-flash".into()), true), Ok("gemini-2.5-flash".to_string()));
        assert_eq!(model_id(Some("gemini-3.7-flash".into()), Some("gemini-2.5-flash".into()), false), Ok("gemini-3.7-flash".to_string()));
    }

    #[test]
    fn model_is_safe_in_a_url() {
        assert!(model_id(Some("x/../../evil?y".into()), None, false).is_err());
        assert!(model_id(None, Some("a b".into()), true).is_err());
        assert!(model_id(Some("g".repeat(MAX_MODEL_CHARS + 1)), None, false).is_err());
        assert!(valid_model("gemini-2.5-flash-lite"));
        assert_eq!(endpoint("gemini-3.7-flash"), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent");
    }

    #[test]
    fn body_is_text_only_with_structured_output() {
        let body = build_body(&request(), "gemini-3.7-flash");
        assert_eq!(body.pointer("/systemInstruction/parts/0/text"), Some(&json!("You are Hodey.")));
        assert_eq!(body.pointer("/contents/0/parts").and_then(Value::as_array).map(Vec::len), Some(1));
        assert_eq!(body.pointer("/contents/0/parts/0/text"), Some(&json!("Current step: Open the Insert tab.")));
        assert_eq!(body.pointer("/generationConfig/responseMimeType"), Some(&json!("application/json")));
        assert_eq!(body.pointer("/generationConfig/responseSchema/properties/kind/enum"), Some(&json!(KINDS)));
        assert_eq!(body.pointer("/generationConfig/thinkingConfig/thinkingLevel"), Some(&json!(THINKING_LEVEL)));
        assert!(!body.to_string().contains("inlineData"));
    }

    #[test]
    fn older_models_get_no_thinking_level() {
        assert!(build_body(&request(), "gemini-2.5-flash").pointer("/generationConfig/thinkingConfig").is_none());
    }

    #[test]
    fn refuses_images_and_oversized_requests() {
        let with_image = json!({ "system": "s", "prompt": "p", "image": "iVBOR" });
        assert!(serde_json::from_value::<GeminiRequest>(with_image).is_err());
        assert!(validate(&GeminiRequest { system: "s".into(), prompt: "x".repeat(MAX_REQUEST_CHARS) }).is_err());
        assert!(validate(&GeminiRequest { system: "s".into(), prompt: " ".into() }).is_err());
        assert!(validate(&request()).is_ok());
    }

    #[test]
    fn extracts_the_json_answer() {
        let reply = r#"{"kind":"guide","speech":"Open Insert.","target_index":0,"confidence":0.9}"#;
        let response = json!({ "candidates": [{ "content": { "role": "model", "parts": [
            { "text": "planning…", "thought": true },
            { "text": reply, "thoughtSignature": "abc" }
        ] }, "finishReason": "STOP" }] });
        assert_eq!(extract_reply(&response), Ok(json!({ "kind": "guide", "speech": "Open Insert.", "target_index": 0, "confidence": 0.9 })));
    }

    #[test]
    fn explains_unusable_answers() {
        let blocked = json!({ "promptFeedback": { "blockReason": "SAFETY" } });
        assert!(extract_reply(&blocked).unwrap_err().contains("SAFETY"));
        let empty = json!({ "candidates": [{ "content": { "parts": [] }, "finishReason": "MAX_TOKENS" }] });
        assert!(extract_reply(&empty).unwrap_err().contains("MAX_TOKENS"));
        let prose = json!({ "candidates": [{ "content": { "parts": [{ "text": "Sure! Click Insert." }] } }] });
        assert!(extract_reply(&prose).unwrap_err().contains("isn't JSON"));
    }

    /// `cargo test --lib live_ -- --ignored --nocapture` runs the live checks; this one is one tiny request.
    #[test]
    #[ignore = "live: spends a few Gemini tokens"]
    fn live_gemini_returns_a_teaching_action() {
        let reply = tauri::async_runtime::block_on(gemini_reason(request(), None)).expect("Gemini answered");
        let model = model_id(None, super::super::dev_env::var(MODEL_ENV), true).expect("a valid model");
        println!("Gemini ({model}): {reply}");
        assert!(reply["kind"].as_str().is_some_and(|kind| KINDS.contains(&kind)), "{reply}");
    }

    /// The list check swaps a model Google doesn't have for the default, so no request 404s.
    #[test]
    #[ignore = "live: lists models (free) and spends one small Gemini request"]
    fn live_gemini_falls_back_from_a_model_google_doesnt_have() {
        let reply = tauri::async_runtime::block_on(gemini_reason(request(), Some("gemini-0-made-up".into()))).expect("the default model answered");
        println!("Gemini (made-up model, default answered): {reply}");
        assert!(reply["kind"].as_str().is_some_and(|kind| KINDS.contains(&kind)), "{reply}");
    }
}
