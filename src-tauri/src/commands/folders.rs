use super::{media_dir, unique_path};
use crate::{db, models::{Folder, MediaItem}, DbState};
use std::fs;
use std::path::Path;
use tauri::State;

/// Strip a user-supplied folder name down to a safe single path component so a
/// crafted name (slashes, "..") can't escape the library root.
fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".into());
    }
    match Path::new(trimmed).file_name().and_then(|s| s.to_str()) {
        Some(n) if n == trimmed && n != "." && n != ".." => Ok(n.to_string()),
        _ => Err("Invalid folder name".into()),
    }
}


#[tauri::command]
pub fn list_folders(state: State<DbState>) -> Result<Vec<Folder>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::list_folders(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(
    name: String,
    parent_id: Option<String>,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<Folder, String> {
    let name = sanitize_name(&name)?;
    let root = media_dir(&app)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // The virtual Other bucket isn't a real folder to nest under —
    // treat it the same as no parent (top-level).
    let parent_id = parent_id.filter(|p| p != db::UNCATEGORIZED_ID);
    let parent_rel = match &parent_id {
        Some(pid) => db::fetch_folder(&conn, pid).map_err(|e| e.to_string())?.rel_path,
        None => String::new(),
    };
    if db::folder_name_taken(&conn, parent_id.as_deref(), &name, None).map_err(|e| e.to_string())? {
        return Err("DUPLICATE_NAME".into());
    }
    let rel_path = if parent_rel.is_empty() { name.clone() } else { format!("{parent_rel}/{name}") };

    fs::create_dir_all(root.join(&rel_path)).map_err(|e| e.to_string())?;
    db::create_folder(&conn, &name, parent_id.as_deref(), &rel_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(
    id: String,
    name: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<Folder, String> {
    let name = sanitize_name(&name)?;
    let root = media_dir(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    if id == db::UNCATEGORIZED_ID {
        return Err("Cannot rename the Other folder".into());
    }
    let folder = db::fetch_folder(&conn, &id).map_err(|e| e.to_string())?;
    if db::folder_name_taken(&conn, folder.parent_id.as_deref(), &name, Some(&id))
        .map_err(|e| e.to_string())?
    {
        return Err("DUPLICATE_NAME".into());
    }

    // Re-root rel_path under the same parent with the new leaf name.
    let parent_prefix = match folder.rel_path.rsplit_once('/') {
        Some((parent, _)) => format!("{parent}/"),
        None => String::new(),
    };
    let new_rel = format!("{parent_prefix}{name}");

    fs::rename(root.join(&folder.rel_path), root.join(&new_rel)).map_err(|e| e.to_string())?;
    db::rename_folder_tree(&conn, &id, &name, &folder.rel_path, &new_rel, &root_str)
        .map_err(|e| e.to_string())?;
    db::fetch_folder(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(
    id: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<(), String> {
    let root = media_dir(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    if id == db::UNCATEGORIZED_ID {
        return Err("Cannot delete the Other folder".into());
    }
    let folder = db::fetch_folder(&conn, &id).map_err(|e| e.to_string())?;

    // Files in this folder and any descendant are flattened back to the
    // library root (the virtual Other bucket) rather than trashed —
    // deleting a folder is an organizational act, not a request to lose
    // media. Nothing to create on disk: the root already exists.
    let items = db::items_under(&conn, &folder.rel_path, &root_str).map_err(|e| e.to_string())?;
    for item in &items {
        let src = Path::new(&item.file_path);
        let dest = unique_path(&root, &item.file_name);
        if src.exists() {
            fs::rename(src, &dest).map_err(|e| e.to_string())?;
        }
        db::set_item_folder(&conn, &item.id, None, &dest.to_string_lossy())
            .map_err(|e| e.to_string())?;
    }

    fs::remove_dir_all(root.join(&folder.rel_path)).ok();
    db::delete_folder_subtree(&conn, &folder.rel_path).map_err(|e| e.to_string())
}

/// Move a folder (and its entire subtree) under a new parent folder.
/// `new_parent_id: None` moves it to the root level.
#[tauri::command]
pub fn move_folder(
    id: String,
    new_parent_id: Option<String>,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<Folder, String> {
    let root = media_dir(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    if id == db::UNCATEGORIZED_ID {
        return Err("Cannot move the Other folder".into());
    }
    let folder = db::fetch_folder(&conn, &id).map_err(|e| e.to_string())?;

    // Moving *into* Other isn't a real nesting target — it collapses
    // to root level, same as `new_parent_id: None`.
    let new_parent_id = new_parent_id.filter(|p| p != db::UNCATEGORIZED_ID);
    let new_parent_rel = match &new_parent_id {
        Some(pid) => {
            let p = db::fetch_folder(&conn, pid).map_err(|e| e.to_string())?;
            // Disallow moving into itself or a descendant.
            if pid == &id || p.rel_path.starts_with(&format!("{}/", folder.rel_path)) {
                return Err("Cannot move a folder into itself or its own descendant".into());
            }
            p.rel_path
        }
        None => String::new(),
    };

    let leaf = folder.name.clone();
    let new_rel = if new_parent_rel.is_empty() {
        leaf.clone()
    } else {
        format!("{new_parent_rel}/{leaf}")
    };

    if new_rel == folder.rel_path {
        return db::fetch_folder(&conn, &id).map_err(|e| e.to_string());
    }

    if db::folder_name_taken(&conn, new_parent_id.as_deref(), &leaf, Some(&id))
        .map_err(|e| e.to_string())?
    {
        return Err("DUPLICATE_NAME".into());
    }

    let old_abs = root.join(&folder.rel_path);
    let new_abs = root.join(&new_rel);
    if let Some(parent) = new_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old_abs, &new_abs).map_err(|e| e.to_string())?;

    // Update the folder's parent_id in DB before rewriting the subtree paths.
    db::set_folder_parent(&conn, &id, new_parent_id.as_deref()).map_err(|e| e.to_string())?;
    db::rename_folder_tree(&conn, &id, &leaf, &folder.rel_path, &new_rel, &root_str)
        .map_err(|e| e.to_string())?;

    db::fetch_folder(&conn, &id).map_err(|e| e.to_string())
}

/// Open a folder in Finder (macOS), revealing it inside its parent directory.
#[tauri::command]
pub fn reveal_folder_in_finder(
    id: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<(), String> {
    let root = media_dir(&app)?;
    let abs = if id == db::UNCATEGORIZED_ID {
        root
    } else {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let folder = db::fetch_folder(&conn, &id).map_err(|e| e.to_string())?;
        root.join(&folder.rel_path)
    };
    std::process::Command::new("open")
        .arg("-R")
        .arg(&abs)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_to_folder(
    item_ids: Vec<String>,
    folder_id: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<Vec<MediaItem>, String> {
    let root = media_dir(&app)?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // The virtual Other bucket has no row to fetch — its directory
    // is the library root itself.
    let (dest_folder_id, dest_dir): (Option<String>, std::path::PathBuf) =
        if folder_id == db::UNCATEGORIZED_ID {
            (None, root)
        } else {
            let folder = db::fetch_folder(&conn, &folder_id).map_err(|e| e.to_string())?;
            let dir = root.join(&folder.rel_path);
            (Some(folder.id), dir)
        };
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let mut moved = Vec::with_capacity(item_ids.len());
    for id in &item_ids {
        let item = match db::fetch_one(&conn, id) {
            Ok(i) => i,
            Err(_) => continue,
        };
        let src = Path::new(&item.file_path);
        // Already in the destination directory — nothing to move.
        if src.parent() == Some(dest_dir.as_path()) {
            db::set_item_folder(&conn, id, dest_folder_id.as_deref(), &item.file_path).map_err(|e| e.to_string())?;
            moved.push(db::fetch_one(&conn, id).map_err(|e| e.to_string())?);
            continue;
        }
        let dest = unique_path(&dest_dir, &item.file_name);
        if src.exists() {
            fs::rename(src, &dest).map_err(|e| e.to_string())?;
        }
        db::set_item_folder(&conn, id, dest_folder_id.as_deref(), &dest.to_string_lossy())
            .map_err(|e| e.to_string())?;
        moved.push(db::fetch_one(&conn, id).map_err(|e| e.to_string())?);
    }
    Ok(moved)
}
