//! UxPlay as an AirPlay receiver: it decrypts the iPhone's mirror and sends H.264 over RTP to a
//! loopback port; we depacketize it and stream access units to the notch, which decodes them.
//! UxPlay is GPL and never bundled: it only runs if the learner put it in Hodeum's own runtime folder.

use std::fs::File;
use std::io::ErrorKind;
use std::net::{SocketAddr, UdpSocket};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use super::rtp::Depacketizer;
use crate::child_job::ChildJob;
use crate::vlm::{local_ai_root, port_from_row};

pub const RECEIVER_NAME: &str = "Hodeum";
/// One fixed place, like llama-server: no setting or variable can redirect which receiver binary runs,
/// and shared folders other users can write to (C:\msys64 by default) are never searched.
pub const LOCAL_RECEIVER: &str = "runtime/uxplay/uxplay.exe";
const LOG_FILE: &str = "runtime/uxplay.log";
pub const AIRPLAY_MISSING: &str = "AirPlay receiver not installed. See docs/iphone-mirroring.md to install UxPlay.";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const POLL: Duration = Duration::from_millis(250);
/// Large enough for any RTP packet on loopback.
const MAX_PACKET: usize = 65_536;
const KEY_FLAG: u8 = 1;

/// `-a` no audio; `-nohold` lets a new iPhone take over; `-vrtp` sends video to us instead of a window.
pub fn receiver_args(port: u16) -> Vec<String> {
    let rtp = format!("config-interval=1 ! udpsink host=127.0.0.1 port={port}");
    ["-n", RECEIVER_NAME, "-nh", "-a", "-nohold", "-vrtp", &rtp].iter().map(|s| s.to_string()).collect()
}

pub fn receiver_path(root: &Path) -> Option<PathBuf> {
    Some(root.join(LOCAL_RECEIVER)).filter(|p| p.is_file())
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

impl Airplay {
    /// Stops the receiver (Close, a new start, or app exit). The pump thread sees the flag and exits.
    pub fn stop(&self) -> Result<(), String> {
        let mut slot = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(mut session) = slot.take() {
            session.stop.store(true, Ordering::SeqCst);
            session.child.kill().map_err(|e| format!("couldn't stop the AirPlay receiver: {e}"))?;
        }
        Ok(())
    }

    fn exited(&self) -> bool {
        match self.session.lock() {
            Ok(mut slot) => slot.as_mut().is_none_or(|s| !matches!(s.child.try_wait(), Ok(None))),
            Err(_) => true,
        }
    }
}

/// Status for the notch, mirrored by `ReceiverMessage` in src/features/phone/airplay-source.ts.
fn status(channel: &Channel<InvokeResponseBody>, state: &str, detail: Option<String>) -> bool {
    let body = serde_json::json!({ "state": state, "detail": detail }).to_string();
    channel.send(InvokeResponseBody::Json(body)).is_ok()
}

fn spawn_receiver(root: &Path, exe: &Path, port: u16) -> Result<Child, String> {
    let log = File::create(root.join(LOG_FILE)).map_err(|e| format!("couldn't create {LOG_FILE}: {e}"))?;
    let errors = log.try_clone().map_err(|e| e.to_string())?;
    // UxPlay loads its GStreamer DLLs from its own folder (a junction to MSYS2's ucrt64/bin).
    let dir = exe.parent().ok_or("the AirPlay receiver path has no folder")?;
    Command::new(exe)
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

/// Which process owns a local UDP port (IPv4), straight from the OS UDP table.
fn udp_owner_pid(port: u16) -> Option<u32> {
    use windows::Win32::NetworkManagement::IpHelper::{GetExtendedUdpTable, MIB_UDPTABLE_OWNER_PID, UDP_TABLE_OWNER_PID};
    use windows::Win32::Networking::WinSock::AF_INET;
    let family = u32::from(AF_INET.0);
    let mut size = 0u32;
    // SAFETY: the first call only reports the required size; the second fills a buffer of that size.
    unsafe {
        GetExtendedUdpTable(None, &mut size, false, family, UDP_TABLE_OWNER_PID, 0);
        let mut buffer = vec![0u8; size as usize];
        if GetExtendedUdpTable(Some(buffer.as_mut_ptr().cast()), &mut size, false, family, UDP_TABLE_OWNER_PID, 0) != 0 {
            return None;
        }
        let table = &*(buffer.as_ptr() as *const MIB_UDPTABLE_OWNER_PID);
        let rows = std::slice::from_raw_parts(table.table.as_ptr(), table.dwNumEntries as usize);
        rows.iter().find(|row| port_from_row(row.dwLocalPort) == port).map(|row| row.dwOwningPid)
    }
}

/// Video is only accepted from a port owned by the UxPlay process we started, so another local
/// program can neither inject frames nor lock the receiver out by sending first.
fn accept_from(peer: &mut Option<SocketAddr>, from: SocketAddr, receiver_pid: u32, owner: impl Fn(u16) -> Option<u32>) -> bool {
    if let Some(known) = peer {
        return *known == from;
    }
    let ours = from.ip().is_loopback() && owner(from.port()) == Some(receiver_pid);
    if ours {
        *peer = Some(from);
    }
    ours
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
    let mut sender = None;
    while !stop.load(Ordering::SeqCst) {
        match socket.recv_from(&mut buffer) {
            Ok((_, from)) if !accept_from(&mut sender, from, receiver_pid, udp_owner_pid) => continue,
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

/// Starts (or restarts) the receiver and streams its video to `on_frame`.
#[tauri::command]
pub fn airplay_start(app: AppHandle, state: State<'_, Airplay>, on_frame: Channel<InvokeResponseBody>) -> Result<(), String> {
    state.stop()?;
    let root = local_ai_root();
    let exe = receiver_path(&root).ok_or(AIRPLAY_MISSING)?;
    let socket = UdpSocket::bind(("127.0.0.1", 0)).map_err(|e| format!("couldn't open a local port for AirPlay video: {e}"))?;
    socket.set_read_timeout(Some(POLL)).map_err(|e| e.to_string())?;
    let port = socket.local_addr().map_err(|e| e.to_string())?.port();
    let child = spawn_receiver(&root, &exe, port)?;
    state.job.bind(&child, "the AirPlay receiver")?;
    let receiver_pid = child.id();
    let stop = Arc::new(AtomicBool::new(false));
    *state.session.lock().map_err(|e| e.to_string())? = Some(Session { child, stop: stop.clone() });
    status(&on_frame, "waiting", None);
    thread::spawn(move || pump(socket, on_frame, stop, root, receiver_pid, move || app.state::<Airplay>().exited()));
    Ok(())
}

#[tauri::command]
pub fn airplay_stop(state: State<'_, Airplay>) -> Result<(), String> {
    state.stop()
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

    #[test]
    fn finds_the_receiver_only_at_fixed_places() {
        let root = std::env::temp_dir().join(format!("hodeum-uxplay-test-{}", std::process::id()));
        let exe = root.join(LOCAL_RECEIVER);
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        assert_ne!(receiver_path(&root).as_deref(), Some(exe.as_path()));
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(receiver_path(&root).as_deref(), Some(exe.as_path()));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_the_process_that_owns_a_udp_port() {
        let socket = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        assert_eq!(udp_owner_pid(port), Some(std::process::id()));
    }

    #[test]
    fn only_the_receiver_process_may_feed_video_even_if_another_sends_first() {
        const RECEIVER_PID: u32 = 42;
        let uxplay: SocketAddr = "127.0.0.1:50000".parse().unwrap();
        let intruder: SocketAddr = "127.0.0.1:50001".parse().unwrap();
        let owner = |port: u16| Some(if port == 50000 { RECEIVER_PID } else { 7 });
        let mut peer = None;
        assert!(!accept_from(&mut peer, intruder, RECEIVER_PID, owner));
        assert!(accept_from(&mut peer, uxplay, RECEIVER_PID, owner));
        assert!(!accept_from(&mut peer, intruder, RECEIVER_PID, owner));
        assert!(accept_from(&mut peer, uxplay, RECEIVER_PID, owner));
    }

    #[test]
    fn last_line_skips_trailing_blanks() {
        assert_eq!(last_line("starting\nerror: port 7000 in use\n\n"), Some("error: port 7000 in use"));
        assert_eq!(last_line("  \n"), None);
    }
}
