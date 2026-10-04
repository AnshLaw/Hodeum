//! Opens the task pack's app for the learner, with the practice file or folder the pack ships, so Hodey
//! can start on the steps instead of asking the learner to set everything up first. Also the shared
//! "wait until the app is really there" used when opening an installed app by name.

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use uiautomation::types::Handle;
use uiautomation::{UIAutomation, UIElement};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::app_focus::{adopt, find_app, find_app_titled};
use crate::apps::identity::AppIdentity;
use crate::chat_context::WindowInfo;
use crate::perception::foreground::{class_name, core_window_child, window_title, FRAME_CLASS};
use crate::perception::Perception;
use crate::surfaces::{self, FocusReturn};

/// Tells the notch an app is slow to start, so it can say so instead of looking stuck.
pub const LAUNCH_PROGRESS_EVENT: &str = "apps:launch-progress";
/// ShellExecuteW returns a value above this on success.
const SHELL_EXECUTE_OK: isize = 32;
/// How long a launched app gets to show its window (measured: Excel's cold start took 21 s here).
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(45);
const LAUNCH_POLL: Duration = Duration::from_millis(500);
/// Progress is reported once a launch has taken this long, then every second.
const PROGRESS_AFTER: Duration = Duration::from_secs(5);
const PROGRESS_EVERY: Duration = Duration::from_secs(1);
/// After the window appears its controls can still be loading (Calculator: 7 controls, 71 after 3 s).
const SETTLE_TIMEOUT: Duration = Duration::from_secs(10);
const SETTLE_POLL: Duration = Duration::from_millis(300);
/// Unchanged looks in a row, after the first, that count as settled.
const SETTLE_STABLE_LOOKS: u32 = 2;
/// Fewer controls than this means the app hasn't drawn its content yet.
const MIN_CONTENT_CONTROLS: usize = 10;
/// Counting stops here; more than this is plenty to call the app loaded.
const CONTENT_COUNT_CAP: usize = 60;
/// Titles shown while an app is still loading (measured: Excel shows "Opening - Excel").
const LOADING_TITLES: [&str; 1] = ["Opening"];
/// Practice files shipped with the app (tauri.conf.json bundle.resources).
const SAMPLES_DIR: &str = "resources/samples";
/// Where the learner's copy goes: Documents\Hodeum, so the bundled file is never changed.
const PRACTICE_DIR: &str = "Hodeum";
/// Archives a previous zip practice left behind; they would make "you made a zip" pass before the learner acts.
const LEFTOVER_ARCHIVES: [&str; 3] = [".zip", ".7z", ".tar"];
/// The only links Hodey opens: a Settings page or Calculator.
const SETTINGS_SCHEME: &str = "ms-settings:";
const CALCULATOR_URI: &str = "calculator:";
/// The only programs Hodey starts: the ones the task packs launch (`launch.exe` in src/task-packs/*.json).
/// A pack that needs another adds it here; `every_task_pack_launch_is_allowed` checks the packs against it.
const LESSON_PROGRAMS: [&str; 3] = ["excel.exe", "calc.exe", "notepad.exe"];
const NAMES_AND_LINKS_ONLY: &str = "Hodey only opens apps and practice files by name, and only Settings or Calculator links.";

/// Payload of `LAUNCH_PROGRESS_EVENT`.
#[derive(Debug, Clone, Serialize)]
pub struct LaunchProgress {
    pub app: String,
    pub seconds: u64,
}

/// A bare file name ("hodeum-sales.csv", "hodeum-trip"): no paths or arguments, so a practice file can't name another file.
pub fn is_bare_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// One of the programs the lessons use. Anything else (cmd.exe, mshta.exe) is never started, whoever asks.
pub fn is_lesson_program(exe: &str) -> bool {
    LESSON_PROGRAMS.iter().any(|program| program.eq_ignore_ascii_case(exe))
}

/// A link Hodey may open: `ms-settings:<page>` (lowercase letters, digits, dashes) or `calculator:`.
pub fn is_launch_uri(uri: &str) -> bool {
    uri == CALCULATOR_URI
        || uri
            .strip_prefix(SETTINGS_SCHEME)
            .is_some_and(|page| !page.is_empty() && page.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
}

pub fn is_leftover_archive(file_name: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    LEFTOVER_ARCHIVES.iter().any(|ext| name.ends_with(ext))
}

/// What a pack asks to open: an app by exe (with an optional practice file or folder), or a link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchTarget {
    Exe { exe: String, sample: Option<String> },
    Uri(String),
}

impl LaunchTarget {
    /// Exactly one of `exe`/`uri`: a lesson program (with a practice file by bare name), or an allowed link.
    pub fn parse(exe: Option<String>, uri: Option<String>, sample: Option<String>) -> Result<Self, String> {
        match (exe, uri) {
            (Some(exe), None) => Self::program(exe, sample),
            (None, Some(uri)) if is_launch_uri(&uri) && sample.is_none() => Ok(Self::Uri(uri)),
            (None, Some(_)) => Err(NAMES_AND_LINKS_ONLY.into()),
            (Some(_), Some(_)) | (None, None) => Err("Hodey opens an app either by name or by link, not both.".into()),
        }
    }

    fn program(exe: String, sample: Option<String>) -> Result<Self, String> {
        if !is_bare_name(&exe) || !sample.as_deref().is_none_or(is_bare_name) {
            return Err(NAMES_AND_LINKS_ONLY.into());
        }
        if !is_lesson_program(&exe) {
            return Err(format!("Hodey only opens the programs its lessons use ({}), not {exe}.", LESSON_PROGRAMS.join(", ")));
        }
        Ok(Self::Exe { exe, sample })
    }

    /// What the app's title will show once the practice file is open ("hodeum-sales", "hodeum-trip").
    pub fn title_hint(&self) -> Option<String> {
        match self {
            Self::Exe { sample: Some(name), .. } => Some(name.rsplit_once('.').map_or(name.as_str(), |(stem, _)| stem).to_string()),
            _ => None,
        }
    }
}

/// Feeds looks at a just-opened window; settled once its title and controls hold still, past loading.
#[derive(Debug, Default)]
pub struct Settle {
    last: Option<(String, usize)>,
    stable: u32,
}

impl Settle {
    pub fn observe(&mut self, title: &str, controls: usize) -> bool {
        let loading = LOADING_TITLES.iter().any(|prefix| title.starts_with(prefix)) || controls < MIN_CONTENT_CONTROLS;
        let look = (title.to_string(), controls);
        let same = self.last.as_ref() == Some(&look);
        self.last = Some(look);
        self.stable = if same && !loading { self.stable + 1 } else { 0 };
        self.stable >= SETTLE_STABLE_LOOKS
    }
}

fn copy_file(source: &Path, target: &Path) -> Result<(), String> {
    // Fresh each time so every practice starts the same; if the learner has it open, theirs is used.
    if let Err(error) = fs::copy(source, target) {
        if !target.exists() {
            return Err(format!("Couldn't copy the practice file {}: {error}", source.display()));
        }
        eprintln!("kept the learner's practice file {} (couldn't refresh it): {error}", target.display());
    }
    Ok(())
}

fn remove_leftover_archives(dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("Couldn't read {}: {e}", dir.display()))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            remove_leftover_archives(&path)?;
        } else if path.file_name().is_some_and(|name| is_leftover_archive(&name.to_string_lossy())) {
            fs::remove_file(&path).map_err(|e| format!("Couldn't clear the old archive {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Copies a practice folder over the learner's copy, clearing archives a previous practice made.
fn copy_folder(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| format!("Couldn't make {}: {e}", target.display()))?;
    remove_leftover_archives(target)?;
    for entry in fs::read_dir(source).map_err(|e| format!("Couldn't read {}: {e}", source.display()))? {
        let from = entry.map_err(|e| e.to_string())?.path();
        let Some(name) = from.file_name() else { continue };
        if from.is_dir() {
            copy_folder(&from, &target.join(name))?;
        } else {
            copy_file(&from, &target.join(name))?;
        }
    }
    Ok(())
}

/// The learner's fresh copy of a shipped practice file or folder.
fn practice_copy(app: &AppHandle, sample: &str) -> Result<PathBuf, String> {
    let source = app.path().resolve(format!("{SAMPLES_DIR}/{sample}"), BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join(PRACTICE_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make {}: {e}", dir.display()))?;
    let target = dir.join(sample);
    if source.is_dir() {
        copy_folder(&source, &target)?;
    } else {
        copy_file(&source, &target)?;
    }
    Ok(target)
}

/// Opens `target` (an exe name, a link, or `shell:AppsFolder\<id>`) the way the Start menu would.
pub(crate) fn shell_execute(target: &str, argument: Option<&Path>) -> Result<(), String> {
    let operation = HSTRING::from("open");
    let file = HSTRING::from(target);
    let parameters = argument.map(|path| HSTRING::from(format!("\"{}\"", path.display())));
    let parameters = parameters.as_ref().map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr()));
    // SAFETY: every string outlives the call; no parent window or working directory.
    let result = unsafe { ShellExecuteW(None, &operation, &file, parameters, PCWSTR::null(), SW_SHOWNORMAL) };
    if result.0 as isize > SHELL_EXECUTE_OK {
        Ok(())
    } else {
        Err(format!("Windows couldn't open {target}."))
    }
}

fn start(handle: &AppHandle, target: &LaunchTarget) -> Result<(), String> {
    match target {
        // Explicitly with the file, so the pack's app opens it whatever the file association says.
        LaunchTarget::Exe { exe, sample: Some(sample) } => shell_execute(exe, Some(&practice_copy(handle, sample)?)),
        LaunchTarget::Exe { exe, sample: None } => shell_execute(exe, None),
        LaunchTarget::Uri(uri) => shell_execute(uri, None),
    }
}

fn report_progress(handle: &AppHandle, app: &str, waited: Duration) {
    let progress = LaunchProgress { app: app.to_string(), seconds: waited.as_secs() };
    if let Err(error) = handle.emit(LAUNCH_PROGRESS_EVENT, progress) {
        eprintln!("couldn't report {app}'s launch progress: {error}");
    }
}

type Found = Option<(isize, AppIdentity)>;

/// Polls `find` until the app's window appears (up to 45 s), reporting progress after 5 s. Blocking.
fn wait_for_window(handle: &AppHandle, app: &str, find: impl Fn() -> Result<Option<(HWND, AppIdentity)>, String>) -> Result<Found, String> {
    let started = Instant::now();
    let mut next_report = PROGRESS_AFTER;
    while started.elapsed() < LAUNCH_TIMEOUT {
        if let Some((hwnd, identity)) = find()? {
            return Ok(Some((hwnd.0 as isize, identity)));
        }
        if started.elapsed() >= next_report {
            report_progress(handle, app, started.elapsed());
            next_report += PROGRESS_EVERY;
        }
        thread::sleep(LAUNCH_POLL);
    }
    Ok(None)
}

/// How many controls the window shows, counted up to `CONTENT_COUNT_CAP`.
fn count_controls(automation: &UIAutomation, hwnd: isize) -> Result<usize, String> {
    let err = |e: uiautomation::Error| e.to_string();
    let walker = automation.get_control_view_walker().map_err(err)?;
    let mut pending: Vec<UIElement> = vec![automation.element_from_handle(Handle::from(hwnd)).map_err(err)?];
    let mut count = 0;
    while let Some(element) = pending.pop() {
        count += 1;
        if count >= CONTENT_COUNT_CAP {
            break;
        }
        let mut child = walker.get_first_child(&element).ok();
        while let Some(current) = child {
            child = walker.get_next_sibling(&current).ok();
            pending.push(current);
        }
    }
    Ok(count)
}

/// Waits (at most 10 s) until a just-opened window has drawn its controls. Blocking.
fn settle(hwnd: isize) {
    let automation = match UIAutomation::new() {
        Ok(automation) => automation,
        Err(error) => return eprintln!("couldn't wait for the app to load (UI Automation is unavailable): {error}"),
    };
    let window = HWND(hwnd as *mut _);
    let started = Instant::now();
    let mut settle = Settle::default();
    while started.elapsed() < SETTLE_TIMEOUT {
        // A Store app's content is in its CoreWindow child; until that exists, nothing is drawn.
        let drawn = class_name(window) != FRAME_CLASS || core_window_child(window).is_some();
        let controls = if drawn { count_controls(&automation, hwnd).unwrap_or(0) } else { 0 };
        if settle.observe(&window_title(window), controls) {
            return;
        }
        thread::sleep(SETTLE_POLL);
    }
    eprintln!("the app still looked busy after {} s; starting anyway", SETTLE_TIMEOUT.as_secs());
}

/// Waits for the app's window and its content, off the async runtime.
pub(crate) async fn wait_until_ready(
    handle: AppHandle,
    app: String,
    find: impl Fn() -> Result<Option<(HWND, AppIdentity)>, String> + Send + 'static,
) -> Result<Found, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let found = wait_for_window(&handle, &app, find)?;
        if let Some((hwnd, _)) = &found {
            settle(*hwnd);
        }
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the pack's app: `exe`, one of the lesson programs (with the practice file or folder `sample` as its
/// argument), or an allowed `uri`, then makes it the window Hodey reads. Any other program is refused. `None`
/// when it didn't appear in time; the notch then asks the learner to open it.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri passes each command argument separately.
pub async fn launch_app(
    window: tauri::WebviewWindow,
    handle: AppHandle,
    app: String,
    exe: Option<String>,
    uri: Option<String>,
    sample: Option<String>,
    perception: State<'_, Perception>,
    focus: State<'_, FocusReturn>,
) -> Result<Option<WindowInfo>, String> {
    if window.label() != surfaces::NOTCH {
        return Err("Only Hodey's notch can open apps.".into());
    }
    let target = LaunchTarget::parse(exe, uri, sample)?;
    // An app opened without a file is already set up when it's open; a second window would only confuse.
    if matches!(target, LaunchTarget::Exe { sample: None, .. }) {
        if let Some((hwnd, identity)) = find_app(&app)? {
            return adopt(hwnd, &identity, &app, &perception, &focus).map(Some);
        }
    }
    start(&handle, &target)?;
    let (wanted, hint) = (app.clone(), target.title_hint());
    let find = move || match &hint {
        Some(hint) => find_app_titled(&wanted, hint),
        None => find_app(&wanted),
    };
    let Some((id, identity)) = wait_until_ready(handle, app.clone(), find).await? else { return Ok(None) };
    adopt(HWND(id as *mut _), &identity, &app, &perception, &focus).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_bare_names() {
        assert!(is_bare_name("excel.exe"));
        assert!(is_bare_name("hodeum-sales.csv"));
        assert!(is_bare_name("hodeum-trip"));
        assert!(!is_bare_name("C:\\Windows\\System32\\cmd.exe"));
        assert!(!is_bare_name("..\\secret.txt"));
        assert!(!is_bare_name("excel.exe /e"));
        assert!(!is_bare_name(""));
    }

    #[test]
    fn opens_only_settings_pages_and_calculator_links() {
        assert!(is_launch_uri("ms-settings:colors"));
        assert!(is_launch_uri("ms-settings:personalization-background"));
        assert!(is_launch_uri("ms-settings:nightlight"));
        assert!(is_launch_uri("calculator:"));
        assert!(!is_launch_uri("ms-settings:"));
        assert!(!is_launch_uri("ms-settings:Colors"));
        assert!(!is_launch_uri("ms-settings:colors?x=1"));
        assert!(!is_launch_uri("ms-settings:colors "));
        assert!(!is_launch_uri("calculator:1+1"));
        assert!(!is_launch_uri("https://example.com"));
        assert!(!is_launch_uri("file:///C:/Windows/System32/cmd.exe"));
        assert!(!is_launch_uri("shell:AppsFolder\\x"));
    }

    #[test]
    fn needs_exactly_one_of_exe_and_uri() {
        let some = |s: &str| Some(s.to_string());
        assert_eq!(LaunchTarget::parse(some("excel.exe"), None, some("hodeum-sales.csv")), Ok(LaunchTarget::Exe { exe: "excel.exe".into(), sample: some("hodeum-sales.csv") }));
        assert_eq!(LaunchTarget::parse(None, some("ms-settings:colors"), None), Ok(LaunchTarget::Uri("ms-settings:colors".into())));
        assert!(LaunchTarget::parse(some("calc.exe"), some("calculator:"), None).is_err());
        assert!(LaunchTarget::parse(None, None, None).is_err());
        assert!(LaunchTarget::parse(None, some("ms-settings:colors"), some("x.txt")).is_err());
        assert!(LaunchTarget::parse(some("cmd.exe /c x"), None, None).is_err());
        assert!(LaunchTarget::parse(some("explorer.exe"), None, some("..\\x")).is_err());
    }

    #[test]
    fn opens_only_the_programs_the_lessons_use() {
        for exe in ["excel.exe", "calc.exe", "notepad.exe", "EXCEL.EXE"] {
            assert!(LaunchTarget::parse(Some(exe.into()), None, None).is_ok(), "{exe} should open");
        }
        for exe in ["cmd.exe", "powershell.exe", "pwsh.exe", "mshta.exe", "regedit.exe", "wscript.exe", "rundll32.exe", "explorer.exe", "excel"] {
            let refused = LaunchTarget::parse(Some(exe.into()), None, None).expect_err(exe);
            assert!(refused.contains("only opens the programs its lessons use"), "{exe}: {refused}");
        }
    }

    #[test]
    fn a_practice_file_only_goes_to_a_lesson_program() {
        let some = |s: &str| Some(s.to_string());
        assert!(LaunchTarget::parse(some("mshta.exe"), None, some("hodeum-sales.csv")).is_err());
        assert!(LaunchTarget::parse(some("excel.exe"), None, some("hodeum-sales.csv")).is_ok());
    }

    /// A pack whose program isn't allowed here would fail to open its app: add the program to `LESSON_PROGRAMS`.
    #[test]
    fn every_task_pack_launch_is_allowed() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/task-packs");
        let mut launches = 0;
        for entry in fs::read_dir(&dir).expect("the task packs folder is readable") {
            let path = entry.expect("a task pack entry").path();
            if path.extension().is_none_or(|ext| ext != "json") {
                continue;
            }
            let pack: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).expect("a readable pack")).expect("a JSON pack");
            let Some(launch) = pack.get("launch") else { continue };
            let field = |name: &str| launch.get(name).and_then(serde_json::Value::as_str).map(String::from);
            let parsed = LaunchTarget::parse(field("exe"), field("uri"), field("sample"));
            assert!(parsed.is_ok(), "{} launches something launch_app refuses: {parsed:?}", path.display());
            launches += 1;
        }
        assert!(launches > 0, "no task pack launches found in {}", dir.display());
    }

    #[test]
    fn hints_the_title_by_the_practice_file_or_folder() {
        let exe = |sample: Option<&str>| LaunchTarget::Exe { exe: "x.exe".into(), sample: sample.map(Into::into) };
        assert_eq!(exe(Some("hodeum-sales.csv")).title_hint().as_deref(), Some("hodeum-sales"));
        assert_eq!(exe(Some("hodeum-trip")).title_hint().as_deref(), Some("hodeum-trip"));
        assert_eq!(exe(None).title_hint(), None);
        assert_eq!(LaunchTarget::Uri("calculator:".into()).title_hint(), None);
    }

    #[test]
    fn clears_only_archives() {
        assert!(is_leftover_archive("beach.zip"));
        assert!(is_leftover_archive("Beach.ZIP"));
        assert!(is_leftover_archive("trip.7z"));
        assert!(is_leftover_archive("trip.tar"));
        assert!(!is_leftover_archive("beach.txt"));
        assert!(!is_leftover_archive("zip-notes.txt"));
    }

    #[test]
    fn settles_once_title_and_controls_hold_still() {
        let mut settle = Settle::default();
        assert!(!settle.observe("Calculator", 7)); // still drawing
        assert!(!settle.observe("Calculator", 60));
        assert!(!settle.observe("Calculator", 60));
        assert!(settle.observe("Calculator", 60));
    }

    #[test]
    fn waits_out_loading_titles_and_changes() {
        let mut settle = Settle::default();
        for _ in 0..5 {
            assert!(!settle.observe("Opening - Excel", 60));
        }
        assert!(!settle.observe("Excel", 60));
        assert!(!settle.observe("Excel", 60));
        assert!(!settle.observe("Book1 - Excel", 60)); // changed: start over
        assert!(!settle.observe("Book1 - Excel", 60));
        assert!(settle.observe("Book1 - Excel", 60));
    }

    #[test]
    fn copies_a_practice_folder_and_clears_old_archives() {
        let root = std::env::temp_dir().join(format!("hodeum-practice-test-{}", std::process::id()));
        let (source, target) = (root.join("source"), root.join("target"));
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("beach.txt"), "sand").unwrap();
        fs::write(source.join("nested").join("hotel.txt"), "room").unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("beach.zip"), "old").unwrap();
        fs::write(target.join("notes.txt"), "mine").unwrap();
        copy_folder(&source, &target).unwrap();
        assert_eq!(fs::read_to_string(target.join("beach.txt")).unwrap(), "sand");
        assert_eq!(fs::read_to_string(target.join("nested").join("hotel.txt")).unwrap(), "room");
        assert!(!target.join("beach.zip").exists());
        assert!(target.join("notes.txt").exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
