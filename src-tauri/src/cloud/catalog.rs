//! The model and voice lists behind Settings > Cloud's pickers. Fetched here with the saved key, so
//! the key never reaches the webview; only ids and display names come back.

use std::time::Duration;

use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{elevenlabs, gemini, keys};

const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
/// Gemini's largest page; a handful of pages covers every model.
const GEMINI_PAGE_SIZE: &str = "1000";
const MAX_GEMINI_PAGES: usize = 10;
/// Only models Hodey can ask for a teaching step.
const GEMINI_METHOD: &str = "generateContent";
const GEMINI_NAME_PREFIX: &str = "models/";
/// Gemini answers 400 (not 401) for a key it doesn't know.
const GEMINI_BAD_KEY: &str = "API_KEY_INVALID";
const ELEVENLABS_MODELS_URL: &str = "https://api.elevenlabs.io/v1/models";
const ELEVENLABS_VOICES_URL: &str = "https://api.elevenlabs.io/v1/voices";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
/// A list is a one-off settings request, so it may take longer than a teaching step.
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_DESCRIPTION_CHARS: usize = 300;
const MAX_NAME_CHARS: usize = 100;
const ERROR_BODY_CHARS: usize = 200;
const REJECTED: &str = "That key was rejected. Check it, then save it again.";

/// Mirrors `GeminiModel` in src/providers/cloud/catalog.ts.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeminiModel {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct GeminiPage {
    pub models: Vec<GeminiModel>,
    pub next: Option<String>,
}

/// Mirrors `ElevenLabsModel` in src/providers/cloud/catalog.ts.
#[derive(Serialize, Debug, PartialEq)]
pub struct ElevenLabsModel {
    pub id: String,
    pub name: String,
    pub multilingual: bool,
}

#[derive(Serialize, Debug, PartialEq, Default)]
pub struct VoiceLabels {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
}

/// Mirrors `ElevenLabsVoice` in src/providers/cloud/catalog.ts.
#[derive(Serialize, Debug, PartialEq)]
pub struct ElevenLabsVoice {
    pub id: String,
    pub name: String,
    pub category: String,
    pub labels: VoiceLabels,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGeminiModel {
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    #[serde(default)]
    supported_generation_methods: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGeminiPage {
    #[serde(default)]
    models: Vec<RawGeminiModel>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct RawElevenLabsModel {
    model_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    can_do_text_to_speech: bool,
    #[serde(default)]
    languages: Vec<Value>,
}

#[derive(Deserialize)]
struct RawVoices {
    voices: Vec<RawVoice>,
}

#[derive(Deserialize)]
struct RawVoice {
    voice_id: String,
    #[serde(default)]
    name: String,
    category: Option<String>,
    labels: Option<Map<String, Value>>,
}

fn clip(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

/// A display name, falling back to the id when the service sent none.
fn display(name: Option<&str>, id: &str) -> String {
    let name = clip(name.unwrap_or_default(), MAX_NAME_CHARS);
    if name.is_empty() { id.to_string() } else { name }
}

fn to_gemini_model(raw: RawGeminiModel) -> Option<GeminiModel> {
    if !raw.supported_generation_methods.iter().any(|m| m == GEMINI_METHOD) {
        return None;
    }
    let id = raw.name.strip_prefix(GEMINI_NAME_PREFIX).unwrap_or(&raw.name).to_string();
    if !gemini::valid_model(&id) {
        return None;
    }
    let description = raw.description.map(|d| clip(&d, MAX_DESCRIPTION_CHARS)).filter(|d| !d.is_empty());
    Some(GeminiModel { display_name: display(raw.display_name.as_deref(), &id), id, description })
}

/// One page of `GET /v1beta/models`: models that can generate content, ids without "models/".
pub fn parse_gemini_page(body: &str) -> Result<GeminiPage, String> {
    let raw: RawGeminiPage = serde_json::from_str(body).map_err(|e| format!("Gemini's model list didn't make sense: {e}"))?;
    let next = raw.next_page_token.filter(|token| !token.is_empty());
    Ok(GeminiPage { models: raw.models.into_iter().filter_map(to_gemini_model).collect(), next })
}

/// `GET /v1/models`: models that can speak, and whether each speaks more than one language.
pub fn parse_elevenlabs_models(body: &str) -> Result<Vec<ElevenLabsModel>, String> {
    let raw: Vec<RawElevenLabsModel> = serde_json::from_str(body).map_err(|e| format!("ElevenLabs' model list didn't make sense: {e}"))?;
    let speaking = raw.into_iter().filter(|m| m.can_do_text_to_speech && elevenlabs::valid_model(&m.model_id));
    Ok(speaking.map(|m| ElevenLabsModel { name: display(Some(&m.name), &m.model_id), id: m.model_id, multilingual: m.languages.len() > 1 }).collect())
}

fn label(labels: &Option<Map<String, Value>>, key: &str) -> Option<String> {
    let value = labels.as_ref()?.get(key)?.as_str()?;
    Some(clip(value, MAX_NAME_CHARS)).filter(|v| !v.is_empty())
}

fn to_voice(raw: RawVoice) -> Option<ElevenLabsVoice> {
    if !elevenlabs::valid_voice(&raw.voice_id) {
        return None;
    }
    let labels = VoiceLabels { accent: label(&raw.labels, "accent"), gender: label(&raw.labels, "gender") };
    let category = clip(raw.category.as_deref().unwrap_or_default(), MAX_NAME_CHARS);
    Some(ElevenLabsVoice { name: display(Some(&raw.name), &raw.voice_id), id: raw.voice_id, category, labels })
}

/// `GET /v1/voices`: every voice the account can use, sorted by name.
pub fn parse_elevenlabs_voices(body: &str) -> Result<Vec<ElevenLabsVoice>, String> {
    let raw: RawVoices = serde_json::from_str(body).map_err(|e| format!("ElevenLabs' voice list didn't make sense: {e}"))?;
    let mut voices: Vec<ElevenLabsVoice> = raw.voices.into_iter().filter_map(to_voice).collect();
    voices.sort_by_key(|voice| voice.name.to_lowercase());
    Ok(voices)
}

/// A readable reason for a failed list request. Never includes the key.
pub fn status_message(service: &str, status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED => REJECTED.into(),
        StatusCode::BAD_REQUEST if body.contains(GEMINI_BAD_KEY) => REJECTED.into(),
        StatusCode::FORBIDDEN => format!("{service} says this key isn't allowed to list these. Check the key's permissions."),
        StatusCode::TOO_MANY_REQUESTS => format!("{service} is busy for this key right now. Try again in a minute."),
        _ => format!("{service} answered {status}."),
    }
}

pub fn gemini_page_url(token: Option<&str>) -> String {
    let mut url = Url::parse(GEMINI_MODELS_URL).expect("GEMINI_MODELS_URL is a valid URL");
    url.query_pairs_mut().append_pair("pageSize", GEMINI_PAGE_SIZE);
    if let Some(token) = token {
        url.query_pairs_mut().append_pair("pageToken", token);
    }
    url.into()
}

/// One authenticated GET; the key travels only in `header`.
async fn get(service: &str, url: &str, header: &str, key: &str) -> Result<String, String> {
    let client = reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT).timeout(LIST_TIMEOUT).build().map_err(|e| e.to_string())?;
    let response = client.get(url).header(header, key).send().await.map_err(|e| format!("Couldn't reach {service}: {}", e.without_url()))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| format!("{service}'s answer was cut off: {}", e.without_url()))?;
    if status.is_success() {
        return Ok(body);
    }
    eprintln!("{service} list request answered {status}: {}", clip(&body, ERROR_BODY_CHARS));
    Err(status_message(service, status, &body))
}

/// Every Gemini model this key can ask for a teaching step.
#[tauri::command]
pub async fn gemini_list_models() -> Result<Vec<GeminiModel>, String> {
    let key = keys::read("gemini").ok_or("No Gemini key is saved.")?;
    let mut models = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_GEMINI_PAGES {
        let page = parse_gemini_page(&get("Gemini", &gemini_page_url(token.as_deref()), "x-goog-api-key", &key).await?)?;
        models.extend(page.models);
        token = page.next;
        if token.is_none() {
            break;
        }
    }
    Ok(models)
}

/// ElevenLabs models that can speak Hodey's lines.
#[tauri::command]
pub async fn elevenlabs_list_models() -> Result<Vec<ElevenLabsModel>, String> {
    let key = keys::read("elevenlabs").ok_or("No ElevenLabs key is saved.")?;
    parse_elevenlabs_models(&get("ElevenLabs", ELEVENLABS_MODELS_URL, "xi-api-key", &key).await?)
}

/// The voices on the learner's ElevenLabs account.
#[tauri::command]
pub async fn elevenlabs_list_voices() -> Result<Vec<ElevenLabsVoice>, String> {
    let key = keys::read("elevenlabs").ok_or("No ElevenLabs key is saved.")?;
    parse_elevenlabs_voices(&get("ElevenLabs", ELEVENLABS_VOICES_URL, "xi-api-key", &key).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GEMINI_PAGE: &str = r#"{
      "models": [
        { "name": "models/gemini-3.8-flash", "displayName": "Gemini 3.8 Flash", "description": "Fast and smart.",
          "supportedGenerationMethods": ["generateContent", "countTokens"] },
        { "name": "models/text-embedding-004", "displayName": "Text Embedding 004", "supportedGenerationMethods": ["embedContent"] },
        { "name": "models/gemini-3.7-flash", "supportedGenerationMethods": ["generateContent"] },
        { "name": "models/evil/../x", "displayName": "Evil", "supportedGenerationMethods": ["generateContent"] }
      ],
      "nextPageToken": "page2=="
    }"#;

    #[test]
    fn keeps_gemini_models_that_generate_content_without_the_prefix() {
        let page = parse_gemini_page(GEMINI_PAGE).unwrap();
        assert_eq!(page.next.as_deref(), Some("page2=="));
        assert_eq!(page.models, vec![
            GeminiModel { id: "gemini-3.8-flash".into(), display_name: "Gemini 3.8 Flash".into(), description: Some("Fast and smart.".into()) },
            GeminiModel { id: "gemini-3.7-flash".into(), display_name: "gemini-3.7-flash".into(), description: None },
        ]);
        let json = serde_json::to_value(&page.models[0]).unwrap();
        assert_eq!(json, serde_json::json!({ "id": "gemini-3.8-flash", "displayName": "Gemini 3.8 Flash", "description": "Fast and smart." }));
    }

    #[test]
    fn the_last_gemini_page_has_no_token() {
        assert_eq!(parse_gemini_page(r#"{ "models": [], "nextPageToken": "" }"#).unwrap().next, None);
        assert_eq!(parse_gemini_page("{}").unwrap(), GeminiPage { models: vec![], next: None });
        assert!(parse_gemini_page("<html>").is_err());
    }

    #[test]
    fn page_tokens_are_escaped_into_the_query() {
        assert_eq!(gemini_page_url(None), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
        assert_eq!(gemini_page_url(Some("a+b/c==")), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=a%2Bb%2Fc%3D%3D");
    }

    #[test]
    fn keeps_elevenlabs_models_that_speak() {
        let body = r#"[
          { "model_id": "eleven_flash_v2_5", "name": "Eleven Flash v2.5", "can_do_text_to_speech": true,
            "languages": [{ "language_id": "en", "name": "English" }, { "language_id": "hi", "name": "Hindi" }] },
          { "model_id": "eleven_monolingual_v1", "name": "Eleven English v1", "can_do_text_to_speech": true, "languages": [{ "language_id": "en", "name": "English" }] },
          { "model_id": "eleven_english_sts_v2", "name": "Eleven English v2", "can_do_text_to_speech": false, "languages": [] },
          { "model_id": "bad id", "name": "Bad", "can_do_text_to_speech": true }
        ]"#;
        assert_eq!(parse_elevenlabs_models(body).unwrap(), vec![
            ElevenLabsModel { id: "eleven_flash_v2_5".into(), name: "Eleven Flash v2.5".into(), multilingual: true },
            ElevenLabsModel { id: "eleven_monolingual_v1".into(), name: "Eleven English v1".into(), multilingual: false },
        ]);
        assert!(parse_elevenlabs_models(r#"{ "detail": "nope" }"#).is_err());
    }

    #[test]
    fn lists_elevenlabs_voices_by_name_with_accent_and_gender() {
        let body = r#"{ "voices": [
          { "voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "category": "premade",
            "labels": { "accent": "american", "gender": "female", "age": "young" } },
          { "voice_id": "JBFqnCBsd6RMkjVDRZzb", "name": "George", "category": "premade", "labels": { "accent": "british" } },
          { "voice_id": "abc123", "name": "my clone", "category": "cloned", "labels": null },
          { "voice_id": "../x", "name": "Evil" }
        ] }"#;
        let voices = parse_elevenlabs_voices(body).unwrap();
        assert_eq!(voices.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(), ["George", "my clone", "Sarah"]);
        assert_eq!(voices[2].labels, VoiceLabels { accent: Some("american".into()), gender: Some("female".into()) });
        assert_eq!(voices[1].labels, VoiceLabels::default());
        assert_eq!(serde_json::to_value(&voices[0]).unwrap(), serde_json::json!({ "id": "JBFqnCBsd6RMkjVDRZzb", "name": "George", "category": "premade", "labels": { "accent": "british" } }));
    }

    #[test]
    fn explains_failures_without_echoing_anything_secret() {
        assert_eq!(status_message("ElevenLabs", StatusCode::UNAUTHORIZED, ""), REJECTED);
        assert_eq!(status_message("Gemini", StatusCode::BAD_REQUEST, r#"{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}"#), REJECTED);
        assert!(status_message("Gemini", StatusCode::FORBIDDEN, "").contains("permissions"));
        assert!(status_message("Gemini", StatusCode::TOO_MANY_REQUESTS, "").contains("Try again"));
        assert_eq!(status_message("Gemini", StatusCode::INTERNAL_SERVER_ERROR, "boom"), "Gemini answered 500 Internal Server Error.");
    }
}
