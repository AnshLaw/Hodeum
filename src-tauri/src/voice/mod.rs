//! Hodey's local voice: NVIDIA Nemotron speech recognition (Whisper as the backup) with Silero voice
//! activity detection, and Kokoro/Supertonic speech, all on the CPU through sherpa-onnx. Nothing is recorded or leaves the PC.

pub mod asr;
pub mod cache;
pub mod echo_mic;
pub mod listen;
pub mod models;
pub mod segment;
pub mod speak;
pub mod standby;
pub mod voices;

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use listen::{ListenCommand, ListenMode};
use speak::{SpeakJob, StopSwitch};

const STATUS_EVENT: &str = "voice:status";

/// Mirrors `VoiceStatus` in `src/providers/speech/native-voice.ts`.
#[derive(Debug, Clone, Serialize)]
pub struct VoiceStatus {
    /// "ready" when a speech-recognition engine (Nemotron or the Whisper backup) is installed, else "missing".
    pub asr: &'static str,
    /// "loading", "ready" or "missing".
    pub tts: &'static str,
    pub listening: bool,
    /// Hands-free: the mic is on, waiting for "Hey Hodey".
    pub standby: bool,
    /// Why the mic can't be used, or what it's doing ("Loading…"), or which backup engine is listening.
    pub detail: Option<String>,
    pub tts_detail: Option<String>,
    /// Hodey's natural voices (Kokoro first, then Supertonic).
    pub voices: Vec<voices::VoiceOption>,
}

pub struct Voice {
    status: Mutex<VoiceStatus>,
    listen: Mutex<Sender<ListenCommand>>,
    speak: Mutex<Sender<SpeakJob>>,
    stop: Arc<StopSwitch>,
}

impl Voice {
    /// The speaker's stop switch, for engines that play through Hodey's speaker (the cloud voice).
    pub(crate) fn stop_switch(&self) -> Arc<StopSwitch> {
        Arc::clone(&self.stop)
    }
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

pub(crate) fn set_standby(app: &AppHandle, standby: bool) {
    update(app, |s| s.standby = standby);
}

pub(crate) fn set_status_detail(app: &AppHandle, detail: Option<String>) {
    update(app, |s| s.detail = detail);
}

pub(crate) fn set_tts_voices(app: &AppHandle, voices: Result<Vec<voices::VoiceOption>, String>) {
    update(app, |s| match voices {
        Ok(list) => {
            s.tts = "ready";
            s.voices = list;
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
    let (asr, detail) = match models::asr_installed(&root) {
        Ok(_) => ("ready", None),
        Err(reason) => ("missing", Some(reason)),
    };
    let (listen_tx, listen_rx) = mpsc::channel();
    let (speak_tx, speak_rx) = mpsc::channel();
    let stop = Arc::new(StopSwitch::default());
    let status = VoiceStatus { asr, tts: "loading", listening: false, standby: false, detail, tts_detail: None, voices: Vec::new() };
    app.manage(Voice { status: Mutex::new(status), listen: Mutex::new(listen_tx), speak: Mutex::new(speak_tx), stop: Arc::clone(&stop) });
    let listener = app.clone();
    let installed = asr == "ready";
    thread::spawn(move || listen::worker(listener, listen_rx, installed));
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

fn asr_ready(voice: &Voice) -> Result<(), String> {
    let status = voice.status.lock().map_err(|e| e.to_string())?.clone();
    if status.asr == "ready" {
        Ok(())
    } else {
        Err(status.detail.unwrap_or_else(|| models::SETUP_HINT.into()))
    }
}

/// Hodey key held: listen until it's released.
pub fn hold_start(app: &AppHandle) -> Result<(), String> {
    let voice = app.state::<Voice>();
    if let Err(reason) = asr_ready(&voice) {
        listen::emit_error(app, &reason);
        return Ok(());
    }
    send_listen(&voice, ListenCommand::Start { mode: ListenMode::Hold })
}

/// Hodey key released: send what was said.
pub fn hold_end(app: &AppHandle) -> Result<(), String> {
    send_listen(&app.state::<Voice>(), ListenCommand::Finish)
}

#[tauri::command]
pub fn voice_start(voice: State<'_, Voice>) -> Result<(), String> {
    asr_ready(&voice)?;
    send_listen(&voice, ListenCommand::Start { mode: ListenMode::Tap })
}

/// Which language the learner speaks (Settings > Voice > Your speech).
#[tauri::command]
pub fn set_speech_language(language: String) -> Result<(), String> {
    listen::set_language(&language)
}

/// Settings > Voice > Hands-free: listen for "Hey Hodey" (and the learner's wake words) without a key.
#[tauri::command]
pub fn set_hands_free(enabled: bool, wake_words: Vec<String>, voice: State<'_, Voice>) -> Result<(), String> {
    standby::configure(enabled, &wake_words)?;
    send_listen(&voice, ListenCommand::Refresh)
}

/// A conversation: keep the mic open across turns, even while Hodey talks, until voice_stop.
#[tauri::command]
pub fn voice_converse(voice: State<'_, Voice>) -> Result<(), String> {
    asr_ready(&voice)?;
    send_listen(&voice, ListenCommand::Start { mode: ListenMode::Conversation })
}

#[tauri::command]
pub fn voice_stop(voice: State<'_, Voice>) -> Result<(), String> {
    send_listen(&voice, ListenCommand::Stop)
}

#[tauri::command]
pub fn tts_speak(id: String, text: String, voice_id: String, speed: f32, voice: State<'_, Voice>) -> Result<(), String> {
    let generation = voice.stop.generation.load(std::sync::atomic::Ordering::SeqCst);
    let job = SpeakJob { id, text, voice: voice_id, speed, generation, play: true };
    voice.speak.lock().map_err(|e| e.to_string())?.send(job).map_err(|_| "Hodey's voice has stopped; restart Hodeum.".to_string())
}

/// Synthesizes likely lines (acknowledgements) ahead of time, silently, so they start instantly.
#[tauri::command]
pub fn tts_prepare(texts: Vec<String>, voice_id: String, speed: f32, voice: State<'_, Voice>) -> Result<(), String> {
    let generation = voice.stop.generation.load(std::sync::atomic::Ordering::SeqCst);
    let sender = voice.speak.lock().map_err(|e| e.to_string())?;
    for text in texts {
        let job = SpeakJob { id: String::new(), text, voice: voice_id.clone(), speed, generation, play: false };
        sender.send(job).map_err(|_| "Hodey's voice has stopped; restart Hodeum.".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tts_stop(voice: State<'_, Voice>) -> Result<(), String> {
    voice.stop.stop()
}

#[cfg(test)]
mod tests {
    use super::listen::{load_engines, transcribe};
    use super::models::{asr_files, tts_files, voice_root};
    use super::models::kokoro_files;
    use super::speak::{load_kokoro, load_tts};
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

    /// The backup engine (needs the VAD and the Whisper pack, which ships sample recordings): through
    /// the same VAD segmenting as live speech. `cargo test --lib -- --ignored whisper_backup --nocapture`.
    #[test]
    #[ignore]
    fn whisper_backup_round_trip() {
        let root = voice_root();
        let wav = root.join(format!("sherpa-onnx-whisper-{}/test_wavs/0.wav", super::models::WHISPER_SIZE));
        let wave = sherpa_onnx::Wave::read(&wav.to_string_lossy()).expect("the pack's sample recording");
        let mut audio = vec![0.0; ASR_RATE as usize / 2];
        audio.extend(LinearResampler::create(wave.sample_rate(), ASR_RATE).unwrap().resample(wave.samples(), true));
        let started = std::time::Instant::now();
        let mut engines = super::listen::load_whisper_engines(&root).unwrap();
        println!("whisper loaded in {:?}", started.elapsed());
        let started = std::time::Instant::now();
        let heard = transcribe(&mut engines, &audio).join(" ").to_lowercase();
        println!("whisper: {heard:?} in {:?} ({:.1}s of audio)", started.elapsed(), audio.len() as f32 / ASR_RATE as f32);
        assert!(heard.contains("yellow lamps"), "heard {heard:?}");
        // Auto: Whisper rebuilds for auto-detect and still hears English.
        super::listen::set_language("auto").unwrap();
        let started = std::time::Instant::now();
        let heard = transcribe(&mut engines, &audio).join(" ").to_lowercase();
        super::listen::set_language("en").unwrap();
        println!("whisper (auto-detect): {heard:?} in {:?}", started.elapsed());
        assert!(heard.contains("yellow lamps"), "heard {heard:?}");
    }

    /// Same as above for Kokoro, Hodey's preferred natural voice ("Heart", speaker 3).
    #[test]
    #[ignore]
    fn kokoro_round_trip() {
        let root = voice_root();
        let tts = load_kokoro(&kokoro_files(&root).unwrap()).unwrap();
        let config = GenerationConfig { sid: 3, ..GenerationConfig::default() };
        let mut spoken = None;
        for attempt in 1..=3 {
            let started = std::time::Instant::now();
            let audio = tts.generate_with_config("Teach me how to make a pivot table in Excel.", &config, None::<fn(&[f32], f32) -> bool>).unwrap();
            println!("kokoro #{attempt}: {:.2}s of audio in {:?}", audio.samples().len() as f32 / audio.sample_rate() as f32, started.elapsed());
            spoken = Some(audio);
        }
        let spoken = spoken.unwrap();
        let resampler = LinearResampler::create(spoken.sample_rate(), ASR_RATE).unwrap();
        let mut audio = vec![0.0; ASR_RATE as usize / 2];
        audio.extend(resampler.resample(spoken.samples(), true));
        let mut engines = load_engines(&asr_files(&root).unwrap()).unwrap();
        let heard = transcribe(&mut engines, &audio).join(" ").to_lowercase();
        println!("asr: {heard:?}");
        assert!(heard.contains("pivot table"), "heard {heard:?}");
    }

    /// Hands-free (needs the real models): Kokoro says a room sentence and a wake phrase; only the wake
    /// phrase may come out, and the room sentence is abandoned early rather than transcribed in full.
    #[test]
    #[ignore]
    fn hands_free_overhears_only_the_wake_phrase() {
        let root = voice_root();
        let tts = load_kokoro(&kokoro_files(&root).unwrap()).unwrap();
        let config = GenerationConfig { sid: 3, ..GenerationConfig::default() };
        let mut audio = vec![0.0; ASR_RATE as usize / 2];
        for line in ["I think lunch is ready in the kitchen, let's go and eat now.", "Hey Hodey, give me a hint."] {
            let spoken = tts.generate_with_config(line, &config, None::<fn(&[f32], f32) -> bool>).unwrap();
            audio.extend(LinearResampler::create(spoken.sample_rate(), ASR_RATE).unwrap().resample(spoken.samples(), true));
            audio.extend(vec![0.0; ASR_RATE as usize * 3 / 2]);
        }
        let mut engines = load_engines(&asr_files(&root).unwrap()).unwrap();
        let started = std::time::Instant::now();
        let heard: Vec<String> = super::standby::Overheard::default().push(&mut engines, &audio).into_iter().filter(|c| c.is_final).map(|c| c.text).collect();
        println!("overheard {heard:?} in {:?} ({:.1}s of audio)", started.elapsed(), audio.len() as f32 / ASR_RATE as f32);
        assert_eq!(heard.len(), 1, "heard {heard:?}");
        assert!(heard[0].to_lowercase().starts_with("hey"), "heard {heard:?}");
    }

    /// Needs a microphone: whether Windows cancels echo on it, and how fast it opens. Reads one second
    /// of audio into memory; nothing is saved. `cargo test --lib -- --ignored echo_cancelled_mic --nocapture`.
    #[test]
    #[ignore]
    fn echo_cancelled_mic_report() {
        for attempt in 1..=2 {
            let started = std::time::Instant::now();
            let opened = super::echo_mic::open(std::sync::mpsc::channel().0).is_ok();
            println!("open #{attempt}: {opened} in {:?}", started.elapsed());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let started = std::time::Instant::now();
        let mic = super::echo_mic::open(tx);
        println!("echo-cancelled mic: {:?} after {:?}", mic.as_ref().map(|_| "on"), started.elapsed());
        let Ok(_mic) = mic else { return };
        let mut samples = 0;
        while samples < ASR_RATE as usize {
            samples += rx.recv_timeout(std::time::Duration::from_secs(2)).expect("audio arrives").len();
        }
        println!("first second of 16 kHz audio after {:?}", started.elapsed());
    }

    /// Latency report (needs the real models): how soon Hodey can start speaking a typical line, and
    /// how long recognition takes to finish after the learner stops talking.
    #[test]
    #[ignore]
    fn voice_latency_report() {
        let root = voice_root();
        let tts = load_kokoro(&kokoro_files(&root).unwrap()).unwrap();
        let config = GenerationConfig { sid: 3, ..GenerationConfig::default() };
        let quiet = None::<fn(&[f32], f32) -> bool>;
        tts.generate_with_config("Hi there.", &config, quiet).unwrap();
        for line in ["Which tab would you use to add something new?", "Let me look.", "Click the Insert tab at the top. I've highlighted it."] {
            let started = std::time::Instant::now();
            let audio = tts.generate_with_config(line, &config, quiet).unwrap();
            let secs = audio.samples().len() as f32 / audio.sample_rate() as f32;
            println!("tts {:>5.0} ms for {secs:.2}s of audio ({:.1}x real time): {line}", started.elapsed().as_millis(), secs / started.elapsed().as_secs_f32());
        }
        let spoken = tts.generate_with_config("Hey Hodey, give me a hint please.", &config, quiet).unwrap();
        let mut audio = vec![0.0; ASR_RATE as usize / 2];
        audio.extend(LinearResampler::create(spoken.sample_rate(), ASR_RATE).unwrap().resample(spoken.samples(), true));
        let mut engines = load_engines(&asr_files(&root).unwrap()).unwrap();
        let started = std::time::Instant::now();
        let heard = transcribe(&mut engines, &audio);
        let total = started.elapsed();
        println!("asr: {heard:?} — whole utterance ({:.2}s audio + 1s silence) processed in {total:?}", audio.len() as f32 / ASR_RATE as f32);
    }
}
