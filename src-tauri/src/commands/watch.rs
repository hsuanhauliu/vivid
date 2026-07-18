//! Live filesystem watcher for an external workspace's root, keeping the DB
//! in sync with what's actually on disk while Vivid is running. Complements
//! `reconcile_workspace` (which only runs once, on open): together they
//! cover "the folder changed while Vivid wasn't running" and "the folder is
//! changing right now."
//!
//! Modeled on the mirror-sync watcher in `sync.rs` — debounced
//! `notify_debouncer_full`, one worker thread, a "settle" check before
//! treating a fast-growing file as done being written. Unlike mirror-sync
//! this only ever watches one root (the active workspace's own folder) and
//! only ever writes to the DB, never to the filesystem.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::normalize_abs;
use crate::models::extension_to_media_type;
use crate::{db, workspace, DbState};

const DEBOUNCE: Duration = Duration::from_millis(500);
/// How often to double-check the workspace root still exists at all, on top
/// of watcher-error-driven detection (covers e.g. an unmounted drive, which
/// can fail silently rather than emitting a removal event for every file).
const HEALTH_CHECK: Duration = Duration::from_secs(15);

pub struct WatchState(Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>);

impl WatchState {
    pub fn new() -> Self {
        WatchState(Mutex::new(None))
    }
}

/// Emitted when the active workspace's folder becomes unavailable (removed,
/// unmounted, or otherwise unreachable) while Vivid is running. The frontend
/// shows a warning and, on confirmation, relaunches back to the workspace
/// picker — `resolve_startup_workspace` then correctly falls back since the
/// path no longer resolves.
#[derive(Clone, Serialize)]
struct WorkspaceUnavailable {
    name: String,
}

/// Start watching the active workspace's root for external workspaces.
/// A no-op for the Default workspace (entirely Vivid-managed — nothing
/// external can drift). Safe to call once per process; the watcher and its
/// worker thread live for the rest of the process's lifetime (workspace
/// switches restart the whole app, so there's nothing to tear down).
pub fn watch_init(app: &AppHandle) {
    let ws_state = app.state::<workspace::WorkspaceState>();
    if ws_state.workspace.kind != workspace::WorkspaceKind::External {
        return;
    }
    let mdir = ws_state.paths.media_dir.clone();
    let ws_name = ws_state.workspace.name.clone();
    drop(ws_state);

    let app2 = app.clone();
    let mdir2 = mdir.clone();
    if let Ok(mut deb) = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<PathBuf> = events.into_iter().flat_map(|e| e.event.paths).collect();
            if !paths.is_empty() {
                handle_changes(&app2, &mdir2, &paths);
            }
        }
    }) {
        if deb.watcher().watch(&mdir, RecursiveMode::Recursive).is_ok() {
            deb.cache().add_root(&mdir, RecursiveMode::Recursive);
            *app.state::<WatchState>().0.lock().unwrap() = Some(deb);
        } else {
            tracing::warn!("failed to arm workspace watcher");
        }
    }

    // Belt-and-suspenders health check: a watcher on an unmounted volume can
    // just go quiet rather than erroring, so poll the root's existence too.
    let app3 = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(HEALTH_CHECK);
        if !mdir.is_dir() {
            tracing::warn!(path = %mdir.display(), "workspace root no longer reachable");
            let _ = app3.emit("workspace-unavailable", WorkspaceUnavailable { name: ws_name.clone() });
            break;
        }
        // Still-registered check: if this process's workspace was removed or
        // the active workspace changed underneath it (only possible via a
        // still-open Settings window in a future multi-window build; today
        // this is a no-op safety net), nothing else needs to happen — the
        // running process keeps serving its own already-loaded DB either way.
    });
}

fn handle_changes(app: &AppHandle, mdir: &Path, paths: &[PathBuf]) {
    let vivid_dir = mdir.join(workspace::VIVID_SUBDIR);
    let state = app.state::<DbState>();

    for p in dedup(paths) {
        if p.starts_with(&vivid_dir) {
            continue; // Vivid's own derived data, not user media.
        }
        let path_str = p.to_string_lossy().to_string();

        if !p.exists() {
            // Removed (or renamed away, which looks identical to a removal +
            // a separate creation event for the new name). Hard-delete the
            // tracked row, if any — trash doesn't apply, the file is gone.
            let conn = match state.0.lock() { Ok(c) => c, Err(_) => continue };
            if let Ok(id) = conn.query_row(
                "SELECT id FROM media_items WHERE file_path=?1 AND deleted_at IS NULL",
                rusqlite::params![path_str],
                |r| r.get::<_, String>(0),
            ) {
                let _ = db::remove_missing(&conn, &[id.clone()]);
                drop(conn);
                let _ = app.emit("media-removed", MediaRemoved { ids: vec![id] });
            }
            continue;
        }

        if !p.is_file() {
            continue; // Directory create/rename — nothing to index itself.
        }
        if !settled(&p) {
            continue; // Still being written; the next debounce cycle picks it up.
        }

        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if extension_to_media_type(ext).is_none() {
            continue;
        }

        let existing: Option<(String, i64, Option<i64>)> = {
            let conn = match state.0.lock() { Ok(c) => c, Err(_) => continue };
            conn.query_row(
                "SELECT id, file_size, mtime FROM media_items WHERE file_path=?1 AND deleted_at IS NULL",
                rusqlite::params![path_str],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).ok()
        };

        let Ok(meta) = std::fs::metadata(&p) else { continue };
        let mtime = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let size = meta.len() as i64;

        match existing {
            Some((id, db_size, db_mtime)) => {
                if db_mtime != Some(mtime) || db_size != size {
                    let conn = match state.0.lock() { Ok(c) => c, Err(_) => continue };
                    let updated = if db::mark_modified(&conn, &id, size, mtime).is_ok() {
                        db::fetch_one(&conn, &id).ok()
                    } else {
                        None
                    };
                    drop(conn);
                    if let Some(item) = updated {
                        if item.media_type == "image" || item.media_type == "video" {
                            super::trigger_thumb(app, id.clone(), path_str.clone(), item.media_type.clone());
                        }
                        let _ = app.emit("media-updated", item);
                    }
                }
            }
            None => {
                // New file — adopt it exactly like reconciliation would, one
                // at a time, reusing the same insert-and-kick-off-processing
                // path as every other import.
                if let Ok(mut item) = super::build_item(&p, Some(path_str.clone())) {
                    let conn = match state.0.lock() { Ok(c) => c, Err(_) => continue };
                    let dir_rel = normalize_abs(&p).parent().map(|d| rel_dir(d, mdir)).unwrap_or_default();
                    item.folder_id = if dir_rel.is_empty() {
                        None
                    } else {
                        db::folder_id_by_rel_path(&conn, &dir_rel).ok().flatten()
                    };
                    if db::insert(&conn, &item).is_ok() {
                        let _ = db::set_mtime(&conn, &item.id, mtime);
                        drop(conn);
                        super::trigger_embed_if_ready(app);
                        if item.media_type == "image" || item.media_type == "video" {
                            super::trigger_thumb(app, item.id.clone(), item.file_path.clone(), item.media_type.clone());
                        }
                        // Same event the regular import pipeline streams
                        // batches through — `useImport` already prepends
                        // these into `allItems`, so a dropped-in file shows
                        // up in the grid without a full reload.
                        let _ = app.emit("import-batch", super::ImportBatch { items: vec![item] });
                    }
                }
            }
        }
    }
}

#[derive(Clone, Serialize)]
struct MediaRemoved {
    ids: Vec<String>,
}

fn rel_dir(dir: &Path, mdir: &Path) -> String {
    dir.strip_prefix(mdir).ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// True once a file's size has stopped growing — avoids indexing a large
/// file (or a big drag-and-drop copy) mid-write.
fn settled(p: &Path) -> bool {
    let s1 = p.metadata().map(|m| m.len()).unwrap_or(0);
    std::thread::sleep(Duration::from_millis(200));
    let s2 = p.metadata().map(|m| m.len()).unwrap_or(0);
    s1 == s2 && p.exists()
}

fn dedup(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    paths.iter().filter(|p| seen.insert((*p).clone())).cloned().collect()
}
