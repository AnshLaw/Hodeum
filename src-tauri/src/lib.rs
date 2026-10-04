mod account;
#[cfg(test)]
mod ai_root;
#[cfg(test)]
mod build_stamp;
mod app_focus;
mod app_launch;
mod app_window;
mod apps;
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
mod topmost;
mod tray;
mod vlm;
mod voice;
mod web_search;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, RunEvent};

/// Tells the overlay to start Point & Ask (Hodey key + P).
pub(crate) const ANNOTATE_EVENT: &str = "annotate:start";
/// The per-user Run registry value for "Start Hodeum when I sign in"; the uninstaller removes it
/// (src-tauri/installer-hooks.nsh).
const AUTOSTART_NAME: &str = "Hodeum";
/// %LOCALAPPDATA%\com.hodeum.app\logs\hodeum.log
const LOG_FILE_NAME: &str = "hodeum";
/// One 5 MB file plus the previous one.
const LOG_MAX_BYTES: u128 = 5_000_000;
/// WebView2 reads these at startup: they would open a DevTools port (full IPC) or attach a script
/// debugger. The test harness sets the first one for debug builds only.
#[cfg(not(debug_assertions))]
const WEBVIEW_DEBUG_VARS: [&str; 2] = ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER"];

/// Release builds ignore the WebView2 debugging variables, so nobody who can set the user's
/// environment gets a debugger into Hodeum. Must run before any webview is created.
fn harden_webview_env() {
    #[cfg(not(debug_assertions))]
    for name in WEBVIEW_DEBUG_VARS {
        std::env::remove_var(name);
    }
}

/// Logs to stdout (tauri dev's terminal) and a rotating file, in local time.
fn logging() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
    tauri_plugin_log::Builder::new()
        .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: Some(LOG_FILE_NAME.into()) })])
        .max_file_size(LOG_MAX_BYTES)
        .rotation_strategy(RotationStrategy::KeepOne)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .level(log::LevelFilter::Info)
        .build()
}

fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let exe = std::env::current_exe().map(|exe| exe.display().to_string()).unwrap_or_else(|error| format!("exe unknown: {error}"));
    log::info!("Hodeum {} starting ({exe})", tray::build_info());
    surfaces::setup(app)?;
    if let Err(error) = topmost::start(app) {
        log::error!("the notch and overlay won't be kept above other windows: {error}");
    }
    dock::keep_top_anchored(app)?;
    app_window::keep_alive(app)?;
    tray::install(app)?;
    hit_test::spawn(app.clone());
    perception::input_hook::spawn(app.clone())?;
    perception::window_watch::spawn(app.clone(), app.state::<perception::Perception>().last_external());
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
    harden_webview_env();
    let app = tauri::Builder::default()
        // First, so a second launch hands over and exits before it hooks input or starts a model.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| tray::on_second_launch(app, &argv, &cwd)))
        .plugin(logging())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DATABASE_URL, db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().app_name(AUTOSTART_NAME).build())
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
            perception::perform_click,
            perception::capture_active_window,
            perception::window_watch::learner_window,
            phone::ocr_frame,
            phone::airplay::airplay_start,
            phone::airplay::airplay_stop,
            dock::set_dock,
            dock::set_notch_visible,
            dock::set_notch_tall,
            dock::begin_notch_drag,
            vlm::vlm_status,
            tray::build_info,
            tray::debug_quit,
            app_window::open_app_window,
            chat_context::list_windows,
            chat_context::last_app_window,
            chat_context::capture_window,
            app_focus::focus_app,
            app_launch::launch_app,
            apps::catalog::list_apps,
            apps::catalog::open_installed_app,
            web_search::web_search,
            voice::voice_status,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_converse,
            voice::voice_warm_mic,
            voice::set_speech_hints,
            voice::set_speech_language,
            voice::set_hands_free,
            voice::tts_speak,
            voice::tts_stop,
            voice::tts_prepare,
            voice::voice_models,
            voice::set_asr_model,
            voice::devices::audio_devices,
            voice::devices::set_audio_devices,
            hodey_key::set_hodey_key,
            account::auth_listen,
            account::open_url,
            account::device_name,
            cloud::keys::cloud_key_status,
            cloud::keys::cloud_key_set,
            cloud::keys::cloud_key_clear,
            cloud::gemini::gemini_reason,
            cloud::elevenlabs::elevenlabs_speak,
            cloud::catalog::gemini_list_models,
            cloud::catalog::elevenlabs_list_models,
            cloud::catalog::elevenlabs_list_voices,
            cloud::backboard::backboard_create_assistant,
            cloud::backboard::backboard_create_thread,
            cloud::backboard::backboard_add_message,
            cloud::backboard::backboard_search_memories
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
