//! Pages named by search results are fetched only from the public web: https, a known help site,
//! and an address outside this PC and its network. A search result or a redirect can't point Hodeum
//! at the local model server, the router or anything else on the LAN.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::redirect::Policy;
use reqwest::Url;

const HTTPS: &str = "https";
const HTTPS_PORT: u16 = 443;
const MAX_REDIRECTS: usize = 5;
/// Host names that only mean something on a local network.
const LOCAL_SUFFIXES: [&str; 6] = [".local", ".lan", ".home", ".internal", ".localdomain", ".arpa"];

fn on(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// 100.64.0.0/10, the carrier-grade NAT range: not reachable from the public internet.
fn is_shared_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 100 && (64..128).contains(&b)
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() || ip.is_documentation() || ip.is_multicast() || is_shared_v4(ip) || ip.octets()[0] == 0)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let first = ip.segments()[0];
    // fc00::/7 unique-local and fe80::/10 link-local stay on the local network.
    let unique_local = first & 0xfe00 == 0xfc00;
    let link_local = first & 0xffc0 == 0xfe80;
    !(ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || unique_local || link_local)
}

/// An address on the public internet (not this PC, its network, or a reserved range).
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

/// An https URL on the default port with no credentials, naming a host (never an IP address).
fn plain_https_host(url: &Url) -> Option<String> {
    let clean = url.scheme() == HTTPS && url.username().is_empty() && url.password().is_none() && url.port_or_known_default() == Some(HTTPS_PORT);
    // `domain()` is None for an IP address host.
    clean.then(|| url.domain()).flatten().map(str::to_lowercase)
}

/// A page Hodeum may fetch itself: a plain https URL on one of the `allowed` help sites.
pub fn readable(url: &Url, allowed: &[&str]) -> bool {
    plain_https_host(url).is_some_and(|host| allowed.iter().any(|domain| on(&host, domain)))
}

/// A page whose public URL may be handed to the reading service (which fetches it, not Hodeum).
pub fn shareable(url: &Url) -> bool {
    plain_https_host(url).is_some_and(|host| host != "localhost" && host.contains('.') && !LOCAL_SUFFIXES.iter().any(|s| host.ends_with(s)))
}

/// Resolves names as usual, then drops every private, loopback or link-local address, so a public
/// name that points at this PC or the LAN (DNS rebinding included) can't be fetched.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found = tokio::net::lookup_host((host.as_str(), HTTPS_PORT)).await?;
            let public: Vec<SocketAddr> = found.filter(|addr| is_public_ip(addr.ip())).collect();
            if public.is_empty() {
                return Err(format!("{host} has no public address").into());
            }
            Ok(Box::new(public.into_iter()) as Addrs)
        })
    }
}

/// The client for reading help pages: https only, public addresses only, and each redirect re-checked
/// against the same help sites.
pub fn page_client(user_agent: &str, timeout: std::time::Duration, connect: std::time::Duration, allowed: &'static [&'static str]) -> Result<reqwest::Client, String> {
    let redirects = Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("too many redirects")
        } else if readable(attempt.url(), allowed) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout)
        .connect_timeout(connect)
        .https_only(true)
        .redirect(redirects)
        .dns_resolver(Arc::new(PublicOnly))
        .build()
        .map_err(|e| format!("couldn't set up page reading: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELP: [&str; 2] = ["support.microsoft.com", "faq.whatsapp.com"];

    fn url(text: &str) -> Url {
        Url::parse(text).expect("test URL parses")
    }

    #[test]
    fn keeps_this_pc_and_its_network_private() {
        for private in ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1"] {
            assert!(!is_public_ip(private.parse().unwrap()), "{private}");
        }
        for public in ["8.8.8.8", "13.107.246.45", "2606:4700::6810:84e5"] {
            assert!(is_public_ip(public.parse().unwrap()), "{public}");
        }
    }

    #[test]
    fn reads_only_https_pages_on_known_help_sites() {
        assert!(readable(&url("https://support.microsoft.com/en-us/office/pivot"), &HELP));
        assert!(readable(&url("https://faq.whatsapp.com/123"), &HELP));
        assert!(!readable(&url("http://support.microsoft.com/x"), &HELP), "plain http");
        assert!(!readable(&url("https://blog.example.com/x"), &HELP), "not a help site");
        assert!(!readable(&url("https://127.0.0.1:8737/v1/models"), &HELP), "an address, not a name");
        assert!(!readable(&url("https://support.microsoft.com:8443/x"), &HELP), "another port");
        assert!(!readable(&url("https://user:pw@support.microsoft.com/x"), &HELP), "credentials");
        assert!(!readable(&url("https://support.microsoft.com.evil.example/x"), &HELP), "look-alike host");
    }

    #[test]
    fn shares_only_public_https_names_with_the_reading_service() {
        assert!(shareable(&url("https://blog.example.com/how-to")));
        assert!(!shareable(&url("https://localhost/x")));
        assert!(!shareable(&url("https://printer.local/x")));
        assert!(!shareable(&url("https://192.168.1.1/x")));
        assert!(!shareable(&url("http://blog.example.com/x")));
        assert!(!shareable(&url("https://intranet/x")));
    }
}
