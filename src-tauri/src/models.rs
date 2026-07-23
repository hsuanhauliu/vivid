use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ExifMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub date_taken: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub focal_length: Option<String>,
    pub aperture: Option<String>,
    pub shutter_speed: Option<String>,
    pub iso: Option<u32>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub flash: Option<String>,
    pub color_space: Option<String>,
    pub software: Option<String>,
    pub orientation: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MediaItem {
    pub id: String,
    pub file_path: String,       // path to the library copy
    pub source_path: Option<String>, // original file path or URL, used for dedup
    pub file_name: String,
    pub display_name: String,
    pub media_type: String, // "image", "video", "audio"
    pub file_size: i64,
    pub description: String,
    pub tags: Vec<String>,
    pub starred: bool,
    pub collection_ids: Vec<String>, // an item may belong to any number of collections
    pub folder_id: Option<String>, // the on-disk folder this item lives in
    pub color_label: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lng: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
    pub sort_order: i64,
    pub deleted_at: Option<String>,
    pub auto_tags: Vec<String>,
    // Audio metadata (populated for media_type == "audio")
    pub audio_title:    Option<String>,
    pub audio_artist:   Option<String>,
    pub audio_album:    Option<String>,
    pub audio_track:    Option<i64>,
    pub audio_duration: Option<f64>,  // seconds
    pub audio_year:     Option<i64>,
    pub audio_cover:    Option<String>,  // path to custom cover image
    pub date_taken:     Option<String>,
    pub favorited:      bool,
    pub width:          Option<u32>,
    pub height:         Option<u32>,
    pub ocr_text:       Option<String>,
    pub thumb_path:     Option<String>,
    pub camera_make:    Option<String>,
    pub camera_model:   Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub color: String,
    pub emoji: Option<String>,
    pub pinned: bool,
    pub cover_item_id: Option<String>,
    pub created_at: String,
    /// "album" (images + videos) | "playlist" (audio) | "album_group" (holds
    /// other albums, never media items directly). Collections only —
    /// on-disk organization lives in `Folder`.
    pub kind: String,
    pub sidebar_pin: bool,
    /// Optional free-text description shown on the collection page.
    pub description: Option<String>,
    /// The album_group this album currently sits in, if any. Only ever set
    /// on kind="album" rows, pointing at a kind="album_group" row.
    pub parent_id: Option<String>,
}

/// A node in the on-disk folder tree under the managed library root. Distinct
/// from `Collection` (albums/playlists). `rel_path` is the canonical location of the
/// folder's files relative to the library root; `parent_id` NULL = top level.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub rel_path: String,
    pub created_at: String,
}

/// Aggregate library counts for the About/Info tab.
#[derive(Debug, Serialize)]
pub struct LibraryStats {
    pub total_images:    i64,
    pub total_videos:    i64,
    pub total_audio:     i64,
    pub total_indexed:   i64,
    pub total_unindexed: i64,
    pub total_tags:      i64,
    pub total_size_bytes: i64,
}

pub fn extension_to_media_type(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "bmp" | "tiff" | "tif"
        | "avif" => Some("image"),
        "mp4" | "mov" | "avi" | "mkv" | "webm" | "m4v" | "wmv" | "flv" | "ogv" => Some("video"),
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" | "opus" | "aiff" => {
            Some("audio")
        }
        _ => None,
    }
}

/// Map a MIME type to a file extension for downloaded files.
pub fn mime_to_extension(mime: &str) -> Option<&'static str> {
    match mime.split(';').next().unwrap_or("").trim() {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "video/mp4" => Some("mp4"),
        "video/quicktime" => Some("mov"),
        "video/webm" => Some("webm"),
        "video/x-matroska" => Some("mkv"),
        "audio/mpeg" => Some("mp3"),
        "audio/wav" | "audio/x-wav" => Some("wav"),
        "audio/flac" => Some("flac"),
        "audio/aac" => Some("aac"),
        "audio/ogg" | "video/ogg" => Some("ogg"),
        "audio/mp4" => Some("m4a"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ext_to_media_type_images() {
        assert_eq!(extension_to_media_type("jpg"),  Some("image"));
        assert_eq!(extension_to_media_type("jpeg"), Some("image"));
        assert_eq!(extension_to_media_type("png"),  Some("image"));
        assert_eq!(extension_to_media_type("gif"),  Some("image"));
        assert_eq!(extension_to_media_type("webp"), Some("image"));
        assert_eq!(extension_to_media_type("heic"), Some("image"));
        assert_eq!(extension_to_media_type("HEIC"), Some("image")); // case-insensitive
        assert_eq!(extension_to_media_type("avif"), Some("image"));
    }

    #[test]
    fn ext_to_media_type_video() {
        assert_eq!(extension_to_media_type("mp4"),  Some("video"));
        assert_eq!(extension_to_media_type("MOV"),  Some("video")); // case-insensitive
        assert_eq!(extension_to_media_type("mkv"),  Some("video"));
        assert_eq!(extension_to_media_type("webm"), Some("video"));
    }

    #[test]
    fn ext_to_media_type_audio() {
        assert_eq!(extension_to_media_type("mp3"),  Some("audio"));
        assert_eq!(extension_to_media_type("wav"),  Some("audio"));
        assert_eq!(extension_to_media_type("flac"), Some("audio"));
        assert_eq!(extension_to_media_type("m4a"),  Some("audio"));
        assert_eq!(extension_to_media_type("aiff"), Some("audio"));
    }

    #[test]
    fn ext_to_media_type_unknown() {
        assert_eq!(extension_to_media_type("txt"), None);
        assert_eq!(extension_to_media_type("pdf"), None);
        assert_eq!(extension_to_media_type(""),    None);
        assert_eq!(extension_to_media_type("zip"), None);
    }

    #[test]
    fn mime_to_ext_images() {
        assert_eq!(mime_to_extension("image/jpeg"),  Some("jpg"));
        assert_eq!(mime_to_extension("image/png"),   Some("png"));
        assert_eq!(mime_to_extension("image/gif"),   Some("gif"));
        assert_eq!(mime_to_extension("image/webp"),  Some("webp"));
        assert_eq!(mime_to_extension("image/avif"),  Some("avif"));
    }

    #[test]
    fn mime_to_ext_video_audio() {
        assert_eq!(mime_to_extension("video/mp4"),       Some("mp4"));
        assert_eq!(mime_to_extension("video/quicktime"), Some("mov"));
        assert_eq!(mime_to_extension("video/webm"),      Some("webm"));
        assert_eq!(mime_to_extension("audio/mpeg"),      Some("mp3"));
        assert_eq!(mime_to_extension("audio/flac"),      Some("flac"));
        assert_eq!(mime_to_extension("audio/mp4"),       Some("m4a"));
        assert_eq!(mime_to_extension("audio/ogg"),       Some("ogg"));
    }

    #[test]
    fn mime_to_ext_strips_params() {
        assert_eq!(mime_to_extension("image/jpeg; charset=utf-8"), Some("jpg"));
        assert_eq!(mime_to_extension("video/mp4; codecs=avc1"),    Some("mp4"));
    }

    #[test]
    fn mime_to_ext_unknown() {
        assert_eq!(mime_to_extension("application/octet-stream"), None);
        assert_eq!(mime_to_extension("text/html"),                None);
        assert_eq!(mime_to_extension(""),                         None);
    }
}
