//! Hands-free (opt-in): while nobody is talking to Hodey, listen for "Hey Hodey". Overheard speech is
//! transcribed in memory only to check for a wake word. Speech that doesn't open with one is dropped
//! as soon as its first word is known, and nothing is recorded or saved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Mutex;

use sherpa_onnx::LinearResampler;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::listen::{open_mic, vad_step, Engines, ListenCommand, AUDIO_POLL, SAMPLE_RATE, VAD_WINDOW};
use super::segment::SpeechEvent;
use super::set_standby;

/// Speech that might be for Hodey; the frontend checks it against the wake words. Partial text lets
/// "Hey Hodey" stop Hodey mid-sentence before the learner has finished talking.
pub const WAKE_EVENT: &str = "voice:wake-candidate";

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Candidate {
    pub(crate) text: String,
    #[serde(rename = "final")]
    pub(crate) is_final: bool,
}

/// First words a wake phrase can open with: greetings, Hodey's name and how it's misheard, in Latin
/// and Hindi script. The full check (src/features/voice/route.ts) happens once the sentence ends.
const BUILT_IN_FIRST_WORDS: [&str; 16] =
    ["hey", "hi", "hello", "ok", "okay", "hodey", "hody", "hodi", "hodie", "hoadie", "hode", "howdy", "हे", "हाय", "ओके", "होडी"];
/// Words heard before the first one is trusted: a streaming recognizer can still revise a word in progress.
const SETTLED_AFTER_WORDS: usize = 2;

static ENABLED: AtomicBool = AtomicBool::new(false);
/// First words of the learner's own wake words ("hey" of "Hey Hodes").
static CUSTOM_FIRST_WORDS: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub enum Outcome {
    /// Someone wants the listener (tap, hold, follow-up): hand it over.
    Command(ListenCommand),
    /// Hands-free was switched off.
    Off,
    /// The app is shutting down.
    Closed,
}

pub fn configure(enabled: bool, wake_words: &[String]) -> Result<(), String> {
    *CUSTOM_FIRST_WORDS.lock().map_err(|e| e.to_string())? = wake_words.iter().filter_map(|w| first_word(w)).collect();
    ENABLED.store(enabled, Ordering::SeqCst);
    Ok(())
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// After a failure: off until the learner switches it on again.
pub fn pause() {
    ENABLED.store(false, Ordering::SeqCst);
}

fn first_word(text: &str) -> Option<String> {
    let word = text.split_whitespace().next()?.trim_matches(|c: char| c.is_ascii_punctuation()).to_lowercase();
    (!word.is_empty()).then_some(word)
}

/// Whether speech heard so far might still be for Hodey: undecided until its first word has settled.
pub(crate) fn may_be_wake(partial: &str, custom: &[String]) -> bool {
    if partial.split_whitespace().count() < SETTLED_AFTER_WORDS {
        return true;
    }
    first_word(partial).is_none_or(|first| BUILT_IN_FIRST_WORDS.contains(&first.as_str()) || custom.contains(&first))
}

/// Listens until a command arrives or hands-free is switched off. Err: the microphone failed.
pub fn standby(app: &AppHandle, engines: &mut Engines, commands: &Receiver<ListenCommand>) -> Result<Outcome, String> {
    let (tx, audio) = mpsc::channel::<Vec<f32>>();
    let mic = open_mic(tx, true)?;
    let resampler = LinearResampler::create(mic.rate as i32, SAMPLE_RATE).ok_or("Couldn't set up audio resampling.")?;
    set_standby(app, true);
    let outcome = wait(app, engines, commands, &audio, &resampler);
    set_standby(app, false);
    engines.segmenter.reset();
    engines.vad.reset();
    outcome
}

fn wait(app: &AppHandle, engines: &mut Engines, commands: &Receiver<ListenCommand>, audio: &Receiver<Vec<f32>>, resampler: &LinearResampler) -> Result<Outcome, String> {
    let mut overheard = Overheard::default();
    loop {
        match commands.try_recv() {
            Ok(ListenCommand::Refresh) if !enabled() => return Ok(Outcome::Off),
            Ok(ListenCommand::Refresh) | Err(TryRecvError::Empty) => {}
            Ok(command) => return Ok(Outcome::Command(command)),
            Err(TryRecvError::Disconnected) => return Ok(Outcome::Closed),
        }
        match audio.recv_timeout(AUDIO_POLL) {
            Ok(chunk) => overheard.push(engines, &resampler.resample(&chunk, false)).into_iter().for_each(|text| emit_candidate(app, text)),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err("The microphone stopped.".into()),
        }
    }
}

fn emit_candidate(app: &AppHandle, candidate: Candidate) {
    if let Err(error) = app.emit(WAKE_EVENT, candidate) {
        eprintln!("couldn't send overheard speech for the wake-word check: {error}");
    }
}

/// Room speech, window by window: transcribed only while it could still be a wake phrase.
#[derive(Default)]
pub(crate) struct Overheard {
    pending: Vec<f32>,
    /// The current speech isn't for Hodey: skip it until the next pause.
    ignoring: bool,
}

impl Overheard {
    /// 16 kHz audio in; speech that might be for Hodey out (live, then the finished sentence).
    pub(crate) fn push(&mut self, engines: &mut Engines, samples: &[f32]) -> Vec<Candidate> {
        let mut candidates = Vec::new();
        self.pending.extend_from_slice(samples);
        while self.pending.len() >= VAD_WINDOW {
            let window: Vec<f32> = self.pending.drain(..VAD_WINDOW).collect();
            let speech = vad_step(&engines.vad, &window);
            if self.ignoring && speech {
                continue;
            }
            self.ignoring = false;
            for event in engines.segmenter.push(&window, speech) {
                candidates.extend(self.on_event(engines, event));
            }
        }
        candidates
    }

    fn on_event(&mut self, engines: &mut Engines, event: SpeechEvent) -> Option<Candidate> {
        match event {
            SpeechEvent::Partial(text) if !may_be_wake(&text, &custom_first_words()) => {
                engines.segmenter.reset();
                self.ignoring = true;
                None
            }
            SpeechEvent::Partial(text) => Some(Candidate { text, is_final: false }),
            SpeechEvent::Final(text) => Some(Candidate { text, is_final: true }),
            SpeechEvent::Start => None,
        }
    }
}

fn custom_first_words() -> Vec<String> {
    CUSTOM_FIRST_WORDS.lock().map(|words| words.clone()).unwrap_or_else(|e| {
        eprintln!("wake words lock poisoned: {e}");
        Vec::new()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_listening_until_the_first_word_settles() {
        assert!(may_be_wake("I", &[]));
        assert!(may_be_wake("Hey Hodey", &[]));
        assert!(may_be_wake("Okay, Hodi what's this", &[]));
        assert!(may_be_wake("हे होडी", &[]));
    }

    #[test]
    fn drops_speech_that_opens_with_another_word() {
        assert!(!may_be_wake("I think", &[]));
        assert!(!may_be_wake("Lunch is ready", &[]));
    }

    #[test]
    fn knows_the_learner_s_wake_words() {
        configure(false, &["Yo Hodes".into()]).unwrap();
        assert!(may_be_wake("Yo, Hodes show me", &custom_first_words()));
        configure(false, &[]).unwrap();
    }
}
