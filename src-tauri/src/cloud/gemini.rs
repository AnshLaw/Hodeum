//! Opt-in Gemini reasoning (PRD §10.1). Only text leaves the PC: the lesson step, the skill level
//! and UI Automation labels with their rectangles. No screenshot, audio or learner words.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_ENV: &str = "GEMINI_MODEL";
const DEFAULT_MODEL: &str = "gemini-3.7-flash";
/// A slow cloud answer is worse than the local one; the policy then cools Gemini down.
const TIMEOUT: Duration = Duration::from_secs(6);
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

pub fn model_id(env: Option<String>) -> Result<String, String> {
    let model = env.map(|m| m.trim().to_string()).filter(|m| !m.is_empty()).unwrap_or_else(|| DEFAULT_MODEL.to_string());
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')) {
        return Err(format!("{MODEL_ENV} \"{model}\" isn't a model id"));
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

async fn post(key: &str, model: &str, body: &Value) -> Result<Value, String> {
    let client = reqwest::Client::builder().timeout(TIMEOUT).build().map_err(|e| e.to_string())?;
    let response = client
        .post(endpoint(model))
        .header("x-goog-api-key", key)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Gemini: {}", e.without_url()))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Gemini's answer was cut off: {}", e.without_url()))?;
    if !status.is_success() {
        return Err(format!("Gemini answered {status}: {}", truncate(&text)));
    }
    serde_json::from_str(&text).map_err(|e| format!("Gemini's response isn't JSON: {e}"))
}

/// Asks Gemini for the next teaching action. The key is read here and never returned.
#[tauri::command]
pub async fn gemini_reason(request: GeminiRequest) -> Result<Value, String> {
    validate(&request)?;
    let key = super::keys::read("gemini").ok_or("No Gemini key is saved.")?;
    let model = model_id(std::env::var(MODEL_ENV).ok())?;
    let response = post(&key, &model, &build_body(&request, &model)).await.inspect_err(|e| eprintln!("Gemini request failed: {e}"))?;
    extract_reply(&response).inspect_err(|e| eprintln!("Gemini reply unusable: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> GeminiRequest {
        GeminiRequest { system: "You are Hodey.".into(), prompt: "Current step: Open the Insert tab.".into() }
    }

    #[test]
    fn model_is_configurable_and_safe_in_a_url() {
        assert_eq!(model_id(None), Ok(DEFAULT_MODEL.to_string()));
        assert_eq!(model_id(Some(" gemini-2.5-flash ".into())), Ok("gemini-2.5-flash".to_string()));
        assert_eq!(model_id(Some("".into())), Ok(DEFAULT_MODEL.to_string()));
        assert!(model_id(Some("x/../../evil?y".into())).is_err());
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
}
