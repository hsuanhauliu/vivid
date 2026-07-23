//! Collection (album/playlist) persistence.

use crate::models::Collection;
use rusqlite::{params, Connection, Result};

// Column order: 0:id 1:name 2:color 3:emoji 4:pinned 5:cover_item_id 6:created_at 7:kind 8:sidebar_pin 9:description 10:parent_id
fn row_to_collection(row: &rusqlite::Row) -> rusqlite::Result<Collection> {
    let pinned_int: i64 = row.get(4)?;
    let sidebar_pin_int: i64 = row.get(8).unwrap_or(0);
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        emoji: row.get(3)?,
        pinned: pinned_int != 0,
        cover_item_id: row.get(5)?,
        created_at: row.get(6)?,
        kind: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "album".into()),
        sidebar_pin: sidebar_pin_int != 0,
        description: row.get(9).ok().flatten(),
        parent_id: row.get(10).ok().flatten(),
    })
}

// Shared column list so every SELECT stays in sync with `row_to_collection`.
const COLLECTION_COLS: &str =
    "id, name, color, emoji, pinned, cover_item_id, created_at, kind, sidebar_pin, description, parent_id";

pub fn get_collections(conn: &Connection) -> Result<Vec<Collection>> {
    let sql = format!("SELECT {COLLECTION_COLS} FROM collections ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql)?;
    let collections = stmt.query_map([], row_to_collection)?.filter_map(|r| r.ok()).collect();
    Ok(collections)
}

pub fn create_collection(conn: &Connection, name: &str, color: &str, emoji: Option<&str>, kind: &str) -> Result<Collection> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO collections (id, name, color, emoji, pinned, cover_item_id, created_at, kind, sidebar_pin) VALUES (?1,?2,?3,?4,1,NULL,?5,?6,0)",
        params![id, name, color, emoji, now, kind],
    )?;
    Ok(Collection { id, name: name.into(), color: color.into(), emoji: emoji.map(str::to_string), pinned: true, cover_item_id: None, created_at: now, kind: kind.into(), sidebar_pin: false, description: None, parent_id: None })
}

fn fetch_collection(conn: &Connection, id: &str) -> Result<Collection> {
    let sql = format!("SELECT {COLLECTION_COLS} FROM collections WHERE id=?1");
    conn.query_row(&sql, params![id], row_to_collection)
}

pub fn set_collection_cover(conn: &Connection, collection_id: &str, cover_item_id: Option<&str>) -> Result<Collection> {
    conn.execute("UPDATE collections SET cover_item_id=?1 WHERE id=?2", params![cover_item_id, collection_id])?;
    fetch_collection(conn, collection_id)
}

pub fn pin_collection(conn: &Connection, id: &str, pinned: bool) -> Result<Collection> {
    conn.execute("UPDATE collections SET pinned=?1 WHERE id=?2", params![pinned as i64, id])?;
    fetch_collection(conn, id)
}

pub fn set_sidebar_pin(conn: &Connection, id: &str, pinned: bool) -> Result<Collection> {
    conn.execute("UPDATE collections SET sidebar_pin=?1 WHERE id=?2", params![pinned as i64, id])?;
    fetch_collection(conn, id)
}

pub fn rename_collection(conn: &Connection, id: &str, name: &str) -> Result<Collection> {
    conn.execute("UPDATE collections SET name=?1 WHERE id=?2", params![name, id])?;
    fetch_collection(conn, id)
}

/// Sets (or clears, when `None`) a collection's free-text description.
pub fn set_collection_description(conn: &Connection, id: &str, description: Option<&str>) -> Result<Collection> {
    conn.execute("UPDATE collections SET description=?1 WHERE id=?2", params![description, id])?;
    fetch_collection(conn, id)
}

/// Whether another group of the same `kind` already uses `name`
/// (case-insensitive). `exclude_id` skips one group, used when renaming.
pub fn collection_name_taken(conn: &Connection, name: &str, kind: &str, exclude_id: Option<&str>) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collections \
         WHERE kind=?1 AND name=?2 COLLATE NOCASE AND (?3 IS NULL OR id<>?3)",
        params![kind, name, exclude_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// The `kind` of a group by id (album | playlist | album_group).
pub fn collection_kind(conn: &Connection, id: &str) -> Result<String> {
    conn.query_row("SELECT kind FROM collections WHERE id=?1", params![id], |r| r.get(0))
}

/// Moves an album into (or, passing `None`, out of) an album_group. Kind/
/// compatibility validation happens in the command layer, same as elsewhere.
pub fn set_collection_parent(conn: &Connection, id: &str, parent_id: Option<&str>) -> Result<Collection> {
    conn.execute("UPDATE collections SET parent_id=?1 WHERE id=?2", params![parent_id, id])?;
    fetch_collection(conn, id)
}

/// Deletes a collection. Its membership rows go with it (`collection_items.
/// collection_id ON DELETE CASCADE`), and if it's an album_group, its child
/// albums are ungrouped rather than orphaned (`collections.parent_id ON
/// DELETE SET NULL`) — both handled atomically by the schema itself as part
/// of this one statement, not hand-rolled here.
pub fn delete_collection(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM collections WHERE id=?1", params![id])?;
    Ok(())
}
