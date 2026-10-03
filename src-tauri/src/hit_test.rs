use std::{sync::Mutex, thread, time::Duration};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::surfaces::NOTCH;

const POLL_INTERVAL: Duration = Duration::from_millis(33);
const ERROR_BACKOFF: Duration = Duration::from_secs(1);
const HOVER_EVENT: &str = "notch:hover";

/// The notch pill's box in logical (CSS) pixels, relative to the notch window.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl HitRect {
    /// `px`/`py` are physical pixels relative to the window's client origin.
    pub fn contains(&self, px: f64, py: f64, scale: f64) -> bool {
        let (left, top) = (self.x * scale, self.y * scale);
        let (right, bottom) = (left + self.width * scale, top + self.height * scale);
        px >= left && px <= right && py >= top && py <= bottom
    }
}

#[derive(Default)]
pub struct NotchHitRect(Mutex<HitRect>);

impl NotchHitRect {
    pub fn set(&self, rect: HitRect) -> Result<(), String> {
        *self.0.lock().map_err(|e| e.to_string())? = rect;
        Ok(())
    }

    fn get(&self) -> Result<HitRect, String> {
        self.0.lock().map(|rect| *rect).map_err(|e| e.to_string())
    }
}

fn cursor_inside_pill(app: &AppHandle) -> Result<bool, String> {
    let notch = app
        .get_webview_window(NOTCH)
        .ok_or_else(|| "notch window is missing".to_string())?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let origin = notch.inner_position().map_err(|e| e.to_string())?;
    let scale = notch.scale_factor().map_err(|e| e.to_string())?;
    let rect = app.state::<NotchHitRect>().get()?;
    Ok(rect.contains(cursor.x - f64::from(origin.x), cursor.y - f64::from(origin.y), scale))
}

fn apply(app: &AppHandle, inside: bool) -> Result<(), String> {
    let notch = app
        .get_webview_window(NOTCH)
        .ok_or_else(|| "notch window is missing".to_string())?;
    notch
        .set_ignore_cursor_events(!inside)
        .map_err(|e| e.to_string())?;
    app.emit(HOVER_EVENT, inside).map_err(|e| e.to_string())
}

/// The notch window is larger than the pill; this makes everything outside the pill click-through.
pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut interactive = false;
        loop {
            thread::sleep(POLL_INTERVAL);
            let result = cursor_inside_pill(&app).and_then(|inside| {
                if inside != interactive {
                    apply(&app, inside)?;
                    interactive = inside;
                }
                Ok(())
            });
            if let Err(error) = result {
                eprintln!("notch hit-test failed: {error}");
                thread::sleep(ERROR_BACKOFF);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::HitRect;

    #[test]
    fn scales_the_logical_rect_to_physical_pixels() {
        let rect = HitRect { x: 100.0, y: 0.0, width: 200.0, height: 40.0 };
        assert!(rect.contains(150.0, 10.0, 1.0));
        assert!(rect.contains(374.0, 49.0, 1.25));
        assert!(!rect.contains(380.0, 10.0, 1.25));
        assert!(!rect.contains(150.0, 51.0, 1.25));
    }
}
