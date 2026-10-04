pub mod airplay;
pub mod hotspot;
pub mod ocr;
pub mod rtp;
mod sender;

use base64::prelude::{Engine, BASE64_STANDARD};
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// WinRT needs COM on this worker thread; a thread already in another apartment still works.
fn ensure_com() -> Result<(), String> {
    // SAFETY: called once per blocking worker thread before any WinRT use.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_err() && hr != RPC_E_CHANGED_MODE {
        return Err(format!("couldn't start Windows' COM: {hr:?}"));
    }
    Ok(())
}

/// OCR on one mirrored-iPhone frame (base64 PNG) for the phone teaching loop. Nothing is kept.
#[tauri::command]
pub async fn ocr_frame(png: String) -> Result<Vec<ocr::OcrSegment>, String> {
    let bytes = BASE64_STANDARD.decode(png).map_err(|e| format!("the phone frame isn't valid base64: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || ocr::recognize(&bytes)).await.map_err(|e| e.to_string())?
}
