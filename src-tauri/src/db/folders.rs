//! On-disk folder tree persistence: the managed library directory structure.

use super::{row_to_item, SELECT_MEDIA};
use crate::models::{Folder, MediaItem};
use rusqlite::{params, Connection, Result};

/// Name of the default folder every imported file lands in unless another is
/// chosen. Also used as its `rel_path` since it sits at the library root.
pub const UNCATEGORIZED: &str = "Uncategorized";

fn map_folder(row: &rusqlite::Row) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id:         row.get(0)?,
        name:       row.get(1)?,
        parent_id:  row.get(2)?,
        rel_path:   row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// Ensure the default "Uncategorized" root folder exists; returns its id. Called
/// on startup so there is always a destination for new imports.
pub fn ensure_uncategorized(conn: &Connection) -> Result<String> {
    if let Some(id) = folder_id_by_rel_path(conn, UNCATEGORIZED)? {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, rel_path, created_at) VALUES (?1,?2,NULL,?3,?4)",
        params![id, UNCATEGORIZED, UNCATEGORIZED, now],
    )?;
    Ok(id)
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, rel_path, created_at FROM folders ORDER BY rel_path ASC",
    )?;
    let rows = stmt.query_map([], map_folder)?;
    rows.collect()
}

pub fn fetch_folder(conn: &Connection, id: &str) -> Result<Folder> {
    conn.query_row(
        "SELECT id, name, parent_id, rel_path, created_at FROM folders WHERE id=?1",
        params![id], map_folder,
    )
}

pub fn folder_id_by_rel_path(conn: &Connection, rel_path: &str) -> Result<Option<String>> {
    conn.query_row("SELECT id FROM folders WHERE rel_path=?1", params![rel_path], |r| r.get(0))
        .map(Some)
        .or_else(|e| if matches!(e, rusqlite::Error::QueryReturnedNoRows) { Ok(None) } else { Err(e) })
}

/// Whether a sibling folder (same parent) already uses `name`, case-insensitive.
/// `exclude_id` skips one folder, used when renaming.
pub fn folder_name_taken(conn: &Connection, parent_id: Option<&str>, name: &str, exclude_id: Option<&str>) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM folders \
         WHERE name=?1 COLLATE NOCASE \
           AND ((?2 IS NULL AND parent_id IS NULL) OR parent_id=?2) \
           AND (?3 IS NULL OR id<>?3)",
        params![name, parent_id, exclude_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Insert a folder row with a pre-computed `rel_path` (caller derives it from the
/// parent's rel_path + name). Returns the created Folder.
pub fn create_folder(conn: &Connection, name: &str, parent_id: Option<&str>, rel_path: &str) -> Result<Folder> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, rel_path, created_at) VALUES (?1,?2,?3,?4,?5)",
        params![id, name, parent_id, rel_path, now],
    )?;
    fetch_folder(conn, &id)
}

/// Reassign an item to a folder and record its new managed path in one update.
pub fn set_item_folder(conn: &Connection, item_id: &str, folder_id: &str, file_path: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET folder_id=?1, file_path=?2, updated_at=?3 WHERE id=?4",
        params![folder_id, file_path, now, item_id],
    )?;
    Ok(())
}


/// Update only the parent_id of a folder (used when re-parenting via move_folder).
pub fn set_folder_parent(conn: &Connection, id: &str, parent_id: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE folders SET parent_id = ?1 WHERE id = ?2",
        rusqlite::params![parent_id, id],
    )?;
    Ok(())
}

/// Rename a folder and re-root its whole subtree. After the on-disk directory has
/// been moved from `old_rel` to `new_rel`, this rewrites the `rel_path` of the
/// folder and every descendant, every affected item's `file_path` (whose absolute
/// path is `root`/`rel_path`/file), and the folder's display name — atomically.
pub fn rename_folder_tree(
    conn: &Connection,
    id: &str,
    new_name: &str,
    old_rel: &str,
    new_rel: &str,
    root: &str,
) -> Result<()> {
    let old_abs = format!("{root}/{old_rel}");
    let new_abs = format!("{root}/{new_rel}");
    conn.execute("SAVEPOINT rename_folder", [])?;
    let result = (|| -> Result<()> {
        // Items first: shift the absolute file_path prefix for this folder + subtree.
        conn.execute(
            "UPDATE media_items \
             SET file_path = ?1 || substr(file_path, length(?2) + 1) \
             WHERE file_path = ?2 || '/' || file_name OR file_path LIKE ?2 || '/%'",
            params![new_abs, old_abs],
        )?;
        // Descendant folders: shift their rel_path prefix.
        conn.execute(
            "UPDATE folders \
             SET rel_path = ?1 || substr(rel_path, length(?2) + 1) \
             WHERE rel_path = ?2 OR rel_path LIKE ?2 || '/%'",
            params![new_rel, old_rel],
        )?;
        conn.execute("UPDATE folders SET name=?1 WHERE id=?2", params![new_name, id])?;
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute("RELEASE rename_folder", []).map(|_| ()),
        Err(e) => { let _ = conn.execute("ROLLBACK TO rename_folder", []); Err(e) }
    }
}

/// Delete a folder row and every descendant folder row. The caller is responsible
/// for having already relocated the items and removed the on-disk directory.
pub fn delete_folder_subtree(conn: &Connection, rel_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM folders WHERE rel_path = ?1 OR rel_path LIKE ?1 || '/%'",
        params![rel_path],
    )?;
    Ok(())
}

/// Items that physically live under `rel_path` or any descendant folder — i.e.
/// everything whose file currently sits inside this directory subtree on disk.
pub fn items_under(conn: &Connection, rel_path: &str, root: &str) -> Result<Vec<MediaItem>> {
    let abs = format!("{root}/{rel_path}");
    let mut stmt = conn.prepare(&format!(
        "{SELECT_MEDIA} WHERE deleted_at IS NULL AND (file_path = ?1 || '/' || file_name OR file_path LIKE ?1 || '/%')"
    ))?;
    let rows = stmt.query_map(params![abs], row_to_item)?;
    rows.collect()
}
