//! Aggregate library statistics.

use rusqlite::Connection;

/// Aggregate stats about the library for the About/Info tab.
pub fn get_library_stats(conn: &Connection) -> rusqlite::Result<(i64, i64, i64, i64, i64, i64, i64)> {
    let (images, videos, audio, indexed, unindexed, total_size): (i64, i64, i64, i64, i64, i64) =
        conn.query_row(
            "SELECT
               SUM(CASE WHEN media_type='image' THEN 1 ELSE 0 END),
               SUM(CASE WHEN media_type='video' THEN 1 ELSE 0 END),
               SUM(CASE WHEN media_type='audio' THEN 1 ELSE 0 END),
               SUM(CASE WHEN embedding IS NOT NULL AND media_type IN ('image','video') THEN 1 ELSE 0 END),
               SUM(CASE WHEN embedding IS NULL    AND media_type IN ('image','video') THEN 1 ELSE 0 END),
               COALESCE(SUM(file_size), 0)
             FROM media_items WHERE deleted_at IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )?;

    // Count distinct tags across all non-deleted items using json_each
    let tag_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM (
           SELECT json_each.value FROM media_items, json_each(media_items.tags)
           WHERE deleted_at IS NULL AND json_array_length(tags) > 0
           UNION ALL
           SELECT json_each.value FROM media_items, json_each(media_items.auto_tags)
           WHERE deleted_at IS NULL AND json_array_length(auto_tags) > 0
         )",
        [],
        |r| r.get(0),
    ).unwrap_or(0);

    Ok((images, videos, audio, indexed, unindexed, tag_count, total_size))
}
