//! Workspace registry: lets Vivid operate against either its own managed
//! app-data storage (the "default" workspace) or an arbitrary external folder
//! chosen by the user. An external workspace keeps its database and derived
//! data (thumbnails) inside a `.vivid/` subdirectory alongside the user's own
//! files, so the whole folder is self-contained and portable to another
//! machine. Exactly one workspace is active for the lifetime of a running
//! process — switching requires an app restart, since core managed state (the
//! DB connection, embedding index, sync watchers) is only ever initialized
//! once at startup (see `commands::workspace`).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Subdirectory created inside an external workspace folder to hold Vivid's
/// own database + derived data, kept alongside (not mixed into) the user's
/// actual media files.
pub const VIVID_SUBDIR: &str = ".vivid";

const REGISTRY_FILE: &str = "workspaces.json";

/// Stable id of the always-present default workspace.
pub const DEFAULT_WORKSPACE_ID: &str = "default";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    /// Vivid's own managed storage under the OS app-data directory. Exactly
    /// one always exists (seeded on first run) and can't be removed.
    Default,
    /// An arbitrary folder the user chose; its DB/thumbnails live inside a
    /// `.vivid/` subfolder, media files live wherever the user put them.
    External,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub kind: WorkspaceKind,
    /// Absolute path to the workspace root. Always `None` for `Default`
    /// (whose root is derived from the OS app-data dir instead) and always
    /// `Some` for `External`.
    #[serde(default)]
    pub path: Option<String>,
    pub name: String,
}

impl Workspace {
    /// Does this workspace's folder currently exist? Always true for the
    /// Default workspace (nothing external to go missing). Computed live
    /// rather than cached, so a remounted drive or a corrected path
    /// self-heals without a stale flag lingering anywhere.
    pub fn path_exists(&self) -> bool {
        match &self.path {
            Some(p) => Path::new(p).is_dir(),
            None => true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceRegistry {
    pub workspaces: Vec<Workspace>,
    pub active_id: String,
}

impl Default for WorkspaceRegistry {
    /// Empty — no workspace is registered, let alone active. This is the
    /// state on a genuinely fresh install (no `workspaces.json` yet) or
    /// after a corrupt/unreadable one: Vivid never assumes the user wants
    /// its own managed library. `.setup()` in `lib.rs` treats an empty
    /// registry the same as 2+ (defer loading anything), so the frontend's
    /// first-run gate can offer "use Vivid's managed library" vs. "use my
    /// own folder" *before* either is ever initialized — see
    /// `commands::add_default_workspace` for the former.
    fn default() -> Self {
        WorkspaceRegistry { workspaces: Vec::new(), active_id: String::new() }
    }
}

impl WorkspaceRegistry {
    pub fn active(&self) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == self.active_id)
    }

    pub fn find(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }

    /// Parse from JSON text, falling back to the single-default registry on
    /// missing/corrupt input so a damaged `workspaces.json` never blocks
    /// startup — worst case the user just lands back on their default library.
    pub fn parse(text: &str) -> Self {
        serde_json::from_str(text).unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        // The registry is plain strings/enums/options, so this can't fail.
        serde_json::to_string_pretty(self).expect("workspace registry is JSON-serializable")
    }
}

fn registry_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(REGISTRY_FILE)
}

/// Load the registry from `<app_data_dir>/workspaces.json`, or the
/// single-default registry if it doesn't exist yet or fails to parse.
pub fn load(app_data_dir: &Path) -> WorkspaceRegistry {
    fs::read_to_string(registry_path(app_data_dir))
        .map(|s| WorkspaceRegistry::parse(&s))
        .unwrap_or_default()
}

pub fn save(app_data_dir: &Path, registry: &WorkspaceRegistry) -> std::io::Result<()> {
    fs::write(registry_path(app_data_dir), registry.to_json())
}

/// Resolved on-disk locations for a workspace's database, media root, and
/// thumbnail cache.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspacePaths {
    pub db_path: PathBuf,
    pub media_dir: PathBuf,
    pub thumbs_dir: PathBuf,
    /// Directory for other per-workspace Vivid-managed data (mirror-sync
    /// config/manifest, and anywhere future per-workspace JSON files should
    /// live) — the same directory the DB file lives in.
    pub data_dir: PathBuf,
}

impl WorkspacePaths {
    /// Resolve where a workspace's data lives. `app_data_dir` is Vivid's own
    /// OS-provided app-data directory — always required, since it's also
    /// where the default workspace and the registry itself live.
    pub fn resolve(workspace: &Workspace, app_data_dir: &Path) -> Self {
        match workspace.kind {
            WorkspaceKind::Default => WorkspacePaths {
                db_path: app_data_dir.join("vivid.db"),
                media_dir: app_data_dir.join("media"),
                thumbs_dir: app_data_dir.join("thumbs"),
                data_dir: app_data_dir.to_path_buf(),
            },
            WorkspaceKind::External => {
                // `add_workspace` always sets `path` for an External workspace;
                // falling back to the app-data dir here is an unreachable-in-
                // practice safety net, not a real code path.
                let root = workspace.path.as_ref().map(PathBuf::from).unwrap_or_else(|| app_data_dir.to_path_buf());
                let vivid_dir = root.join(VIVID_SUBDIR);
                WorkspacePaths {
                    db_path: vivid_dir.join("vivid.db"),
                    media_dir: root,
                    thumbs_dir: vivid_dir.join("thumbs"),
                    data_dir: vivid_dir,
                }
            }
        }
    }

    /// Create the media and data directories (and the DB file's parent) if
    /// they don't already exist. The thumbnail directory is deliberately
    /// *not* created here for an External workspace: Vivid never writes
    /// derived files (thumbnails, format-converted previews) anywhere near
    /// a user-managed folder — see `commands::thumbs`, which generates
    /// External-workspace thumbnails in memory and caches them as data URLs
    /// in the database instead of files on disk.
    pub fn ensure_dirs(&self, kind: WorkspaceKind) -> std::io::Result<()> {
        fs::create_dir_all(&self.media_dir)?;
        if kind == WorkspaceKind::Default {
            fs::create_dir_all(&self.thumbs_dir)?;
        }
        fs::create_dir_all(&self.data_dir)?;
        if let Some(parent) = self.db_path.parent() {
            fs::create_dir_all(parent)?;
        }
        Ok(())
    }
}

/// Resolve which workspace should actually be used at startup: the
/// registry's active workspace, unless it's an External workspace whose
/// folder is currently missing (e.g. an unmounted external drive or a folder
/// that was deleted/renamed outside Vivid) — in which case fall back to the
/// Default workspace for this session. The registry itself is left
/// untouched, so once the folder is available again the next launch picks it
/// back up automatically instead of the fallback silently becoming sticky.
///
/// Only ever reached when the registry has exactly one workspace (see
/// `.setup()` in `lib.rs`, which defers to the frontend gate for 0 or 2+),
/// so in practice the fallback path below is unreachable — kept anyway as a
/// non-panicking last resort rather than assuming that invariant forever.
pub fn resolve_startup_workspace(registry: &WorkspaceRegistry) -> Workspace {
    let fallback = || {
        registry.find(DEFAULT_WORKSPACE_ID).cloned().unwrap_or_else(|| {
            // Truly nothing usable. Deliberately *not* written back to the
            // registry — if the user chose not to have a managed library,
            // this recovery shouldn't silently reintroduce one.
            Workspace {
                id: DEFAULT_WORKSPACE_ID.into(),
                kind: WorkspaceKind::Default,
                path: None,
                name: "My Library".into(),
            }
        })
    };
    match registry.active() {
        Some(w) if w.kind == WorkspaceKind::External => match &w.path {
            Some(p) if Path::new(p).is_dir() => w.clone(),
            _ => fallback(),
        },
        Some(w) => w.clone(),
        None => fallback(),
    }
}

/// Managed Tauri state holding the resolved paths for whichever workspace was
/// active at startup. Read-only for the life of the process — switching
/// workspaces writes the new `active_id` to the registry and restarts the app
/// rather than mutating this in place.
pub struct WorkspaceState {
    pub workspace: Workspace,
    pub paths: WorkspacePaths,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // ── WorkspaceRegistry: defaulting + parsing ─────────────────────────────

    #[test]
    fn default_registry_is_empty() {
        // No workspace is registered — Vivid never assumes a managed
        // library on a fresh install; the first-run gate decides.
        let reg = WorkspaceRegistry::default();
        assert!(reg.workspaces.is_empty());
        assert!(reg.active_id.is_empty());
        assert!(reg.active().is_none());
    }

    #[test]
    fn parse_roundtrips_through_json() {
        let mut reg = WorkspaceRegistry::default();
        reg.workspaces.push(Workspace {
            id: "abc123".into(),
            kind: WorkspaceKind::External,
            path: Some("/Volumes/Photos".into()),
            name: "Photos".into(),
        });
        reg.active_id = "abc123".into();

        let json = reg.to_json();
        let parsed = WorkspaceRegistry::parse(&json);

        assert_eq!(parsed.active_id, "abc123");
        assert_eq!(parsed.workspaces.len(), 1);
        let ext = parsed.find("abc123").unwrap();
        assert_eq!(ext.kind, WorkspaceKind::External);
        assert_eq!(ext.path.as_deref(), Some("/Volumes/Photos"));
    }

    #[test]
    fn parse_falls_back_to_default_on_garbage() {
        let parsed = WorkspaceRegistry::parse("not json at all { [ garbage");
        assert_eq!(parsed, WorkspaceRegistry::default());
    }

    #[test]
    fn parse_falls_back_to_default_on_empty_string() {
        let parsed = WorkspaceRegistry::parse("");
        assert_eq!(parsed, WorkspaceRegistry::default());
    }

    #[test]
    fn active_returns_none_when_active_id_is_stale() {
        let mut reg = WorkspaceRegistry::default();
        reg.active_id = "does-not-exist".into();
        assert!(reg.active().is_none());
    }

    #[test]
    fn find_returns_none_for_unknown_id() {
        let reg = WorkspaceRegistry::default();
        assert!(reg.find("nope").is_none());
    }

    // ── load / save: real filesystem roundtrip ──────────────────────────────

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempdir().unwrap();
        let reg = load(dir.path());
        assert_eq!(reg, WorkspaceRegistry::default());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempdir().unwrap();
        let mut reg = WorkspaceRegistry::default();
        reg.workspaces.push(Workspace {
            id: "ws2".into(),
            kind: WorkspaceKind::External,
            path: Some("/tmp/somewhere".into()),
            name: "Somewhere".into(),
        });
        reg.active_id = "ws2".into();

        save(dir.path(), &reg).unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded, reg);
    }

    #[test]
    fn load_falls_back_to_default_on_corrupt_file() {
        let dir = tempdir().unwrap();
        fs::write(registry_path(dir.path()), "{ this is not valid json").unwrap();
        let reg = load(dir.path());
        assert_eq!(reg, WorkspaceRegistry::default());
    }

    // ── resolve_startup_workspace ────────────────────────────────────────────

    /// A registry with just the Default workspace registered — what
    /// `WorkspaceRegistry::default()` used to return before it became
    /// genuinely empty. Only for tests that need a Default entry to exist.
    fn registry_with_default() -> WorkspaceRegistry {
        WorkspaceRegistry {
            workspaces: vec![Workspace {
                id: DEFAULT_WORKSPACE_ID.into(),
                kind: WorkspaceKind::Default,
                path: None,
                name: "My Library".into(),
            }],
            active_id: DEFAULT_WORKSPACE_ID.into(),
        }
    }

    #[test]
    fn startup_uses_default_when_active_is_default() {
        let reg = registry_with_default();
        let w = resolve_startup_workspace(&reg);
        assert_eq!(w.id, DEFAULT_WORKSPACE_ID);
    }

    #[test]
    fn startup_uses_external_when_folder_exists() {
        let dir = tempdir().unwrap();
        let mut reg = registry_with_default();
        reg.workspaces.push(Workspace {
            id: "ext1".into(),
            kind: WorkspaceKind::External,
            path: Some(dir.path().to_string_lossy().into_owned()),
            name: "Photos".into(),
        });
        reg.active_id = "ext1".into();

        let w = resolve_startup_workspace(&reg);
        assert_eq!(w.id, "ext1");
    }

    #[test]
    fn startup_falls_back_to_default_when_external_folder_missing() {
        let mut reg = registry_with_default();
        reg.workspaces.push(Workspace {
            id: "ext1".into(),
            kind: WorkspaceKind::External,
            path: Some("/this/path/does/not/exist/anywhere".into()),
            name: "Photos".into(),
        });
        reg.active_id = "ext1".into();

        let w = resolve_startup_workspace(&reg);
        assert_eq!(w.id, DEFAULT_WORKSPACE_ID);
    }

    #[test]
    fn startup_falls_back_to_default_when_active_id_is_stale() {
        let mut reg = registry_with_default();
        reg.active_id = "gone".into();
        let w = resolve_startup_workspace(&reg);
        assert_eq!(w.id, DEFAULT_WORKSPACE_ID);
    }

    #[test]
    fn startup_falls_back_to_transient_default_when_registry_is_truly_empty() {
        // Not reachable in the real `.setup()` flow (an empty registry always
        // defers to the frontend gate instead), but should never panic.
        let reg = WorkspaceRegistry::default();
        let w = resolve_startup_workspace(&reg);
        assert_eq!(w.id, DEFAULT_WORKSPACE_ID);
        assert_eq!(w.kind, WorkspaceKind::Default);
    }

    // ── WorkspacePaths::resolve ──────────────────────────────────────────────

    #[test]
    fn resolve_default_workspace_paths() {
        let app_data = PathBuf::from("/app/data");
        let w = Workspace { id: DEFAULT_WORKSPACE_ID.into(), kind: WorkspaceKind::Default, path: None, name: "My Library".into() };
        let paths = WorkspacePaths::resolve(&w, &app_data);
        assert_eq!(paths.db_path, PathBuf::from("/app/data/vivid.db"));
        assert_eq!(paths.media_dir, PathBuf::from("/app/data/media"));
        assert_eq!(paths.thumbs_dir, PathBuf::from("/app/data/thumbs"));
        assert_eq!(paths.data_dir, PathBuf::from("/app/data"));
    }

    #[test]
    fn resolve_external_workspace_paths() {
        let app_data = PathBuf::from("/app/data");
        let w = Workspace {
            id: "ext1".into(),
            kind: WorkspaceKind::External,
            path: Some("/Volumes/Photos".into()),
            name: "Photos".into(),
        };
        let paths = WorkspacePaths::resolve(&w, &app_data);
        assert_eq!(paths.db_path, PathBuf::from("/Volumes/Photos/.vivid/vivid.db"));
        // Media root is the folder itself — files are adopted in place, not
        // copied into a managed subdirectory.
        assert_eq!(paths.media_dir, PathBuf::from("/Volumes/Photos"));
        assert_eq!(paths.thumbs_dir, PathBuf::from("/Volumes/Photos/.vivid/thumbs"));
        assert_eq!(paths.data_dir, PathBuf::from("/Volumes/Photos/.vivid"));
    }

    #[test]
    fn external_workspace_derived_data_lives_under_media_root() {
        // Guards the portability guarantee: everything Vivid writes for an
        // external workspace must live inside that workspace's own folder,
        // never back in the global app-data dir.
        let app_data = PathBuf::from("/app/data");
        let w = Workspace { id: "ext1".into(), kind: WorkspaceKind::External, path: Some("/Volumes/Photos".into()), name: "Photos".into() };
        let paths = WorkspacePaths::resolve(&w, &app_data);
        assert!(paths.db_path.starts_with(&paths.media_dir));
        assert!(paths.thumbs_dir.starts_with(&paths.media_dir));
        assert!(paths.data_dir.starts_with(&paths.media_dir));
        assert!(!paths.db_path.starts_with(&app_data));
        assert!(!paths.thumbs_dir.starts_with(&app_data));
        assert!(!paths.data_dir.starts_with(&app_data));
    }

    // ── ensure_dirs ───────────────────────────────────────────────────────

    #[test]
    fn ensure_dirs_creates_media_and_thumbs_and_db_parent_for_default() {
        let dir = tempdir().unwrap();
        let w = Workspace { id: DEFAULT_WORKSPACE_ID.into(), kind: WorkspaceKind::Default, path: None, name: "My Library".into() };
        let paths = WorkspacePaths::resolve(&w, dir.path());
        paths.ensure_dirs(w.kind).unwrap();
        assert!(paths.media_dir.is_dir());
        assert!(paths.thumbs_dir.is_dir());
        assert!(paths.data_dir.is_dir());
        assert!(paths.db_path.parent().unwrap().is_dir());
    }

    #[test]
    fn ensure_dirs_never_creates_thumbs_dir_for_external() {
        // External workspaces get their thumbnails generated in memory and
        // cached in the database, never written to disk — so there's
        // nothing to create here, unlike media_dir/data_dir/db_path's parent.
        let dir = tempdir().unwrap();
        let w = Workspace {
            id: "ext1".into(),
            kind: WorkspaceKind::External,
            path: Some(dir.path().to_string_lossy().into_owned()),
            name: "Photos".into(),
        };
        let paths = WorkspacePaths::resolve(&w, Path::new("/unused"));
        paths.ensure_dirs(w.kind).unwrap();
        assert!(paths.media_dir.is_dir());
        assert!(!paths.thumbs_dir.exists());
        assert!(paths.data_dir.is_dir());
        assert!(paths.db_path.parent().unwrap().is_dir());
    }
}
