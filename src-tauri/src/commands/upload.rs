//! Temporary LAN upload server — receive files from a phone on the same network.
//!
//! The user explicitly starts the server (it never listens while idle). Starting
//! it generates an unguessable per-session token that is baked into the URL path
//! (`http://<lan-ip>:<port>/upload/<token>`); every request to a path the server
//! doesn't recognize is rejected with 404, so the URL is the capability. A QR
//! code of that URL is shown so a phone can open it instantly.
//!
//! Security model (see also the in-app copy):
//! * **Explicit activation** — only `start_upload_server` opens a socket.
//! * **Unguessable token** — 122 bits of entropy in the path; brute force on a
//!   LAN is infeasible.
//! * **Auto-expiry** — the server shuts itself down after [`EXPIRY`], whether or
//!   not the window stays open.
//! * **Manual stop** — closing the panel / quitting (or the Stop button) ends it.
//!
//! Uploaded files are streamed to a staging dir and then handed to the *existing*
//! import pipeline ([`super::run_import`]), so they get the same folder placement,
//! dedup, thumbnails, embeddings, and live `import-batch`/`import-done` events as
//! any other import — the grid fills in real time and the usual toast fires.

use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, State as AxumState},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

use super::{media_dir, run_import, unique_path};

/// How long the server runs before shutting itself down. Long enough to send a
/// batch of photos/videos from a phone, short enough to limit exposure.
const EXPIRY: Duration = Duration::from_secs(15 * 60);

/// Self-contained upload page served at `/upload/<token>`. Posts the selected
/// files back to its own path (the token is already in `location.pathname`), so
/// no token templating is needed. Styled to echo Vivid's dark UI.
const UPLOAD_PAGE: &str = include_str!("upload_page.html");

// ── Managed state ─────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct UploadState {
    inner: Mutex<Option<Session>>,
}

impl UploadState {
    pub fn new() -> Self {
        Self::default()
    }
}

struct Session {
    token: String,
    /// Fires graceful shutdown when sent (or dropped). `Option` so a manual stop
    /// can `take()` it exactly once.
    stop: Option<oneshot::Sender<()>>,
}

/// Shared context handed to the axum handlers for the lifetime of one session.
struct ServerCtx {
    token: String,
    staging: PathBuf,
    app: AppHandle,
}

// ── Wire types ────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct UploadServerInfo {
    /// Full URL a phone opens (also the QR payload).
    pub url: String,
    /// Inline SVG QR code of `url`, ready to drop into the DOM.
    pub qr_svg: String,
    pub port: u16,
    /// Seconds until auto-expiry, for the UI countdown.
    pub expires_in_secs: u64,
}

#[derive(Serialize)]
struct UploadResult {
    received: usize,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Start (or restart) the temporary upload server and return the connection info.
#[tauri::command]
pub async fn start_upload_server(app: AppHandle) -> Result<UploadServerInfo, String> {
    // Tear down any previous session first so a restart can't leak a socket.
    stop_running(&app);

    let token = uuid::Uuid::new_v4().simple().to_string();

    // Stage uploads outside `media/` — `run_import` treats anything already under
    // the media dir as a no-op duplicate, so a sibling dir is required. Reset it
    // so a crashed prior run can't leave stale files behind.
    let staging = media_dir(&app)?
        .parent()
        .ok_or("no app data dir")?
        .join("upload_tmp");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    // Bind to 0.0.0.0 so other devices on the LAN can reach it; port 0 lets the
    // OS pick a free port.
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let host = lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let url = format!("http://{host}:{port}/upload/{token}");

    let ctx = Arc::new(ServerCtx {
        token: token.clone(),
        staging,
        app: app.clone(),
    });

    let router = Router::new()
        .route("/upload/:token", get(serve_page).post(receive))
        // Stream large videos straight to disk; no in-memory body cap.
        .layer(DefaultBodyLimit::disable())
        .with_state(ctx);

    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let app_for_serve = app.clone();
    let token_for_serve = token.clone();
    tauri::async_runtime::spawn(async move {
        let shutdown = async move {
            // Whichever comes first: an explicit stop, or the expiry timeout.
            tokio::select! {
                _ = stop_rx => {}
                _ = tokio::time::sleep(EXPIRY) => {
                    tracing::info!("Upload server expired");
                }
            }
        };
        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await
        {
            tracing::warn!(error = %e, "Upload server error");
        }
        // Single place that finalizes a stop (manual, expiry, or error): clear the
        // session and notify the frontend so the modal returns to idle.
        finish_session(&app_for_serve, &token_for_serve);
    });

    let qr_svg = qr_svg(&url);
    *app.state::<UploadState>().inner.lock().map_err(|e| e.to_string())? = Some(Session {
        token,
        stop: Some(stop_tx),
    });

    // Log the bind info only — never the full URL, which embeds the secret
    // capability token and would otherwise persist in the on-disk logs.
    tracing::info!(%host, port, "Upload server started");
    Ok(UploadServerInfo {
        url,
        qr_svg,
        port,
        expires_in_secs: EXPIRY.as_secs(),
    })
}

/// Stop the server now (Stop button, or the panel closing).
#[tauri::command]
pub fn stop_upload_server(app: AppHandle) {
    stop_running(&app);
}

/// Trigger graceful shutdown of the current session if one is running. The
/// `finish_session` in the serve task does the actual state-clearing + event.
fn stop_running(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<UploadState>().inner.lock() {
        if let Some(session) = guard.as_mut() {
            if let Some(tx) = session.stop.take() {
                let _ = tx.send(());
            }
        }
    }
}

/// Clear the session and tell the frontend, but only if it still owns `token`
/// (a quick restart may have installed a newer session we must not clobber).
fn finish_session(app: &AppHandle, token: &str) {
    if let Ok(mut guard) = app.state::<UploadState>().inner.lock() {
        if guard.as_ref().map(|s| s.token == token).unwrap_or(false) {
            *guard = None;
            let _ = app.emit("upload-server-stopped", ());
            tracing::info!("Upload server stopped");
        }
    }
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

async fn serve_page(AxumState(ctx): AxumState<Arc<ServerCtx>>, AxumPath(token): AxumPath<String>) -> Response {
    if token != ctx.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    Html(UPLOAD_PAGE).into_response()
}

async fn receive(
    AxumState(ctx): AxumState<Arc<ServerCtx>>,
    AxumPath(token): AxumPath<String>,
    mut multipart: Multipart,
) -> Response {
    if token != ctx.token {
        return StatusCode::NOT_FOUND.into_response();
    }

    let mut saved: Vec<String> = Vec::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => {
                tracing::warn!(error = %e, "Upload field error");
                return StatusCode::BAD_REQUEST.into_response();
            }
        };

        let fname = field.file_name().map(|s| s.to_string());
        let Some(fname) = fname else { continue }; // skip non-file fields
        // `unique_path` reduces to the final path component, so a crafted filename
        // can't escape the staging dir.
        let dest = unique_path(&ctx.staging, &fname);

        let mut file = match tokio::fs::File::create(&dest).await {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(error = %e, "Upload create file failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };
        let mut field = field;
        loop {
            match field.chunk().await {
                Ok(Some(bytes)) => {
                    if let Err(e) = file.write_all(&bytes).await {
                        tracing::warn!(error = %e, "Upload write failed");
                        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!(error = %e, "Upload read failed");
                    return StatusCode::BAD_REQUEST.into_response();
                }
            }
        }
        let _ = file.flush().await;
        saved.push(dest.to_string_lossy().to_string());
    }

    if saved.is_empty() {
        return Json(UploadResult { received: 0 }).into_response();
    }

    // Hand off to the shared import pipeline on a blocking thread (it does sync
    // fs + SQLite work), then remove the staging copies it left behind.
    let app = ctx.app.clone();
    let received = saved.len();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run_import(&app, saved.clone(), None, None, None, false) {
            tracing::error!(error = %e, "Upload import failed");
        }
        for p in &saved {
            let _ = std::fs::remove_file(p);
        }
    });

    Json(UploadResult { received }).into_response()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Best-effort primary LAN IPv4 of this machine, for building a URL another
/// device can reach. Falls back to `None` (caller uses loopback) if undetermined.
fn lan_ip() -> Option<String> {
    match local_ip_address::local_ip() {
        Ok(IpAddr::V4(v4)) => Some(v4.to_string()),
        Ok(IpAddr::V6(v6)) => Some(v6.to_string()),
        Err(e) => {
            tracing::warn!(error = %e, "Could not determine LAN IP");
            None
        }
    }
}

/// Render `url` as an inline SVG QR code string.
fn qr_svg(url: &str) -> String {
    use qrcode::render::svg;
    match qrcode::QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(180, 180)
            .quiet_zone(true)
            .dark_color(svg::Color("#141414"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(e) => {
            tracing::warn!(error = %e, "QR render failed");
            String::new()
        }
    }
}
