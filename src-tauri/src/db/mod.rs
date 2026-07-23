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

/// Open a fresh connection (or an existing database file) and bring it up to
/// the current schema. There is exactly one schema — no upgrade path from an
/// older shape — so every statement here is unconditional: no `ALTER TABLE`,
/// no `column_exists` guards. A pre-1.0 database that predates this schema
/// isn't supported; delete it and let Vivid create a fresh one.
pub fn init(conn: &Connection) -> Result<()> {
    // Connection-level tuning + constraint enforcement, issued standalone
    // before any schema statement. `PRAGMA foreign_keys` is a documented
    // no-op if set mid-transaction, so it can't share a batch with DDL.
    // Foreign keys are relied on throughout this schema (see the `folders`/
    // `collections`/`media_items` comments below) to keep referential
    // integrity a property of the database itself, not something every
    // caller has to remember to maintain by hand.
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -65536;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 1073741824;",
    )?;

    conn.execute_batch(
        "-- The on-disk directory tree under the managed library root. Distinct
         -- from `collections` (albums/playlists — pure metadata, no filesystem
         -- meaning). `rel_path` is the source of truth for where a folder's
         -- files physically live, relative to the library root (e.g.
         -- 'Trips/Japan'); `parent_id` NULL means top-level. The virtual
         -- \"Other\" bucket (everything with no folder) is never a row here —
         -- see `UNCATEGORIZED_ID` in folders.rs.
         CREATE TABLE IF NOT EXISTS folders (
             id          TEXT PRIMARY KEY,
             name        TEXT NOT NULL,
             parent_id   TEXT REFERENCES folders(id),
             rel_path    TEXT NOT NULL UNIQUE,
             created_at  TEXT NOT NULL
         );

         -- Albums (image/video), playlists (audio), and album groups (a
         -- container that only holds other albums, never media items
         -- directly). Item membership is many-to-many via `collection_items`,
         -- not stored here.
         CREATE TABLE IF NOT EXISTS collections (
             id            TEXT PRIMARY KEY,
             name          TEXT NOT NULL,
             color         TEXT NOT NULL DEFAULT '',
             emoji         TEXT,
             kind          TEXT NOT NULL DEFAULT 'album',
             pinned        INTEGER NOT NULL DEFAULT 1,
             sidebar_pin   INTEGER NOT NULL DEFAULT 0,
             cover_item_id TEXT REFERENCES media_items(id) ON DELETE SET NULL,
             description   TEXT,
             -- The album_group this album currently sits in (kind='album' rows
             -- only, pointing at a kind='album_group' row); NULL = top-level.
             -- SET NULL on delete: removing a group ungroups its children
             -- instead of orphaning or cascading the delete into them.
             parent_id     TEXT REFERENCES collections(id) ON DELETE SET NULL,
             created_at    TEXT NOT NULL
         );

         -- The library itself: one row per photo/video/audio file. `folder_id`
         -- deliberately has no `ON DELETE` action — a folder can only be
         -- deleted once every item under it (trashed included) has been
         -- explicitly relocated first (see `commands::folders::delete_folder`),
         -- so a row that would be left dangling should fail loudly instead of
         -- silently losing its place in the tree.
         CREATE TABLE IF NOT EXISTS media_items (
             id                  TEXT PRIMARY KEY,
             file_path           TEXT NOT NULL UNIQUE,
             source_path         TEXT UNIQUE,
             file_name           TEXT NOT NULL,
             display_name        TEXT NOT NULL,
             media_type          TEXT NOT NULL,
             file_size           INTEGER NOT NULL DEFAULT 0,
             mtime               INTEGER,
             folder_id           TEXT REFERENCES folders(id),
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

         -- Many-to-many collection membership. Both sides cascade: deleting a
         -- collection or hard-deleting an item cleans up its membership rows
         -- automatically instead of leaking orphaned junction rows forever.
         CREATE TABLE IF NOT EXISTS collection_items (
             collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
             item_id       TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
             added_at      TEXT NOT NULL,
             PRIMARY KEY (collection_id, item_id)
         );",
    )?;

    conn.execute_batch(
        // `file_path`/`source_path`/`rel_path` are already covered by their
        // own UNIQUE constraints (SQLite indexes those automatically) — no
        // explicit index duplicates one here.
        "CREATE INDEX IF NOT EXISTS idx_media_deleted
             ON media_items(deleted_at);
         CREATE INDEX IF NOT EXISTS idx_media_type_del
             ON media_items(media_type, deleted_at);
         CREATE INDEX IF NOT EXISTS idx_media_folder
             ON media_items(folder_id);
         CREATE INDEX IF NOT EXISTS idx_media_created
             ON media_items(created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_embed_missing
             ON media_items(file_size)
             WHERE embedding IS NULL AND deleted_at IS NULL;
         CREATE INDEX IF NOT EXISTS idx_collection_items_item
             ON collection_items(item_id);",
    )?;

    Ok(())
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

/// Build a `(?,?,?)`-shaped placeholder list for a dynamic IN-clause of
/// length `n` — shared by every query that filters on a runtime-sized batch
/// of ids, so the same idiom isn't hand-rolled at each call site.
pub(crate) fn in_placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

/// Populate `collection_ids` on already-fetched items via one batch query
/// against the junction table, filtered to just this batch's ids so it stays
/// indexed (`idx_collection_items_item`) rather than scanning the whole
/// table — `row_to_item` only sees a single row and can't join, so every
/// `SELECT_MEDIA` call site runs its results through this afterward.
pub(crate) fn attach_collections(conn: &Connection, items: &mut [MediaItem]) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }
    use std::collections::HashMap;
    let sql = format!(
        "SELECT item_id, collection_id FROM collection_items WHERE item_id IN ({})",
        in_placeholders(items.len())
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let rows = stmt.query_map(
        rusqlite::params_from_iter(items.iter().map(|i| &i.id)),
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )?;
    for row in rows {
        let (item_id, collection_id) = row?;
        map.entry(item_id).or_default().push(collection_id);
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
