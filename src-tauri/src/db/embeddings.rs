//! CLIP embedding storage and the queries that feed AI indexing.

use super::{row_to_item, SELECT_MEDIA};
use crate::models::MediaItem;
use rusqlite::{params, Connection, Result};

/// Return (id, file_path, media_type, file_size) for every image/video without an embedding,
/// ordered by file_size ASC so small (fast) files are processed first.
pub fn get_items_without_embeddings(conn: &Connection) -> Result<Vec<(String, String, String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, media_type, file_size FROM media_items \
         WHERE media_type IN ('image','video') AND deleted_at IS NULL AND embedding IS NULL \
         ORDER BY file_size ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?,
            r.get::<_, String>(2)?, r.get::<_, i64>(3)?))
    })?;
    rows.collect()
}

/// Return (id, embedding_bytes) for all indexed media items.
pub fn get_all_embeddings(conn: &Connection) -> Result<Vec<(String, Vec<u8>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, embedding FROM media_items \
         WHERE media_type IN ('image','video') AND deleted_at IS NULL AND embedding IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
    })?;
    rows.collect()
}

/// Return the embedding bytes for a single item (if it has one).
pub fn get_embedding(conn: &Connection, id: &str) -> Result<Option<Vec<u8>>> {
    let result = conn.query_row(
        "SELECT embedding FROM media_items WHERE id=?1",
        params![id],
        |r| r.get::<_, Option<Vec<u8>>>(0),
    )?;
    Ok(result)
}

/// Fetch a batch of items by their ids in a single query.
/// Returns items sorted by the order of the provided id slice.
pub fn fetch_items_by_ids(conn: &Connection, ids: &[String]) -> Result<Vec<MediaItem>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("{SELECT_MEDIA} WHERE id IN ({placeholders}) AND deleted_at IS NULL");
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), row_to_item)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

/// Store a pre-computed embedding and its auto-generated tags for one item.
pub fn set_embedding(
    conn: &Connection,
    id: &str,
    embedding: &[u8],
    auto_tags: &[String],
) -> Result<()> {
    let auto_tags_json = serde_json::to_string(auto_tags).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "UPDATE media_items SET embedding=?1, auto_tags=?2 WHERE id=?3",
        params![embedding, auto_tags_json, id],
    )?;
    Ok(())
}

/// Overwrite just the auto-tags for one item, leaving its embedding untouched
/// (used to drop a single unwanted AI tag without re-running inference).
pub fn set_auto_tags(conn: &Connection, id: &str, auto_tags: &[String]) -> Result<()> {
    let auto_tags_json = serde_json::to_string(auto_tags).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "UPDATE media_items SET auto_tags=?1 WHERE id=?2",
        params![auto_tags_json, id],
    )?;
    Ok(())
}
