//! The apps installed on this PC, as the Start menu lists them (shell:AppsFolder), so "Open WhatsApp"
//! can launch a packaged app that has no exe on the PATH. Only ids from this list are ever launched.

use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, State};
use windows::core::{Interface, GUID};
use windows::Win32::Foundation::{HWND, PROPERTYKEY};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, IEnumShellItems, IShellItem, IShellItem2, SHGetKnownFolderItem, FOLDERID_AppsFolder, KF_FLAG_DEFAULT,
    SIGDN, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
};

use super::identity::{expected_id, program_window_name, AppIdentity};
use crate::app_focus::{adopt, find_window};
use crate::app_launch::{shell_execute, wait_until_ready};
use crate::chat_context::WindowInfo;
use crate::perception::Perception;
use crate::surfaces::{self, FocusReturn};

/// Opening `shell:AppsFolder\<id>` launches an installed app exactly as its Start-menu tile does.
const APPS_FOLDER: &str = "shell:AppsFolder\\";
/// Installs and uninstalls are rare; a stale list is refreshed after this, or when an id isn't in it.
const MAX_AGE: Duration = Duration::from_secs(10 * 60);
/// Items fetched from the shell per call.
const BATCH: usize = 32;
/// Start-menu entries that are documents or web pages, not apps.
const DOCUMENT_EXTENSIONS: [&str; 10] = [".url", ".chm", ".txt", ".pdf", ".html", ".htm", ".rtf", ".msi", ".sln", ".md"];
/// Start-menu entries that are an app's paperwork, not the app.
const DOCUMENT_WORDS: [&str; 9] = ["uninstall", "readme", "read me", "documentation", "release notes", "license", "licence", "manual", "faq"];
/// PKEY_Link_TargetParsingPath: where a Start-menu shortcut leads ("C:\Program Files\WinRAR\WinRAR.exe").
const PKEY_LINK_TARGET: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xb9b4b3fc_2b51_4a42_b5d8_324146afcf25), pid: 2 };

/// Mirrors `InstalledApp` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AppKind {
    /// A Store/MSIX app: the id is its AUMID ("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").
    Packaged,
    /// A desktop app: an AUMID ("Microsoft.Office.EXCEL.EXE.15") or a path ("{KNOWNFOLDER}\\Vendor\\app.exe").
    Desktop,
    /// A launcher link such as "steam://rungameid/730".
    Link,
}

/// Mirrors `InstalledApp` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub kind: AppKind,
    /// A desktop app's windows report this as their app unless they carry its id: its program's description
    /// ("WinRAR archiver" for WinRAR). None when the entry doesn't lead to a program.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_name: Option<String>,
}

/// Help files, uninstallers, licences and web pages that the Start menu lists next to the apps.
pub fn is_documentation(name: &str, id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    let name = name.to_lowercase();
    id.starts_with("http://")
        || id.starts_with("https://")
        || DOCUMENT_EXTENSIONS.iter().any(|ext| id.ends_with(ext))
        || DOCUMENT_WORDS.iter().any(|word| name.contains(word))
        // "Get Help" is a Store app; a desktop entry called "... Help" is a help file.
        || (!id.contains('!') && name.split_whitespace().any(|w| w == "help"))
}

pub fn kind_of(id: &str) -> AppKind {
    if id.contains('!') {
        AppKind::Packaged
    } else if id.contains("://") {
        AppKind::Link
    } else {
        AppKind::Desktop
    }
}

/// One Start-menu entry, or None when it isn't an app.
pub fn entry(name: &str, id: &str) -> Option<InstalledApp> {
    let (name, id) = (name.trim(), id.trim());
    if name.is_empty() || id.is_empty() || is_documentation(name, id) {
        return None;
    }
    Some(InstalledApp { id: id.into(), name: name.into(), kind: kind_of(id), window_name: None })
}

/// Keeps the first entry per id (the shell can list an app twice).
fn dedupe(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    let mut seen = std::collections::HashSet::new();
    apps.into_iter().filter(|app| seen.insert(app.id.to_lowercase())).collect()
}

struct Loaded {
    apps: Arc<Vec<InstalledApp>>,
    at: Instant,
}

/// The cached list. Reads never wait for the shell, except `apps()`/`find()` when the list is stale.
pub struct AppCatalog {
    loaded: RwLock<Option<Loaded>>,
    /// Serializes refreshes so two callers don't enumerate the shell at once.
    refreshing: Mutex<()>,
    preloading: std::sync::atomic::AtomicBool,
}

/// One list for the whole app: window identity (any thread) and the commands share it.
pub fn shared() -> &'static AppCatalog {
    static CATALOG: OnceLock<AppCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| AppCatalog { loaded: RwLock::new(None), refreshing: Mutex::new(()), preloading: Default::default() })
}

impl AppCatalog {
    fn cached(&self, max_age: Duration) -> Option<Arc<Vec<InstalledApp>>> {
        let loaded = self.loaded.read().map_err(|e| eprintln!("the app list is unreadable: {e}")).ok()?;
        loaded.as_ref().filter(|l| l.at.elapsed() < max_age).map(|l| l.apps.clone())
    }

    /// Whatever is cached now, possibly empty. Starts loading the list in the background the first time.
    pub fn snapshot(&'static self) -> Arc<Vec<InstalledApp>> {
        if let Some(apps) = self.cached(Duration::MAX) {
            return apps;
        }
        if !self.preloading.swap(true, std::sync::atomic::Ordering::SeqCst) {
            thread::spawn(move || {
                if let Err(error) = self.refresh() {
                    eprintln!("couldn't list the installed apps: {error}");
                }
            });
        }
        Arc::new(Vec::new())
    }

    /// The list, refreshed first when it's older than ten minutes. Blocking.
    pub fn apps(&self) -> Result<Arc<Vec<InstalledApp>>, String> {
        match self.cached(MAX_AGE) {
            Some(apps) => Ok(apps),
            None => self.refresh(),
        }
    }

    /// The installed app with this id; on a miss the list is re-read once, for an app installed since. Blocking.
    pub fn find(&self, id: &str) -> Result<Option<InstalledApp>, String> {
        let lookup = |apps: &[InstalledApp]| apps.iter().find(|app| app.id == id).cloned();
        if let Some(found) = lookup(&self.apps()?) {
            return Ok(Some(found));
        }
        Ok(lookup(&self.refresh()?))
    }

    fn refresh(&self) -> Result<Arc<Vec<InstalledApp>>, String> {
        let _turn = self.refreshing.lock().map_err(|e| e.to_string())?;
        let apps = Arc::new(dedupe(enumerate_on_com_thread()?));
        let mut loaded = self.loaded.write().map_err(|e| e.to_string())?;
        *loaded = Some(Loaded { apps: apps.clone(), at: Instant::now() });
        Ok(apps)
    }
}

/// Shell folders want a single-threaded apartment; this gives them one of their own.
fn enumerate_on_com_thread() -> Result<Vec<InstalledApp>, String> {
    thread::spawn(|| {
        // SAFETY: paired with CoUninitialize below; nothing COM outlives `enumerate`.
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok().map_err(|e| format!("COM is unavailable: {e}"))?;
        let result = enumerate();
        // SAFETY: pairs with the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
        result
    })
    .join()
    .map_err(|_| "listing the installed apps crashed".to_string())?
}

fn display_name(item: &IShellItem, form: SIGDN) -> Result<String, String> {
    // SAFETY: the shell allocates the string; it's copied and then freed with CoTaskMemFree.
    unsafe {
        let raw = item.GetDisplayName(form).map_err(|e| e.to_string())?;
        let text = raw.to_string().map_err(|e| e.to_string());
        CoTaskMemFree(Some(raw.0 as *const _));
        text
    }
}

/// Where a Start-menu entry leads, when it's a shortcut. Packaged apps and shell folders lead nowhere.
fn link_target(item: &IShellItem) -> Option<String> {
    let item: IShellItem2 = item.cast().map_err(|e| log::warn!("couldn't read a Start-menu entry's properties: {e}")).ok()?;
    // SAFETY: the shell allocates the string; it's copied and then freed with CoTaskMemFree.
    unsafe {
        let raw = item.GetString(&PKEY_LINK_TARGET).map_err(|e| log::debug!("a Start-menu entry leads to no file: {e}")).ok()?;
        let text = raw.to_string();
        CoTaskMemFree(Some(raw.0 as *const _));
        text.map_err(|e| log::warn!("a Start-menu entry's target is unreadable: {e}")).ok()
    }
}

/// A desktop app with the name its windows will report, from the program its entry leads to.
fn with_window_name(mut app: InstalledApp, item: &IShellItem) -> InstalledApp {
    if app.kind == AppKind::Desktop {
        app.window_name = link_target(item).and_then(|target| program_window_name(&target));
    }
    app
}

fn enumerate() -> Result<Vec<InstalledApp>, String> {
    // SAFETY: COM is initialized on this thread by the caller; every interface is released on drop.
    let items: IEnumShellItems = unsafe {
        let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None).map_err(|e| e.to_string())?;
        folder.BindToHandler(None, &BHID_EnumItems).map_err(|e| e.to_string())?
    };
    let mut apps = Vec::new();
    loop {
        let mut batch: [Option<IShellItem>; BATCH] = Default::default();
        let mut fetched = 0u32;
        // SAFETY: `batch` and `fetched` outlive the call; S_FALSE with fewer items marks the end.
        unsafe { items.Next(&mut batch, Some(&mut fetched)) }.map_err(|e| e.to_string())?;
        for item in batch.iter().take(fetched as usize).flatten() {
            match (display_name(item, SIGDN_NORMALDISPLAY), display_name(item, SIGDN_PARENTRELATIVEPARSING)) {
                (Ok(name), Ok(id)) => apps.extend(entry(&name, &id).map(|app| with_window_name(app, item))),
                (Err(error), _) | (_, Err(error)) => eprintln!("skipping an installed app that couldn't be read: {error}"),
            }
        }
        if (fetched as usize) < BATCH {
            return Ok(apps);
        }
    }
}

/// The installed apps, for routing "Open WhatsApp" to an app the notch can launch.
#[tauri::command]
pub async fn list_apps() -> Result<Vec<InstalledApp>, String> {
    let apps = tauri::async_runtime::spawn_blocking(|| shared().apps()).await.map_err(|e| e.to_string())??;
    Ok(apps.as_ref().clone())
}

/// Opens installed app `id` (a catalog id, never an arbitrary command) as the Start menu would, waits for
/// its window, and makes it the window Hodey reads. An app that's already open is brought forward instead.
/// `None` when it didn't appear in time.
#[tauri::command]
pub async fn open_installed_app(
    window: tauri::WebviewWindow,
    handle: AppHandle,
    id: String,
    perception: State<'_, Perception>,
    focus: State<'_, FocusReturn>,
) -> Result<Option<WindowInfo>, String> {
    if window.label() != surfaces::NOTCH {
        return Err("Only Hodey's notch can open apps.".into());
    }
    let lookup = id.clone();
    let entry = tauri::async_runtime::spawn_blocking(move || shared().find(&lookup))
        .await
        .map_err(|e| e.to_string())??
        .ok_or_else(|| format!("`{id}` isn't an app installed on this PC."))?;
    let (expected, name) = (expected_id(&entry.id), entry.name.clone());
    let is_it = move |identity: &AppIdentity| identity.id == expected || (!identity.name.is_empty() && identity.name.eq_ignore_ascii_case(&name));
    if let Some((hwnd, identity)) = find_window(|_, identity| is_it(identity))? {
        return adopt(hwnd, &identity, &entry.name, &perception, &focus).map(Some);
    }
    shell_execute(&format!("{APPS_FOLDER}{}", entry.id), None)?;
    let find = move || find_window(|_, identity| is_it(identity));
    let Some((hwnd, identity)) = wait_until_ready(handle, entry.name.clone(), find).await? else { return Ok(None) };
    adopt(HWND(hwnd as *mut _), &identity, &entry.name, &perception, &focus).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_documentation_uninstallers_and_web_pages() {
        assert!(is_documentation("Documentation for Windows Store Apps", r"{7C5A}\Windows Kits\10\Shortcuts\WindowsStoreAppDevCenterLearn.url"));
        assert!(is_documentation("HP Scan - Uninstaller", r"{6D80}\HP\HP Scan\Bin\Uninstaller.exe"));
        assert!(is_documentation("Application Verifier Help", r"{1AC1}\appverif.chm"));
        assert!(is_documentation("Node.js website", "https://nodejs.org/"));
        assert!(is_documentation("Git Release Notes", r"{6D80}\Git\ReleaseNotes.html"));
        assert!(is_documentation("License (English)", r"{6D80}\Oracle\VirtualBox\License_en_US.rtf"));
        assert!(!is_documentation("Excel", "Microsoft.Office.EXCEL.EXE.15"));
        assert!(!is_documentation("Get Help", "Microsoft.GetHelp_8wekyb3d8bbwe!App"));
        assert!(!is_documentation("WhatsApp", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"));
        assert!(!is_documentation("Helper Studio", r"{6D80}\Helper\studio.exe"));
    }

    #[test]
    fn sorts_entries_into_packaged_desktop_and_links() {
        assert_eq!(kind_of("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), AppKind::Packaged);
        assert_eq!(kind_of("Microsoft.Office.EXCEL.EXE.15"), AppKind::Desktop);
        assert_eq!(kind_of(r"{6D809377-6AF0-444B-8957-A3773F02200E}\obs-studio\bin\64bit\obs64.exe"), AppKind::Desktop);
        assert_eq!(kind_of("steam://rungameid/730"), AppKind::Link);
    }

    #[test]
    fn builds_entries_and_drops_blank_or_documentation_ones() {
        let excel = entry(" Excel ", "Microsoft.Office.EXCEL.EXE.15").unwrap();
        assert_eq!((excel.name.as_str(), excel.kind), ("Excel", AppKind::Desktop));
        assert!(entry("", "Brave").is_none());
        assert!(entry("FAQ", "https://github.com/tesseract-ocr/tesseract/wiki/FAQ").is_none());
    }

    #[test]
    fn keeps_one_entry_per_id() {
        let apps = vec![entry("Brave", "Brave").unwrap(), entry("Brave Browser", "brave").unwrap(), entry("Edge", "MSEdge").unwrap()];
        let names: Vec<_> = dedupe(apps).into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["Brave", "Edge"]);
    }

    /// Live checks on this PC: `cargo test --lib apps::catalog::live -- --ignored --nocapture --test-threads=1`.
    mod live {
        use super::super::*;
        use crate::app_focus::find_window;
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

        const EXPECTED_APPS: [&str; 7] = ["Excel", "Word", "WhatsApp", "Settings", "Calculator", "Notepad", "Brave"];
        /// This PC lists 334 Start entries; far fewer means the enumeration broke.
        const MIN_APPS: usize = 100;
        const WINDOW_TIMEOUT: Duration = Duration::from_secs(20);
        const POLL: Duration = Duration::from_millis(500);

        fn named<'a>(apps: &'a [InstalledApp], name: &str) -> &'a InstalledApp {
            apps.iter().find(|a| a.name == name).unwrap_or_else(|| panic!("{name} isn't in the catalog"))
        }

        fn window_of(app: &InstalledApp) -> Option<(HWND, AppIdentity)> {
            let expected = expected_id(&app.id);
            find_window(|_, identity| identity.id == expected).unwrap()
        }

        /// Opens `app` from the catalog unless it's already open. Returns its window and whether we opened it.
        fn open(app: &InstalledApp) -> (HWND, AppIdentity, bool) {
            if let Some((hwnd, identity)) = window_of(app) {
                return (hwnd, identity, false);
            }
            let started = Instant::now();
            shell_execute(&format!("{APPS_FOLDER}{}", app.id), None).unwrap();
            while started.elapsed() < WINDOW_TIMEOUT {
                if let Some((hwnd, identity)) = window_of(app) {
                    println!("{} appeared after {} ms", app.name, started.elapsed().as_millis());
                    return (hwnd, identity, true);
                }
                thread::sleep(POLL);
            }
            panic!("{} didn't open within {WINDOW_TIMEOUT:?}", app.name);
        }

        fn close(hwnd: HWND) {
            // SAFETY: posting WM_CLOSE to a window we opened; tolerates a stale handle.
            unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) }.unwrap();
        }

        #[test]
        #[ignore = "reads this PC's Start menu"]
        fn lists_this_pcs_apps() {
            let started = Instant::now();
            let apps = shared().apps().unwrap();
            println!("{} apps in {} ms", apps.len(), started.elapsed().as_millis());
            assert!(apps.len() >= MIN_APPS, "only {} apps", apps.len());
            for name in EXPECTED_APPS {
                let app = named(&apps, name);
                println!("{name}: {} ({:?}) -> expects window id {}, window name {:?}", app.id, app.kind, expected_id(&app.id), app.window_name);
            }
            let desktop: Vec<_> = apps.iter().filter(|a| a.kind == AppKind::Desktop).collect();
            let with_window_name = desktop.iter().filter(|a| a.window_name.is_some()).count();
            println!("{with_window_name} of {} desktop apps have a window name", desktop.len());
            assert!(!apps.iter().any(|a| is_documentation(&a.name, &a.id)));
        }

        #[test]
        #[ignore = "opens and closes Calculator and Settings"]
        fn identifies_calculator_and_settings_opened_from_the_catalog() {
            let apps = shared().apps().unwrap();
            for (name, id) in [("Calculator", "calculator"), ("Settings", "settings")] {
                let (hwnd, identity, opened) = open(named(&apps, name));
                println!("{name}: hwnd={:?} {identity:?} opened_by_test={opened}", hwnd.0);
                assert_eq!((identity.id.as_str(), identity.name.as_str()), (id, name));
                if opened {
                    close(hwnd);
                }
            }
        }

        #[test]
        #[ignore = "opens and closes Notepad"]
        fn launches_notepad_by_catalog_id() {
            let apps = shared().apps().unwrap();
            let notepad = named(&apps, "Notepad");
            assert!(shared().find(&notepad.id).unwrap().is_some());
            let (hwnd, identity, opened) = open(notepad);
            println!("Notepad: hwnd={:?} {identity:?} opened_by_test={opened}", hwnd.0);
            assert_eq!(identity.id, "notepad");
            if opened {
                close(hwnd);
            }
        }

        #[test]
        #[ignore = "reads the windows open on this PC"]
        fn prints_the_identity_of_open_windows() {
            for hwnd in crate::chat_context::app_windows().unwrap() {
                let title = crate::perception::foreground::window_title(hwnd);
                println!("{title:?} -> {:?}", crate::apps::identity::identify_window(hwnd));
            }
        }
    }

    #[test]
    fn serializes_kind_in_lowercase() {
        let json = serde_json::to_string(&entry("Calculator", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").unwrap()).unwrap();
        assert!(json.contains(r#""kind":"packaged""#));
    }

    #[test]
    fn serializes_a_window_name_only_when_there_is_one() {
        let mut winrar = entry("WinRAR", r"{6D809377-6AF0-444B-8957-A3773F02200E}\WinRAR\WinRAR.exe").unwrap();
        assert!(!serde_json::to_string(&winrar).unwrap().contains("windowName"));
        winrar.window_name = Some("WinRAR archiver".into());
        assert!(serde_json::to_string(&winrar).unwrap().contains(r#""windowName":"WinRAR archiver""#));
    }
}
