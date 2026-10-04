//! Hodey's local voice: NVIDIA Nemotron speech recognition with Silero voice activity detection, and
//! Supertonic speech, all on the CPU through sherpa-onnx. Nothing is recorded or leaves the PC.

pub mod listen;
pub mod models;
pub mod segment;
pub mod speak;

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use listen::ListenCommand;
use speak::{SpeakJob, StopSwitch};

const STATUS_EVENT: &str = "voice:status";

/// Mirrors `VoiceStatus` in `src/providers/speech/native-voice.ts`.
#[derive(Debug, Clone, Serialize)]
pub struct VoiceStatus {
    /// "ready" when the speech-recognition models are installed, else "missing".
    pub asr: &'static str,
    /// "loading", "ready" or "missing".
    pub tts: &'static str,
    pub listening: bool,
    /// Why the mic can't be used, or what it's doing ("Loading…").
    pub detail: Option<String>,
    pub tts_detail: Option<String>,
    /// How many Supertonic voices there are to choose from.
    pub voices: i32,
}

pub struct Voice {
    status: Mutex<VoiceStatus>,
    listen: Mutex<Sender<ListenCommand>>,
    speak: Mutex<Sender<SpeakJob>>,
    stop: Arc<StopSwitch>,
}

fn update(app: &AppHandle, change: impl FnOnce(&mut VoiceStatus)) {
    let voice = app.state::<Voice>();
    let snapshot = match voice.status.lock() {
        Ok(mut status) => {
            change(&mut status);
            status.clone()
        }
        Err(e) => return eprintln!("voice status lock poisoned: {e}"),
    };
    if let Err(e) = app.emit(STATUS_EVENT, snapshot) {
        eprintln!("couldn't send the voice status: {e}");
    }
}

pub(crate) fn set_listening(app: &AppHandle, listening: bool) {
    update(app, |s| s.listening = listening);
}

pub(crate) fn set_status_detail(app: &AppHandle, detail: Option<String>) {
    update(app, |s| s.detail = detail);
}

pub(crate) fn set_tts_voices(app: &AppHandle, voices: Result<i32, String>) {
    update(app, |s| match voices {
        Ok(count) => {
            s.tts = "ready";
            s.voices = count;
            s.tts_detail = None;
        }
        Err(reason) => {
            s.tts = "missing";
            s.tts_detail = Some(reason);
        }
    });
}

/// Starts the listener and speaker threads. Models load lazily (listener) or right away (speaker).
pub fn start(app: &AppHandle) {
    let root = models::voice_root();
    let (asr, detail) = match models::asr_files(&root) {
        Ok(_) => ("ready", None),
        Err(reason) => ("missing", Some(reason)),
    };
    let (listen_tx, listen_rx) = mpsc::channel();
    let (speak_tx, speak_rx) = mpsc::channel();
    let stop = Arc::new(StopSwitch::default());
    let status = VoiceStatus { asr, tts: "loading", listening: false, detail, tts_detail: None, voices: 0 };
    app.manage(Voice { status: Mutex::new(status), listen: Mutex::new(listen_tx), speak: Mutex::new(speak_tx), stop: Arc::clone(&stop) });
    let listener = app.clone();
    thread::spawn(move || listen::worker(listener, listen_rx));
    let speaker = app.clone();
    thread::spawn(move || speak::worker(speaker, speak_rx, stop));
}

#[tauri::command]
pub fn voice_status(voice: State<'_, Voice>) -> Result<VoiceStatus, String> {
    voice.status.lock().map(|s| s.clone()).map_err(|e| e.to_string())
}

fn send_listen(voice: &Voice, command: ListenCommand) -> Result<(), String> {
    voice.listen.lock().map_err(|e| e.to_string())?.send(command).map_err(|_| "Hodey's listener has stopped; restart Hodeum.".to_string())
}

/// Ctrl+Alt+Space: start listening, or stop if already listening.
pub fn toggle(app: &AppHandle) {
    let voice = app.state::<Voice>();
    let listening = match voice.status.lock() {
        Ok(status) => status.listening,
        Err(e) => return eprintln!("voice status lock poisoned: {e}"),
    };
    let result = if listening { send_listen(&voice, ListenCommand::Stop) } else { voice_start(voice.clone()) };
    if let Err(reason) = result {
        listen::emit_error(app, &reason);
    }
}

#[tauri::command]
pub fn voice_start(voice: State<'_, Voice>) -> Result<(), String> {
    let status = voice.status.lock().map_err(|e| e.to_string())?.clone();
    if status.asr != "ready" {
        return Err(status.detail.unwrap_or_else(|| models::SETUP_HINT.into()));
    }
    send_listen(&voice, ListenCommand::Start)
}

#[tauri::command]
pub fn voice_stop(voice: State<'_, Voice>) -> Result<(), String> {
    send_listen(&voice, ListenCommand::Stop)
}

#[tauri::command]
pub fn tts_speak(id: String, text: String, voice_id: i32, speed: f32, voice: State<'_, Voice>) -> Result<(), String> {
    let generation = voice.stop.generation.load(std::sync::atomic::Ordering::SeqCst);
    let job = SpeakJob { id, text, voice: voice_id, speed, generation };
    voice.speak.lock().map_err(|e| e.to_string())?.send(job).map_err(|_| "Hodey's voice has stopped; restart Hodeum.".to_string())
}

#[tauri::command]
pub fn tts_stop(voice: State<'_, Voice>) -> Result<(), String> {
    voice.stop.stop()
}

#[cfg(test)]
mod tests {
    use super::listen::{load_engines, transcribe};
    use super::models::{asr_files, tts_files, voice_root};
    use super::speak::load_tts;
    use sherpa_onnx::{GenerationConfig, LinearResampler};

    const ASR_RATE: i32 = 16_000;

    /// Needs the real models (scripts/setup-local-ai.ps1): `cargo test --lib -- --ignored voice_round_trip`.
    /// Copy target/debug/{onnxruntime*,sherpa-onnx-*}.dll into target/debug/deps first: otherwise the
    /// test binary picks up Windows' own older onnxruntime.dll from System32 and crashes.
    /// Supertonic says a goal, Nemotron must hear it back.
    #[test]
    #[ignore]
    fn voice_round_trip() {
        let root = voice_root();
        let files = tts_files(&root).unwrap();
        let tts = load_tts(&files).unwrap();
        println!("tts loaded: {} voices, {} Hz", tts.num_speakers(), tts.sample_rate());
        let started = std::time::Instant::now();
        let spoken = tts.generate_with_config("Teach me how to make a pivot table in Excel.", &GenerationConfig::default(), None::<fn(&[f32], f32) -> bool>).unwrap();
        println!("tts: {:.2}s of audio in {:?}", spoken.samples().len() as f32 / spoken.sample_rate() as f32, started.elapsed());
        let resampler = LinearResampler::create(spoken.sample_rate(), ASR_RATE).unwrap();
        let mut audio = vec![0.0; ASR_RATE as usize / 2];
        audio.extend(resampler.resample(spoken.samples(), true));
        let mut engines = load_engines(&asr_files(&root).unwrap()).unwrap();
        let started = std::time::Instant::now();
        let heard = transcribe(&mut engines, &audio).join(" ").to_lowercase();
        println!("asr: {heard:?} in {:?}", started.elapsed());
        assert!(heard.starts_with("teach me") && heard.contains("pivot table"), "heard {heard:?}");
    }
}
