//! SQLite persistence layer.
//!
//! Split by domain into submodules (media, trash, collections, folders, embeddings,
//! stats). Every function is re-exported flat from here, so all call sites use
//! `db::<fn>` regardless of which submodule the function physically lives in —
//! moving a function between submodules never changes a call site.
//!
//! This root module owns the schema (`init`), the shared row decoder
//! (`row_to_item`) and the `SELECT_MEDIA` column list that the submodules build
//! their queries on top of.
use crate::models::MediaItem;
use rusqlite::{Connection, Result};

mod media;
mod trash;
mod collections;
mod folders;
mod embeddings;
mod stats;

pub use embeddings::*;
pub use folders::*;
pub use collections::*;
pub use media::*;
pub use stats::*;
pub use trash::*;

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_items (
            id                  TEXT PRIMARY KEY,
            file_path           TEXT NOT NULL UNIQUE,
            source_path         TEXT UNIQUE,
            file_name           TEXT NOT NULL,
            display_name        TEXT NOT NULL,
            media_type          TEXT NOT NULL,
            file_size           INTEGER NOT NULL DEFAULT 0,
            description         TEXT NOT NULL DEFAULT '',
            tags                TEXT NOT NULL DEFAULT '[]',
            auto_tags           TEXT NOT NULL DEFAULT '[]',
            starred             INTEGER NOT NULL DEFAULT 0,
            favorited           INTEGER NOT NULL DEFAULT 0,
            color_label         TEXT,
            sort_order          INTEGER NOT NULL DEFAULT 0,
            gps_lat             REAL,
            gps_lng             REAL,
            date_taken          TEXT,
            width               INTEGER,
            height              INTEGER,
            embedding           BLOB,
            ocr_text            TEXT,
            ocr_scanned         INTEGER NOT NULL DEFAULT 0,
            thumb_path          TEXT,
            camera_make         TEXT,
            camera_model        TEXT,
            audio_title         TEXT,
            audio_artist        TEXT,
            audio_album         TEXT,
            audio_track         INTEGER,
            audio_duration_secs REAL,
            audio_year          INTEGER,
            audio_cover         TEXT,
            deleted_at          TEXT,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collections (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            color         TEXT NOT NULL DEFAULT '',
            emoji         TEXT,
            kind          TEXT NOT NULL DEFAULT 'album',
            pinned        INTEGER NOT NULL DEFAULT 1,
            sidebar_pin   INTEGER NOT NULL DEFAULT 0,
            cover_item_id TEXT,
            description   TEXT,
            created_at    TEXT NOT NULL
        );
        -- Folders are a real on-disk tree under the managed library root, distinct
        -- from `collections` (albums/playlists, which are pure metadata collections).
        -- `rel_path` is the folder's path relative to the library root, e.g.
        -- 'Other' or 'Trips/Japan'; it's the source of truth for where the
        -- files physically live. `parent_id` NULL means a top-level folder.
        CREATE TABLE IF NOT EXISTS folders (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            parent_id   TEXT REFERENCES folders(id),
            rel_path    TEXT NOT NULL UNIQUE,
            created_at  TEXT NOT NULL
        );
        -- Many-to-many membership: a media item can belong to any number of
        -- collections (albums/playlists) at once, unlike `folder_id` above.
        CREATE TABLE IF NOT EXISTS collection_items (
            collection_id TEXT NOT NULL,
            item_id       TEXT NOT NULL,
            added_at      TEXT NOT NULL,
            PRIMARY KEY (collection_id, item_id)
        );",
    )?;

    // Each media item lives in exactly one folder (filesystem semantics), unlike
    // `collection_id` which ties it to album/playlist collections. Added via ALTER so
    // existing databases pick it up.
    if !column_exists(conn, "media_items", "folder_id")? {
        conn.execute("ALTER TABLE media_items ADD COLUMN folder_id TEXT REFERENCES folders(id)", [])?;
    }

    // Optional collection description — added via ALTER so databases created
    // before the column existed pick it up.
    if !column_exists(conn, "collections", "description")? {
        conn.execute("ALTER TABLE collections ADD COLUMN description TEXT", [])?;
    }

    // Which "album_group" collection (a container that only holds other
    // albums, never media items directly) a regular album currently sits
    // in — NULL means top-level. Only ever set on kind='album' rows,
    // pointing at a kind='album_group' row; enforced in the command layer.
    if !column_exists(conn, "collections", "parent_id")? {
        conn.execute(
            "ALTER TABLE collections ADD COLUMN parent_id TEXT REFERENCES collections(id)",
            [],
        )?;
    }

    // Last-seen on-disk modification time (unix seconds), used by workspace
    // reconciliation to detect files that changed outside Vivid without
    // re-hashing/re-reading every file on every launch. NULL for rows written
    // before this column existed — reconciliation backfills it the first time
    // it sees them rather than treating the absence as "modified".
    if !column_exists(conn, "media_items", "mtime")? {
        conn.execute("ALTER TABLE media_items ADD COLUMN mtime INTEGER", [])?;
    }

    // Performance indexes
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_media_deleted
             ON media_items(deleted_at);
         CREATE INDEX IF NOT EXISTS idx_media_type_del
             ON media_items(media_type, deleted_at);
         CREATE INDEX IF NOT EXISTS idx_collection_items_item
             ON collection_items(item_id);
         CREATE INDEX IF NOT EXISTS idx_media_folder
             ON media_items(folder_id);
         CREATE INDEX IF NOT EXISTS idx_media_source
             ON media_items(source_path);
         CREATE INDEX IF NOT EXISTS idx_media_created
             ON media_items(created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_embed_missing
             ON media_items(file_size)
             WHERE embedding IS NULL AND deleted_at IS NULL;",
    )?;

    Ok(())
}

/// Whether `table` already has a column named `column` (used to make ALTER-based
/// migrations idempotent on databases created before the column existed).
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut found = false;
    let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
    for name in rows {
        if name? == column { found = true; break; }
    }
    Ok(found)
}

// Column order in SELECT_MEDIA:
//   0:id  1:file_path  2:source_path  3:file_name  4:display_name  5:media_type
//   6:file_size  7:description  8:tags  9:starred
//   10:color_label  11:gps_lat  12:gps_lng  13:created_at  14:updated_at
//   15:sort_order  16:deleted_at  17:auto_tags
//   18:audio_title  19:audio_artist  20:audio_album  21:audio_track
//   22:audio_duration_secs  23:audio_year  24:date_taken  25:favorited  26:audio_cover
//   27:width  28:height  29:ocr_text  30:thumb_path  31:folder_id
//   32:camera_make  33:camera_model
//
// `collection_ids` is NOT selected here — it lives in the `collection_items`
// junction table, not on `media_items`, so it can't be read off a single row.
// Callers must run the result through `attach_collections` afterward.
pub(crate) fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<MediaItem> {
    let tags_json: String = row.get(8)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let starred_int: i64 = row.get(9)?;
    let favorited_int: i64 = row.get(25).unwrap_or(0);
    let auto_tags_json: String = row.get(17).unwrap_or_else(|_| "[]".into());
    let auto_tags: Vec<String> = serde_json::from_str(&auto_tags_json).unwrap_or_default();
    Ok(MediaItem {
        id: row.get(0)?,
        file_path: row.get(1)?,
        source_path: row.get(2)?,
        file_name: row.get(3)?,
        display_name: row.get(4)?,
        media_type: row.get(5)?,
        file_size: row.get(6)?,
        description: row.get(7)?,
        tags,
        starred: starred_int != 0,
        collection_ids: Vec::new(),
        folder_id: row.get(31).ok(),
        color_label: row.get(10)?,
        gps_lat: row.get(11)?,
        gps_lng: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        sort_order: row.get(15).unwrap_or(0),
        deleted_at: row.get(16).ok(),
        auto_tags,
        audio_title:    row.get(18).ok(),
        audio_artist:   row.get(19).ok(),
        audio_album:    row.get(20).ok(),
        audio_track:    row.get(21).ok(),
        audio_duration: row.get(22).ok(),
        audio_year:     row.get(23).ok(),
        date_taken:     row.get(24).ok(),
        favorited:      favorited_int != 0,
        audio_cover:    row.get(26).ok(),
        width:          row.get(27).ok(),
        height:         row.get(28).ok(),
        ocr_text:       row.get(29).ok(),
        thumb_path:     row.get(30).ok(),
        camera_make:    row.get(32).ok(),
        camera_model:   row.get(33).ok(),
    })
}

pub(crate) const SELECT_MEDIA: &str =
    "SELECT id, file_path, source_path, file_name, display_name, media_type, \
     file_size, description, tags, starred, color_label, gps_lat, gps_lng, \
     created_at, updated_at, sort_order, deleted_at, auto_tags, \
     audio_title, audio_artist, audio_album, audio_track, audio_duration_secs, audio_year, \
     date_taken, favorited, audio_cover, width, height, ocr_text, thumb_path, folder_id, \
     camera_make, camera_model \
     FROM media_items";

/// Populate `collection_ids` on already-fetched items via one batch query
/// against the junction table — `row_to_item` only sees a single row and
/// can't join, so every `SELECT_MEDIA` call site runs its results through
/// this afterward. A full scan of `collection_items`, not filtered to the
/// given items: simpler than building a dynamic IN-list, and cheap at the
/// scale a single-user local library operates at.
pub(crate) fn attach_collections(conn: &Connection, items: &mut [MediaItem]) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    use std::collections::HashMap;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT item_id, collection_id FROM collection_items")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (item_id, collection_id) = row?;
            map.entry(item_id).or_default().push(collection_id);
        }
    }
    for item in items.iter_mut() {
        if let Some(ids) = map.remove(&item.id) {
            item.collection_ids = ids;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
