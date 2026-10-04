pub mod ocr;
pub mod rtp;

use base64::prelude::{Engine, BASE64_STANDARD};

/// OCR on one mirrored-iPhone frame (base64 PNG) for the phone teaching loop. Nothing is kept.
#[tauri::command]
pub async fn ocr_frame(png: String) -> Result<Vec<ocr::OcrSegment>, String> {
    let bytes = BASE64_STANDARD.decode(png).map_err(|e| format!("the phone frame isn't valid base64: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || ocr::recognize(&bytes)).await.map_err(|e| e.to_string())?
}
