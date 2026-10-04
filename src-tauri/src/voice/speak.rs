//! Natural text-to-speech on the CPU (Kokoro-82M, else Supertonic), played through the speakers picked
//! in Settings (else the default output device). Speech is synthesized a sentence at a time so it starts quickly, and stops the instant the
//! learner talks.

use std::collections::{HashMap, VecDeque};
use std::num::NonZero;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::buffer::SamplesBuffer;
use rodio::stream::{DeviceSinkBuilder, MixerDeviceSink};
use rodio::Player;
use serde::Serialize;
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, OfflineTtsModelConfig, OfflineTtsSupertonicModelConfig};
use tauri::{AppHandle, Emitter};

use super::models::{kokoro_files, tts_files, voice_root, KokoroFiles, TtsFiles};
use super::voices::{catalog, pick, Engine};
use super::cache::{key, PhraseCache};
use super::devices::chosen_output_device;
use super::playhead::{self, Chunks};
use super::segment::{script_runs, speech_chunks, speech_chunks_with};
use super::set_tts_voices;

/// Kokoro runs about 3x faster than real time with 4 threads on a 12th-gen i7 (2 threads: ~0.7x).
const TTS_THREADS: i32 = 4;
/// Flow-matching steps: fewer is faster, more is smoother; 8 is Supertonic's quality default.
const DIFFUSION_STEPS: i32 = 8;
const LANGUAGE: &str = "en";
/// Kokoro's English pronunciation (American; British voices still sound British).
const KOKORO_LANG: &str = "en-us";
/// Kokoro's Hindi pronunciation, chosen per sentence for Hindi text (same model, no second load).
const KOKORO_HINDI: &str = "hi";
/// Mixed-script sentences: silence kept at each joined run's edges, and the level counted as silence.
const RUN_EDGE_PAD_SECS: f32 = 0.06;
const SILENCE_FLOOR: f32 = 0.01;
/// Kokoro's speaking pace: 1.0 is its natural rate.
const KOKORO_LENGTH_SCALE: f32 = 1.0;
const WARM_UP_TEXT: &str = "Hi there.";
const PLAYBACK_POLL: Duration = Duration::from_millis(20);
/// Phrases kept as audio: the acknowledgements plus a lesson's worth of lines.
const PHRASE_CACHE_SIZE: usize = 64;
pub const DONE_EVENT: &str = "tts:done";
/// Each chunk of a spoken line as it starts playing; the frontend's bus has the same name.
pub const SEGMENT_EVENT: &str = "tts:segment";
const NO_SPEAKER: &str = "Hodey's speaker isn't ready yet.";

pub struct SpeakJob {
    pub id: String,
    pub text: String,
    /// A voice id like "kokoro:3"; empty for Hodey's default.
    pub voice: String,
    pub speed: f32,
    /// The stop generation when this was queued; a later stop cancels it.
    pub generation: u64,
    /// False: only synthesize into the phrase cache (preparing likely lines), don't play or report.
    pub play: bool,
}

/// What the speaker thread is asked to do, in order.
pub enum SpeakerCommand {
    Say(SpeakJob),
    /// Other speakers were picked in Settings: play through them from now on.
    SwitchOutput,
}

#[derive(Clone, Serialize)]
struct Done {
    id: String,
    interrupted: bool,
    error: Option<String>,
}

/// `tts:segment`: chunk `index` (from 0) of utterance `id` just started playing; `text` is what it says.
#[derive(Clone, Serialize)]
struct Segment<'a> {
    id: &'a str,
    index: usize,
    text: &'a str,
}

/// Runs `emit` unless a stop came after `generation`. Under the player's lock, which a stop takes too: once
/// `tts_stop` has returned, nothing of the stopped speech goes out.
fn emit_unless_stopped(stop: &StopSwitch, generation: u64, emit: impl FnOnce()) {
    if let Err(reason) = stop.with_current_player(generation, |_| emit()) {
        log::warn!("couldn't check for a stop before reporting what Hodey is saying: {reason}");
    }
}

/// Tells every window that chunk `index` of `job` just started playing.
fn announce_segment(app: &AppHandle, stop: &StopSwitch, job: &SpeakJob, index: usize, text: &str) {
    emit_unless_stopped(stop, job.generation, || {
        if let Err(e) = app.emit(SEGMENT_EVENT, Segment { id: &job.id, index, text }) {
            log::warn!("couldn't report which sentence Hodey is saying: {e}");
        }
    });
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

    /// The stop generation now; speech started now is cancelled once it changes.
    pub fn current(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.current() == generation
    }

    /// Runs `act` on the speaker unless a stop came after `generation`. The player lock makes the check and
    /// the action atomic against `stop`, which bumps the generation before taking the lock: no tail audio.
    fn with_current_player(&self, generation: u64, act: impl FnOnce(&Player)) -> Result<bool, String> {
        let slot = self.player.lock().map_err(|e| e.to_string())?;
        let player = slot.as_ref().ok_or(NO_SPEAKER)?;
        if !self.is_current(generation) {
            return Ok(false);
        }
        act(player);
        Ok(true)
    }

    /// Clears leftover audio and resumes playback for a new utterance (another engine's stream).
    pub fn restart_if_current(&self, generation: u64) -> Result<bool, String> {
        self.with_current_player(generation, |player| {
            player.clear();
            player.play();
        })
    }

    /// Queues streamed audio; false (nothing queued) if a stop arrived after `generation`.
    pub fn append_if_current(&self, generation: u64, audio: SamplesBuffer) -> Result<bool, String> {
        self.with_current_player(generation, |player| player.append(audio))
    }

    /// Whether everything queued has played.
    pub fn idle(&self) -> Result<bool, String> {
        let slot = self.player.lock().map_err(|e| e.to_string())?;
        Ok(slot.as_ref().ok_or(NO_SPEAKER)?.empty())
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
fn synthesize(voice: (&OfflineTts, Engine, i32), text: &str, hindi: bool, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Option<(Vec<f32>, u32)> {
    let (tts, engine, sid) = voice;
    let config = match engine {
        Engine::Supertonic => {
            let mut extra = HashMap::new();
            extra.insert("lang".to_string(), serde_json::json!(LANGUAGE));
            GenerationConfig { sid, speed: job.speed, num_steps: DIFFUSION_STEPS, extra: Some(extra), ..Default::default() }
        }
        Engine::Kokoro => {
            let extra = hindi.then(|| HashMap::from([("lang".to_string(), serde_json::json!(KOKORO_HINDI))]));
            GenerationConfig { sid, speed: job.speed, extra, ..Default::default() }
        }
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

/// One chunk's audio: from the cache, or synthesized now (and cached). None if a stop arrived.
/// Mixed Hindi and English is said a script run at a time, each with its own pronunciation.
fn chunk_audio(engines: &Engines, cache: &mut PhraseCache, chunk: &str, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Result<Option<(Vec<f32>, u32)>, String> {
    let runs = script_runs(chunk);
    let mixed = runs.len() > 1;
    let mut joined: Option<(Vec<f32>, u32)> = None;
    for (run, hindi) in runs {
        let Some((samples, rate)) = run_audio(engines, cache, &run, hindi, job, stop)? else { return Ok(None) };
        let samples = if mixed { trim_silence(samples, rate) } else { samples };
        match joined.as_mut() {
            Some((all, _)) => all.extend(samples),
            None => joined = Some((samples, rate)),
        }
    }
    Ok(joined)
}

/// Each run comes with the voice's own lead-in and tail silence; joined, they'd sound like pauses.
fn trim_silence(samples: Vec<f32>, rate: u32) -> Vec<f32> {
    let pad = (rate as f32 * RUN_EDGE_PAD_SECS) as usize;
    let loud = |s: &f32| s.abs() > SILENCE_FLOOR;
    let (Some(first), Some(last)) = (samples.iter().position(loud), samples.iter().rposition(loud)) else { return samples };
    samples[first.saturating_sub(pad)..(last + pad).min(samples.len())].to_vec()
}

fn run_audio(engines: &Engines, cache: &mut PhraseCache, run: &str, hindi: bool, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Result<Option<(Vec<f32>, u32)>, String> {
    let voice = engines.engine_for(&job.voice).ok_or("No natural voice is installed.")?;
    let cache_key = key(voice.1, voice.2, job.speed, run);
    if let Some((samples, rate)) = cache.get(&cache_key) {
        return Ok(Some((samples.as_ref().clone(), rate)));
    }
    let Some((samples, rate)) = synthesize(voice, run, hindi, job, stop) else {
        return if cancelled(stop, job) { Ok(None) } else { Err("The voice couldn't say that.".into()) };
    };
    cache.put(cache_key, (Arc::new(samples.clone()), rate));
    Ok(Some((samples, rate)))
}

/// Synthesizes likely lines ahead of time so they start instantly when needed.
fn prepare(engines: &Engines, cache: &mut PhraseCache, job: &SpeakJob, stop: &Arc<StopSwitch>) {
    for chunk in speech_chunks(&job.text) {
        if let Err(reason) = chunk_audio(engines, cache, &chunk, job, stop) {
            return eprintln!("couldn't prepare a phrase: {reason}");
        }
    }
}

/// Whether every script run of `chunk` is already synthesized in this job's voice and speed.
fn is_prepared(engines: &Engines, cache: &PhraseCache, job: &SpeakJob, chunk: &str) -> bool {
    let Some((_, engine, sid)) = engines.engine_for(&job.voice) else { return false };
    script_runs(chunk).iter().all(|(run, _)| cache.contains(&key(engine, sid, job.speed, run)))
}

/// Speaks one job, announcing each chunk (`tts:segment`) as it starts playing; returns whether it was interrupted.
fn speak(app: &AppHandle, engines: &Engines, cache: &mut PhraseCache, player: &Player, job: &SpeakJob, stop: &Arc<StopSwitch>) -> Result<bool, String> {
    // Anything left from an interrupted utterance must never play before this one.
    player.clear();
    player.play();
    let announce = |index: usize, text: &str| announce_segment(app, stop, job, index, text);
    playhead::watching(|| player.len(), announce, |chunks| play_chunks(engines, cache, player, job, stop, chunks))
}

/// Appends each chunk as soon as its audio is ready (prepared or synthesized now), telling `chunks` right after,
/// then waits for the player to finish. Returns whether a stop cut it short.
fn play_chunks(engines: &Engines, cache: &mut PhraseCache, player: &Player, job: &SpeakJob, stop: &Arc<StopSwitch>, chunks: &Chunks) -> Result<bool, String> {
    // A prepared acknowledgement ("Exactly right.") plays from the cache while the rest is synthesized.
    let texts = speech_chunks_with(&job.text, |chunk| is_prepared(engines, cache, job, chunk));
    for text in texts {
        if cancelled(stop, job) {
            return Ok(true);
        }
        let Some((samples, rate)) = chunk_audio(engines, cache, &text, job, stop)? else { return Ok(true) };
        // Synthesis only checks for a stop between steps; a chunk finished after the stop is dropped.
        if cancelled(stop, job) {
            return Ok(true);
        }
        let rate = NonZero::new(rate).ok_or("The voice produced no audio.")?;
        player.append(SamplesBuffer::new(NonZero::<u16>::MIN, rate, samples));
        chunks.appended(&text);
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

/// The open output device and the player Hodey (and the cloud voice) speak through.
struct Output {
    _sink: MixerDeviceSink,
    player: Arc<Player>,
}

/// The chosen speakers while they're plugged in and open, else the default output.
fn open_sink() -> Result<MixerDeviceSink, String> {
    if let Some(device) = chosen_output_device() {
        match DeviceSinkBuilder::from_device(device).and_then(|builder| builder.open_sink_or_fallback()) {
            Ok(sink) => return Ok(sink),
            Err(e) => eprintln!("couldn't open the chosen speakers, using the default: {e}"),
        }
    }
    DeviceSinkBuilder::open_default_sink().map_err(|e| format!("No speakers or headphones found: {e}"))
}

impl Output {
    /// Opens the speakers and hands their player to `stop`, so barge-in and the cloud voice use it.
    fn open(stop: &StopSwitch) -> Result<Self, String> {
        let mut sink = open_sink()?;
        // Switching speakers drops the old sink on purpose; rodio would log that as a warning.
        sink.log_on_drop(false);
        let player = Arc::new(Player::connect_new(sink.mixer()));
        match stop.player.lock() {
            Ok(mut slot) => *slot = Some(Arc::clone(&player)),
            Err(e) => eprintln!("couldn't share the speech player for interruptions: {e}"),
        }
        Ok(Self { _sink: sink, player })
    }
}

/// The newly chosen speakers; None (logged) keeps the current ones.
fn reopened(stop: &StopSwitch) -> Option<Output> {
    Output::open(stop).inspect_err(|reason| eprintln!("couldn't switch speakers, keeping the current ones: {reason}")).ok()
}

/// No natural voice: every queued line fails with `reason`. The speaker stays open (and still follows
/// Settings) for the cloud voice.
fn refuse_all(app: &AppHandle, commands: Receiver<SpeakerCommand>, stop: &StopSwitch, mut output: Option<Output>, reason: String) {
    set_tts_voices(app, Err(reason.clone()));
    for command in commands {
        match command {
            SpeakerCommand::Say(job) => report(app, job.id, false, Some(reason.clone())),
            SpeakerCommand::SwitchOutput => output = reopened(stop).or(output),
        }
    }
}

fn say(app: &AppHandle, engines: &Engines, cache: &mut PhraseCache, player: &Player, job: SpeakJob, stop: &Arc<StopSwitch>) {
    if !job.play {
        return prepare(engines, cache, &job, stop);
    }
    let result = if cancelled(stop, &job) { Ok(true) } else { speak(app, engines, cache, player, &job, stop) };
    match result {
        Ok(interrupted) => report(app, job.id, interrupted, None),
        Err(reason) => report(app, job.id, false, Some(reason)),
    }
}

/// The speaker thread: opens the output device and loads the natural voices once, then speaks queued
/// jobs in order. The device opens first and stays open, so the cloud voice can play through the same
/// speaker (and the same barge-in stop) even when no local voice is installed.
pub fn worker(app: AppHandle, commands: Receiver<SpeakerCommand>, stop: Arc<StopSwitch>) {
    let mut output = match Output::open(&stop) {
        Ok(output) => output,
        Err(reason) => return refuse_all(&app, commands, &stop, None, reason),
    };
    let engines = match Engines::load() {
        Ok(engines) => engines,
        Err(reason) => return refuse_all(&app, commands, &stop, Some(output), reason),
    };
    set_tts_voices(&app, Ok(engines.voices()));
    let mut cache = PhraseCache::new(PHRASE_CACHE_SIZE);
    let mut preparing = VecDeque::new();
    while let Some(next) = next_command(&commands, &mut preparing) {
        match next {
            Next::Command(SpeakerCommand::Say(job)) => say(&app, &engines, &mut cache, &output.player, job, &stop),
            Next::Command(SpeakerCommand::SwitchOutput) => output = reopened(&stop).unwrap_or(output),
            // Prepared now, so a stop since it was queued (the learner cut Hodey off) doesn't cancel it.
            Next::Prepare(job) => prepare(&engines, &mut cache, &SpeakJob { generation: stop.current(), ..job }, &stop),
        }
    }
}

enum Next {
    Command(SpeakerCommand),
    /// A line to synthesize ahead of time, once nothing is waiting to be said.
    Prepare(SpeakJob),
}

/// Lines to say go first; lines to prepare wait until the queue is otherwise empty, so preparing a
/// dozen phrases at startup never delays what Hodey has to say now. None: shutting down.
fn next_command(commands: &Receiver<SpeakerCommand>, preparing: &mut VecDeque<SpeakJob>) -> Option<Next> {
    loop {
        let command = match commands.try_recv() {
            Ok(command) => command,
            Err(TryRecvError::Empty) => match preparing.pop_front() {
                Some(job) => return Some(Next::Prepare(job)),
                None => commands.recv().ok()?,
            },
            Err(TryRecvError::Disconnected) => return None,
        };
        match command {
            SpeakerCommand::Say(job) if !job.play => preparing.push_back(job),
            other => return Some(Next::Command(other)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::listen::{load_engines, set_language, transcribe};
    use crate::voice::models::asr_files;
    use sherpa_onnx::LinearResampler;

    const ASR_RATE: i32 = 16_000;

    fn job(text: &str, play: bool) -> SpeakJob {
        SpeakJob { id: text.into(), text: text.into(), voice: String::new(), speed: 1.0, generation: 0, play }
    }

    fn said(next: Option<Next>) -> String {
        match next {
            Some(Next::Command(SpeakerCommand::Say(job))) => format!("say {}", job.text),
            Some(Next::Prepare(job)) => format!("prepare {}", job.text),
            Some(Next::Command(SpeakerCommand::SwitchOutput)) => "switch".into(),
            None => "closed".into(),
        }
    }

    #[test]
    fn segments_serialize_the_way_the_frontend_reads_them() {
        let segment = Segment { id: "line-7", index: 1, text: "now click Insert." };
        assert_eq!(serde_json::to_string(&segment).unwrap(), r#"{"id":"line-7","index":1,"text":"now click Insert."}"#);
    }

    #[test]
    fn no_segment_goes_out_once_a_stop_has_returned() {
        let stop = StopSwitch::default();
        let (player, _output) = Player::new();
        *stop.player.lock().unwrap() = Some(Arc::new(player));
        let generation = stop.current();
        let mut announced = Vec::new();
        emit_unless_stopped(&stop, generation, || announced.push("Nice work so far,"));
        stop.stop().unwrap();
        emit_unless_stopped(&stop, generation, || announced.push("now click Insert."));
        assert_eq!(announced, ["Nice work so far,"]);
    }

    #[test]
    fn what_hodey_says_goes_before_lines_being_prepared() {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut preparing = VecDeque::new();
        for text in ["One sec.", "Exactly right."] {
            tx.send(SpeakerCommand::Say(job(text, false))).unwrap();
        }
        tx.send(SpeakerCommand::Say(job("Click Insert.", true))).unwrap();
        assert_eq!(said(next_command(&rx, &mut preparing)), "say Click Insert.");
        tx.send(SpeakerCommand::SwitchOutput).unwrap();
        assert_eq!(said(next_command(&rx, &mut preparing)), "switch");
        assert_eq!(said(next_command(&rx, &mut preparing)), "prepare One sec.");
        assert_eq!(said(next_command(&rx, &mut preparing)), "prepare Exactly right.");
        drop(tx);
        assert_eq!(said(next_command(&rx, &mut preparing)), "closed");
    }

    /// Needs the real models: `cargo test --lib -- --ignored hindi_round_trip --nocapture`.
    /// Hodey's Hindi voice says a pack line and a mixed Hindi/English line; Nemotron (Hindi) hears them.
    #[test]
    #[ignore]
    fn hindi_round_trip() {
        let root = voice_root();
        let engines = Engines { kokoro: Some(load_kokoro(&kokoro_files(&root).unwrap()).unwrap()), supertonic: None };
        let mut cache = PhraseCache::new(PHRASE_CACHE_SIZE);
        let stop = Arc::new(StopSwitch::default());
        let mut asr = load_engines(&asr_files(&root).unwrap()).unwrap();
        set_language("hi").unwrap();
        for line in ["अब पिवट टेबल पर क्लिक कीजिए।", "ये इंसर्ट टैब है। मैंने इसे हाइलाइट कर दिया है।", "ये Insert टैब है। मैंने इसे हाइलाइट कर दिया है।"] {
            let job = SpeakJob { id: String::new(), text: line.into(), voice: "kokoro:31".into(), speed: 1.0, generation: 0, play: false };
            let started = std::time::Instant::now();
            let (samples, rate) = chunk_audio(&engines, &mut cache, line, &job, &stop).unwrap().unwrap();
            let took = started.elapsed();
            let mut audio = vec![0.0; ASR_RATE as usize / 2];
            audio.extend(LinearResampler::create(rate as i32, ASR_RATE).unwrap().resample(&samples, true));
            println!("said {line:?} ({:.1}s audio in {took:?}); heard {:?}", samples.len() as f32 / rate as f32, transcribe(&mut asr, &audio));
        }
        set_language("en").unwrap();
    }

    /// Needs the real models: what Nemotron writes in "auto" for English, Hindi and Hinglish speech, so
    /// the frontend can tell which language the learner used (`cargo test --lib -- --ignored auto_language --nocapture`).
    #[test]
    #[ignore]
    fn auto_language_transcripts() {
        let root = voice_root();
        let engines = Engines { kokoro: Some(load_kokoro(&kokoro_files(&root).unwrap()).unwrap()), supertonic: None };
        let mut cache = PhraseCache::new(PHRASE_CACHE_SIZE);
        let stop = Arc::new(StopSwitch::default());
        let mut asr = load_engines(&asr_files(&root).unwrap()).unwrap();
        set_language("auto").unwrap();
        let lines = [("kokoro:3", "Teach me how to make a pivot table in Excel."), ("kokoro:31", "मुझे यह समझ नहीं आ रहा है।"), ("kokoro:31", "मुझे पिवट टेबल बनाना सिखाओ।"), ("kokoro:33", "ये बटन क्या करता है?")];
        for (voice, line) in lines {
            let job = SpeakJob { id: String::new(), text: line.into(), voice: voice.into(), speed: 1.0, generation: 0, play: false };
            let (samples, rate) = chunk_audio(&engines, &mut cache, line, &job, &stop).unwrap().unwrap();
            let mut audio = vec![0.0; ASR_RATE as usize / 2];
            audio.extend(LinearResampler::create(rate as i32, ASR_RATE).unwrap().resample(&samples, true));
            println!("said {line:?}; heard {:?}", transcribe(&mut asr, &audio));
        }
        set_language("en").unwrap();
    }
}
