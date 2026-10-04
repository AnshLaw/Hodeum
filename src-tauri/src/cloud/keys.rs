//! Cloud API keys in Windows Credential Manager (`Hodeum/<provider>`). Dev builds also read
//! `GEMINI_API_KEY` / `ELEVENLABS_API_KEY` / `BACKBOARD_API_KEY` from the environment.

use serde::Serialize;

const SERVICE: &str = "Hodeum";
/// Must match `CLOUD_PROVIDERS` in src/data/settings.ts.
const PROVIDERS: [(&str, &str); 3] = [("gemini", "GEMINI_API_KEY"), ("elevenlabs", "ELEVENLABS_API_KEY"), ("backboard", "BACKBOARD_API_KEY")];
/// Longer than any real key; stops a paste of something else entirely.
const MAX_KEY_CHARS: usize = 512;

#[derive(Serialize, Debug, PartialEq)]
pub struct KeyStatus {
    gemini: bool,
    elevenlabs: bool,
    backboard: bool,
}

fn env_name(provider: &str) -> Result<&'static str, String> {
    PROVIDERS.iter().find(|(name, _)| *name == provider).map(|(_, env)| *env).ok_or_else(|| format!("unknown cloud provider \"{provider}\""))
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    env_name(provider)?;
    keyring::Entry::new(SERVICE, provider).map_err(|e| format!("couldn't open the credential store for {provider}: {e}"))
}

fn stored(provider: &str) -> Option<String> {
    let entry = match entry(provider) {
        Ok(entry) => entry,
        Err(error) => {
            eprintln!("{error}");
            return None;
        }
    };
    match entry.get_password() {
        Ok(key) => Some(key),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => {
            eprintln!("reading the {provider} key failed: {error}");
            None
        }
    }
}

/// The saved key wins; dev builds fall back to the environment. Blank values count as missing.
fn resolve(stored: Option<String>, env: Option<String>, dev: bool) -> Option<String> {
    let clean = |v: Option<String>| v.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    clean(stored).or_else(|| if dev { clean(env) } else { None })
}

/// The key for `provider`, for the cloud adapters in this module only.
pub fn read(provider: &str) -> Option<String> {
    let env = env_name(provider).ok().and_then(|name| std::env::var(name).ok());
    resolve(stored(provider), env, cfg!(debug_assertions))
}

fn validate_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() || key.chars().count() > MAX_KEY_CHARS || key.chars().any(char::is_whitespace) {
        return Err("That doesn't look like an API key.".into());
    }
    Ok(key)
}

#[tauri::command]
pub fn cloud_key_status() -> KeyStatus {
    KeyStatus { gemini: read("gemini").is_some(), elevenlabs: read("elevenlabs").is_some(), backboard: read("backboard").is_some() }
}

#[tauri::command]
pub fn cloud_key_set(provider: String, key: String) -> Result<(), String> {
    let key = validate_key(&key)?;
    entry(&provider)?.set_password(key).map_err(|e| format!("couldn't save the {provider} key: {e}"))
}

#[tauri::command]
pub fn cloud_key_clear(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("couldn't remove the {provider} key: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_known_providers() {
        assert_eq!(env_name("gemini"), Ok("GEMINI_API_KEY"));
        assert!(env_name("openai").is_err());
        assert!(entry("../evil").is_err());
    }

    #[test]
    fn saved_key_wins_and_env_is_dev_only() {
        assert_eq!(resolve(Some("saved".into()), Some("env".into()), true), Some("saved".into()));
        assert_eq!(resolve(None, Some(" env ".into()), true), Some("env".into()));
        assert_eq!(resolve(None, Some("env".into()), false), None);
        assert_eq!(resolve(Some("  ".into()), None, true), None);
    }

    #[test]
    fn rejects_things_that_are_not_keys() {
        assert_eq!(validate_key("  AIza123  "), Ok("AIza123"));
        assert!(validate_key("").is_err());
        assert!(validate_key("two words").is_err());
        assert!(validate_key(&"x".repeat(MAX_KEY_CHARS + 1)).is_err());
    }
}
