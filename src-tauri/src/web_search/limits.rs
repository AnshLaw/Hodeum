//! What Hodey remembers between searches: recent answers, and which sources asked to be left alone.
//! In memory only; it holds the scrubbed query and public page text, nothing from the screen.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use super::source::SourceId;
use super::WebSearch;

pub const CACHE_ENTRIES: usize = 64;
pub const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Most recently used first.
#[derive(Default)]
pub struct Cache {
    entries: VecDeque<(String, Instant, WebSearch)>,
}

impl Cache {
    pub fn get(&mut self, key: &str, now: Instant) -> Option<WebSearch> {
        self.entries.retain(|(_, at, _)| now.saturating_duration_since(*at) < CACHE_TTL);
        let index = self.entries.iter().position(|(k, _, _)| k == key)?;
        let entry = self.entries.remove(index)?;
        let found = entry.2.clone();
        self.entries.push_front(entry);
        Some(found)
    }

    pub fn put(&mut self, key: String, now: Instant, value: WebSearch) {
        self.entries.retain(|(k, _, _)| *k != key);
        self.entries.push_front((key, now, value));
        self.entries.truncate(CACHE_ENTRIES);
    }
}

#[derive(Default)]
pub struct Cooldowns {
    until: HashMap<SourceId, Instant>,
}

impl Cooldowns {
    /// How long `id` still has to rest, if at all.
    pub fn remaining(&self, id: SourceId, now: Instant) -> Option<Duration> {
        self.until.get(&id).map(|until| until.saturating_duration_since(now)).filter(|left| !left.is_zero())
    }

    /// Rests `id` for `rest`, never shortening a longer rest already in place.
    pub fn rest(&mut self, id: SourceId, now: Instant, rest: Duration) {
        let until = now + rest;
        let entry = self.until.entry(id).or_insert(until);
        *entry = (*entry).max(until);
    }
}

#[derive(Default)]
pub struct Memory {
    pub cache: Cache,
    pub cooldowns: Cooldowns,
}

/// The app-wide memory. A panic elsewhere while it was held leaves plain data, so a poisoned lock is
/// recovered rather than turning every later search into an error.
pub fn memory() -> MutexGuard<'static, Memory> {
    static MEMORY: OnceLock<Mutex<Memory>> = OnceLock::new();
    MEMORY.get_or_init(Mutex::default).lock().unwrap_or_else(|poisoned| {
        eprintln!("web search memory was poisoned by a panic; carrying on with it");
        poisoned.into_inner()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search(query: &str) -> WebSearch {
        WebSearch { query: query.into(), provider: "Exa".into(), results: vec![], pages: vec![], cached: false, failures: vec![] }
    }

    #[test]
    fn cache_forgets_after_a_day_and_keeps_the_most_recent() {
        let (mut cache, now) = (Cache::default(), Instant::now());
        cache.put("excel pivot table".into(), now, search("excel pivot table"));
        assert_eq!(cache.get("excel pivot table", now + Duration::from_secs(60)).map(|s| s.query), Some("excel pivot table".into()));
        assert!(cache.get("excel pivot table", now + CACHE_TTL).is_none());
        for i in 0..=CACHE_ENTRIES {
            cache.put(format!("q{i}"), now, search("x"));
        }
        assert!(cache.get("q0", now).is_none());
        assert!(cache.get(&format!("q{CACHE_ENTRIES}"), now).is_some());
    }

    #[test]
    fn cooldowns_expire_and_never_shrink() {
        let (mut cooldowns, now) = (Cooldowns::default(), Instant::now());
        assert_eq!(cooldowns.remaining(SourceId::Exa, now), None);
        cooldowns.rest(SourceId::Exa, now, Duration::from_secs(900));
        cooldowns.rest(SourceId::Exa, now, Duration::from_secs(20));
        assert_eq!(cooldowns.remaining(SourceId::Exa, now + Duration::from_secs(100)), Some(Duration::from_secs(800)));
        assert_eq!(cooldowns.remaining(SourceId::Exa, now + Duration::from_secs(900)), None);
        assert_eq!(cooldowns.remaining(SourceId::DuckDuckGo, now), None);
    }
}
