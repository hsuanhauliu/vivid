use crate::{
    db,
    models::{extension_to_media_type, ExifMetadata, Collection, MediaItem},
    workspace, DbState,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{Emitter, Manager, State};

/// Resolve the bundled Swift helper (AVFoundation/Vision/ImageIO — OCR, video
/// frame/trim/GIF work): prefer the app's resource dir (packaged build), fall
/// back to the absolute path baked in at compile time (dev).
pub(crate) fn helper_path(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("resources/vivid-helper");
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(env!("VIVID_HELPER_PATH"))
}

/// Insert a media item and kick off AI indexing if the model is already loaded.
/// Every import path (file, URL, yt-dlp, screenshot) goes through this so the
/// trigger is never missed and never duplicated in individual commands.
pub(crate) fn insert_imported(
    conn: &rusqlite::Connection,
    item: &mut MediaItem,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    normalize_folder(conn, item, app)?;
    db::insert(conn, item).map_err(|e| e.to_string())?;
    trigger_embed_if_ready(app);
    if item.media_type == "image" {
        ocr::trigger_ocr(app, item.id.clone(), item.file_path.clone());
    }
    if item.media_type == "image" || item.media_type == "video" {
        thumbs::trigger_thumb(app, item.id.clone(), item.file_path.clone(), item.media_type.clone());
    }
    Ok(())
}

/// Ensure `item` physically lives inside its target folder's on-disk directory
/// (defaulting to Uncategorized), moving the file there if it's still in the flat
/// root, and stamp the resolved folder_id + path back onto the item. Keeps every
/// single-file import path (download, screenshot, export) consistent with the
/// folder model without each one re-implementing the placement.
fn normalize_folder(
    conn: &rusqlite::Connection,
    item: &mut MediaItem,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let root = media_dir(app)?;
    let folder = match &item.folder_id {
        Some(fid) => db::fetch_folder(conn, fid).map_err(|e| e.to_string())?,
        None => {
            let id = db::ensure_uncategorized(conn).map_err(|e| e.to_string())?;
            db::fetch_folder(conn, &id).map_err(|e| e.to_string())?
        }
    };
    let dest_dir = root.join(&folder.rel_path);
    let src = PathBuf::from(&item.file_path);
    if src.parent() != Some(dest_dir.as_path()) {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
        let dest = unique_path(&dest_dir, &item.file_name);
        if src.exists() {
            fs::rename(&src, &dest).map_err(|e| e.to_string())?;
        }
        item.file_path = dest.to_string_lossy().to_string();
    }
    item.folder_id = Some(folder.id);
    Ok(())
}

mod ai;
pub use ai::*;

mod export;
pub use export::*;

mod download;
pub use download::*;

mod tools;
pub use tools::*;

mod ocr;
pub use ocr::*;

mod thumbs;
pub use thumbs::*;

mod folders;
pub use folders::*;

mod sync;
pub use sync::*;

mod upload;
pub use upload::*;

mod workspace_cmds;
pub use workspace_cmds::*;


// ── Shared types ──────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct ImportProgress {
    pub current:   usize,
    pub total:     usize,
    pub file_name: String,
}

#[derive(Clone, Serialize)]
pub struct ImportDone {
    pub imported:      usize,
    pub skipped_type:  usize, // unsupported file extension
    pub skipped_dupe:  usize, // already in library
    pub failed:        usize, // copy or processing error
}

/// A chunk of freshly-imported items, streamed to the frontend during a large
/// import so the grid fills incrementally instead of waiting for a full reload.
#[derive(Clone, Serialize)]
pub struct ImportBatch {
    pub items: Vec<MediaItem>,
}

/// Dry-run summary of what an import would do, so the UI can confirm before any
/// files are copied. `new_folders` lists the sub-folders (relative to the chosen
/// destination) that would be created from imported directory structure.
#[derive(Clone, Serialize)]
pub struct ImportPreview {
    pub to_import:    usize,
    pub skipped_type: usize,
    pub skipped_dupe: usize,
    pub new_folders:  Vec<String>,
}

pub struct AudioMeta {
    pub title:         Option<String>,
    pub artist:        Option<String>,
    pub album:         Option<String>,
    pub track:         Option<i64>,
    pub duration_secs: Option<f64>,
    pub year:          Option<i64>,
}

// ── Shared helpers (used by submodules via super::) ───────────────────────────

/// Media root of the *active workspace* — the default app-data `media/`
/// directory, or an external workspace's chosen folder (files there are
/// adopted in place, not copied into a subdirectory of it).
pub(crate) fn media_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.state::<workspace::WorkspaceState>().paths.media_dir.clone();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn unique_path(dir: &Path, fname: &str) -> PathBuf {
    // Reduce to the final path component so a crafted name (e.g. "../../evil")
    // can't escape `dir`. This is the single choke point for all file writes
    // (downloads, screenshots, exports), so sanitizing here protects every caller.
    let fname = match Path::new(fname).file_name().and_then(|s| s.to_str()) {
        Some(n) if n != "." && n != ".." => n,
        _ => "file",
    };
    let path = dir.join(fname);
    if !path.exists() { return path; }
    let stem = Path::new(fname).file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext  = Path::new(fname).extension().and_then(|e| e.to_str()).unwrap_or("");
    // A name clash never blocks an import: append a counter suffix (`_2`, `_3`, …)
    // until we find a free name, mirroring Finder-style de-duplication.
    for i in 2u32.. {
        let candidate = dir.join(if ext.is_empty() {
            format!("{stem}_{i}")
        } else {
            format!("{stem}_{i}.{ext}")
        });
        if !candidate.exists() { return candidate; }
    }
    path
}

/// Resolve a path to an absolute, lexically-normalized form (resolves `.`/`..`
/// without requiring the path to exist, so a not-yet-created destination can
/// still be checked). Symlinks aren't followed — good enough for the overlap
/// checks callers use this for, which guard against obvious mistakes, not
/// adversarial evasion.
pub(crate) fn normalize_abs(p: &Path) -> PathBuf {
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };
    let mut out = PathBuf::new();
    for comp in abs.components() {
        match comp {
            std::path::Component::ParentDir => { out.pop(); }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Decode a `data:image/...;base64,...` URL (as produced by canvas.toDataURL
/// on the frontend) into raw bytes.
pub(crate) fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let b64 = data_url
        .split_once("base64,")
        .map(|(_, data)| data)
        .ok_or("Expected a base64 data URL")?;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Invalid image data: {e}"))
}

pub(crate) fn build_item(path: &Path, source_path: Option<String>) -> Result<MediaItem, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let display_name = path.file_stem().and_then(|n| n.to_str()).unwrap_or(&file_name).to_string();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let media_type = extension_to_media_type(ext)
        .ok_or_else(|| format!("Unsupported extension: {ext}"))?;
    let file_size = fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    let file_path = path.to_string_lossy().to_string();
    let now = chrono::Local::now().to_rfc3339();

    let (width, height) = if media_type == "image" {
        image::image_dimensions(path)
            .map(|(w, h)| (Some(w), Some(h)))
            .unwrap_or((None, None))
    } else {
        (None, None)
    };

    Ok(MediaItem {
        id: uuid::Uuid::new_v4().to_string(),
        file_path,
        source_path,
        file_name,
        display_name,
        media_type: media_type.to_string(),
        file_size,
        description: String::new(),
        tags: Vec::new(),
        starred: false,
        collection_id: None,
        folder_id: None,
        color_label: None,
        gps_lat: None,
        gps_lng: None,
        created_at: now.clone(),
        updated_at: now,
        sort_order: 0,
        deleted_at: None,
        auto_tags: Vec::new(),
        audio_title: None, audio_artist: None, audio_album: None,
        audio_track: None, audio_duration: None, audio_year: None, audio_cover: None,
        date_taken: None,
        favorited: false,
        width,
        height,
        ocr_text: None,
        thumb_path: None,
        camera_make: None,
        camera_model: None,
    })
}

pub(crate) fn extract_audio_meta(path: &Path) -> Result<AudioMeta, anyhow::Error> {
    use lofty::prelude::*;
    use lofty::probe::Probe;

    let tagged = Probe::open(path)?.read()?;
    let duration_secs = tagged.properties().duration().as_secs_f64();
    let duration_secs = if duration_secs > 0.0 { Some(duration_secs) } else { None };

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let Some(tag) = tag else {
        return Ok(AudioMeta {
            title: None, artist: None, album: None,
            track: None, duration_secs, year: None,
        });
    };

    Ok(AudioMeta {
        title:         tag.title().map(|s| s.to_string()),
        artist:        tag.artist().map(|s| s.to_string()),
        album:         tag.album().map(|s| s.to_string()),
        track:         tag.track().map(|t| t as i64),
        year:          tag.year().map(|y| y as i64),
        duration_secs,
    })
}

// ── Private helpers ───────────────────────────────────────────────────────────

/// A file discovered for import, plus the sub-folder chain (relative to the
/// chosen destination folder) it should be placed under. `sub` is empty for a
/// loose file; for a file found while walking an imported directory it mirrors
/// the on-disk nesting so the structure is preserved (e.g. `["Trip", "Beach"]`).
struct Discovered {
    src: PathBuf,
    sub: Vec<String>,
}

/// Reduce one path component to a safe folder name, rejecting anything that
/// could escape the library root (`.`, `..`, empty, or embedded separators).
fn safe_component(name: &std::ffi::OsStr) -> Option<String> {
    let s = name.to_str()?.trim();
    if s.is_empty() || s == "." || s == ".." || s.contains('/') || s.contains('\\') {
        return None;
    }
    Some(s.to_string())
}

/// macOS packages (`.app`, `.icon`, `.photoslibrary`, …) are directories that
/// Finder presents as a single opaque file. We must not walk into them on
/// import — their internal assets aren't user media. A directory only needs the
/// (relatively expensive) Launch Services check when it has an extension;
/// extensionless directories are never packages, and on non-macOS there are no
/// packages at all.
fn is_bundle(path: &Path) -> bool {
    if path.extension().is_none() {
        return false;
    }
    is_file_package(path)
}

#[cfg(target_os = "macos")]
fn is_file_package(path: &Path) -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let Some(p) = path.to_str() else { return false; };
    unsafe {
        let Some(ws_cls) = objc2::runtime::AnyClass::get("NSWorkspace") else { return false; };
        let Some(str_cls) = objc2::runtime::AnyClass::get("NSString") else { return false; };
        let ws: *mut AnyObject = msg_send![ws_cls, sharedWorkspace];
        let nsstr: *mut AnyObject = msg_send![str_cls, alloc];
        let bytes = p.as_ptr() as *const std::ffi::c_void;
        let nsstr: *mut AnyObject = msg_send![nsstr, initWithBytes: bytes length: p.len() encoding: 4u64 /* UTF-8 */];
        let is_pkg: bool = msg_send![ws, isFilePackageAtPath: nsstr];
        let _: () = msg_send![nsstr, release];
        is_pkg
    }
}

#[cfg(not(target_os = "macos"))]
fn is_file_package(_path: &Path) -> bool {
    false
}

/// Walk `dir` breadth-first, recording each file together with its sub-folder
/// chain relative to `dir`'s parent — so the imported directory's own name and
/// every nested level are preserved. Iterative to avoid deep-recursion overflow.
/// macOS packages encountered along the way are recorded as a single entry
/// (never descended into), so they land in the import as one unsupported file.
fn collect_dir_preserving(dir: &Path, out: &mut Vec<Discovered>) {
    let base = dir.parent().unwrap_or(dir);
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(dir.to_path_buf());
    while let Some(current) = queue.pop_front() {
        if let Ok(entries) = fs::read_dir(&current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && !is_bundle(&path) {
                    queue.push_back(path);
                } else {
                    // Sub-folder chain = the directory components between `base`
                    // and the file itself, each sanitized.
                    let sub = path
                        .strip_prefix(base)
                        .ok()
                        .and_then(|rel| rel.parent().map(|p| p.to_path_buf()))
                        .map(|parent| parent.components()
                            .filter_map(|c| safe_component(c.as_os_str()))
                            .collect::<Vec<_>>())
                        .unwrap_or_default();
                    out.push(Discovered { src: path, sub });
                }
            }
        }
    }
}

/// Ensure the nested folder chain `sub` exists under the destination folder
/// (`base_id` / `base_rel`), creating any missing `folders` rows and on-disk
/// directories. Reuses existing folders with the same `rel_path` so importing
/// into a structure that already exists merges rather than duplicates. Returns
/// the leaf folder's id and absolute directory.
fn ensure_subfolder(
    conn: &rusqlite::Connection,
    mdir: &Path,
    base_id: &str,
    base_rel: &str,
    sub: &[String],
    any_created: &mut bool,
) -> Result<(String, PathBuf), String> {
    let mut parent_id = base_id.to_string();
    let mut rel = base_rel.to_string();
    for comp in sub {
        rel = format!("{rel}/{comp}");
        let id = match db::folder_id_by_rel_path(conn, &rel).map_err(|e| e.to_string())? {
            Some(id) => id,
            None => {
                let f = db::create_folder(conn, comp, Some(&parent_id), &rel)
                    .map_err(|e| e.to_string())?;
                *any_created = true;
                f.id
            }
        };
        parent_id = id;
    }
    let dir = mdir.join(&rel);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok((parent_id, dir))
}

fn file_sha256(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536]; // 64 KB chunks — never loads the whole file
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

// ── Frontend config ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MapConfig {
    pub cluster_px: f64,
    pub fit_padding_px: f64,
    pub fit_max_zoom: f64,
    pub single_item_zoom: f64,
    pub focus_zoom: f64,
    pub world_view_zoom: f64,
    pub travel_path_reveal_base_ms: f64,
    pub travel_path_reveal_per_stop_ms: f64,
    pub travel_path_reveal_max_ms: f64,
    pub travel_path_dash: f64,
    pub travel_path_gap: f64,
}

/// World Map tunables (src-tauri/src/config.rs), exposed to the frontend —
/// the map itself renders entirely in JS (MapLibre GL / react-map-gl), which
/// has no other way to read these Rust constants. Fetched once on mount.
#[tauri::command]
pub fn get_map_config() -> MapConfig {
    MapConfig {
        cluster_px: crate::config::MAP_CLUSTER_PX,
        fit_padding_px: crate::config::MAP_FIT_PADDING_PX,
        fit_max_zoom: crate::config::MAP_FIT_MAX_ZOOM,
        single_item_zoom: crate::config::MAP_SINGLE_ITEM_ZOOM,
        focus_zoom: crate::config::MAP_FOCUS_ZOOM,
        world_view_zoom: crate::config::MAP_WORLD_VIEW_ZOOM,
        travel_path_reveal_base_ms: crate::config::TRAVEL_PATH_REVEAL_BASE_MS,
        travel_path_reveal_per_stop_ms: crate::config::TRAVEL_PATH_REVEAL_PER_STOP_MS,
        travel_path_reveal_max_ms: crate::config::TRAVEL_PATH_REVEAL_MAX_MS,
        travel_path_dash: crate::config::TRAVEL_PATH_DASH,
        travel_path_gap: crate::config::TRAVEL_PATH_GAP,
    }
}

// ── Media CRUD ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_all_media(state: State<DbState>) -> Result<Vec<MediaItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_all(&conn).map_err(|e| e.to_string())
}

#[derive(Clone, Serialize)]
pub struct MusicAlbum {
    pub album:       String,
    pub artist:      Option<String>,
    pub year:        Option<i64>,
    pub track_count: usize,
    pub total_secs:  f64,
    pub tracks:      Vec<MediaItem>,
}

#[tauri::command]
pub fn get_music_albums(state: State<DbState>) -> Result<Vec<MusicAlbum>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let tracks = db::get_audio_tracks(&conn).map_err(|e| e.to_string())?;

    let mut map: std::collections::BTreeMap<String, Vec<MediaItem>> = std::collections::BTreeMap::new();
    for t in tracks {
        let key = t.audio_album.clone().unwrap_or_else(|| "Unknown Album".into());
        map.entry(key).or_default().push(t);
    }

    let mut albums: Vec<MusicAlbum> = map.into_iter().map(|(album, mut tracks)| {
        tracks.sort_by_key(|t| t.audio_track.unwrap_or(999));
        let artist      = tracks.iter().find_map(|t| t.audio_artist.clone());
        let year        = tracks.iter().find_map(|t| t.audio_year);
        let total_secs  = tracks.iter().filter_map(|t| t.audio_duration).sum();
        let track_count = tracks.len();
        MusicAlbum { album, artist, year, track_count, total_secs, tracks }
    }).collect();
    albums.sort_by(|a, b| a.album.cmp(&b.album));
    Ok(albums)
}

/// Dry run of an import: discover + filter exactly like `run_import`, but copy
/// nothing and touch no DB rows. Lets the UI show a confirmation before any
/// files are written. Skip counts are exact; `new_folders` is computed against
/// the chosen destination (or the default root when none is given).
#[tauri::command]
pub fn preview_import(
    paths: Vec<String>,
    folder_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<ImportPreview, String> {
    let mdir = media_dir(&app)?;
    let state = app.state::<DbState>();

    // Destination rel_path, resolved without side effects (no folder creation).
    let dest_rel = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        match &folder_id {
            Some(fid) => db::fetch_folder(&conn, fid).map_err(|e| e.to_string())?.rel_path,
            None => db::UNCATEGORIZED.to_string(),
        }
    };

    // Discover, mirroring run_import (bundles treated as single opaque files).
    let mut discovered: Vec<Discovered> = Vec::new();
    for path_str in &paths {
        let path = PathBuf::from(path_str);
        if path.is_dir() && !is_bundle(&path) {
            collect_dir_preserving(&path, &mut discovered);
        } else {
            discovered.push(Discovered { src: path, sub: vec![] });
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut to_import = 0usize;
    let mut skipped_type = 0usize;
    let mut skipped_dupe = 0usize;
    let mut new_folders: Vec<String> = Vec::new();
    let mut seen_rel = std::collections::HashSet::new();

    for d in &discovered {
        let ext = d.src.extension().and_then(|e| e.to_str()).unwrap_or("");
        if extension_to_media_type(ext).is_none() { skipped_type += 1; continue; }
        if d.src.starts_with(&mdir) { skipped_dupe += 1; continue; }
        if db::source_path_exists(&conn, &d.src.to_string_lossy()).unwrap_or(true) { skipped_dupe += 1; continue; }
        to_import += 1;

        // Sub-folders that don't exist yet would be created for this kept file.
        let mut rel = dest_rel.clone();
        for comp in &d.sub {
            rel = format!("{rel}/{comp}");
            if seen_rel.insert(rel.clone())
                && db::folder_id_by_rel_path(&conn, &rel).map_err(|e| e.to_string())?.is_none()
            {
                let display = rel.strip_prefix(&dest_rel).unwrap_or(&rel).trim_start_matches('/').to_string();
                new_folders.push(display);
            }
        }
    }

    Ok(ImportPreview { to_import, skipped_type, skipped_dupe, new_folders })
}

#[tauri::command]
pub fn import_paths(
    paths: Vec<String>,
    collection_id: Option<String>,
    folder_id: Option<String>,
    filename: Option<String>,
    silent: Option<bool>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Run the whole import off the IPC/UI thread so the app stays responsive on
    // large batches. The frontend gets results through events rather than this
    // call's return value: import-progress (throttled), import-batch (streamed
    // item chunks), and import-done (final summary).
    let silent = silent.unwrap_or(false);
    std::thread::spawn(move || {
        if let Err(e) = run_import(&app, paths, collection_id, folder_id, filename, silent) {
            tracing::error!(error = %e, "import failed");
            if !silent {
                let _ = app.emit("import-done", ImportDone {
                    imported: 0, skipped_type: 0, skipped_dupe: 0, failed: 0,
                });
            }
        }
    });
    Ok(())
}

/// The real import work, executed on a background thread. Copies files
/// (recreating the nested structure of any imported directory), extracts
/// metadata, inserts in chunks, and streams each chunk to the frontend.
pub(crate) fn run_import(
    app: &tauri::AppHandle,
    paths: Vec<String>,
    collection_id: Option<String>,
    folder_id: Option<String>,
    filename: Option<String>,
    silent: bool,
) -> Result<(), String> {
    use std::time::Instant;

    let mdir = media_dir(app)?;
    let state = app.state::<DbState>();

    // Resolve the destination folder (chosen, or Uncategorized). Its rel_path is
    // the root under which any preserved sub-folders get created.
    let (dest_id, dest_rel) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let folder = match &folder_id {
            Some(fid) => db::fetch_folder(&conn, fid).map_err(|e| e.to_string())?,
            None => {
                let id = db::ensure_uncategorized(&conn).map_err(|e| e.to_string())?;
                db::fetch_folder(&conn, &id).map_err(|e| e.to_string())?
            }
        };
        (folder.id, folder.rel_path)
    };
    fs::create_dir_all(mdir.join(&dest_rel)).map_err(|e| e.to_string())?;

    // Discover files, preserving the sub-folder chain of any imported directory.
    let mut discovered: Vec<Discovered> = Vec::new();
    for path_str in &paths {
        let path = PathBuf::from(path_str);
        // A macOS package (.icon, .app, …) is a directory but must be treated as
        // a single opaque file, not walked into.
        if path.is_dir() && !is_bundle(&path) {
            collect_dir_preserving(&path, &mut discovered);
        } else {
            discovered.push(Discovered { src: path, sub: vec![] });
        }
    }

    // Filter: skip unsupported types, files already inside the library, and
    // already-imported sources. One DB lock for the whole pass.
    let (mut candidates, skipped_type, skipped_dupe): (Vec<Discovered>, usize, usize) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut st = 0usize;
        let mut sd = 0usize;
        let kept: Vec<Discovered> = discovered.into_iter().filter(|d| {
            let ext = d.src.extension().and_then(|e| e.to_str()).unwrap_or("");
            if extension_to_media_type(ext).is_none() { st += 1; return false; }
            if d.src.starts_with(&mdir) { sd += 1; return false; }
            if db::source_path_exists(&conn, &d.src.to_string_lossy()).unwrap_or(true) { sd += 1; return false; }
            true
        }).collect();
        (kept, st, sd)
    };

    let total = candidates.len();
    if total == 0 {
        if !silent { let _ = app.emit("import-done", ImportDone { imported: 0, skipped_type, skipped_dupe, failed: 0 }); }
        return Ok(());
    }

    // Pre-create every needed destination sub-folder once (DB rows + on-disk
    // dirs), caching the leaf folder id + directory per sub-path so the copy
    // loop below needs no DB lock for placement.
    let mut folder_cache: std::collections::HashMap<Vec<String>, (String, PathBuf)> =
        std::collections::HashMap::new();
    let mut folders_created = false;
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        for d in &candidates {
            if folder_cache.contains_key(&d.sub) { continue; }
            let resolved = ensure_subfolder(&conn, &mdir, &dest_id, &dest_rel, &d.sub, &mut folders_created)?;
            folder_cache.insert(d.sub.clone(), resolved);
        }
    }
    if folders_created {
        let _ = app.emit("folders-changed", ()); // refresh the folder tree
    }

    const CHUNK: usize = 24;
    let mut imported = 0usize;
    let mut failed = 0usize;
    let mut chunk: Vec<MediaItem> = Vec::with_capacity(CHUNK);
    let mut last_progress = Instant::now();

    for (i, d) in candidates.drain(..).enumerate() {
        let orig_name = d.src.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        // A custom filename only applies to a single loose-file import.
        let file_name = if total == 1 && d.sub.is_empty() {
            if let Some(ref custom) = filename {
                let ext = d.src.extension().and_then(|e| e.to_str()).unwrap_or("");
                let stem = custom.trim().trim_end_matches('.');
                if stem.is_empty() { orig_name.clone() }
                else if ext.is_empty() { stem.to_string() }
                else { format!("{stem}.{ext}") }
            } else { orig_name.clone() }
        } else { orig_name.clone() };

        // Throttle progress to ~12/sec (plus a guaranteed final tick) so the UI
        // isn't flooded with re-renders on a huge import.
        if last_progress.elapsed().as_millis() >= 80 || i + 1 == total {
            let _ = app.emit("import-progress", ImportProgress {
                current: i + 1, total, file_name: file_name.clone(),
            });
            last_progress = Instant::now();
        }

        let (leaf_id, leaf_dir) = folder_cache.get(&d.sub).expect("sub-folder pre-created");
        let dest = unique_path(leaf_dir, &file_name);
        if let Err(e) = fs::copy(&d.src, &dest) {
            tracing::warn!(path = ?d.src, error = %e, "Import copy failed, skipping");
            failed += 1;
            continue;
        }

        let source_str = d.src.to_string_lossy().to_string();
        let mut item = match build_item(&dest, Some(source_str)) {
            Ok(it) => it,
            Err(e) => {
                tracing::warn!(error = %e, "build_item failed");
                let _ = fs::remove_file(&dest);
                failed += 1;
                continue;
            }
        };

        if item.media_type == "image" {
            if let Ok((lat, lng)) = extract_gps_coords(&dest) {
                item.gps_lat = lat;
                item.gps_lng = lng;
            }
            if let Ok(meta) = get_media_metadata(dest.to_string_lossy().to_string()) {
                item.date_taken = meta.date_taken;
                item.camera_make = meta.camera_make;
                item.camera_model = meta.camera_model;
            }
        }
        if item.media_type == "audio" {
            if let Ok(meta) = extract_audio_meta(&dest) {
                if meta.title.is_some() {
                    item.display_name = meta.title.clone().unwrap_or(item.display_name.clone());
                }
                item.audio_title    = meta.title;
                item.audio_artist   = meta.artist;
                item.audio_album    = meta.album;
                item.audio_track    = meta.track;
                item.audio_duration = meta.duration_secs;
                item.audio_year     = meta.year;
            }
        }
        if let Some(ref gid) = collection_id {
            // Only assign if the collection kind is compatible with the item's media type.
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let kind = db::collection_kind(&conn, gid).unwrap_or_default();
            let compatible = match kind.as_str() {
                "album"    => item.media_type == "image" || item.media_type == "video",
                "playlist" => item.media_type == "audio" || item.media_type == "video",
                _          => true,
            };
            drop(conn);
            if compatible { item.collection_id = Some(gid.clone()); }
        }
        item.folder_id = Some(leaf_id.clone());
        chunk.push(item);

        if chunk.len() >= CHUNK {
            imported += flush_chunk(&state, app, &mut chunk)?;
        }
    }
    imported += flush_chunk(&state, app, &mut chunk)?; // flush remainder

    tracing::info!(imported, skipped_type, skipped_dupe, failed, "Import complete");
    if imported > 0 {
        trigger_embed_if_ready(app);
        // Backfill thumbnails for the new items; streams thumb-item events so
        // grid previews appear without a full reload.
        let _ = generate_thumbnails_all(app.clone());
        // Same catch-up for OCR — bulk import inserts rows directly via
        // flush_chunk (not insert_imported), so it never gets the per-item
        // trigger_ocr call that single-item creation paths (trim, image
        // editor "Save Copy", GIF export, etc.) get automatically.
        let _ = ocr::run_ocr_all(app.clone());
    }
    if !silent { let _ = app.emit("import-done", ImportDone { imported, skipped_type, skipped_dupe, failed }); }
    Ok(())
}

/// Insert a chunk of built items in one transaction and stream the successful
/// ones to the frontend via `import-batch`. Empties `chunk`; returns how many
/// rows were inserted.
fn flush_chunk(
    state: &DbState,
    app: &tauri::AppHandle,
    chunk: &mut Vec<MediaItem>,
) -> Result<usize, String> {
    if chunk.is_empty() { return Ok(0); }
    let batch = std::mem::take(chunk);
    let mut inserted: Vec<MediaItem> = Vec::with_capacity(batch.len());
    {
        let mut conn = state.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for item in batch {
            if db::insert(&tx, &item).is_ok() {
                inserted.push(item);
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }
    let n = inserted.len();
    if n > 0 {
        let _ = app.emit("import-batch", ImportBatch { items: inserted });
    }
    Ok(n)
}

// ── Workspace adoption (external workspaces) ─────────────────────────────────
//
// An external workspace's media root is a folder the user already had, full
// of files that were never copied in by Vivid. `run_import` above always
// copies its source into the managed tree, which is the wrong operation
// here — adoption must index files exactly where they already sit. This is
// a deliberately separate pipeline (not a mode flag on `run_import`) so the
// well-exercised copy-based import path can't regress from changes made for
// this newer, less-tested one.

/// Walk a workspace's root, recording every file with its sub-folder chain
/// relative to the root itself. Unlike `collect_dir_preserving` (which keeps
/// the *imported* directory's own name as the first path component, since
/// that directory is being placed *into* the library), the root directory
/// here *is* the library, so it never appears in the chain. Vivid's own
/// `.vivid/` derived-data directory is skipped rather than adopted as media.
fn collect_workspace_root(root: &Path, out: &mut Vec<Discovered>) {
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(root.to_path_buf());
    while let Some(current) = queue.pop_front() {
        let Ok(entries) = fs::read_dir(&current) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if current == root && path.file_name().and_then(|n| n.to_str()) == Some(workspace::VIVID_SUBDIR) {
                continue;
            }
            if path.is_dir() && !is_bundle(&path) {
                queue.push_back(path);
            } else {
                let sub = path
                    .strip_prefix(root)
                    .ok()
                    .and_then(|rel| rel.parent().map(|p| p.to_path_buf()))
                    .map(|parent| parent.components()
                        .filter_map(|c| safe_component(c.as_os_str()))
                        .collect::<Vec<_>>())
                    .unwrap_or_default();
                out.push(Discovered { src: path, sub });
            }
        }
    }
}

/// Like `ensure_subfolder`, but anchored at the workspace root itself instead
/// of a chosen destination folder — `sub`'s components become the folder's
/// `rel_path` directly (no prefix), matching its real on-disk location, and
/// no directories are created since adoption never touches the filesystem.
/// An empty `sub` (a file sitting loose at the root) intentionally resolves
/// to no folder at all rather than an "Uncategorized" bucket — the folder
/// tree here should mirror the user's existing layout exactly, not impose
/// one.
fn ensure_subfolder_from_root(
    conn: &rusqlite::Connection,
    mdir: &Path,
    sub: &[String],
    any_created: &mut bool,
) -> Result<(Option<String>, PathBuf), String> {
    if sub.is_empty() {
        return Ok((None, mdir.to_path_buf()));
    }
    let mut parent_id: Option<String> = None;
    let mut rel = String::new();
    for comp in sub {
        rel = if rel.is_empty() { comp.clone() } else { format!("{rel}/{comp}") };
        let id = match db::folder_id_by_rel_path(conn, &rel).map_err(|e| e.to_string())? {
            Some(id) => id,
            None => {
                let f = db::create_folder(conn, comp, parent_id.as_deref(), &rel).map_err(|e| e.to_string())?;
                *any_created = true;
                f.id
            }
        };
        parent_id = Some(id);
    }
    Ok((parent_id, mdir.join(&rel)))
}

/// Adopt every not-yet-tracked file under an external workspace's root into
/// the DB, in place. Safe to call repeatedly (on every launch, or from a
/// manual "Rescan" action): already-tracked paths are skipped via the same
/// `source_path_exists` check `run_import` uses, so this only ever picks up
/// files that are new since the last scan. It does not detect files that
/// were removed or modified since the last scan — that reconciliation is a
/// live filesystem watcher, not yet implemented (see workspace plan).
pub(crate) fn run_workspace_scan(app: &tauri::AppHandle) -> Result<(), String> {
    use std::time::Instant;

    let mdir = media_dir(app)?;
    let state = app.state::<DbState>();

    let mut discovered: Vec<Discovered> = Vec::new();
    collect_workspace_root(&mdir, &mut discovered);

    let (mut candidates, skipped_type, skipped_dupe): (Vec<Discovered>, usize, usize) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut st = 0usize;
        let mut sd = 0usize;
        let kept: Vec<Discovered> = discovered.into_iter().filter(|d| {
            let ext = d.src.extension().and_then(|e| e.to_str()).unwrap_or("");
            if extension_to_media_type(ext).is_none() { st += 1; return false; }
            if db::source_path_exists(&conn, &d.src.to_string_lossy()).unwrap_or(true) { sd += 1; return false; }
            true
        }).collect();
        (kept, st, sd)
    };

    let total = candidates.len();
    if total == 0 {
        let _ = app.emit("import-done", ImportDone { imported: 0, skipped_type, skipped_dupe, failed: 0 });
        return Ok(());
    }

    let mut folder_cache: std::collections::HashMap<Vec<String>, (Option<String>, PathBuf)> =
        std::collections::HashMap::new();
    let mut folders_created = false;
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        for d in &candidates {
            if folder_cache.contains_key(&d.sub) { continue; }
            let resolved = ensure_subfolder_from_root(&conn, &mdir, &d.sub, &mut folders_created)?;
            folder_cache.insert(d.sub.clone(), resolved);
        }
    }
    if folders_created {
        let _ = app.emit("folders-changed", ());
    }

    const CHUNK: usize = 24;
    let mut imported = 0usize;
    let mut chunk: Vec<MediaItem> = Vec::with_capacity(CHUNK);
    let mut last_progress = Instant::now();

    for (i, d) in candidates.drain(..).enumerate() {
        let file_name = d.src.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();

        if last_progress.elapsed().as_millis() >= 80 || i + 1 == total {
            let _ = app.emit("import-progress", ImportProgress { current: i + 1, total, file_name: file_name.clone() });
            last_progress = Instant::now();
        }

        let (leaf_id, _leaf_dir) = folder_cache.get(&d.sub).expect("sub-folder pre-resolved");
        let source_str = d.src.to_string_lossy().to_string();
        let mut item = match build_item(&d.src, Some(source_str)) {
            Ok(it) => it,
            Err(e) => {
                tracing::warn!(path = ?d.src, error = %e, "workspace scan: build_item failed, skipping");
                continue;
            }
        };
        if item.media_type == "image" {
            if let Ok((lat, lng)) = extract_gps_coords(&d.src) { item.gps_lat = lat; item.gps_lng = lng; }
            if let Ok(meta) = get_media_metadata(d.src.to_string_lossy().to_string()) {
                item.date_taken = meta.date_taken;
                item.camera_make = meta.camera_make;
                item.camera_model = meta.camera_model;
            }
        }
        if item.media_type == "audio" {
            if let Ok(meta) = extract_audio_meta(&d.src) {
                if meta.title.is_some() { item.display_name = meta.title.clone().unwrap_or(item.display_name.clone()); }
                item.audio_title    = meta.title;
                item.audio_artist   = meta.artist;
                item.audio_album    = meta.album;
                item.audio_track    = meta.track;
                item.audio_duration = meta.duration_secs;
                item.audio_year     = meta.year;
            }
        }
        item.folder_id = leaf_id.clone();
        chunk.push(item);

        if chunk.len() >= CHUNK {
            imported += flush_chunk(&state, app, &mut chunk)?;
        }
    }
    imported += flush_chunk(&state, app, &mut chunk)?;

    tracing::info!(imported, skipped_type, skipped_dupe, "Workspace scan complete");
    if imported > 0 {
        trigger_embed_if_ready(app);
        let _ = generate_thumbnails_all(app.clone());
        let _ = ocr::run_ocr_all(app.clone());
    }
    let _ = app.emit("import-done", ImportDone { imported, skipped_type, skipped_dupe, failed: 0 });
    Ok(())
}

/// Adopt any new files in the active workspace's root (external workspaces
/// only — a Default workspace's media dir is entirely Vivid-managed, so
/// there's never anything to adopt there). Runs off the IPC thread and
/// reports through the same `import-progress`/`import-batch`/`import-done`
/// events as a regular import, so the frontend needs no separate UI for it.
/// Safe to call on every launch and from an explicit "Rescan Folder" action.
#[tauri::command]
pub fn scan_workspace(app: tauri::AppHandle) -> Result<(), String> {
    if app.state::<workspace::WorkspaceState>().workspace.kind != workspace::WorkspaceKind::External {
        return Ok(());
    }
    std::thread::spawn(move || {
        if let Err(e) = run_workspace_scan(&app) {
            tracing::error!(error = %e, "workspace scan failed");
        }
    });
    Ok(())
}

#[cfg(test)]
mod workspace_scan_tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn open_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn
    }

    // ── collect_workspace_root ───────────────────────────────────────────

    #[test]
    fn loose_root_file_has_no_sub_path() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"").unwrap();

        let mut out = Vec::new();
        collect_workspace_root(dir.path(), &mut out);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].src, dir.path().join("a.jpg"));
        assert!(out[0].sub.is_empty());
    }

    #[test]
    fn nested_file_records_its_folder_chain() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Trip/Beach")).unwrap();
        std::fs::write(dir.path().join("Trip/Beach/b.jpg"), b"").unwrap();

        let mut out = Vec::new();
        collect_workspace_root(dir.path(), &mut out);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].sub, vec!["Trip".to_string(), "Beach".to_string()]);
    }

    #[test]
    fn vivid_subdir_at_root_is_skipped() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(workspace::VIVID_SUBDIR)).unwrap();
        std::fs::write(dir.path().join(workspace::VIVID_SUBDIR).join("vivid.db"), b"").unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"").unwrap();

        let mut out = Vec::new();
        collect_workspace_root(dir.path(), &mut out);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].src, dir.path().join("a.jpg"));
    }

    #[test]
    fn macos_bundle_is_not_descended_into() {
        // is_bundle() only ever returns true on macOS (see its doc comment);
        // elsewhere it's always false, so a plain directory with an
        // extension is walked normally there. Assert whichever behavior
        // this platform actually has, rather than assuming macOS.
        let dir = tempdir().unwrap();
        let bundle = dir.path().join("Something.app");
        std::fs::create_dir_all(&bundle).unwrap();
        std::fs::write(bundle.join("inner.jpg"), b"").unwrap();

        let mut out = Vec::new();
        collect_workspace_root(dir.path(), &mut out);

        if is_bundle(&bundle) {
            // Not descended into — the bundle itself is recorded as one
            // opaque entry, its inner "inner.jpg" is never seen.
            assert_eq!(out.len(), 1);
            assert_eq!(out[0].src, bundle);
        } else {
            assert_eq!(out.len(), 1);
            assert_eq!(out[0].src, bundle.join("inner.jpg"));
        }
    }

    // ── ensure_subfolder_from_root ───────────────────────────────────────

    #[test]
    fn empty_sub_resolves_to_no_folder() {
        let conn = open_db();
        let mut created = false;
        let (folder_id, dir) = ensure_subfolder_from_root(&conn, Path::new("/root"), &[], &mut created).unwrap();
        assert!(folder_id.is_none());
        assert_eq!(dir, PathBuf::from("/root"));
        assert!(!created);
    }

    #[test]
    fn nested_sub_creates_folder_chain_with_real_rel_paths() {
        let conn = open_db();
        let mut created = false;
        let sub = vec!["Trip".to_string(), "Beach".to_string()];
        let (folder_id, dir) = ensure_subfolder_from_root(&conn, Path::new("/root"), &sub, &mut created).unwrap();

        assert!(created);
        let folder_id = folder_id.unwrap();
        let folder = db::fetch_folder(&conn, &folder_id).unwrap();
        // No "Uncategorized" prefix — rel_path mirrors the real on-disk
        // location exactly, since adoption never moves anything.
        assert_eq!(folder.rel_path, "Trip/Beach");
        assert_eq!(folder.name, "Beach");
        assert_eq!(dir, PathBuf::from("/root/Trip/Beach"));
    }

    #[test]
    fn repeated_sub_reuses_existing_folder_row() {
        let conn = open_db();
        let mut created = false;
        let sub = vec!["Trip".to_string()];
        let (first_id, _) = ensure_subfolder_from_root(&conn, Path::new("/root"), &sub, &mut created).unwrap();

        let mut created_again = false;
        let (second_id, _) = ensure_subfolder_from_root(&conn, Path::new("/root"), &sub, &mut created_again).unwrap();

        assert_eq!(first_id, second_id);
        assert!(!created_again, "second call should reuse the existing folder row");
    }
}

#[tauri::command]
pub fn update_media(
    id: String,
    display_name: String,
    description: String,
    tags: Vec<String>,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update(&conn, &id, &display_name, &description, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_star(id: String, state: State<DbState>) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::toggle_star(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_collection(
    id: String,
    collection_id: Option<String>,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(ref cid) = collection_id {
        let item = db::fetch_one(&conn, &id).map_err(|e| e.to_string())?;
        let kind = db::collection_kind(&conn, cid).map_err(|e| e.to_string())?;
        let compatible = match kind.as_str() {
            "album"    => item.media_type == "image" || item.media_type == "video",
            "playlist" => item.media_type == "audio" || item.media_type == "video",
            _          => true,
        };
        if !compatible {
            return Err(format!("INCOMPATIBLE_COLLECTION: {} cannot be added to a {} collection", item.media_type, kind));
        }
    }
    db::set_collection(&conn, &id, collection_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_media(
    id: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<(), String> {
    let mdir = media_dir(&app)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(file_path) = db::remove(&conn, &id).map_err(|e| e.to_string())? {
        let path = PathBuf::from(&file_path);
        if path.starts_with(&mdir) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

// ── Trash ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn trash_media(id: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::trash_item(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_media(id: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::restore_item(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_trash(state: State<DbState>) -> Result<Vec<MediaItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_trash(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn empty_trash(app: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    let mdir = media_dir(&app)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let paths = db::empty_trash(&conn).map_err(|e| e.to_string())?;
    for p in paths {
        let path = PathBuf::from(&p);
        if path.starts_with(&mdir) { let _ = fs::remove_file(&path); }
    }
    Ok(())
}

#[tauri::command]
pub fn purge_old_trash(days: i64, app: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    let mdir = media_dir(&app)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let paths = db::purge_old_trash(&conn, days).map_err(|e| e.to_string())?;
    for p in paths {
        let path = PathBuf::from(&p);
        if path.starts_with(&mdir) { let _ = fs::remove_file(&path); }
    }
    Ok(())
}

// ── Groups ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_collections(state: State<DbState>) -> Result<Vec<Collection>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_collections(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(
    name: String,
    color: String,
    emoji: Option<String>,
    kind: Option<String>,
    state: State<DbState>,
) -> Result<Collection, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let emoji_ref = emoji.as_deref().filter(|s| !s.is_empty());
    let kind_str = kind.as_deref().unwrap_or("album");
    if db::collection_name_taken(&conn, &name, kind_str, None).map_err(|e| e.to_string())? {
        return Err("DUPLICATE_NAME".into());
    }
    db::create_collection(&conn, &name, &color, emoji_ref, kind_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(id: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_collection(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_collection(id: String, name: String, state: State<DbState>) -> Result<Collection, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let kind = db::collection_kind(&conn, &id).map_err(|e| e.to_string())?;
    if db::collection_name_taken(&conn, &name, &kind, Some(&id)).map_err(|e| e.to_string())? {
        return Err("DUPLICATE_NAME".into());
    }
    db::rename_collection(&conn, &id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pin_collection(id: String, pinned: bool, state: State<DbState>) -> Result<Collection, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::pin_collection(&conn, &id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_collection_description(
    id: String,
    description: Option<String>,
    state: State<DbState>,
) -> Result<Collection, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Treat blank input as "no description" so the column stays NULL rather than "".
    let desc = description.as_deref().map(str::trim).filter(|s| !s.is_empty());
    db::set_collection_description(&conn, &id, desc).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_sidebar_pin(id: String, pinned: bool, state: State<'_, DbState>) -> Result<Collection, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_sidebar_pin(&conn, &id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_collection_cover(
    collection_id: String,
    cover_item_id: Option<String>,
    state: State<DbState>,
) -> Result<Collection, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_collection_cover(&conn, &collection_id, cover_item_id.as_deref()).map_err(|e| e.to_string())
}

// ── System integration ────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_system_settings_privacy() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_in_browser(url: String) -> Result<(), String> {
    // Only ever hand a web URL to `open`. Without this guard, `open` would also
    // launch local files, `.app` bundles, or custom URL schemes — so any caller
    // (or a compromised renderer) could turn this into local execution. The JS
    // callers already filter to http(s), but the trust boundary is here.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Refusing to open a non-http(s) URL".into());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_photos_library_path() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Cannot determine HOME".to_string())?;
    let path = PathBuf::from(&home)
        .join("Pictures")
        .join("Photos Library.photoslibrary")
        .join("originals");
    if path.exists() {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Photos Library not found at ~/Pictures/Photos Library.photoslibrary".to_string())
    }
}

// ── Screenshot capture ────────────────────────────────────────────────────────

#[tauri::command]
pub fn capture_screenshot(
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let mdir = media_dir(&app)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs()).unwrap_or(0);
    let tmp = format!("/tmp/vivid_screenshot_{ts}.png");

    let output = std::process::Command::new("screencapture")
        .args(["-i", "-x", &tmp])
        .output()
        .map_err(|e| format!("screencapture unavailable: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("could not create image") || stderr.contains("permission") {
        return Err(
            "PERMISSION_DENIED: Screen Recording permission is required.\n\
             Go to System Settings → Privacy & Security → Screen Recording and enable Vivid."
                .into(),
        );
    }
    if !output.status.success() {
        return Err("Screenshot cancelled or failed.".into());
    }
    let tmp_path = Path::new(&tmp);
    if !tmp_path.exists() {
        return Err("Screenshot cancelled.".into());
    }
    let file_size = fs::metadata(tmp_path).map(|m| m.len()).unwrap_or(0);
    if file_size < 1024 {
        let _ = fs::remove_file(tmp_path);
        return Err(
            "PERMISSION_DENIED: Screen Recording permission is required.\n\
             Go to System Settings → Privacy & Security → Screen Recording and enable Vivid."
                .into(),
        );
    }

    let dest = unique_path(&mdir, &format!("Screenshot {ts}.png"));
    fs::copy(&tmp, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&tmp);

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut item = build_item(&dest, None)?;
    insert_imported(&conn, &mut item, &app)?;
    Ok(item)
}

// ── Video frame capture ────────────────────────────────────────────────────────

/// Save a still frame grabbed from the video player as a new library image.
/// The frontend draws the current frame onto a canvas and hands over the JPEG
/// as a data URL; this just decodes it and drops it straight into the library
/// (Uncategorized, like the screenshot path above) — no import dialog.
#[tauri::command]
pub fn save_video_frame(
    app: tauri::AppHandle,
    state: State<DbState>,
    data_url: String,
    file_name: String,
) -> Result<MediaItem, String> {
    let bytes = decode_data_url(&data_url)?;

    let mdir = media_dir(&app)?;
    let dest = unique_path(&mdir, &file_name);
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut item = build_item(&dest, None)?;
    insert_imported(&conn, &mut item, &app)?;
    Ok(item)
}

// ── EXIF / metadata ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_media_metadata(file_path: String) -> Result<ExifMetadata, String> {
    use crate::clip::heif_to_jpeg_if_needed;
    let path = Path::new(&file_path);
    let mut meta = ExifMetadata::default();

    let effective_path_buf = heif_to_jpeg_if_needed(path).ok().flatten();
    let effective_path: &Path = effective_path_buf.as_deref().unwrap_or(path);

    if let Ok((w, h)) = image::image_dimensions(effective_path) {
        meta.width  = Some(w);
        meta.height = Some(h);
    }

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = std::io::BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut buf) {
        Ok(e) => e,
        Err(_) => return Ok(meta),
    };

    let str_field = |tag| -> Option<String> {
        exif.get_field(tag, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string().trim_matches('"').to_string())
    };

    meta.camera_make  = str_field(exif::Tag::Make);
    meta.camera_model = str_field(exif::Tag::Model);
    meta.lens_model   = str_field(exif::Tag::LensModel)
        .or_else(|| str_field(exif::Tag::LensMake));
    meta.software     = str_field(exif::Tag::Software);
    meta.color_space  = str_field(exif::Tag::ColorSpace);
    meta.flash        = str_field(exif::Tag::Flash);

    if let Some(f) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
        meta.orientation = Some(f.display_value().to_string());
    }

    meta.date_taken = str_field(exif::Tag::DateTimeOriginal)
        .or_else(|| str_field(exif::Tag::DateTime));

    if let Some(f) = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY) {
        if let exif::Value::Rational(ref v) = f.value {
            if let Some(r) = v.first() {
                let mm = r.num as f64 / r.denom as f64;
                meta.focal_length = Some(format!("{mm:.0} mm"));
            }
        }
    }

    if let Some(f) = exif.get_field(exif::Tag::FNumber, exif::In::PRIMARY) {
        if let exif::Value::Rational(ref v) = f.value {
            if let Some(r) = v.first() {
                let fnum = r.num as f64 / r.denom as f64;
                meta.aperture = Some(format!("f/{fnum:.1}"));
            }
        }
    }

    if let Some(f) = exif.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY) {
        if let exif::Value::Rational(ref v) = f.value {
            if let Some(r) = v.first() {
                meta.shutter_speed = Some(if r.num < r.denom {
                    format!("1/{} s", r.denom / r.num.max(1))
                } else {
                    format!("{:.1} s", r.num as f64 / r.denom as f64)
                });
            }
        }
    }

    if let Some(f) = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY) {
        if let exif::Value::Short(ref v) = f.value {
            if let Some(&iso) = v.first() {
                meta.iso = Some(iso as u32);
            }
        }
    }

    meta.gps_latitude  = parse_gps(&exif, exif::Tag::GPSLatitude,  exif::Tag::GPSLatitudeRef);
    meta.gps_longitude = parse_gps(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef);

    Ok(meta)
}

fn parse_gps(exif: &exif::Exif, coord_tag: exif::Tag, ref_tag: exif::Tag) -> Option<f64> {
    let coord_field = exif.get_field(coord_tag, exif::In::PRIMARY)?;
    let ref_field   = exif.get_field(ref_tag,   exif::In::PRIMARY)?;

    let decimal = if let exif::Value::Rational(ref v) = coord_field.value {
        if v.len() < 3 { return None; }
        let deg = v[0].num as f64 / v[0].denom.max(1) as f64;
        let min = v[1].num as f64 / v[1].denom.max(1) as f64;
        let sec = v[2].num as f64 / v[2].denom.max(1) as f64;
        deg + min / 60.0 + sec / 3600.0
    } else {
        return None;
    };

    let ref_char = match &ref_field.value {
        exif::Value::Ascii(vec) => {
            vec.first()
                .and_then(|bytes| bytes.iter().find(|&&b| b != 0))
                .copied()
                .map(|b| b as char)
        }
        _ => {
            let s = ref_field.display_value().to_string();
            if s.contains('S') || s.contains('W') { Some('S') } else { Some('N') }
        }
    }?;

    Some(if ref_char == 'S' || ref_char == 'W' { -decimal } else { decimal })
}

fn extract_gps_coords(path: &Path) -> Result<(Option<f64>, Option<f64>), String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = std::io::BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut buf) {
        Ok(e) => e,
        Err(_) => return Ok((None, None)),
    };
    let lat = parse_gps(&exif, exif::Tag::GPSLatitude,  exif::Tag::GPSLatitudeRef);
    let lng = parse_gps(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef);
    Ok((lat, lng))
}

// ── Misc item commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_color_label(
    id: String,
    label: Option<String>,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_color_label(&conn, &id, label.as_deref()).map_err(|e| e.to_string())
}

/// Rename the on-disk file's name — just the stem, no extension or
/// directory, matching what the frontend collects — keeping its extension
/// and location unchanged. Distinct from `update_media`'s `display_name`
/// (library metadata shown in the UI): this renames the actual file on
/// disk. Fails if the resulting filename would collide with a file already
/// at that path, so callers renaming several items at once should
/// pre-validate the whole batch doesn't collide with itself first — this
/// only catches collisions against what's already on disk when it runs.
#[tauri::command]
pub fn rename_file(id: String, new_stem: String, state: State<DbState>) -> Result<MediaItem, String> {
    let stem = new_stem.trim();
    if stem.is_empty() {
        return Err("File name can't be empty".into());
    }
    if stem.contains('/') || stem.contains('\\') || stem.contains('\0') {
        return Err("File name can't contain a path separator".into());
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let item = db::fetch_one(&conn, &id).map_err(|e| e.to_string())?;
    let src = Path::new(&item.file_path);
    let new_file_name = match src.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{stem}.{ext}"),
        None => stem.to_string(),
    };
    let parent = src.parent().unwrap_or_else(|| Path::new("."));
    let dest = parent.join(&new_file_name);

    if dest == src {
        return Ok(item); // unchanged
    }
    if dest.exists() {
        return Err(format!("A file named \"{new_file_name}\" already exists"));
    }

    fs::rename(src, &dest).map_err(|e| e.to_string())?;
    db::rename_file(&conn, &id, &dest.to_string_lossy(), &new_file_name).map_err(|e| e.to_string())
}

/// Manually set (or, passing both as null, clear) an item's location — used
/// by the "adjust location" map picker in the detail panel.
#[tauri::command]
pub fn set_media_location(
    id: String,
    lat: Option<f64>,
    lng: Option<f64>,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_location(&conn, &id, lat, lng).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_item_order(id: String, sort_order: i64, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_sort_order(&conn, &id, sort_order).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_audio_meta(
    id: String,
    artist: Option<String>,
    album: Option<String>,
    title: Option<String>,
    year: Option<i64>,
    track: Option<i64>,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_audio_meta(
        &conn, &id,
        artist.as_deref(), album.as_deref(), title.as_deref(),
        year, track,
    ).map_err(|e| e.to_string())
}

// ── Duplicate detection ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{normalize_abs, unique_path};
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    #[test]
    fn normalize_resolves_dot_and_parent() {
        assert_eq!(normalize_abs(Path::new("/a/b/../c/./d")), PathBuf::from("/a/c/d"));
    }

    #[test]
    fn unique_path_no_conflict() {
        let dir = tempdir().unwrap();
        let result = unique_path(dir.path(), "photo.jpg");
        assert_eq!(result, dir.path().join("photo.jpg"));
    }

    #[test]
    fn unique_path_one_conflict() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("photo.jpg"), b"").unwrap();

        let result = unique_path(dir.path(), "photo.jpg");
        assert_eq!(result, dir.path().join("photo_2.jpg"));
    }

    #[test]
    fn unique_path_multiple_conflicts() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("photo.jpg"),   b"").unwrap();
        std::fs::write(dir.path().join("photo_2.jpg"), b"").unwrap();
        std::fs::write(dir.path().join("photo_3.jpg"), b"").unwrap();

        let result = unique_path(dir.path(), "photo.jpg");
        assert_eq!(result, dir.path().join("photo_4.jpg"));
    }

    #[test]
    fn unique_path_no_extension() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("README"), b"").unwrap();

        let result = unique_path(dir.path(), "README");
        assert_eq!(result, dir.path().join("README_2"));
    }

    #[test]
    fn unique_path_dot_file() {
        let dir = tempdir().unwrap();
        // .gitignore has no stem if treated as extension-only, but Path::file_stem returns ".gitignore"
        let result = unique_path(dir.path(), "archive.tar.gz");
        assert_eq!(result, dir.path().join("archive.tar.gz"));
    }
}

#[derive(serde::Serialize)]
pub struct LibraryStats {
    pub total_images:    i64,
    pub total_videos:    i64,
    pub total_audio:     i64,
    pub total_indexed:   i64,
    pub total_unindexed: i64,
    pub total_tags:      i64,
    pub total_size_bytes: i64,
}

#[tauri::command]
pub fn get_library_stats(state: State<DbState>) -> Result<LibraryStats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (images, videos, audio, indexed, unindexed, tags, size) =
        db::get_library_stats(&conn).map_err(|e| e.to_string())?;
    Ok(LibraryStats {
        total_images:     images,
        total_videos:     videos,
        total_audio:      audio,
        total_indexed:    indexed,
        total_unindexed:  unindexed,
        total_tags:       tags,
        total_size_bytes: size,
    })
}

/// Hash library files and return collections with identical SHA-256.
/// Pre-filters by file_size first — files with a unique size cannot be
/// duplicates — so we only hash the small subset of size-colliding files.
/// Lock is released before any disk I/O to avoid blocking other operations.
#[tauri::command]
pub fn find_duplicates(state: State<DbState>) -> Result<Vec<Vec<MediaItem>>, String> {
    // Fetch metadata only; release lock before touching the filesystem.
    let all = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::get_all(&conn).map_err(|e| e.to_string())?
    };

    // Collection by file_size — only items that share a size are worth hashing.
    let mut by_size: std::collections::HashMap<i64, Vec<MediaItem>> =
        std::collections::HashMap::new();
    for item in all {
        by_size.entry(item.file_size).or_default().push(item);
    }

    let mut by_hash: std::collections::HashMap<String, Vec<MediaItem>> =
        std::collections::HashMap::new();
    for candidates in by_size.into_values().filter(|g| g.len() > 1) {
        for item in candidates {
            if let Some(hash) = file_sha256(Path::new(&item.file_path)) {
                by_hash.entry(hash).or_default().push(item);
            }
        }
    }

    let mut collections: Vec<Vec<MediaItem>> = by_hash
        .into_values()
        .filter(|g| g.len() > 1)
        .collect();
    collections.sort_by(|a, b| b.len().cmp(&a.len()));
    Ok(collections)
}

#[tauri::command]
pub fn get_log_content() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let log_dir = PathBuf::from(home).join("Library").join("Logs").join("Vivid");
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_path = log_dir.join(format!("vivid.log.{}", today));
    fs::read_to_string(&log_path).map_err(|e| format!("{}: {}", log_path.display(), e))
}
