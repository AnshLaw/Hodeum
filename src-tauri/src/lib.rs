mod db;
mod hit_test;
mod perception;
mod surfaces;

use tauri::Emitter;
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};

const ANNOTATE_SHORTCUT: &str = "ctrl+alt+h";
const ANNOTATE_EVENT: &str = "annotate:start";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DATABASE_URL, db::migrations())
                .build(),
        )
        .manage(hit_test::NotchHitRect::default())
        .manage(perception::Perception::start())
        .invoke_handler(tauri::generate_handler![
            surfaces::set_notch_hit_rect,
            surfaces::set_notch_activatable,
            surfaces::set_overlay_interactive,
            surfaces::monitor_info,
            perception::observe,
            perception::capture_active_window
        ])
        .setup(|app| {
            app.handle().plugin(
                ShortcutBuilder::new()
                    .with_shortcuts([ANNOTATE_SHORTCUT])?
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Err(error) = app.emit(ANNOTATE_EVENT, serde_json::json!({})) {
                                eprintln!("failed to emit {ANNOTATE_EVENT}: {error}");
                            }
                        }
                    })
                    .build(),
            )?;
            surfaces::setup(app.handle())?;
            hit_test::spawn(app.handle().clone());
            perception::input_hook::spawn(app.handle().clone())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hodeum");
}
