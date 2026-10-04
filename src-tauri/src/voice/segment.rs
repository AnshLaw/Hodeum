//! Turns voice-activity frames into speech events: start (for barge-in), live partial text, final text.

use std::collections::VecDeque;

/// A streaming recognizer for one utterance at a time.
pub trait Recognizer {
    fn start(&mut self);
    /// Feeds 16 kHz mono samples; returns the text so far.
    fn feed(&mut self, samples: &[f32]) -> String;
    /// Ends the utterance and returns its final text.
    fn finish(&mut self) -> String;
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

/// Interleaved device samples to mono.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks(channels).map(|frame| frame.iter().sum::<f32>() / frame.len() as f32).collect()
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
        if word.ends_with(['.', '!', '?']) && current.chars().count() >= MIN_CHARS {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn downmixes_stereo() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn splits_into_speakable_sentences() {
        let text = "Click the Insert tab. Good. Now choose PivotTable from the ribbon! Then press OK";
        assert_eq!(sentences(text), vec!["Click the Insert tab. Good.", "Now choose PivotTable from the ribbon!", "Then press OK"]);
    }
}
