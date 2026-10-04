//! UxPlay as an AirPlay receiver: it decrypts the iPhone's mirror and sends H.264 over RTP to a
//! loopback port; we depacketize it and stream access units to the notch, which decodes them.
//! UxPlay is GPL and never bundled: it only runs if the learner put it in Hodeum's own runtime folder.

use std::fs::File;
use std::io::ErrorKind;
use std::net::{Ipv4Addr, UdpSocket};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use super::hotspot::{self, Hotspot};
use super::rtp::Depacketizer;
use super::sender::{owned_by, udp_rows, SenderGate};
use crate::child_job::ChildJob;
use crate::vlm::local_ai_root;

pub const RECEIVER_NAME: &str = "Hodeum";
/// One fixed place, like llama-server: no setting or variable can redirect which receiver binary runs,
/// and shared folders other users can write to (C:\msys64 by default) are never searched.
pub const LOCAL_RECEIVER: &str = "runtime/uxplay/uxplay.exe";
const LOG_FILE: &str = "runtime/uxplay.log";
pub const AIRPLAY_MISSING: &str = "AirPlay receiver not installed. Run scripts\\setup-airplay.ps1 (see docs/iphone-mirroring.md).";
pub const AIRPLAY_OUTDATED: &str = "The AirPlay receiver needs an update to use the laptop hotspot. Run scripts\\setup-airplay.ps1 again.";
/// Written by scripts/setup-airplay.ps1 beside a UxPlay built with Hodeum's mDNS patch (relative to its bin folder).
const PATCH_STAMP: &str = "../share/uxplay-hodeum.stamp";
/// Read by the patched UxPlay: the address to advertise the receiver on.
const MDNS_IPV4_VAR: &str = "UXPLAY_MDNS_IPV4";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const POLL: Duration = Duration::from_millis(250);
/// Large enough for any RTP packet on loopback.
const MAX_PACKET: usize = 65_536;
const KEY_FLAG: u8 = 1;
/// Room for a whole mirrored-screen keyframe burst (hundreds of KB) while the pump is busy.
const RECEIVE_BUFFER_BYTES: i32 = 4 * 1024 * 1024;

/// `-a` no audio; `-nohold` lets a new iPhone take over; `-vrtp` sends video to us instead of a window.
pub fn receiver_args(port: u16) -> Vec<String> {
    let rtp = format!("config-interval=1 ! udpsink host=127.0.0.1 port={port}");
    ["-n", RECEIVER_NAME, "-nh", "-a", "-nohold", "-vrtp", &rtp].iter().map(|s| s.to_string()).collect()
}

/// UxPlay's real location. Started through the runtime\uxplay junction, GStreamer would look for its
/// plugins in runtime\lib and UxPlay would stop at once with "Required gstreamer plugin ... not found".
pub fn receiver_path(root: &Path) -> Result<PathBuf, String> {
    let exe = root.join(LOCAL_RECEIVER);
    if !exe.is_file() {
        return Err(AIRPLAY_MISSING.into());
    }
    std::fs::canonicalize(&exe).map(without_verbatim).map_err(|e| format!("couldn't find where {} points: {e}", exe.display()))
}

/// `\\?\C:\x` becomes `C:\x`: GStreamer builds its plugin path with `..`, which a verbatim path doesn't resolve.
fn without_verbatim(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|p| p.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

/// Whether this UxPlay was built with the patch that lets it advertise on the laptop hotspot.
fn patched(exe: &Path) -> bool {
    exe.parent().is_some_and(|bin| bin.join(PATCH_STAMP).is_file())
}

/// Which network the learner wants the iPhone on. Mirrors `AirplayNetworkChoice` in src/features/phone/prefs.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkChoice {
    /// A link only this laptop and the iPhone share, so guest Wi-Fi and VPNs can't get in the way.
    Direct,
    /// Whatever Wi-Fi the laptop is on.
    Wifi,
}

/// Where the iPhone has to be to see the receiver. Mirrors `AirplayNetwork` in src/features/phone/phone-source.ts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Network {
    /// The iPhone's Personal Hotspot over the USB cable.
    Usb,
    /// This laptop's Mobile hotspot, which the iPhone joins first.
    Hotspot { ssid: String, passphrase: String },
    /// The Wi-Fi the laptop is on. `problem` says why a direct link couldn't be used when it was wanted.
    Wifi { problem: Option<String> },
}

/// The network to advertise on, and its address for UxPlay (`None`: UxPlay picks). Blocking.
fn choose_network(app: &AppHandle, choice: NetworkChoice) -> (Network, Option<Ipv4Addr>) {
    if choice == NetworkChoice::Wifi {
        return (Network::Wifi { problem: None }, None);
    }
    match hotspot::iphone_usb_ipv4() {
        Ok(Some(ip)) => return (Network::Usb, Some(ip)),
        Ok(None) => {}
        Err(error) => eprintln!("couldn't check for an iPhone sharing its connection over USB: {error}"),
    }
    match app.state::<Hotspot>().ensure() {
        Ok(info) => (Network::Hotspot { ssid: info.ssid, passphrase: info.passphrase }, Some(info.ipv4)),
        Err(problem) => {
            eprintln!("couldn't use the laptop hotspot for AirPlay: {problem}");
            (Network::Wifi { problem: Some(problem) }, None)
        }
    }
}

pub fn last_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).last()
}

struct Session {
    child: Child,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Airplay {
    session: Mutex<Option<Session>>,
    job: ChildJob,
}

/// Ends the session in `slot`, if any. Its pump thread sees the flag and exits.
fn end(slot: &mut Option<Session>) -> Result<(), String> {
    if let Some(mut session) = slot.take() {
        session.stop.store(true, Ordering::SeqCst);
        session.child.kill().map_err(|e| format!("couldn't stop the AirPlay receiver: {e}"))?;
    }
    Ok(())
}

impl Airplay {
    /// Stops the receiver (Close or app exit).
    pub fn stop(&self) -> Result<(), String> {
        end(&mut *self.session.lock().map_err(|e| e.to_string())?)
    }

    fn exited(&self) -> bool {
        match self.session.lock() {
            Ok(mut slot) => slot.as_mut().is_none_or(|s| !matches!(s.child.try_wait(), Ok(None))),
            Err(_) => true,
        }
    }
}

fn set_receive_buffer(socket: &UdpSocket, bytes: i32) -> Result<(), String> {
    use std::os::windows::io::AsRawSocket;
    use windows::Win32::Networking::WinSock::{setsockopt, SOCKET, SOL_SOCKET, SO_RCVBUF};
    // SAFETY: the socket handle is valid for this call and the option value outlives it.
    let rc = unsafe { setsockopt(SOCKET(socket.as_raw_socket() as usize), SOL_SOCKET, SO_RCVBUF, Some(&bytes.to_ne_bytes())) };
    if rc != 0 {
        return Err(format!("couldn't enlarge the AirPlay video buffer: {}", std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(test)]
fn receive_buffer(socket: &UdpSocket) -> Result<i32, String> {
    use std::os::windows::io::AsRawSocket;
    use windows::Win32::Networking::WinSock::{getsockopt, SOCKET, SOL_SOCKET, SO_RCVBUF};
    let mut value = 0i32;
    let mut size = std::mem::size_of::<i32>() as i32;
    // SAFETY: `value` and `size` are live, correctly sized out-parameters for SO_RCVBUF.
    let rc = unsafe { getsockopt(SOCKET(socket.as_raw_socket() as usize), SOL_SOCKET, SO_RCVBUF, windows::core::PSTR((&mut value as *mut i32).cast()), &mut size) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(value)
}

/// Status for the notch, mirrored by `ReceiverMessage` in src/features/phone/airplay-source.ts.
fn status(channel: &Channel<InvokeResponseBody>, state: &str, detail: Option<String>) -> bool {
    send(channel, serde_json::json!({ "state": state, "detail": detail }))
}

fn send(channel: &Channel<InvokeResponseBody>, body: serde_json::Value) -> bool {
    channel.send(InvokeResponseBody::Json(body.to_string())).is_ok()
}

fn spawn_receiver(root: &Path, exe: &Path, port: u16, mdns_ipv4: Option<Ipv4Addr>) -> Result<Child, String> {
    let log = File::create(root.join(LOG_FILE)).map_err(|e| format!("couldn't create {LOG_FILE}: {e}"))?;
    let errors = log.try_clone().map_err(|e| e.to_string())?;
    // UxPlay loads its GStreamer DLLs from its own folder, MSYS2's ucrt64/bin.
    let dir = exe.parent().ok_or("the AirPlay receiver path has no folder")?;
    let mut command = Command::new(exe);
    match mdns_ipv4 {
        Some(ip) => command.env(MDNS_IPV4_VAR, ip.to_string()),
        None => command.env_remove(MDNS_IPV4_VAR),
    };
    command
        .args(receiver_args(port))
        .current_dir(dir)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("couldn't start the AirPlay receiver: {e}"))
}

fn exit_detail(root: &Path) -> String {
    let log = std::fs::read_to_string(root.join(LOG_FILE)).unwrap_or_else(|e| format!("(couldn't read {LOG_FILE}: {e})"));
    last_line(&log).map_or_else(|| "The AirPlay receiver stopped.".to_string(), |l| format!("The AirPlay receiver stopped: {l}"))
}

/// One packet in; an access unit out to the notch when a frame completes. False when the notch is gone.
fn forward(depacketizer: &mut Depacketizer, packet: &[u8], channel: &Channel<InvokeResponseBody>) -> bool {
    let Some(unit) = depacketizer.push(packet) else { return true };
    let mut message = Vec::with_capacity(unit.data.len() + 1);
    message.push(if unit.key { KEY_FLAG } else { 0 });
    message.extend_from_slice(&unit.data);
    channel.send(InvokeResponseBody::Raw(message)).is_ok()
}

/// Forwards video until stopped, the notch goes away, or the receiver exits.
fn pump(socket: UdpSocket, channel: Channel<InvokeResponseBody>, stop: Arc<AtomicBool>, root: PathBuf, receiver_pid: u32, exited: impl Fn() -> bool) {
    let mut depacketizer = Depacketizer::new();
    let mut buffer = vec![0u8; MAX_PACKET];
    let mut streaming = false;
    let mut gate = SenderGate::new();
    let started = Instant::now();
    let owned = |from| udp_rows().is_some_and(|rows| owned_by(&rows, from, receiver_pid));
    while !stop.load(Ordering::SeqCst) {
        match socket.recv_from(&mut buffer) {
            Ok((_, from)) if !gate.admits(from, started.elapsed().as_millis() as u64, &owned) => continue,
            Ok((n, _)) => {
                if !streaming {
                    streaming = status(&channel, "streaming", None);
                }
                if !forward(&mut depacketizer, &buffer[..n], &channel) {
                    return;
                }
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                if exited() && !stop.load(Ordering::SeqCst) {
                    status(&channel, "failed", Some(exit_detail(&root)));
                    return;
                }
            }
            Err(e) => {
                status(&channel, "failed", Some(format!("AirPlay video stopped arriving: {e}")));
                return;
            }
        }
    }
}

fn video_socket() -> Result<UdpSocket, String> {
    let socket = UdpSocket::bind(("127.0.0.1", 0)).map_err(|e| format!("couldn't open a local port for AirPlay video: {e}"))?;
    socket.set_read_timeout(Some(POLL)).map_err(|e| e.to_string())?;
    // Not fatal: with the default buffer AirPlay still works, it just recovers from bursts more slowly.
    if let Err(error) = set_receive_buffer(&socket, RECEIVE_BUFFER_BYTES) {
        eprintln!("{error}");
    }
    Ok(socket)
}

/// Starts (or restarts) the receiver on the chosen network and streams its video to `on_frame`.
#[tauri::command]
pub async fn airplay_start(app: AppHandle, network: NetworkChoice, on_frame: Channel<InvokeResponseBody>) -> Result<(), String> {
    let root = local_ai_root();
    let exe = receiver_path(&root)?;
    if network == NetworkChoice::Direct && !patched(&exe) {
        return Err(AIRPLAY_OUTDATED.into());
    }
    let chooser = app.clone();
    let (network, mdns_ipv4) = tauri::async_runtime::spawn_blocking(move || choose_network(&chooser, network)).await.map_err(|e| e.to_string())?;
    let state = app.state::<Airplay>();
    // One lock from ending the old receiver to storing the new one: of two quick starts, only the last survives.
    let mut slot = state.session.lock().map_err(|e| e.to_string())?;
    end(&mut slot)?;
    let socket = video_socket()?;
    let port = socket.local_addr().map_err(|e| e.to_string())?.port();
    let child = spawn_receiver(&root, &exe, port, mdns_ipv4)?;
    state.job.bind(&child, "the AirPlay receiver")?;
    let receiver_pid = child.id();
    let stop = Arc::new(AtomicBool::new(false));
    *slot = Some(Session { child, stop: stop.clone() });
    drop(slot);
    send(&on_frame, serde_json::json!({ "state": "waiting", "network": network }));
    let pumped = app.clone();
    thread::spawn(move || pump(socket, on_frame, stop, root, receiver_pid, move || pumped.state::<Airplay>().exited()));
    Ok(())
}

/// Stops the receiver. The hotspot goes off a little later, unless AirPlay starts again first.
#[tauri::command]
pub fn airplay_stop(app: AppHandle, state: State<'_, Airplay>) -> Result<(), String> {
    state.stop()?;
    hotspot::release_later(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receiver_args_send_video_to_the_local_port_without_audio() {
        let args = receiver_args(5004);
        assert!(args.windows(2).any(|w| w[0] == "-n" && w[1] == RECEIVER_NAME));
        assert!(args.iter().any(|a| a == "-a"));
        let rtp = args.iter().position(|a| a == "-vrtp").expect("-vrtp");
        assert_eq!(args[rtp + 1], "config-interval=1 ! udpsink host=127.0.0.1 port=5004");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hodeum-uxplay-{name}-{}", std::process::id()));
        if dir.exists() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn real(path: &Path) -> PathBuf {
        without_verbatim(std::fs::canonicalize(path).unwrap())
    }

    #[test]
    fn finds_the_receiver_only_at_fixed_places() {
        let root = scratch("fixed");
        let exe = root.join(LOCAL_RECEIVER);
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        assert_eq!(receiver_path(&root), Err(AIRPLAY_MISSING.to_string()));
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(receiver_path(&root), Ok(real(&exe)));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn runs_the_receiver_from_where_the_runtime_junction_points() {
        let root = scratch("junction");
        let bin = root.join("msys64").join("ucrt64").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("uxplay.exe"), b"").unwrap();
        std::fs::create_dir_all(root.join("runtime")).unwrap();
        let link = root.join("runtime").join("uxplay");
        let made = Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&bin).output().unwrap();
        assert!(made.status.success(), "mklink /J failed: {made:?}");
        let exe = receiver_path(&root).unwrap();
        assert_eq!(exe, real(&bin.join("uxplay.exe")));
        assert!(!exe.to_string_lossy().starts_with(r"\\?\"), "{exe:?}");
        std::fs::remove_dir(&link).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn verbatim_drive_paths_become_plain_ones() {
        assert_eq!(without_verbatim(PathBuf::from(r"\\?\C:\a\uxplay.exe")), PathBuf::from(r"C:\a\uxplay.exe"));
        assert_eq!(without_verbatim(PathBuf::from(r"\\?\UNC\host\share\uxplay.exe")), PathBuf::from(r"\\?\UNC\host\share\uxplay.exe"));
        assert_eq!(without_verbatim(PathBuf::from(r"C:\a")), PathBuf::from(r"C:\a"));
    }

    #[test]
    fn knows_whether_uxplay_was_built_with_the_hotspot_patch() {
        let root = scratch("stamp");
        let bin = root.join("ucrt64").join("bin");
        let share = root.join("ucrt64").join("share");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&share).unwrap();
        let exe = bin.join("uxplay.exe");
        assert!(!patched(&exe));
        std::fs::write(share.join("uxplay-hodeum.stamp"), b"commit hash").unwrap();
        assert!(patched(&exe));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn tells_the_notch_how_to_reach_the_receiver() {
        let hotspot = Network::Hotspot { ssid: "LAPTOP 1".into(), passphrase: "12345678".into() };
        assert_eq!(serde_json::to_value(hotspot).unwrap(), serde_json::json!({ "kind": "hotspot", "ssid": "LAPTOP 1", "passphrase": "12345678" }));
        assert_eq!(serde_json::to_value(Network::Usb).unwrap(), serde_json::json!({ "kind": "usb" }));
        let wifi = Network::Wifi { problem: Some("no Wi-Fi".into()) };
        assert_eq!(serde_json::to_value(wifi).unwrap(), serde_json::json!({ "kind": "wifi", "problem": "no Wi-Fi" }));
        assert_eq!(serde_json::from_value::<NetworkChoice>(serde_json::json!("direct")).unwrap(), NetworkChoice::Direct);
        assert_eq!(serde_json::from_value::<NetworkChoice>(serde_json::json!("wifi")).unwrap(), NetworkChoice::Wifi);
    }

    #[test]
    fn video_socket_buffers_a_whole_keyframe_burst() {
        let socket = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        set_receive_buffer(&socket, RECEIVE_BUFFER_BYTES).unwrap();
        assert!(receive_buffer(&socket).unwrap() >= RECEIVE_BUFFER_BYTES);
    }

    /// Starts the real UxPlay from runtime\uxplay like `airplay_start`: `cargo test --lib live_receiver -- --ignored`.
    #[test]
    #[ignore]
    fn live_receiver_starts_through_the_junction_and_advertises_where_told() {
        const STARTUP: Duration = Duration::from_secs(15);
        let root = local_ai_root();
        let exe = receiver_path(&root).unwrap();
        let socket = video_socket().unwrap();
        let mut child = spawn_receiver(&root, &exe, socket.local_addr().unwrap().port(), Some(Ipv4Addr::new(192, 168, 137, 1))).unwrap();
        let deadline = Instant::now() + STARTUP;
        let mut log = String::new();
        while Instant::now() < deadline && !log.contains("mDNS: advertising on") && matches!(child.try_wait(), Ok(None)) {
            thread::sleep(POLL);
            log = std::fs::read_to_string(root.join(LOG_FILE)).unwrap_or_default();
        }
        let running = matches!(child.try_wait(), Ok(None));
        child.kill().ok();
        assert!(running, "UxPlay exited: {log}");
        assert!(log.contains("mDNS: advertising on 192.168.137.1"), "{log}");
    }

    #[test]
    fn last_line_skips_trailing_blanks() {
        assert_eq!(last_line("starting\nerror: port 7000 in use\n\n"), Some("error: port 7000 in use"));
        assert_eq!(last_line("  \n"), None);
    }
}
