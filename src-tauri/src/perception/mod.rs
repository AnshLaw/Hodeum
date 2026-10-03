pub mod capture;
pub mod foreground;
pub mod input_hook;
pub mod model;
mod uia;

use std::sync::atomic::AtomicIsize;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::prelude::{Engine, BASE64_STANDARD};
use tauri::{AppHandle, State};

use crate::dock::geometry::PxRect;
use crate::surfaces;

use model::{app_name, Observation, RectDto};
use uia::UiaReader;

/// Logged so slow trees (large workbooks) show up during rehearsal.
const SLOW_SNAPSHOT_MS: u128 = 300;

/// An observation plus the monitor the learner's app is on, so the overlay can follow it.
type Observed = (Observation, Option<PxRect>);

struct Job {
    region: Option<RectDto>,
    reply: mpsc::Sender<Result<Observed, String>>,
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

    /// The learner's app: the foreground window, or the last one before Hodeum took focus.
    pub fn learner_window(&self) -> Result<isize, String> {
        foreground::target_window(&self.last_external).map(|hwnd| hwnd.0 as isize)
    }
}

fn worker(jobs: mpsc::Receiver<Job>, last_external: Arc<AtomicIsize>) {
    let reader = UiaReader::new().map_err(|e| format!("UI Automation is unavailable: {e}"));
    for job in jobs {
        let result = reader.as_ref().map_err(Clone::clone).and_then(|r| observe_once(r, &last_external, job.region));
        // The caller may have given up (window closed); dropping the result is correct then.
        let _ = job.reply.send(result);
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn observe_once(reader: &UiaReader, last_external: &AtomicIsize, region: Option<RectDto>) -> Result<Observed, String> {
    let started = Instant::now();
    let hwnd = foreground::target_window(last_external)?;
    let elements = reader.read(hwnd.0 as isize, region)?;
    let elapsed = started.elapsed().as_millis();
    if elapsed > SLOW_SNAPSHOT_MS {
        eprintln!("UIA snapshot took {elapsed} ms for {} elements", elements.len());
    }
    let stem = foreground::exe_stem(hwnd).unwrap_or_else(|error| {
        eprintln!("couldn't read the app's process name: {error}");
        String::new()
    });
    let observation = Observation { app: app_name(&stem), window_title: foreground::window_title(hwnd), elements, at: now_ms() };
    Ok((observation, foreground::monitor_rect(hwnd)))
}

#[tauri::command]
pub async fn observe(app: AppHandle, region: Option<RectDto>, state: State<'_, Perception>) -> Result<Observation, String> {
    let (reply, result) = mpsc::channel();
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .send(Job { region, reply })
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

/// Mirrors `CapturedFrame` in `src/providers/vision/types.ts`.
#[derive(serde::Serialize)]
pub struct CapturedFrame {
    /// Base64 PNG, longest side at most 1280 px.
    png: String,
    /// Where the captured window sits on screen, in physical px (to map model coordinates back).
    rect: RectDto,
}

/// Downscaled capture of the learner's app for the local vision model. Kept in memory only.
#[tauri::command]
pub async fn capture_active_window(state: State<'_, Perception>) -> Result<CapturedFrame, String> {
    let hwnd = state.learner_window()?;
    tauri::async_runtime::spawn_blocking(move || capture_frame(hwnd)).await.map_err(|e| e.to_string())?
}

/// One window, downscaled and base64-encoded in memory. Blocking.
pub fn capture_frame(hwnd: isize) -> Result<CapturedFrame, String> {
    let capture = capture::capture_png(hwnd)?;
    Ok(CapturedFrame { png: BASE64_STANDARD.encode(capture.png), rect: capture.rect })
}
