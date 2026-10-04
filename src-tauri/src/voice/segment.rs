//! Turns voice-activity frames into speech events: start (for barge-in), live partial text, final text.

use std::collections::VecDeque;

/// A streaming recognizer for one utterance at a time.
pub trait Recognizer {
    fn start(&mut self);
    /// Feeds 16 kHz mono samples; returns the text so far.
    fn feed(&mut self, samples: &[f32]) -> String;
    /// Ends the utterance and returns its final text.
    fn finish(&mut self) -> String;
    /// Why the engine stopped working while listening, if it did (it then returns empty text).
    fn failure(&self) -> Option<&str> {
        None
    }
    fn clear_failure(&mut self) {}
}

#[derive(Debug, PartialEq)]
pub enum SpeechEvent {
    Start,
    Partial(String),
    Final(String),
}

/// Audio kept from just before speech is detected, so the first word isn't clipped. The detector
/// needs ~0.25 s of speech before it fires, so this covers that plus a margin (0.6 s at 16 kHz).
pub const PREROLL_SAMPLES: usize = 9_600;

pub struct Segmenter<R: Recognizer> {
    recognizer: R,
    speaking: bool,
    preroll: VecDeque<f32>,
    last: String,
}

impl<R: Recognizer> Segmenter<R> {
    pub fn new(recognizer: R) -> Self {
        Self { recognizer, speaking: false, preroll: VecDeque::with_capacity(PREROLL_SAMPLES), last: String::new() }
    }

    /// One VAD window: its samples and whether the window contains speech.
    pub fn push(&mut self, frame: &[f32], speech: bool) -> Vec<SpeechEvent> {
        match (self.speaking, speech) {
            (false, false) => {
                self.remember(frame);
                Vec::new()
            }
            (false, true) => self.begin(frame),
            (true, true) => self.partial(frame).into_iter().collect(),
            (true, false) => self.end(frame),
        }
    }

    pub fn recognizer(&self) -> &R {
        &self.recognizer
    }

    pub fn recognizer_mut(&mut self) -> &mut R {
        &mut self.recognizer
    }

    /// Whether an utterance is under way.
    pub fn speaking(&self) -> bool {
        self.speaking
    }

    /// Ends an utterance in progress right now (the talk key was released) and returns its text.
    pub fn flush(&mut self) -> Option<String> {
        if !self.speaking {
            return None;
        }
        match self.end(&[]).pop() {
            Some(SpeechEvent::Final(text)) => Some(text),
            _ => None,
        }
    }

    /// Drops any utterance in progress (listening stopped mid-sentence).
    pub fn reset(&mut self) {
        if self.speaking {
            self.recognizer.finish();
        }
        self.speaking = false;
        self.last.clear();
        self.preroll.clear();
    }

    fn begin(&mut self, frame: &[f32]) -> Vec<SpeechEvent> {
        self.speaking = true;
        self.recognizer.start();
        let mut audio: Vec<f32> = self.preroll.drain(..).collect();
        audio.extend_from_slice(frame);
        let mut events = vec![SpeechEvent::Start];
        events.extend(self.partial(&audio));
        events
    }

    fn end(&mut self, frame: &[f32]) -> Vec<SpeechEvent> {
        self.speaking = false;
        self.last.clear();
        let text = self.recognizer.finish().trim().to_string();
        self.remember(frame);
        if text.is_empty() {
            Vec::new()
        } else {
            vec![SpeechEvent::Final(text)]
        }
    }

    fn partial(&mut self, samples: &[f32]) -> Option<SpeechEvent> {
        let text = self.recognizer.feed(samples).trim().to_string();
        if text.is_empty() || text == self.last {
            return None;
        }
        self.last = text.clone();
        Some(SpeechEvent::Partial(text))
    }

    fn remember(&mut self, frame: &[f32]) {
        self.preroll.extend(frame.iter().copied());
        let excess = self.preroll.len().saturating_sub(PREROLL_SAMPLES);
        self.preroll.drain(..excess);
    }
}

fn join(a: &str, b: &str) -> String {
    match (a.is_empty(), b.is_empty()) {
        (true, _) => b.to_string(),
        (_, true) => a.to_string(),
        _ => format!("{a} {b}"),
    }
}

/// One listening session. Tap-to-talk ends at the first finished sentence; while the talk key is held,
/// sentences (split by pauses) build up into one utterance that's sent on release.
pub struct Session {
    hold: bool,
    /// A conversation: every sentence is sent as it ends, and the session carries on.
    continuous: bool,
    said: String,
}

impl Session {
    pub fn new(hold: bool) -> Self {
        Self { hold, continuous: false, said: String::new() }
    }

    pub fn continuous() -> Self {
        Self { hold: false, continuous: true, said: String::new() }
    }

    /// What to send on for these events, and whether the session is over.
    pub fn on_events(&mut self, events: Vec<SpeechEvent>) -> (Vec<SpeechEvent>, bool) {
        let mut out = Vec::new();
        for event in events {
            match event {
                SpeechEvent::Start => out.push(SpeechEvent::Start),
                SpeechEvent::Partial(text) => out.push(SpeechEvent::Partial(join(&self.said, &text))),
                SpeechEvent::Final(text) if self.hold => {
                    self.said = join(&self.said, &text);
                    out.push(SpeechEvent::Partial(self.said.clone()));
                }
                SpeechEvent::Final(text) if self.continuous => out.push(SpeechEvent::Final(text)),
                SpeechEvent::Final(text) => {
                    out.push(SpeechEvent::Final(text));
                    return (out, true);
                }
            }
        }
        (out, false)
    }

    /// The key was released: everything said, as one final utterance.
    pub fn finish(&mut self, tail: Option<String>) -> Option<SpeechEvent> {
        let all = join(&self.said, tail.as_deref().unwrap_or_default());
        self.said.clear();
        (!all.is_empty()).then_some(SpeechEvent::Final(all))
    }
}

/// Interleaved device samples to mono.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks(channels).map(|frame| frame.iter().sum::<f32>() / frame.len() as f32).collect()
}

/// Hindi's full stop.
const DANDA: char = '।';

pub fn is_devanagari(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c)
}

/// A sentence split where it changes script, so Hindi is said with Hindi pronunciation and English
/// words inside it (control names, app names) with English pronunciation. `true` marks Hindi runs.
/// Spaces, digits and punctuation stay with the run they follow.
pub fn script_runs(text: &str) -> Vec<(String, bool)> {
    let mut runs: Vec<(String, bool)> = Vec::new();
    for c in text.chars() {
        let script = if is_devanagari(c) { Some(true) } else if c.is_alphabetic() { Some(false) } else { None };
        let switches = match (runs.last(), script) {
            (None, _) => true,
            (Some((run, hindi)), Some(s)) => *hindi != s && run.chars().any(char::is_alphabetic),
            (Some(_), None) => false,
        };
        if switches {
            runs.push((c.to_string(), script.unwrap_or(false)));
        } else if let Some((run, hindi)) = runs.last_mut() {
            run.push(c);
            // A run that so far held only spaces or punctuation takes the script of its first letter.
            *hindi = script.unwrap_or(*hindi);
        }
    }
    runs.into_iter().map(|(run, hindi)| (run.trim().to_string(), hindi)).filter(|(run, _)| !run.is_empty()).collect()
}

/// Splits text into sentences so speech can start after the first one is synthesized.
/// Very short pieces are joined to the next so Hodey doesn't sound clipped.
pub fn sentences(text: &str) -> Vec<String> {
    const MIN_CHARS: usize = 24;
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
        if word.ends_with(['.', '!', '?', DANDA]) && current.chars().count() >= MIN_CHARS {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// The first chunk is what the learner waits for; past this length, split it at a comma.
const FIRST_CHUNK_MAX: usize = 45;
/// A clause shorter than this sounds clipped on its own.
const MIN_CLAUSE: usize = 12;

/// Sentences to speak, with a long first sentence split at a comma so Hodey starts talking sooner.
/// Later chunks are synthesized while the first one plays.
pub fn speech_chunks(text: &str) -> Vec<String> {
    let mut chunks = sentences(text);
    let Some(first) = chunks.first().cloned() else { return chunks };
    if first.chars().count() <= FIRST_CHUNK_MAX {
        return chunks;
    }
    let split = first.match_indices(", ").map(|(i, _)| i).find(|&i| i >= MIN_CLAUSE && first.len() - i > MIN_CLAUSE);
    if let Some(i) = split {
        chunks.splice(0..1, [first[..=i].to_string(), first[i + 2..].to_string()]);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_long_first_sentence_at_a_comma_so_speech_starts_sooner() {
        let text = "Nice work so far, now choose PivotTable from the ribbon on the Insert tab. Then press OK.";
        assert_eq!(speech_chunks(text), vec!["Nice work so far,", "now choose PivotTable from the ribbon on the Insert tab.", "Then press OK."]);
        assert_eq!(speech_chunks("Let me look."), vec!["Let me look."]);
        assert_eq!(speech_chunks("Open the Insert tab at the very top of the window please."), vec!["Open the Insert tab at the very top of the window please."]);
    }

    /// Pretends each fed sample is one recognised character.
    #[derive(Default)]
    struct Fake {
        heard: usize,
    }

    impl Recognizer for Fake {
        fn start(&mut self) {
            self.heard = 0;
        }
        fn feed(&mut self, samples: &[f32]) -> String {
            self.heard += samples.len();
            "x".repeat(self.heard.min(5))
        }
        fn finish(&mut self) -> String {
            "hint".into()
        }
    }

    #[test]
    fn emits_start_partials_then_final() {
        let mut s = Segmenter::new(Fake::default());
        assert!(s.push(&[0.0; 2], false).is_empty());
        assert_eq!(s.push(&[0.1; 1], true), vec![SpeechEvent::Start, SpeechEvent::Partial("xxx".into())]);
        assert_eq!(s.push(&[0.1; 1], true), vec![SpeechEvent::Partial("xxxx".into())]);
        assert_eq!(s.push(&[0.0; 1], false), vec![SpeechEvent::Final("hint".into())]);
    }

    #[test]
    fn primes_each_utterance_with_recent_audio() {
        let mut s = Segmenter::new(Fake::default());
        s.push(&vec![0.0; PREROLL_SAMPLES + 100], false);
        s.push(&[0.1; 1], true);
        assert_eq!(s.recognizer.heard, PREROLL_SAMPLES + 1);
    }

    #[test]
    fn tap_sessions_end_at_the_first_sentence() {
        let mut session = Session::new(false);
        let (out, done) = session.on_events(vec![SpeechEvent::Final("give me a hint".into())]);
        assert_eq!((out, done), (vec![SpeechEvent::Final("give me a hint".into())], true));
    }

    #[test]
    fn held_sessions_join_sentences_until_release() {
        let mut session = Session::new(true);
        let (out, done) = session.on_events(vec![SpeechEvent::Final("teach me how to make".into())]);
        assert_eq!((out, done), (vec![SpeechEvent::Partial("teach me how to make".into())], false));
        let (out, _) = session.on_events(vec![SpeechEvent::Partial("a pivot".into())]);
        assert_eq!(out, vec![SpeechEvent::Partial("teach me how to make a pivot".into())]);
        assert_eq!(session.finish(Some("a pivot table".into())), Some(SpeechEvent::Final("teach me how to make a pivot table".into())));
        assert_eq!(session.finish(None), None);
    }

    #[test]
    fn conversations_send_each_sentence_and_keep_listening() {
        let mut session = Session::continuous();
        let (out, done) = session.on_events(vec![SpeechEvent::Final("give me a hint".into())]);
        assert_eq!((out, done), (vec![SpeechEvent::Final("give me a hint".into())], false));
        let (out, done) = session.on_events(vec![SpeechEvent::Partial("wait".into()), SpeechEvent::Final("wait what".into())]);
        assert_eq!((out, done), (vec![SpeechEvent::Partial("wait".into()), SpeechEvent::Final("wait what".into())], false));
    }

    #[test]
    fn flushing_ends_the_sentence_in_progress() {
        let mut s = Segmenter::new(Fake::default());
        s.push(&[0.1; 1], true);
        assert!(s.speaking());
        assert_eq!(s.flush(), Some("hint".into()));
        assert!(!s.speaking());
        assert_eq!(s.flush(), None);
    }

    #[test]
    fn splits_mixed_hindi_and_english_by_script() {
        assert_eq!(script_runs("Click Insert."), vec![("Click Insert.".into(), false)]);
        assert_eq!(script_runs("अब पिवट टेबल पर क्लिक कीजिए।"), vec![("अब पिवट टेबल पर क्लिक कीजिए।".into(), true)]);
        assert_eq!(
            script_runs("ये Insert टैब है, 2 सेकंड।"),
            vec![("ये".into(), true), ("Insert".into(), false), ("टैब है, 2 सेकंड।".into(), true)]
        );
    }

    #[test]
    fn hindi_sentences_end_at_the_danda() {
        let text = "ऊपर इंसर्ट टैब पर क्लिक कीजिए। मैंने उसे हाइलाइट कर दिया है।";
        assert_eq!(sentences(text).len(), 2);
    }

    #[test]
    fn downmixes_stereo() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn splits_into_speakable_sentences() {
        let text = "Click the Insert tab. Good. Now choose PivotTable from the ribbon! Then press OK";
        assert_eq!(sentences(text), vec!["Click the Insert tab. Good.", "Now choose PivotTable from the ribbon!", "Then press OK"]);
    }
}
