//! Microphone → 16 kHz mono → Silero VAD → NVIDIA Nemotron streaming ASR, on a worker thread.
//! Audio and transcripts live only in memory: nothing is recorded or saved.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::time::{Duration, Instant};

use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rodio::cpal::{self, SampleFormat};
use serde::Serialize;
use sherpa_onnx::{
    LinearResampler, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream, OnlineTransducerModelConfig, SileroVadModelConfig, VadModelConfig,
    VoiceActivityDetector,
};
use tauri::{AppHandle, Emitter};

use super::models::{asr_files, voice_root, AsrFiles};
use super::segment::{downmix, Recognizer, Segmenter, Session, SpeechEvent};
use super::{set_listening, set_status_detail};

const SAMPLE_RATE: i32 = 16_000;
const VAD_WINDOW: usize = 512;
const VAD_THRESHOLD: f32 = 0.5;
/// Silence that ends an utterance: long enough for a natural mid-sentence pause (0.6 s cut people
/// off in testing), short enough that replies still feel quick.
const END_SILENCE_SECS: f32 = 0.9;
const MIN_SPEECH_SECS: f32 = 0.25;
const MAX_SPEECH_SECS: f32 = 20.0;
const VAD_BUFFER_SECS: f32 = 30.0;
/// CPU threads: leave the rest for the app and the vision model's host work.
const ASR_THREADS: i32 = 2;
/// Nemotron 3.5 is multilingual; English for now ("auto" once Hindi/Hinglish lands).
const ASR_LANGUAGE: &str = "en";
const AUDIO_POLL: Duration = Duration::from_millis(50);
/// A microphone that delivers pure digital silence this long is muted or misconfigured.
const SILENT_MIC_AFTER: Duration = Duration::from_secs(4);
const SILENCE_LEVEL: f32 = 1e-7;
/// Tap-to-talk: a tap that hears no speech at all gives up after this long.
const NO_SPEECH_AFTER: Duration = Duration::from_secs(8);
const NOTHING_HEARD: &str = "I didn't catch anything. Tap the mic and try again.";
/// A held talk key is released eventually; this guards against a stuck key.
const MAX_HOLD: Duration = Duration::from_secs(60);
/// After Hodey speaks in a conversation, how long it waits for the learner to reply.
const FOLLOW_UP_PATIENCE: Duration = Duration::from_secs(6);
const MIC_SILENT: &str = "Your microphone is sending silence. Check it isn't muted, or pick another input in Windows sound settings.";

pub const SPEECH_START_EVENT: &str = "voice:speech-start";
pub const TRANSCRIPT_EVENT: &str = "voice:transcript";
pub const ERROR_EVENT: &str = "voice:error";

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
    /// Hodey just finished speaking in a conversation: wait briefly for a reply, quietly.
    FollowUp,
}

pub enum ListenCommand {
    Start { mode: ListenMode },
    /// The talk key was released: send what was said.
    Finish,
    /// Stop without sending anything.
    Stop,
}

/// NVIDIA Nemotron streaming transducer, one utterance per stream.
struct Nemotron {
    recognizer: OnlineRecognizer,
    stream: Option<OnlineStream>,
}

impl Nemotron {
    fn text(&self, stream: &OnlineStream) -> String {
        while self.recognizer.is_ready(stream) {
            self.recognizer.decode(stream);
        }
        self.recognizer.get_result(stream).map(|r| r.text).unwrap_or_default()
    }
}

impl Recognizer for Nemotron {
    fn start(&mut self) {
        let stream = self.recognizer.create_stream();
        stream.set_option("language", ASR_LANGUAGE);
        self.stream = Some(stream);
    }

    fn feed(&mut self, samples: &[f32]) -> String {
        let Some(stream) = &self.stream else { return String::new() };
        stream.accept_waveform(SAMPLE_RATE, samples);
        self.text(stream)
    }

    fn finish(&mut self) -> String {
        let Some(stream) = self.stream.take() else { return String::new() };
        stream.input_finished();
        self.text(&stream)
    }
}

pub(crate) struct Engines {
    vad: VoiceActivityDetector,
    segmenter: Segmenter<Nemotron>,
}

fn path(p: &std::path::Path) -> Option<String> {
    Some(p.to_string_lossy().into_owned())
}

pub(crate) fn load_engines(files: &AsrFiles) -> Result<Engines, String> {
    let vad_config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: path(&files.vad),
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
    let vad = VoiceActivityDetector::create(&vad_config, VAD_BUFFER_SECS).ok_or("Couldn't load the voice activity detector.")?;
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer = OnlineTransducerModelConfig { encoder: path(&files.encoder), decoder: path(&files.decoder), joiner: path(&files.joiner) };
    config.model_config.tokens = path(&files.tokens);
    config.model_config.num_threads = ASR_THREADS;
    config.model_config.provider = Some("cpu".into());
    let recognizer = OnlineRecognizer::create(&config).ok_or("Couldn't load the Nemotron speech model.")?;
    Ok(Engines { vad, segmenter: Segmenter::new(Nemotron { recognizer, stream: None }) })
}

/// The default microphone, delivering mono f32 chunks at the device's own rate.
struct Mic {
    _stream: cpal::Stream,
    rate: u32,
}

fn open_mic(tx: Sender<Vec<f32>>) -> Result<Mic, String> {
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
    Ok(Mic { _stream: stream, rate })
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

/// Runs 16 kHz audio through VAD and recognition, returning the final transcripts.
#[cfg(test)]
pub(crate) fn transcribe(engines: &mut Engines, audio: &[f32]) -> Vec<String> {
    let mut finals = Vec::new();
    let silence = vec![0.0; SAMPLE_RATE as usize];
    for window in audio.chunks(VAD_WINDOW).chain(silence.chunks(VAD_WINDOW)) {
        if window.len() < VAD_WINDOW {
            continue;
        }
        engines.vad.accept_waveform(window);
        let speech = engines.vad.detected();
        while !engines.vad.is_empty() {
            engines.vad.pop();
        }
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
        engines.vad.accept_waveform(&window);
        let speech = engines.vad.detected();
        while !engines.vad.is_empty() {
            engines.vad.pop();
        }
        events.extend(engines.segmenter.push(&window, speech));
    }
    events
}

/// One listening session. Tap: one sentence, then it stops by itself (or after a silent wait).
/// Hold: until the talk key is released, then everything said goes as one utterance.
fn listen(app: &AppHandle, engines: &mut Engines, commands: &Receiver<ListenCommand>, mode: ListenMode) -> Result<(), String> {
    let hold = mode == ListenMode::Hold;
    let (tx, audio) = mpsc::channel::<Vec<f32>>();
    let mic = open_mic(tx)?;
    let resampler = LinearResampler::create(mic.rate as i32, SAMPLE_RATE).ok_or("Couldn't set up audio resampling.")?;
    set_listening(app, true);
    let started = Instant::now();
    let mut session = Session::new(hold);
    let (mut heard_sound, mut heard_speech, mut warned) = (false, false, false);
    let mut pending = Vec::new();
    loop {
        match commands.try_recv() {
            Ok(ListenCommand::Stop) | Err(TryRecvError::Disconnected) => break,
            Ok(ListenCommand::Finish) => {
                let tail = engines.segmenter.flush();
                emit_events(app, session.finish(tail).into_iter().collect());
                break;
            }
            Ok(ListenCommand::Start { .. }) | Err(TryRecvError::Empty) => {}
        }
        match audio.recv_timeout(AUDIO_POLL) {
            Ok(chunk) => {
                heard_sound |= chunk.iter().any(|s| s.abs() > SILENCE_LEVEL);
                let events = process(engines, &resampler, &mut pending, &chunk);
                heard_speech |= events.contains(&SpeechEvent::Start);
                let (out, done) = session.on_events(events);
                emit_events(app, out);
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
            ListenMode::FollowUp => !heard_speech && started.elapsed() > FOLLOW_UP_PATIENCE,
        };
        if waited_out {
            // A tap that heard nothing deserves a word; a quiet follow-up just means the chat is over.
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
    match asr_files(&voice_root()).and_then(|files| load_engines(&files)) {
        Ok(engines) => {
            set_status_detail(app, None);
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
    while let Ok(command) = commands.recv() {
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
    }
}
