//! Who can answer a search, and why one couldn't, in words the learner can read.

use std::time::Duration;

/// Sources in the order Hodey asks them, plus the page reader (cooldowns only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SourceId {
    Tavily,
    ExaKeyed,
    Brave,
    Exa,
    DuckDuckGo,
    StackExchange,
    Jina,
}

const MINUTE: u64 = 60;
/// Exa's free hosted search answered 429 after about 9 calls in a few minutes.
const EXA_COOLDOWN: Duration = Duration::from_secs(15 * MINUTE);
/// DuckDuckGo served anomaly pages for about 10 minutes after 3 quick calls.
const DDG_COOLDOWN: Duration = Duration::from_secs(15 * MINUTE);
const KEYED_COOLDOWN: Duration = Duration::from_secs(10 * MINUTE);
const STACK_COOLDOWN: Duration = Duration::from_secs(60 * MINUTE);
/// Jina Reader allows 20 requests a minute without a key.
const JINA_COOLDOWN: Duration = Duration::from_secs(MINUTE);

impl SourceId {
    pub fn label(self) -> &'static str {
        match self {
            SourceId::Tavily => "Tavily",
            SourceId::ExaKeyed => "Exa",
            SourceId::Brave => "Brave Search",
            SourceId::Exa => "Exa (free)",
            SourceId::DuckDuckGo => "DuckDuckGo",
            SourceId::StackExchange => "Stack Exchange",
            SourceId::Jina => "Jina Reader",
        }
    }

    /// How long to leave the source alone after it says it's had enough.
    pub fn cooldown(self) -> Duration {
        match self {
            SourceId::Tavily | SourceId::ExaKeyed | SourceId::Brave => KEYED_COOLDOWN,
            SourceId::Exa => EXA_COOLDOWN,
            SourceId::DuckDuckGo => DDG_COOLDOWN,
            SourceId::StackExchange => STACK_COOLDOWN,
            SourceId::Jina => JINA_COOLDOWN,
        }
    }
}

/// `base` with `params` as its query string (reqwest's `query` needs a feature this crate doesn't use).
pub fn with_params(base: &str, params: &[(&str, &str)]) -> Result<reqwest::Url, SourceError> {
    reqwest::Url::parse_with_params(base, params).map_err(|e| SourceError::Parse(format!("bad address: {e}")))
}

/// A JSON POST body without reqwest's `json` feature.
pub fn json_body(request: reqwest::RequestBuilder, body: &serde_json::Value) -> reqwest::RequestBuilder {
    request.header("Content-Type", "application/json").body(body.to_string())
}

#[derive(Debug, Clone, PartialEq)]
pub enum SourceError {
    /// Still resting after an earlier limit; this long to go.
    CoolingDown(Duration),
    /// The source said to slow down; rest this long.
    RateLimited(Duration),
    /// An anti-bot page instead of results.
    Blocked,
    KeyRejected(u16),
    NoKey,
    Http(u16),
    Network(String),
    Parse(String),
    NothingRelevant,
    /// Still running when the search's time was up.
    TimedOut,
}

const HTTP_TOO_MANY: u16 = 429;
const HTTP_UNAUTHORIZED: u16 = 401;
const HTTP_FORBIDDEN: u16 = 403;
const HTTP_PAYMENT_REQUIRED: u16 = 402;

impl SourceError {
    /// What an unsuccessful HTTP status means for `id`.
    pub fn from_status(id: SourceId, status: u16) -> SourceError {
        match status {
            HTTP_TOO_MANY | HTTP_PAYMENT_REQUIRED => SourceError::RateLimited(id.cooldown()),
            HTTP_UNAUTHORIZED | HTTP_FORBIDDEN => SourceError::KeyRejected(status),
            _ => SourceError::Http(status),
        }
    }

    pub fn from_reqwest(error: &reqwest::Error) -> SourceError {
        if error.is_timeout() {
            SourceError::Network("timed out".into())
        } else if error.is_connect() {
            SourceError::Network("couldn't connect".into())
        } else {
            SourceError::Network(error.to_string())
        }
    }

    /// The rest this error asks for, if any.
    pub fn rest(&self) -> Option<Duration> {
        match self {
            SourceError::RateLimited(rest) => Some(*rest),
            _ => None,
        }
    }

    pub fn reason(&self) -> String {
        let minutes = |d: &Duration| d.as_secs().div_ceil(MINUTE).max(1);
        match self {
            SourceError::CoolingDown(left) => format!("resting ({} min left)", minutes(left)),
            SourceError::RateLimited(rest) => format!("rate-limited, resting {} min", minutes(rest)),
            SourceError::Blocked => "blocked automated searches".into(),
            SourceError::KeyRejected(status) => format!("refused the key ({status})"),
            SourceError::NoKey => "no key saved".into(),
            SourceError::Http(status) => format!("answered {status}"),
            SourceError::Network(why) => format!("unreachable ({why})"),
            SourceError::Parse(why) => format!("sent something unexpected ({why})"),
            SourceError::NothingRelevant => "nothing relevant".into(),
            SourceError::TimedOut => "no answer in time".into(),
        }
    }
}

/// One line per source that didn't answer, e.g. "DuckDuckGo: blocked automated searches".
pub fn failure(id: SourceId, error: &SourceError) -> String {
    format!("{}: {}", id.label(), error.reason())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_statuses_as_reasons() {
        assert_eq!(SourceError::from_status(SourceId::Exa, 429), SourceError::RateLimited(EXA_COOLDOWN));
        assert_eq!(SourceError::from_status(SourceId::Tavily, 401), SourceError::KeyRejected(401));
        assert_eq!(failure(SourceId::Exa, &SourceError::RateLimited(EXA_COOLDOWN)), "Exa (free): rate-limited, resting 15 min");
        assert_eq!(failure(SourceId::DuckDuckGo, &SourceError::CoolingDown(Duration::from_secs(20))), "DuckDuckGo: resting (1 min left)");
    }
}
