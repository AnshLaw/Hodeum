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
        eprintln!("failed to emit {SHELL_COMMAND_EVENT}: {error}");
    }
}

fn item(app: &AppHandle, id: &str) -> tauri::Result<MenuItem<tauri::Wry>> {
    let label = COMMANDS.iter().find(|(key, _)| *key == id).map(|(_, label)| *label).unwrap_or(id);
    MenuItem::with_id(app, id, label, true, None::<&str>)
}

fn autostart_item(app: &AppHandle) -> tauri::Result<CheckMenuItem<tauri::Wry>> {
    let enabled = app.autolaunch().is_enabled().unwrap_or_else(|error| {
        eprintln!("couldn't read the start-at-sign-in setting: {error}");
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
        eprintln!("couldn't change the start-at-sign-in setting: {error}");
    }
    match autolaunch.is_enabled() {
        Ok(enabled) => {
            if let Err(error) = tick.set_checked(enabled) {
                eprintln!("couldn't update the start-at-sign-in tick: {error}");
            }
        }
        Err(error) => eprintln!("couldn't read the start-at-sign-in setting: {error}"),
    }
}

fn on_menu(app: &AppHandle, id: &str, autostart: &CheckMenuItem<tauri::Wry>) {
    match id {
        QUIT => quit(app),
        OPEN_APP => {
            if let Err(error) = crate::app_window::show(app, None) {
                eprintln!("couldn't open the Hodeum app: {error}");
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
        .tooltip(TOOLTIP)
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
        eprintln!("couldn't release the sidebar's screen space: {error}");
    }
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_left_click_release_shows_hodey() {
        assert!(shows_hodey(MouseButton::Left, MouseButtonState::Up));
        assert!(!shows_hodey(MouseButton::Left, MouseButtonState::Down));
        assert!(!shows_hodey(MouseButton::Right, MouseButtonState::Up));
    }
}
