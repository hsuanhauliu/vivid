//! Workspace management commands: list/add/switch/remove entries in the
//! registry (`crate::workspace`). Switching requires an app restart — these
//! commands only ever write the registry file; the frontend prompts the user
//! to restart after `switch_workspace` (or an `add_workspace` the user chose
//! to activate immediately) succeeds, and `.setup()` in `lib.rs` picks up the
//! new active workspace on the next launch.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::commands::normalize_abs;
use crate::workspace::{self, Workspace, WorkspaceKind, WorkspaceRegistry};

/// A registered workspace plus whether its folder currently exists —
/// computed fresh on every call rather than persisted, so a remounted drive
/// or a path the user just fixed is picked up immediately without a stale
/// flag anywhere in `workspaces.json`.
#[derive(Clone, Serialize)]
pub struct WorkspaceEntry {
    #[serde(flatten)]
    pub workspace: Workspace,
    pub valid: bool,
}

#[derive(Clone, Serialize)]
pub struct WorkspaceList {
    pub workspaces: Vec<WorkspaceEntry>,
    pub active_id: String,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Reject a candidate workspace folder that doesn't exist, is already
/// registered, or overlaps (is the same as, contains, or is contained by) an
/// already-registered external workspace or Vivid's own app-data directory.
/// An overlap would make it ambiguous which workspace owns a given file, and
/// would let one workspace's future file watcher pick up another workspace's
/// (or Vivid's own) derived-data churn as if it were user media.
fn validate_new_workspace_path(
    candidate: &Path,
    existing: &[Workspace],
    app_data_dir: &Path,
) -> Result<PathBuf, String> {
    if !candidate.is_dir() {
        return Err("That folder doesn't exist".into());
    }
    let candidate = normalize_abs(candidate);

    let overlaps = |other: &Path| candidate == other || candidate.starts_with(other) || other.starts_with(&candidate);

    if overlaps(&normalize_abs(app_data_dir)) {
        return Err("That folder overlaps with Vivid's own app data directory".into());
    }
    for w in existing {
        if let Some(p) = &w.path {
            if overlaps(&normalize_abs(Path::new(p))) {
                return Err(format!("That folder overlaps with the existing workspace \"{}\"", w.name));
            }
        }
    }
    Ok(candidate)
}

/// List every registered workspace and which one is active. Reads the
/// registry fresh from disk rather than the in-memory `WorkspaceState`
/// (which only reflects what was active at *this* process's startup), so a
/// pending switch (not yet applied by a restart) is visible in the UI.
#[tauri::command]
pub fn list_workspaces(app: AppHandle) -> Result<WorkspaceList, String> {
    let registry = workspace::load(&app_data_dir(&app)?);
    Ok(WorkspaceList {
        workspaces: registry.workspaces.into_iter()
            .map(|w| { let valid = w.path_exists(); WorkspaceEntry { workspace: w, valid } })
            .collect(),
        active_id: registry.active_id,
    })
}

/// The workspace this running process actually started with — distinct from
/// `list_workspaces`'s `active_id`, which may point at a not-yet-applied
/// pending switch.
#[tauri::command]
pub fn get_active_workspace(app: AppHandle) -> Workspace {
    app.state::<workspace::WorkspaceState>().workspace.clone()
}

/// Register a new external workspace pointed at `path` (chosen by the
/// frontend via its own folder picker). Does not switch to it or scan its
/// contents — the frontend calls `switch_workspace` next (after confirming
/// with the user), and the scan runs automatically on the next launch.
#[tauri::command]
pub fn add_workspace(app: AppHandle, path: String, name: String) -> Result<Workspace, String> {
    let data_dir = app_data_dir(&app)?;
    let mut registry = workspace::load(&data_dir);

    let clean_path = validate_new_workspace_path(Path::new(&path), &registry.workspaces, &data_dir)?;
    let trimmed = name.trim();
    let name = if trimmed.is_empty() {
        clean_path.file_name().and_then(|n| n.to_str()).unwrap_or("Workspace").to_string()
    } else {
        trimmed.to_string()
    };

    let ws = Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        kind: WorkspaceKind::External,
        path: Some(clean_path.to_string_lossy().into_owned()),
        name,
    };
    registry.workspaces.push(ws.clone());
    workspace::save(&data_dir, &registry).map_err(|e| e.to_string())?;
    crate::rebuild_workspace_menu(&app);
    Ok(ws)
}

/// Mark `id` as the active workspace in the registry. Takes effect on the
/// next app launch — the frontend is responsible for prompting a restart.
#[tauri::command]
pub fn switch_workspace(app: AppHandle, id: String) -> Result<(), String> {
    let data_dir = app_data_dir(&app)?;
    let mut registry = workspace::load(&data_dir);
    if registry.find(&id).is_none() {
        return Err("Unknown workspace".into());
    }
    registry.active_id = id;
    workspace::save(&data_dir, &registry).map_err(|e| e.to_string())?;
    // `running_id` in the rebuilt menu won't reflect this until the pending
    // switch is actually applied (relaunch), but the checkmark aside, this
    // still keeps the item list itself current.
    crate::rebuild_workspace_menu(&app);
    Ok(())
}

/// Actually load the workspace the user picked from the frontend's startup
/// picker — shown when 2+ workspaces are registered, before `.setup()` has
/// loaded any of them (see `initialize_workspace` in `lib.rs`). Also records
/// the choice as `active_id` so it's what's pre-selected next launch.
///
/// Unlike `switch_workspace`, this never needs a relaunch: since nothing was
/// loaded yet in this process, there's nothing to tear down first — the
/// frontend calls this once, then proceeds to mount the real app.
/// Error message `open_workspace` returns for a workspace whose folder no
/// longer exists — matched verbatim by the frontend (see `WorkspacePicker`)
/// to show a "fix the path" affordance instead of a generic error toast.
pub const ERR_WORKSPACE_PATH_MISSING: &str = "workspace-path-missing";

#[tauri::command]
pub fn open_workspace(app: AppHandle, id: String) -> Result<(), String> {
    let data_dir = app_data_dir(&app)?;
    let mut registry = workspace::load(&data_dir);
    let ws = registry.find(&id).cloned().ok_or("Unknown workspace")?;
    // Never silently create a new workspace at a since-vanished path — tell
    // the caller so it can point the user at Settings to fix or re-point it.
    if !ws.path_exists() {
        return Err(ERR_WORKSPACE_PATH_MISSING.into());
    }
    registry.active_id = id;
    workspace::save(&data_dir, &registry).map_err(|e| e.to_string())?;
    crate::initialize_workspace(&app, ws, &data_dir)?;
    crate::rebuild_workspace_menu(&app);
    Ok(())
}

/// Re-point an existing external workspace at a new folder — used from
/// Settings when the original folder was moved, renamed, or is on a drive
/// that's since been reformatted. Same overlap/existence validation as
/// registering a brand-new workspace. Doesn't touch the workspace's old
/// `.vivid/` database (it's simply abandoned at the old location); the
/// workspace effectively starts fresh at the new path and reconciliation
/// (on next open) adopts whatever's there.
#[tauri::command]
pub fn update_workspace_path(app: AppHandle, id: String, path: String) -> Result<Workspace, String> {
    let data_dir = app_data_dir(&app)?;
    let mut registry = workspace::load(&data_dir);
    let idx = registry.workspaces.iter().position(|w| w.id == id).ok_or("Unknown workspace")?;
    if registry.workspaces[idx].kind != WorkspaceKind::External {
        return Err("Only external workspaces have a folder path to update".into());
    }
    let others: Vec<Workspace> = registry.workspaces.iter().enumerate()
        .filter(|(i, _)| *i != idx).map(|(_, w)| w.clone()).collect();
    let clean_path = validate_new_workspace_path(Path::new(&path), &others, &data_dir)?;
    registry.workspaces[idx].path = Some(clean_path.to_string_lossy().into_owned());
    let updated = registry.workspaces[idx].clone();
    workspace::save(&data_dir, &registry).map_err(|e| e.to_string())?;
    crate::rebuild_workspace_menu(&app);
    Ok(updated)
}

/// Pure rename logic, factored out so it's testable without an `AppHandle`.
/// Trims and validates the new name, then updates `registry` in place and
/// returns the updated workspace.
fn rename_in_registry<'a>(registry: &'a mut WorkspaceRegistry, id: &str, name: &str) -> Result<&'a Workspace, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name can't be empty".into());
    }
    let ws = registry.workspaces.iter_mut().find(|w| w.id == id).ok_or("Unknown workspace")?;
    ws.name = trimmed.to_string();
    Ok(ws)
}

/// Rename a registered workspace (including the default one — it's just a
/// display label, doesn't affect where anything is stored).
#[tauri::command]
pub fn rename_workspace(app: AppHandle, id: String, name: String) -> Result<Workspace, String> {
    let data_dir = app_data_dir(&app)?;
    let mut registry = workspace::load(&data_dir);
    let updated = rename_in_registry(&mut registry, &id, &name)?.clone();
    workspace::save(&data_dir, &registry).map_err(|e| e.to_string())?;
    crate::rebuild_workspace_menu(&app);
    Ok(updated)
}

/// Forget a registered workspace. Only ever touches the registry — the
/// workspace's folder (and everything inside it, including its `.vivid/`
/// database) is left untouched on disk, so it can be re-added later.
#[tauri::command]
pub fn remove_workspace(app: AppHandle, id: String) -> Result<(), String> {
    if id == workspace::DEFAULT_WORKSPACE_ID {
        return Err("The default workspace can't be removed".into());
    }
    let data_dir = app_data_dir(&app)?;
    let mut registry = workspace::load(&data_dir);
    if registry.active_id == id {
        return Err("Can't remove the active workspace — switch to another one first".into());
    }
    let before = registry.workspaces.len();
    registry.workspaces.retain(|w| w.id != id);
    if registry.workspaces.len() == before {
        return Err("Unknown workspace".into());
    }
    workspace::save(&data_dir, &registry).map_err(|e| e.to_string())?;
    crate::rebuild_workspace_menu(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn ws(id: &str, path: &Path) -> Workspace {
        Workspace {
            id: id.into(),
            kind: WorkspaceKind::External,
            path: Some(path.to_string_lossy().into_owned()),
            name: id.into(),
        }
    }

    // ── validate_new_workspace_path ──────────────────────────────────────
    // (normalize_abs itself is tested where it's defined, commands/mod.rs)

    #[test]
    fn reject_nonexistent_folder() {
        let app_data = tempdir().unwrap();
        let err = validate_new_workspace_path(Path::new("/definitely/not/a/real/path"), &[], app_data.path());
        assert!(err.is_err());
    }

    #[test]
    fn accept_fresh_unrelated_folder() {
        let app_data = tempdir().unwrap();
        let candidate = tempdir().unwrap();
        let resolved = validate_new_workspace_path(candidate.path(), &[], app_data.path()).unwrap();
        assert_eq!(resolved, normalize_abs(candidate.path()));
    }

    #[test]
    fn reject_folder_equal_to_app_data_dir() {
        let app_data = tempdir().unwrap();
        assert!(validate_new_workspace_path(app_data.path(), &[], app_data.path()).is_err());
    }

    #[test]
    fn reject_folder_inside_app_data_dir() {
        let app_data = tempdir().unwrap();
        let inner = app_data.path().join("media");
        std::fs::create_dir_all(&inner).unwrap();
        assert!(validate_new_workspace_path(&inner, &[], app_data.path()).is_err());
    }

    #[test]
    fn reject_folder_containing_app_data_dir() {
        let root = tempdir().unwrap();
        let app_data = root.path().join("appdata");
        std::fs::create_dir_all(&app_data).unwrap();
        // root (parent of app_data) is an ancestor — mirroring here would
        // enclose Vivid's own app-data directory.
        assert!(validate_new_workspace_path(root.path(), &[], &app_data).is_err());
    }

    #[test]
    fn reject_folder_equal_to_existing_workspace() {
        let app_data = tempdir().unwrap();
        let existing = tempdir().unwrap();
        let workspaces = vec![ws("w1", existing.path())];
        assert!(validate_new_workspace_path(existing.path(), &workspaces, app_data.path()).is_err());
    }

    #[test]
    fn reject_folder_nested_inside_existing_workspace() {
        let app_data = tempdir().unwrap();
        let existing = tempdir().unwrap();
        let nested = existing.path().join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        let workspaces = vec![ws("w1", existing.path())];
        assert!(validate_new_workspace_path(&nested, &workspaces, app_data.path()).is_err());
    }

    #[test]
    fn reject_folder_that_would_contain_existing_workspace() {
        let app_data = tempdir().unwrap();
        let root = tempdir().unwrap();
        let existing = root.path().join("photos");
        std::fs::create_dir_all(&existing).unwrap();
        let workspaces = vec![ws("w1", &existing)];
        // root is an ancestor of the already-registered "photos" workspace.
        assert!(validate_new_workspace_path(root.path(), &workspaces, app_data.path()).is_err());
    }

    #[test]
    fn accept_sibling_of_existing_workspace() {
        let app_data = tempdir().unwrap();
        let root = tempdir().unwrap();
        let existing = root.path().join("photos");
        let sibling = root.path().join("videos");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let workspaces = vec![ws("w1", &existing)];
        assert!(validate_new_workspace_path(&sibling, &workspaces, app_data.path()).is_ok());
    }

    // ── rename_in_registry ────────────────────────────────────────────────

    #[test]
    fn rename_updates_matching_workspace() {
        let mut reg = WorkspaceRegistry::default(); // seeds the "default" workspace
        let updated = rename_in_registry(&mut reg, workspace::DEFAULT_WORKSPACE_ID, "My Photos").unwrap();
        assert_eq!(updated.name, "My Photos");
        assert_eq!(reg.find(workspace::DEFAULT_WORKSPACE_ID).unwrap().name, "My Photos");
    }

    #[test]
    fn rename_trims_whitespace() {
        let mut reg = WorkspaceRegistry::default();
        rename_in_registry(&mut reg, workspace::DEFAULT_WORKSPACE_ID, "  Trimmed  ").unwrap();
        assert_eq!(reg.find(workspace::DEFAULT_WORKSPACE_ID).unwrap().name, "Trimmed");
    }

    #[test]
    fn rename_rejects_empty_name() {
        let mut reg = WorkspaceRegistry::default();
        assert!(rename_in_registry(&mut reg, workspace::DEFAULT_WORKSPACE_ID, "   ").is_err());
        // Unchanged on rejection.
        assert_eq!(reg.find(workspace::DEFAULT_WORKSPACE_ID).unwrap().name, "My Library");
    }

    #[test]
    fn rename_rejects_unknown_id() {
        let mut reg = WorkspaceRegistry::default();
        assert!(rename_in_registry(&mut reg, "does-not-exist", "Anything").is_err());
    }

    #[test]
    fn rename_only_touches_the_targeted_workspace() {
        let mut reg = WorkspaceRegistry::default();
        reg.workspaces.push(Workspace {
            id: "w2".into(),
            kind: WorkspaceKind::External,
            path: Some("/tmp/photos".into()),
            name: "Photos".into(),
        });
        rename_in_registry(&mut reg, "w2", "Renamed").unwrap();
        assert_eq!(reg.find("w2").unwrap().name, "Renamed");
        assert_eq!(reg.find(workspace::DEFAULT_WORKSPACE_ID).unwrap().name, "My Library");
    }
}
