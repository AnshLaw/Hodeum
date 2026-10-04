//! Who may feed the AirPlay video port. Only sockets of the UxPlay process we started count, and the
//! answer is re-checked periodically so a port that changes hands stops being trusted.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use crate::vlm::port_from_row;

/// How often a trusted sender's port ownership is checked again.
pub const REVERIFY_MS: u64 = 1_000;

/// One row of the OS IPv4 UDP table.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct UdpRow {
    pub addr: Ipv4Addr,
    pub port: u16,
    pub pid: u32,
}

/// The OS IPv4 UDP table with owning processes.
pub fn udp_rows() -> Option<Vec<UdpRow>> {
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
        let row = |r: &windows::Win32::NetworkManagement::IpHelper::MIB_UDPROW_OWNER_PID| UdpRow {
            addr: Ipv4Addr::from(r.dwLocalAddr.to_ne_bytes()),
            port: port_from_row(r.dwLocalPort),
            pid: r.dwOwningPid,
        };
        Some(rows.iter().map(row).collect())
    }
}

/// True only if some socket could have sent from `from` and every such socket belongs to `pid`.
pub fn owned_by(rows: &[UdpRow], from: SocketAddr, pid: u32) -> bool {
    let IpAddr::V4(ip) = from.ip() else { return false };
    let mut candidates = rows.iter().filter(|r| r.port == from.port() && (r.addr == ip || r.addr.is_unspecified())).peekable();
    candidates.peek().is_some() && candidates.all(|r| r.pid == pid)
}

/// Admits packets only from a verified sender, re-verifying it every REVERIFY_MS.
pub struct SenderGate {
    peer: Option<SocketAddr>,
    verified_at: u64,
}

impl SenderGate {
    pub fn new() -> Self {
        Self { peer: None, verified_at: 0 }
    }

    /// `now_ms` is any monotonic clock in milliseconds; `owned` asks the OS whether `from` is UxPlay's.
    pub fn admits(&mut self, from: SocketAddr, now_ms: u64, owned: &impl Fn(SocketAddr) -> bool) -> bool {
        if let Some(peer) = self.peer {
            if now_ms.saturating_sub(self.verified_at) < REVERIFY_MS {
                return peer == from;
            }
            self.peer = None;
        }
        if !from.ip().is_loopback() || !owned(from) {
            return false;
        }
        self.peer = Some(from);
        self.verified_at = now_ms;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::net::{Ipv4Addr, UdpSocket};

    const RECEIVER: u32 = 42;
    const OTHER: u32 = 7;

    fn row(addr: Ipv4Addr, port: u16, pid: u32) -> UdpRow {
        UdpRow { addr, port, pid }
    }

    fn at(text: &str) -> SocketAddr {
        text.parse().unwrap()
    }

    #[test]
    fn a_port_is_the_receivers_only_if_every_socket_that_could_send_from_it_is() {
        let from = at("127.0.0.1:50000");
        let rows = [row(Ipv4Addr::LOCALHOST, 50000, RECEIVER), row(Ipv4Addr::LOCALHOST, 50001, OTHER)];
        assert!(owned_by(&rows, from, RECEIVER));
        let shadowed = [row(Ipv4Addr::UNSPECIFIED, 50000, RECEIVER), row(Ipv4Addr::LOCALHOST, 50000, OTHER)];
        assert!(!owned_by(&shadowed, from, RECEIVER), "another process on the same port and address");
        let elsewhere = [row(Ipv4Addr::new(10, 0, 0, 5), 50000, RECEIVER)];
        assert!(!owned_by(&elsewhere, from, RECEIVER), "same port but a different local address");
        assert!(!owned_by(&[], from, RECEIVER));
    }

    #[test]
    fn reads_this_process_as_the_owner_of_its_own_socket() {
        let socket = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        let from = socket.local_addr().unwrap();
        assert!(owned_by(&udp_rows().expect("UDP table"), from, std::process::id()));
    }

    #[test]
    fn rejects_an_intruder_that_sends_first_and_keeps_the_receiver() {
        let receiver = at("127.0.0.1:50000");
        let intruder = at("127.0.0.1:50001");
        let owned = |from: SocketAddr| from == receiver;
        let mut gate = SenderGate::new();
        assert!(!gate.admits(intruder, 0, &owned));
        assert!(gate.admits(receiver, 0, &owned));
        assert!(!gate.admits(intruder, 1, &owned));
        assert!(gate.admits(receiver, 2, &owned));
    }

    #[test]
    fn drops_the_sender_when_its_port_changes_hands() {
        let receiver = at("127.0.0.1:50000");
        let still_ours = Cell::new(true);
        let owned = |from: SocketAddr| from == receiver && still_ours.get();
        let mut gate = SenderGate::new();
        assert!(gate.admits(receiver, 0, &owned));
        still_ours.set(false);
        assert!(gate.admits(receiver, REVERIFY_MS - 1, &owned), "trusted until the next check");
        assert!(!gate.admits(receiver, REVERIFY_MS, &owned), "re-checked and refused");
    }
}
