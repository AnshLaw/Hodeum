//! Microphone → 16 kHz mono → Silero VAD → NVIDIA Nemotron streaming ASR (or the Whisper backup,
//! see asr.rs), on a worker thread.
//! Audio and transcripts live only in memory: nothing is recorded or saved.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rodio::cpal::{self, SampleFormat};
use serde::Serialize;
use sherpa_onnx::{LinearResampler, SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};
use tauri::{AppHandle, Emitter};

use super::echo_mic::{self, EchoCancelledMic};
use super::asr::{self, Asr, Nemotron, Whisper};
use super::models::{asr_files, vad_file, voice_root, whisper_files};
use super::segment::{downmix, Recognizer, Segmenter, Session, SpeechEvent};
use super::standby::{self, Outcome};
use super::{set_listening, set_status_detail};

pub(crate) const SAMPLE_RATE: i32 = 16_000;
pub(crate) const VAD_WINDOW: usize = 512;
const VAD_THRESHOLD: f32 = 0.5;
/// Silence that ends an utterance: long enough for a natural mid-sentence pause (0.6 s cut people
/// off in testing), short enough that replies still feel quick.
const END_SILENCE_SECS: f32 = 0.9;
const MIN_SPEECH_SECS: f32 = 0.25;
const MAX_SPEECH_SECS: f32 = 20.0;
const VAD_BUFFER_SECS: f32 = 30.0;
/// Nemotron 3.5's per-stream language prompts that Hodey offers (from the model's own table):
/// US English, British English, Hindi, and auto-detect for Hindi + English.
pub const ASR_LANGUAGES: [&str; 4] = ["en", "en-GB", "hi", "auto"];
const DEFAULT_LANGUAGE: &str = "en";

static ASR_LANGUAGE: Mutex<&'static str> = Mutex::new(DEFAULT_LANGUAGE);

/// Settings > Voice > Your speech. Unknown values are refused rather than silently auto-detected.
pub fn set_language(language: &str) -> Result<(), String> {
    let known = ASR_LANGUAGES.iter().find(|l| **l == language).ok_or_else(|| format!("unsupported speech language: {language}"))?;
    *ASR_LANGUAGE.lock().map_err(|e| e.to_string())? = known;
    Ok(())
}

pub(crate) fn language() -> &'static str {
    ASR_LANGUAGE.lock().map(|l| *l).unwrap_or(DEFAULT_LANGUAGE)
}
pub(crate) const AUDIO_POLL: Duration = Duration::from_millis(50);
/// A microphone that delivers pure digital silence this long is muted or misconfigured.
const SILENT_MIC_AFTER: Duration = Duration::from_secs(4);
const SILENCE_LEVEL: f32 = 1e-7;
/// Tap-to-talk: a tap that hears no speech at all gives up after this long.
const NO_SPEECH_AFTER: Duration = Duration::from_secs(8);
const NOTHING_HEARD: &str = "I didn't catch anything. Tap the mic and try again.";
/// A held talk key is released eventually; this guards against a stuck key.
const MAX_HOLD: Duration = Duration::from_secs(60);
/// Backstop for a conversation nobody ended: the frontend normally closes it after a few quiet seconds.
const CONVERSATION_IDLE_LIMIT: Duration = Duration::from_secs(60);
const SAY_AGAIN: &str = "Please say that again.";
const MIC_SILENT: &str = "Your microphone is sending silence. Check it isn't muted, or pick another input in Windows sound settings.";

pub const SPEECH_START_EVENT: &str = "voice:speech-start";
pub const TRANSCRIPT_EVENT: &str = "voice:transcript";
pub const ERROR_EVENT: &str = "voice:error";

#[cfg(test)]
mod language_tests {
    use super::*;

    #[test]
    fn accepts_only_the_languages_nemotron_knows() {
        assert!(set_language("en-GB").is_ok());
        assert_eq!(language(), "en-GB");
        assert!(set_language("en-IN").is_err(), "not in the model's table");
        assert_eq!(language(), "en-GB");
        set_language("en").unwrap();
    }
}

#[derive(Clone, Serialize)]
struct Transcript {
    text: String,
    #[serde(rename = "final")]
    is_final: bool,
}

/// How a listening session began; it decides how long Hodey waits and what silence means.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ListenMode {
    /// Tapped the mic: one sentence; silence ends with "I didn't catch anything".
    Tap,
    /// Holding the talk key: everything until release.
    Hold,
    /// A conversation: the mic stays open across turns, even while Hodey talks (so the learner can cut
    /// in), until stopped or nobody speaks for a long while.
    Conversation,
}

pub enum ListenCommand {
    Start { mode: ListenMode },
    /// The talk key was released: send what was said.
    Finish,
    /// Stop without sending anything.
    Stop,
    /// A setting changed (hands-free on or off): re-check what the listener should be doing.
    Refresh,
}

pub(crate) struct Engines {
    pub(crate) vad: VoiceActivityDetector,
    pub(crate) segmenter: Segmenter<Asr>,
}

fn path(p: &std::path::Path) -> Option<String> {
    Some(p.to_string_lossy().into_owned())
}

fn load_vad(model: &std::path::Path) -> Result<VoiceActivityDetector, String> {
    let vad_config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: path(model),
            threshold: VAD_THRESHOLD,
            min_silence_duration: END_SILENCE_SECS,
            min_speech_duration: MIN_SPEECH_SECS,
            window_size: VAD_WINDOW as i32,
            max_speech_duration: MAX_SPEECH_SECS,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        provider: Some("cpu".into()),
        ..Default::default()
    };
    VoiceActivityDetector::create(&vad_config, VAD_BUFFER_SECS).ok_or_else(|| "Couldn't load the voice activity detector.".to_string())
}

/// Nemotron only, for the model tests.
#[cfg(test)]
pub(crate) fn load_engines(files: &super::models::AsrFiles) -> Result<Engines, String> {
    Ok(Engines { vad: load_vad(&vad_file(&voice_root())?)?, segmenter: Segmenter::new(Nemotron::load(files)?) })
}

/// Whisper only, for the model tests.
#[cfg(test)]
pub(crate) fn load_whisper_engines(root: &std::path::Path) -> Result<Engines, String> {
    Ok(Engines { vad: load_vad(&vad_file(root)?)?, segmenter: Segmenter::new(load_whisper(root)?) })
}

fn load_whisper(root: &std::path::Path) -> Result<Asr, String> {
    whisper_files(root).and_then(Whisper::load)
}

/// The voice activity detector and the best speech engine that loads. Ok: the status detail too.
pub(crate) fn load_any(root: &std::path::Path) -> Result<(Engines, Option<String>), String> {
    let vad = load_vad(&vad_file(root)?)?;
    let nemotron = || asr_files(root).and_then(|files| Nemotron::load(&files));
    let (engine, detail) = asr::load_with_fallback(nemotron, || load_whisper(root))?;
    Ok((Engines { vad, segmenter: Segmenter::new(engine) }, detail))
}

/// After a session: switches a failed Nemotron to Whisper and says so in the status line.
fn recover(app: &AppHandle, engines: &mut Engines) {
    if let Some(detail) = asr::switch_on_failure(engines.segmenter.recognizer_mut(), || load_whisper(&voice_root())) {
        set_status_detail(app, Some(detail));
    }
}

/// The default microphone, delivering mono f32 chunks at the device's own rate.
pub(crate) struct Mic {
    _source: MicSource,
    pub(crate) rate: u32,
}

enum MicSource {
    // Held only to keep the microphone running; dropping either stops it.
    EchoCancelled { _mic: EchoCancelledMic },
    Plain { _stream: cpal::Stream },
}

static PLAIN_MIC_LOGGED: AtomicBool = AtomicBool::new(false);

/// The microphone. With `cancel_echo`, Windows' echo cancellation when this PC has it (Hodey's voice from
/// the speakers is removed), for long sessions where Hodey talks while the mic is open: it takes ~0.6 s
/// to open, too slow for hold-to-talk, which stops Hodey anyway. Otherwise the plain default microphone.
pub(crate) fn open_mic(tx: Sender<Vec<f32>>, cancel_echo: bool) -> Result<Mic, String> {
    if !cancel_echo {
        return open_plain_mic(tx);
    }
    match echo_mic::open(tx.clone()) {
        Ok(mic) => return Ok(Mic { _source: MicSource::EchoCancelled { _mic: mic }, rate: SAMPLE_RATE as u32 }),
        Err(reason) if !PLAIN_MIC_LOGGED.swap(true, Ordering::SeqCst) => eprintln!("using the plain microphone: {reason}"),
        Err(_) => {}
    }
    open_plain_mic(tx)
}

fn open_plain_mic(tx: Sender<Vec<f32>>) -> Result<Mic, String> {
    let device = cpal::default_host().default_input_device().ok_or("No microphone found. Plug one in or enable it in Windows sound settings.")?;
    let supported = device.default_input_config().map_err(|e| format!("Couldn't read the microphone's settings: {e}"))?;
    let channels = usize::from(supported.channels());
    let rate = supported.sample_rate();
    let config = supported.config();
    let report = |e: cpal::StreamError| eprintln!("microphone stream error: {e}");
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(&config, move |d: &[f32], _: &_| { let _ = tx.send(downmix(d, channels)); }, report, None),
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |d: &[i16], _: &_| { let _ = tx.send(downmix(&d.iter().map(|&s| f32::from(s) / 32_768.0).collect::<Vec<_>>(), channels)); },
            report,
            None,
        ),
        other => return Err(format!("This microphone uses an unsupported sample format ({other:?}).")),
    }
    .map_err(|e| format!("Couldn't open the microphone: {e}"))?;
    stream.play().map_err(|e| format!("Couldn't start the microphone: {e}"))?;
    Ok(Mic { _source: MicSource::Plain { _stream: stream }, rate })
}

fn emit_events(app: &AppHandle, events: Vec<SpeechEvent>) {
    for event in events {
        let result = match event {
            SpeechEvent::Start => app.emit(SPEECH_START_EVENT, ()),
            SpeechEvent::Partial(text) => app.emit(TRANSCRIPT_EVENT, Transcript { text, is_final: false }),
            SpeechEvent::Final(text) => app.emit(TRANSCRIPT_EVENT, Transcript { text, is_final: true }),
        };
        if let Err(error) = result {
            eprintln!("couldn't send a voice event: {error}");
        }
    }
}

/// One VAD window in; whether it holds speech. The detector's own segment queue isn't used.
pub(crate) fn vad_step(vad: &VoiceActivityDetector, window: &[f32]) -> bool {
    vad.accept_waveform(window);
    let speech = vad.detected();
    while !vad.is_empty() {
        vad.pop();
    }
    speech
}

/// Runs 16 kHz audio through VAD and recognition, returning the final transcripts.
#[cfg(test)]
pub(crate) fn transcribe(engines: &mut Engines, audio: &[f32]) -> Vec<String> {
    let mut finals = Vec::new();
    let silence = vec![0.0; SAMPLE_RATE as usize];
    for window in audio.chunks(VAD_WINDOW).chain(silence.chunks(VAD_WINDOW)) {
        if window.len() < VAD_WINDOW {
            continue;
        }
        let speech = vad_step(&engines.vad, window);
        for event in engines.segmenter.push(window, speech) {
            if let SpeechEvent::Final(text) = event {
                finals.push(text);
            }
        }
    }
    finals
}

/// Resamples a device chunk to 16 kHz and runs every full VAD window through the segmenter.
fn process(engines: &mut Engines, resampler: &LinearResampler, pending: &mut Vec<f32>, chunk: &[f32]) -> Vec<SpeechEvent> {
    let mut events = Vec::new();
    pending.extend(resampler.resample(chunk, false));
    while pending.len() >= VAD_WINDOW {
        let window: Vec<f32> = pending.drain(..VAD_WINDOW).collect();
        let speech = vad_step(&engines.vad, &window);
        events.extend(engines.segmenter.push(&window, speech));
    }
    events
}

/// One listening session. Tap: one sentence, then it stops by itself (or after a silent wait).
/// Hold: until the talk key is released, then everything said goes as one utterance.
fn listen(app: &AppHandle, engines: &mut Engines, commands: &Receiver<ListenCommand>, mode: ListenMode) -> Result<(), String> {
    let hold = mode == ListenMode::Hold;
    let (tx, audio) = mpsc::channel::<Vec<f32>>();
    let mic = open_mic(tx, mode == ListenMode::Conversation)?;
    let resampler = LinearResampler::create(mic.rate as i32, SAMPLE_RATE).ok_or("Couldn't set up audio resampling.")?;
    set_listening(app, true);
    let started = Instant::now();
    let mut session = if mode == ListenMode::Conversation { Session::continuous() } else { Session::new(hold) };
    let mut last_speech = Instant::now();
    let (mut heard_sound, mut heard_speech, mut warned) = (false, false, false);
    let mut pending = Vec::new();
    loop {
        match commands.try_recv() {
            Ok(ListenCommand::Stop) | Err(TryRecvError::Disconnected) => break,
            // The talk key during a conversation: the open mic is already hearing it.
            Ok(ListenCommand::Finish) if mode == ListenMode::Conversation => {}
            Ok(ListenCommand::Finish) => {
                let tail = engines.segmenter.flush();
                emit_events(app, session.finish(tail).into_iter().collect());
                break;
            }
            Ok(ListenCommand::Start { .. } | ListenCommand::Refresh) | Err(TryRecvError::Empty) => {}
        }
        match audio.recv_timeout(AUDIO_POLL) {
            Ok(chunk) => {
                heard_sound |= chunk.iter().any(|s| s.abs() > SILENCE_LEVEL);
                let events = process(engines, &resampler, &mut pending, &chunk);
                if events.contains(&SpeechEvent::Start) {
                    heard_speech = true;
                    last_speech = Instant::now();
                }
                let (out, done) = session.on_events(events);
                emit_events(app, out);
                if let Some(problem) = engines.segmenter.recognizer().failure() {
                    return Err(format!("{problem} {SAY_AGAIN}"));
                }
                if done {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("The microphone stopped.".into()),
        }
        if !heard_sound && !warned && started.elapsed() > SILENT_MIC_AFTER {
            warned = true;
            emit_error(app, MIC_SILENT);
        }
        let waited_out = match mode {
            ListenMode::Hold => started.elapsed() > MAX_HOLD,
            ListenMode::Tap => !heard_speech && started.elapsed() > NO_SPEECH_AFTER,
            ListenMode::Conversation => last_speech.elapsed() > CONVERSATION_IDLE_LIMIT,
        };
        if waited_out {
            // A tap that heard nothing deserves a word; a quiet conversation is just over.
            if mode == ListenMode::Tap && heard_sound && !heard_speech {
                emit_error(app, NOTHING_HEARD);
            }
            break;
        }
    }
    Ok(())
}

pub fn emit_error(app: &AppHandle, message: &str) {
    if let Err(error) = app.emit(ERROR_EVENT, message) {
        eprintln!("couldn't report a voice error ({message}): {error}");
    }
}

fn load(app: &AppHandle) -> Option<Engines> {
    set_status_detail(app, Some("Loading Hodey's ears...".into()));
    match load_any(&voice_root()) {
        Ok((engines, detail)) => {
            set_status_detail(app, detail);
            Some(engines)
        }
        Err(reason) => {
            set_status_detail(app, Some(reason.clone()));
            None
        }
    }
}

/// The listener thread: loads the models up front (so the first hold-to-talk doesn't lose words),
/// then runs a session per Start.
pub fn worker(app: AppHandle, commands: Receiver<ListenCommand>, installed: bool) {
    let mut engines = if installed { load(&app) } else { None };
    while let Some(command) = next_command(&app, &mut engines, &commands) {
        let ListenCommand::Start { mode } = command else { continue };
        if engines.is_none() {
            engines = load(&app);
        }
        let Some(loaded) = engines.as_mut() else {
            emit_error(&app, super::models::SETUP_HINT);
            continue;
        };
        if let Err(reason) = listen(&app, loaded, &commands, mode) {
            emit_error(&app, &reason);
        }
        loaded.segmenter.reset();
        loaded.vad.reset();
        set_listening(&app, false);
        recover(&app, loaded);
    }
}

/// Waits for the next command; with hands-free on, listens for "Hey Hodey" meanwhile. None: shutting down.
fn next_command(app: &AppHandle, engines: &mut Option<Engines>, commands: &Receiver<ListenCommand>) -> Option<ListenCommand> {
    loop {
        let Some(loaded) = engines.as_mut().filter(|_| standby::enabled()) else { return commands.recv().ok() };
        match standby::standby(app, loaded, commands) {
            Ok(Outcome::Command(command)) => return Some(command),
            Ok(Outcome::Off) => {}
            Ok(Outcome::EngineFailed) => recover(app, loaded),
            Ok(Outcome::Closed) => return None,
            Err(reason) => {
                // Don't retry a broken mic in a loop: hands-free stays off until it's switched on again.
                standby::pause();
                emit_error(app, &format!("Hands-free listening stopped: {reason}"));
            }
        }
    }
}
