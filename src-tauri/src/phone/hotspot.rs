//! The laptop's own Mobile Hotspot, for AirPlay. Guest and campus Wi-Fi keep devices from seeing each
//! other and VPNs hide the laptop, but an iPhone that joins the laptop's hotspot can always reach it.
//! Hodeum turns the hotspot on for AirPlay and off again afterwards, only if it was the one to turn it on.

use std::net::Ipv4Addr;
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use windows::Networking::Connectivity::NetworkInformation;
use windows::Networking::NetworkOperators::{
    NetworkOperatorTetheringManager, NetworkOperatorTetheringOperationResult, TetheringCapability, TetheringOperationStatus,
    TetheringOperationalState,
};
use windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_ADDRESSES_LH;

use super::ensure_com;

/// Windows hosts the Mobile Hotspot on one of its Wi-Fi Direct virtual adapters.
const HOTSPOT_ADAPTER: &str = "Wi-Fi Direct Virtual Adapter";
/// Apple's driver for an iPhone sharing its connection over the cable (Personal Hotspot over USB).
const IPHONE_USB_ADAPTER: &str = "Apple Mobile Device Ethernet";
/// The hotspot adapter gets its address a moment after Windows reports the hotspot on.
const ADDRESS_WAIT: Duration = Duration::from_secs(10);
const ADDRESS_POLL: Duration = Duration::from_millis(250);
/// Closing and reopening the iPhone view (Try again) shouldn't drop the iPhone off the hotspot.
pub const RELEASE_GRACE: Duration = Duration::from_secs(30);
/// Longest Hodeum's exit waits for Windows to turn the hotspot off.
const EXIT_WAIT: Duration = Duration::from_secs(5);
const ADAPTER_BUFFER_BYTES: u32 = 16 * 1024;
const ADAPTER_TRIES: usize = 3;
const NO_INTERNET: &str = "This laptop has no internet connection to share, so Windows won't start its Mobile hotspot.";
const NO_ADDRESS: &str = "The laptop's Mobile hotspot came on but never got a network address.";

/// What the iPhone needs to join the hotspot, and the address AirPlay is advertised on there.
#[derive(Debug, Clone, PartialEq)]
pub struct HotspotInfo {
    pub ssid: String,
    pub passphrase: String,
    pub ipv4: Ipv4Addr,
}

/// One network adapter, as far as finding the hotspot goes.
#[derive(Debug, Clone, PartialEq)]
pub struct Adapter {
    pub description: String,
    pub up: bool,
    pub ipv4: Vec<Ipv4Addr>,
}

/// This laptop's address on an up adapter whose description contains `name`. An idle one is link-local.
fn address_on(adapters: &[Adapter], name: &str) -> Option<Ipv4Addr> {
    adapters
        .iter()
        .filter(|a| a.up && a.description.contains(name))
        .flat_map(|a| a.ipv4.iter().copied())
        .find(|ip| !ip.is_link_local() && !ip.is_unspecified())
}

/// The hotspot's own address, on the Wi-Fi Direct adapter that hosts it.
pub fn hotspot_ipv4(adapters: &[Adapter]) -> Option<Ipv4Addr> {
    address_on(adapters, HOTSPOT_ADAPTER)
}

/// This laptop's address on an iPhone's Personal Hotspot over USB, if one is plugged in and sharing.
pub fn iphone_usb_ipv4() -> Result<Option<Ipv4Addr>, String> {
    Ok(address_on(&adapters()?, IPHONE_USB_ADAPTER))
}

#[derive(Debug, Default)]
struct Lease {
    /// Hodeum turned the hotspot on, so Hodeum turns it off.
    owned: bool,
    /// Bumped by every `ensure`, so a delayed release skips a hotspot that was asked for again.
    epoch: u64,
}

/// Off only if Hodeum turned it on and nothing asked for it after `token` (`None`: now, e.g. at exit).
fn releasable(lease: &Lease, token: Option<u64>) -> bool {
    lease.owned && token.is_none_or(|t| t == lease.epoch)
}

#[derive(Default)]
pub struct Hotspot(Mutex<Lease>);

impl Hotspot {
    /// Turns the hotspot on if it's off and reports how to join it. Blocking: a few seconds to start.
    pub fn ensure(&self) -> Result<HotspotInfo, String> {
        let mut lease = self.0.lock().map_err(|e| e.to_string())?;
        lease.epoch += 1;
        ensure_com()?;
        let manager = manager()?;
        if winrt(manager.TetheringOperationalState(), "check")? != TetheringOperationalState::On {
            finish(manager.StartTetheringAsync().and_then(|op| op.join()), "start")?;
            lease.owned = true;
        }
        let config = winrt(manager.GetCurrentAccessPointConfiguration(), "read")?;
        let ssid = winrt(config.Ssid(), "read")?.to_string();
        let passphrase = winrt(config.Passphrase(), "read")?.to_string();
        Ok(HotspotInfo { ssid, passphrase, ipv4: wait_for_address()? })
    }

    /// Identifies this moment for `release`.
    pub fn token(&self) -> Result<u64, String> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.epoch)
    }

    /// Turns the hotspot off if Hodeum turned it on and nothing asked for it after `token`.
    pub fn release(&self, token: Option<u64>) -> Result<(), String> {
        let mut lease = self.0.lock().map_err(|e| e.to_string())?;
        if !releasable(&lease, token) {
            return Ok(());
        }
        ensure_com()?;
        finish(manager()?.StopTetheringAsync().and_then(|op| op.join()), "stop")?;
        lease.owned = false;
        Ok(())
    }
}

/// Turns the hotspot off after a grace period, unless AirPlay asks for it again (e.g. Try again).
pub fn release_later(app: &AppHandle) -> Result<(), String> {
    let token = app.state::<Hotspot>().token()?;
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(RELEASE_GRACE);
        if let Err(error) = app.state::<Hotspot>().release(Some(token)) {
            eprintln!("couldn't turn the laptop hotspot off: {error}");
        }
    });
    Ok(())
}

/// At exit: turns off a hotspot Hodeum turned on, without letting a stuck Windows call hold up the exit.
pub fn release_on_exit(app: &AppHandle) {
    let app = app.clone();
    let (done, finished) = mpsc::channel();
    thread::spawn(move || {
        // A send only fails once the exit stopped waiting, and that case is reported below.
        let _ = done.send(app.state::<Hotspot>().release(None));
    });
    match finished.recv_timeout(EXIT_WAIT) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("couldn't turn the laptop hotspot off: {error}"),
        Err(_) => eprintln!("turning the laptop hotspot off took too long; it may still be on"),
    }
}

fn winrt<T>(result: windows::core::Result<T>, verb: &str) -> Result<T, String> {
    result.map_err(|e| format!("Windows couldn't {verb} the Mobile hotspot: {e}"))
}

fn manager() -> Result<NetworkOperatorTetheringManager, String> {
    let profile = NetworkInformation::GetInternetConnectionProfile().map_err(|_| NO_INTERNET.to_string())?;
    let capability = winrt(NetworkOperatorTetheringManager::GetTetheringCapabilityFromConnectionProfile(&profile), "check")?;
    if capability != TetheringCapability::Enabled {
        return Err(capability_problem(capability));
    }
    winrt(NetworkOperatorTetheringManager::CreateFromConnectionProfile(&profile), "open")
}

fn capability_problem(capability: TetheringCapability) -> String {
    match capability {
        TetheringCapability::DisabledByHardwareLimitation => "This laptop's Wi-Fi can't host a Mobile hotspot.".into(),
        TetheringCapability::DisabledByGroupPolicy => "Mobile hotspot is turned off by this PC's administrator.".into(),
        other => format!("Windows won't start a Mobile hotspot on this connection (reason {}).", other.0),
    }
}

fn finish(result: windows::core::Result<NetworkOperatorTetheringOperationResult>, verb: &str) -> Result<(), String> {
    let result = winrt(result, verb)?;
    let status = winrt(result.Status(), verb)?;
    if status == TetheringOperationStatus::Success {
        return Ok(());
    }
    let detail = winrt(result.AdditionalErrorMessage(), verb)?.to_string();
    Err(match status {
        TetheringOperationStatus::WiFiDeviceOff => "Turn on Wi-Fi so the laptop can host a Mobile hotspot.".into(),
        _ if !detail.is_empty() => format!("Windows couldn't {verb} the Mobile hotspot: {detail}"),
        other => format!("Windows couldn't {verb} the Mobile hotspot (status {}).", other.0),
    })
}

fn wait_for_address() -> Result<Ipv4Addr, String> {
    let deadline = Instant::now() + ADDRESS_WAIT;
    loop {
        if let Some(ip) = hotspot_ipv4(&adapters()?) {
            return Ok(ip);
        }
        if Instant::now() >= deadline {
            return Err(NO_ADDRESS.into());
        }
        thread::sleep(ADDRESS_POLL);
    }
}

fn adapters() -> Result<Vec<Adapter>, String> {
    use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST};
    use windows::Win32::Networking::WinSock::AF_INET;
    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size = ADAPTER_BUFFER_BYTES;
    for _ in 0..ADAPTER_TRIES {
        // u64 storage keeps the list aligned for IP_ADAPTER_ADDRESSES_LH.
        let mut buffer = vec![0u64; (size as usize).div_ceil(std::mem::size_of::<u64>())];
        // SAFETY: the buffer is at least `size` writable, aligned bytes.
        let rc = unsafe { GetAdaptersAddresses(u32::from(AF_INET.0), flags, None, Some(buffer.as_mut_ptr().cast()), &mut size) };
        if rc == ERROR_BUFFER_OVERFLOW.0 {
            continue;
        }
        if rc != ERROR_SUCCESS.0 {
            return Err(format!("couldn't list this laptop's network adapters (error {rc})"));
        }
        // SAFETY: Windows filled `buffer` with a linked list of adapters that lives as long as it does.
        return Ok(unsafe { adapter_list(buffer.as_ptr().cast()) });
    }
    Err("couldn't list this laptop's network adapters: the list kept changing".into())
}

/// # Safety
/// `first` heads a list filled in by `GetAdaptersAddresses` that is still alive.
unsafe fn adapter_list(first: *const IP_ADAPTER_ADDRESSES_LH) -> Vec<Adapter> {
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};
    let mut out = Vec::new();
    let mut next = first;
    while let Some(adapter) = unsafe { next.as_ref() } {
        let mut ipv4 = Vec::new();
        let mut unicast = adapter.FirstUnicastAddress;
        while let Some(address) = unsafe { unicast.as_ref() } {
            let sockaddr = address.Address.lpSockaddr;
            if !sockaddr.is_null() && unsafe { (*sockaddr).sa_family } == AF_INET {
                let sin = unsafe { &*(sockaddr as *const SOCKADDR_IN) };
                ipv4.push(Ipv4Addr::from(unsafe { sin.sin_addr.S_un.S_addr }.to_ne_bytes()));
            }
            unicast = address.Next;
        }
        let description = unsafe { adapter.Description.to_string() }.unwrap_or_default();
        out.push(Adapter { description, up: adapter.OperStatus == IfOperStatusUp, ipv4 });
        next = adapter.Next;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter(description: &str, up: bool, ipv4: &[[u8; 4]]) -> Adapter {
        Adapter { description: description.into(), up, ipv4: ipv4.iter().map(|o| Ipv4Addr::from(*o)).collect() }
    }

    #[test]
    fn finds_the_address_of_the_adapter_hosting_the_hotspot() {
        let adapters = [
            adapter("Intel(R) Wi-Fi 6E AX211 160MHz", true, &[[35, 7, 247, 64]]),
            adapter("Microsoft Wi-Fi Direct Virtual Adapter", true, &[[169, 254, 195, 49]]),
            adapter("Microsoft Wi-Fi Direct Virtual Adapter #2", true, &[[192, 168, 137, 1]]),
        ];
        assert_eq!(hotspot_ipv4(&adapters), Some(Ipv4Addr::new(192, 168, 137, 1)));
    }

    #[test]
    fn finds_an_iphone_sharing_its_connection_over_usb() {
        let adapters = [
            adapter("Intel(R) Wi-Fi 6E AX211 160MHz", true, &[[35, 7, 247, 64]]),
            adapter("Apple Mobile Device Ethernet", true, &[[172, 20, 10, 2]]),
        ];
        assert_eq!(address_on(&adapters, IPHONE_USB_ADAPTER), Some(Ipv4Addr::new(172, 20, 10, 2)));
        assert_eq!(hotspot_ipv4(&adapters), None);
    }

    #[test]
    fn no_hotspot_address_while_it_is_off_or_down() {
        let off = [adapter("Microsoft Wi-Fi Direct Virtual Adapter #2", true, &[[169, 254, 169, 133]])];
        let down = [adapter("Microsoft Wi-Fi Direct Virtual Adapter #2", false, &[[192, 168, 137, 1]])];
        let other = [adapter("VirtualBox Host-Only Ethernet Adapter", true, &[[192, 168, 56, 1]])];
        assert_eq!(hotspot_ipv4(&off), None);
        assert_eq!(hotspot_ipv4(&down), None);
        assert_eq!(hotspot_ipv4(&other), None);
    }

    #[test]
    fn only_a_hotspot_hodeum_started_and_nobody_reused_is_turned_off() {
        assert!(!releasable(&Lease { owned: false, epoch: 1 }, None));
        assert!(releasable(&Lease { owned: true, epoch: 1 }, None));
        assert!(releasable(&Lease { owned: true, epoch: 1 }, Some(1)));
        assert!(!releasable(&Lease { owned: true, epoch: 2 }, Some(1)));
    }

    #[test]
    fn lists_this_pcs_adapters() {
        assert!(!adapters().unwrap().is_empty());
    }

    /// Turns the real hotspot on and off: `cargo test --lib live_hotspot -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_hotspot_starts_with_an_address_and_stops() {
        let hotspot = Hotspot::default();
        let info = hotspot.ensure().unwrap();
        println!("hotspot {:?} on {}", info.ssid, info.ipv4);
        assert!(!info.ssid.is_empty() && !info.passphrase.is_empty());
        assert!(!info.ipv4.is_link_local());
        hotspot.release(None).unwrap();
    }
}
