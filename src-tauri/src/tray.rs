use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::dock::DockState;

/// Commands the notch's dock controller applies; it owns the preferences.
pub const SHELL_COMMAND_EVENT: &str = "shell:command";
const QUIT: &str = "quit";
const OPEN_APP: &str = "open-app";
/// Unhides Hodey; sent by a left-click on the tray icon (the right-click opens the menu).
const SHOW: &str = "show";
const AUTOSTART: &str = "autostart";
const AUTOSTART_LABEL: &str = "Start Hodeum when I sign in";
const TRAY_ID: &str = "hodeum";
const TOOLTIP: &str = "Hodeum";
/// "<git short sha>[-dirty] <UTC time>" from build.rs, so an old copy is easy to spot.
const BUILD_STAMP: &str = env!("HODEUM_BUILD");
const DEBUG_ONLY: &str = "debug_quit is only available in debug builds";
const COMMANDS: [(&str, &str); 10] = [
    (OPEN_APP, "Open Hodeum\tHodey key + A"),
    ("toggle-visibility", "Show / hide Hodey\tHodey key + H"),
    ("dock-top", "Top"),
    ("dock-left", "Left side"),
    ("dock-right", "Right side"),
    ("sidebar-copilot", "Copilot (move windows aside)"),
    ("sidebar-floating", "Floating"),
    ("pinned", "Always show"),
    ("auto", "Auto-hide"),
    (QUIT, "Quit Hodeum"),
];

#[derive(Clone, Serialize)]
pub struct ShellCommand {
    pub command: String,
}

pub fn emit_command(app: &AppHandle, command: &str) {
    if let Err(error) = app.emit(SHELL_COMMAND_EVENT, ShellCommand { command: command.to_string() }) {
        log::error!("failed to emit {SHELL_COMMAND_EVENT}: {error}");
    }
}

fn item(app: &AppHandle, id: &str) -> tauri::Result<MenuItem<tauri::Wry>> {
    let label = COMMANDS.iter().find(|(key, _)| *key == id).map(|(_, label)| *label).unwrap_or(id);
    MenuItem::with_id(app, id, label, true, None::<&str>)
}

fn autostart_item(app: &AppHandle) -> tauri::Result<CheckMenuItem<tauri::Wry>> {
    let enabled = app.autolaunch().is_enabled().unwrap_or_else(|error| {
        log::warn!("couldn't read the start-at-sign-in setting: {error}");
        false
    });
    CheckMenuItem::with_id(app, AUTOSTART, AUTOSTART_LABEL, true, enabled, None::<&str>)
}

fn menu(app: &AppHandle, autostart: &CheckMenuItem<tauri::Wry>) -> tauri::Result<Menu<tauri::Wry>> {
    let dock = Submenu::with_items(app, "Position", true, &[&item(app, "dock-top")?, &item(app, "dock-left")?, &item(app, "dock-right")?])?;
    let visibility = Submenu::with_items(app, "Visibility", true, &[&item(app, "pinned")?, &item(app, "auto")?])?;
    let sidebar = Submenu::with_items(app, "Sidebar style", true, &[&item(app, "sidebar-copilot")?, &item(app, "sidebar-floating")?])?;
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&item(app, OPEN_APP)?, &item(app, "toggle-visibility")?, &dock, &sidebar, &visibility, &separator, autostart, &item(app, QUIT)?])
}

/// Flips start-at-sign-in (a per-user Run registry entry), then shows the real state on the tick.
fn toggle_autostart(app: &AppHandle, tick: &CheckMenuItem<tauri::Wry>) {
    let autolaunch = app.autolaunch();
    let result = match autolaunch.is_enabled() {
        Ok(true) => autolaunch.disable(),
        Ok(false) => autolaunch.enable(),
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        log::warn!("couldn't change the start-at-sign-in setting: {error}");
    }
    match autolaunch.is_enabled() {
        Ok(enabled) => {
            if let Err(error) = tick.set_checked(enabled) {
                log::warn!("couldn't update the start-at-sign-in tick: {error}");
            }
        }
        Err(error) => log::warn!("couldn't read the start-at-sign-in setting: {error}"),
    }
}

fn on_menu(app: &AppHandle, id: &str, autostart: &CheckMenuItem<tauri::Wry>) {
    match id {
        QUIT => quit(app),
        OPEN_APP => {
            if let Err(error) = crate::app_window::show(app, None) {
                log::error!("couldn't open the Hodeum app: {error}");
            }
        }
        AUTOSTART => toggle_autostart(app, autostart),
        _ => emit_command(app, id),
    }
}

/// A left-click (on release) brings Hodey back; the right-click keeps opening the menu.
fn shows_hodey(button: MouseButton, state: MouseButtonState) -> bool {
    button == MouseButton::Left && state == MouseButtonState::Up
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let icon = app.default_window_icon().cloned().ok_or("Hodeum has no app icon for the tray (bundle.icon in tauri.conf.json)")?;
    let autostart = autostart_item(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(tooltip(cfg!(debug_assertions)))
        .menu(&menu(app, &autostart)?)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| on_menu(app, event.id().as_ref(), &autostart))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, button_state, .. } = event {
                if shows_hodey(button, button_state) {
                    emit_command(tray.app_handle(), SHOW);
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// Gives reserved screen space back before exiting.
pub fn quit(app: &AppHandle) {
    if let Err(error) = app.state::<DockState>().release_space() {
        log::error!("couldn't release the sidebar's screen space: {error}");
    }
    app.exit(0);
}

/// "debug 0fe9357-dirty 2026-10-04 06:31 UTC": the build kind, commit and build time.
pub fn build_label(debug: bool) -> String {
    format!("{} {BUILD_STAMP}", if debug { "debug" } else { "release" })
}

fn tooltip(debug: bool) -> String {
    format!("{TOOLTIP} ({})", build_label(debug))
}

/// Which build is running, for Settings and the test harness.
#[tauri::command]
pub fn build_info() -> String {
    build_label(cfg!(debug_assertions))
}

/// Lets the test harness quit the way the tray does (releasing dock space, stopping the model);
/// a forced kill skips that. Never available in release builds.
#[tauri::command]
pub fn debug_quit(app: AppHandle) -> Result<(), String> {
    allow_debug_quit(cfg!(debug_assertions))?;
    log::info!("quitting on request from the test harness (debug_quit)");
    quit(&app);
    Ok(())
}

fn allow_debug_quit(debug: bool) -> Result<(), String> {
    debug.then_some(()).ok_or_else(|| DEBUG_ONLY.to_string())
}

/// Someone started Hodeum again while it runs: the new copy exits (single-instance plugin), and this
/// one shows Hodey instead. The log names both copies, since a dev and an installed build share an id.
pub fn on_second_launch(app: &AppHandle, argv: &[String], cwd: &str) {
    let ours = std::env::current_exe().map(|exe| exe.display().to_string()).unwrap_or_else(|error| format!("unknown ({error})"));
    let theirs = argv.first().map(String::as_str).unwrap_or("unknown");
    log::warn!("a second Hodeum was started ({theirs}, from {cwd}); keeping this one ({ours}, {}) and showing Hodey", build_info());
    emit_command(app, SHOW);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_quit_is_refused_in_release_builds() {
        assert_eq!(allow_debug_quit(false), Err(DEBUG_ONLY.to_string()));
        assert_eq!(allow_debug_quit(true), Ok(()));
    }

    #[test]
    fn labels_the_build_kind_commit_and_time() {
        assert!(build_label(true).starts_with("debug "));
        assert!(build_label(false).starts_with("release "));
        assert!(build_label(true).ends_with(" UTC"), "{}", build_label(true));
        assert_eq!(tooltip(true), format!("Hodeum ({})", build_label(true)));
    }

    #[test]
    fn only_a_left_click_release_shows_hodey() {
        assert!(shows_hodey(MouseButton::Left, MouseButtonState::Up));
        assert!(!shows_hodey(MouseButton::Left, MouseButtonState::Down));
        assert!(!shows_hodey(MouseButton::Right, MouseButtonState::Up));
    }
}
