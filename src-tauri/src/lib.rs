mod app_window;
mod chat_context;
mod db;
mod dock;
mod hit_test;
mod perception;
mod surfaces;
mod tray;
mod vlm;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, Shortcut, ShortcutState};

const ANNOTATE_SHORTCUT: &str = "ctrl+alt+h";
const ANNOTATE_EVENT: &str = "annotate:start";
const VISIBILITY_SHORTCUT: &str = "ctrl+alt+n";
const APP_SHORTCUT: &str = "ctrl+alt+j";

fn matches(shortcut: &Shortcut, text: &str) -> bool {
    match text.parse::<Shortcut>() {
        Ok(parsed) => parsed == *shortcut,
        Err(error) => {
            eprintln!("invalid shortcut {text}: {error}");
            false
        }
    }
}

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut) {
    if matches(shortcut, VISIBILITY_SHORTCUT) {
        tray::emit_command(app, "toggle-visibility");
    } else if matches(shortcut, APP_SHORTCUT) {
        if let Err(error) = app_window::show(app, None) {
            eprintln!("couldn't open the Hodeum app: {error}");
        }
    } else if let Err(error) = app.emit(ANNOTATE_EVENT, serde_json::json!({})) {
        eprintln!("failed to emit {ANNOTATE_EVENT}: {error}");
    }
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.plugin(
        ShortcutBuilder::new()
            .with_shortcuts([ANNOTATE_SHORTCUT, VISIBILITY_SHORTCUT, APP_SHORTCUT])?
            .with_handler(|app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    on_shortcut(app, shortcut);
                }
            })
            .build(),
    )?;
    surfaces::setup(app)?;
    app_window::keep_alive(app)?;
    tray::install(app)?;
    hit_test::spawn(app.clone());
    perception::input_hook::spawn(app.clone())?;
    vlm::spawn(app.clone());
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
        .manage(vlm::Vlm::default())
        .invoke_handler(tauri::generate_handler![
            surfaces::set_notch_hit_rect,
            surfaces::set_notch_activatable,
            surfaces::set_overlay_interactive,
            surfaces::monitor_info,
            perception::observe,
            perception::capture_active_window,
            dock::set_dock,
            dock::set_notch_visible,
            dock::begin_notch_drag,
            vlm::vlm_status,
            app_window::open_app_window,
            chat_context::list_windows,
            chat_context::last_app_window,
            chat_context::capture_window
        ])
        .setup(|app| setup(app.handle()))
        .build(tauri::generate_context!())
        .expect("error while building Hodeum");

    app.run(|app, event| {
        // Never leave screen space reserved after Hodeum exits.
        if let RunEvent::Exit = event {
            if let Err(error) = app.state::<dock::DockState>().release_space() {
                eprintln!("couldn't release the sidebar's screen space: {error}");
            }
            if let Err(error) = app.state::<vlm::Vlm>().stop() {
                eprintln!("{error}");
            }
        }
    });
}
