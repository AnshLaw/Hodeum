//! Google sign-in from the desktop: a one-shot callback server on 127.0.0.1 and the system browser.
//! The browser brings back only a PKCE authorization code; the notch window exchanges it.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Must be listed in Supabase > Authentication > URL Configuration > Redirect URLs.
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Callback {
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Callback {
    fn failed(error: &str) -> Self {
        Self { code: None, error: Some(error.to_string()) }
    }
}

fn redirect_url() -> String {
    format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}")
}

/// Reads `GET /auth/callback?code=…` (or `?error=…`). `None` for any other path, e.g. a favicon.
pub fn parse_callback(request_line: &str) -> Option<Callback> {
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1{}", parts.next()?)).ok()?;
    if url.path() != CALLBACK_PATH {
        return None;
    }
    let param = |name: &str| url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned());
    if let Some(code) = param("code").filter(|code| !code.is_empty()) {
        return Some(Callback { code: Some(code), error: None });
    }
    let error = param("error_description").or_else(|| param("error")).unwrap_or_else(|| "The browser came back without a sign-in code.".into());
    Some(Callback::failed(&error))
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn page(callback: &Callback) -> String {
    let (title, body) = match &callback.error {
        None => ("You're signed in".to_string(), "Go back to Hodeum. Your skills and Hodes now sync to your account.".to_string()),
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
                Ok(Some(callback)) => {
                    respond(&mut stream, "200 OK", &page(&callback));
                    break callback;
                }
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

/// Starts the callback server (or reuses one already waiting) and returns the redirect URL.
#[tauri::command]
pub fn auth_listen(app: AppHandle) -> Result<String, String> {
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
    fn reads_the_authorization_code() {
        let callback = parse_callback("GET /auth/callback?code=abc-123&state=x HTTP/1.1");
        assert_eq!(callback, Some(Callback { code: Some("abc-123".into()), error: None }));
    }

    #[test]
    fn reads_the_providers_error() {
        let callback = parse_callback("GET /auth/callback?error=access_denied&error_description=The+user+denied+access HTTP/1.1");
        assert_eq!(callback, Some(Callback::failed("The user denied access")));
    }

    #[test]
    fn ignores_other_paths_and_methods() {
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(parse_callback("POST /auth/callback?code=abc HTTP/1.1"), None);
        assert_eq!(parse_callback(""), None);
    }

    #[test]
    fn a_callback_without_a_code_is_an_error() {
        assert!(parse_callback("GET /auth/callback HTTP/1.1").is_some_and(|c| c.code.is_none() && c.error.is_some()));
    }

    #[test]
    fn escapes_the_error_shown_in_the_browser() {
        assert!(page(&Callback::failed("<script>")).contains("&lt;script&gt;"));
    }
}
