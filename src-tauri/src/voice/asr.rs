//! Speech-recognition engines. NVIDIA Nemotron (streaming) is primary; multilingual Whisper (offline,
//! int8, CPU, through sherpa-onnx) is the backup when Nemotron is missing, won't load, or fails while
//! listening, so the demo never depends on one speech engine. Audio stays in memory.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineWhisperModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream, OnlineTransducerModelConfig};

use super::listen::{language, SAMPLE_RATE};
use super::models::{asr_files, vad_file, whisper_files, AsrFiles, WhisperFiles, WHISPER_SIZE};
use super::segment::Recognizer;

/// CPU threads: leave the rest for the app and the vision model's host work.
const ASR_THREADS: i32 = 2;
const CPU: &str = "cpu";
const WHISPER_TASK: &str = "transcribe";
/// Whisper's own language code for auto-detect (it picks per utterance between Hindi and English).
const WHISPER_AUTO_DETECT: &str = "";
/// Whisper hears at most 30 s at once; longer speech is transcribed in windows this long.
const WHISPER_WINDOW_SECS: usize = 25;
const WHISPER_WINDOW_SAMPLES: usize = WHISPER_WINDOW_SECS * SAMPLE_RATE as usize;
const NEMOTRON_NO_RESULT: &str = "Nemotron stopped returning text.";
const WHISPER_NO_RESULT: &str = "Whisper stopped returning text.";
/// Silence fed after the last word so the streaming encoder's lookahead covers it: without it the
/// final word of an utterance is often cut short or dropped. 0.6 s still lost it with the 560 ms-chunk
/// model ("Open Excel" heard as "Open Ex"); 1.2 s kept it for every test voice, for ~150 ms more latency.
const TAIL_PADDING_SECS: f32 = 1.2;
const NEMOTRON_ID: &str = "nemotron";
const WHISPER_ID: &str = "whisper";
const NEMOTRON_LABEL: &str = "Nemotron (fast, streaming)";
const WHISPER_LABEL: &str = "Whisper base (multilingual)";

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum EngineKind {
    Nemotron,
    Whisper,
}

/// Every engine this build can listen with, in Settings order.
pub(crate) const ENGINE_KINDS: [EngineKind; 2] = [EngineKind::Nemotron, EngineKind::Whisper];

impl EngineKind {
    /// The id Settings stores and the status reports.
    pub(crate) fn id(self) -> &'static str {
        match self {
            EngineKind::Nemotron => NEMOTRON_ID,
            EngineKind::Whisper => WHISPER_ID,
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            EngineKind::Nemotron => NEMOTRON_LABEL,
            EngineKind::Whisper => WHISPER_LABEL,
        }
    }

    pub(crate) fn from_id(id: &str) -> Option<Self> {
        ENGINE_KINDS.into_iter().find(|kind| kind.id() == id)
    }
}

/// Whether this engine's model files (and the shared voice activity detector) are on disk.
pub(crate) fn available(kind: EngineKind, root: &Path) -> bool {
    match kind {
        EngineKind::Nemotron => asr_files(root).is_ok(),
        EngineKind::Whisper => vad_file(root).is_ok() && whisper_files(root).is_ok(),
    }
}

/// The engine the learner picked in Settings (Nemotron until told otherwise).
static PREFERRED: Mutex<EngineKind> = Mutex::new(EngineKind::Nemotron);
/// The learner picked an engine the listener hasn't switched to yet.
static SWITCH_PENDING: AtomicBool = AtomicBool::new(false);

pub(crate) fn preferred() -> EngineKind {
    PREFERRED.lock().map(|kind| *kind).unwrap_or_else(|e| {
        eprintln!("speech engine preference lock poisoned, using Nemotron: {e}");
        EngineKind::Nemotron
    })
}

/// Settings > Voice > Speech model; the listener switches before its next session.
pub(crate) fn prefer(kind: EngineKind) -> Result<(), String> {
    *PREFERRED.lock().map_err(|e| e.to_string())? = kind;
    SWITCH_PENDING.store(true, Ordering::SeqCst);
    Ok(())
}

/// The engine to switch to, once per pick, so a failover to Whisper isn't undone after every session.
pub(crate) fn take_switch_request() -> Option<EngineKind> {
    SWITCH_PENDING.swap(false, Ordering::SeqCst).then(preferred)
}

/// A speech recognizer Hodey can listen with.
pub(crate) trait SpeechEngine: Recognizer + Send {
    fn kind(&self) -> EngineKind;
}

pub(crate) type Asr = Box<dyn SpeechEngine>;

impl Recognizer for Asr {
    fn start(&mut self) {
        (**self).start();
    }
    fn feed(&mut self, samples: &[f32]) -> String {
        (**self).feed(samples)
    }
    fn finish(&mut self) -> String {
        (**self).finish()
    }
    fn failure(&self) -> Option<&str> {
        (**self).failure()
    }
    fn clear_failure(&mut self) {
        (**self).clear_failure();
    }
}

/// Settings > Voice > Your speech, in Whisper's terms: English (US or UK) and Hindi are fixed;
/// anything else (auto, Hinglish) lets Whisper detect the language of each utterance.
pub(crate) fn whisper_language(asr_language: &str) -> &'static str {
    match asr_language {
        "en" | "en-GB" => "en",
        "hi" => "hi",
        _ => WHISPER_AUTO_DETECT,
    }
}

/// What the status line says while Whisper listens: the engine in use, and why.
pub(crate) fn whisper_detail(nemotron_problem: &str) -> String {
    format!("Listening with Whisper {WHISPER_SIZE}, Hodey's backup speech engine. Nemotron: {nemotron_problem}")
}

/// Nemotron when it loads; otherwise Whisper. Ok: the engine and the status detail (None for Nemotron).
pub(crate) fn load_with_fallback(primary: impl FnOnce() -> Result<Asr, String>, backup: impl FnOnce() -> Result<Asr, String>) -> Result<(Asr, Option<String>), String> {
    let problem = match primary() {
        Ok(engine) => return Ok((engine, None)),
        Err(problem) => problem,
    };
    eprintln!("Nemotron speech recognition unavailable, trying Whisper: {problem}");
    match backup() {
        Ok(engine) => Ok((engine, Some(whisper_detail(&problem)))),
        Err(backup_problem) => Err(format!("{problem} Whisper backup: {backup_problem}")),
    }
}

/// The learner's engine when it loads; otherwise the other one. Ok: the engine and the status detail
/// (None when the preferred engine is listening).
pub(crate) fn load_preferred(preferred: EngineKind, load: impl Fn(EngineKind) -> Result<Asr, String>) -> Result<(Asr, Option<String>), String> {
    if preferred == EngineKind::Nemotron {
        return load_with_fallback(|| load(EngineKind::Nemotron), || load(EngineKind::Whisper));
    }
    let problem = match load(EngineKind::Whisper) {
        Ok(engine) => return Ok((engine, None)),
        Err(problem) => problem,
    };
    eprintln!("Whisper speech recognition unavailable, trying Nemotron: {problem}");
    match load(EngineKind::Nemotron) {
        Ok(engine) => Ok((engine, Some(format!("Listening with Nemotron; the Whisper model you picked didn't load: {problem}")))),
        Err(backup_problem) => Err(format!("{problem} Nemotron: {backup_problem}")),
    }
}

/// After a session: a failed Nemotron is replaced by Whisper; a failed Whisper is reported (there's
/// nothing further to fall back to). Some: the new status detail.
pub(crate) fn switch_on_failure(engine: &mut Asr, backup: impl FnOnce() -> Result<Asr, String>) -> Option<String> {
    let problem = engine.failure()?.to_string();
    engine.clear_failure();
    eprintln!("speech recognition failed ({:?}): {problem}", engine.kind());
    if engine.kind() == EngineKind::Whisper {
        return Some(problem);
    }
    match backup() {
        Ok(whisper) => {
            *engine = whisper;
            Some(whisper_detail(&problem))
        }
        Err(backup_problem) => Some(format!("{problem} Whisper backup: {backup_problem}")),
    }
}

fn path(p: &std::path::Path) -> Option<String> {
    Some(p.to_string_lossy().into_owned())
}

/// NVIDIA Nemotron streaming transducer, one utterance per stream.
pub(crate) struct Nemotron {
    recognizer: OnlineRecognizer,
    stream: Option<OnlineStream>,
    failure: Option<String>,
}

fn decoded(recognizer: &OnlineRecognizer, stream: &OnlineStream) -> Result<String, String> {
    while recognizer.is_ready(stream) {
        recognizer.decode(stream);
    }
    recognizer.get_result(stream).map(|r| r.text).ok_or_else(|| NEMOTRON_NO_RESULT.to_string())
}

impl Nemotron {
    pub(crate) fn load(files: &AsrFiles) -> Result<Asr, String> {
        // feature_dim stays at sherpa's default (80) on purpose: for NeMo transducers sherpa-onnx 1.13.8
        // takes the size from the encoder's `feat_dim` metadata (128 for Nemotron 3.5) and ignores this
        // setting (checked against the real model: 64, 80 and 128 give the same transcript).
        let mut config = OnlineRecognizerConfig::default();
        config.model_config.transducer = OnlineTransducerModelConfig { encoder: path(&files.encoder), decoder: path(&files.decoder), joiner: path(&files.joiner) };
        config.model_config.tokens = path(&files.tokens);
        config.model_config.num_threads = ASR_THREADS;
        config.model_config.provider = Some(CPU.into());
        let recognizer = OnlineRecognizer::create(&config).ok_or("Couldn't load the Nemotron speech model.")?;
        Ok(Box::new(Nemotron { recognizer, stream: None, failure: None }))
    }

    fn record(&mut self, result: Result<String, String>) -> String {
        result.unwrap_or_else(|problem| {
            eprintln!("Nemotron: {problem}");
            self.failure = Some(problem);
            String::new()
        })
    }
}

impl Recognizer for Nemotron {
    fn start(&mut self) {
        let stream = self.recognizer.create_stream();
        stream.set_option("language", language());
        self.stream = Some(stream);
    }

    fn feed(&mut self, samples: &[f32]) -> String {
        let Some(stream) = &self.stream else { return String::new() };
        stream.accept_waveform(SAMPLE_RATE, samples);
        let result = decoded(&self.recognizer, stream);
        self.record(result)
    }

    fn finish(&mut self) -> String {
        let Some(stream) = self.stream.take() else { return String::new() };
        stream.accept_waveform(SAMPLE_RATE, &tail_padding());
        stream.input_finished();
        let result = decoded(&self.recognizer, &stream);
        self.record(result)
    }

    fn failure(&self) -> Option<&str> {
        self.failure.as_deref()
    }

    fn clear_failure(&mut self) {
        self.failure = None;
    }
}

impl SpeechEngine for Nemotron {
    fn kind(&self) -> EngineKind {
        EngineKind::Nemotron
    }
}

/// Silence that lets the last word through the streaming encoder before the utterance closes.
fn tail_padding() -> Vec<f32> {
    vec![0.0; (TAIL_PADDING_SECS * SAMPLE_RATE as f32) as usize]
}

fn whisper_recognizer(files: &WhisperFiles, language: &str) -> Result<OfflineRecognizer, String> {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.whisper = OfflineWhisperModelConfig {
        encoder: path(&files.encoder),
        decoder: path(&files.decoder),
        language: Some(language.into()),
        task: Some(WHISPER_TASK.into()),
        ..Default::default()
    };
    config.model_config.tokens = path(&files.tokens);
    config.model_config.num_threads = ASR_THREADS;
    config.model_config.provider = Some(CPU.into());
    OfflineRecognizer::create(&config).ok_or_else(|| format!("Couldn't load the Whisper {WHISPER_SIZE} speech model."))
}

/// Multilingual Whisper: not streaming, so each utterance is transcribed once the pause ends it
/// (no live partial text, except after each long window).
pub(crate) struct Whisper {
    files: WhisperFiles,
    recognizer: OfflineRecognizer,
    /// The Whisper language code the recognizer was built for.
    language: &'static str,
    audio: Vec<f32>,
    /// Text of the long-speech windows already transcribed in this utterance.
    heard: String,
    failure: Option<String>,
}

impl Whisper {
    pub(crate) fn load(files: WhisperFiles) -> Result<Asr, String> {
        let language = whisper_language(language());
        let recognizer = whisper_recognizer(&files, language)?;
        Ok(Box::new(Whisper { files, recognizer, language, audio: Vec::new(), heard: String::new(), failure: None }))
    }

    /// Whisper's language is fixed per recognizer: rebuild it when the learner picked another one.
    fn follow_language(&mut self) {
        let wanted = whisper_language(language());
        if wanted == self.language {
            return;
        }
        match whisper_recognizer(&self.files, wanted) {
            Ok(recognizer) => {
                self.recognizer = recognizer;
                self.language = wanted;
            }
            Err(problem) => eprintln!("Whisper keeps language {:?}: {problem}", self.language),
        }
    }

    fn transcribe(&mut self) -> String {
        let audio = std::mem::take(&mut self.audio);
        if audio.is_empty() {
            return String::new();
        }
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE, &audio);
        self.recognizer.decode(&stream);
        match stream.get_result() {
            Some(result) => result.text.trim().to_string(),
            None => {
                eprintln!("Whisper: {WHISPER_NO_RESULT}");
                self.failure = Some(WHISPER_NO_RESULT.into());
                String::new()
            }
        }
    }

    fn add_heard(&mut self, text: &str) {
        if !self.heard.is_empty() && !text.is_empty() {
            self.heard.push(' ');
        }
        self.heard.push_str(text);
    }
}

impl Recognizer for Whisper {
    fn start(&mut self) {
        self.follow_language();
        self.audio.clear();
        self.heard.clear();
    }

    fn feed(&mut self, samples: &[f32]) -> String {
        self.audio.extend_from_slice(samples);
        if self.audio.len() >= WHISPER_WINDOW_SAMPLES {
            let text = self.transcribe();
            self.add_heard(&text);
        }
        self.heard.clone()
    }

    fn finish(&mut self) -> String {
        let text = self.transcribe();
        self.add_heard(&text);
        std::mem::take(&mut self.heard)
    }

    fn failure(&self) -> Option<&str> {
        self.failure.as_deref()
    }

    fn clear_failure(&mut self) {
        self.failure = None;
    }
}

impl SpeechEngine for Whisper {
    fn kind(&self) -> EngineKind {
        EngineKind::Whisper
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        kind: EngineKind,
        failure: Option<String>,
    }

    impl Recognizer for Fake {
        fn start(&mut self) {}
        fn feed(&mut self, _: &[f32]) -> String {
            String::new()
        }
        fn finish(&mut self) -> String {
            String::new()
        }
        fn failure(&self) -> Option<&str> {
            self.failure.as_deref()
        }
        fn clear_failure(&mut self) {
            self.failure = None;
        }
    }

    impl SpeechEngine for Fake {
        fn kind(&self) -> EngineKind {
            self.kind
        }
    }

    fn fake(kind: EngineKind, failure: Option<&str>) -> Asr {
        Box::new(Fake { kind, failure: failure.map(String::from) })
    }

    #[test]
    fn whisper_hears_the_language_the_learner_picked() {
        assert_eq!(whisper_language("en"), "en");
        assert_eq!(whisper_language("en-GB"), "en");
        assert_eq!(whisper_language("hi"), "hi");
        assert_eq!(whisper_language("auto"), WHISPER_AUTO_DETECT, "Hindi, English or Hinglish: Whisper detects it");
    }

    #[test]
    fn nemotron_stays_primary_when_it_loads() {
        let (engine, detail) = load_with_fallback(|| Ok(fake(EngineKind::Nemotron, None)), || panic!("the backup must not load")).unwrap();
        assert_eq!(engine.kind(), EngineKind::Nemotron);
        assert_eq!(detail, None, "no change in what the learner sees");
    }

    #[test]
    fn falls_back_to_whisper_when_nemotron_wont_load() {
        let (engine, detail) = load_with_fallback(|| Err("Missing: sherpa-onnx-nemotron*".into()), || Ok(fake(EngineKind::Whisper, None))).unwrap();
        assert_eq!(engine.kind(), EngineKind::Whisper);
        let detail = detail.unwrap();
        assert!(detail.contains("Whisper") && detail.contains("sherpa-onnx-nemotron"), "{detail}");
    }

    #[test]
    fn reports_both_problems_when_neither_engine_loads() {
        let problem = load_with_fallback(|| Err("no nemotron".into()), || Err("no whisper".into())).err().unwrap();
        assert!(problem.contains("no nemotron") && problem.contains("no whisper"), "{problem}");
    }

    #[test]
    fn a_healthy_engine_is_left_alone() {
        let mut engine = fake(EngineKind::Nemotron, None);
        assert_eq!(switch_on_failure(&mut engine, || panic!("the backup must not load")), None);
        assert_eq!(engine.kind(), EngineKind::Nemotron);
    }

    #[test]
    fn switches_to_whisper_when_nemotron_fails_while_listening() {
        let mut engine = fake(EngineKind::Nemotron, Some(NEMOTRON_NO_RESULT));
        let detail = switch_on_failure(&mut engine, || Ok(fake(EngineKind::Whisper, None))).unwrap();
        assert_eq!(engine.kind(), EngineKind::Whisper);
        assert!(detail.contains("Whisper") && detail.contains(NEMOTRON_NO_RESULT), "{detail}");
        assert_eq!(engine.failure(), None);
    }

    #[test]
    fn keeps_nemotron_and_says_why_when_whisper_is_missing_too() {
        let mut engine = fake(EngineKind::Nemotron, Some(NEMOTRON_NO_RESULT));
        let detail = switch_on_failure(&mut engine, || Err("Missing: sherpa-onnx-whisper-base".into())).unwrap();
        assert_eq!(engine.kind(), EngineKind::Nemotron);
        assert!(detail.contains(NEMOTRON_NO_RESULT) && detail.contains("sherpa-onnx-whisper-base"), "{detail}");
        assert_eq!(engine.failure(), None, "the next session tries again");
    }

    #[test]
    fn engines_round_trip_through_their_settings_ids() {
        for kind in ENGINE_KINDS {
            assert_eq!(EngineKind::from_id(kind.id()), Some(kind));
        }
        assert_eq!(EngineKind::from_id("parakeet"), None);
        assert_eq!(EngineKind::Nemotron.label(), "Nemotron (fast, streaming)");
        assert_eq!(EngineKind::Whisper.label(), "Whisper base (multilingual)");
    }

    fn all_but(missing: EngineKind) -> impl Fn(EngineKind) -> Result<Asr, String> {
        move |kind| if kind == missing { Err(format!("no {}", kind.id())) } else { Ok(fake(kind, None)) }
    }

    #[test]
    fn the_learner_s_engine_loads_first_and_the_other_backs_it_up() {
        let (engine, detail) = load_preferred(EngineKind::Whisper, all_but(EngineKind::Nemotron)).unwrap();
        assert_eq!((engine.kind(), detail), (EngineKind::Whisper, None));
        let (engine, detail) = load_preferred(EngineKind::Whisper, all_but(EngineKind::Whisper)).unwrap();
        assert_eq!(engine.kind(), EngineKind::Nemotron);
        assert!(detail.unwrap().contains("no whisper"));
        let (engine, detail) = load_preferred(EngineKind::Nemotron, all_but(EngineKind::Whisper)).unwrap();
        assert_eq!((engine.kind(), detail), (EngineKind::Nemotron, None));
    }

    #[test]
    fn an_engine_is_available_only_with_its_files_and_the_detector() {
        let root = std::env::temp_dir().join(format!("hodeum-asr-available-{}", std::process::id()));
        let pack = root.join("sherpa-onnx-whisper-base");
        std::fs::create_dir_all(&pack).unwrap();
        for name in ["base-encoder.int8.onnx", "base-decoder.int8.onnx", "base-tokens.txt"] {
            std::fs::write(pack.join(name), b"").unwrap();
        }
        assert!(!available(EngineKind::Whisper, &root), "no voice activity detector yet");
        std::fs::write(root.join("silero_vad.onnx"), b"").unwrap();
        assert!(available(EngineKind::Whisper, &root));
        assert!(!available(EngineKind::Nemotron, &root));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_last_word_gets_enough_trailing_silence() {
        let padding = tail_padding();
        assert_eq!(padding.len(), 19_200, "1.2 s at 16 kHz");
        assert!(padding.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn a_failing_whisper_is_reported_with_nothing_left_to_switch_to() {
        let mut engine = fake(EngineKind::Whisper, Some(WHISPER_NO_RESULT));
        assert_eq!(switch_on_failure(&mut engine, || panic!("no further backup")), Some(WHISPER_NO_RESULT.into()));
        assert_eq!(engine.kind(), EngineKind::Whisper);
    }
}
