//! Natural text-to-speech on the CPU (Kokoro-82M, else Supertonic), played through the default output
//! device. Speech is synthesized a sentence at a time so it starts quickly, and stops the instant the
//! learner talks.

use std::collections::HashMap;
use std::num::NonZero;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::buffer::SamplesBuffer;
use rodio::stream::DeviceSinkBuilder;
use rodio::Player;
use serde::Serialize;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, OfflineTtsModelConfig, OfflineTtsSupertonicModelConfig};
use tauri::{AppHandle, Emitter};

use super::models::{kokoro_files, tts_files, voice_root, KokoroFiles, TtsFiles};
use super::voices::{catalog, pick, Engine};
use super::segment::sentences;
use super::set_tts_voices;

/// Kokoro runs about 3x faster than real time with 4 threads on a 12th-gen i7 (2 threads: ~0.7x).
const TTS_THREADS: i32 = 4;
/// Flow-matching steps: fewer is faster, more is smoother; 8 is Supertonic's quality default.
const DIFFUSION_STEPS: i32 = 8;
const LANGUAGE: &str = "en";
/// Kokoro's English pronunciation (American; British voices still sound British).
const KOKORO_LANG: &str = "en-us";
/// Kokoro's speaking pace: 1.0 is its natural rate.
const KOKORO_LENGTH_SCALE: f32 = 1.0;
const WARM_UP_TEXT: &str = "Hi there.";
const PLAYBACK_POLL: Duration = Duration::from_millis(20);
pub const DONE_EVENT: &str = "tts:done";

pub struct SpeakJob {
    pub id: String,
    pub text: String,
    /// A voice id like "kokoro:3"; empty for Hodey's default.
    pub voice: String,
    pub speed: f32,
    /// The stop generation when this was queued; a later stop cancels it.
    pub generation: u64,
}

#[derive(Clone, Serialize)]
struct Done {
    id: String,
    interrupted: bool,
    error: Option<String>,
}

/// Shared with the `tts_stop` command so speech can be cut off while the worker is busy synthesizing.
#[derive(Default)]
pub struct StopSwitch {
    pub generation: AtomicU64,
    pub player: Mutex<Option<Arc<Player>>>,
}

impl StopSwitch {
    /// Cancels queued and in-progress speech and silences playback immediately.
    pub fn stop(&self) -> Result<(), String> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(player) = self.player.lock().map_err(|e| e.to_string())?.as_ref() {
            player.clear();
        }
        Ok(())
    }
}

fn path(p: &std::path::Path) -> Option<String> {
    Some(p.to_string_lossy().into_owned())
}

pub(crate) fn load_tts(files: &TtsFiles) -> Result<OfflineTts, String> {
    let supertonic = OfflineTtsSupertonicModelConfig {
        duration_predictor: path(&files.duration_predictor),
        text_encoder: path(&files.text_encoder),
        vector_estimator: path(&files.vector_estimator),
        vocoder: path(&files.vocoder),
        tts_json: path(&files.tts_json),
        unicode_indexer: path(&files.unicode_indexer),
        voice_style: path(&files.voice_style),
    };
    let config = OfflineTtsConfig {
        model: OfflineTtsModelConfig { supertonic, num_threads: TTS_THREADS, provider: Some("cpu".into()), ..Default::default() },
        ..Default::default()
    };
    OfflineTts::create(&config).ok_or_else(|| "Couldn't load the Supertonic voice.".to_string())
}

pub(crate) fn load_kokoro(files: &KokoroFiles) -> Result<OfflineTts, String> {
    let kokoro = OfflineTtsKokoroModelConfig {
        model: path(&files.model),
        voices: path(&files.voices),
        tokens: path(&files.tokens),
        data_dir: path(&files.data_dir),
        dict_dir: path(&files.dict_dir),
        lexicon: Some(files.lexicon.clone()),
        length_scale: KOKORO_LENGTH_SCALE,
        lang: Some(KOKORO_LANG.into()),
    };
    let config = OfflineTtsConfig {
        model: OfflineTtsModelConfig { kokoro, num_threads: TTS_THREADS, provider: Some("cpu".into()), ..Default::default() },
        ..Default::default()
    };
    OfflineTts::create(&config).ok_or_else(|| "Couldn't load the Kokoro voice.".to_string())
}

/// The natural voices that loaded. Either may be missing; Hodey uses what's there.
pub struct Engines {
    kokoro: Option<OfflineTts>,
    supertonic: Option<OfflineTts>,
}

impl Engines {
    fn load() -> Result<Self, String> {
        let root = voice_root();
        let report = |name: &str, e: &String| eprintln!("{name} voice unavailable: {e}");
        let kokoro = kokoro_files(&root).and_then(|f| load_kokoro(&f)).inspect_err(|e| report("Kokoro", e)).ok();
        let supertonic = tts_files(&root).and_then(|f| load_tts(&f)).inspect_err(|e| report("Supertonic", e)).ok();
        if kokoro.is_none() && supertonic.is_none() {
            return Err(super::models::SETUP_HINT.into());
        }
        let engines = Self { kokoro, supertonic };
        engines.warm_up();
        Ok(engines)
    }

    /// The first synthesis is several times slower (graph optimisation); do it now, silently,
    /// so Hodey's first real sentence starts promptly.
    fn warm_up(&self) {
        if let Some((tts, _, sid)) = self.engine_for("") {
            let config = GenerationConfig { sid, ..Default::default() };
            if tts.generate_with_config(WARM_UP_TEXT, &config, None::<fn(&[f32], f32) -> bool>).is_none() {
                eprintln!("voice warm-up produced no audio");
            }
        }
    }

    fn voices(&self) -> Vec<super::voices::VoiceOption> {
        catalog(self.kokoro.is_some(), self.supertonic.as_ref().map(OfflineTts::num_speakers))
    }

    fn engine_for(&self, voice: &str) -> Option<(&OfflineTts, Engine, i32)> {
        let (engine, sid) = pick(voice, self.kokoro.is_some(), self.supertonic.is_some())?;
        let tts = match engine {
            Engine::Kokoro => self.kokoro.as_ref()?,
            Engine::Supertonic => self.supertonic.as_ref()?,
        };
        Some((tts, engine, sid))
    }
}

/// Synthesizes one sentence, giving up as soon as a stop arrives.
fn synthesize(voice: (&OfflineTts, Engine, i32), text: &str, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Option<(Vec<f32>, u32)> {
    let (tts, engine, sid) = voice;
    let config = match engine {
        Engine::Supertonic => {
            let mut extra = HashMap::new();
            extra.insert("lang".to_string(), serde_json::json!(LANGUAGE));
            GenerationConfig { sid, speed: job.speed, num_steps: DIFFUSION_STEPS, extra: Some(extra), ..Default::default() }
        }
        Engine::Kokoro => GenerationConfig { sid, speed: job.speed, ..Default::default() },
    };
    let watch = Arc::clone(stop);
    let generation = job.generation;
    let keep_going = move |_: &[f32], _: f32| watch.generation.load(Ordering::SeqCst) == generation;
    let audio = tts.generate_with_config(text, &config, Some(keep_going))?;
    Some((audio.samples().to_vec(), audio.sample_rate() as u32))
}

fn cancelled(stop: &StopSwitch, job: &SpeakJob) -> bool {
    stop.generation.load(Ordering::SeqCst) != job.generation
}

/// Speaks one job; returns whether it was interrupted.
fn speak(engines: &Engines, player: &Player, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Result<bool, String> {
    let voice = engines.engine_for(&job.voice).ok_or("No natural voice is installed.")?;
    // Anything left from an interrupted utterance must never play before this one.
    player.clear();
    player.play();
    for sentence in sentences(&job.text) {
        if cancelled(stop, job) {
            return Ok(true);
        }
        let Some((samples, rate)) = synthesize(voice, &sentence, job, stop) else {
            return if cancelled(stop, job) { Ok(true) } else { Err("The voice couldn't say that.".into()) };
        };
        // Synthesis only checks for a stop between steps; a sentence finished after the stop is dropped.
        if cancelled(stop, job) {
            return Ok(true);
        }
        let rate = NonZero::new(rate).ok_or("The voice produced no audio.")?;
        player.append(SamplesBuffer::new(NonZero::<u16>::MIN, rate, samples));
    }
    while !player.empty() && !cancelled(stop, job) {
        thread::sleep(PLAYBACK_POLL);
    }
    Ok(cancelled(stop, job))
}

fn report(app: &AppHandle, id: String, interrupted: bool, error: Option<String>) {
    if let Some(reason) = &error {
        eprintln!("speech failed: {reason}");
    }
    if let Err(e) = app.emit(DONE_EVENT, Done { id, interrupted, error }) {
        eprintln!("couldn't report finished speech: {e}");
    }
}

/// The speaker thread: loads Supertonic and the output device once, then speaks queued jobs in order.
pub fn worker(app: AppHandle, jobs: Receiver<SpeakJob>, stop: Arc<StopSwitch>) {
    let engines = match Engines::load() {
        Ok(engines) => engines,
        Err(reason) => {
            set_tts_voices(&app, Err(reason.clone()));
            for job in jobs {
                report(&app, job.id, false, Some(reason.clone()));
            }
            return;
        }
    };
    let sink = match DeviceSinkBuilder::open_default_sink() {
        Ok(sink) => sink,
        Err(e) => {
            let reason = format!("No speakers or headphones found: {e}");
            set_tts_voices(&app, Err(reason.clone()));
            for job in jobs {
                report(&app, job.id, false, Some(reason.clone()));
            }
            return;
        }
    };
    let player = Arc::new(Player::connect_new(sink.mixer()));
    match stop.player.lock() {
        Ok(mut slot) => *slot = Some(Arc::clone(&player)),
        Err(e) => eprintln!("couldn't share the speech player for interruptions: {e}"),
    }
    set_tts_voices(&app, Ok(engines.voices()));
    for job in jobs {
        let result = if cancelled(&stop, &job) { Ok(true) } else { speak(&engines, &player, &job, &stop) };
        match result {
            Ok(interrupted) => report(&app, job.id, interrupted, None),
            Err(reason) => report(&app, job.id, false, Some(reason)),
        }
    }
}
