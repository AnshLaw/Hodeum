//! Hodey's natural voices: Kokoro-82M (the most natural, preferred) and Supertonic, both on the CPU.
//! Picks the engine and speaker for a saved voice id like "kokoro:3" or "supertonic:2".

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Kokoro,
    Supertonic,
}

/// One choosable voice. Mirrors `NaturalVoice` in src/providers/speech/native-voice.ts.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VoiceOption {
    pub id: String,
    pub label: String,
}

/// Kokoro v1.0 speaker ids (k2-fsa sherpa-onnx `kokoro-multi-lang-v1_0`), a curated English set.
const KOKORO_VOICES: [(i32, &str); 12] = [
    (3, "Heart · American"),
    (2, "Bella · American"),
    (6, "Nicole · American"),
    (9, "Sarah · American"),
    (7, "Nova · American"),
    (16, "Michael · American"),
    (14, "Fenrir · American"),
    (18, "Puck · American"),
    (21, "Emma · British"),
    (23, "Lily · British"),
    (26, "George · British"),
    (25, "Fable · British"),
];
/// Kokoro's warmest voice; Hodey's default.
const KOKORO_DEFAULT: i32 = 3;
const SUPERTONIC_DEFAULT: i32 = 0;

/// Every voice the installed engines offer, Kokoro first.
pub fn catalog(kokoro: bool, supertonic_speakers: Option<i32>) -> Vec<VoiceOption> {
    let mut voices: Vec<VoiceOption> = Vec::new();
    if kokoro {
        voices.extend(KOKORO_VOICES.iter().map(|(sid, label)| VoiceOption { id: format!("kokoro:{sid}"), label: (*label).into() }));
    }
    if let Some(count) = supertonic_speakers {
        voices.extend((0..count).map(|sid| VoiceOption { id: format!("supertonic:{sid}"), label: format!("Supertonic {}", sid + 1) }));
    }
    voices
}

/// The engine and speaker for a saved voice id. "" (default), unknown ids, or an engine that isn't
/// installed fall back to Kokoro's default voice, then Supertonic's. Bare numbers are older Supertonic ids.
pub fn pick(voice: &str, kokoro: bool, supertonic: bool) -> Option<(Engine, i32)> {
    let requested = match voice.split_once(':') {
        Some(("kokoro", sid)) => sid.parse().ok().map(|sid| (Engine::Kokoro, sid)),
        Some(("supertonic", sid)) => sid.parse().ok().map(|sid| (Engine::Supertonic, sid)),
        None => voice.parse().ok().map(|sid| (Engine::Supertonic, sid)),
        _ => None,
    };
    let available = |engine: Engine| match engine {
        Engine::Kokoro => kokoro,
        Engine::Supertonic => supertonic,
    };
    match requested {
        Some((engine, sid)) if available(engine) => Some((engine, sid)),
        _ if kokoro => Some((Engine::Kokoro, KOKORO_DEFAULT)),
        _ if supertonic => Some((Engine::Supertonic, SUPERTONIC_DEFAULT)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_kokoros_heart_voice() {
        assert_eq!(pick("", true, true), Some((Engine::Kokoro, 3)));
        assert_eq!(pick("nonsense", true, false), Some((Engine::Kokoro, 3)));
    }

    #[test]
    fn honours_a_chosen_voice_when_its_engine_is_installed() {
        assert_eq!(pick("kokoro:26", true, true), Some((Engine::Kokoro, 26)));
        assert_eq!(pick("supertonic:4", true, true), Some((Engine::Supertonic, 4)));
        assert_eq!(pick("4", false, true), Some((Engine::Supertonic, 4)), "older saved ids");
        assert_eq!(pick("kokoro:26", false, true), Some((Engine::Supertonic, 0)), "Kokoro not installed");
        assert_eq!(pick("", false, false), None);
    }

    #[test]
    fn lists_kokoro_voices_first() {
        let voices = catalog(true, Some(2));
        assert_eq!(voices[0], VoiceOption { id: "kokoro:3".into(), label: "Heart · American".into() });
        assert_eq!(voices.last().map(|v| v.id.as_str()), Some("supertonic:1"));
        assert!(catalog(false, None).is_empty());
    }
}
