mod db;
mod dock;
mod hit_test;
mod perception;
mod surfaces;
mod tray;

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, Shortcut, ShortcutState};

const ANNOTATE_SHORTCUT: &str = "ctrl+alt+h";
const ANNOTATE_EVENT: &str = "annotate:start";
const VISIBILITY_SHORTCUT: &str = "ctrl+alt+n";

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut) {
    let visibility: Shortcut = match VISIBILITY_SHORTCUT.parse() {
        Ok(parsed) => parsed,
        Err(error) => return eprintln!("invalid shortcut {VISIBILITY_SHORTCUT}: {error}"),
    };
    if *shortcut == visibility {
        tray::emit_command(app, "toggle-visibility");
    } else if let Err(error) = app.emit(ANNOTATE_EVENT, serde_json::json!({})) {
        eprintln!("failed to emit {ANNOTATE_EVENT}: {error}");
    }
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.plugin(
        ShortcutBuilder::new()
            .with_shortcuts([ANNOTATE_SHORTCUT, VISIBILITY_SHORTCUT])?
            .with_handler(|app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    on_shortcut(app, shortcut);
                }
            })
            .build(),
    )?;
    surfaces::setup(app)?;
    tray::install(app)?;
    hit_test::spawn(app.clone());
    perception::input_hook::spawn(app.clone())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DATABASE_URL, db::migrations())
                .build(),
        )
        .manage(hit_test::NotchHitRect::default())
        .manage(perception::Perception::start())
        .manage(dock::DockState::default())
        .manage(surfaces::FocusReturn::default())
        .invoke_handler(tauri::generate_handler![
            surfaces::set_notch_hit_rect,
            surfaces::set_notch_activatable,
            surfaces::set_overlay_interactive,
            surfaces::monitor_info,
            perception::observe,
            perception::capture_active_window,
            dock::set_dock,
            dock::set_notch_visible,
            dock::begin_notch_drag
        ])
        .on_window_event(|window, event| {
            if window.label() == surfaces::NOTCH && matches!(event, WindowEvent::Moved(_)) {
                dock::on_notch_moved(window.app_handle());
            }
        })
        .setup(|app| setup(app.handle()))
        .build(tauri::generate_context!())
        .expect("error while building Hodeum");

    app.run(|app, event| {
        // Never leave screen space reserved after Hodeum exits.
        if let RunEvent::Exit = event {
            if let Err(error) = app.state::<dock::DockState>().appbar.release() {
                eprintln!("couldn't release the sidebar's screen space: {error}");
            }
        }
    });
}
