mod clip;
mod commands;
pub mod config;
mod db;
mod emb_index;
mod logger;
mod models;
// pub so examples/calibrate.rs (a kept-around manual testing tool for
// AUTO_TAG_THRESHOLD/AUTO_TAG_MAX calibration, see config.rs) can reach
// SiglipClip directly.
pub mod siglip_clip;

#[cfg(target_os = "macos")]
extern crate objc2;

use commands::{ClipInner, ClipState};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub struct DbState(pub Mutex<Connection>);

/// Show or hide the native macOS traffic light buttons.
/// Called from the frontend when entering/exiting video fullscreen so the
/// native title bar (which auto-reveals at the top in fullscreen) has buttons.
#[tauri::command]
fn set_native_traffic_lights_visible(window: tauri::WebviewWindow, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_win) = window.ns_window() {
            let ns_win = ns_win as *mut objc2::runtime::AnyObject;
            unsafe {
                use objc2::msg_send;
                for btn_type in [0u64, 1u64, 2u64] {
                    let btn: *mut objc2::runtime::AnyObject =
                        msg_send![ns_win, standardWindowButton: btn_type];
                    if !btn.is_null() {
                        let _: () = msg_send![btn, setHidden: !visible];
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, visible);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            // ── Database ──────────────────────────────────────────────────────
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("vivid.db");
            let conn = Connection::open(&db_path)?;
            db::init(&conn)?;
            conn.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA synchronous=NORMAL;
                 PRAGMA cache_size=-65536;
                 PRAGMA temp_store=MEMORY;
                 PRAGMA mmap_size=1073741824;",
            )?;
            // Seed the default "Uncategorized" folder + its on-disk directory.
            let media_root = data_dir.join("media");
            match db::ensure_uncategorized(&conn) {
                Ok(_) => {
                    if let Err(e) = std::fs::create_dir_all(media_root.join(db::UNCATEGORIZED)) {
                        tracing::warn!(error = %e, "create Uncategorized dir");
                    }
                }
                Err(e) => tracing::warn!(error = %e, "ensure Uncategorized folder"),
            }

            tracing::info!(path = %db_path.display(), "Database opened");
            app.manage(DbState(Mutex::new(conn)));

            // Managed external tools (yt-dlp) live here when downloaded.
            commands::init_bin_dir(data_dir.join("bin"));

            app.manage(ClipState(Arc::new(Mutex::new(ClipInner {
                emb_index: Arc::new(crate::emb_index::EmbIndex::default()),
                multilingual: None, multilingual_loading: false,
            }))));

            // ── Mirror backup: watcher worker + state ─────────────────────────
            app.manage(commands::SyncState::new());
            commands::sync_init(&app.handle());

            // ── LAN upload server (off until the user starts it) ──────────────
            app.manage(commands::UploadState::new());

            // ── Hide native traffic lights (we render custom ones in HTML) ─────
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let ns_win = window.ns_window().unwrap() as *mut objc2::runtime::AnyObject;
                    unsafe {
                        use objc2::msg_send;
                        for btn_type in [0u64, 1u64, 2u64] {
                            let btn: *mut objc2::runtime::AnyObject =
                                msg_send![ns_win, standardWindowButton: btn_type];
                            if !btn.is_null() {
                                let _: () = msg_send![btn, setHidden: true];
                            }
                        }
                    }
                }
            }

            tracing::info!("Vivid started");

            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS convention: clicking the red close button hides the window
            // and leaves the app running (reachable from the dock); only Cmd+Q
            // (or the Quit menu) actually terminates it.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_media,
            commands::import_paths,
            commands::preview_import,
            commands::update_media,
            commands::toggle_star,
            commands::set_collection,
            commands::remove_media,
            commands::get_collections,
            commands::create_collection,
            commands::delete_collection,
            commands::rename_collection,
            commands::pin_collection,
            commands::set_collection_description,
            commands::set_sidebar_pin,
            commands::set_collection_cover,
            commands::download_url,
            commands::export_file,
            commands::reveal_in_finder,
            commands::copy_file_to_clipboard,
            commands::copy_frame_to_clipboard,
            commands::trim_video,
            commands::export_video_gif,
            commands::transform_image,
            commands::get_media_metadata,
            commands::set_color_label,
            commands::set_media_location,
            commands::export_files_to_folder,
            commands::export_files_as_zip,
            commands::export_as,
            commands::export_stripped,
            commands::get_displayable_path,
            commands::get_playable_video_path,
            commands::share_files,
            commands::find_duplicates,
            commands::update_item_order,
            commands::trash_media,
            commands::restore_media,
            commands::get_trash,
            commands::empty_trash,
            commands::purge_old_trash,
            commands::capture_screenshot,
            commands::save_video_frame,
            commands::tool_status,
            commands::download_tool,
            commands::download_ytdlp,
            commands::download_ytdlp_video,
            commands::start_download_bg,
            commands::start_ytdlp_bg,
            commands::start_playlist_bg,
            commands::update_audio_meta,
            commands::set_audio_cover,
            commands::start_upload_server,
            commands::stop_upload_server,
            commands::get_sync_config,
            commands::set_sync_config,
            commands::get_sync_status,
            commands::sync_remirror,
            commands::list_dir_names,
            commands::get_library_stats,
            commands::get_photos_library_path,
            commands::open_system_settings_privacy,
            commands::open_in_browser,
            commands::download_ytdlp_playlist,
            // Folders (on-disk file tree)
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_to_folder,
            commands::move_folder,
            commands::reveal_folder_in_finder,
            // Music
            commands::get_music_albums,
            // Logs
            commands::get_log_content,
            // AI
            commands::get_clip_status,
            commands::embed_and_tag_image,
            commands::remove_auto_tag,
            commands::start_embed_all,
            commands::semantic_search,
            commands::get_mood_names,
            commands::mood_filter,
            commands::find_similar,
            // Multilingual CLIP
            commands::get_multilingual_status,
            commands::load_multilingual,
            commands::unload_multilingual,
            commands::download_multilingual_model,
            // Vision OCR
            commands::run_ocr_all,
            commands::get_ocr_status,
            // Thumbnails
            commands::generate_thumbnails_all,
            commands::regenerate_single_thumbnail,
            commands::get_thumb_status,
            // Window chrome
            set_native_traffic_lights_visible,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Re-show the (hidden) window when the user clicks the dock icon —
            // the other half of the standard macOS close-to-hide behavior.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                use tauri::Manager;
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}
