//! ElevenLabs Flash v2.5, Hodey's opt-in cloud voice (PRD §14.1). Only Hodey's own sentence is sent.
//!
//! HTTP streaming (`POST /v1/text-to-speech/{voice}/stream`) rather than the stream-input WebSocket:
//! Hodey's speech path hands over a whole utterance at once, so streaming text *in* gains nothing, while
//! audio still streams *out* chunk by chunk. It reuses the `reqwest` client already in the app, and
//! `connect_timeout` / `read_timeout` make a dead network fall back to the local voice quickly.
//!
//! Audio plays on Hodey's local speaker (`StopSwitch`), so the barge-in `tts_stop` silences it at once
//! and Windows' echo cancellation hears it as Hodey's own voice.

use std::num::NonZero;
use std::sync::Arc;
use std::time::Duration;

use rodio::buffer::SamplesBuffer;
use serde_json::json;
use tauri::State;

use super::keys;
use crate::voice::speak::StopSwitch;
use crate::voice::Voice;

const PROVIDER: &str = "elevenlabs";
const API_BASE: &str = "https://api.elevenlabs.io/v1/text-to-speech";
/// The PRD's low-latency multilingual model. Must match `DEFAULT_ELEVENLABS_MODEL` in src/data/settings.ts.
const DEFAULT_MODEL: &str = "eleven_flash_v2_5";
/// Dev builds only: overrides the model chosen in Settings > Cloud.
const MODEL_ENV: &str = "ELEVENLABS_MODEL";
/// "Sarah", a stock voice every account has. Must match `DEFAULT_ELEVENLABS_VOICE` in src/data/settings.ts.
const DEFAULT_VOICE_ID: &str = "EXAVITQu4vr4xnSDxMaL";
/// Dev builds only: overrides the voice chosen in Settings > Cloud.
const VOICE_ENV: &str = "ELEVENLABS_VOICE_ID";
/// Raw 16-bit little-endian mono PCM at 24 kHz: no decoder needed, straight into the speaker.
const OUTPUT_FORMAT: &str = "pcm_24000";
const SAMPLE_RATE: NonZero<u32> = NonZero::new(24_000).unwrap();
const PCM_FULL_SCALE: f32 = 32_768.0;
/// A dead network must hand the sentence to the local voice fast.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(2_500);
/// No audio for this long (first byte or mid-stream) counts as a failure.
const READ_TIMEOUT: Duration = Duration::from_secs(4);
/// ElevenLabs' accepted `voice_settings.speed` range.
const MIN_SPEED: f32 = 0.7;
const MAX_SPEED: f32 = 1.2;
/// Hodey's lines are a few sentences; anything longer is a bug, not speech.
const MAX_TEXT_CHARS: usize = 2_000;
const MAX_ID_CHARS: usize = 64;
/// How much of an error body to keep in the log.
const ERROR_BODY_CHARS: usize = 200;
const PLAYBACK_POLL: Duration = Duration::from_millis(20);

pub struct TtsRequest {
    pub url: String,
    pub body: String,
}

fn plain_id(id: &str, extra: &[char]) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || extra.contains(&c))
}

/// The streaming request for one utterance: the URL and a JSON body holding only the text and voice.
pub fn request(voice_id: &str, model: &str, text: &str, speed: f32) -> Result<TtsRequest, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
        return Err("Hodey had nothing sensible to say.".into());
    }
    if !plain_id(voice_id, &[]) {
        return Err(format!("\"{voice_id}\" isn't an ElevenLabs voice id."));
    }
    let speed = speed.clamp(MIN_SPEED, MAX_SPEED);
    let body = json!({ "text": text, "model_id": model, "voice_settings": { "speed": speed } });
    Ok(TtsRequest { url: format!("{API_BASE}/{voice_id}/stream?output_format={OUTPUT_FORMAT}"), body: body.to_string() })
}

/// Voice ids go into the URL path: letters and digits only.
pub fn valid_voice(id: &str) -> bool {
    plain_id(id, &[])
}

pub fn valid_model(id: &str) -> bool {
    plain_id(id, &['_'])
}

/// A malformed dev override is ignored; a malformed choice from Settings is an error (the local voice speaks).
fn choose(setting: Option<String>, env: Option<String>, dev: bool, default: &str, valid: fn(&str) -> bool, what: &str) -> Result<String, String> {
    let clean = |v: Option<String>| v.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    if let Some(value) = clean(env).filter(|_| dev) {
        if valid(&value) {
            return Ok(value);
        }
        eprintln!("ignoring the ElevenLabs {what} override \"{value}\": not a plain id");
    }
    match clean(setting) {
        Some(value) if valid(&value) => Ok(value),
        Some(value) => Err(format!("\"{value}\" isn't an ElevenLabs {what} id.")),
        None => Ok(default.to_string()),
    }
}

pub fn pick_voice(setting: Option<String>, env: Option<String>, dev: bool) -> Result<String, String> {
    choose(setting, env, dev, DEFAULT_VOICE_ID, valid_voice, "voice")
}

pub fn pick_model(setting: Option<String>, env: Option<String>, dev: bool) -> Result<String, String> {
    choose(setting, env, dev, DEFAULT_MODEL, valid_model, "model")
}

/// Turns the byte stream into samples; a sample split across two network chunks is carried over.
#[derive(Default)]
pub struct Pcm16Decoder {
    carry: Option<u8>,
}

impl Pcm16Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<f32> {
        let mut joined = Vec::with_capacity(bytes.len() + 1);
        joined.extend(self.carry.take());
        joined.extend_from_slice(bytes);
        let pairs = joined.chunks_exact(2);
        self.carry = pairs.remainder().first().copied();
        pairs.map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / PCM_FULL_SCALE).collect()
    }
}

async fn open_stream(request: TtsRequest, key: &str) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::builder().connect_timeout(CONNECT_TIMEOUT).read_timeout(READ_TIMEOUT).build().map_err(|e| e.to_string())?;
    let sent = client.post(&request.url).header("xi-api-key", key).header("Content-Type", "application/json").body(request.body).send().await;
    let response = sent.map_err(|e| format!("Couldn't reach ElevenLabs: {e}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let detail = response.text().await.unwrap_or_else(|e| format!("(no details: {e})"));
    Err(format!("ElevenLabs answered {status}: {}", detail.chars().take(ERROR_BODY_CHARS).collect::<String>()))
}

/// Streams the audio into Hodey's speaker. Ok(true) means a stop (barge-in) cut it off.
async fn stream_into(mut response: reqwest::Response, stop: &StopSwitch, generation: u64) -> Result<bool, String> {
    if !stop.restart_if_current(generation)? {
        return Ok(true);
    }
    let mut decoder = Pcm16Decoder::default();
    while let Some(bytes) = response.chunk().await.map_err(|e| format!("The ElevenLabs stream broke: {e}"))? {
        let samples = decoder.push(&bytes);
        if samples.is_empty() {
            continue;
        }
        if !stop.append_if_current(generation, SamplesBuffer::new(NonZero::<u16>::MIN, SAMPLE_RATE, samples))? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Waits for the speaker to finish what was streamed. Ok(true) if a stop came first.
async fn played_out(stop: &StopSwitch, generation: u64) -> Result<bool, String> {
    loop {
        if !stop.is_current(generation) {
            return Ok(true);
        }
        if stop.idle()? {
            return Ok(false);
        }
        tokio::time::sleep(PLAYBACK_POLL).await;
    }
}

/// What to say and how: the learner's model and voice from Settings > Cloud (None means the default).
pub struct Utterance {
    pub text: String,
    pub speed: f32,
    pub model: Option<String>,
    pub voice_id: Option<String>,
}

fn build(utterance: &Utterance) -> Result<TtsRequest, String> {
    let dev = cfg!(debug_assertions);
    let voice_id = pick_voice(utterance.voice_id.clone(), std::env::var(VOICE_ENV).ok(), dev)?;
    let model = pick_model(utterance.model.clone(), std::env::var(MODEL_ENV).ok(), dev)?;
    request(&voice_id, &model, &utterance.text, utterance.speed)
}

async fn speak(utterance: &Utterance, stop: &StopSwitch, generation: u64) -> Result<bool, String> {
    let request = build(utterance)?;
    let key = keys::read(PROVIDER).ok_or("No ElevenLabs key is saved.")?;
    let response = open_stream(request, &key).await?;
    if stream_into(response, stop, generation).await? {
        return Ok(true);
    }
    played_out(stop, generation).await
}

/// Says one of Hodey's sentences with ElevenLabs. Resolves when it has played (true if interrupted).
/// An error means the caller says it with the local voice instead; any partial audio is cleared first.
#[tauri::command]
pub async fn elevenlabs_speak(text: String, speed: f32, model: Option<String>, voice_id: Option<String>, voice: State<'_, Voice>) -> Result<bool, String> {
    let stop: Arc<StopSwitch> = voice.stop_switch();
    let generation = stop.current();
    let result = speak(&Utterance { text, speed, model, voice_id }, &stop, generation).await;
    if let Err(reason) = &result {
        eprintln!("ElevenLabs voice failed: {reason}");
        if let Err(e) = stop.restart_if_current(generation) {
            eprintln!("couldn't clear the unfinished ElevenLabs audio: {e}");
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn builds_a_streaming_flash_request_with_only_hodeys_text() {
        let built = request("EXAVITQu4vr4xnSDxMaL", "eleven_flash_v2_5", "Click the Insert tab.", 1.0).unwrap();
        assert_eq!(built.url, "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream?output_format=pcm_24000");
        let body: Value = serde_json::from_str(&built.body).unwrap();
        assert_eq!(body["text"], "Click the Insert tab.");
        assert_eq!(body["model_id"], "eleven_flash_v2_5");
        assert_eq!(body["voice_settings"]["speed"], 1.0);
        assert_eq!(body.as_object().unwrap().len(), 3, "nothing but the sentence, model and voice settings: {body}");
    }

    #[test]
    fn keeps_speed_in_the_range_elevenlabs_accepts() {
        let speed = |s: f32| serde_json::from_str::<Value>(&request("abc", "m", "Hi.", s).unwrap().body).unwrap()["voice_settings"]["speed"].as_f64().unwrap();
        assert!((speed(2.0) - 1.2).abs() < 1e-6);
        assert!((speed(0.2) - 0.7).abs() < 1e-6);
        assert!((speed(1.1) - 1.1).abs() < 1e-6);
    }

    #[test]
    fn says_hindi_unchanged() {
        let body: Value = serde_json::from_str(&request("abc", "m", "इंसर्ट टैब पर क्लिक कीजिए।", 1.0).unwrap().body).unwrap();
        assert_eq!(body["text"], "इंसर्ट टैब पर क्लिक कीजिए।");
    }

    #[test]
    fn refuses_empty_text_and_odd_voice_ids() {
        assert!(request("abc", "m", "   ", 1.0).is_err());
        assert!(request("../voices", "m", "Hi.", 1.0).is_err());
        assert!(request("abc", "m", &"x".repeat(MAX_TEXT_CHARS + 1), 1.0).is_err());
    }

    #[test]
    fn settings_choose_the_voice_and_model() {
        assert_eq!(pick_voice(None, None, false), Ok(DEFAULT_VOICE_ID.to_string()));
        assert_eq!(pick_voice(Some(" JBFqnCBsd6RMkjVDRZzb ".into()), None, false), Ok("JBFqnCBsd6RMkjVDRZzb".to_string()));
        assert!(pick_voice(Some("bad/id".into()), None, false).is_err());
        assert_eq!(pick_model(None, None, false), Ok(DEFAULT_MODEL.to_string()));
        assert_eq!(pick_model(Some("eleven_multilingual_v2".into()), None, false), Ok("eleven_multilingual_v2".to_string()));
        assert!(pick_model(Some("x&y=z".into()), None, false).is_err());
        assert!(pick_model(Some("m".repeat(MAX_ID_CHARS + 1)), None, false).is_err());
    }

    #[test]
    fn env_overrides_only_in_dev_builds_and_only_when_it_looks_right() {
        let chosen = Some("eleven_multilingual_v2".to_string());
        assert_eq!(pick_model(chosen.clone(), Some("eleven_turbo_v2_5".into()), true), Ok("eleven_turbo_v2_5".to_string()));
        assert_eq!(pick_model(chosen.clone(), Some("eleven_turbo_v2_5".into()), false), Ok("eleven_multilingual_v2".to_string()));
        assert_eq!(pick_model(chosen, Some("x&y=z".into()), true), Ok("eleven_multilingual_v2".to_string()));
        assert_eq!(pick_voice(None, Some("bad/id".into()), true), Ok(DEFAULT_VOICE_ID.to_string()));
    }

    #[test]
    fn decodes_little_endian_16_bit_pcm() {
        let samples = Pcm16Decoder::default().push(&[0x00, 0x00, 0x00, 0x80, 0xff, 0x7f, 0x00, 0x40]);
        assert_eq!(samples.len(), 4);
        assert_eq!(samples[0], 0.0);
        assert_eq!(samples[1], -1.0);
        assert!((samples[2] - 32767.0 / 32768.0).abs() < 1e-6);
        assert_eq!(samples[3], 0.5);
    }

    #[test]
    fn carries_a_sample_split_across_network_chunks() {
        let mut decoder = Pcm16Decoder::default();
        assert_eq!(decoder.push(&[0x00, 0x40, 0x00]), vec![0.5]);
        assert_eq!(decoder.push(&[0xc0]), vec![-0.5]);
        assert!(decoder.push(&[]).is_empty());
    }
}
