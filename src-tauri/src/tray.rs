use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

use crate::dock::DockState;

/// Commands the notch's dock controller applies; it owns the preferences.
pub const SHELL_COMMAND_EVENT: &str = "shell:command";
const QUIT: &str = "quit";
const OPEN_APP: &str = "open-app";
const COMMANDS: [(&str, &str); 10] = [
    (OPEN_APP, "Open Hodeum\tCtrl+Alt+J"),
    ("toggle-visibility", "Show / hide Hodey\tCtrl+Alt+N"),
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

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let dock = Submenu::with_items(app, "Position", true, &[&item(app, "dock-top")?, &item(app, "dock-left")?, &item(app, "dock-right")?])?;
    let visibility = Submenu::with_items(app, "Visibility", true, &[&item(app, "pinned")?, &item(app, "auto")?])?;
    let sidebar = Submenu::with_items(app, "Sidebar style", true, &[&item(app, "sidebar-copilot")?, &item(app, "sidebar-floating")?])?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&item(app, OPEN_APP)?, &item(app, "toggle-visibility")?, &dock, &sidebar, &visibility, &separator, &item(app, QUIT)?])?;
    let mut builder = TrayIconBuilder::with_id("hodeum").tooltip("Hodey").menu(&menu).on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == QUIT {
            quit(app);
        } else if id == OPEN_APP {
            if let Err(error) = crate::app_window::show(app, None) {
                eprintln!("couldn't open the Hodeum app: {error}");
            }
        } else {
            emit_command(app, id);
        }
    });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Gives reserved screen space back before exiting.
pub fn quit(app: &AppHandle) {
    if let Err(error) = app.state::<DockState>().release_space() {
        eprintln!("couldn't release the sidebar's screen space: {error}");
    }
    app.exit(0);
}
