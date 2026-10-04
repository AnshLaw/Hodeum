//! Microphone → 16 kHz mono → Silero VAD → NVIDIA Nemotron streaming ASR (or the Whisper backup,
//! see asr.rs), on a worker thread.
//! Audio and transcripts live only in memory: nothing is recorded or saved.

use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sherpa_onnx::{LinearResampler, SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};
use tauri::{AppHandle, Emitter};

use super::agc::{QuietMic, VadGain};
use super::asr::{self, Asr, EngineKind, Nemotron, Whisper};
use super::mic::{Input, WarmMic};
use super::models::{asr_files, vad_file, voice_root, whisper_files};
use super::refine::refine;
use super::segment::{Recognizer, Segmenter, Session, SpeechEvent};
use super::standby::{self, Outcome};
use super::{set_asr_engine, set_listening, set_mic, set_status_detail};
use crate::perception::input_hook;

pub(crate) const SAMPLE_RATE: i32 = 16_000;
pub(crate) const VAD_WINDOW: usize = 512;
const VAD_WINDOW_SECS: f32 = VAD_WINDOW as f32 / SAMPLE_RATE as f32;
/// Tap-to-talk: the learner asked to be heard, so softer speech counts.
const VAD_THRESHOLD: f32 = 0.5;
const MIN_SPEECH_SECS: f32 = 0.25;
/// Open mic (conversation, hands-free): coughs, room noise and typing mustn't start a turn.
const OPEN_MIC_VAD_THRESHOLD: f32 = 0.6;
const OPEN_MIC_MIN_SPEECH_SECS: f32 = 0.4;
/// Silence that ends an utterance: long enough for a natural mid-sentence pause (0.6 s cut people
/// off in testing), short enough that replies still feel quick.
const END_SILENCE_SECS: f32 = 0.9;
/// A key click sounds like the start of speech; windows this soon after a key press aren't speech.
const KEY_NOISE_WINDOW: Duration = Duration::from_millis(300);
/// What the detector hears instead of typing noise, so the clicks don't build up into "speech".
const SILENT_WINDOW: [f32; VAD_WINDOW] = [0.0; VAD_WINDOW];
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
pub(crate) const MIC_QUIET: &str = "Your microphone is very quiet. Move closer to it, or raise its level in Windows sound settings.";
/// People let go of the talk key while still saying the last syllable: keep listening this long after.
const HOLD_RELEASE_TAIL: Duration = Duration::from_millis(300);

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
    /// Another microphone or speaker was picked: reopen an open microphone on it.
    DevicesChanged,
    /// Another speech engine was picked: switch once no one is talking.
    SwitchEngine,
    /// A conversation will probably follow: start opening the echo-cancelled microphone now.
    WarmEcho,
}

impl ListenMode {
    fn vad_mode(self) -> VadMode {
        match self {
            ListenMode::Tap => VadMode::Tap,
            ListenMode::Hold => VadMode::Hold,
            ListenMode::Conversation => VadMode::OpenMic,
        }
    }
}

/// How audio is judged as speech.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum VadMode {
    /// Tapped the mic: the softer detector; key clicks are ignored.
    Tap,
    /// Talk key held: everything is kept, so quiet speech the detector misses still gets sent.
    Hold,
    /// Conversation and hands-free: the stricter detector; key clicks are ignored.
    OpenMic,
}

/// What the detector judges for one window.
#[derive(Debug, PartialEq)]
enum Judge {
    /// Speech, no detector needed (the talk key is held).
    Speech,
    /// Typing noise: the detector hears silence instead.
    KeyNoise,
    /// The detector decides.
    Audio,
}

/// A key click moments ago sounds like speech, unless the learner is already mid-sentence. Hold mode
/// is never gated: the Hodey key itself is down then.
fn judge(mode: VadMode, speaking: bool, since_key: Option<Duration>) -> Judge {
    if mode == VadMode::Hold {
        return Judge::Speech;
    }
    if !speaking && since_key.is_some_and(|since| since < KEY_NOISE_WINDOW) {
        return Judge::KeyNoise;
    }
    Judge::Audio
}

pub(crate) struct Engines {
    /// Tap-to-talk's detector.
    pub(crate) vad: VoiceActivityDetector,
    /// The stricter open-mic detector (conversation, hands-free).
    pub(crate) open_vad: VoiceActivityDetector,
    pub(crate) segmenter: Segmenter<Asr>,
    /// The detectors hear the audio through this gain; the recognizer hears it raw.
    gain: VadGain,
    quiet: QuietMic,
    quiet_warning: bool,
}

impl Engines {
    fn new(root: &std::path::Path, engine: Asr) -> Result<Self, String> {
        let model = vad_file(root)?;
        let vad = load_vad(&model, VAD_THRESHOLD, MIN_SPEECH_SECS)?;
        let open_vad = load_vad(&model, OPEN_MIC_VAD_THRESHOLD, OPEN_MIC_MIN_SPEECH_SECS)?;
        Ok(Self { vad, open_vad, segmenter: Segmenter::new(engine), gain: VadGain::default(), quiet: QuietMic::default(), quiet_warning: false })
    }

    /// Drops any utterance in progress and the detectors' state, between sessions.
    pub(crate) fn reset(&mut self) {
        self.segmenter.reset();
        self.vad.reset();
        self.open_vad.reset();
        self.gain = VadGain::default();
        self.quiet = QuietMic::default();
        self.quiet_warning = false;
    }

    /// True once per session when the learner's speech is only ever heard at full gain.
    pub(crate) fn take_quiet_warning(&mut self) -> bool {
        std::mem::take(&mut self.quiet_warning)
    }
}

fn path(p: &std::path::Path) -> Option<String> {
    Some(p.to_string_lossy().into_owned())
}

fn load_vad(model: &std::path::Path, threshold: f32, min_speech_secs: f32) -> Result<VoiceActivityDetector, String> {
    let vad_config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: path(model),
            threshold,
            min_silence_duration: END_SILENCE_SECS,
            min_speech_duration: min_speech_secs,
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
    Engines::new(&voice_root(), Nemotron::load(files)?)
}

/// Whisper only, for the model tests.
#[cfg(test)]
pub(crate) fn load_whisper_engines(root: &std::path::Path) -> Result<Engines, String> {
    Engines::new(root, load_whisper(root)?)
}

fn load_whisper(root: &std::path::Path) -> Result<Asr, String> {
    whisper_files(root).and_then(Whisper::load)
}

fn load_engine(kind: EngineKind, root: &std::path::Path) -> Result<Asr, String> {
    match kind {
        EngineKind::Nemotron => asr_files(root).and_then(|files| Nemotron::load(&files)),
        EngineKind::Whisper => load_whisper(root),
    }
}

/// The voice activity detectors and the learner's speech engine (else the other one). Ok: the status detail too.
pub(crate) fn load_any(root: &std::path::Path) -> Result<(Engines, Option<String>), String> {
    vad_file(root)?;
    let (engine, detail) = asr::load_preferred(asr::preferred(), |kind| load_engine(kind, root))?;
    Ok((Engines::new(root, engine)?, detail))
}

/// Tells the frontend which engine is listening now.
fn report_engine(app: &AppHandle, engines: &Engines) {
    set_asr_engine(app, Some(engines.segmenter.recognizer().kind().id()));
}

/// After a session: switches a failed Nemotron to Whisper and says so in the status line.
fn recover(app: &AppHandle, engines: &mut Engines) {
    if let Some(detail) = asr::switch_on_failure(engines.segmenter.recognizer_mut(), || load_whisper(&voice_root())) {
        set_status_detail(app, Some(detail));
        report_engine(app, engines);
    }
}

/// Settings picked another speech engine: load it between sessions. On failure the current one keeps listening.
fn switch_engine(app: &AppHandle, engines: &mut Engines, kind: EngineKind) {
    if engines.segmenter.recognizer().kind() == kind {
        return;
    }
    set_status_detail(app, Some(format!("Loading {}...", kind.label())));
    match load_engine(kind, &voice_root()) {
        Ok(engine) => {
            *engines.segmenter.recognizer_mut() = engine;
            set_status_detail(app, None);
            report_engine(app, engines);
        }
        Err(reason) => {
            eprintln!("couldn't switch speech recognition to {}: {reason}", kind.id());
            set_status_detail(app, Some(format!("{} didn't load, so Hodey keeps listening with the current engine. {reason}", kind.label())));
        }
    }
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

/// Whether one window holds speech, by the detector for `mode` (through the gain stage), with typing
/// noise heard as silence.
pub(crate) fn is_speech(engines: &mut Engines, window: &[f32], mode: VadMode) -> bool {
    let vad = if mode == VadMode::OpenMic { &engines.open_vad } else { &engines.vad };
    match judge(mode, engines.segmenter.speaking(), input_hook::since_last_key()) {
        Judge::Speech => true,
        Judge::KeyNoise => {
            vad_step(vad, &SILENT_WINDOW);
            false
        }
        Judge::Audio => {
            let speech = vad_step(vad, &engines.gain.process(window));
            if engines.quiet.observe(speech && engines.gain.near_max(), VAD_WINDOW_SECS) {
                engines.quiet_warning = true;
            }
            speech
        }
    }
}

/// Whether these events finished something the learner said (what keeps a conversation open).
fn said_something(events: &[SpeechEvent]) -> bool {
    events.iter().any(|event| matches!(event, SpeechEvent::Final(text) if !text.trim().is_empty()))
}

/// Runs 16 kHz audio through VAD and recognition, returning the final transcripts. Two seconds of
/// silence follow, well past the end-of-speech pause, so the last utterance always closes.
#[cfg(test)]
pub(crate) fn transcribe(engines: &mut Engines, audio: &[f32]) -> Vec<String> {
    let mut finals = Vec::new();
    let silence = vec![0.0; 2 * SAMPLE_RATE as usize];
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
fn process(engines: &mut Engines, resampler: &LinearResampler, pending: &mut Vec<f32>, chunk: &[f32], mode: VadMode) -> Vec<SpeechEvent> {
    let mut events = Vec::new();
    pending.extend(resampler.resample(chunk, false));
    while pending.len() >= VAD_WINDOW {
        let window: Vec<f32> = pending.drain(..VAD_WINDOW).collect();
        let speech = is_speech(engines, &window, mode);
        events.extend(engines.segmenter.push(&window, speech));
    }
    events
}

/// Whether the talk key was let go long enough ago to send what was said.
fn release_due(released: Option<Instant>, now: Instant) -> bool {
    released.is_some_and(|at| now.saturating_duration_since(at) >= HOLD_RELEASE_TAIL)
}

/// A listening session's state between audio chunks.
struct Progress {
    mode: ListenMode,
    session: Session,
    started: Instant,
    /// When the learner last finished saying something; a conversation ends after a long quiet.
    last_said: Instant,
    heard_sound: bool,
    heard_speech: bool,
    warned: bool,
    pending: Vec<f32>,
    /// The audio behind the final transcript to come (a held key's: every sentence so far).
    audio: Vec<f32>,
    /// When the talk key was released; the session ends HOLD_RELEASE_TAIL later.
    released: Option<Instant>,
}

impl Progress {
    fn new(mode: ListenMode) -> Self {
        let session = if mode == ListenMode::Conversation { Session::continuous() } else { Session::new(mode == ListenMode::Hold) };
        let now = Instant::now();
        Self { mode, session, started: now, last_said: now, heard_sound: false, heard_speech: false, warned: false, pending: Vec::new(), audio: Vec::new(), released: None }
    }

    /// One chunk of audio. Ok(true): the session is over (a tap's sentence ended).
    fn hear(&mut self, app: &AppHandle, engines: &mut Engines, resampler: &LinearResampler, chunk: &[f32]) -> Result<bool, String> {
        self.heard_sound |= chunk.iter().any(|s| s.abs() > SILENCE_LEVEL);
        let events = process(engines, resampler, &mut self.pending, chunk, self.mode.vad_mode());
        self.keep_audio(engines);
        if engines.take_quiet_warning() {
            emit_error(app, MIC_QUIET);
        }
        self.heard_speech |= events.contains(&SpeechEvent::Start);
        // Only words keep a conversation open: noise that starts the detector (typing, a cough) doesn't.
        if said_something(&events) {
            self.last_said = Instant::now();
        }
        let (out, done) = self.session.on_events(events);
        emit_events(app, self.refined(out));
        match engines.segmenter.recognizer().failure() {
            Some(problem) => Err(format!("{problem} {SAY_AGAIN}")),
            None => Ok(done),
        }
    }

    /// A finished utterance's audio: a held key gathers every sentence, other sessions only the last.
    fn keep_audio(&mut self, engines: &mut Engines) {
        if let Some(audio) = engines.segmenter.take_audio() {
            if self.mode == ListenMode::Hold {
                self.audio.extend(audio);
            } else {
                self.audio = audio;
            }
        }
    }

    /// Final transcripts as the GPU re-reads them (Nemotron's own when it can't); the rest unchanged.
    fn refined(&mut self, events: Vec<SpeechEvent>) -> Vec<SpeechEvent> {
        events
            .into_iter()
            .map(|event| match event {
                SpeechEvent::Final(text) => SpeechEvent::Final(refine(&text, &std::mem::take(&mut self.audio))),
                other => other,
            })
            .collect()
    }

    /// The talk key was released (or held too long): everything said, as one utterance.
    fn finish_hold(&mut self, app: &AppHandle, engines: &mut Engines) {
        let tail = engines.segmenter.flush();
        self.keep_audio(engines);
        let out = self.session.finish(tail).into_iter().collect();
        emit_events(app, self.refined(out));
    }

    /// Warns about a silent microphone; true when the session has waited long enough.
    fn timed_out(&mut self, app: &AppHandle, engines: &mut Engines) -> bool {
        if !self.heard_sound && !self.warned && self.started.elapsed() > SILENT_MIC_AFTER {
            self.warned = true;
            emit_error(app, MIC_SILENT);
        }
        let waited_out = match self.mode {
            ListenMode::Hold => self.started.elapsed() > MAX_HOLD,
            ListenMode::Tap => !self.heard_speech && self.started.elapsed() > NO_SPEECH_AFTER,
            ListenMode::Conversation => self.last_said.elapsed() > CONVERSATION_IDLE_LIMIT,
        };
        if waited_out {
            match self.mode {
                // A stuck talk key: send what was said rather than lose it.
                ListenMode::Hold => self.finish_hold(app, engines),
                // A tap that heard nothing deserves a word; a quiet conversation is just over.
                ListenMode::Tap if self.heard_sound && !self.heard_speech => emit_error(app, NOTHING_HEARD),
                ListenMode::Tap | ListenMode::Conversation => {}
            }
        }
        waited_out
    }
}

/// Takes the microphone for a session (or hands-free) and says which one it is.
pub(crate) fn take_input(app: &AppHandle, warm: &mut WarmMic, cancel_echo: bool) -> Result<Input, String> {
    let input = warm.take(cancel_echo)?;
    set_mic(app, Some((input.name.clone(), input.echo_cancelled())));
    Ok(input)
}

/// Closes a microphone nobody needs next.
pub(crate) fn retire(app: &AppHandle, input: Input) {
    drop(input);
    set_mic(app, None);
}

/// What the session loop does with a command. Ok(true): the session is over.
fn on_command(app: &AppHandle, command: ListenCommand, progress: &mut Progress, input: &mut Input, warm: &mut WarmMic) -> Result<bool, String> {
    match command {
        ListenCommand::Stop => return Ok(true),
        // The talk key during a conversation: the open mic is already hearing it.
        ListenCommand::Finish if progress.mode == ListenMode::Conversation => {}
        ListenCommand::Finish => {
            progress.released.get_or_insert_with(Instant::now);
        }
        ListenCommand::DevicesChanged => {
            warm.close();
            *input = take_input(app, warm, progress.mode == ListenMode::Conversation)?;
        }
        ListenCommand::WarmEcho => warm.prepare_echo(),
        // An engine switch waits until the session ends (the worker checks then).
        ListenCommand::Start { .. } | ListenCommand::Refresh | ListenCommand::SwitchEngine => {}
    }
    Ok(false)
}

/// The session loop. Ok(()) when it ended normally.
fn run(app: &AppHandle, engines: &mut Engines, commands: &Receiver<ListenCommand>, progress: &mut Progress, input: &mut Input, warm: &mut WarmMic) -> Result<(), String> {
    loop {
        match commands.try_recv() {
            Ok(command) => {
                if on_command(app, command, progress, input, warm)? {
                    return Ok(());
                }
            }
            Err(TryRecvError::Disconnected) => return Ok(()),
            Err(TryRecvError::Empty) => {}
        }
        match input.next(AUDIO_POLL) {
            Ok(chunk) => {
                if progress.hear(app, engines, &input.resampler, &chunk)? {
                    return Ok(());
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("The microphone stopped.".into()),
        }
        if release_due(progress.released, Instant::now()) {
            progress.finish_hold(app, engines);
            return Ok(());
        }
        if progress.timed_out(app, engines) {
            return Ok(());
        }
    }
}

/// One listening session. Tap: one sentence, then it stops by itself (or after a silent wait).
/// Hold: until the talk key is released (and a moment after), then everything said goes as one
/// utterance. Conversation: until stopped. Afterwards the microphone stays open briefly for what
/// usually follows (the conversation after a tap, hands-free listening).
fn listen(app: &AppHandle, engines: &mut Engines, commands: &Receiver<ListenCommand>, mode: ListenMode, warm: &mut WarmMic) -> Result<(), String> {
    let mut input = take_input(app, warm, mode == ListenMode::Conversation)?;
    set_listening(app, true);
    let mut progress = Progress::new(mode);
    let result = run(app, engines, commands, &mut progress, &mut input, warm);
    let follow_up = mode != ListenMode::Conversation || standby::enabled();
    if result.is_ok() && follow_up {
        warm.park(input);
    } else {
        retire(app, input);
    }
    result
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
            report_engine(app, &engines);
            Some(engines)
        }
        Err(reason) => {
            set_status_detail(app, Some(reason.clone()));
            None
        }
    }
}

/// The listener thread: loads the models up front (so the first hold-to-talk doesn't lose words),
/// then runs a session per Start, and switches engines between sessions.
pub fn worker(app: AppHandle, commands: Receiver<ListenCommand>, installed: bool) {
    let mut engines = if installed { load(&app) } else { None };
    let mut warm = WarmMic::default();
    while let Some(command) = next_command(&app, &mut engines, &commands, &mut warm) {
        match command {
            ListenCommand::Start { mode } => session(&app, &mut engines, &commands, mode, &mut warm),
            ListenCommand::DevicesChanged => close_warm(&app, &mut warm),
            ListenCommand::WarmEcho => warm.prepare_echo(),
            ListenCommand::Finish | ListenCommand::Stop | ListenCommand::Refresh | ListenCommand::SwitchEngine => {}
        }
        if let (Some(loaded), Some(kind)) = (engines.as_mut(), asr::take_switch_request()) {
            switch_engine(&app, loaded, kind);
        }
    }
}

fn session(app: &AppHandle, engines: &mut Option<Engines>, commands: &Receiver<ListenCommand>, mode: ListenMode, warm: &mut WarmMic) {
    if engines.is_none() {
        *engines = load(app);
    }
    let Some(loaded) = engines.as_mut() else {
        emit_error(app, super::models::SETUP_HINT);
        return;
    };
    if let Err(reason) = listen(app, loaded, commands, mode, warm) {
        emit_error(app, &reason);
    }
    loaded.reset();
    set_listening(app, false);
    recover(app, loaded);
}

fn close_warm(app: &AppHandle, warm: &mut WarmMic) {
    if warm.is_open() {
        warm.close();
        set_mic(app, None);
    }
}

/// Waits for a command while the last session's microphone is still open; closes it when its grace
/// runs out. None: nothing was open (or it closed); Some(None): shutting down.
fn wait_warm(app: &AppHandle, commands: &Receiver<ListenCommand>, warm: &mut WarmMic) -> Option<Option<ListenCommand>> {
    let closes_at = warm.closes_at()?;
    match commands.recv_timeout(closes_at.saturating_duration_since(Instant::now())) {
        Ok(command) => Some(Some(command)),
        Err(RecvTimeoutError::Timeout) => {
            close_warm(app, warm);
            None
        }
        Err(RecvTimeoutError::Disconnected) => Some(None),
    }
}

/// Waits for the next command; with hands-free on, listens for "Hey Hodey" meanwhile. None: shutting down.
fn next_command(app: &AppHandle, engines: &mut Option<Engines>, commands: &Receiver<ListenCommand>, warm: &mut WarmMic) -> Option<ListenCommand> {
    loop {
        let Some(loaded) = engines.as_mut().filter(|_| standby::enabled()) else {
            if let Some(next) = wait_warm(app, commands, warm) {
                return next;
            }
            return commands.recv().ok();
        };
        match standby::standby(app, loaded, commands, warm) {
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

#[cfg(test)]
mod gate_tests {
    use super::*;

    #[test]
    fn key_clicks_are_not_speech_unless_the_talk_key_is_held() {
        let pressed = |ms| Some(Duration::from_millis(ms));
        assert_eq!(judge(VadMode::Tap, false, pressed(100)), Judge::KeyNoise);
        assert_eq!(judge(VadMode::OpenMic, false, pressed(299)), Judge::KeyNoise);
        assert_eq!(judge(VadMode::OpenMic, false, pressed(300)), Judge::Audio, "the click has passed");
        assert_eq!(judge(VadMode::OpenMic, false, None), Judge::Audio, "no key pressed yet");
        assert_eq!(judge(VadMode::OpenMic, true, pressed(50)), Judge::Audio, "typing mid-sentence doesn't cut the learner off");
        assert_eq!(judge(VadMode::Hold, false, pressed(0)), Judge::Speech, "hold-to-talk is never gated");
        assert_eq!(judge(VadMode::Hold, false, None), Judge::Speech, "hold keeps quiet speech the detector would miss");
    }

    #[test]
    fn only_finished_words_keep_a_conversation_open() {
        assert!(!said_something(&[SpeechEvent::Start]), "noise that starts the detector");
        assert!(!said_something(&[SpeechEvent::Start, SpeechEvent::Partial("uh".into())]));
        assert!(!said_something(&[SpeechEvent::Final("  ".into())]));
        assert!(said_something(&[SpeechEvent::Partial("give".into()), SpeechEvent::Final("give me a hint".into())]));
    }

    #[test]
    fn a_released_talk_key_keeps_listening_a_moment_for_the_last_syllable() {
        let released = Instant::now();
        assert!(!release_due(None, released), "still held");
        assert!(!release_due(Some(released), released), "just let go");
        assert!(!release_due(Some(released), released + HOLD_RELEASE_TAIL - Duration::from_millis(1)));
        assert!(release_due(Some(released), released + HOLD_RELEASE_TAIL));
    }

    #[test]
    fn each_mode_uses_its_detector() {
        assert_eq!(ListenMode::Tap.vad_mode(), VadMode::Tap);
        assert_eq!(ListenMode::Hold.vad_mode(), VadMode::Hold);
        assert_eq!(ListenMode::Conversation.vad_mode(), VadMode::OpenMic);
        assert!(OPEN_MIC_VAD_THRESHOLD > VAD_THRESHOLD && OPEN_MIC_MIN_SPEECH_SECS > MIN_SPEECH_SECS, "the open mic is stricter");
    }
}
