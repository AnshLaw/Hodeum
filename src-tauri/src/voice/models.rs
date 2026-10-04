//! Finds the voice model files that scripts/setup-local-ai.ps1 unpacks into models/voice/.

use std::fs;
use std::path::{Path, PathBuf};

const VOICE_DIR: &str = "models/voice";
const VAD_FILE: &str = "silero_vad.onnx";
const ASR_PACK: &str = "sherpa-onnx-nemotron";
const TTS_PACK: &str = "sherpa-onnx-supertonic";
const KOKORO_PACK: &str = "kokoro-multi-lang";
pub const SETUP_HINT: &str = "Run scripts/setup-local-ai.ps1 to install Hodey's local voice.";

#[derive(Debug)]
pub struct AsrFiles {
    pub vad: PathBuf,
    pub encoder: PathBuf,
    pub decoder: PathBuf,
    pub joiner: PathBuf,
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

pub fn asr_files(root: &Path) -> Result<AsrFiles, String> {
    let vad = root.join(VAD_FILE);
    if !vad.is_file() {
        return Err(format!("{SETUP_HINT} Missing: {VAD_FILE}"));
    }
    let dir = pack_dir(root, ASR_PACK)?;
    Ok(AsrFiles {
        vad,
        encoder: find(&dir, "encoder", ".onnx")?,
        decoder: find(&dir, "decoder", ".onnx")?,
        joiner: find(&dir, "joiner", ".onnx")?,
        tokens: find(&dir, "tokens", ".txt")?,
    })
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
}
