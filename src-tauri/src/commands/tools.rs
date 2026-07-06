//! External CLI tools (yt-dlp, ffmpeg) the app can use but does not require at
//! install time. Both are resolved identically, with a clear preference order:
//!
//!   1. A system install (PATH or common Homebrew dirs) — used as-is, never modified.
//!   2. The app's own managed copy in `<app-data>/bin`, fetched on demand.
//!
//! This keeps the base app small and never touches a user's Homebrew binaries:
//! if they already have the tool we use theirs; otherwise we manage a private,
//! isolated copy that only the app updates.
//!
//! Neither is a hard dependency — the rest of the app was deliberately moved
//! off ffmpeg onto native AVFoundation/ImageIO (see `clip.rs`,
//! `commands/export.rs`, `swift/vivid-helper.swift`); the two remaining
//! ffmpeg call sites (`get_playable_video_path`'s wmv/avi/flv/mkv transcoding,
//! and yt-dlp's own internal stream merging) both degrade gracefully if it
//! isn't present, same as yt-dlp itself degrading the download feature if
//! missing. Settings surfaces both as optional installs via the same flow.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use serde::Serialize;
use serde_json::json;
use tauri::Emitter;

// Set once at startup (see lib.rs setup): the app-managed binaries directory.
static BIN_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record (and create) the managed-binaries directory. Called from setup.
pub fn init_bin_dir(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = BIN_DIR.set(dir);
}

fn bin_dir() -> Option<PathBuf> { BIN_DIR.get().cloned() }

// GUI apps on macOS don't inherit the shell PATH, so probe the standard install
// locations explicitly in addition to whatever PATH we did inherit.
const EXTRA_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

// Third-party static-build sources. yt-dlp is the official universal release
// (arm64 + x86_64 in one binary). The ffmpeg build is x86_64-only — there's no
// widely-trusted arm64/universal static build of the same caliber — so on
// Apple Silicon it runs under Rosetta 2, which macOS installs on first launch
// if it isn't already present. Slower to start than a native binary, but
// still entirely usable, and this is the same tradeoff most other apps that
// bundle a static ffmpeg make.
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
const FFMPEG_URL: &str = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";

fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// Return the first directory in `dirs` that contains an executable `name`.
/// Pure (modulo the filesystem check) so the search order is unit-testable.
fn find_in_dirs<I: IntoIterator<Item = PathBuf>>(name: &str, dirs: I) -> Option<PathBuf> {
    for dir in dirs {
        let cand = dir.join(name);
        if is_executable(&cand) { return Some(cand); }
    }
    None
}

/// Find a system-installed binary by name on PATH or in common install dirs.
/// PATH is searched first (a user's chosen install wins), then the standard
/// install locations GUI apps don't inherit on macOS.
fn find_in_system(name: &str) -> Option<PathBuf> {
    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    let extra = EXTRA_DIRS.iter().map(PathBuf::from);
    find_in_dirs(name, path_dirs.into_iter().chain(extra))
}

/// The app's managed copy of a tool, if present and runnable.
fn managed_path(name: &str) -> Option<PathBuf> {
    let p = bin_dir()?.join(name);
    is_executable(&p).then_some(p)
}

/// Resolve a tool to an absolute path, preferring a system install over the
/// app's managed copy. `None` means it's available nowhere we look.
pub fn resolve(name: &str) -> Option<PathBuf> {
    find_in_system(name).or_else(|| managed_path(name))
}

// ── Status ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ToolStatus {
    pub name:      String,
    pub available: bool,
    /// "system" | "managed" | "missing"
    pub source:    String,
}

fn status_of(name: &str) -> ToolStatus {
    let (available, source) = if find_in_system(name).is_some() {
        (true, "system")
    } else if managed_path(name).is_some() {
        (true, "managed")
    } else {
        (false, "missing")
    };
    ToolStatus { name: name.to_string(), available, source: source.to_string() }
}

/// Availability + source for each external tool the app can use, per the
/// preference order documented in the module docs: "system" if found on the
/// user's own PATH/Homebrew dirs, "managed" if we've downloaded our own copy,
/// otherwise "missing".
#[tauri::command]
pub fn tool_status() -> Vec<ToolStatus> {
    ["yt-dlp", "ffmpeg"].iter().map(|n| status_of(n)).collect()
}

// ── Download on demand ────────────────────────────────────────────────────────

fn download_url(name: &str) -> Result<&'static str, String> {
    match name {
        "yt-dlp" => Ok(YTDLP_URL),
        "ffmpeg" => Ok(FFMPEG_URL),
        _ => Err(format!("No download available for {name} on this platform")),
    }
}

fn emit_err(app: &tauri::AppHandle, name: &str, msg: String) -> String {
    let _ = app.emit("tool-download-progress", json!({ "tool": name, "error": msg }));
    msg
}

/// Move/extract the downloaded artifact into the managed bin dir, make it
/// executable, and ad-hoc codesign it (so unsigned arm64 binaries can run).
fn install_from_tmp(name: &str, tmp: &Path, is_zip: bool) -> Result<PathBuf, String> {
    let dir = bin_dir().ok_or("managed binaries dir not initialized")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(name);

    if is_zip {
        let f = std::fs::File::open(tmp).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
        // Locate the entry whose basename matches the tool (e.g. "ffmpeg").
        let mut found = None;
        for i in 0..zip.len() {
            let entry = zip.by_index(i).map_err(|e| e.to_string())?;
            if entry.is_file() {
                let bn = Path::new(entry.name()).file_name().and_then(|s| s.to_str());
                if bn == Some(name) { found = Some(i); break; }
            }
        }
        let i = found.ok_or_else(|| format!("'{name}' not found in downloaded archive"))?;
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    } else {
        std::fs::copy(tmp, &dest).map_err(|e| e.to_string())?;
    }

    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        // Ad-hoc signature — harmless if already signed, required for unsigned
        // arm64 binaries to execute at all.
        let _ = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-", dest.to_str().unwrap_or("")])
            .status();
    }

    let _ = std::fs::remove_file(tmp);
    Ok(dest)
}

/// Download a managed copy of `name` ("ffmpeg" or "yt-dlp") into `<app-data>/bin`.
/// Streams to a temp file, emits "tool-download-progress", then installs.
#[tauri::command]
pub async fn download_tool(name: String, app: tauri::AppHandle) -> Result<(), String> {
    let url = download_url(&name)?;
    let dir = bin_dir().ok_or("managed binaries dir not initialized")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{name}.download"));
    let is_zip = url.ends_with(".zip") || url.contains("/zip");

    let client = reqwest::Client::builder()
        .user_agent("vivid-app/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(url).send().await
        .map_err(|e| emit_err(&app, &name, format!("Network error: {e}")))?;
    if !resp.status().is_success() {
        return Err(emit_err(&app, &name, format!("HTTP {} downloading {name}", resp.status())));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        use tokio::io::AsyncWriteExt;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit("tool-download-progress", json!({
            "tool": name, "downloaded": downloaded, "total": total, "done": false
        }));
    }
    drop(file);

    let (name2, tmp2) = (name.clone(), tmp.clone());
    tokio::task::spawn_blocking(move || install_from_tmp(&name2, &tmp2, is_zip))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| emit_err(&app, &name, e))?;

    tracing::info!(tool = %name, "Managed tool downloaded");
    let _ = app.emit("tool-download-progress", json!({ "tool": name, "done": true }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_in_dirs, is_executable};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use tempfile::tempdir;

    // Create `name` inside `dir` with the given unix mode; return its path.
    fn make_file(dir: &std::path::Path, name: &str, mode: u32) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(mode)).unwrap();
        p
    }

    #[test]
    fn is_executable_true_for_exec_bit() {
        let dir = tempdir().unwrap();
        let p = make_file(dir.path(), "tool", 0o755);
        assert!(is_executable(&p));
    }

    #[test]
    fn is_executable_false_for_non_exec_file() {
        let dir = tempdir().unwrap();
        let p = make_file(dir.path(), "data", 0o644);
        assert!(!is_executable(&p));
    }

    #[test]
    fn is_executable_false_for_missing_and_dirs() {
        let dir = tempdir().unwrap();
        assert!(!is_executable(&dir.path().join("nope")));
        // A directory is not a runnable file even with the exec bit set.
        assert!(!is_executable(dir.path()));
    }

    #[test]
    fn find_in_dirs_returns_first_match_in_order() {
        let a = tempdir().unwrap();
        let b = tempdir().unwrap();
        // Same name exists (executable) in both dirs; the earlier dir must win.
        make_file(a.path(), "ffmpeg", 0o755);
        make_file(b.path(), "ffmpeg", 0o755);
        let found = find_in_dirs("ffmpeg", vec![a.path().to_path_buf(), b.path().to_path_buf()]);
        assert_eq!(found, Some(a.path().join("ffmpeg")));
    }

    #[test]
    fn find_in_dirs_skips_non_executable_and_falls_through() {
        let a = tempdir().unwrap();
        let b = tempdir().unwrap();
        // Present but not executable in `a`; executable in `b` → `b` wins.
        make_file(a.path(), "yt-dlp", 0o644);
        make_file(b.path(), "yt-dlp", 0o755);
        let found = find_in_dirs("yt-dlp", vec![a.path().to_path_buf(), b.path().to_path_buf()]);
        assert_eq!(found, Some(b.path().join("yt-dlp")));
    }

    #[test]
    fn find_in_dirs_none_when_absent() {
        let dir = tempdir().unwrap();
        assert_eq!(find_in_dirs("does-not-exist", vec![dir.path().to_path_buf()]), None);
    }

    #[test]
    fn download_url_yt_dlp_is_arch_independent() {
        assert_eq!(super::download_url("yt-dlp").unwrap(), super::YTDLP_URL);
    }

    #[test]
    fn download_url_unknown_tool_errors() {
        assert!(super::download_url("imagemagick").is_err());
    }
}
