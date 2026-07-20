//! One-way mirror backup with drop-in import.
//!
//! Up to three independent **sync targets** can be configured, each mirroring a
//! selection of the library to its own destination folder. The model is the
//! same per target and deliberately asymmetric:
//!
//! * **library → destination** is a true mirror: new/changed files are copied
//!   and files removed from the library are removed from the destination
//!   (rsync `--delete` semantics). The library always wins.
//! * **destination → library** is *additive only*: a brand-new file that
//!   appears in the destination (one Vivid didn't place there) is imported into
//!   the library, then becomes part of the mirror. Edits or deletions of files
//!   Vivid already mirrored are reverted — the library copy is restored and the
//!   user is notified. Nothing flows back into the library except new files.
//!
//! Each target keeps a persisted **manifest** of mirrored files (rel_path →
//! size+mtime). It both distinguishes a file the *library* deleted (prune it)
//! from a *new drop-in* (import it) — they otherwise look identical — and
//! suppresses our own write echoes on the destination watcher (an event whose
//! file still matches the manifest meta is our own copy, not external drift).
//!
//! All work happens on a single worker thread fed by one shared library watcher
//! and one debounced watcher per destination, plus explicit messages from the
//! Tauri commands. Single-threaded processing keeps the manifests race-free.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};

use crate::commands::{media_dir, normalize_abs};
use crate::db;
use crate::DbState;

/// Maximum number of independent sync targets.
pub const MAX_TARGETS: usize = 3;

/// How long the watcher coalesces a burst of filesystem events before handing
/// them to the worker. Long enough to batch a large import, short enough to
/// feel immediate.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// While a destination is unreachable (e.g. an ejected drive), the worker
/// retries a reconcile on this cadence so it heals automatically on reconnect.
const OFFLINE_RETRY: Duration = Duration::from_secs(30);

// ── Persisted config ────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SyncConfig {
    /// Active sync targets (each one already reviewed + enabled by the user).
    #[serde(default)]
    pub targets: Vec<SyncTarget>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncTarget {
    /// Stable id, generated when the target is created.
    pub id: String,
    /// Absolute destination path.
    pub dest: String,
    /// Library folder `rel_path`s to mirror. Empty = the whole library.
    #[serde(default)]
    pub folders: Vec<String>,
    /// When true, new files appearing in the destination are imported.
    #[serde(default)]
    pub pull_in: bool,
}

// ── Live status (emitted to the frontend) ───────────────────────────────────

#[derive(Clone, Debug, Default, Serialize)]
pub struct SyncStatus {
    pub targets: Vec<TargetStatus>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TargetStatus {
    pub id: String,
    /// "idle" | "syncing" | "offline" | "error"
    pub state: String,
    pub last_sync: Option<String>,
    pub message: Option<String>,
    pub copied: usize,
    pub updated: usize,
    pub deleted: usize,
    pub imported: usize,
}

impl TargetStatus {
    fn new(id: &str) -> Self {
        TargetStatus {
            id: id.into(),
            state: "idle".into(),
            last_sync: None,
            message: None,
            copied: 0, updated: 0, deleted: 0, imported: 0,
        }
    }
}

/// A transient toast pushed to the frontend (restored/reverted/skipped events).
#[derive(Clone, Serialize)]
struct SyncNotice {
    kind: String, // "restored" | "reverted" | "skipped" | "error"
    name: String,
}

// ── Managed state ───────────────────────────────────────────────────────────

pub struct SyncState {
    tx: Mutex<Option<Sender<SyncMsg>>>,
    config: Mutex<SyncConfig>,
    status: Mutex<SyncStatus>,
}

impl SyncState {
    pub fn new() -> Self {
        SyncState {
            tx: Mutex::new(None),
            config: Mutex::new(SyncConfig::default()),
            status: Mutex::new(SyncStatus::default()),
        }
    }
}

enum SyncMsg {
    Reconfigure(SyncConfig),
    LibraryChanged(Vec<PathBuf>),
    DestChanged(String, Vec<PathBuf>), // target id
    Reconcile,                         // offline-retry heartbeat
    ReMirror(Option<String>),          // None = all targets
}

// ── Manifest of mirrored files ──────────────────────────────────────────────

#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct FileMeta {
    size: u64,
    mtime: u64, // unix seconds
}

type Manifest = HashMap<String, FileMeta>; // keyed by rel_path (forward slashes)
type ManifestMap = HashMap<String, Manifest>; // keyed by target id

// ── Public init + commands ──────────────────────────────────────────────────

/// Spawn the worker thread and arm the watchers from persisted config. Called
/// once from `lib.rs` setup.
pub fn sync_init(app: &AppHandle) {
    let state = app.state::<SyncState>();
    let cfg = load_config(app);
    *state.config.lock().unwrap() = cfg.clone();

    let (tx, rx) = mpsc::channel::<SyncMsg>();
    *state.tx.lock().unwrap() = Some(tx.clone());

    let app2 = app.clone();
    std::thread::spawn(move || worker_loop(app2, rx, tx));
}

#[tauri::command]
pub fn get_sync_config(state: State<'_, SyncState>) -> SyncConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn get_sync_status(state: State<'_, SyncState>) -> SyncStatus {
    state.status.lock().unwrap().clone()
}

/// Reject destinations that would be unsafe to mirror into: ones overlapping the
/// managed library (either direction) or pointing at a sensitive root. Because
/// the mirror removes anything in the destination that isn't in the library, a
/// bad destination is a data-loss hazard — this enforces the safety the UI's
/// non-empty-folder warning only suggests.
fn validate_dest(dest: &str, mdir: &Path) -> Result<(), String> {
    let d = normalize_abs(Path::new(dest));
    let m = normalize_abs(mdir);

    // Overlap with the library in either direction (equal, parent, or child).
    if d == m || d.starts_with(&m) || m.starts_with(&d) {
        return Err("Destination overlaps the Vivid library folder".into());
    }
    // The filesystem root has no parent.
    if d.parent().is_none() {
        return Err("Destination cannot be the filesystem root".into());
    }
    // The home directory itself (subdirectories of it are fine).
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() && d == normalize_abs(Path::new(&home)) {
            return Err("Destination cannot be your home folder itself".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_sync_config(
    mut config: SyncConfig,
    app: AppHandle,
    state: State<'_, SyncState>,
) -> Result<SyncConfig, String> {
    if config.targets.len() > MAX_TARGETS {
        return Err(format!("At most {MAX_TARGETS} sync destinations are allowed"));
    }
    // Reject duplicate destinations — two mirrors fighting over one folder would
    // each try to "prune" the other's files.
    let mut seen = HashSet::new();
    for t in &config.targets {
        if !seen.insert(t.dest.clone()) {
            return Err("That destination is already configured".into());
        }
    }
    config.targets.retain(|t| !t.dest.is_empty());

    // The mirror deletes anything in a destination that isn't in the library, so
    // an unsafe destination means data loss. Enforce that as a hard invariant
    // here rather than trusting the frontend's non-empty-folder warning alone.
    let mdir = media_dir(&app)?;
    for t in &config.targets {
        validate_dest(&t.dest, &mdir)?;
    }

    save_config(&app, &config)?;
    *state.config.lock().unwrap() = config.clone();
    if let Some(tx) = state.tx.lock().unwrap().as_ref() {
        let _ = tx.send(SyncMsg::Reconfigure(config.clone()));
    }
    Ok(config)
}

/// List the entry names directly under `path` (non-recursive). Used by the
/// Settings UI to warn before adopting a non-empty destination, since true
/// mirror will remove anything there that isn't in the library.
#[tauri::command]
pub fn list_dir_names(path: String) -> Result<Vec<String>, String> {
    let rd = match fs::read_dir(&path) {
        Ok(rd) => rd,
        Err(_) => return Ok(vec![]), // missing/unreadable → treat as empty
    };
    Ok(rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect())
}

/// Force a destination (or all of them) back to a perfect mirror.
#[tauri::command]
pub fn sync_remirror(target_id: Option<String>, state: State<'_, SyncState>) -> Result<(), String> {
    if let Some(tx) = state.tx.lock().unwrap().as_ref() {
        tx.send(SyncMsg::ReMirror(target_id)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Worker ──────────────────────────────────────────────────────────────────

/// Per-target runtime state: config + its manifest + watcher + live status.
struct TargetState {
    cfg: SyncTarget,
    manifest: Manifest,
    offline: bool,
    status: TargetStatus,
    _watch: Option<Debouncer<RecommendedWatcher, FileIdMap>>,
}

struct Worker {
    app: AppHandle,
    mdir: PathBuf,
    targets: Vec<TargetState>,
    /// Unsupported drop-ins already reported, to avoid re-notifying each scan.
    /// Keyed by absolute path, which already embeds the destination.
    notified_skips: HashSet<PathBuf>,
    // The shared library watcher; dropping it stops watching.
    _lib_watch: Option<Debouncer<RecommendedWatcher, FileIdMap>>,
}

fn worker_loop(app: AppHandle, rx: std::sync::mpsc::Receiver<SyncMsg>, self_tx: Sender<SyncMsg>) {
    let mdir = match media_dir(&app) {
        Ok(d) => d,
        Err(e) => { tracing::error!(error = %e, "sync: no media dir"); return; }
    };
    let cfg = load_config(&app);
    let manifests = load_manifests(&app);

    let mut w = Worker {
        app: app.clone(),
        mdir,
        targets: Vec::new(),
        notified_skips: HashSet::new(),
        _lib_watch: None,
    };
    w.set_targets(cfg.targets, &manifests);
    w.rearm_watchers(&self_tx);
    w.reconcile_all(false);

    // Offline-retry heartbeat: only nudges a reconcile while something's offline.
    {
        let hb = self_tx.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(OFFLINE_RETRY);
            if hb.send(SyncMsg::Reconcile).is_err() { break; }
        });
    }

    while let Ok(msg) = rx.recv() {
        match msg {
            SyncMsg::Reconfigure(cfg) => {
                // Preserve manifests for targets that survive; drop the rest.
                let mut manifests: ManifestMap = w.targets.iter()
                    .map(|t| (t.cfg.id.clone(), t.manifest.clone())).collect();
                for extra in load_manifests(&w.app) {
                    manifests.entry(extra.0).or_insert(extra.1);
                }
                w.set_targets(cfg.targets, &manifests);
                w.notified_skips.clear();
                w.rearm_watchers(&self_tx);
                w.reconcile_all(false);
            }
            SyncMsg::Reconcile => {
                // Heartbeat: heal only the offline targets, never poll healthy ones.
                let app = w.app.clone();
                let mdir = w.mdir.clone();
                let skips = &mut w.notified_skips;
                let mut changed = false;
                for t in &mut w.targets {
                    if t.offline { t.reconcile(&app, &mdir, skips, false); changed = true; }
                }
                if changed { w.publish_status(); w.persist_manifests(); }
            }
            SyncMsg::ReMirror(id) => {
                let app = w.app.clone();
                let mdir = w.mdir.clone();
                let skips = &mut w.notified_skips;
                for t in &mut w.targets {
                    if id.as_ref().map_or(true, |x| *x == t.cfg.id) {
                        t.reconcile(&app, &mdir, skips, true);
                    }
                }
                w.publish_status();
                w.persist_manifests();
            }
            SyncMsg::LibraryChanged(paths) => {
                let app = w.app.clone();
                let mdir = w.mdir.clone();
                for t in &mut w.targets {
                    t.on_library_changed(&app, &mdir, &paths);
                }
                w.publish_status();
                w.persist_manifests();
            }
            SyncMsg::DestChanged(id, paths) => {
                let app = w.app.clone();
                let mdir = w.mdir.clone();
                let skips = &mut w.notified_skips;
                if let Some(t) = w.targets.iter_mut().find(|t| t.cfg.id == id) {
                    t.on_dest_changed(&app, &mdir, skips, &paths);
                }
                w.publish_status();
                w.persist_manifests();
            }
        }
    }
}

impl Worker {
    /// Rebuild the target list from config, carrying over each target's manifest.
    fn set_targets(&mut self, targets: Vec<SyncTarget>, manifests: &ManifestMap) {
        self.targets = targets.into_iter().map(|cfg| {
            let manifest = manifests.get(&cfg.id).cloned().unwrap_or_default();
            let status = TargetStatus::new(&cfg.id);
            TargetState { cfg, manifest, offline: false, status, _watch: None }
        }).collect();
    }

    fn rearm_watchers(&mut self, tx: &Sender<SyncMsg>) {
        // Shared library watcher (armed only when there's at least one target).
        self._lib_watch = None;
        if !self.targets.is_empty() {
            let ltx = tx.clone();
            if let Ok(mut deb) = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
                if let Ok(events) = res {
                    let paths: Vec<PathBuf> = events.into_iter().flat_map(|e| e.event.paths).collect();
                    if !paths.is_empty() { let _ = ltx.send(SyncMsg::LibraryChanged(paths)); }
                }
            }) {
                if deb.watcher().watch(&self.mdir, RecursiveMode::Recursive).is_ok() {
                    deb.cache().add_root(&self.mdir, RecursiveMode::Recursive);
                    self._lib_watch = Some(deb);
                }
            }
        }

        // One destination watcher per target.
        for t in &mut self.targets {
            t._watch = None;
            let dest = PathBuf::from(&t.cfg.dest);
            if !dest.exists() { continue; }
            let dtx = tx.clone();
            let id = t.cfg.id.clone();
            if let Ok(mut deb) = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
                if let Ok(events) = res {
                    let paths: Vec<PathBuf> = events.into_iter().flat_map(|e| e.event.paths).collect();
                    if !paths.is_empty() { let _ = dtx.send(SyncMsg::DestChanged(id.clone(), paths)); }
                }
            }) {
                if deb.watcher().watch(&dest, RecursiveMode::Recursive).is_ok() {
                    deb.cache().add_root(&dest, RecursiveMode::Recursive);
                    t._watch = Some(deb);
                }
            }
        }
    }

    fn reconcile_all(&mut self, force: bool) {
        let app = self.app.clone();
        let mdir = self.mdir.clone();
        let skips = &mut self.notified_skips;
        for t in &mut self.targets {
            t.reconcile(&app, &mdir, skips, force);
        }
        self.publish_status();
        self.persist_manifests();
    }

    fn publish_status(&self) {
        let status = SyncStatus { targets: self.targets.iter().map(|t| t.status.clone()).collect() };
        let st = self.app.state::<SyncState>();
        *st.status.lock().unwrap() = status.clone();
        let _ = self.app.emit("sync-status", status);
    }

    fn persist_manifests(&self) {
        let map: ManifestMap = self.targets.iter()
            .map(|t| (t.cfg.id.clone(), t.manifest.clone())).collect();
        save_manifests(&self.app, &map);
    }
}

impl TargetState {
    fn dest_path(&self) -> PathBuf { PathBuf::from(&self.cfg.dest) }

    /// The selected library roots as rel_paths (`""` = whole library).
    fn roots(&self) -> Vec<String> {
        if self.cfg.folders.is_empty() { vec![String::new()] } else { self.cfg.folders.clone() }
    }

    fn in_scope(&self, rel: &str) -> bool { rel_in_scope(rel, &self.roots()) }

    fn now_iso() -> String { chrono::Utc::now().to_rfc3339() }

    // ── Full reconcile ───────────────────────────────────────────────────────

    /// Bring this target's destination into a perfect mirror and import any
    /// drop-ins. `force` re-copies even files that look up to date.
    fn reconcile(&mut self, app: &AppHandle, mdir: &Path, skips: &mut HashSet<PathBuf>, force: bool) {
        let dest = self.dest_path();
        if fs::create_dir_all(&dest).is_err() {
            self.offline = true;
            self.status = TargetStatus {
                state: "offline".into(),
                message: Some("Destination is unavailable".into()),
                ..TargetStatus::new(&self.cfg.id)
            };
            return;
        }
        self.offline = false;
        self.status.state = "syncing".into();

        let (mut copied, mut updated, mut deleted, mut imported) = (0usize, 0usize, 0usize, 0usize);

        // 1. Desired: every library file under a selected root, by rel_path.
        let mut desired: HashMap<String, PathBuf> = HashMap::new();
        for root in self.roots() {
            let base = if root.is_empty() { mdir.to_path_buf() } else { mdir.join(&root) };
            collect_files(&base, mdir, &mut desired);
        }

        // 2. Push library → dest (copy new / changed).
        for (rel, src) in &desired {
            let dst = dest.join(rel);
            if force || is_stale(src, &dst) {
                let existed = dst.exists();
                if let Some(parent) = dst.parent() { let _ = fs::create_dir_all(parent); }
                if super::copy_file_durably(src, &dst).is_ok() {
                    if existed { updated += 1; } else { copied += 1; }
                }
            }
            self.manifest.insert(rel.clone(), meta_of(&dst).unwrap_or(FileMeta { size: 0, mtime: 0 }));
        }

        // 3. Walk the destination: prune library-deleted files, import drop-ins.
        let mut dest_files: HashMap<String, PathBuf> = HashMap::new();
        for root in self.roots() {
            let base = if root.is_empty() { dest.clone() } else { dest.join(&root) };
            collect_files(&base, &dest, &mut dest_files);
        }
        for (rel, dpath) in &dest_files {
            if desired.contains_key(rel) { continue; }
            if self.manifest.contains_key(rel) {
                // We mirrored this; the library no longer has it → library deleted it.
                if fs::remove_file(dpath).is_ok() { deleted += 1; }
                self.manifest.remove(rel);
            } else if self.cfg.pull_in {
                if self.import_dropin(app, mdir, skips, dpath, rel) { imported += 1; }
            } else {
                // True mirror, no pull-in: extraneous file → remove.
                if fs::remove_file(dpath).is_ok() { deleted += 1; }
            }
        }

        prune_empty_dirs(&dest);

        self.status = TargetStatus {
            id: self.cfg.id.clone(),
            state: "idle".into(),
            last_sync: Some(Self::now_iso()),
            message: None,
            copied, updated, deleted, imported,
        };
        tracing::info!(target = %self.cfg.id, copied, updated, deleted, imported, "mirror reconcile complete");
    }

    // ── Incremental: library changed ─────────────────────────────────────────

    fn on_library_changed(&mut self, _app: &AppHandle, mdir: &Path, paths: &[PathBuf]) {
        if self.offline { return; }
        let dest = self.dest_path();

        let (mut copied, mut updated, mut deleted) = (0usize, 0usize, 0usize);
        for p in dedup(paths) {
            let rel = match rel_of(&p, mdir) { Some(r) => r, None => continue };
            if !self.in_scope(&rel) { continue; }
            let dst = dest.join(&rel);
            if p.exists() && p.is_file() {
                if is_stale(&p, &dst) {
                    let existed = dst.exists();
                    if let Some(parent) = dst.parent() { let _ = fs::create_dir_all(parent); }
                    if super::copy_file_durably(&p, &dst).is_ok() {
                        if existed { updated += 1; } else { copied += 1; }
                    }
                }
                self.manifest.insert(rel, meta_of(&dst).unwrap_or(FileMeta { size: 0, mtime: 0 }));
            } else if !p.exists() {
                if self.manifest.remove(&rel).is_some() || dst.exists() {
                    if fs::remove_file(&dst).is_ok() { deleted += 1; }
                }
            }
        }
        if copied + updated + deleted > 0 {
            prune_empty_dirs(&dest);
            self.status = TargetStatus {
                id: self.cfg.id.clone(),
                state: "idle".into(),
                last_sync: Some(Self::now_iso()),
                copied, updated, deleted, imported: 0,
                message: None,
            };
        }
    }

    // ── Incremental: destination changed ─────────────────────────────────────

    fn on_dest_changed(&mut self, app: &AppHandle, mdir: &Path, skips: &mut HashSet<PathBuf>, paths: &[PathBuf]) {
        let dest = self.dest_path();

        for p in dedup(paths) {
            if p.is_dir() { continue; }
            let rel = match rel_of(&p, &dest) { Some(r) => r, None => continue };
            let src = mdir.join(&rel);

            match self.manifest.get(&rel).cloned() {
                Some(expected) => {
                    if !src.exists() {
                        if !p.exists() { self.manifest.remove(&rel); }
                        continue;
                    }
                    if !p.exists() {
                        // Deleted in the destination → restore (library wins).
                        if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
                        if super::copy_file_durably(&src, &p).is_ok() {
                            self.manifest.insert(rel.clone(), meta_of(&p).unwrap_or(expected));
                            notify(app, "restored", &file_label(&rel));
                        }
                    } else if meta_of(&p).as_ref() != Some(&expected) {
                        // Differs from what we wrote → external edit → overwrite.
                        if super::copy_file_durably(&src, &p).is_ok() {
                            self.manifest.insert(rel.clone(), meta_of(&p).unwrap_or(expected));
                            notify(app, "reverted", &file_label(&rel));
                        }
                    }
                    // else: matches what we wrote → our own echo → ignore.
                }
                None if p.exists() && p.is_file() => {
                    if self.cfg.pull_in {
                        self.import_dropin(app, mdir, skips, &p, &rel);
                    } else {
                        let _ = fs::remove_file(&p);
                    }
                }
                None => {}
            }
        }
    }

    // ── Drop-in import ───────────────────────────────────────────────────────

    /// Import a file that appeared in the destination into the library folder
    /// matching its destination rel_path (parent dir → folder by rel_path, else
    /// Other). On success the original destination file is removed: the
    /// library→dest mirror re-creates the canonical copy at the library's
    /// rel_path, so the file is adopted rather than duplicated.
    fn import_dropin(&mut self, app: &AppHandle, _mdir: &Path, skips: &mut HashSet<PathBuf>, path: &Path, rel: &str) -> bool {
        if !settled(path) { return false; }

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if crate::models::extension_to_media_type(ext).is_none() {
            if skips.insert(path.to_path_buf()) {
                notify(app, "skipped", &file_label(rel));
            }
            return false;
        }

        let parent_rel = Path::new(rel).parent()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let folder_id = {
            let st = app.state::<DbState>();
            let conn = st.0.lock().unwrap();
            folder_id_for_rel(&conn, &parent_rel)
        };

        let res = crate::commands::run_import(
            app,
            vec![path.to_string_lossy().to_string()],
            None,
            folder_id,
            None,
            true,
        );
        match res {
            Ok(()) => { let _ = fs::remove_file(path); true }
            Err(e) => { tracing::warn!(error = %e, "drop-in import failed"); false }
        }
    }
}

// ── Free helpers ─────────────────────────────────────────────────────────────

fn notify(app: &AppHandle, kind: &str, name: &str) {
    let _ = app.emit("sync-notice", SyncNotice { kind: kind.into(), name: name.into() });
}

/// Is `rel` inside one of the selected roots? `""` root = whole library.
fn rel_in_scope(rel: &str, roots: &[String]) -> bool {
    roots.iter().any(|r| r.is_empty() || rel == r || rel.starts_with(&format!("{r}/")))
}

/// Rel_path of `p` under `base`, with forward slashes; None if not under base.
fn rel_of(p: &Path, base: &Path) -> Option<String> {
    p.strip_prefix(base).ok().map(|r| r.to_string_lossy().replace('\\', "/"))
}

/// Recursively collect files under `base`, keyed by rel_path relative to `root`.
fn collect_files(base: &Path, root: &Path, out: &mut HashMap<String, PathBuf>) {
    let rd = match fs::read_dir(base) { Ok(r) => r, Err(_) => return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, root, out);
        } else if path.is_file() {
            if let Some(rel) = rel_of(&path, root) {
                out.insert(rel, path);
            }
        }
    }
}

/// True when the destination copy is missing or stale relative to the source.
/// Library always wins: any size mismatch or newer source re-copies.
fn is_stale(src: &Path, dst: &Path) -> bool {
    let (sm, dm) = match (src.metadata(), dst.metadata()) {
        (Ok(sm), Ok(dm)) => (sm, dm),
        _ => return true,
    };
    if sm.len() != dm.len() { return true; }
    match (sm.modified(), dm.modified()) {
        (Ok(st), Ok(dt)) => st > dt,
        _ => false,
    }
}

fn meta_of(p: &Path) -> Option<FileMeta> {
    let m = p.metadata().ok()?;
    let mtime = m.modified().ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Some(FileMeta { size: m.len(), mtime })
}

/// True once a file's size has stopped growing (a copy in progress has settled).
fn settled(p: &Path) -> bool {
    let s1 = p.metadata().map(|m| m.len()).unwrap_or(0);
    std::thread::sleep(Duration::from_millis(150));
    let s2 = p.metadata().map(|m| m.len()).unwrap_or(0);
    s1 == s2 && p.exists()
}

fn file_label(rel: &str) -> String {
    Path::new(rel).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| rel.into())
}

fn dedup(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths.iter().filter(|p| seen.insert((*p).clone())).cloned().collect()
}

/// Recursively remove empty directories under `root` (but keep `root` itself).
fn prune_empty_dirs(root: &Path) {
    fn rec(dir: &Path, is_root: bool) -> bool {
        let mut empty = true;
        if let Ok(rd) = fs::read_dir(dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    // rec returns true when the child was empty (and removed);
                    // a child that survives keeps this dir non-empty.
                    if !rec(&p, false) { empty = false; }
                } else {
                    empty = false;
                }
            }
        }
        if empty && !is_root { let _ = fs::remove_dir(dir); }
        empty
    }
    rec(root, true);
}

/// Find a library folder id whose rel_path matches `rel`, else the virtual
/// Other bucket (which `run_import`/`insert_imported` already treat
/// exactly like `None` — the library root).
fn folder_id_for_rel(conn: &rusqlite::Connection, rel: &str) -> Option<String> {
    if rel.is_empty() {
        return Some(db::UNCATEGORIZED_ID.to_string());
    }
    if let Ok(folders) = db::list_folders(conn) {
        if let Some(f) = folders.into_iter().find(|f| f.rel_path == rel) {
            return Some(f.id);
        }
    }
    Some(db::UNCATEGORIZED_ID.to_string())
}

// ── Config + manifest persistence ────────────────────────────────────────────

// Sync targets and their manifests are scoped to the active workspace (which
// folders to mirror, and what's already been mirrored, both only make sense
// relative to *that* workspace's library) — read from `WorkspaceState.paths`
// rather than the raw app-data dir so switching workspaces doesn't share or
// clobber stale mirror state between them.
fn config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.state::<crate::workspace::WorkspaceState>().paths.data_dir.join("sync_config.json"))
}

fn manifest_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.state::<crate::workspace::WorkspaceState>().paths.data_dir.join("sync_manifest.json"))
}

fn load_config(app: &AppHandle) -> SyncConfig {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &SyncConfig) -> Result<(), String> {
    let p = config_path(app).ok_or("no app data dir")?;
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    super::write_bytes_durably(&p, s.as_bytes()).map_err(|e| e.to_string())
}

fn load_manifests(app: &AppHandle) -> ManifestMap {
    manifest_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_manifests(app: &AppHandle, m: &ManifestMap) {
    if let Some(p) = manifest_path(app) {
        if let Ok(s) = serde_json::to_string(m) {
            let _ = super::write_bytes_durably(&p, s.as_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::time::{Duration, SystemTime};
    use tempfile::tempdir;

    fn write_at(dir: &Path, name: &str, bytes: &[u8], mtime: SystemTime) -> PathBuf {
        let p = dir.join(name);
        if let Some(parent) = p.parent() { fs::create_dir_all(parent).unwrap(); }
        fs::write(&p, bytes).unwrap();
        File::options().write(true).open(&p).unwrap().set_modified(mtime).unwrap();
        p
    }

    // ── validate_dest: destination safety ───────────────────────────────────
    // (normalize_abs itself is tested where it's defined, commands/mod.rs)

    #[test]
    fn reject_dest_equal_to_library() {
        let mdir = Path::new("/Users/x/Library/App/media");
        assert!(validate_dest("/Users/x/Library/App/media", mdir).is_err());
    }

    #[test]
    fn reject_dest_inside_library() {
        let mdir = Path::new("/Users/x/Library/App/media");
        assert!(validate_dest("/Users/x/Library/App/media/sub", mdir).is_err());
    }

    #[test]
    fn reject_dest_containing_library() {
        let mdir = Path::new("/Users/x/Library/App/media");
        // Parent of the library — mirroring here would enclose the library.
        assert!(validate_dest("/Users/x/Library/App", mdir).is_err());
    }

    #[test]
    fn reject_dest_overlap_via_parent_traversal() {
        let mdir = Path::new("/Users/x/Library/App/media");
        // Lexically escapes back into the library despite the `..`.
        assert!(validate_dest("/Users/x/Library/App/other/../media", mdir).is_err());
    }

    #[test]
    fn reject_filesystem_root() {
        let mdir = Path::new("/Users/x/Library/App/media");
        assert!(validate_dest("/", mdir).is_err());
    }

    #[test]
    fn accept_unrelated_destination() {
        let mdir = Path::new("/Users/x/Library/App/media");
        assert!(validate_dest("/Volumes/Backup/Vivid", mdir).is_ok());
    }

    // ── is_stale: library always wins ──────────────────────────────────────────

    #[test]
    fn stale_when_dest_missing() {
        let dir = tempdir().unwrap();
        let src = write_at(dir.path(), "src", b"abc", SystemTime::now());
        assert!(is_stale(&src, &dir.path().join("nope")));
    }

    #[test]
    fn stale_when_sizes_differ() {
        let dir = tempdir().unwrap();
        let t = SystemTime::now();
        let src = write_at(dir.path(), "src", b"abcdef", t);
        let dst = write_at(dir.path(), "dst", b"abc", t);
        assert!(is_stale(&src, &dst));
    }

    #[test]
    fn stale_when_source_is_newer() {
        let dir = tempdir().unwrap();
        let older = SystemTime::now() - Duration::from_secs(60);
        let newer = SystemTime::now();
        let dst = write_at(dir.path(), "dst", b"abc", older);
        let src = write_at(dir.path(), "src", b"abc", newer);
        assert!(is_stale(&src, &dst));
    }

    #[test]
    fn fresh_when_same_size_and_dest_not_older() {
        let dir = tempdir().unwrap();
        let older = SystemTime::now() - Duration::from_secs(60);
        let newer = SystemTime::now();
        let src = write_at(dir.path(), "src", b"abc", older);
        let dst = write_at(dir.path(), "dst", b"abc", newer);
        assert!(!is_stale(&src, &dst));
    }

    // ── Selective-folder scope ─────────────────────────────────────────────────

    #[test]
    fn whole_library_scope_matches_everything() {
        let roots = vec![String::new()];
        assert!(rel_in_scope("Photos/a.jpg", &roots));
        assert!(rel_in_scope("anything", &roots));
    }

    #[test]
    fn selective_scope_matches_only_subtrees() {
        let roots = vec!["Photos".to_string(), "Music/Live".to_string()];
        assert!(rel_in_scope("Photos/a.jpg", &roots));
        assert!(rel_in_scope("Photos", &roots));
        assert!(rel_in_scope("Music/Live/x.mp3", &roots));
        assert!(!rel_in_scope("Music/Studio/y.mp3", &roots));
        assert!(!rel_in_scope("Videos/v.mp4", &roots));
        assert!(!rel_in_scope("PhotosOld/a.jpg", &roots));
    }

    // ── collect_files: rel_paths preserved ─────────────────────────────────────

    #[test]
    fn collect_files_preserves_relative_paths() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_at(root, "a.jpg", b"a", SystemTime::now());
        write_at(root, "Sub/b.png", b"b", SystemTime::now());
        write_at(root, "Sub/Deep/c.gif", b"c", SystemTime::now());

        let mut out = HashMap::new();
        collect_files(root, root, &mut out);

        assert_eq!(out.len(), 3);
        assert!(out.contains_key("a.jpg"));
        assert!(out.contains_key("Sub/b.png"));
        assert!(out.contains_key("Sub/Deep/c.gif"));
    }

    // ── prune_empty_dirs ───────────────────────────────────────────────────────

    #[test]
    fn prune_removes_empty_dirs_but_keeps_root_and_files() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("Empty/Nested")).unwrap();
        write_at(root, "Keep/file.txt", b"x", SystemTime::now());

        prune_empty_dirs(root);

        assert!(root.exists());
        assert!(!root.join("Empty").exists());
        assert!(root.join("Keep/file.txt").exists());
    }

    // ── rel_of ─────────────────────────────────────────────────────────────────

    #[test]
    fn rel_of_strips_base_and_normalizes_slashes() {
        let base = Path::new("/lib/media");
        assert_eq!(rel_of(Path::new("/lib/media/Photos/a.jpg"), base).as_deref(), Some("Photos/a.jpg"));
        assert_eq!(rel_of(Path::new("/elsewhere/a.jpg"), base), None);
    }
}
