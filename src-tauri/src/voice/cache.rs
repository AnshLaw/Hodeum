//! Recently spoken phrases, kept as audio so repeats ("Let me look.", a lesson's lines) start instantly.

use std::collections::VecDeque;
use std::sync::Arc;

use super::voices::Engine;

/// Audio for one phrase in one voice at one speed.
pub type Phrase = (Arc<Vec<f32>>, u32);

pub fn key(engine: Engine, sid: i32, speed: f32, text: &str) -> String {
    format!("{engine:?}:{sid}:{speed:.2}:{text}")
}

/// A small most-recently-used cache. A phrase is a few hundred KB of samples, so it stays small.
pub struct PhraseCache {
    capacity: usize,
    entries: VecDeque<(String, Phrase)>,
}

impl PhraseCache {
    pub fn new(capacity: usize) -> Self {
        Self { capacity, entries: VecDeque::with_capacity(capacity) }
    }

    pub fn get(&mut self, key: &str) -> Option<Phrase> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        let entry = self.entries.remove(index)?;
        let phrase = entry.1.clone();
        self.entries.push_front(entry);
        Some(phrase)
    }

    pub fn put(&mut self, key: String, phrase: Phrase) {
        self.entries.retain(|(k, _)| *k != key);
        self.entries.push_front((key, phrase));
        self.entries.truncate(self.capacity);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phrase(n: f32) -> Phrase {
        (Arc::new(vec![n]), 24_000)
    }

    #[test]
    fn keeps_the_most_recent_phrases() {
        let mut cache = PhraseCache::new(2);
        cache.put("a".into(), phrase(1.0));
        cache.put("b".into(), phrase(2.0));
        assert!(cache.get("a").is_some(), "touching a keeps it");
        cache.put("c".into(), phrase(3.0));
        assert!(cache.get("b").is_none(), "b was least recent");
        assert_eq!(cache.get("a").map(|(s, _)| s[0]), Some(1.0));
    }

    #[test]
    fn keys_differ_by_voice_speed_and_text() {
        assert_ne!(key(Engine::Kokoro, 3, 1.0, "Hi."), key(Engine::Kokoro, 2, 1.0, "Hi."));
        assert_ne!(key(Engine::Kokoro, 3, 1.0, "Hi."), key(Engine::Kokoro, 3, 1.1, "Hi."));
    }
}
