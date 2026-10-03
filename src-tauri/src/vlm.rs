use std::fs::File;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// The local vision model server (llama.cpp) listens only on loopback.
pub const VLM_HOST: &str = "127.0.0.1";
pub const VLM_PORT: u16 = 8737;
const SERVER_EXE: &str = "runtime/llama/llama-server.exe";
const MODEL_FILE: &str = "models/Qwen3VL-4B-Instruct-Q4_K_M.gguf";
const MMPROJ_FILE: &str = "models/mmproj-Qwen3VL-4B-Instruct-F16.gguf";
const LOG_FILE: &str = "runtime/llama-server.log";
const SETUP_HINT: &str = "Run scripts/setup-local-ai.ps1 to install the local vision model.";
/// Enough for one ~1280 px screenshot (~1k image tokens) plus the prompt and a short answer.
const CONTEXT_TOKENS: &str = "8192";
/// Offload every layer: the 4B Q4 model plus projector fits the 6 GB RTX 3060.
const GPU_LAYERS: &str = "99";
const MAX_RESTARTS: u32 = 3;
const READY_TIMEOUT: Duration = Duration::from_secs(180);
const POLL: Duration = Duration::from_millis(500);
const RESTART_BACKOFF: Duration = Duration::from_secs(3);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STATUS_EVENT: &str = "vlm:status";

/// Mirrors `VisionStatus` in `src/providers/vision/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum VlmStatus {
    Missing { detail: String },
    Starting,
    Ready { endpoint: String },
    Failed { detail: String },
}

pub struct Vlm {
    status: Mutex<VlmStatus>,
    child: Mutex<Option<Child>>,
}

impl Default for Vlm {
    fn default() -> Self {
        Self { status: Mutex::new(VlmStatus::Starting), child: Mutex::new(None) }
    }
}

impl Vlm {
    /// Stops the server (on app exit). The supervisor sees the empty slot and exits too.
    pub fn stop(&self) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(mut running) = child.take() {
            running.kill().map_err(|e| format!("couldn't stop llama-server: {e}"))?;
        }
        Ok(())
    }
}

/// Where `models/` and `runtime/` live: `HODEUM_LOCAL_AI_DIR`, else the repository root (dev builds).
pub fn local_ai_root() -> PathBuf {
    std::env::var_os("HODEUM_LOCAL_AI_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join(".."))
}

pub fn missing_files(root: &Path) -> Vec<&'static str> {
    [SERVER_EXE, MODEL_FILE, MMPROJ_FILE].into_iter().filter(|file| !root.join(file).exists()).collect()
}

pub fn server_args(root: &Path) -> Vec<String> {
    let path = |file: &str| root.join(file).to_string_lossy().into_owned();
    let port = VLM_PORT.to_string();
    let args = ["-m", &path(MODEL_FILE), "--mmproj", &path(MMPROJ_FILE), "--host", VLM_HOST, "--port", &port, "-ngl", GPU_LAYERS, "-c", CONTEXT_TOKENS];
    args.iter().map(|arg| arg.to_string()).collect()
}

fn set_status(app: &AppHandle, status: VlmStatus) {
    let vlm = app.state::<Vlm>();
    if let Ok(mut current) = vlm.status.lock() {
        *current = status.clone();
    }
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        eprintln!("failed to emit {STATUS_EVENT}: {error}");
    }
}

fn healthy() -> bool {
    let address = format!("{VLM_HOST}:{VLM_PORT}");
    let Ok(socket) = address.parse() else { return false };
    let Ok(mut stream) = TcpStream::connect_timeout(&socket, HEALTH_TIMEOUT) else { return false };
    let _ = stream.set_read_timeout(Some(HEALTH_TIMEOUT));
    let request = format!("GET /health HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.1 200")
}

fn start_server(root: &Path) -> Result<Child, String> {
    let log = File::create(root.join(LOG_FILE)).map_err(|e| format!("couldn't create {LOG_FILE}: {e}"))?;
    let errors = log.try_clone().map_err(|e| e.to_string())?;
    Command::new(root.join(SERVER_EXE))
        .args(server_args(root))
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("couldn't start llama-server: {e}"))
}

enum RunEnd {
    Stopped,
    Exited(String),
}

/// Waits for the model to load, then watches the process until it exits or is stopped.
fn run_once(app: &AppHandle, root: &Path) -> Result<RunEnd, String> {
    let child = start_server(root)?;
    let vlm = app.state::<Vlm>();
    *vlm.child.lock().map_err(|e| e.to_string())? = Some(child);
    let started = Instant::now();
    let mut ready = false;
    loop {
        thread::sleep(POLL);
        let mut slot = vlm.child.lock().map_err(|e| e.to_string())?;
        let Some(child) = slot.as_mut() else { return Ok(RunEnd::Stopped) };
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            slot.take();
            return Ok(RunEnd::Exited(format!("llama-server exited ({status}); see {LOG_FILE}")));
        }
        drop(slot);
        if !ready && healthy() {
            ready = true;
            set_status(app, VlmStatus::Ready { endpoint: format!("http://{VLM_HOST}:{VLM_PORT}") });
        } else if !ready && started.elapsed() > READY_TIMEOUT {
            vlm.stop()?;
            return Ok(RunEnd::Exited(format!("the model didn't load within {}s; see {LOG_FILE}", READY_TIMEOUT.as_secs())));
        }
    }
}

fn supervise(app: AppHandle) {
    let root = local_ai_root();
    let missing = missing_files(&root);
    if !missing.is_empty() {
        return set_status(&app, VlmStatus::Missing { detail: format!("{SETUP_HINT} Missing: {}", missing.join(", ")) });
    }
    let mut last_error = String::new();
    for attempt in 0..=MAX_RESTARTS {
        set_status(&app, VlmStatus::Starting);
        match run_once(&app, &root) {
            Ok(RunEnd::Stopped) => return,
            Ok(RunEnd::Exited(reason)) | Err(reason) => {
                eprintln!("local vision model: {reason} (attempt {})", attempt + 1);
                last_error = reason;
            }
        }
        thread::sleep(RESTART_BACKOFF * (attempt + 1));
    }
    set_status(&app, VlmStatus::Failed { detail: last_error });
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || supervise(app));
}

#[tauri::command]
pub fn vlm_status(state: State<'_, Vlm>) -> Result<VlmStatus, String> {
    state.status.lock().map(|status| status.clone()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_every_missing_file_for_an_empty_root() {
        let root = Path::new("Z:/definitely/not/here");
        assert_eq!(missing_files(root), vec![SERVER_EXE, MODEL_FILE, MMPROJ_FILE]);
    }

    #[test]
    fn binds_loopback_only_and_offloads_to_gpu() {
        let args = server_args(Path::new("C:/hodeum"));
        let value = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].clone());
        assert_eq!(value("--host").as_deref(), Some("127.0.0.1"));
        assert_eq!(value("--port").as_deref(), Some("8737"));
        assert_eq!(value("-ngl").as_deref(), Some("99"));
        assert!(value("--mmproj").unwrap().ends_with("mmproj-Qwen3VL-4B-Instruct-F16.gguf"));
    }

    #[test]
    fn status_serializes_with_a_state_tag() {
        let json = serde_json::to_string(&VlmStatus::Ready { endpoint: "http://127.0.0.1:8737".into() }).unwrap();
        assert_eq!(json, r#"{"state":"ready","endpoint":"http://127.0.0.1:8737"}"#);
    }
}
