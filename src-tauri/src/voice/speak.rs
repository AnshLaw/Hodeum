//! Supertonic text-to-speech on the CPU, played through the default output device. Speech is
//! synthesized a sentence at a time so it starts quickly, and stops the instant the learner talks.

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
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig, OfflineTtsSupertonicModelConfig};
use tauri::{AppHandle, Emitter};

use super::models::{tts_files, voice_root, TtsFiles};
use super::segment::sentences;
use super::set_tts_voices;

const TTS_THREADS: i32 = 2;
/// Flow-matching steps: fewer is faster, more is smoother; 8 is Supertonic's quality default.
const DIFFUSION_STEPS: i32 = 8;
const LANGUAGE: &str = "en";
const PLAYBACK_POLL: Duration = Duration::from_millis(20);
pub const DONE_EVENT: &str = "tts:done";

pub struct SpeakJob {
    pub id: String,
    pub text: String,
    pub voice: i32,
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

/// Synthesizes one sentence, giving up as soon as a stop arrives.
fn synthesize(tts: &OfflineTts, text: &str, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Option<(Vec<f32>, u32)> {
    let mut extra = HashMap::new();
    extra.insert("lang".to_string(), serde_json::json!(LANGUAGE));
    let config = GenerationConfig { sid: job.voice, speed: job.speed, num_steps: DIFFUSION_STEPS, extra: Some(extra), ..Default::default() };
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
fn speak(tts: &OfflineTts, player: &Player, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Result<bool, String> {
    player.play();
    for sentence in sentences(&job.text) {
        if cancelled(stop, job) {
            return Ok(true);
        }
        let Some((samples, rate)) = synthesize(tts, &sentence, job, stop) else {
            return if cancelled(stop, job) { Ok(true) } else { Err("The voice couldn't say that.".into()) };
        };
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
    let tts = match tts_files(&voice_root()).and_then(|files| load_tts(&files)) {
        Ok(tts) => tts,
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
    set_tts_voices(&app, Ok(tts.num_speakers()));
    for job in jobs {
        let result = if cancelled(&stop, &job) { Ok(true) } else { speak(&tts, &player, &job, &stop) };
        match result {
            Ok(interrupted) => report(&app, job.id, interrupted, None),
            Err(reason) => report(&app, job.id, false, Some(reason)),
        }
    }
}
