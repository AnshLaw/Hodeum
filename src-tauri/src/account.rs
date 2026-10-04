//! Google sign-in from the desktop: a one-shot callback server on 127.0.0.1 and the system browser.
//! Hodeum's sign-in page brings back Google's ID token with the notch's state; only that state ends
//! the wait, and the notch hands the token to Supabase.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Must match DESKTOP_CALLBACK in src/features/account/google-identity.ts, the only address the sign-in page sends tokens to.
const CALLBACK_PORT: u16 = 47615;
const CALLBACK_PATH: &str = "/auth/callback";
const CALLBACK_EVENT: &str = "account:callback";
/// Long enough to pick an account and approve; then the learner can simply try again.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const ACCEPT_POLL: Duration = Duration::from_millis(100);
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 8 * 1024;
/// ShellExecuteW returns a value above this on success.
const SHELL_EXECUTE_OK: isize = 32;

static LISTENING: AtomicBool = AtomicBool::new(false);
/// The state of the sign-in the notch is waiting for; a retry replaces it.
static EXPECTED_STATE: Mutex<String> = Mutex::new(String::new());

/// What Hodeum's sign-in page sends back: Google's ID token and the state the notch gave it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Callback {
    #[serde(skip_serializing_if = "Option::is_none")]
    id_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Callback {
    fn failed(error: &str) -> Self {
        Self { id_token: None, state: None, error: Some(error.to_string()) }
    }

    /// Only the sign-in the notch is waiting for may end the wait; any other page hitting the port is ignored.
    fn belongs_to(&self, expected: &str) -> bool {
        self.state.as_deref() == Some(expected)
    }
}

fn redirect_url() -> String {
    format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}")
}

/// Reads `GET /auth/callback?id_token=…&state=…` (or `?error=…`). `None` for any other path, e.g. a favicon.
pub fn parse_callback(request_line: &str) -> Option<Callback> {
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1{}", parts.next()?)).ok()?;
    if url.path() != CALLBACK_PATH {
        return None;
    }
    let param = |name: &str| url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned()).filter(|value| !value.is_empty());
    let state = param("state");
    if let (Some(id_token), Some(_)) = (param("id_token"), &state) {
        return Some(Callback { id_token: Some(id_token), state, error: None });
    }
    let error = param("error").unwrap_or_else(|| "The browser came back without a Google sign-in.".into());
    Some(Callback { state, ..Callback::failed(&error) })
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn page(callback: &Callback) -> String {
    let (title, body) = match &callback.error {
        // Hodeum still has to check this token with Supabase, so the tab can't promise sign-in or sync yet.
        None => ("Almost done".to_string(), "Go back to Hodeum to finish signing in. Settings › Account shows when you're signed in and syncing, or why it didn't work.".to_string()),
        Some(error) => ("Sign-in didn't finish".to_string(), format!("{} You can close this tab and try again from Hodeum.", escape_html(error))),
    };
    format!(
        "<!doctype html><meta charset=utf-8><title>Hodeum</title><style>body{{font:16px system-ui;background:#0f0f12;color:#f4f1ea;display:grid;place-items:center;height:100vh;margin:0}}main{{max-width:28rem;text-align:center}}h1{{font-size:1.5rem}}p{{color:#b9b4aa}}</style><main><h1>{title}</h1><p>{body}</p></main>"
    )
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    if let Err(error) = stream.write_all(response.as_bytes()) {
        eprintln!("couldn't answer the sign-in browser tab: {error}");
    }
}

fn read_request_line(stream: &mut TcpStream) -> std::io::Result<String> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buffer.windows(2).any(|w| w == b"\r\n") && buffer.len() < MAX_REQUEST_BYTES {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Ok(String::from_utf8_lossy(&buffer).lines().next().unwrap_or_default().to_string())
}

/// Serves until the callback arrives or the sign-in times out; always emits exactly one result.
fn serve(app: AppHandle, listener: TcpListener) {
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    let result = loop {
        if Instant::now() > deadline {
            break Callback::failed("Sign-in timed out. Try again from Hodeum.");
        }
        match listener.accept() {
            Ok((mut stream, _)) => match read_request_line(&mut stream).map(|line| parse_callback(&line)) {
                Ok(Some(callback)) if callback.belongs_to(&expected_state()) => {
                    respond(&mut stream, "200 OK", &page(&callback));
                    break callback;
                }
                Ok(Some(_)) => respond(&mut stream, "403 Forbidden", &page(&Callback::failed("This isn't the sign-in Hodeum is waiting for."))),
                Ok(None) => respond(&mut stream, "404 Not Found", ""),
                Err(error) => eprintln!("ignoring an unreadable request on the sign-in port: {error}"),
            },
            Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(ACCEPT_POLL),
            Err(error) => break Callback::failed(&format!("The sign-in listener stopped: {error}")),
        }
    };
    LISTENING.store(false, Ordering::SeqCst);
    if let Err(error) = app.emit(CALLBACK_EVENT, result) {
        eprintln!("couldn't hand the sign-in result to Hodeum: {error}");
    }
}

fn expected_state() -> String {
    EXPECTED_STATE.lock().map(|state| state.clone()).unwrap_or_else(|poisoned| poisoned.into_inner().clone())
}

/// Starts the callback server (or reuses one already waiting) for the sign-in with this state; returns the redirect URL.
#[tauri::command]
pub fn auth_listen(app: AppHandle, state: String) -> Result<String, String> {
    if state.is_empty() {
        return Err("Sign-in needs a state to tell its own callback apart.".into());
    }
    *EXPECTED_STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = state;
    if LISTENING.swap(true, Ordering::SeqCst) {
        return Ok(redirect_url());
    }
    let bound = TcpListener::bind(("127.0.0.1", CALLBACK_PORT)).and_then(|listener| listener.set_nonblocking(true).map(|()| listener));
    let listener = bound.map_err(|error| {
        LISTENING.store(false, Ordering::SeqCst);
        format!("Port {CALLBACK_PORT} is busy, so sign-in can't listen for the browser: {error}")
    })?;
    thread::spawn(move || serve(app, listener));
    Ok(redirect_url())
}

/// Opens an https page (the Google sign-in) in the learner's default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("Not a valid link: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("Hodeum only opens https links in the browser.".into());
    }
    let operation = HSTRING::from("open");
    let file = HSTRING::from(parsed.as_str());
    // SAFETY: both strings outlive the call; no parent window or working directory.
    let result = unsafe { ShellExecuteW(None, &operation, &file, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    if result.0 as isize > SHELL_EXECUTE_OK {
        Ok(())
    } else {
        Err("Windows couldn't open your browser.".into())
    }
}

/// This PC's name, shown in the web dashboard's PC picker.
#[tauri::command]
pub fn device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_google_id_token_and_state() {
        let callback = parse_callback("GET /auth/callback?id_token=eyJ.a.b&state=s-1 HTTP/1.1");
        assert_eq!(callback, Some(Callback { id_token: Some("eyJ.a.b".into()), state: Some("s-1".into()), error: None }));
    }

    #[test]
    fn reads_the_sign_in_pages_error_with_its_state() {
        let callback = parse_callback("GET /auth/callback?error=The+user+closed+Google&state=s-1 HTTP/1.1");
        assert_eq!(callback, Some(Callback { id_token: None, state: Some("s-1".into()), error: Some("The user closed Google".into()) }));
    }

    #[test]
    fn only_the_awaited_sign_in_ends_the_wait() {
        let ours = parse_callback("GET /auth/callback?id_token=eyJ.a.b&state=s-1 HTTP/1.1").unwrap();
        let forged = parse_callback("GET /auth/callback?id_token=eyJ.x.y&state=other HTTP/1.1").unwrap();
        let stateless = parse_callback("GET /auth/callback?error=boom HTTP/1.1").unwrap();
        assert!(ours.belongs_to("s-1"));
        assert!(!forged.belongs_to("s-1"));
        assert!(!stateless.belongs_to("s-1"));
    }

    #[test]
    fn ignores_other_paths_and_methods() {
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(parse_callback("POST /auth/callback?id_token=abc&state=s HTTP/1.1"), None);
        assert_eq!(parse_callback(""), None);
    }

    #[test]
    fn a_token_without_its_state_is_an_error() {
        assert!(parse_callback("GET /auth/callback?id_token=eyJ.a.b HTTP/1.1").is_some_and(|c| c.id_token.is_none() && c.error.is_some()));
        assert!(parse_callback("GET /auth/callback HTTP/1.1").is_some_and(|c| c.id_token.is_none() && c.error.is_some()));
    }

    #[test]
    fn does_not_claim_success_before_hodeum_checks_the_token() {
        let ours = parse_callback("GET /auth/callback?id_token=eyJ.a.b&state=s-1 HTTP/1.1").unwrap();
        let shown = page(&ours);
        assert!(!shown.contains("You're signed in"));
        assert!(!shown.contains("now sync"));
        assert!(shown.contains("Settings"));
    }

    #[test]
    fn escapes_the_error_shown_in_the_browser() {
        assert!(page(&Callback::failed("<script>")).contains("&lt;script&gt;"));
    }
}
