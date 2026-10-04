pub mod capture;
pub mod foreground;
pub mod input_hook;
pub mod model;
mod press;
mod uia;
pub mod window_watch;

use std::sync::atomic::AtomicIsize;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::prelude::{Engine, BASE64_STANDARD};
use tauri::{AppHandle, State};

use crate::apps::identity::identify_window;
use crate::dock::geometry::PxRect;
use crate::surfaces;

use model::{Observation, RectDto};
use press::{PressButton, PressRequest, Seen};
use uia::UiaReader;

/// Logged so slow trees (large workbooks) show up during rehearsal.
const SLOW_SNAPSHOT_MS: u128 = 300;

/// An observation plus the monitor the learner's app is on, so the overlay can follow it.
type Observed = (Observation, Option<PxRect>);

/// Work for the UI Automation thread: read the learner's app, or click a control in it.
enum Job {
    Observe { region: Option<RectDto>, reply: mpsc::Sender<Result<Observed, String>> },
    Press { request: PressRequest, reply: mpsc::Sender<Result<(), String>> },
}

/// UI Automation needs a COM (MTA) thread of its own; all reads are serialized through it.
pub struct Perception {
    jobs: Mutex<mpsc::Sender<Job>>,
    last_external: Arc<AtomicIsize>,
}

impl Perception {
    pub fn start() -> Self {
        let (jobs, receiver) = mpsc::channel::<Job>();
        let last_external = Arc::new(AtomicIsize::new(0));
        let worker_last = last_external.clone();
        thread::spawn(move || worker(receiver, worker_last));
        Self { jobs: Mutex::new(jobs), last_external }
    }

    /// Notes the learner's app before Hodeum's own window takes focus, so chat can look at it.
    pub fn remember_learner_window(&self) {
        // Err only means no app has had focus yet; there is nothing to remember then.
        if let Err(reason) = foreground::target_window(&self.last_external) {
            eprintln!("no learner app to remember: {reason}");
        }
    }

    /// Makes `hwnd` the learner's app even while Hodeum itself has focus.
    pub fn remember(&self, hwnd: isize) {
        self.last_external.store(hwnd, std::sync::atomic::Ordering::SeqCst);
    }

    /// Shared with the window watcher, which keeps it current as the learner switches apps.
    pub fn last_external(&self) -> Arc<AtomicIsize> {
        self.last_external.clone()
    }

    /// The learner's app: the foreground window, or the last one before Hodeum took focus.
    pub fn learner_window(&self) -> Result<isize, String> {
        foreground::target_window(&self.last_external).map(|hwnd| hwnd.0 as isize)
    }
}

fn worker(jobs: mpsc::Receiver<Job>, last_external: Arc<AtomicIsize>) {
    let reader = UiaReader::new().map_err(|e| format!("UI Automation is unavailable: {e}"));
    for job in jobs {
        let reader = reader.as_ref().map_err(Clone::clone);
        // The caller may have given up (window closed); dropping the result is correct then.
        match job {
            Job::Observe { region, reply } => {
                let _ = reply.send(reader.and_then(|r| observe_once(r, &last_external, region)));
            }
            Job::Press { request, reply } => {
                let _ = reply.send(reader.and_then(|r| r.press(&request, now_ms())));
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn observe_once(reader: &UiaReader, last_external: &AtomicIsize, region: Option<RectDto>) -> Result<Observed, String> {
    let started = Instant::now();
    let hwnd = foreground::target_window(last_external)?;
    let (elements, handles) = reader.read(hwnd.0 as isize, region)?;
    let elapsed = started.elapsed().as_millis();
    if elapsed > SLOW_SNAPSHOT_MS {
        eprintln!("UIA snapshot took {elapsed} ms for {} elements", elements.len());
    }
    let identity = identify_window(hwnd);
    let at = now_ms();
    reader.remember(Seen { at, pid: foreground::window_pid(hwnd), elements: handles });
    let window = window_watch::window_frame(hwnd).map(|frame| frame.with_identity(&identity));
    let app_id = (!identity.id.is_empty()).then(|| identity.id.clone());
    let observation = Observation { app: identity.name, window_title: foreground::window_title(hwnd), elements, at, window, app_id };
    Ok((observation, foreground::monitor_rect(hwnd)))
}

#[tauri::command]
pub async fn observe(app: AppHandle, region: Option<RectDto>, state: State<'_, Perception>) -> Result<Observation, String> {
    let (reply, result) = mpsc::channel();
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .send(Job::Observe { region, reply })
        .map_err(|_| "The screen reader stopped.".to_string())?;
    let (observation, monitor) = tauri::async_runtime::spawn_blocking(move || result.recv().map_err(|_| "The screen reader stopped.".to_string())?)
        .await
        .map_err(|e| e.to_string())??;
    if let Some(monitor) = monitor {
        // Guidance must be drawn on the screen the learner's app is on.
        if let Err(error) = surfaces::follow_monitor(&app, monitor) {
            eprintln!("couldn't move the overlay to the app's monitor: {error}");
        }
    }
    Ok(observation)
}

/// Only the notch runs Hodes, so only it may ask Hodey to click.
fn may_press(window_label: &str) -> bool {
    window_label == surfaces::NOTCH
}

/// Agent · Do it for me: clicks element `element_id` of screen read `observed_at` in the learner's app.
/// Refuses (with a message for the learner) for any other window, an older read, or a control that
/// changed, moved, left the learner's app or is covered.
#[tauri::command]
pub async fn perform_click(
    window: tauri::WebviewWindow,
    element_id: String,
    name: String,
    observed_at: u64,
    button: PressButton,
    state: State<'_, Perception>,
) -> Result<(), String> {
    if !may_press(window.label()) {
        return Err("Only Hodey's notch can click for the learner.".into());
    }
    let request = PressRequest { element_id, name, observed_at, button };
    let (reply, result) = mpsc::channel();
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .send(Job::Press { request, reply })
        .map_err(|_| "The screen reader stopped.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || result.recv().map_err(|_| "The screen reader stopped.".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

/// Mirrors `CapturedFrame` in `src/providers/vision/types.ts`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedFrame {
    /// Base64 image bytes of type `mime` (JPEG now), longest side at most 1280 px. Keeps its old name so
    /// existing readers work; build data URLs from `mime`.
    png: String,
    mime: &'static str,
    /// Where the captured window sits on screen, in physical px (to map model coordinates back).
    rect: RectDto,
    /// The window that was captured, so a reply can be checked against the window that was read.
    window_id: isize,
}

/// Downscaled capture for the local vision model, kept in memory only: window `window_id` (the one the
/// last observation read, so the picture matches the controls) or, without it, the learner's app now.
#[tauri::command]
pub async fn capture_active_window(window_id: Option<isize>, state: State<'_, Perception>) -> Result<CapturedFrame, String> {
    let hwnd = match window_id {
        Some(id) => capturable(id)?,
        None => state.learner_window()?,
    };
    tauri::async_runtime::spawn_blocking(move || capture_frame(hwnd)).await.map_err(|e| e.to_string())?
}

/// A window Hodey may look at: still open and not one of Hodeum's own.
pub fn capturable(hwnd: isize) -> Result<isize, String> {
    let handle = windows::Win32::Foundation::HWND(hwnd as *mut _);
    // SAFETY: IsWindow accepts any handle value.
    if !unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(handle)) }.as_bool() {
        return Err("The app window Hodey read has closed.".into());
    }
    if foreground::window_pid(handle) == std::process::id() {
        return Err("Hodey can't look at its own windows.".into());
    }
    Ok(hwnd)
}

/// One window, downscaled and base64-encoded in memory. Blocking.
pub fn capture_frame(hwnd: isize) -> Result<CapturedFrame, String> {
    let capture = capture::capture_jpeg(hwnd)?;
    Ok(CapturedFrame { png: BASE64_STANDARD.encode(capture.jpeg), mime: capture::CAPTURE_MIME, rect: capture.rect, window_id: hwnd })
}

#[cfg(test)]
mod tests {
    use super::{may_press, CapturedFrame, RectDto};

    #[test]
    fn captured_frames_name_their_window_and_image_type() {
        let frame = CapturedFrame { png: "AA==".into(), mime: "image/jpeg", rect: RectDto { x: 0.0, y: 0.0, width: 1.0, height: 1.0 }, window_id: 42 };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["windowId"], 42);
        assert_eq!(json["mime"], "image/jpeg");
        assert_eq!(json["png"], "AA==");
    }

    #[test]
    fn only_the_notch_may_click_for_the_learner() {
        assert!(may_press("main_notch"));
        assert!(!may_press("hodeum_app"));
        assert!(!may_press("guidance_overlay"));
    }
}
