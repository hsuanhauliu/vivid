mod clip;
mod commands;
pub mod config;
mod db;
mod emb_index;
mod logger;
mod models;
mod workspace;
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

/// Actually open a chosen workspace: resolve its paths, open its DB, and
/// bring up every piece of managed state that depends on it (embedding
/// index, mirror-sync watcher, an adoption scan for external folders).
///
/// Called either from `.setup()` directly when there's nothing to choose (0
/// or 1 registered workspaces — the overwhelmingly common case), or from the
/// `open_workspace` command once the user has picked one via the frontend's
/// startup picker. In the picker case, `.setup()` deliberately manages none
/// of `DbState`/`WorkspaceState`/`ClipState`/`SyncState` up front — the
/// workspace is genuinely not loaded until the user chooses, not just
/// hidden behind a confirmation dialog on top of an already-loaded one.
fn initialize_workspace(
    app: &tauri::AppHandle,
    workspace: workspace::Workspace,
    data_dir: &std::path::Path,
) -> Result<(), String> {
    use tauri::Manager;

    let paths = workspace::WorkspacePaths::resolve(&workspace, data_dir);
    paths.ensure_dirs(workspace.kind).map_err(|e| e.to_string())?;
    tracing::info!(
        workspace = %workspace.name,
        kind = ?workspace.kind,
        db = %paths.db_path.display(),
        "Active workspace"
    );

    // The default workspace's files live under `$APPDATA`, already covered
    // by the static asset-protocol scope in tauri.conf.json. An external
    // workspace's folder is picked by the user at runtime and can be
    // anywhere, so it has to be granted dynamically — otherwise the webview
    // gets a 403 trying to load its thumbnails (and originals) via
    // `convertFileSrc`. `.vivid/` derived data living inside it is covered
    // too since this grant is recursive.
    if workspace.kind == workspace::WorkspaceKind::External {
        if let Err(e) = app.asset_protocol_scope().allow_directory(&paths.media_dir, true) {
            tracing::warn!(error = %e, "grant asset-protocol scope for workspace root");
        }
    }

    let conn = Connection::open(&paths.db_path).map_err(|e| e.to_string())?;
    db::init(&conn).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA cache_size=-65536;
         PRAGMA temp_store=MEMORY;
         PRAGMA mmap_size=1073741824;",
    ).map_err(|e| e.to_string())?;
    // Other is purely virtual (see `db::UNCATEGORIZED_ID`) — no row,
    // no on-disk directory, nothing to seed here. A file with no folder_id
    // simply lives at `paths.media_dir` itself.
    tracing::info!(path = %paths.db_path.display(), "Database opened");
    app.manage(DbState(Mutex::new(conn)));
    let kind = workspace.kind;
    app.manage(workspace::WorkspaceState { workspace, paths });

    app.manage(ClipState(Arc::new(Mutex::new(ClipInner {
        emb_index: Arc::new(std::sync::RwLock::new(crate::emb_index::EmbIndex::default())),
        multilingual: None, multilingual_loading: false,
    }))));

    // An external workspace's folder can have changed while Vivid wasn't
    // running (files added/removed/edited outside the app, or the folder
    // moved/unmounted and come back). Reconcile before anything else touches
    // the DB: adopt new files, drop rows for files that are genuinely gone,
    // and invalidate derived data for files that changed on disk. Runs
    // synchronously (one directory walk + one query + an in-memory diff, so
    // it stays fast even at 10k+ files) — the caller (either `.setup()` or
    // the `open_workspace` command) is what the frontend is waiting on, so
    // this is exactly the "show a spinner until it resolves" window the UI
    // needs before it's safe to browse the library.
    if kind == workspace::WorkspaceKind::External {
        if let Err(e) = commands::reconcile_workspace(app) {
            tracing::warn!(error = %e, "workspace reconciliation failed");
        }
    }

    // Live filesystem watcher: keeps the DB in sync with the folder while
    // Vivid keeps running (a one-time reconcile above only covers drift that
    // happened while the app was closed). No-op for the Default workspace.
    app.manage(commands::WatchState::new());
    commands::watch_init(app);

    // ── Mirror backup: watcher worker + state ──────────────────────────────
    app.manage(commands::SyncState::new());
    commands::sync_init(app);

    Ok(())
}

/// Rebuild the macOS menu bar's "Workspace" menu — a "Switch Workspace"
/// submenu listing every registered workspace (clicking one switches
/// directly, no confirmation) plus a "New Workspace…" entry — from the
/// current registry, and reinstall it. Called once at startup and again
/// after any command that mutates the registry (add/rename/remove/switch/
/// update path), so the submenu never goes stale without a relaunch.
/// A no-op on non-macOS, where there's no global menu bar to update.
#[cfg(target_os = "macos")]
pub(crate) fn rebuild_workspace_menu(app: &tauri::AppHandle) {
    use tauri::menu::{Menu, SubmenuBuilder};
    use tauri::Manager;

    let Ok(data_dir) = app.path().app_data_dir() else { return };
    let registry = workspace::load(&data_dir);
    // The registry's `active_id` may point at a pending, not-yet-applied
    // switch (see `list_workspaces`) — what's actually running right now is
    // `WorkspaceState`, which may not even be managed yet during the
    // deferred-loading window before the startup picker resolves.
    let running_id = app.try_state::<workspace::WorkspaceState>().map(|s| s.workspace.id.clone());

    let Ok(menu) = Menu::default(app) else { return };

    let mut switch_builder = SubmenuBuilder::new(app, "Switch Workspace");
    for w in &registry.workspaces {
        let label = if running_id.as_deref() == Some(w.id.as_str()) {
            format!("✓ {}", w.name)
        } else {
            w.name.clone()
        };
        switch_builder = switch_builder.text(format!("switch-workspace:{}", w.id), label);
    }
    let Ok(switch_submenu) = switch_builder.build() else { return };

    let Ok(workspace_menu) = SubmenuBuilder::new(app, "Workspace")
        .item(&switch_submenu)
        .separator()
        .text("add-workspace", "New Workspace…")
        .build()
    else { return };

    // Position 1: right after the app-name menu, before File.
    if menu.insert(&workspace_menu, 1).is_ok() {
        let _ = app.set_menu(menu);
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn rebuild_workspace_menu(_app: &tauri::AppHandle) {}

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
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            use tauri::Manager;

            // ── Workspace ─────────────────────────────────────────────────────
            // `data_dir` is always Vivid's own OS app-data directory: it's where
            // the workspace registry itself lives, where the default workspace's
            // data lives *if registered*, and where machine-global caches
            // (downloaded models, yt-dlp) stay regardless of which workspace is
            // active — none of those are workspace-portable data.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            // Managed external tools (yt-dlp) live here when downloaded — global,
            // not workspace-specific, so this happens regardless of whether a
            // workspace choice is still pending below.
            commands::init_bin_dir(data_dir.join("bin"));

            // ── LAN upload server (off until the user starts it) ────────────────
            app.manage(commands::UploadState::new());

            // Never eager-load here, regardless of how many workspaces are
            // registered — not even when there's exactly one. `DbState`/
            // `WorkspaceState`/`ClipState`/`SyncState` simply aren't managed
            // until the frontend's pre-mount gate (`WorkspaceGate.jsx`)
            // resolves a choice and calls `open_workspace` (existing
            // workspace) or `add_default_workspace`/`add_workspace` +
            // `open_workspace` (first run, nothing registered yet). Always
            // showing that landing page — even for a single registered
            // workspace — is deliberate: the user might want to add or link
            // another workspace before continuing, not just re-open the one
            // they already have. This is also how a user who wants to use
            // only their own folder, never Vivid's managed library, is
            // honored: nothing about the default workspace is ever created
            // unless they explicitly ask for it.
            let registry = workspace::load(&data_dir);
            tracing::info!(
                count = registry.workspaces.len(),
                "Deferring workspace load until the frontend resolves a choice"
            );

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

            // ── Menu bar: "Workspace" > "Switch Workspace" > <workspaces> ──────
            // Built on top of Tauri's own default menu (App/File/Edit/View/
            // Window/Help) rather than from scratch, so nothing standard (Quit,
            // Copy/Paste, etc.) is lost. macOS-only for now — Windows/Linux use
            // a per-window menu bar instead of a global one, and the Settings >
            // Library workspace switcher already covers those platforms.
            rebuild_workspace_menu(&app.handle());

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
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let id = event.id().as_ref();
            if let Some(target) = id.strip_prefix("switch-workspace:") {
                let _ = app.emit("menu-switch-to-workspace", target.to_string());
            } else if id == "add-workspace" {
                let _ = app.emit("menu-add-workspace", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_map_config,
            commands::get_all_media,
            commands::import_paths,
            commands::preview_import,
            commands::update_media,
            commands::toggle_star,
            commands::add_to_collection,
            commands::remove_from_collection,
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
            commands::rename_file,
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
            // Workspaces
            commands::list_workspaces,
            commands::get_active_workspace,
            commands::add_workspace,
            commands::add_default_workspace,
            commands::rename_workspace,
            commands::switch_workspace,
            commands::open_workspace,
            commands::remove_workspace,
            commands::scan_workspace,
            commands::update_workspace_path,
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
