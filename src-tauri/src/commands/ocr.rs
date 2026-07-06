use crate::{db, DbState};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

/// Guards against overlapping full-library scans. A single image auto-OCR on
/// import does NOT take this lock (it's O(1)); only `run_ocr_all` does.
static OCR_SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
pub struct OcrProgress {
    pub current: usize,
    pub total:   usize,
    pub done:    bool,
}

#[derive(Clone, Serialize)]
pub struct OcrStatus {
    pub scanned: i64,
    pub total:   i64,
}

#[derive(Clone, Serialize)]
pub struct OcrItem {
    pub id:   String,
    pub text: String,
}

#[derive(Deserialize)]
struct HelperOcr {
    text: String,
}

/// Run Vision OCR on one image via the helper. Returns the recognized text
/// (possibly empty). Errors are surfaced so the caller can decide to skip.
fn ocr_image(helper: &Path, image_path: &str) -> Result<String, String> {
    let output = Command::new(helper)
        .arg("ocr")
        .arg(image_path)
        .output()
        .map_err(|e| format!("failed to run vivid-helper: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "vivid-helper ocr failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let parsed: HelperOcr = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("bad helper output: {e}"))?;
    Ok(parsed.text)
}

/// Background pass: OCR every image that hasn't been scanned yet, emitting
/// `ocr-progress` events. Mirrors `start_embed_all`. Missing files are skipped.
#[tauri::command]
pub fn run_ocr_all(app: tauri::AppHandle) -> Result<(), String> {
    // Only one full scan at a time — prevents stacked passes from pegging the
    // CPU and contending on the DB mutex with the UI.
    if OCR_SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    std::thread::spawn(move || {
        let _guard = ScanGuard;
        let db = app.state::<DbState>();
        let helper = super::helper_path(&app);

        let items = {
            let conn = db.0.lock().unwrap();
            db::get_images_without_ocr(&conn).unwrap_or_default()
        };
        let total = items.len();
        if total == 0 {
            let _ = app.emit("ocr-progress", OcrProgress { current: 0, total: 0, done: true });
            return;
        }

        for (i, (id, path)) in items.iter().enumerate() {
            if Path::new(path).exists() {
                match ocr_image(&helper, path) {
                    Ok(text) => {
                        let conn = db.0.lock().unwrap();
                        let _ = db::set_ocr(&conn, id, &text);
                    }
                    Err(e) => tracing::warn!(id, %path, error = %e, "OCR failed, skipping"),
                }
            } else {
                tracing::warn!(id, %path, "File missing, skipping OCR");
            }

            let _ = app.emit("ocr-progress", OcrProgress {
                current: i + 1,
                total,
                done: i + 1 == total,
            });
        }
    });
    Ok(())
}

/// Clears the scan-running flag on drop (covers early returns / panics).
struct ScanGuard;
impl Drop for ScanGuard {
    fn drop(&mut self) {
        OCR_SCAN_RUNNING.store(false, Ordering::SeqCst);
    }
}

/// (scanned, total) image counts for the Settings UI.
#[tauri::command]
pub fn get_ocr_status(state: State<DbState>) -> Result<OcrStatus, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (scanned, total) = db::get_ocr_counts(&conn).map_err(|e| e.to_string())?;
    Ok(OcrStatus { scanned, total })
}

#[cfg(test)]
mod tests {
    use super::HelperOcr;

    #[test]
    fn parses_helper_output() {
        let parsed: HelperOcr =
            serde_json::from_str(r#"{"text":"Hello Vivid OCR 2026"}"#).unwrap();
        assert_eq!(parsed.text, "Hello Vivid OCR 2026");
    }

    #[test]
    fn parses_empty_text() {
        let parsed: HelperOcr = serde_json::from_str(r#"{"text":""}"#).unwrap();
        assert!(parsed.text.is_empty());
    }
}

/// Fire-and-forget OCR for a single newly imported image so it becomes
/// searchable without a manual scan. Scoped to the one item — it does NOT scan
/// the whole backlog (that's the manual "Scan text" button's job), which avoids
/// surprise full-library passes on every single import.
pub(crate) fn trigger_ocr(app: &tauri::AppHandle, id: String, path: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        if !Path::new(&path).exists() {
            return;
        }
        let helper = super::helper_path(&app);
        let text = match ocr_image(&helper, &path) {
            Ok(t) => t,
            Err(e) => { tracing::warn!(id, %path, error = %e, "OCR failed"); return; }
        };
        {
            let db = app.state::<DbState>();
            let conn = db.0.lock().unwrap();
            let _ = db::set_ocr(&conn, &id, &text);
        }
        // Targeted update: the UI patches just this item, avoiding a full
        // get_all_media refetch on every single import.
        let _ = app.emit("ocr-item", OcrItem { id, text });
    });
}
