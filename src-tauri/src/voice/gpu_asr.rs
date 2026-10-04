//! The GPU's speech engine: a whisper.cpp CUDA server (runtime/whisper) on loopback, used only for
//! the second listen of each finished utterance (refine.rs). Nemotron stays the streaming engine on
//! the CPU. The vision model owns the GPU first: this starts only once the vision model has settled,
//! only when enough video memory is free, and steps aside whenever the vision model restarts.

use std::fs::File;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use windows::core::Interface;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter3, IDXGIFactory1, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, DXGI_QUERY_VIDEO_MEMORY_INFO};

use super::refine::{self, GpuServer};
use super::set_refine;
use crate::child_job::ChildJob;
use crate::vlm::{local_ai_root, vlm_status, Vlm, VlmStatus};

const SERVER_EXE: &str = "runtime/whisper/whisper-server.exe";
const LOG_FILE: &str = "runtime/whisper-server.log";
const MODEL_DIR: &str = "models/voice";
/// whisper.cpp ships no CUDA runtime of its own here: it uses llama.cpp's (hard-linked by the setup
/// script; this folder on PATH covers a copy without the links).
const CUDA_RUNTIME_DIR: &str = "runtime/llama";
const HOST: &str = "127.0.0.1";
const THREADS: &str = "4";
const NO_SPEECH_THRESHOLD: &str = "0.6";
const MIB: u64 = 1024 * 1024;
/// Free video memory each model needs: its measured use (turbo estimated) plus ~300 MiB of headroom
/// for the vision model's peaks.
const TURBO_MIN_FREE_MIB: u64 = 1250;
const SMALL_MIN_FREE_MIB: u64 = 850;
const BASE_MIN_FREE_MIB: u64 = 600;
/// How often the vision model's state is checked while waiting for it, and while running.
const VLM_POLL: Duration = Duration::from_secs(2);
const READY_POLL: Duration = Duration::from_millis(300);
const READY_TIMEOUT: Duration = Duration::from_secs(60);
const HEALTH_TIMEOUT: Duration = Duration::from_millis(500);
/// Second listens failing in a row before the server is restarted with the next smaller model.
const MAX_FAILURES_IN_A_ROW: u32 = 3;
/// Tries per app launch (the first model, then one step down); after that the GPU hearing stays off.
const MAX_STARTS: u32 = 2;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static JOB: LazyLock<ChildJob> = LazyLock::new(ChildJob::default);

/// A Whisper model the GPU server can run, largest first.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum GpuModel {
    Turbo,
    Small,
    Base,
}

const MODELS: [GpuModel; 3] = [GpuModel::Turbo, GpuModel::Small, GpuModel::Base];

impl GpuModel {
    pub(crate) fn file(self) -> &'static str {
        match self {
            GpuModel::Turbo => "ggml-large-v3-turbo-q5_0.bin",
            GpuModel::Small => "ggml-small-q5_1.bin",
            GpuModel::Base => "ggml-base-q5_1.bin",
        }
    }

    /// What the voice status reports while it runs.
    pub(crate) fn id(self) -> &'static str {
        match self {
            GpuModel::Turbo => "whisper-turbo-gpu",
            GpuModel::Small => "whisper-small-gpu",
            GpuModel::Base => "whisper-base-gpu",
        }
    }

    fn min_free_mib(self) -> u64 {
        match self {
            GpuModel::Turbo => TURBO_MIN_FREE_MIB,
            GpuModel::Small => SMALL_MIN_FREE_MIB,
            GpuModel::Base => BASE_MIN_FREE_MIB,
        }
    }
}

/// The largest installed model that fits in `free_mib` of video memory; None: the GPU is too full.
pub(crate) fn pick_model(free_mib: u64, installed: impl Fn(GpuModel) -> bool) -> Option<GpuModel> {
    MODELS.into_iter().find(|&model| free_mib >= model.min_free_mib() && installed(model))
}

/// The next model down from `model` that is installed.
fn smaller(model: GpuModel, installed: impl Fn(GpuModel) -> bool) -> Option<GpuModel> {
    MODELS.into_iter().skip_while(|&m| m != model).skip(1).find(|&m| installed(m))
}

fn model_path(root: &Path, model: GpuModel) -> PathBuf {
    root.join(MODEL_DIR).join(model.file())
}

pub(crate) fn server_args(root: &Path, model: GpuModel, port: u16) -> Vec<String> {
    let model = model_path(root, model).to_string_lossy().into_owned();
    let port = port.to_string();
    // -nt: no timestamps; -fa: flash attention; -nth: Whisper's own "no speech" cut-off.
    let args = ["-m", &model, "--host", HOST, "--port", &port, "-l", "en", "-t", THREADS, "-nt", "-fa", "-nth", NO_SPEECH_THRESHOLD];
    args.iter().map(|arg| arg.to_string()).collect()
}

/// Free memory on the GPU with the most dedicated memory (the discrete one on a laptop), from DXGI.
pub(crate) fn free_vram_mib() -> Result<u64, String> {
    // SAFETY: plain DXGI queries on objects created and dropped here.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|e| format!("DXGI didn't start: {e}"))?;
        let mut best = None;
        for index in 0.. {
            let Ok(adapter) = factory.EnumAdapters1(index) else { break };
            let dedicated = adapter.GetDesc1().map_err(|e| e.to_string())?.DedicatedVideoMemory;
            if best.as_ref().is_none_or(|(size, _)| dedicated > *size) {
                best = Some((dedicated, adapter));
            }
        }
        let (_, adapter) = best.ok_or("no graphics adapter found")?;
        let adapter: IDXGIAdapter3 = adapter.cast().map_err(|e| format!("this GPU can't report its memory: {e}"))?;
        let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
        adapter.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info).map_err(|e| e.to_string())?;
        Ok(info.Budget.saturating_sub(info.CurrentUsage) / MIB)
    }
}

/// Free memory as the NVIDIA driver reports it, across every process (DXGI's figure is this
/// process's budget). None when nvidia-smi isn't there or says something unexpected.
fn nvidia_free_mib() -> Option<u64> {
    let output = Command::new("nvidia-smi").args(["--query-gpu=memory.free", "--format=csv,noheader,nounits"]).creation_flags(CREATE_NO_WINDOW).output();
    let output = output.inspect_err(|e| eprintln!("nvidia-smi didn't run: {e}")).ok()?;
    String::from_utf8_lossy(&output.stdout).lines().next()?.trim().parse().ok()
}

/// The free video memory to plan with: the smaller of the two readings when both exist.
fn free_mib() -> Result<u64, String> {
    let dxgi = free_vram_mib();
    match (dxgi, nvidia_free_mib()) {
        (Ok(dxgi), Some(nvidia)) => Ok(dxgi.min(nvidia)),
        (Ok(dxgi), None) => Ok(dxgi),
        (Err(_), Some(nvidia)) => Ok(nvidia),
        (Err(reason), None) => Err(reason),
    }
}

/// Whether the vision model is still loading (or reloading): it gets the GPU first.
fn vlm_busy(app: &AppHandle) -> bool {
    matches!(vlm_status(app.state::<Vlm>()), Ok(VlmStatus::Starting))
}

/// An unused loopback port. The server's own pid is checked against it once it's up.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind((HOST, 0)).map_err(|e| format!("no free port for the GPU hearing server: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

fn spawn_server(root: &Path, model: GpuModel, port: u16) -> Result<Child, String> {
    let log = File::create(root.join(LOG_FILE)).map_err(|e| format!("couldn't create {LOG_FILE}: {e}"))?;
    let errors = log.try_clone().map_err(|e| e.to_string())?;
    let path = format!("{};{}", root.join(CUDA_RUNTIME_DIR).display(), std::env::var("PATH").unwrap_or_default());
    let child = Command::new(root.join(SERVER_EXE))
        .args(server_args(root, model, port))
        .env("PATH", path)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("couldn't start whisper-server: {e}"))?;
    Ok(child)
}

fn healthy(addr: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, HEALTH_TIMEOUT) else { return false };
    if stream.set_read_timeout(Some(HEALTH_TIMEOUT)).is_err() {
        return false;
    }
    let request = format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    // A partial read still carries the status line.
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.1 200")
}

/// Which process listens on `port` (IPv4 loopback), from the OS TCP table.
fn listener_pid(port: u16) -> Option<u32> {
    use windows::Win32::NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER};
    use windows::Win32::Networking::WinSock::AF_INET;
    let family = u32::from(AF_INET.0);
    let mut size = 0u32;
    // SAFETY: the first call only reports the size; the second fills a buffer of that size.
    unsafe {
        GetExtendedTcpTable(None, &mut size, false, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
        let mut buffer = vec![0u8; size as usize];
        if GetExtendedTcpTable(Some(buffer.as_mut_ptr().cast()), &mut size, false, family, TCP_TABLE_OWNER_PID_LISTENER, 0) != 0 {
            return None;
        }
        let table = &*(buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
        rows.iter().find(|row| crate::vlm::port_from_row(row.dwLocalPort) == port).map(|row| row.dwOwningPid)
    }
}

/// Why the server stopped, from the end of its log (CUDA out of memory is the usual one).
fn log_reason(root: &Path) -> String {
    let log = std::fs::read_to_string(root.join(LOG_FILE)).unwrap_or_default();
    let out_of_memory = log.lines().any(|line| line.contains("out of memory") || line.contains("failed to allocate"));
    if out_of_memory {
        "the GPU ran out of memory".into()
    } else {
        format!("see {LOG_FILE}")
    }
}

/// The running server and how this run ended.
enum RunEnd {
    /// The vision model is reloading: the GPU is handed back to it.
    YieldToVision,
    /// The server failed (or kept failing requests): the reason.
    Failed(String),
}

fn wait_ready(child: &mut Child, addr: SocketAddr, root: &Path) -> Result<(), String> {
    let started = Instant::now();
    loop {
        thread::sleep(READY_POLL);
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("whisper-server exited while loading ({status}): {}", log_reason(root)));
        }
        let ours = listener_pid(addr.port()) == Some(child.id());
        if ours && healthy(addr) {
            return Ok(());
        }
        if started.elapsed() > READY_TIMEOUT {
            return Err(format!("whisper-server didn't load within {}s", READY_TIMEOUT.as_secs()));
        }
    }
}

/// Watches a ready server until it exits, keeps failing, or the vision model needs the GPU back.
fn watch(app: &AppHandle, child: &mut Child, root: &Path) -> Result<RunEnd, String> {
    loop {
        thread::sleep(VLM_POLL);
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(RunEnd::Failed(format!("whisper-server exited ({status}): {}", log_reason(root))));
        }
        if vlm_busy(app) {
            return Ok(RunEnd::YieldToVision);
        }
        if refine::failures_in_a_row() >= MAX_FAILURES_IN_A_ROW {
            return Ok(RunEnd::Failed(format!("{MAX_FAILURES_IN_A_ROW} second listens in a row failed")));
        }
    }
}

/// Starts `model`, serves second listens until the run ends, and always stops the server.
fn run_once(app: &AppHandle, root: &Path, model: GpuModel) -> Result<RunEnd, String> {
    let port = free_port()?;
    let mut child = spawn_server(root, model, port)?;
    if let Err(reason) = JOB.bind(&child, "whisper-server") {
        // An untied server could outlive Hodeum on the GPU; don't run one.
        let _ = child.kill();
        return Err(reason);
    }
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let result = wait_ready(&mut child, addr, root).and_then(|()| {
        let took = refine::warm_up(addr).map_err(|e| format!("whisper-server's first request failed: {e}"))?;
        eprintln!("GPU hearing warmed up in {took:?}");
        refine::set_server(Some(GpuServer { addr, model: model.id() }));
        set_refine(app, Some(model.id()));
        eprintln!("GPU hearing on: {} at {addr}", model.id());
        watch(app, &mut child, root)
    });
    refine::set_server(None);
    set_refine(app, None);
    if let Err(error) = child.kill() {
        eprintln!("couldn't stop whisper-server (it may have exited): {error}");
    }
    let _ = child.wait();
    result
}

/// Waits for the vision model to settle, then for enough free video memory; the model to start.
fn next_model(app: &AppHandle, allowed: impl Fn(GpuModel) -> bool) -> Result<GpuModel, String> {
    while vlm_busy(app) {
        thread::sleep(VLM_POLL);
    }
    let free = free_mib()?;
    pick_model(free, allowed).ok_or_else(|| format!("only {free} MiB of video memory free (Whisper small needs {SMALL_MIN_FREE_MIB})"))
}

/// Position in MODELS: 0 is the largest.
fn rank(model: GpuModel) -> usize {
    MODELS.iter().position(|m| *m == model).unwrap_or(MODELS.len())
}

fn supervise(app: AppHandle) {
    let root = local_ai_root();
    let installed = |model: GpuModel| model_path(&root, model).exists();
    if !root.join(SERVER_EXE).exists() || !MODELS.into_iter().any(installed) {
        return eprintln!("GPU hearing off: whisper.cpp or its models aren't installed (scripts/setup-local-ai.ps1)");
    }
    // After a failure only smaller models are tried.
    let mut largest = 0;
    let mut starts = 0;
    while starts < MAX_STARTS {
        let model = match next_model(&app, |m| installed(m) && rank(m) >= largest) {
            Ok(model) => model,
            Err(reason) => return eprintln!("GPU hearing off: {reason}"),
        };
        match run_once(&app, &root, model) {
            Ok(RunEnd::YieldToVision) => continue,
            Ok(RunEnd::Failed(reason)) | Err(reason) => {
                eprintln!("GPU hearing ({}) stopped: {reason}", model.id());
                starts += 1;
                let Some(next) = smaller(model, installed) else { return eprintln!("GPU hearing off: no smaller Whisper model to try") };
                largest = rank(next);
            }
        }
    }
    eprintln!("GPU hearing off until Hodeum restarts");
}

pub(crate) fn spawn(app: AppHandle) {
    thread::spawn(move || supervise(app));
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: fn(GpuModel) -> bool = |_| true;

    #[test]
    fn picks_the_largest_model_the_free_memory_allows() {
        assert_eq!(pick_model(2000, ALL), Some(GpuModel::Turbo));
        assert_eq!(pick_model(1250, ALL), Some(GpuModel::Turbo));
        assert_eq!(pick_model(1249, ALL), Some(GpuModel::Small));
        assert_eq!(pick_model(850, ALL), Some(GpuModel::Small));
        assert_eq!(pick_model(849, ALL), Some(GpuModel::Base));
        assert_eq!(pick_model(600, ALL), Some(GpuModel::Base));
        assert_eq!(pick_model(599, ALL), None, "the GPU is the vision model's");
    }

    #[test]
    fn picks_only_installed_models() {
        let small_only = |m: GpuModel| m == GpuModel::Small;
        assert_eq!(pick_model(4000, small_only), Some(GpuModel::Small), "turbo is opt-in");
        assert_eq!(pick_model(700, small_only), None);
    }

    #[test]
    fn steps_down_to_the_next_installed_model() {
        assert_eq!(smaller(GpuModel::Turbo, ALL), Some(GpuModel::Small));
        assert_eq!(smaller(GpuModel::Turbo, |m| m != GpuModel::Small), Some(GpuModel::Base));
        assert_eq!(smaller(GpuModel::Base, ALL), None);
    }

    #[test]
    fn serves_loopback_only_with_the_chosen_model() {
        let args = server_args(Path::new("C:/hodeum"), GpuModel::Small, 9123);
        let value = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].clone());
        assert_eq!(value("--host").as_deref(), Some("127.0.0.1"), "it has no API key");
        assert_eq!(value("--port").as_deref(), Some("9123"));
        assert!(value("-m").unwrap().ends_with("ggml-small-q5_1.bin"));
        assert_eq!(value("-nth").as_deref(), Some("0.6"));
        assert!(args.contains(&"-nt".to_string()) && args.contains(&"-fa".to_string()));
        assert!(!args.contains(&"-ng".to_string()), "on the GPU");
    }

    /// Needs runtime/whisper, Whisper small and Kokoro (scripts/setup-local-ai.ps1): starts the GPU
    /// server, has Kokoro say Hodeum commands and checks the second listen hears them, with timings.
    /// `cargo test --lib -- --ignored gpu_second_listen --nocapture`.
    #[test]
    #[ignore]
    fn gpu_second_listen_round_trip() {
        use crate::voice::models::{kokoro_files, voice_root};
        use crate::voice::speak::load_kokoro;
        let root = local_ai_root();
        let free = free_mib().unwrap();
        println!("free before: {free} MiB");
        if free < SMALL_MIN_FREE_MIB {
            // The app would leave the GPU to the vision model too; requests would time out (measured).
            return println!("skipped: the GPU is too full for Whisper small right now");
        }
        let port = free_port().unwrap();
        let mut child = spawn_server(&root, GpuModel::Small, port).unwrap();
        JOB.bind(&child, "whisper-server").unwrap();
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let started = Instant::now();
        wait_ready(&mut child, addr, &root).unwrap();
        println!("whisper small loaded in {:?}; free now: {:?} MiB", started.elapsed(), free_mib());
        println!("warm-up request: {:?}", refine::warm_up(addr));
        refine::set_server(Some(GpuServer { addr, model: GpuModel::Small.id() }));
        let tts = load_kokoro(&kokoro_files(&voice_root()).unwrap()).unwrap();
        let config = sherpa_onnx::GenerationConfig { sid: 3, ..Default::default() };
        let lines = [("Open Excel.", "open ex", "excel"), ("Hey Hodey, give me a hint please.", "hey hodi give me a hint please", "hodey"), ("How do I make a pivot table?", "how do i make a pivot table", "pivot")];
        for (line, nemotron, expect) in lines {
            let spoken = tts.generate_with_config(line, &config, None::<fn(&[f32], f32) -> bool>).unwrap();
            let audio = sherpa_onnx::LinearResampler::create(spoken.sample_rate(), 16_000).unwrap().resample(spoken.samples(), true);
            let started = Instant::now();
            let heard = refine::refine(nemotron, &audio);
            println!("{line:?}: nemotron {nemotron:?} -> {heard:?} in {:?}", started.elapsed());
            assert!(heard.to_lowercase().contains(expect), "{heard:?}");
        }
        assert_eq!(refine::failures_in_a_row(), 0);
        refine::set_server(None);
        child.kill().unwrap();
    }

    /// Prints DXGI's and the NVIDIA driver's free memory: `cargo test --lib -- --ignored free_vram --nocapture`.
    #[test]
    #[ignore]
    fn free_vram_report() {
        println!("dxgi free: {:?} MiB, nvidia-smi free: {:?} MiB, planned: {:?}", free_vram_mib(), nvidia_free_mib(), free_mib());
    }
}
