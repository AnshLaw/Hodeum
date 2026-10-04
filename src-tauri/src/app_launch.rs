//! Agent mode opens the task pack's app for the learner, with the practice file the pack ships, so
//! Hodey can start on the steps instead of asking the learner to set everything up first.

use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::app_focus::{bring_forward, find_app, find_app_titled};
use crate::chat_context::WindowInfo;
use crate::perception::foreground::window_title;
use crate::perception::Perception;
use crate::surfaces::{self, FocusReturn};

/// ShellExecuteW returns a value above this on success.
const SHELL_EXECUTE_OK: isize = 32;
/// How long a launched app gets to show its window (Excel's first start can be slow).
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);
const LAUNCH_POLL: Duration = Duration::from_millis(500);
/// Practice files shipped with the app (tauri.conf.json bundle.resources).
const SAMPLES_DIR: &str = "resources/samples";
/// Where the learner's copy goes: Documents\Hodeum, so the bundled file is never changed.
const PRACTICE_DIR: &str = "Hodeum";

/// A bare file name ("excel.exe", "hodeum-sales.csv"): no paths or arguments, so the notch can't run arbitrary files.
pub fn is_bare_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// The learner's fresh copy of a shipped practice file.
fn practice_copy(app: &AppHandle, sample: &str) -> Result<PathBuf, String> {
    let source = app.path().resolve(format!("{SAMPLES_DIR}/{sample}"), BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join(PRACTICE_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make {}: {e}", dir.display()))?;
    let target = dir.join(sample);
    // Fresh each time so every practice starts from the same table; if the learner has it open, theirs is used.
    if let Err(error) = fs::copy(&source, &target) {
        if !target.exists() {
            return Err(format!("Couldn't copy the practice file {}: {error}", source.display()));
        }
        eprintln!("kept the learner's practice file (couldn't refresh it): {error}");
    }
    Ok(target)
}

fn shell_open(target: &str) -> Result<(), String> {
    let operation = HSTRING::from("open");
    let file = HSTRING::from(target);
    // SAFETY: both strings outlive the call; no parent window or working directory.
    let result = unsafe { ShellExecuteW(None, &operation, &file, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    if result.0 as isize > SHELL_EXECUTE_OK {
        Ok(())
    } else {
        Err(format!("Windows couldn't open {target}."))
    }
}

/// Waits for the app's window (the one showing `title_hint`, when given). Returns its handle as an integer.
fn wait_for_window(app: &str, title_hint: Option<&str>) -> Result<Option<isize>, String> {
    let started = Instant::now();
    while started.elapsed() < LAUNCH_TIMEOUT {
        let found = match title_hint {
            Some(hint) => find_app_titled(app, hint)?,
            None => find_app(app)?,
        };
        if let Some(hwnd) = found {
            return Ok(Some(hwnd.0 as isize));
        }
        thread::sleep(LAUNCH_POLL);
    }
    Ok(None)
}

/// Opens `exe` (or the pack's practice file `sample` in its default app) and makes it the window Hodey reads.
/// `None` when it didn't appear in time; the notch then asks the learner to open it.
#[tauri::command]
pub async fn launch_app(
    window: tauri::WebviewWindow,
    handle: AppHandle,
    app: String,
    exe: String,
    sample: Option<String>,
    perception: State<'_, Perception>,
    focus: State<'_, FocusReturn>,
) -> Result<Option<WindowInfo>, String> {
    if window.label() != surfaces::NOTCH {
        return Err("Only Hodey's notch can open apps.".into());
    }
    if !is_bare_name(&exe) || !sample.as_deref().is_none_or(is_bare_name) {
        return Err("Hodey only opens apps and practice files by name.".into());
    }
    let opened = match &sample {
        Some(name) => practice_copy(&handle, name)?.to_string_lossy().into_owned(),
        None => exe,
    };
    shell_open(&opened)?;
    let hint = sample.as_deref().map(|name| name.rsplit_once('.').map_or(name, |(stem, _)| stem).to_string());
    let app_name = app.clone();
    let found = tauri::async_runtime::spawn_blocking(move || wait_for_window(&app_name, hint.as_deref())).await.map_err(|e| e.to_string())??;
    let Some(id) = found else { return Ok(None) };
    let hwnd = HWND(id as *mut _);
    perception.remember(id);
    focus.redirect(id)?;
    if let Err(reason) = bring_forward(hwnd) {
        eprintln!("couldn't bring {app} forward after opening it: {reason}");
    }
    Ok(Some(WindowInfo { id: id.to_string(), title: window_title(hwnd), app }))
}

#[cfg(test)]
mod tests {
    use super::is_bare_name;

    #[test]
    fn opens_only_bare_names() {
        assert!(is_bare_name("excel.exe"));
        assert!(is_bare_name("hodeum-sales.csv"));
        assert!(!is_bare_name("C:\\Windows\\System32\\cmd.exe"));
        assert!(!is_bare_name("..\\secret.txt"));
        assert!(!is_bare_name("excel.exe /e"));
        assert!(!is_bare_name(""));
    }
}
