//! Finds the voice model files that scripts/setup-local-ai.ps1 unpacks into models/voice/.

use std::fs;
use std::path::{Path, PathBuf};

const VOICE_DIR: &str = "models/voice";
const VAD_FILE: &str = "silero_vad.onnx";
const ASR_PACK: &str = "sherpa-onnx-nemotron";
const TTS_PACK: &str = "sherpa-onnx-supertonic";
const KOKORO_PACK: &str = "kokoro-multi-lang";
/// The backup speech engine's size. The PRD prefers small when latency allows; base is the default
/// because it stays quick on older laptop CPUs (about 4x less work per utterance than small).
pub const WHISPER_SIZE: &str = "base";
/// The multilingual pack, named exactly: "…-base.en" is English-only and can't hear Hindi.
const WHISPER_PACK: &str = "sherpa-onnx-whisper-";
pub const SETUP_HINT: &str = "Run scripts/setup-local-ai.ps1 to install Hodey's local voice.";

#[derive(Debug)]
pub struct AsrFiles {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
    pub tokens: PathBuf,
}

/// Multilingual Whisper (sherpa-onnx export), the backup speech engine.
#[derive(Debug)]
pub struct WhisperFiles {
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub tokens: PathBuf,
}

#[derive(Debug)]
pub struct TtsFiles {
    pub duration_predictor: PathBuf,
    pub text_encoder: PathBuf,
    pub vector_estimator: PathBuf,
    pub vocoder: PathBuf,
    pub tts_json: PathBuf,
    pub unicode_indexer: PathBuf,
    pub voice_style: PathBuf,
}

#[derive(Debug)]
pub struct KokoroFiles {
    pub model: PathBuf,
    pub voices: PathBuf,
    pub tokens: PathBuf,
    /// espeak-ng phoneme data, for words not in the lexicons.
    pub data_dir: PathBuf,
    pub dict_dir: PathBuf,
    /// Comma-separated lexicon files, as sherpa-onnx expects.
    pub lexicon: String,
}

pub fn voice_root() -> PathBuf {
    crate::vlm::local_ai_root().join(VOICE_DIR)
}

/// The first directory in `root` whose name starts with `prefix`.
fn pack_dir(root: &Path, prefix: &str) -> Result<PathBuf, String> {
    let entries = fs::read_dir(root).map_err(|_| SETUP_HINT.to_string())?;
    entries
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(prefix)))
        .ok_or_else(|| format!("{SETUP_HINT} Missing: {prefix}*"))
}

/// A file named `stem…ext` in `dir`, preferring the int8 build when both exist.
fn find(dir: &Path, stem: &str, ext: &str) -> Result<PathBuf, String> {
    let mut matches: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().is_some_and(|n| {
                let name = n.to_string_lossy();
                name.starts_with(stem) && name.ends_with(ext)
            })
        })
        .collect();
    matches.sort_by_key(|p| !p.to_string_lossy().contains("int8"));
    matches.into_iter().next().ok_or_else(|| format!("{SETUP_HINT} Missing: {}/{stem}*{ext}", dir.display()))
}

/// Silero VAD, shared by both speech engines.
pub fn vad_file(root: &Path) -> Result<PathBuf, String> {
    let vad = root.join(VAD_FILE);
    if vad.is_file() {
        Ok(vad)
    } else {
        Err(format!("{SETUP_HINT} Missing: {VAD_FILE}"))
    }
}

pub fn asr_files(root: &Path) -> Result<AsrFiles, String> {
    vad_file(root)?;
    let dir = pack_dir(root, ASR_PACK)?;
    Ok(AsrFiles {
        encoder: find(&dir, "encoder", ".onnx")?,
        decoder: find(&dir, "decoder", ".onnx")?,
        joiner: find(&dir, "joiner", ".onnx")?,
        tokens: find(&dir, "tokens", ".txt")?,
    })
}

pub fn whisper_files(root: &Path) -> Result<WhisperFiles, String> {
    let name = format!("{WHISPER_PACK}{WHISPER_SIZE}");
    let dir = root.join(&name);
    if !dir.is_dir() {
        return Err(format!("{SETUP_HINT} Missing: {name}"));
    }
    Ok(WhisperFiles {
        encoder: find(&dir, &format!("{WHISPER_SIZE}-encoder"), ".onnx")?,
        decoder: find(&dir, &format!("{WHISPER_SIZE}-decoder"), ".onnx")?,
        tokens: find(&dir, &format!("{WHISPER_SIZE}-tokens"), ".txt")?,
    })
}

/// Whether Hodey can hear: the voice activity detector plus Nemotron or Whisper. Err: Nemotron's
/// problem, since that's the engine the setup script installs first.
pub fn asr_installed(root: &Path) -> Result<(), String> {
    vad_file(root)?;
    match asr_files(root) {
        Ok(_) => Ok(()),
        Err(problem) => whisper_files(root).map(|_| ()).map_err(|_| problem),
    }
}

pub fn tts_files(root: &Path) -> Result<TtsFiles, String> {
    let dir = pack_dir(root, TTS_PACK)?;
    Ok(TtsFiles {
        duration_predictor: find(&dir, "duration_predictor", ".onnx")?,
        text_encoder: find(&dir, "text_encoder", ".onnx")?,
        vector_estimator: find(&dir, "vector_estimator", ".onnx")?,
        vocoder: find(&dir, "vocoder", ".onnx")?,
        tts_json: find(&dir, "tts", ".json")?,
        unicode_indexer: find(&dir, "unicode_indexer", ".bin")?,
        voice_style: find(&dir, "voice", ".bin")?,
    })
}

pub fn kokoro_files(root: &Path) -> Result<KokoroFiles, String> {
    let dir = pack_dir(root, KOKORO_PACK)?;
    let lexicons: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("lexicon") && n.to_string_lossy().ends_with(".txt")))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    Ok(KokoroFiles {
        model: find(&dir, "model", ".onnx")?,
        voices: find(&dir, "voices", ".bin")?,
        tokens: find(&dir, "tokens", ".txt")?,
        data_dir: dir.join("espeak-ng-data"),
        dict_dir: dir.join("dict"),
        lexicon: lexicons.join(","),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, names: &[&str]) {
        fs::create_dir_all(dir).unwrap();
        for name in names {
            fs::write(dir.join(name), b"").unwrap();
        }
    }

    #[test]
    fn finds_asr_files_preferring_int8() {
        let root = std::env::temp_dir().join(format!("hodeum-voice-test-{}", std::process::id()));
        touch(&root, &["silero_vad.onnx"]);
        touch(&root.join("sherpa-onnx-nemotron-x"), &["encoder.onnx", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]);
        let files = asr_files(&root).unwrap();
        assert!(files.encoder.ends_with("encoder.int8.onnx"));
        assert!(tts_files(&root).unwrap_err().contains("setup-local-ai"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_the_multilingual_whisper_files_preferring_int8() {
        let root = std::env::temp_dir().join(format!("hodeum-whisper-test-{}", std::process::id()));
        touch(&root, &["silero_vad.onnx"]);
        assert!(whisper_files(&root).unwrap_err().contains("setup-local-ai"));
        touch(&root.join("sherpa-onnx-whisper-base.en"), &["base.en-encoder.int8.onnx", "base.en-decoder.int8.onnx", "base.en-tokens.txt"]);
        assert!(whisper_files(&root).is_err(), "the English-only pack can't hear Hindi");
        let pack = root.join("sherpa-onnx-whisper-base");
        touch(&pack, &["base-encoder.onnx", "base-encoder.int8.onnx", "base-decoder.onnx", "base-decoder.int8.onnx", "base-tokens.txt"]);
        let files = whisper_files(&root).unwrap();
        assert!(files.encoder.ends_with("sherpa-onnx-whisper-base/base-encoder.int8.onnx"));
        assert!(files.decoder.ends_with("base-decoder.int8.onnx"));
        assert!(files.tokens.ends_with("base-tokens.txt"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn speech_recognition_is_installed_when_either_engine_is() {
        let root = std::env::temp_dir().join(format!("hodeum-any-asr-test-{}", std::process::id()));
        touch(&root, &["silero_vad.onnx"]);
        assert!(asr_installed(&root).unwrap_err().contains("setup-local-ai"));
        touch(&root.join("sherpa-onnx-whisper-base"), &["base-encoder.int8.onnx", "base-decoder.int8.onnx", "base-tokens.txt"]);
        assert!(asr_installed(&root).is_ok(), "Whisper alone is enough");
        fs::remove_file(root.join("silero_vad.onnx")).unwrap();
        assert!(asr_installed(&root).is_err(), "both engines need the voice activity detector");
        fs::remove_dir_all(&root).unwrap();
    }
}
