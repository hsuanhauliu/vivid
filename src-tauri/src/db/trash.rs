//! Soft-delete (trash) lifecycle: trash, restore, list, purge, hard-delete.

use super::{row_to_item, SELECT_MEDIA};
use crate::models::MediaItem;
use rusqlite::{params, Connection, Result};

/// Soft-delete: mark item as trashed with a timestamp.
pub fn trash_item(conn: &Connection, id: &str) -> Result<()> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET deleted_at=?1 WHERE id=?2",
        params![now, id],
    )?;
    Ok(())
}

/// Restore a trashed item back to the library.
pub fn restore_item(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE media_items SET deleted_at=NULL WHERE id=?1",
        params![id],
    )?;
    Ok(())
}

/// Return all trashed items.
pub fn get_trash(conn: &Connection) -> Result<Vec<MediaItem>> {
    let sql = format!("{SELECT_MEDIA} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map([], row_to_item)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

/// Permanently delete trashed items older than `days` days.
/// Returns the file_paths of deleted items so the caller can remove the files.
pub fn purge_old_trash(conn: &Connection, days: i64) -> Result<Vec<String>> {
    let cutoff = chrono::Local::now() - chrono::Duration::days(days);
    let cutoff_str = cutoff.to_rfc3339();
    let mut stmt = conn.prepare(
        "SELECT file_path FROM media_items WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
    )?;
    let paths: Vec<String> = stmt
        .query_map(params![cutoff_str], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    conn.execute(
        "DELETE FROM media_items WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff_str],
    )?;
    Ok(paths)
}

/// Permanently delete ALL trashed items; returns file_paths.
pub fn empty_trash(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT file_path FROM media_items WHERE deleted_at IS NOT NULL")?;
    let paths: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    conn.execute("DELETE FROM media_items WHERE deleted_at IS NOT NULL", [])?;
    Ok(paths)
}

/// Hard-delete a single item by id; returns its file_path.
pub fn remove(conn: &Connection, id: &str) -> Result<Option<String>> {
    let file_path: Option<String> = conn
        .query_row("SELECT file_path FROM media_items WHERE id=?1", params![id], |r| r.get(0))
        .ok();
    conn.execute("DELETE FROM media_items WHERE id=?1", params![id])?;
    Ok(file_path)
}
