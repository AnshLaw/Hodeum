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
use tauri::State;

use model::{app_name, Observation, RectDto};
use uia::UiaReader;

/// Logged so slow trees (large workbooks) show up during rehearsal.
const SLOW_SNAPSHOT_MS: u128 = 300;

struct Job {
    region: Option<RectDto>,
    reply: mpsc::Sender<Result<Observation, String>>,
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

fn observe_once(reader: &UiaReader, last_external: &AtomicIsize, region: Option<RectDto>) -> Result<Observation, String> {
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
    Ok(Observation { app: app_name(&stem), window_title: foreground::window_title(hwnd), elements, at: now_ms() })
}

#[tauri::command]
pub async fn observe(region: Option<RectDto>, state: State<'_, Perception>) -> Result<Observation, String> {
    let (reply, result) = mpsc::channel();
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .send(Job { region, reply })
        .map_err(|_| "The screen reader stopped.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || result.recv().map_err(|_| "The screen reader stopped.".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

/// Downscaled PNG of the learner's app, base64-encoded, for the local vision model (sub-project 3).
#[tauri::command]
pub async fn capture_active_window(state: State<'_, Perception>) -> Result<String, String> {
    let last_external = state.last_external.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let hwnd = foreground::target_window(&last_external)?;
        let png = capture::capture_png(hwnd.0 as isize)?;
        Ok(BASE64_STANDARD.encode(png))
    })
    .await
    .map_err(|e| e.to_string())?
}
