//! The GPU's second listen: when an utterance ends, its audio (in memory, never on disk) is re-read by
//! Whisper on the loopback whisper.cpp server (gpu_asr.rs) and that text becomes the final transcript.
//! Nemotron's own final is kept whenever the server is off, slow, unsure or obviously wrong, so the
//! learner never waits long and never loses what Nemotron heard.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::asr::whisper_language;
use super::listen::{language, SAMPLE_RATE};
use super::segment::MAX_UTTERANCE_SAMPLES;

/// The whole second listen, connect to answer; past it Nemotron's text is used.
pub(crate) const GPU_FINAL_TIMEOUT: Duration = Duration::from_millis(1500);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(200);
/// The first request after loading sets up the GPU kernels (~1.5 s measured), so it's made before
/// the server is used, with room to spare.
const WARM_UP_TIMEOUT: Duration = Duration::from_secs(15);
const WARM_UP_SECS: usize = 1;
/// Shorter than this there's nothing for Whisper to improve on (and it hallucinates on blips).
const MIN_AUDIO_SECS: f32 = 0.3;
/// Whisper's own "this is probably not speech" and "this guess is poor" cut-offs.
const MAX_NO_SPEECH_PROB: f32 = 0.6;
const MIN_AVG_LOGPROB: f32 = -1.0;
/// Whisper text this many times longer than Nemotron's (plus a few words) is a runaway repeat loop.
const RUNAWAY_FACTOR: usize = 3;
const RUNAWAY_SLACK_WORDS: usize = 4;
/// Whisper allows 224 prompt tokens; this keeps the prompt well inside that.
const PROMPT_MAX_CHARS: usize = 200;
/// The words Hodey hears most and Whisper misspells most without a hint (measured: every "Hey Hodey"
/// came out right with this prompt, and noisy WER fell from 0.058 to 0.035).
const BASE_PROMPT: &str = "Hey Hodey. Open Excel, Brave, WhatsApp, File Explorer. Make a PivotTable.";
/// Whisper's habits on silence or noise when nothing was said.
const HALLUCINATIONS: [&str; 5] = ["thank you", "thanks for watching", "thank you for watching", "you", "bye"];
/// The only speech the second listen re-reads: Whisper small's Hindi and Hinglish were never measured
/// against Nemotron's, so Hindi and auto-detect keep Nemotron's text.
const REFINED_LANGUAGE: &str = "en";
const BOUNDARY_PREFIX: &str = "hodeum-audio-";

const WAV_HEADER_BYTES: usize = 44;
const PCM_FORMAT: u16 = 1;
const MONO: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;
const BYTES_PER_SAMPLE: u32 = 2;
const PCM_FULL_SCALE: f32 = 32_767.0;
const FMT_CHUNK_BYTES: u32 = 16;
/// "RIFF" size field counts everything after itself: 44-byte header minus 8 plus the data.
const RIFF_HEADER_TAIL: u32 = 36;

/// Where the GPU server listens, and which model it runs ("whisper-small-gpu").
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GpuServer {
    pub(crate) addr: SocketAddr,
    pub(crate) model: &'static str,
}

static SERVER: Mutex<Option<GpuServer>> = Mutex::new(None);
static HINTS: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Second listens that failed in a row; the supervisor steps down a model when this grows.
static FAILURES: AtomicU32 = AtomicU32::new(0);

pub(crate) fn set_server(server: Option<GpuServer>) {
    match SERVER.lock() {
        Ok(mut slot) => *slot = server,
        Err(e) => eprintln!("GPU hearing lock poisoned: {e}"),
    }
    FAILURES.store(0, Ordering::SeqCst);
}

fn server() -> Option<GpuServer> {
    SERVER.lock().map(|s| s.clone()).unwrap_or_else(|e| {
        eprintln!("GPU hearing lock poisoned: {e}");
        None
    })
}

pub(crate) fn failures_in_a_row() -> u32 {
    FAILURES.load(Ordering::SeqCst)
}

/// Words the learner is likely to say now (Hodey, the task's controls and apps), for Whisper's prompt.
pub(crate) fn set_hints(hints: Vec<String>) -> Result<(), String> {
    *HINTS.lock().map_err(|e| e.to_string())? = hints;
    Ok(())
}

/// What Whisper heard, with its own confidence.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Refined {
    pub(crate) text: String,
    /// Mean of the segments' average token log-probability.
    pub(crate) avg_logprob: f32,
    /// The highest "no speech" probability of any segment.
    pub(crate) no_speech_prob: f32,
}

#[derive(Deserialize)]
struct VerboseJson {
    text: String,
    #[serde(default)]
    segments: Vec<Segment>,
}

#[derive(Deserialize)]
struct Segment {
    #[serde(default)]
    avg_logprob: f32,
    #[serde(default)]
    no_speech_prob: f32,
}

/// The server's verbose_json answer.
pub(crate) fn parse(json: &str) -> Result<Refined, String> {
    let answer: VerboseJson = serde_json::from_str(json).map_err(|e| format!("unreadable Whisper answer: {e}"))?;
    let count = answer.segments.len().max(1) as f32;
    let avg_logprob = answer.segments.iter().map(|s| s.avg_logprob).sum::<f32>() / count;
    let no_speech_prob = answer.segments.iter().map(|s| s.no_speech_prob).fold(0.0, f32::max);
    Ok(Refined { text: answer.text.trim().to_string(), avg_logprob, no_speech_prob })
}

fn normalized(text: &str) -> String {
    text.to_lowercase().chars().filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '\'').collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The final transcript: Whisper's when it's confident and sane, else Nemotron's.
pub(crate) fn choose(nemotron: &str, whisper: Option<&Refined>) -> String {
    let Some(w) = whisper else { return nemotron.to_string() };
    let heard = normalized(&w.text);
    let unsure = w.no_speech_prob > MAX_NO_SPEECH_PROB || w.avg_logprob < MIN_AVG_LOGPROB;
    let invented = nemotron.trim().is_empty() && HALLUCINATIONS.contains(&heard.as_str());
    let runaway = heard.split_whitespace().count() > RUNAWAY_FACTOR * nemotron.split_whitespace().count() + RUNAWAY_SLACK_WORDS;
    if heard.is_empty() || unsure || invented || runaway {
        nemotron.to_string()
    } else {
        w.text.clone()
    }
}

/// Whisper's prompt: the built-in words plus the current hints, without repeats, capped.
pub(crate) fn prompt(hints: &[String]) -> String {
    let mut out = BASE_PROMPT.to_string();
    for hint in hints.iter().map(|h| h.trim()).filter(|h| !h.is_empty()) {
        if out.to_lowercase().contains(&hint.to_lowercase()) {
            continue;
        }
        if out.len() + hint.len() + 2 > PROMPT_MAX_CHARS {
            break;
        }
        out.push_str(", ");
        out.push_str(hint);
    }
    out
}

/// 16 kHz mono 16-bit PCM WAV, built in memory.
pub(crate) fn wav_bytes(samples: &[f32]) -> Vec<u8> {
    let data_len = samples.len() as u32 * BYTES_PER_SAMPLE;
    let rate = SAMPLE_RATE as u32;
    let mut out = Vec::with_capacity(WAV_HEADER_BYTES + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(RIFF_HEADER_TAIL + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&FMT_CHUNK_BYTES.to_le_bytes());
    out.extend_from_slice(&PCM_FORMAT.to_le_bytes());
    out.extend_from_slice(&MONO.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * BYTES_PER_SAMPLE).to_le_bytes());
    out.extend_from_slice(&(BYTES_PER_SAMPLE as u16).to_le_bytes());
    out.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&((sample.clamp(-1.0, 1.0) * PCM_FULL_SCALE) as i16).to_le_bytes());
    }
    out
}

/// A multipart/form-data body with these text fields and the WAV as `file`.
pub(crate) fn multipart(boundary: &str, fields: &[(&str, String)], wav: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(wav.len() + 1024);
    for (name, value) in fields {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn request_fields(hints: &[String]) -> Vec<(&'static str, String)> {
    vec![
        ("language", REFINED_LANGUAGE.to_string()),
        ("temperature", "0.0".to_string()),
        ("response_format", "verbose_json".to_string()),
        ("suppress_nst", "true".to_string()),
        // The per-language probabilities cost a second encoder pass.
        ("no_language_probabilities", "true".to_string()),
        ("prompt", prompt(hints)),
    ]
}

/// The body of a 200 answer; anything else is an error naming the status.
pub(crate) fn response_body(response: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(response);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("the GPU hearing server sent no complete answer")?;
    let status = head.lines().next().unwrap_or_default();
    if !status.split_whitespace().nth(1).is_some_and(|code| code == "200") {
        return Err(format!("the GPU hearing server answered {status:?}"));
    }
    Ok(body.to_string())
}

fn remaining(deadline: Instant) -> Result<Duration, String> {
    deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero()).ok_or_else(|| "the GPU hearing took too long".to_string())
}

/// POSTs the audio to /inference within `budget`.
fn post(addr: SocketAddr, audio: &[f32], hints: &[String], budget: Duration) -> Result<Refined, String> {
    let deadline = Instant::now() + budget;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let boundary = format!("{BOUNDARY_PREFIX}{nanos:x}");
    let body = multipart(&boundary, &request_fields(hints), &wav_bytes(audio));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT.min(budget)).map_err(|e| format!("couldn't reach the GPU hearing server: {e}"))?;
    stream.set_write_timeout(Some(remaining(deadline)?)).map_err(|e| e.to_string())?;
    let head = format!("POST /inference HTTP/1.1\r\nHost: {addr}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(&body)).map_err(|e| format!("couldn't send speech to the GPU: {e}"))?;
    stream.set_read_timeout(Some(remaining(deadline)?)).map_err(|e| e.to_string())?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(|e| format!("no answer from the GPU in time: {e}"))?;
    parse(&response_body(&response)?)
}

/// One throwaway second of silence through a freshly loaded server, so the learner's first utterance
/// doesn't pay for the GPU's start-up.
pub(crate) fn warm_up(addr: SocketAddr) -> Result<Duration, String> {
    let started = Instant::now();
    post(addr, &vec![0.0; WARM_UP_SECS * SAMPLE_RATE as usize], &[], WARM_UP_TIMEOUT)?;
    Ok(started.elapsed())
}

fn hints() -> Vec<String> {
    HINTS.lock().map(|h| h.clone()).unwrap_or_else(|e| {
        eprintln!("speech hints lock poisoned: {e}");
        Vec::new()
    })
}

/// The final transcript for an utterance Nemotron heard as `nemotron`: re-read on the GPU when it's
/// running, else (or on any failure) Nemotron's own.
pub(crate) fn refine(nemotron: &str, audio: &[f32]) -> String {
    let Some(server) = server() else { return nemotron.to_string() };
    let english = whisper_language(language()) == REFINED_LANGUAGE;
    let length_ok = (MIN_AUDIO_SECS * SAMPLE_RATE as f32) as usize <= audio.len() && audio.len() <= MAX_UTTERANCE_SAMPLES;
    if !english || !length_ok {
        return nemotron.to_string();
    }
    let started = Instant::now();
    match post(server.addr, audio, &hints(), GPU_FINAL_TIMEOUT) {
        Ok(refined) => {
            FAILURES.store(0, Ordering::SeqCst);
            let chosen = choose(nemotron, Some(&refined));
            // Never the words themselves: transcripts are not kept, logs included.
            let engine = if chosen == nemotron { "nemotron" } else { "whisper" };
            let words = chosen.split_whitespace().count();
            log::info!("GPU hearing ({}) in {:?}: used {engine} ({words} words)", server.model, started.elapsed());
            chosen
        }
        Err(reason) => {
            FAILURES.fetch_add(1, Ordering::SeqCst);
            log::warn!("GPU hearing failed after {:?}, keeping Nemotron's text: {reason}", started.elapsed());
            nemotron.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn whisper(text: &str, avg_logprob: f32, no_speech_prob: f32) -> Refined {
        Refined { text: text.into(), avg_logprob, no_speech_prob }
    }

    #[test]
    fn uses_whisper_when_it_is_confident() {
        assert_eq!(choose("Open Ex", Some(&whisper("Open Excel.", -0.2, 0.01))), "Open Excel.");
        assert_eq!(choose("hey hodi give me a hint", Some(&whisper("Hey Hodey, give me a hint.", -0.3, 0.02))), "Hey Hodey, give me a hint.");
    }

    #[test]
    fn keeps_nemotron_when_whisper_failed_or_is_unsure() {
        assert_eq!(choose("open excel", None), "open excel", "server off, slow or erroring");
        assert_eq!(choose("open excel", Some(&whisper("  ", -0.1, 0.0))), "open excel", "empty");
        assert_eq!(choose("open excel", Some(&whisper("Open Excel.", -0.1, 0.9))), "open excel", "probably no speech");
        assert_eq!(choose("open excel", Some(&whisper("Oven axle.", -1.4, 0.1))), "open excel", "a poor guess");
    }

    #[test]
    fn ignores_whisper_s_habits_on_silence() {
        assert_eq!(choose("", Some(&whisper("Thank you.", -0.2, 0.1))), "");
        assert_eq!(choose("", Some(&whisper("Thanks for watching!", -0.2, 0.1))), "");
        assert_eq!(choose("thank you", Some(&whisper("Thank you.", -0.2, 0.1))), "Thank you.", "said for real, Nemotron heard it too");
    }

    #[test]
    fn ignores_a_runaway_repeat() {
        let looped = "Open Excel. Open Excel. Open Excel. Open Excel. Open Excel. Open Excel.";
        assert_eq!(choose("open excel", Some(&whisper(looped, -0.3, 0.0))), "open excel");
    }

    #[test]
    fn reads_the_servers_verbose_json() {
        let json = r#"{"task":"transcribe","language":"english","duration":1.5,"text":" Open Excel.","segments":[{"id":0,"text":" Open Excel.","temperature":0.0,"avg_logprob":-0.25,"no_speech_prob":0.02},{"id":1,"text":"x","avg_logprob":-0.75,"no_speech_prob":0.3}]}"#;
        assert_eq!(parse(json).unwrap(), whisper("Open Excel.", -0.5, 0.3));
        assert_eq!(parse(r#"{"text":"hi"}"#).unwrap(), whisper("hi", 0.0, 0.0), "no segments");
        assert!(parse("<html>").is_err());
    }

    #[test]
    fn builds_a_16_bit_mono_wav_in_memory() {
        let wav = wav_bytes(&[0.0, 1.0, -1.0, 2.0]);
        assert_eq!(wav.len(), WAV_HEADER_BYTES + 8);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1, "mono");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(wav[28..32].try_into().unwrap()), 32_000, "byte rate");
        assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16, "bits");
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8);
        let samples: Vec<i16> = wav[44..].chunks(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
        assert_eq!(samples, vec![0, 32_767, -32_767, 32_767], "clamped, not wrapped");
    }

    #[test]
    fn multipart_body_has_each_field_then_the_file() {
        let body = multipart("B", &[("language", "en".into()), ("temperature", "0.0".into())], b"WAV");
        let text = String::from_utf8(body).unwrap();
        assert_eq!(
            text,
            "--B\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nen\r\n\
             --B\r\nContent-Disposition: form-data; name=\"temperature\"\r\n\r\n0.0\r\n\
             --B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\nWAV\r\n--B--\r\n"
        );
    }

    #[test]
    fn the_prompt_names_hodey_and_the_task_s_words_within_the_limit() {
        assert_eq!(prompt(&[]), BASE_PROMPT);
        let p = prompt(&["Insert".into(), "excel".into(), " ".into(), "Recommended PivotTables".into()]);
        assert!(p.starts_with(BASE_PROMPT) && p.ends_with(", Insert, Recommended PivotTables"), "{p}");
        let many: Vec<String> = (0..100).map(|i| format!("Control {i}")).collect();
        assert!(prompt(&many).len() <= PROMPT_MAX_CHARS);
    }

    #[test]
    fn only_a_200_answer_counts() {
        assert_eq!(response_body(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap(), "{}");
        let error = response_body(b"HTTP/1.1 500 Internal Server Error\r\n\r\nboom").unwrap_err();
        assert!(error.contains("500"), "{error}");
        assert!(response_body(b"HTTP/1.1 200 OK\r\n").is_err(), "cut off");
    }

    #[test]
    fn without_a_server_nemotron_s_text_stands() {
        set_server(None);
        assert_eq!(refine("open excel", &vec![0.1; 16_000]), "open excel");
    }
}
