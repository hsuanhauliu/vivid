use crate::{
    db,
    models::{extension_to_media_type, mime_to_extension, MediaItem},
    DbState,
};
use std::{fs, path::Path};
use tauri::{Emitter, Manager, State};

use super::{build_item, extract_audio_meta, insert_imported, media_dir, unique_path};
use crate::commands::trigger_embed_if_ready;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn resolve_filename(url: &str, given: Option<&str>, content_type: &str) -> Result<String, String> {
    if let Some(name) = given {
        let name = name.trim();
        if !name.is_empty() {
            if !name.contains('.') {
                if let Some(ext) = mime_to_extension(content_type) {
                    return Ok(format!("{name}.{ext}"));
                }
            }
            return Ok(name.to_string());
        }
    }
    let url_path = url.split('?').next().unwrap_or(url);
    let url_name = url_path.split('/').last().unwrap_or("").trim();
    if !url_name.is_empty() && url_name.contains('.') {
        return Ok(url_name.to_string());
    }
    let ext = mime_to_extension(content_type)
        .ok_or_else(|| format!("Cannot determine file type from content-type '{content_type}'"))?;
    Ok(format!("download.{ext}"))
}

// ── URL download ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn download_url(
    url: String,
    filename: Option<String>,
    folder_id: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<MediaItem, String> {
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        if db::source_path_exists(&conn, &url).map_err(|e| e.to_string())? {
            return Err("This URL has already been downloaded.".into());
        }
    }

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let fname = resolve_filename(&url, filename.as_deref(), &content_type)?;
    let ext = fname.rsplit('.').next().unwrap_or("");
    if extension_to_media_type(ext).is_none() {
        return Err(format!(
            "Unsupported file type '.{ext}'. Supported: jpg/png/gif/webp/mp4/mov/mp3/wav/flac and more."
        ));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let mdir = media_dir(&app)?;
    let dest_path = unique_path(&mdir, &fname);
    fs::write(&dest_path, &bytes).map_err(|e| e.to_string())?;

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut item = build_item(&dest_path, Some(url))?;
    item.folder_id = folder_id;
    insert_imported(&conn, &mut item, &app)?;
    Ok(item)
}

// ── yt-dlp downloads ──────────────────────────────────────────────────────────

/// Resolve yt-dlp (system install or app-managed copy), with install guidance
/// when it's nowhere to be found.
fn ytdlp_bin() -> Result<std::path::PathBuf, String> {
    crate::commands::resolve("yt-dlp")
        .ok_or_else(|| "yt-dlp is not available. Download it from Settings, or install it with: brew install yt-dlp".to_string())
}

/// Point yt-dlp at a resolvable ffmpeg. yt-dlp needs ffmpeg for audio
/// extraction and video+audio merging; an app-managed ffmpeg lives outside PATH,
/// so it won't be found without --ffmpeg-location. Empty when ffmpeg is absent
/// (yt-dlp then falls back to formats that don't require it).
fn ffmpeg_location_args() -> Vec<String> {
    match crate::commands::resolve("ffmpeg").and_then(|p| p.parent().map(Path::to_path_buf)) {
        Some(dir) => vec!["--ffmpeg-location".into(), dir.to_string_lossy().into_owned()],
        None => vec![],
    }
}

// ── Background download commands ──────────────────────────────────────────────
//
// The synchronous counterparts of these (single-request yt-dlp audio/video/
// playlist downloads with no progress reporting) were removed as dead code —
// nothing in the frontend called them, only these `_bg` variants, which do
// strictly more (progress events, and for audio, collection creation that
// the old sync versions lacked). If a blocking variant is ever needed again,
// these `_bg` functions' inner `async move` bodies are the reference
// implementation to factor a shared helper out of.

#[derive(Clone, serde::Serialize)]
struct DlProgress {
    job_id:        String,
    label:         String,
    current:       usize,
    total:         usize,
    file_name:     Option<String>,
    done:          bool,
    error:         Option<String>,
    success_count: usize,
}

fn new_job_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("dl-{ms}")
}

fn emit_dl(app: &tauri::AppHandle, p: DlProgress) {
    let _ = app.emit("download-progress", p);
}

/// Fire-and-forget URL image/file download. Emits `download-progress` events.
#[tauri::command]
pub async fn start_download_bg(
    url: String,
    filename: Option<String>,
    folder_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let db = app.state::<DbState>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if db::source_path_exists(&conn, &url).map_err(|e| e.to_string())? {
            return Err("This URL has already been downloaded.".into());
        }
    }

    let job_id = new_job_id();
    let label = filename.clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            url.split('?').next().unwrap_or(&url)
               .split('/').last().unwrap_or("download").to_string()
        });

    emit_dl(&app, DlProgress { job_id: job_id.clone(), label: label.clone(), current: 0, total: 1, file_name: None, done: false, error: None, success_count: 0 });

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<(), String> = async {
            let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!("HTTP {}", response.status()));
            }
            let content_type = response.headers().get("content-type")
                .and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            let fname = resolve_filename(&url, filename.as_deref(), &content_type)?;
            let ext = fname.rsplit('.').next().unwrap_or("");
            if crate::models::extension_to_media_type(ext).is_none() {
                return Err(format!(
                    "Unsupported file type '.{ext}'. Supported: jpg/png/gif/webp/mp4/mov/mp3/wav/flac and more."
                ));
            }
            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
            let mdir = media_dir(&app2)?;
            let dest = unique_path(&mdir, &fname);
            fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
            let db = app2.state::<DbState>();
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let mut item = build_item(&dest, Some(url.clone()))?;
            item.folder_id = folder_id.clone();
            insert_imported(&conn, &mut item, &app2)
        }.await;

        let (err, cnt) = match result { Ok(()) => (None, 1usize), Err(e) => (Some(e), 0) };
        emit_dl(&app2, DlProgress { job_id, label, current: cnt, total: 1, file_name: None, done: true, error: err, success_count: cnt });
    });

    Ok(())
}

/// Fire-and-forget single yt-dlp download (audio or video). Emits `download-progress` events.
#[tauri::command]
pub async fn start_ytdlp_bg(
    url: String,
    format: String,
    filename: Option<String>,
    folder_id: Option<String>,
    collection_id: Option<String>,
    collection_name: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    ytdlp_bin()?; // fail fast if not installed

    let job_id = new_job_id();
    let label = filename.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| url.clone());

    emit_dl(&app, DlProgress { job_id: job_id.clone(), label: label.clone(), current: 0, total: 1, file_name: None, done: false, error: None, success_count: 0 });

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<(), String> = async {
            let ytdlp = ytdlp_bin()?;
            let loc   = ffmpeg_location_args();
            let mdir  = media_dir(&app2)?;
            let ts    = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs()).unwrap_or(0);

            let is_video = format == "video";
            let ext_str  = if is_video { "mp4" } else { "mp3" };
            let stem     = filename.clone().unwrap_or_else(|| format!("ytdlp_{ts}"));
            let dest     = unique_path(&mdir, &format!("{stem}.{ext_str}"));
            let dest_stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or("media").to_string();
            let out_template = format!("{}.%(ext)s", mdir.join(&dest_stem).to_string_lossy());
            let url2 = url.clone();

            let mut args: Vec<String> = loc;
            if is_video {
                args.extend(["--no-playlist".into(),
                    "-f".into(), "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".into(),
                    "--merge-output-format".into(), "mp4".into(), "--add-metadata".into()]);
            } else {
                args.extend(["--no-playlist".into(), "-x".into(),
                    "--audio-format".into(), "mp3".into(), "--audio-quality".into(), "0".into(),
                    "--embed-thumbnail".into(), "--add-metadata".into()]);
            }
            args.extend(["-o".into(), out_template.clone(), url2]);

            let output = tokio::task::spawn_blocking(move || {
                std::process::Command::new(&ytdlp).args(&args).output()
            }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("yt-dlp failed: {}", stderr.lines().last().unwrap_or("unknown error")));
            }

            let expected = mdir.join(format!("{dest_stem}.{ext_str}"));
            let path = if expected.exists() { expected } else {
                find_stem_file(&mdir, &dest_stem).ok_or("yt-dlp completed but output file not found.")?
            };

            let db = app2.state::<DbState>();
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let mut item = build_item(&path, Some(url.clone()))?;
            if !is_video { apply_audio_meta(&mut item, &path); }
            item.folder_id = folder_id.clone();
            let resolved_cid: Option<String> = if let Some(ref cid) = collection_id {
                if !cid.is_empty() { Some(cid.clone()) } else { None }
            } else if let Some(ref name) = collection_name {
                if !name.trim().is_empty() {
                    let kind = if is_video { "album" } else { "playlist" };
                    let g = db::create_collection(&conn, name.trim(), "", None, kind)
                        .map_err(|e| e.to_string())?;
                    Some(g.id)
                } else { None }
            } else { None };
            if let Some(cid) = resolved_cid { item.collection_ids.push(cid); }
            insert_imported(&conn, &mut item, &app2)
        }.await;

        let (err, cnt) = match result { Ok(()) => (None, 1usize), Err(e) => (Some(e), 0) };
        emit_dl(&app2, DlProgress { job_id, label, current: cnt, total: 1, file_name: None, done: true, error: err, success_count: cnt });
    });

    Ok(())
}

/// Fire-and-forget playlist download. Emits per-track `download-progress` events.
#[tauri::command]
pub async fn start_playlist_bg(
    url: String,
    collection_name: Option<String>,
    collection_id: Option<String>,
    format: String,
    folder_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    ytdlp_bin()?;

    let job_id = new_job_id();
    let label  = collection_name.clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| url.clone());

    // total=0 signals indeterminate while yt-dlp is running
    emit_dl(&app, DlProgress { job_id: job_id.clone(), label: label.clone(), current: 0, total: 0, file_name: None, done: false, error: None, success_count: 0 });

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let result: Result<usize, String> = async {
            let ytdlp = ytdlp_bin()?;
            let mdir  = media_dir(&app2)?;

            let before: std::collections::HashSet<std::path::PathBuf> = fs::read_dir(&mdir)
                .map_err(|e| e.to_string())?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .collect();

            let out_template = format!("{}/%(title)s.%(ext)s", mdir.to_string_lossy());
            let format2      = format.clone();
            let url2         = url.clone();

            let mut args: Vec<String> = ffmpeg_location_args();
            if format == "audio" {
                args.extend(["-x".into(), "--audio-format".into(), "mp3".into(),
                    "--audio-quality".into(), "0".into(),
                    "--embed-thumbnail".into(), "--add-metadata".into()]);
            } else {
                args.extend([
                    "-f".into(), "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".into(),
                    "--merge-output-format".into(), "mp4".into(), "--add-metadata".into()]);
            }
            args.extend(["-o".into(), out_template, url.clone()]);

            let output = tokio::task::spawn_blocking(move || {
                std::process::Command::new(&ytdlp).args(&args).output()
            }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("yt-dlp failed: {}", stderr.lines().last().unwrap_or("unknown error")));
            }

            let mut new_files: Vec<std::path::PathBuf> = fs::read_dir(&mdir)
                .map_err(|e| e.to_string())?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| !before.contains(p) && p.is_file())
                .collect();
            new_files.sort();

            let total = new_files.len();
            let db    = app2.state::<DbState>();
            let conn  = db.0.lock().map_err(|e| e.to_string())?;

            let gid: Option<String> = if format2 == "audio" {
                if let Some(id) = collection_id.filter(|s| !s.trim().is_empty()) {
                    Some(id)
                } else if let Some(name) = collection_name.filter(|n| !n.trim().is_empty()) {
                    let g = db::create_collection(&conn, &name, "", None, "playlist")
                        .map_err(|e| e.to_string())?;
                    Some(g.id)
                } else {
                    None
                }
            } else {
                None
            };

            let mut count = 0usize;
            for (i, path) in new_files.iter().enumerate() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if extension_to_media_type(ext).is_none() { continue; }

                emit_dl(&app2, DlProgress {
                    job_id: job_id.clone(), label: label.clone(),
                    current: i, total,
                    file_name: path.file_stem().and_then(|n| n.to_str()).map(String::from),
                    done: false, error: None, success_count: count,
                });

                if let Ok(mut item) = build_item(path, None) {
                    if let Some(ref g) = gid { item.collection_ids.push(g.clone()); }
                    item.folder_id = folder_id.clone();
                    if format2 == "audio" { apply_audio_meta(&mut item, path); }
                    if insert_imported(&conn, &mut item, &app2).is_ok() { count += 1; }
                }
            }
            drop(conn);
            tracing::info!(count, url = %url2, "Playlist bg download complete");
            if count > 0 { trigger_embed_if_ready(&app2); }
            Ok(count)
        }.await;

        let (err, cnt) = match result { Ok(n) => (None, n), Err(e) => (Some(e), 0) };
        emit_dl(&app2, DlProgress { job_id, label, current: cnt, total: cnt, file_name: None, done: true, error: err, success_count: cnt });
    });

    Ok(())
}

// ── Private helpers ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::resolve_filename;

    #[test]
    fn explicit_filename_with_extension() {
        let r = resolve_filename("https://example.com/x", Some("video.mp4"), "").unwrap();
        assert_eq!(r, "video.mp4");
    }

    #[test]
    fn explicit_filename_without_extension_infers_from_mime() {
        let r = resolve_filename("https://example.com/x", Some("clip"), "video/mp4").unwrap();
        assert_eq!(r, "clip.mp4");
    }

    #[test]
    fn empty_given_name_falls_through_to_url() {
        let r = resolve_filename("https://cdn.example.com/path/photo.jpg", Some(""), "").unwrap();
        assert_eq!(r, "photo.jpg");
    }

    #[test]
    fn no_given_name_uses_url_path() {
        let r = resolve_filename("https://cdn.example.com/assets/song.mp3", None, "").unwrap();
        assert_eq!(r, "song.mp3");
    }

    #[test]
    fn url_without_filename_uses_content_type() {
        let r = resolve_filename("https://api.example.com/stream", None, "image/png").unwrap();
        assert_eq!(r, "download.png");
    }

    #[test]
    fn url_with_query_params_strips_them() {
        let r = resolve_filename(
            "https://example.com/photo.jpg?token=abc&size=large",
            None, "",
        ).unwrap();
        assert_eq!(r, "photo.jpg");
    }

    #[test]
    fn unknown_content_type_and_no_path_returns_err() {
        let r = resolve_filename(
            "https://api.example.com/data",
            None,
            "application/octet-stream",
        );
        assert!(r.is_err());
    }

    #[test]
    fn mime_with_params_still_resolves() {
        let r = resolve_filename(
            "https://example.com/x",
            None,
            "image/jpeg; charset=utf-8",
        ).unwrap();
        assert_eq!(r, "download.jpg");
    }
}

fn find_stem_file(dir: &std::path::Path, stem: &str) -> Option<std::path::PathBuf> {
    fs::read_dir(dir).ok()?.find(|e| {
        e.as_ref().ok()
            .and_then(|e| e.file_name().to_str().map(|n| n.starts_with(stem)))
            .unwrap_or(false)
    }).and_then(|e| e.ok()).map(|e| e.path())
}

fn apply_audio_meta(item: &mut MediaItem, path: &Path) {
    if let Ok(meta) = extract_audio_meta(path) {
        if meta.title.is_some() {
            item.display_name = meta.title.clone().unwrap_or_else(|| item.display_name.clone());
        }
        item.audio_title    = meta.title;
        item.audio_artist   = meta.artist;
        item.audio_album    = meta.album;
        item.audio_track    = meta.track;
        item.audio_duration = meta.duration_secs;
        item.audio_year     = meta.year;
    }
}
