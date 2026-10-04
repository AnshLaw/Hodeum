//! Dev builds only: `.env.local` at the repo root as a fallback for the process environment.
//! `tauri dev` doesn't load that file and Vite hands only `VITE_*` values to the webview, so without
//! this the cloud keys a developer pasted there never reach the adapters. Values are never logged.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::sync::OnceLock;

const ENV_FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../.env.local");
const EXPORT_PREFIX: &str = "export ";

/// `NAME=value` lines. Blank lines, `#` comments and lines without `=` are skipped; one pair of
/// matching quotes around a value is removed.
pub fn parse(text: &str) -> HashMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.strip_prefix(EXPORT_PREFIX).unwrap_or(line).split_once('='))
        .map(|(name, value)| (name.trim().to_string(), unquote(value.trim()).to_string()))
        .filter(|(name, _)| !name.is_empty())
        .collect()
}

fn unquote(value: &str) -> &str {
    ['"', '\''].iter().find_map(|&quote| value.strip_prefix(quote).and_then(|v| v.strip_suffix(quote))).unwrap_or(value)
}

fn file() -> &'static HashMap<String, String> {
    static FILE: OnceLock<HashMap<String, String>> = OnceLock::new();
    FILE.get_or_init(|| match std::fs::read_to_string(ENV_FILE) {
        Ok(text) => parse(&text),
        Err(e) if e.kind() == ErrorKind::NotFound => HashMap::new(),
        Err(e) => {
            eprintln!("couldn't read .env.local: {e}");
            HashMap::new()
        }
    })
}

/// The process environment, then (dev builds only) `.env.local`.
pub fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().or_else(|| if cfg!(debug_assertions) { file().get(name).cloned() } else { None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_names_and_values() {
        let parsed = parse("GEMINI_API_KEY=AIza-abc_123\r\nELEVENLABS_API_KEY = sk_456 \n");
        assert_eq!(parsed.get("GEMINI_API_KEY").map(String::as_str), Some("AIza-abc_123"));
        assert_eq!(parsed.get("ELEVENLABS_API_KEY").map(String::as_str), Some("sk_456"));
    }

    #[test]
    fn skips_comments_blanks_and_lines_without_a_value() {
        let parsed = parse("# keys\n\n   \nJUST_A_WORD\n=orphan\nA=1\n");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed.get("A").map(String::as_str), Some("1"));
    }

    #[test]
    fn keeps_equals_signs_inside_a_value_and_strips_quotes() {
        let parsed = parse("PADDED=abc==\nDOUBLE=\"quoted value\"\nSINGLE='x'\nexport EXPORTED=y\nLONE=\"\n");
        assert_eq!(parsed.get("PADDED").map(String::as_str), Some("abc=="));
        assert_eq!(parsed.get("DOUBLE").map(String::as_str), Some("quoted value"));
        assert_eq!(parsed.get("SINGLE").map(String::as_str), Some("x"));
        assert_eq!(parsed.get("EXPORTED").map(String::as_str), Some("y"));
        assert_eq!(parsed.get("LONE").map(String::as_str), Some("\""));
    }
}
