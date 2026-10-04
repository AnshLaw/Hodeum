mod account;
mod app_focus;
mod app_window;
mod chat_context;
mod child_job;
mod cloud;
mod db;
mod dock;
mod hit_test;
mod hodey_key;
mod perception;
mod phone;
mod surfaces;
mod tray;
mod vlm;
mod voice;
mod web_search;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, RunEvent};

/// Tells the overlay to start Point & Ask (Hodey key + P).
pub(crate) const ANNOTATE_EVENT: &str = "annotate:start";

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    surfaces::setup(app)?;
    app_window::keep_alive(app)?;
    tray::install(app)?;
    hit_test::spawn(app.clone());
    perception::input_hook::spawn(app.clone())?;
    vlm::spawn(app.clone());
    voice::start(app);
    hodey_key::spawn(app.clone())?;
    Ok(())
}

/// The notch reads the mirrored iPhone (a camera device). Every other request keeps WebView2's default.
fn notch_camera(webview: &tauri::Webview, kind: PermissionKind) -> PermissionResponse {
    if matches!(kind, PermissionKind::Camera) && webview.label() == surfaces::NOTCH {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DATABASE_URL, db::migrations())
                .build(),
        )
        .on_permission_request(|webview, kind| notch_camera(&webview, kind))
        .manage(hit_test::NotchHitRect::default())
        .manage(perception::Perception::start())
        .manage(dock::DockState::default())
        .manage(surfaces::FocusReturn::default())
        .manage(vlm::Vlm::default())
        .manage(phone::airplay::Airplay::default())
        .invoke_handler(tauri::generate_handler![
            surfaces::set_notch_hit_rect,
            surfaces::set_notch_activatable,
            surfaces::set_overlay_interactive,
            surfaces::monitor_info,
            perception::observe,
            perception::capture_active_window,
            phone::ocr_frame,
            phone::airplay::airplay_start,
            phone::airplay::airplay_stop,
            dock::set_dock,
            dock::set_notch_visible,
            dock::begin_notch_drag,
            vlm::vlm_status,
            app_window::open_app_window,
            chat_context::list_windows,
            chat_context::last_app_window,
            chat_context::capture_window,
            app_focus::focus_app,
            web_search::web_search,
            voice::voice_status,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_converse,
            voice::set_speech_language,
            voice::set_hands_free,
            voice::tts_speak,
            voice::tts_stop,
            voice::tts_prepare,
            hodey_key::set_hodey_key,
            account::auth_listen,
            account::open_url,
            account::device_name,
            cloud::keys::cloud_key_status,
            cloud::keys::cloud_key_set,
            cloud::keys::cloud_key_clear,
            cloud::gemini::gemini_reason
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
            if let Err(error) = app.state::<phone::airplay::Airplay>().stop() {
                eprintln!("{error}");
            }
        }
    });
}
