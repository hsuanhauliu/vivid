use crate::{db, workspace::WorkspaceKind, DbState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

/// Longest-edge size of generated thumbnails. ~400px is plenty for grid cells
/// (which top out around 280px) while decoding ~100× faster than originals.
const THUMB_MAX: u32 = 400;
const THUMB_QUALITY: u8 = 78;

static THUMB_SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
pub struct ThumbProgress {
    pub current: usize,
    pub total:   usize,
    pub done:    bool,
}

#[derive(Clone, Serialize)]
pub struct ThumbItem {
    pub id:         String,
    pub thumb_path: String,
    pub width:      u32,
    pub height:     u32,
}

#[derive(Clone, Serialize)]
pub struct ThumbStatus {
    pub done:  i64,
    pub total: i64,
}

/// Where (if anywhere) generated thumbnails get written for the active
/// workspace. `Default`'s thumbnail cache lives under `<app_data>/thumbs`,
/// same as always. An External workspace's thumbnails are *never* written
/// anywhere — Vivid doesn't create derived files (thumbnails, format
/// conversions, or any other copy) near a user-managed folder, so
/// `write_thumb` instead encodes straight to a `data:` URL that gets cached
/// as text in `media_items.thumb_path` (see `db::set_thumb_dims`) — still
/// persisted across restarts, just inside the DB rather than as loose files.
fn thumb_output_dir(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let ws = app.state::<crate::workspace::WorkspaceState>();
    if ws.workspace.kind == WorkspaceKind::External {
        return Ok(None);
    }
    let dir = ws.paths.thumbs_dir.clone();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(Some(dir))
}

/// Decode `src`, downscale to fit THUMB_MAX, and hand off to `write_thumb`.
/// Returns the thumbnail location (a file path, or a `data:` URL when `dir`
/// is `None`) along with the source image's (EXIF-corrected) pixel
/// dimensions. HEIC/HEIF is converted to JPEG via sips first.
fn generate_thumbnail(src: &Path, id: &str, dir: Option<&Path>) -> Result<(String, u32, u32), String> {
    use crate::clip::{apply_exif_orientation, exif_orientation, heif_to_jpeg_if_needed, sips_to_jpeg};

    let converted = heif_to_jpeg_if_needed(src).map_err(|e| e.to_string())?;
    let decode_path: &Path = converted.as_deref().unwrap_or(src);

    // Decode by sniffing the file's magic bytes rather than trusting its
    // extension — handles files saved with the wrong extension (e.g. a JPEG
    // named *.PNG). If the pure-Rust decoder can't handle the format, fall back
    // to macOS `sips`, which copes with HEIC, RAW, and mislabeled formats.
    let decode = |p: &Path| -> Result<image::DynamicImage, String> {
        let img = image::ImageReader::open(p)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;
        // The `image` crate ignores the EXIF orientation tag; apply it so
        // portrait photos aren't saved sideways.
        Ok(apply_exif_orientation(img, exif_orientation(p)))
    };

    let mut sips_tmp: Option<PathBuf> = None;
    let img = match decode(decode_path) {
        Ok(i) => i,
        Err(_) => {
            let tmp = sips_to_jpeg(decode_path).map_err(|e| e.to_string())?;
            let result = decode(&tmp);
            sips_tmp = Some(tmp);
            result?
        }
    };

    let result = write_thumb(&img, id, dir);

    // Clean up any temporary conversions (HEIC→JPEG and/or the sips fallback).
    if let Some(tmp) = converted { let _ = std::fs::remove_file(tmp); }
    if let Some(tmp) = sips_tmp  { let _ = std::fs::remove_file(tmp); }
    result
}

/// Downscale `img` to fit THUMB_MAX and JPEG-encode it. With `dir: Some(_)`,
/// writes `dir/<id>.jpg` and returns that path; with `dir: None`, returns
/// the encoded bytes as a base64 `data:image/jpeg;base64,...` URL instead —
/// nothing touches disk. Either way the source's pixel dimensions (captured
/// before downscaling, so they stay display-accurate) come back alongside.
fn write_thumb(img: &image::DynamicImage, id: &str, dir: Option<&Path>) -> Result<(String, u32, u32), String> {
    let (orig_w, orig_h) = (img.width(), img.height());

    // `thumbnail` is a fast box filter — ideal for downscaling previews.
    let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);

    // Composite alpha onto white before JPEG encoding; to_rgb8() alone maps
    // transparent pixels to black which produces ugly artifacts on PNG/WebP.
    let rgb = if thumb.color().has_alpha() {
        let rgba = thumb.to_rgba8();
        let mut bg = image::RgbImage::new(rgba.width(), rgba.height());
        for (x, y, px) in rgba.enumerate_pixels() {
            let a = px[3] as f32 / 255.0;
            bg.put_pixel(x, y, image::Rgb([
                (px[0] as f32 * a + 255.0 * (1.0 - a)) as u8,
                (px[1] as f32 * a + 255.0 * (1.0 - a)) as u8,
                (px[2] as f32 * a + 255.0 * (1.0 - a)) as u8,
            ]));
        }
        bg
    } else {
        thumb.to_rgb8()
    };

    let mut bytes: Vec<u8> = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, THUMB_QUALITY);
    enc.encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;

    match dir {
        Some(dir) => {
            let out = dir.join(format!("{id}.jpg"));
            std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
            Ok((out.to_string_lossy().to_string(), orig_w, orig_h))
        }
        None => {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok((format!("data:image/jpeg;base64,{b64}"), orig_w, orig_h))
        }
    }
}

/// Extract a poster frame from a video (via the Swift/AVFoundation helper —
/// no ffmpeg) and hand it to `write_thumb`. Returns the thumbnail location
/// and the video's display dimensions. The single extracted frame serves as
/// both the poster and the dimension source, so videos never need to be
/// decoded in the webview.
fn generate_video_thumb(
    app: &tauri::AppHandle,
    src: &Path,
    id: &str,
    dir: Option<&Path>,
) -> Result<(String, u32, u32), String> {
    let frame = crate::clip::extract_video_frame(app, src).map_err(|e| e.to_string())?;
    let decoded = image::ImageReader::open(&frame)
        .map_err(|e| e.to_string())
        .and_then(|r| r.with_guessed_format().map_err(|e| e.to_string()))
        .and_then(|r| r.decode().map_err(|e| e.to_string()));
    let result = decoded.and_then(|img| write_thumb(&img, id, dir));
    let _ = std::fs::remove_file(&frame);
    result
}

/// Extract embedded cover art from an audio file and hand it to
/// `write_thumb`. Returns `Ok(None)` when the file has no artwork so the
/// caller can skip it without treating it as a failure.
fn generate_audio_thumb(
    app: &tauri::AppHandle,
    src: &Path,
    id: &str,
    dir: Option<&Path>,
) -> Result<Option<(String, u32, u32)>, String> {
    let cover = match crate::clip::extract_audio_cover(app, src).map_err(|e| e.to_string())? {
        Some(p) => p,
        None => return Ok(None),
    };
    let decoded = image::ImageReader::open(&cover)
        .map_err(|e| e.to_string())
        .and_then(|r| r.with_guessed_format().map_err(|e| e.to_string()))
        .and_then(|r| r.decode().map_err(|e| e.to_string()));
    let result = decoded.and_then(|img| write_thumb(&img, id, dir));
    let _ = std::fs::remove_file(&cover);
    result.map(Some)
}

/// Build a thumbnail for one item based on its media type. Audio yields `None`
/// when it carries no embedded cover art; images/videos always attempt one.
fn make_thumb(
    app: &tauri::AppHandle,
    src: &Path,
    id: &str,
    dir: Option<&Path>,
    media_type: &str,
) -> Result<Option<(String, u32, u32)>, String> {
    match media_type {
        "video" => generate_video_thumb(app, src, id, dir).map(Some),
        "audio" => generate_audio_thumb(app, src, id, dir),
        _ => generate_thumbnail(src, id, dir).map(Some),
    }
}

/// Regenerate the thumbnail for a single item (called after an in-place edit).
/// Overwrites the existing thumbnail JPEG so the file's mtime changes,
/// then updates the DB dimensions. Returns the (unchanged) thumb path.
#[tauri::command]
pub fn regenerate_single_thumbnail(
    id: String,
    file_path: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<String, String> {
    let dir = thumb_output_dir(&app)?;
    let (thumb_str, w, h) = generate_thumbnail(Path::new(&file_path), &id, dir.as_deref())?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_thumb_dims(&conn, &id, &thumb_str, w, h).map_err(|e| e.to_string())?;
    Ok(thumb_str)
}

/// Background pass: generate a thumbnail for every image and video that lacks
/// one (videos get a poster frame via AVFoundation), recording dimensions at the same
/// time. Emits `thumb-progress`. Guarded so only one full pass runs at a time.
#[tauri::command]
pub fn generate_thumbnails_all(app: tauri::AppHandle) -> Result<(), String> {
    if THUMB_SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    std::thread::spawn(move || {
        let _guard = ScanGuard;
        let db = app.state::<DbState>();
        let dir = match thumb_output_dir(&app) {
            Ok(d) => d,
            Err(e) => { tracing::error!(error = %e, "thumbs dir"); return; }
        };

        let items = {
            let conn = db.0.lock().unwrap();
            db::get_items_without_thumb(&conn).unwrap_or_default()
        };
        let total = items.len();
        if total == 0 {
            let _ = app.emit("thumb-progress", ThumbProgress { current: 0, total: 0, done: true });
            return;
        }

        for (i, (id, path, media_type)) in items.iter().enumerate() {
            if Path::new(path).exists() {
                match make_thumb(&app, Path::new(path), id, dir.as_deref(), media_type) {
                    Ok(Some((thumb_str, w, h))) => {
                        let conn = db.0.lock().unwrap();
                        let _ = db::set_thumb_dims(&conn, id, &thumb_str, w, h);
                    }
                    Ok(None) => {} // audio with no embedded artwork
                    Err(e) => tracing::warn!(id, %path, error = %e, "thumbnail failed"),
                }
            }
            let _ = app.emit("thumb-progress", ThumbProgress {
                current: i + 1, total, done: i + 1 == total,
            });
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_thumb_status(state: State<DbState>) -> Result<ThumbStatus, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (done, total) = db::get_thumb_counts(&conn).map_err(|e| e.to_string())?;
    Ok(ThumbStatus { done, total })
}

/// Generate a thumbnail for a single freshly imported image or video (videos
/// get a poster frame via AVFoundation), then emit `thumb-item` so the UI can swap in
/// the cheap preview without a refetch. Runs off-thread so the slow video frame
/// extraction never blocks the import.
pub(crate) fn trigger_thumb(app: &tauri::AppHandle, id: String, path: String, media_type: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        let dir = match thumb_output_dir(&app) { Ok(d) => d, Err(_) => return };
        if !Path::new(&path).exists() { return; }
        match make_thumb(&app, Path::new(&path), &id, dir.as_deref(), &media_type) {
            Ok(Some((thumb_path, w, h))) => {
                {
                    let db = app.state::<DbState>();
                    let conn = db.0.lock().unwrap();
                    let _ = db::set_thumb_dims(&conn, &id, &thumb_path, w, h);
                }
                let _ = app.emit("thumb-item", ThumbItem { id, thumb_path, width: w, height: h });
            }
            Ok(None) => {} // audio with no embedded artwork
            Err(e) => tracing::warn!(id, %path, error = %e, "thumbnail failed"),
        }
    });
}

struct ScanGuard;
impl Drop for ScanGuard {
    fn drop(&mut self) {
        THUMB_SCAN_RUNNING.store(false, Ordering::SeqCst);
    }
}
