//! Media item persistence: insert/update/query, audio metadata, color
//! labels, GPS, OCR, and thumbnail bookkeeping.

use super::{row_to_item, SELECT_MEDIA};
use crate::models::MediaItem;
use rusqlite::{params, Connection, Result};

pub fn source_path_exists(conn: &Connection, source_path: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM media_items WHERE source_path=?1",
        params![source_path],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

pub fn insert(conn: &Connection, item: &MediaItem) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO media_items
         (id, file_path, source_path, file_name, display_name, media_type, file_size,
          description, tags, starred, collection_id, color_label, gps_lat, gps_lng,
          created_at, updated_at, sort_order,
          audio_title, audio_artist, audio_album, audio_track, audio_duration_secs, audio_year,
          date_taken, favorited, audio_cover, width, height, folder_id, camera_make, camera_model)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31)",
        params![
            item.id, item.file_path, item.source_path, item.file_name, item.display_name,
            item.media_type, item.file_size, item.description,
            serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".into()),
            item.starred as i64, item.collection_id, item.color_label,
            item.gps_lat, item.gps_lng, item.created_at, item.updated_at, item.sort_order,
            item.audio_title, item.audio_artist, item.audio_album,
            item.audio_track, item.audio_duration, item.audio_year,
            item.date_taken, item.favorited as i64, item.audio_cover,
            item.width, item.height, item.folder_id, item.camera_make, item.camera_model,
        ],
    )?;
    Ok(())
}

pub fn update_audio_meta(
    conn: &Connection,
    id: &str,
    artist: Option<&str>,
    album: Option<&str>,
    title: Option<&str>,
    year: Option<i64>,
    track: Option<i64>,
) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET audio_artist=?1, audio_album=?2, audio_title=?3, \
         audio_year=?4, audio_track=?5, updated_at=?6 WHERE id=?7",
        params![artist, album, title, year, track, now, id],
    )?;
    fetch_one(conn, id)
}

pub fn set_audio_cover(conn: &Connection, id: &str, cover_path: Option<&str>) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET audio_cover=?1, updated_at=?2 WHERE id=?3",
        params![cover_path, now, id],
    )?;
    fetch_one(conn, id)
}

pub fn update_sort_order(conn: &Connection, id: &str, sort_order: i64) -> Result<()> {
    conn.execute(
        "UPDATE media_items SET sort_order=?1 WHERE id=?2",
        params![sort_order, id],
    )?;
    Ok(())
}

pub fn set_color_label(conn: &Connection, id: &str, label: Option<&str>) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET color_label=?1, updated_at=?2 WHERE id=?3",
        params![label, now, id],
    )?;
    fetch_one(conn, id)
}

/// Manually set (or clear, passing both as None) an item's GPS coordinates —
/// used by the "adjust location" map picker in the detail panel, independent
/// of whatever EXIF GPS data (if any) the file itself carries.
pub fn set_location(
    conn: &Connection,
    id: &str,
    lat: Option<f64>,
    lng: Option<f64>,
) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET gps_lat=?1, gps_lng=?2, updated_at=?3 WHERE id=?4",
        params![lat, lng, now, id],
    )?;
    fetch_one(conn, id)
}

/// Store recognized OCR text for an item and mark it as scanned. An empty string
/// is a valid result (image scanned, no text found) and still flips the flag.
pub fn set_ocr(conn: &Connection, id: &str, text: &str) -> Result<()> {
    conn.execute(
        "UPDATE media_items SET ocr_text=?1, ocr_scanned=1 WHERE id=?2",
        params![text, id],
    )?;
    Ok(())
}

/// Image ids that haven't been OCR-scanned yet, smallest files first.
pub fn get_images_without_ocr(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path FROM media_items \
         WHERE deleted_at IS NULL AND media_type='image' AND ocr_scanned=0 \
         ORDER BY file_size ASC",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Record the cached thumbnail path and the source image's (EXIF-corrected)
/// pixel dimensions in one update.
pub fn set_thumb_dims(conn: &Connection, id: &str, thumb_path: &str, w: u32, h: u32) -> Result<()> {
    conn.execute(
        "UPDATE media_items SET thumb_path=?1, width=?2, height=?3 WHERE id=?4",
        params![thumb_path, w, h, id],
    )?;
    Ok(())
}

/// Items without a cached thumbnail yet, smallest files first. Covers images
/// and videos (videos get a poster frame extracted via AVFoundation; GIFs get
/// their first frame, same as any other image — `image::open` on a GIF only
/// ever decodes frame 0). Audio is included so embedded cover art (e.g.
/// yt-dlp --embed-thumbnail) gets extracted; audio with no artwork simply
/// yields no thumbnail and is harmlessly re-attempted on later passes.
/// Returns `(id, file_path, media_type)`.
pub fn get_items_without_thumb(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, media_type FROM media_items \
         WHERE deleted_at IS NULL AND thumb_path IS NULL \
         AND media_type IN ('image', 'video', 'audio') \
         ORDER BY file_size ASC",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        )))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// (with_thumb, total) counts for progress reporting, across images and videos.
pub fn get_thumb_counts(conn: &Connection) -> Result<(i64, i64)> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM media_items \
         WHERE deleted_at IS NULL AND media_type IN ('image', 'video')",
        [], |r| r.get(0),
    )?;
    let done: i64 = conn.query_row(
        "SELECT COUNT(*) FROM media_items \
         WHERE deleted_at IS NULL AND media_type IN ('image', 'video') AND thumb_path IS NOT NULL",
        [], |r| r.get(0),
    )?;
    Ok((done, total))
}

/// (scanned, total) image counts for the OCR settings UI.
pub fn get_ocr_counts(conn: &Connection) -> Result<(i64, i64)> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM media_items WHERE deleted_at IS NULL AND media_type='image'",
        [], |r| r.get(0),
    )?;
    let scanned: i64 = conn.query_row(
        "SELECT COUNT(*) FROM media_items WHERE deleted_at IS NULL AND media_type='image' AND ocr_scanned=1",
        [], |r| r.get(0),
    )?;
    Ok((scanned, total))
}

pub fn get_all(conn: &Connection) -> Result<Vec<MediaItem>> {
    let sql = format!("{SELECT_MEDIA} WHERE deleted_at IS NULL ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map([], row_to_item)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

pub fn get_audio_tracks(conn: &Connection) -> Result<Vec<MediaItem>> {
    let sql = format!(
        "{SELECT_MEDIA} WHERE deleted_at IS NULL AND media_type='audio' \
         ORDER BY audio_album ASC, audio_track ASC, display_name ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt.query_map([], row_to_item)?.filter_map(|r| r.ok()).collect();
    Ok(items)
}

pub fn fetch_one(conn: &Connection, id: &str) -> Result<MediaItem> {
    let sql = format!("{SELECT_MEDIA} WHERE id=?1");
    conn.query_row(&sql, params![id], row_to_item)
}

pub fn update(
    conn: &Connection,
    id: &str,
    display_name: &str,
    description: &str,
    tags: &[String],
) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "UPDATE media_items SET display_name=?1, description=?2, tags=?3, updated_at=?4 WHERE id=?5",
        params![display_name, description, tags_json, now, id],
    )?;
    fetch_one(conn, id)
}

/// Repoint an item's file to a new path/name/size. Used when an edited file is
/// re-encoded to a different format or content in place (HEIC/HEIF → JPEG,
/// video trim), so the row must follow the file to its new location and
/// reflect its new size. Returns the updated row.
pub fn repoint_file(
    conn: &Connection,
    id: &str,
    new_path: &str,
    new_name: &str,
    file_size: i64,
) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET file_path=?1, display_name=?2, file_size=?3, updated_at=?4 WHERE id=?5",
        params![new_path, new_name, file_size, now, id],
    )?;
    fetch_one(conn, id)
}

pub fn toggle_star(conn: &Connection, id: &str) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET starred = NOT starred, updated_at=?1 WHERE id=?2",
        params![now, id],
    )?;
    fetch_one(conn, id)
}

pub fn set_collection(conn: &Connection, id: &str, collection_id: Option<&str>) -> Result<MediaItem> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "UPDATE media_items SET collection_id=?1, updated_at=?2 WHERE id=?3",
        params![collection_id, now, id],
    )?;
    fetch_one(conn, id)
}

