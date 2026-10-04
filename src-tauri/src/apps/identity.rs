//! Which app a window belongs to: a stable id ("excel", "settings") and a friendly name ("Excel"), also
//! for Store apps drawn inside ApplicationFrameHost (Settings, Calculator) and packaged Win32 apps
//! (WhatsApp, whose process is "WhatsApp.Root").

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use windows::core::{GUID, HSTRING, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, PROPERTYKEY};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToBSTR};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};

use super::catalog::{self, InstalledApp};
use crate::perception::foreground::{class_name, core_window_child, exe_path, is_transient_shell, window_pid, FRAME_CLASS};

/// Start, Search, Alt+Tab and the taskbar: the learner is passing through, not in an app.
pub const SHELL_ID: &str = "windows-shell";
const SHELL_NAME: &str = "Windows";
/// The Store-app frame host on its own says nothing about the app inside it.
const FRAME_HOST: &str = "applicationframehost";
/// PKEY_AppUserModel_ID: the AUMID a window was given (Store apps, browsers and their web apps).
const PKEY_APP_USER_MODEL_ID: PROPERTYKEY =
    PROPERTYKEY { fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3), pid: 5 };
/// Generous for an AUMID (the documented maximum is 130 characters).
const AUMID_BUFFER: usize = 512;
/// The first language/code page pair of a version resource, as "\\StringFileInfo\\{lang}{cp}\\..." wants it.
const TRANSLATION_QUERY: &str = "\\VarFileInfo\\Translation";

/// Mirrors the `app`/`appId` pair on `ScreenObservation` and `WindowRef` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppIdentity {
    /// Stable id ("excel", "file-explorer"), else the lowercased AUMID or exe stem. Empty when unknown.
    pub id: String,
    /// Friendly name for the notch ("File Explorer"). Empty when unknown, so app checks never block on it.
    pub name: String,
    /// Executable stem of the process that draws the app's content ("CalculatorApp", not "ApplicationFrameHost").
    pub exe: String,
}

/// An app Hodeum knows by name, with every way Windows identifies it.
pub struct Known {
    pub id: &'static str,
    pub name: &'static str,
    /// Lowercase executable stems.
    exes: &'static [&'static str],
    /// Lowercase AUMIDs; one ending in '_' or '.' is a prefix (package family, Office version).
    aumids: &'static [&'static str],
}

const KNOWN: &[Known] = &[
    Known { id: "excel", name: "Excel", exes: &["excel"], aumids: &["microsoft.office.excel.exe."] },
    Known { id: "word", name: "Word", exes: &["winword"], aumids: &["microsoft.office.winword.exe."] },
    Known { id: "powerpoint", name: "PowerPoint", exes: &["powerpnt"], aumids: &["microsoft.office.powerpnt.exe."] },
    Known { id: "file-explorer", name: "File Explorer", exes: &["explorer"], aumids: &["microsoft.windows.explorer"] },
    Known { id: "settings", name: "Settings", exes: &["systemsettings"], aumids: &["windows.immersivecontrolpanel_"] },
    Known { id: "calculator", name: "Calculator", exes: &["calculatorapp", "calc"], aumids: &["microsoft.windowscalculator_"] },
    Known { id: "notepad", name: "Notepad", exes: &["notepad"], aumids: &["microsoft.windowsnotepad_"] },
    Known { id: "paint", name: "Paint", exes: &["mspaint"], aumids: &["microsoft.paint_"] },
    Known { id: "brave", name: "Brave", exes: &["brave"], aumids: &["brave"] },
    Known { id: "chrome", name: "Chrome", exes: &["chrome"], aumids: &["chrome"] },
    Known { id: "edge", name: "Edge", exes: &["msedge"], aumids: &["msedge"] },
    Known { id: "whatsapp", name: "WhatsApp", exes: &["whatsapp.root", "whatsapp"], aumids: &["5319275a.whatsappdesktop_"] },
    // Not in the shared id list, kept so the names the notch showed before stay the same.
    Known { id: "outlook", name: "Outlook", exes: &["outlook", "olk"], aumids: &["microsoft.office.outlook.exe.", "microsoft.outlookforwindows_"] },
    Known { id: "code", name: "VS Code", exes: &["code"], aumids: &["microsoft.visualstudiocode"] },
];

fn aumid_matches(pattern: &str, aumid: &str) -> bool {
    if pattern.ends_with('_') || pattern.ends_with('.') {
        aumid.starts_with(pattern)
    } else {
        aumid == pattern
    }
}

pub fn known_by_exe(exe: &str) -> Option<&'static Known> {
    let exe = exe.to_ascii_lowercase();
    KNOWN.iter().find(|k| k.exes.contains(&exe.as_str()))
}

pub fn known_by_aumid(aumid: &str) -> Option<&'static Known> {
    let aumid = aumid.to_ascii_lowercase();
    KNOWN.iter().find(|k| k.aumids.iter().any(|p| aumid_matches(p, &aumid)))
}

/// Friendly name for an executable stem: the known name, "" for the bare Store-app frame host, else the stem.
pub fn name_for_exe(exe: &str) -> String {
    match known_by_exe(exe) {
        Some(known) => known.name.into(),
        None if exe.eq_ignore_ascii_case(FRAME_HOST) => String::new(),
        None => exe.to_string(),
    }
}

fn stem_of(path: &str) -> String {
    Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn identity(id: &str, name: &str, exe: &str) -> AppIdentity {
    AppIdentity { id: id.into(), name: name.into(), exe: exe.into() }
}

/// The id/name an AUMID stands for: a known app, else the installed app with that id.
fn by_aumid(aumid: &str, exe: &str, catalog: &[InstalledApp]) -> Option<AppIdentity> {
    if let Some(known) = known_by_aumid(aumid) {
        return Some(identity(known.id, known.name, exe));
    }
    let installed = catalog.iter().find(|app| app.id.eq_ignore_ascii_case(aumid))?;
    Some(identity(&aumid.to_lowercase(), &installed.name, exe))
}

/// Useful as a name: not blank and not the frame host's own description.
fn useful_description(description: Option<&str>) -> Option<&str> {
    description.map(str::trim).filter(|d| !d.is_empty() && !d.eq_ignore_ascii_case("Application Frame Host"))
}

/// Identifies a window from what Windows says about it. `exe_path` is the process that draws the
/// content (for a Store-app frame, its CoreWindow child's). Order: shell surfaces, the window's AUMID,
/// the process's AUMID, the known-exe table, the file description, the exe stem.
pub fn identify(
    class: &str,
    exe_path: &str,
    window_aumid: Option<&str>,
    process_aumid: Option<&str>,
    file_description: Option<&str>,
    catalog: &[InstalledApp],
) -> AppIdentity {
    let exe = stem_of(exe_path);
    if is_transient_shell(class, &exe) {
        return identity(SHELL_ID, SHELL_NAME, &exe);
    }
    let aumids = [window_aumid, process_aumid].into_iter().flatten().map(str::trim).filter(|a| !a.is_empty());
    if let Some(found) = aumids.filter_map(|aumid| by_aumid(aumid, &exe, catalog)).next() {
        return found;
    }
    if let Some(known) = known_by_exe(&exe) {
        return identity(known.id, known.name, &exe);
    }
    let id = exe.to_lowercase();
    if id == FRAME_HOST || id.is_empty() {
        return identity("", "", &exe);
    }
    let name = useful_description(file_description).unwrap_or(&exe).to_string();
    AppIdentity { id, name, exe }
}

/// The app id a window of installed app `catalog_id` will report, so a launch can wait for it.
pub fn expected_id(catalog_id: &str) -> String {
    if let Some(known) = known_by_aumid(catalog_id) {
        return known.id.into();
    }
    // Desktop apps without an AUMID are listed by path ("{KNOWNFOLDER}\\Vendor\\app.exe").
    if catalog_id.to_ascii_lowercase().ends_with(".exe") {
        let stem = stem_of(&catalog_id.replace('\\', "/"));
        return known_by_exe(&stem).map_or_else(|| stem.to_lowercase(), |k| k.id.into());
    }
    catalog_id.to_lowercase()
}

/// Initializes COM for the calling thread when it isn't already; undoes only what it did.
struct ComScope(bool);

impl ComScope {
    fn enter() -> Self {
        // SAFETY: balanced by Drop when it succeeded. RPC_E_CHANGED_MODE means the thread is already an STA,
        // which serves the property store just as well.
        Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for ComScope {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: pairs with the successful CoInitializeEx in `enter`.
            unsafe { CoUninitialize() };
        }
    }
}

/// The AUMID a window was given, if any. Most desktop windows have none, which is not an error.
fn window_aumid(hwnd: HWND) -> Option<String> {
    let _com = ComScope::enter();
    // SAFETY: the store and the variant live only within this block; the variant is cleared after reading.
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).map_err(|e| eprintln!("couldn't read a window's properties: {e}")).ok()?;
        let mut value = store.GetValue(&PKEY_APP_USER_MODEL_ID).ok()?;
        let text = PropVariantToBSTR(&value).map(|b| b.to_string()).ok();
        if let Err(error) = PropVariantClear(&mut value) {
            eprintln!("couldn't free a window property: {error}");
        }
        text.filter(|t| !t.is_empty())
    }
}

/// The AUMID of a packaged process (WhatsApp, Notepad). None for ordinary desktop processes.
fn process_aumid(pid: u32) -> Option<String> {
    // SAFETY: the handle is closed below; the buffer outlives the call and its length is passed.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; AUMID_BUFFER];
        let mut len = buffer.len() as u32;
        let status = GetApplicationUserModelId(process, &mut len, Some(PWSTR(buffer.as_mut_ptr())));
        if let Err(error) = CloseHandle(process) {
            eprintln!("couldn't close a process handle: {error}");
        }
        // APPMODEL_ERROR_NO_APPLICATION for unpackaged processes; len counts the terminating NUL.
        status.is_ok().then(|| String::from_utf16_lossy(&buffer[..(len as usize).saturating_sub(1)]))
    }
}

/// A version-resource string up to its terminator, whatever length the resource claims.
fn until_nul(text: &[u16]) -> String {
    let end = text.iter().position(|&unit| unit == 0).unwrap_or(text.len());
    String::from_utf16_lossy(&text[..end])
}

fn query_string(block: &[u8], query: &str) -> Option<String> {
    let mut pointer = std::ptr::null_mut();
    let mut len = 0u32;
    // SAFETY: `block` is a version resource read by GetFileVersionInfoW; VerQueryValueW points into it.
    unsafe {
        if !VerQueryValueW(block.as_ptr().cast(), &HSTRING::from(query), &mut pointer, &mut len).as_bool() || len == 0 {
            return None;
        }
        Some(until_nul(std::slice::from_raw_parts(pointer as *const u16, len as usize)))
    }
}

/// The FileDescription in an executable's version resource ("Visual Studio Code").
fn read_file_description(path: &str) -> Option<String> {
    let file = HSTRING::from(path);
    // SAFETY: the buffer is sized by GetFileVersionInfoSizeW and outlives every read from it.
    let block = unsafe {
        let size = GetFileVersionInfoSizeW(&file, None);
        if size == 0 {
            return None;
        }
        let mut block = vec![0u8; size as usize];
        GetFileVersionInfoW(&file, None, size, block.as_mut_ptr().cast()).ok()?;
        block
    };
    let mut pointer = std::ptr::null_mut();
    let mut len = 0u32;
    // SAFETY: as in query_string; the translation table is pairs of u16.
    let (lang, page) = unsafe {
        if !VerQueryValueW(block.as_ptr().cast(), &HSTRING::from(TRANSLATION_QUERY), &mut pointer, &mut len).as_bool() || len < 4 {
            return None;
        }
        let pair = std::slice::from_raw_parts(pointer as *const u16, 2);
        (pair[0], pair[1])
    };
    query_string(&block, &format!("\\StringFileInfo\\{lang:04x}{page:04x}\\FileDescription"))
}

/// File descriptions don't change while Hodeum runs; reading them on every app switch is wasted work.
fn file_description(path: &str) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Ok(known) = cache.lock() {
        if let Some(found) = known.get(path) {
            return found.clone();
        }
    }
    let description = read_file_description(path);
    match cache.lock() {
        Ok(mut known) => {
            known.insert(path.to_string(), description.clone());
        }
        Err(error) => eprintln!("couldn't remember an app's description: {error}"),
    }
    description
}

/// Identifies the app showing top-level window `hwnd`.
pub fn identify_window(hwnd: HWND) -> AppIdentity {
    let class = class_name(hwnd);
    // A Store app's frame belongs to ApplicationFrameHost; its CoreWindow child belongs to the app.
    let content = if class == FRAME_CLASS { core_window_child(hwnd).unwrap_or(hwnd) } else { hwnd };
    let pid = window_pid(content);
    let path = exe_path(pid).unwrap_or_else(|error| {
        eprintln!("couldn't read an app's process path: {error}");
        String::new()
    });
    let window = window_aumid(hwnd);
    let process = process_aumid(pid);
    let description = if path.is_empty() { None } else { file_description(&path) };
    identify(&class, &path, window.as_deref(), process.as_deref(), description.as_deref(), &catalog::shared().snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apps::catalog::AppKind;

    const FRAME: &str = "ApplicationFrameWindow";
    const CALCULATOR: &str = "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App";
    const SETTINGS: &str = "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel";

    fn app(id: &str, name: &str) -> InstalledApp {
        InstalledApp { id: id.into(), name: name.into(), kind: AppKind::Packaged }
    }

    fn id_name(found: AppIdentity) -> (String, String) {
        (found.id, found.name)
    }

    fn pair(id: &str, name: &str) -> (String, String) {
        (id.into(), name.into())
    }

    #[test]
    fn names_store_apps_inside_the_frame_host_by_their_window_aumid() {
        let host = r"C:\Windows\System32\ApplicationFrameHost.exe";
        assert_eq!(id_name(identify(FRAME, host, Some(CALCULATOR), None, Some("Application Frame Host"), &[])), pair("calculator", "Calculator"));
        assert_eq!(id_name(identify(FRAME, host, Some(SETTINGS), None, None, &[])), pair("settings", "Settings"));
    }

    #[test]
    fn names_store_apps_by_their_content_process_without_an_aumid() {
        let calc = r"C:\Program Files\WindowsApps\Microsoft.WindowsCalculator\CalculatorApp.exe";
        assert_eq!(id_name(identify(FRAME, calc, None, None, None, &[])), pair("calculator", "Calculator"));
        assert_eq!(id_name(identify(FRAME, r"C:\Windows\ImmersiveControlPanel\SystemSettings.exe", None, None, None, &[])), pair("settings", "Settings"));
    }

    #[test]
    fn leaves_a_bare_frame_host_unnamed_so_app_checks_never_block_on_it() {
        let found = identify(FRAME, r"C:\Windows\System32\ApplicationFrameHost.exe", None, None, Some("Application Frame Host"), &[]);
        assert_eq!(id_name(found), pair("", ""));
    }

    #[test]
    fn names_packaged_win32_apps_by_their_process_aumid() {
        let whatsapp = r"C:\Program Files\WindowsApps\5319275A.WhatsAppDesktop\WhatsApp.Root.exe";
        let found = identify("WinUIDesktopWin32WindowClass", whatsapp, None, Some("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"), Some("WhatsApp.Root"), &[]);
        assert_eq!(found.exe, "WhatsApp.Root");
        assert_eq!(id_name(found), pair("whatsapp", "WhatsApp"));
        let notepad = identify("Notepad", r"C:\Program Files\WindowsApps\Notepad\Notepad.exe", None, Some("Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"), None, &[]);
        assert_eq!(id_name(notepad), pair("notepad", "Notepad"));
    }

    #[test]
    fn names_browsers_and_office_by_aumid_or_exe() {
        let brave = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe";
        assert_eq!(id_name(identify("Chrome_WidgetWin_1", brave, Some("Brave"), None, Some("Brave Browser"), &[])), pair("brave", "Brave"));
        assert_eq!(id_name(identify("Chrome_WidgetWin_1", r"C:\x\msedge.exe", Some("MSEdge"), None, None, &[])), pair("edge", "Edge"));
        assert_eq!(id_name(identify("XLMAIN", r"C:\Office16\EXCEL.EXE", None, None, Some("Microsoft Excel"), &[])), pair("excel", "Excel"));
        assert_eq!(id_name(identify("CabinetWClass", r"C:\Windows\explorer.exe", None, None, Some("Windows Explorer"), &[])), pair("file-explorer", "File Explorer"));
    }

    #[test]
    fn names_other_aumids_from_the_installed_apps() {
        let catalog = [app("Chrome._crx_hnpfjngllnfapefoaidbinmjnm", "WhatsApp Web"), app("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "Media Player")];
        let pwa = identify("Chrome_WidgetWin_1", r"C:\x\chrome.exe", Some("Chrome._crx_hnpfjngllnfapefoaidbinmjnm"), None, None, &catalog);
        assert_eq!(id_name(pwa), pair("chrome._crx_hnpfjngllnfapefoaidbinmjnm", "WhatsApp Web"));
        let player = identify(FRAME, r"C:\x\Microsoft.Media.Player.exe", Some("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), None, None, &catalog);
        assert_eq!(id_name(player), pair("microsoft.zunemusic_8wekyb3d8bbwe!microsoft.zunemusic", "Media Player"));
        // An AUMID nobody lists falls through to the exe.
        assert_eq!(id_name(identify("Chrome_WidgetWin_1", r"C:\x\chrome.exe", Some("Chrome._crx_unknown"), None, None, &[])), pair("chrome", "Chrome"));
    }

    #[test]
    fn falls_back_to_the_file_description_then_the_exe_stem() {
        assert_eq!(id_name(identify("GLFW30", r"C:\x\blender.exe", None, None, Some("Blender"), &[])), pair("blender", "Blender"));
        assert_eq!(id_name(identify("Qt5QWindow", r"C:\x\obs64.exe", None, None, None, &[])), pair("obs64", "obs64"));
        assert_eq!(id_name(identify("X", r"C:\x\tool.exe", None, None, Some("  "), &[])), pair("tool", "tool"));
    }

    #[test]
    fn reports_shell_surfaces_as_windows_itself() {
        let found = identify("Windows.UI.Core.CoreWindow", r"C:\Windows\SystemApps\SearchHost.exe", None, None, None, &[]);
        assert_eq!(id_name(found), pair(SHELL_ID, "Windows"));
        assert_eq!(identify("XamlExplorerHostIslandWindow", r"C:\Windows\explorer.exe", None, None, None, &[]).id, SHELL_ID);
    }

    #[test]
    fn predicts_the_id_a_launched_app_will_report() {
        assert_eq!(expected_id("Microsoft.Office.EXCEL.EXE.15"), "excel");
        assert_eq!(expected_id(CALCULATOR), "calculator");
        assert_eq!(expected_id(SETTINGS), "settings");
        assert_eq!(expected_id("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"), "whatsapp");
        assert_eq!(expected_id("Microsoft.Windows.Explorer"), "file-explorer");
        assert_eq!(expected_id("Brave"), "brave");
        assert_eq!(expected_id("MSEdge"), "edge");
        assert_eq!(expected_id(r"{6D809377-6AF0-444B-8957-A3773F02200E}\obs-studio\bin\64bit\obs64.exe"), "obs64");
        assert_eq!(expected_id("com.squirrel.Discord.Discord"), "com.squirrel.discord.discord");
    }

    #[test]
    fn names_exe_stems_for_the_notch() {
        assert_eq!(name_for_exe("brave"), "Brave");
        assert_eq!(name_for_exe("WhatsApp.Root"), "WhatsApp");
        assert_eq!(name_for_exe("SystemSettings"), "Settings");
        assert_eq!(name_for_exe("CalculatorApp"), "Calculator");
        assert_eq!(name_for_exe("mspaint"), "Paint");
        assert_eq!(name_for_exe("ApplicationFrameHost"), "");
        assert_eq!(name_for_exe("blender"), "blender");
    }

    #[test]
    fn a_version_string_ends_at_its_first_nul() {
        let utf16 = |text: &str| text.encode_utf16().collect::<Vec<_>>();
        // Measured: Spotify's FileDescription length runs past its terminator.
        assert_eq!(until_nul(&utf16("Spotify\u{0}8\u{16}\u{1}FileV")), "Spotify");
        assert_eq!(until_nul(&utf16("Visual Studio Code\u{0}")), "Visual Studio Code");
        assert_eq!(until_nul(&utf16("Discord")), "Discord");
    }
}
