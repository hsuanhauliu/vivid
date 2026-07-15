use crate::{db, models::MediaItem, DbState};
use std::{fs, io, path::Path};
use tauri::State;

use super::{build_item, insert_imported, media_dir, resolve, unique_path};

/// Shortest trim range accepted by `trim_video`/`export_video_gif` — matches
/// the frontend's drag-handle minimum gap (VideoPlayer.jsx's MIN_TRIM_DURATION)
/// so a range that's draggable in the UI is never rejected server-side, while
/// a degenerate/near-zero range (e.g. an unmoved selection right after opening
/// trim mode, or a sub-second sliver that displays as e.g. "0:00 – 0:00" once
/// truncated to whole seconds) always is.
const MIN_TRIM_DURATION_SECS: f64 = 1.0;

/// Runs the Swift `vivid-helper` binary with `args`, verifying `out_path`
/// exists afterward and cleaning it up on failure. Shared by `trim_video` and
/// `export_video_gif`, which differ only in the subcommand/args and the error
/// message prefix. Blocking (spawns a subprocess and waits for it) — callers
/// run it via `spawn_blocking` so a multi-second encode doesn't stall the
/// async runtime.
fn run_video_helper(
    helper: &Path,
    args: &[String],
    out_path: &Path,
    err_context: &str,
) -> Result<(), String> {
    let out = std::process::Command::new(helper)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run vivid-helper: {e}"))?;
    if !out.status.success() || !out_path.exists() {
        let _ = fs::remove_file(out_path);
        return Err(format!(
            "{err_context}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

// ── Basic export ──────────────────────────────────────────────────────────────

/// Reveal a file in Finder (macOS `open -R`).
#[tauri::command]
pub fn reveal_in_finder(file_path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&file_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Copy a file to a caller-chosen destination path.
#[tauri::command]
pub fn export_file(src_path: String, dest_path: String) -> Result<(), String> {
    fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Export with optional format conversion (image crate infers format from extension).
#[tauri::command]
pub fn export_as(src_path: String, dest_path: String, is_image: bool) -> Result<(), String> {
    if is_image {
        let img = image::open(&src_path).map_err(|e| format!("Cannot open image: {e}"))?;
        img.save(&dest_path).map_err(|e| format!("Cannot save image: {e}"))?;
    } else {
        fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Re-encode image without metadata (strips EXIF/IPTC/XMP).
#[tauri::command]
pub fn export_stripped(src_path: String, dest_path: String) -> Result<(), String> {
    use crate::clip::heif_to_jpeg_if_needed;
    let src = std::path::PathBuf::from(&src_path);
    let effective = heif_to_jpeg_if_needed(&src).ok().flatten().unwrap_or_else(|| src.clone());
    let img = image::open(&effective).map_err(|e| format!("Cannot open image: {e}"))?;
    img.save(&dest_path).map_err(|e| format!("Cannot save stripped image: {e}"))?;
    Ok(())
}


/// Copy a file to the macOS clipboard.
/// For images: writes actual image data (TIFF/JPEG/PNG) via NSPasteboard so
/// the content can be pasted into any image-aware app.
/// For other files: writes a file reference (alias) for Finder paste.
#[tauri::command]
pub fn copy_file_to_clipboard(file_path: String, _media_type: String) -> Result<(), String> {
    let escaped = file_path.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"use framework "AppKit"
use framework "Foundation"
use scripting additions
set theURL to current application's NSURL's fileURLWithPath_("{escaped}")
set pb to current application's NSPasteboard's generalPasteboard()
pb's clearContents()
pb's writeObjects_({{theURL}})"#
    );
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("osascript exited with {}", out.status)
        } else {
            stderr
        });
    }
    Ok(())
}

// ── Image transforms ──────────────────────────────────────────────────────────

/// Apply a geometric transform. `save_mode`: "overwrite" (replaces the original
/// in place — irreversible, no backup) or "copy" (writes a new library item).
///
/// HEIC/HEIF can't be decoded *or* encoded by the `image` crate, so we decode
/// via macOS `sips` (→ temp JPEG) and re-encode the result as JPEG. On overwrite
/// that changes the extension, so we write a sibling `.jpg`, repoint the DB row
/// to it (using `id`), and delete the original `.heic`. Other overwrites just
/// rewrite the file in place and return `None`.
#[tauri::command]
pub fn transform_image(
    file_path: String,
    operation: String,
    save_mode: String,
    id: String,
    app: tauri::AppHandle,
    state: State<DbState>,
) -> Result<Option<MediaItem>, String> {
    use crate::clip::{apply_exif_orientation, exif_orientation, heif_to_jpeg_if_needed};

    let src_path = Path::new(&file_path);
    let orig_ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg").to_lowercase();
    if orig_ext == "gif" {
        return Err("GIFs can't be edited — this would flatten the animation to a single frame".into());
    }
    let is_heic = orig_ext == "heic" || orig_ext == "heif";

    // The image crate has no HEIC decoder — convert to a temp JPEG first.
    let heic_tmp = heif_to_jpeg_if_needed(src_path).map_err(|e| e.to_string())?;
    let cleanup = |t: &Option<std::path::PathBuf>| { if let Some(p) = t { let _ = fs::remove_file(p); } };
    let decode_path: &Path = heic_tmp.as_deref().unwrap_or(src_path);
    let img = match image::open(decode_path).map_err(|e| format!("Cannot open image: {e}")) {
        Ok(i) => i,
        Err(e) => { cleanup(&heic_tmp); return Err(e); }
    };
    // The `image` crate ignores EXIF orientation, but browsers/OS viewers (and
    // this app's own editor preview) auto-rotate per that same tag — without
    // this, crop/rotate/flip/resize all operate on a different pixel grid than
    // what's shown on screen, so e.g. a crop region selected in the editor
    // lands in the wrong place in the saved file. Chained ops (this command is
    // called once per queued op) stay correct because a freshly re-encoded
    // intermediate file has no EXIF tag of its own (defaults to orientation 1,
    // a no-op) — only the very first decode of the true original ever corrects
    // anything.
    let img = apply_exif_orientation(img, exif_orientation(decode_path));

    let result: image::DynamicImage = if let Some(args) = operation.strip_prefix("resize:") {
        let parts: Vec<u32> = args.split(',').filter_map(|s| s.trim().parse().ok()).collect();
        if parts.len() != 2 {
            cleanup(&heic_tmp);
            return Err("resize requires w,h".into());
        }
        img.resize_exact(parts[0], parts[1], image::imageops::FilterType::Lanczos3)
    } else if let Some(args) = operation.strip_prefix("crop:") {
        let parts: Vec<u32> = args.split(',').filter_map(|s| s.trim().parse().ok()).collect();
        if parts.len() != 4 {
            cleanup(&heic_tmp);
            return Err("crop requires x,y,w,h".into());
        }
        let (iw, ih) = (img.width(), img.height());
        let x = parts[0].min(iw.saturating_sub(1));
        let y = parts[1].min(ih.saturating_sub(1));
        let w = parts[2].min(iw - x);
        let h = parts[3].min(ih - y);
        img.crop_imm(x, y, w, h)
    } else {
        match operation.as_str() {
            "rotate90"  => img.rotate90(),
            "rotate180" => img.rotate180(),
            "rotate270" => img.rotate270(),
            "flip_h"    => img.fliph(),
            "flip_v"    => img.flipv(),
            other => {
                cleanup(&heic_tmp);
                return Err(format!("Unknown operation: {other}"));
            }
        }
    };

    // Edited HEIC/HEIF is re-encoded as JPEG; everything else keeps its format.
    let out_ext = if is_heic { "jpg" } else { orig_ext.as_str() };

    if save_mode == "copy" {
        let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let dest = unique_path(&media_dir(&app)?, &format!("{stem}_edited.{out_ext}"));
        let saved = result.save(&dest).map_err(|e| format!("Cannot save copy: {e}"));
        cleanup(&heic_tmp);
        saved?;
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut item = build_item(&dest, None)?;
        insert_imported(&conn, &mut item, &app)?;
        Ok(Some(item))
    } else if is_heic {
        // Overwrite: re-encode to a sibling JPEG, repoint the row, drop the .heic.
        let parent = src_path.parent().unwrap_or_else(|| Path::new("."));
        let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let dest = unique_path(parent, &format!("{stem}.jpg"));
        let saved = result.save(&dest).map_err(|e| format!("Cannot save image: {e}"));
        cleanup(&heic_tmp);
        saved?;
        let _ = fs::remove_file(&file_path);
        let new_name = dest.file_name().and_then(|n| n.to_str()).unwrap_or("image.jpg").to_string();
        let new_size = fs::metadata(&dest).map(|m| m.len() as i64).unwrap_or(0);
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let updated = db::repoint_file(&conn, &id, &dest.to_string_lossy(), &new_name, new_size)
            .map_err(|e| e.to_string())?;
        Ok(Some(updated))
    } else {
        let saved = result.save(&file_path).map_err(|e| format!("Cannot save image: {e}"));
        cleanup(&heic_tmp);
        saved?;
        // Multi-op edits chain several `transform_image` calls onto the same
        // file/id ("copy" creates the row on the first op, every later op in
        // the chain lands here). Without this, the thumbnail and DB width/height
        // stay frozen at whatever the first op produced, so a copy with 2+
        // queued ops ends up with a grid thumbnail that doesn't match the final
        // saved file.
        super::trigger_thumb(&app, id, file_path.clone(), "image".into());
        Ok(None)
    }
}

// ── Batch export ──────────────────────────────────────────────────────────────

/// Copy a list of files to a destination folder.
#[tauri::command]
pub fn export_files_to_folder(
    file_paths: Vec<String>,
    dest_folder: String,
) -> Result<(), String> {
    let dest = Path::new(&dest_folder);
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for src_str in &file_paths {
        let src = Path::new(src_str);
        let fname = src.file_name().ok_or("Invalid file path")?;
        let mut dest_path = dest.join(fname);
        if dest_path.exists() {
            let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
            let ext  = src.extension().and_then(|e| e.to_str()).unwrap_or("");
            for i in 1u32.. {
                let candidate = dest.join(if ext.is_empty() {
                    format!("{stem}_{i}")
                } else {
                    format!("{stem}_{i}.{ext}")
                });
                if !candidate.exists() { dest_path = candidate; break; }
            }
        }
        fs::copy(src, &dest_path).map_err(|e| format!("Copy failed for {src_str}: {e}"))?;
    }
    Ok(())
}

/// Compress a list of files into a ZIP archive at dest_path.
/// Already-compressed media (JPEG, MP4, MP3, etc.) uses Stored mode — attempting to
/// deflate them wastes CPU and often makes the archive *larger*. Files are streamed
/// in 64 KB chunks so large videos never load into memory all at once.
#[tauri::command]
pub fn export_files_as_zip(
    file_paths: Vec<String>,
    dest_path: String,
) -> Result<(), String> {
    fn compression_for(ext: &str) -> zip::CompressionMethod {
        match ext.to_lowercase().as_str() {
            // Already-compressed formats — store as-is
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "heif" | "avif"
            | "mp4" | "mov" | "avi" | "mkv" | "webm" | "m4v"
            | "mp3" | "m4a" | "aac" | "flac" | "ogg" | "opus" => zip::CompressionMethod::Stored,
            // Everything else (text files, raw, etc.) can benefit from deflate
            _ => zip::CompressionMethod::Deflated,
        }
    }

    let file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let mut used_names: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    for src_str in &file_paths {
        let src = Path::new(src_str);
        let base_name = src.file_name()
            .and_then(|n| n.to_str()).unwrap_or("file").to_string();

        let archive_name = {
            let count = used_names.entry(base_name.clone()).or_insert(0);
            if *count == 0 {
                *count += 1;
                base_name.clone()
            } else {
                let stem = Path::new(&base_name).file_stem().and_then(|s| s.to_str()).unwrap_or("file");
                let ext  = Path::new(&base_name).extension().and_then(|e| e.to_str()).unwrap_or("");
                let name = if ext.is_empty() {
                    format!("{stem}_{count}")
                } else {
                    format!("{stem}_{count}.{ext}")
                };
                *count += 1;
                name
            }
        };

        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
            .compression_method(compression_for(ext));

        zip.start_file(&archive_name, options).map_err(|e| e.to_string())?;

        // Stream the file in 64 KB chunks — never loads a whole video into RAM.
        let mut src_file = fs::File::open(src)
            .map_err(|e| format!("Open failed for {src_str}: {e}"))?;
        io::copy(&mut src_file, &mut zip)
            .map_err(|e| format!("Write failed for {src_str}: {e}"))?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

// ── HEIC / displayable path ───────────────────────────────────────────────────

/// Return a displayable path. HEIC/HEIF files are converted to a cached JPEG in /tmp.
#[tauri::command]
pub fn get_displayable_path(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if ext == "heic" || ext == "heif" {
        use sha2::{Digest, Sha256};
        let hash = hex::encode(Sha256::digest(file_path.as_bytes()));
        let out_path = format!("/tmp/vivid_heic_{}.jpg", &hash[..16]);
        if !Path::new(&out_path).exists() {
            let status = std::process::Command::new("sips")
                .args(["-s", "format", "jpeg", "--out", &out_path, &file_path])
                .status()
                .map_err(|e| format!("sips not available: {e}"))?;
            if !status.success() {
                return Err("sips conversion failed".into());
            }
        }
        Ok(out_path)
    } else {
        Ok(file_path)
    }
}

// ── Video playback fallback ────────────────────────────────────────────────────

/// Containers/codecs that WKWebView's native `<video>` can't play at all, even
/// though they're recognized, importable video types (see
/// `models::extension_to_media_type`). Transcoded once to H.264/AAC MP4 and
/// cached, same idea as the HEIC path above but heavier, so it's kept separate.
const UNPLAYABLE_VIDEO_EXTS: &[&str] = &["wmv", "avi", "flv", "mkv"];

/// Return a path the webview can actually play. Formats WKWebView can't decode
/// (WMV/VC-1, AVI, FLV, MKV/Matroska) are transcoded to a cached H.264/AAC MP4
/// via ffmpeg; everything else passes through unchanged.
#[tauri::command]
pub fn get_playable_video_path(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if !UNPLAYABLE_VIDEO_EXTS.contains(&ext.as_str()) {
        return Ok(file_path);
    }

    use sha2::{Digest, Sha256};
    let hash = hex::encode(Sha256::digest(file_path.as_bytes()));
    let out_path = format!("/tmp/vivid_video_{}.mp4", &hash[..16]);
    if !Path::new(&out_path).exists() {
        let ffmpeg = resolve("ffmpeg").ok_or(
            "ffmpeg is not installed — install it with `brew install ffmpeg` (or any install on PATH)",
        )?;
        let status = std::process::Command::new(&ffmpeg)
            .args(["-y", "-i", &file_path])
            .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"])
            .args(["-c:a", "aac", "-b:a", "192k"])
            .arg(&out_path)
            .status()
            .map_err(|e| format!("ffmpeg failed to run: {e}"))?;
        if !status.success() {
            let _ = std::fs::remove_file(&out_path); // avoid caching a partial/broken file
            return Err(format!("ffmpeg could not transcode {file_path}"));
        }
    }
    Ok(out_path)
}

// ── AirDrop / share sheet ─────────────────────────────────────────────────────

/// Invoke the macOS NSSharingService (AirDrop) for the given file paths.
/// Runs on the main thread inside the app process so no ghost window appears.
#[tauri::command]
pub fn share_files(app: tauri::AppHandle, file_paths: Vec<String>) -> Result<(), String> {
    if file_paths.is_empty() { return Ok(()); }

    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::msg_send;

        // Thin Send wrapper around a raw ObjC pointer so we can ship it to the main thread.
        struct RawPtr(*mut AnyObject);
        unsafe impl Send for RawPtr {}

        unsafe fn nsstring(s: &str) -> *mut AnyObject {
            let cls = objc2::runtime::AnyClass::get("NSString").unwrap();
            let obj: *mut AnyObject = msg_send![cls, alloc];
            let bytes = s.as_ptr() as *const std::ffi::c_void;
            msg_send![obj, initWithBytes: bytes length: s.len() encoding: 4u64 /* UTF-8 */]
        }

        unsafe fn nsurl_file(path: &str) -> *mut AnyObject {
            let cls = objc2::runtime::AnyClass::get("NSURL").unwrap();
            let p = nsstring(path);
            let url: *mut AnyObject = msg_send![cls, fileURLWithPath: p];
            let _: () = msg_send![p, release];
            url
        }

        let url_ptrs: Vec<RawPtr> = file_paths
            .iter()
            .map(|p| unsafe { RawPtr(nsurl_file(p)) })
            .collect();

        let _ = app.run_on_main_thread(move || unsafe {
            // Build NSArray of URLs.
            let arr_cls = objc2::runtime::AnyClass::get("NSArray").unwrap();
            let raw_ptrs: Vec<*mut AnyObject> = url_ptrs.iter().map(|r| r.0).collect();
            let ns_array: *mut AnyObject = msg_send![
                arr_cls,
                arrayWithObjects: raw_ptrs.as_ptr()
                count: raw_ptrs.len()
            ];

            // Get the AirDrop sharing service.
            let svc_cls = objc2::runtime::AnyClass::get("NSSharingService").unwrap();
            let name = nsstring("com.apple.share.AirDrop.send");
            let service: *mut AnyObject = msg_send![svc_cls, sharingServiceNamed: name];
            let _: () = msg_send![name, release];

            if !service.is_null() {
                let can: bool = msg_send![service, canPerformWithItems: ns_array];
                if can {
                    let _: () = msg_send![service, performWithItems: ns_array];
                }
            }
        });
    }

    Ok(())
}

// ── Audio cover art ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_audio_cover(
    id: String,
    cover_path: Option<String>,
    state: State<DbState>,
) -> Result<MediaItem, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::set_audio_cover(&conn, &id, cover_path.as_deref()).map_err(|e| e.to_string())
}

// ── Frame → clipboard ─────────────────────────────────────────────────────────

/// Write a captured video frame (JPEG data URL from the frontend's canvas
/// grab) to the system clipboard as real image data — not a file reference —
/// so it pastes directly into any image-aware app. Round-trips through a
/// scratch temp file (NSImage needs a path to load from) that's removed right
/// after; the frame is never added to the library.
#[tauri::command]
pub fn copy_frame_to_clipboard(data_url: String) -> Result<(), String> {
    let bytes = super::decode_data_url(&data_url)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = format!("/tmp/vivid_clip_frame_{ts}.jpg");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;

    let escaped = tmp.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"use framework "AppKit"
use framework "Foundation"
use scripting additions
set theImage to current application's NSImage's alloc()'s initWithContentsOfFile_("{escaped}")
set pb to current application's NSPasteboard's generalPasteboard()
pb's clearContents()
pb's writeObjects_({{theImage}})"#
    );
    let out = std::process::Command::new("osascript").arg("-e").arg(&script).output();
    let _ = fs::remove_file(&tmp);
    let out = out.map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("osascript exited with {}", out.status)
        } else {
            stderr
        });
    }
    Ok(())
}

// ── Video trim ────────────────────────────────────────────────────────────────

/// Trim `file_path` to `[start, end]` (seconds) via the Swift helper
/// (AVFoundation — no ffmpeg). When `max_height` is omitted or the source is
/// already at or below it, it tries a passthrough (re-mux only, no re-encode
/// — fast, lossless, and sample-accurate) export first, falling back to a
/// re-encoding preset if the source/preset combo can't produce MP4 via
/// passthrough. When `max_height` requires downscaling, it always re-encodes
/// (passthrough can't resize). `save_mode`: "copy" writes a new library item;
/// "overwrite" replaces the original — like `transform_image`'s HEIC path,
/// this always lands on a new sibling filename and repoints the DB row
/// rather than literally overwriting the same path, so the webview never
/// serves a stale cached copy of a file whose path didn't change.
#[tauri::command]
pub async fn trim_video(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    file_path: String,
    id: String,
    start: f64,
    end: f64,
    save_mode: String,
    max_height: Option<u32>,
) -> Result<Option<MediaItem>, String> {
    if end - start < MIN_TRIM_DURATION_SECS {
        return Err("Trim range must be at least a tenth of a second".into());
    }

    let src_path = Path::new(&file_path);
    let orig_ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if orig_ext == "gif" {
        return Err("GIFs can't be trimmed".into());
    }
    let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("video").to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp_out = std::env::temp_dir().join(format!("vivid_trim_{ts}.mp4"));

    let helper = super::helper_path(&app);
    let mut args = vec![
        "trim".to_string(),
        file_path.clone(),
        tmp_out.to_string_lossy().into_owned(),
        start.to_string(),
        end.to_string(),
    ];
    if let Some(h) = max_height {
        args.push(h.to_string());
    }
    let tmp_out_c = tmp_out.clone();
    // The helper's video re-encode can take real time — run it off the main
    // thread so it doesn't freeze the whole UI while it works.
    tauri::async_runtime::spawn_blocking(move || {
        run_video_helper(&helper, &args, &tmp_out_c, "could not trim the video")
    })
    .await
    .map_err(|e| e.to_string())??;

    if save_mode == "copy" {
        let dest = unique_path(&media_dir(&app)?, &format!("{stem}_trimmed.mp4"));
        let moved = fs::rename(&tmp_out, &dest)
            .or_else(|_| fs::copy(&tmp_out, &dest).map(|_| ()).and_then(|_| fs::remove_file(&tmp_out)))
            .map_err(|e| e.to_string());
        moved?;
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut item = build_item(&dest, None)?;
        insert_imported(&conn, &mut item, &app)?;
        Ok(Some(item))
    } else {
        let parent = src_path.parent().unwrap_or_else(|| Path::new("."));
        let dest = unique_path(parent, &format!("{stem}_trimmed.mp4"));
        let moved = fs::rename(&tmp_out, &dest)
            .or_else(|_| fs::copy(&tmp_out, &dest).map(|_| ()).and_then(|_| fs::remove_file(&tmp_out)))
            .map_err(|e| e.to_string());
        moved?;
        let _ = fs::remove_file(&file_path);
        let new_name = dest.file_name().and_then(|n| n.to_str()).unwrap_or("video.mp4").to_string();
        let new_size = fs::metadata(&dest).map(|m| m.len() as i64).unwrap_or(0);
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let updated = db::repoint_file(&conn, &id, &dest.to_string_lossy(), &new_name, new_size)
            .map_err(|e| e.to_string())?;
        drop(conn);
        super::trigger_thumb(&app, id, dest.to_string_lossy().to_string(), "video".into());
        Ok(Some(updated))
    }
}

/// Export `[start, end]` of `file_path` as a GIF — always a new library item
/// (never overwrites the source video), reading straight from the source file
/// (never from decoded/canvas frames — same as the trim command above), via
/// the Swift helper (AVFoundation frame sampling + ImageIO GIF assembly — no
/// ffmpeg). Samples at 12fps and only downscales if the source is taller than
/// `max_height` (never upscales a smaller clip). `max_height` follows the
/// conventional "Xp" video resolution naming (e.g. 1080 → 1080p, which for a
/// 16:9 source is 1920×1080) and defaults to 720px when not given.
#[tauri::command]
pub async fn export_video_gif(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    file_path: String,
    start: f64,
    end: f64,
    max_height: Option<u32>,
) -> Result<MediaItem, String> {
    if end - start < MIN_TRIM_DURATION_SECS {
        return Err("Trim range must be at least a tenth of a second".into());
    }

    let src_path = Path::new(&file_path);
    let orig_ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if orig_ext == "gif" {
        return Err("GIFs can't be trimmed".into());
    }
    let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("video").to_string();
    let dest = unique_path(&media_dir(&app)?, &format!("{stem}.gif"));

    let helper = super::helper_path(&app);
    let args = vec![
        "gif".to_string(),
        file_path.clone(),
        dest.to_string_lossy().into_owned(),
        start.to_string(),
        end.to_string(),
        max_height.unwrap_or(720).to_string(),
    ];
    let dest_c = dest.clone();
    // GIF sampling/encoding can take real time — run it off the main thread
    // so it doesn't freeze the whole UI while it works.
    tauri::async_runtime::spawn_blocking(move || {
        run_video_helper(&helper, &args, &dest_c, "could not export the GIF")
    })
    .await
    .map_err(|e| e.to_string())??;

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut item = build_item(&dest, None)?;
    insert_imported(&conn, &mut item, &app)?;
    Ok(item)
}


