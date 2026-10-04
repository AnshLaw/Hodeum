//! Keeps Gemini calls inside the learner's quota: a client-side requests-per-minute window per model,
//! a pause after a 429 for as long as Google asks, the jittered 503 retry delay, and the models
//! Google said don't exist. Pure logic with an injected clock; gemini.rs does the I/O.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use serde_json::Value;

/// Free-tier requests per minute (AI Studio rate limits, 2026-10-04): Flash-Lite 15, Flash 5.
const LITE_RPM: usize = 15;
const FLASH_RPM: usize = 5;
const LITE_MARKER: &str = "flash-lite";
const WINDOW: Duration = Duration::from_secs(60);
/// A 429 that doesn't say how long to wait pauses Gemini this long.
const DEFAULT_PAUSE: Duration = Duration::from_secs(60);
/// A daily-quota 429 can ask for hours; re-check after this so a reset is noticed in-session.
const MAX_PAUSE: Duration = Duration::from_secs(60 * 60);
const RETRY_INFO_TYPE: &str = "type.googleapis.com/google.rpc.RetryInfo";
const BACKOFF_BASE_MS: u64 = 400;
const BACKOFF_JITTER_MS: u32 = 600;

/// Unknown models get Flash's lower limit.
pub fn rpm_limit(model: &str) -> usize {
    if model.contains(LITE_MARKER) {
        LITE_RPM
    } else {
        FLASH_RPM
    }
}

/// How long Google asked us to wait: `RetryInfo.retryDelay` ("37s", "1.5s") in the error body,
/// else a `Retry-After` header in seconds.
pub fn retry_delay(body: &str, retry_after: Option<&str>) -> Option<Duration> {
    let from_body = serde_json::from_str::<Value>(body).ok().and_then(|error| {
        let details = error.pointer("/error/details")?.as_array()?;
        let info = details.iter().find(|detail| detail.get("@type").and_then(Value::as_str) == Some(RETRY_INFO_TYPE))?;
        info.get("retryDelay")?.as_str()?.strip_suffix('s')?.parse::<f64>().ok()
    });
    let seconds = from_body.or_else(|| retry_after?.trim().parse::<f64>().ok())?;
    (seconds.is_finite() && seconds >= 0.0).then(|| Duration::from_secs_f64(seconds))
}

/// 400–1000 ms from any changing number (the clock's nanoseconds), so retries don't land in step.
pub fn backoff(entropy: u32) -> Duration {
    Duration::from_millis(BACKOFF_BASE_MS + u64::from(entropy % BACKOFF_JITTER_MS))
}

#[derive(Default)]
pub struct Guard {
    sent: HashMap<String, VecDeque<Instant>>,
    paused_until: Option<Instant>,
    unavailable: HashSet<String>,
    listed: Option<HashSet<String>>,
}

impl Guard {
    /// Counts one request to `model` if the pause and its RPM window allow it; otherwise says why not.
    pub fn admit(&mut self, model: &str, now: Instant) -> Result<(), String> {
        if let Some(until) = self.paused_until.filter(|until| *until > now) {
            return Err(format!("Gemini asked to wait (rate limit); local reasoning for {}s more", (until - now).as_secs_f64().ceil()));
        }
        let sent = self.sent.entry(model.to_string()).or_default();
        while sent.front().is_some_and(|at| now.duration_since(*at) >= WINDOW) {
            sent.pop_front();
        }
        let limit = rpm_limit(model);
        if sent.len() >= limit {
            return Err(format!("{model} already had its {limit} requests this minute; local reasoning until it frees up"));
        }
        sent.push_back(now);
        Ok(())
    }

    /// After a 429: no Gemini request until Google's delay (capped) has passed. Returns the pause.
    pub fn pause(&mut self, now: Instant, asked: Option<Duration>) -> Duration {
        let wait = asked.unwrap_or(DEFAULT_PAUSE).min(MAX_PAUSE);
        self.paused_until = Some(now + wait);
        wait
    }

    /// The ids `ListModels` offers for generateContent; until then every id is given a chance.
    pub fn set_listed(&mut self, ids: HashSet<String>) {
        self.listed = Some(ids);
    }

    pub fn needs_list(&self) -> bool {
        self.listed.is_none()
    }

    /// A 404 for this id: stop sending it for the rest of the session.
    pub fn mark_unavailable(&mut self, model: &str) {
        self.unavailable.insert(model.to_string());
    }

    /// The chosen model, unless Google doesn't list it or answered 404 for it: then the default.
    pub fn usable(&self, chosen: &str, default: &str) -> String {
        let missing = self.unavailable.contains(chosen) || self.listed.as_ref().is_some_and(|ids| !ids.contains(chosen));
        if missing { default } else { chosen }.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LITE: &str = "gemini-3.5-flash-lite";
    const FLASH: &str = "gemini-3.8-flash";

    #[test]
    fn flash_lite_gets_15_a_minute_and_everything_else_5() {
        assert_eq!(rpm_limit(LITE), LITE_RPM);
        assert_eq!(rpm_limit(FLASH), FLASH_RPM);
        assert_eq!(rpm_limit("gemini-9-unknown"), FLASH_RPM);
    }

    #[test]
    fn never_sends_more_than_the_rpm_in_any_minute() {
        let (mut guard, start) = (Guard::default(), Instant::now());
        for i in 0..FLASH_RPM {
            assert!(guard.admit(FLASH, start + Duration::from_secs(i as u64)).is_ok());
        }
        assert!(guard.admit(FLASH, start + Duration::from_secs(30)).is_err());
        assert!(guard.admit(LITE, start + Duration::from_secs(30)).is_ok(), "each model has its own window");
        assert!(guard.admit(FLASH, start + WINDOW).is_ok(), "the first request left the window");
        assert!(guard.admit(FLASH, start + WINDOW).is_err());
    }

    #[test]
    fn a_rate_limit_pauses_every_request_until_the_delay_passes() {
        let (mut guard, now) = (Guard::default(), Instant::now());
        assert_eq!(guard.pause(now, Some(Duration::from_secs(37))), Duration::from_secs(37));
        assert!(guard.admit(LITE, now + Duration::from_secs(36)).unwrap_err().contains("1s more"));
        assert!(guard.admit(LITE, now + Duration::from_secs(37)).is_ok());
        assert_eq!(guard.pause(now, None), DEFAULT_PAUSE);
        assert_eq!(guard.pause(now, Some(Duration::from_secs(86_400))), MAX_PAUSE);
    }

    #[test]
    fn reads_googles_retry_delay_then_retry_after() {
        let body = r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[
            {"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[]},
            {"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37.5s"}]}}"#;
        assert_eq!(retry_delay(body, Some("5")), Some(Duration::from_millis(37_500)));
        assert_eq!(retry_delay(r#"{"error":{"code":429}}"#, Some(" 12 ")), Some(Duration::from_secs(12)));
        assert_eq!(retry_delay("not json", None), None);
        assert_eq!(retry_delay("{}", Some("Wed, 21 Oct 2026 07:28:00 GMT")), None);
        assert_eq!(retry_delay("{}", Some("-3")), None);
    }

    #[test]
    fn backoff_is_jittered_between_400_ms_and_a_second() {
        assert_eq!(backoff(0), Duration::from_millis(BACKOFF_BASE_MS));
        assert!(backoff(u32::MAX) < Duration::from_millis(BACKOFF_BASE_MS + u64::from(BACKOFF_JITTER_MS)));
        assert_ne!(backoff(1), backoff(2));
    }

    #[test]
    fn falls_back_to_the_default_for_models_google_doesnt_have() {
        let mut guard = Guard::default();
        assert!(guard.needs_list());
        assert_eq!(guard.usable("gemini-made-up", LITE), "gemini-made-up", "unchecked until the list arrives");
        guard.set_listed([LITE, FLASH].map(String::from).into());
        assert!(!guard.needs_list());
        assert_eq!(guard.usable(FLASH, LITE), FLASH);
        assert_eq!(guard.usable("gemini-made-up", LITE), LITE);
        guard.mark_unavailable(FLASH);
        assert_eq!(guard.usable(FLASH, LITE), LITE, "listed but answered 404 (e.g. retired for new users)");
    }
}
