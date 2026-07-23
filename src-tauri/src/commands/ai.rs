use crate::{db, models::MediaItem, DbState};
use crate::clip::{bytes_to_embedding, cosine_sim, embedding_to_bytes, MOOD_VOCAB};
use crate::config::{FIND_SIMILAR_THRESHOLD, MOOD_FILTER_THRESHOLD, SEMANTIC_SEARCH_THRESHOLD};
use crate::emb_index::EmbIndex;
use crate::siglip_clip::SiglipClip;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager, State};

/// Guards against overlapping embed-all passes. Without this, every single
/// file imported in a batch calls `trigger_embed_if_ready`, each spawning its
/// own `start_embed_all` thread — multiple concurrent passes each compute
/// their own `total` from a slightly different snapshot of unindexed items,
/// then interleave their `clip-progress` emissions, which is what made the
/// progress bar's percentage jump around instead of climbing steadily.
static EMBED_SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Clears the scan-running flag on drop (covers early returns / panics).
struct EmbedScanGuard;
impl Drop for EmbedScanGuard {
    fn drop(&mut self) {
        EMBED_SCAN_RUNNING.store(false, Ordering::SeqCst);
    }
}

// ── State types (also exported for lib.rs) ────────────────────────────────────

pub struct ClipInner {
    /// In-memory embedding index. Updated incrementally after each embed.
    /// Wrapped in `Arc<RwLock<_>>` (not just `Arc`) so callers can cheaply
    /// clone the `Arc` and release the outer `ClipState` lock before running
    /// the compute-heavy cosine similarity loop, while single-item upserts
    /// (`embed_and_tag_image`) mutate in place under the `RwLock` instead of
    /// deep-cloning the whole index — which a bare `Arc::make_mut` would do
    /// whenever a concurrent search is holding its own clone of the `Arc`.
    pub emb_index:           Arc<RwLock<EmbIndex>>,
    pub multilingual:        Option<Arc<SiglipClip>>,
    pub multilingual_loading: bool,
}
pub struct ClipState(pub Arc<Mutex<ClipInner>>);

#[derive(Clone, Serialize)]
pub struct ClipStatus {
    pub available: bool,
    pub unindexed: usize,
}

#[derive(Clone, Serialize)]
pub struct MultilingualStatus {
    pub installed: bool,
    pub loaded:    bool,
    pub loading:   bool,
}

#[derive(Clone, Serialize)]
pub struct SemanticResult {
    pub item: MediaItem,
    pub score: f32,
}

#[derive(Clone, Serialize)]
pub struct ClipProgress {
    pub current:   usize,
    pub total:     usize,
    pub item_id:   String,
    pub file_name: String,
    pub auto_tags: Vec<String>,
    pub done:      bool,
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn multilingual_model(clip: &ClipState) -> Option<Arc<SiglipClip>> {
    clip.0.lock().unwrap().multilingual.clone()
}

fn find_multilingual_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let src_dir: Option<std::path::PathBuf> = option_env!("CARGO_MANIFEST_DIR")
        .map(|d| std::path::Path::new(d).join("models").join("clip-multilingual"));
    let data = app.path().app_data_dir().ok()
        .map(|d| d.join("models").join("clip-multilingual"));
    [data, src_dir].into_iter().flatten().find(|p| {
        let ok = |name: &str, min_bytes: u64| {
            p.join(name).metadata().map(|m| m.len() >= min_bytes).unwrap_or(false)
        };
        // tokenizer.json's min size matters more than it looks: this directory reused
        // the same filename as the old M-CLIP setup, whose tokenizer.json was ~1-2 MB —
        // a loose threshold here would accept that stale, wrong-vocabulary file instead
        // of forcing a fresh download of SigLIP's real ~16 MB one.
        ok("model.safetensors", 1_000_000_000) // SigLIP multilingual, text+vision combined (~1.48 GB)
        && ok("tokenizer.json", 10_000_000)     // multilingual SentencePiece fast tokenizer (~16 MB)
        && ok("config.json", 10)
    })
}

/// Fetch scored items in a single batch query and re-sort by score.
fn fetch_items_batch(
    conn: &rusqlite::Connection,
    scored: Vec<(f32, String)>,
) -> Vec<SemanticResult> {
    if scored.is_empty() { return vec![]; }
    let score_map: HashMap<String, f32> = scored.iter()
        .map(|(s, id)| (id.clone(), *s))
        .collect();
    let ids: Vec<String> = scored.into_iter().map(|(_, id)| id).collect();
    let items = db::fetch_items_by_ids(conn, &ids).unwrap_or_default();
    let mut results: Vec<SemanticResult> = items
        .into_iter()
        .filter_map(|item| score_map.get(&item.id).map(|&score| SemanticResult { item, score }))
        .collect();
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results
}

/// Check whether AI is available and how many images still need indexing.
#[tauri::command]
pub fn get_clip_status(
    db: State<'_, DbState>,
    clip: State<'_, ClipState>,
    app: tauri::AppHandle,
) -> ClipStatus {
    let available = {
        let g = clip.0.lock().unwrap();
        g.multilingual.is_some() || find_multilingual_dir(&app).is_some()
    };
    let unindexed = if available {
        let conn = db.0.lock().unwrap();
        db::get_items_without_embeddings(&conn).unwrap_or_default().len()
    } else {
        0
    };
    ClipStatus { available, unindexed }
}

// ── Multilingual CLIP commands ─────────────────────────────────────────────────

#[tauri::command]
pub fn get_multilingual_status(clip: State<'_, ClipState>, app: tauri::AppHandle) -> MultilingualStatus {
    let g = clip.0.lock().unwrap();
    MultilingualStatus {
        installed: g.multilingual.is_some() || find_multilingual_dir(&app).is_some(),
        loaded:    g.multilingual.is_some(),
        loading:   g.multilingual_loading,
    }
}

/// Load the multilingual text encoder asynchronously; emits "multilingual-ready".
#[tauri::command]
pub fn load_multilingual(app: tauri::AppHandle) -> Result<(), String> {
    {
        let clip = app.state::<ClipState>();
        let mut g = clip.0.lock().unwrap();
        if g.multilingual.is_some() || g.multilingual_loading {
            return Ok(());
        }
        g.multilingual_loading = true;
    }
    std::thread::spawn(move || {
        let state = app.state::<ClipState>();
        if let Some(dir) = find_multilingual_dir(&app) {
            match SiglipClip::load(&dir) {
                Ok(enc) => {
                    // Pre-load all stored embeddings into the in-memory index so
                    // semantic_search and find_similar never need to hit SQLite.
                    let db_state = app.state::<DbState>();
                    let raw = {
                        let conn = db_state.0.lock().unwrap();
                        db::get_all_embeddings(&conn).unwrap_or_default()
                    };
                    let emb_index = EmbIndex::from_pairs(
                        raw.into_iter()
                            .map(|(id, bytes)| (id, bytes_to_embedding(&bytes)))
                            .collect(),
                    );
                    tracing::info!(count = emb_index.len(), "Embedding index loaded from DB");

                    let mut g = state.0.lock().unwrap();
                    g.multilingual         = Some(Arc::new(enc));
                    g.multilingual_loading = false;
                    g.emb_index            = Arc::new(RwLock::new(emb_index));
                    drop(g);

                    // Auto-index any items added before the model was available.
                    let db_state2 = app.state::<DbState>();
                    let unindexed = {
                        let conn = db_state2.0.lock().unwrap();
                        db::get_items_without_embeddings(&conn).unwrap_or_default().len()
                    };
                    if unindexed > 0 {
                        tracing::info!(unindexed, "Auto-starting embed-all for unindexed items");
                        let app2 = app.clone();
                        std::thread::spawn(move || {
                            let _ = crate::commands::start_embed_all(app2);
                        });
                    }

                    let _ = tauri::Emitter::emit(&app, "multilingual-ready", true);
                }
                Err(e) => {
                    state.0.lock().unwrap().multilingual_loading = false;
                    tracing::error!(error = %e, "Multilingual CLIP load failed");
                    let _ = tauri::Emitter::emit(&app, "multilingual-error", e.to_string());
                }
            }
        } else {
            state.0.lock().unwrap().multilingual_loading = false;
            tracing::warn!("Multilingual model not found on disk");
            let _ = tauri::Emitter::emit(&app, "multilingual-not-found", true);
        }
    });
    Ok(())
}

/// Unload the multilingual text encoder from memory.
#[tauri::command]
pub fn unload_multilingual(clip: State<'_, ClipState>) {
    let mut g = clip.0.lock().unwrap();
    g.multilingual         = None;
    g.multilingual_loading = false;
    tracing::info!("Multilingual CLIP text encoder unloaded");
}

/// Download all files needed for the SigLIP (multilingual) model, from
/// `google/siglip-base-patch16-256-multilingual`:
///   1. config.json        (~350 B)
///   2. tokenizer.json     (~16 MB)
///   3. model.safetensors  (~1.48 GB) — combined text + vision weights
/// Emits "model-download-progress" events.
#[tauri::command]
pub async fn download_multilingual_model(app: tauri::AppHandle) -> Result<(), String> {
    let dest_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join("clip-multilingual");
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    // This directory is reused from the earlier M-CLIP setup, which left
    // large now-unused files behind under different names (each ~1.5-2 GB,
    // wasted disk space) — clean those up before downloading the current
    // model's files so an old install never lingers alongside a new one.
    for stale in &["text_model.bin", "clip_vision.bin", "dense_projection.safetensors"] {
        let p = dest_dir.join(stale);
        if p.exists() {
            tracing::info!(file = stale, "Removing stale file from previous model");
            let _ = std::fs::remove_file(&p);
        }
    }

    let base = "https://huggingface.co/google/siglip-base-patch16-256-multilingual/resolve/main";

    // (local_filename, url, min_size_to_skip) — tokenizer.json's threshold must stay
    // well above the old M-CLIP tokenizer.json's size (that setup used this same
    // filename), or a stale wrong-vocabulary file would pass as "already downloaded".
    let files: &[(&str, &str, u64)] = &[
        ("config.json",        &format!("{base}/config.json"),        10),
        ("tokenizer.json",     &format!("{base}/tokenizer.json"),      10_000_000),
        ("model.safetensors",  &format!("{base}/model.safetensors"),   1_000_000_000),
    ];

    let client = reqwest::Client::builder()
        .user_agent("vivid-app/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    for (filename, url, min_size) in files {
        let dest = dest_dir.join(filename);
        if dest.metadata().map(|m| m.len() >= *min_size).unwrap_or(false) {
            tracing::info!(file = filename, "Already downloaded, skipping");
            continue;
        }
        let tmp = dest_dir.join(format!("{filename}.tmp"));

        let mut resp = client.get(*url).send().await.map_err(|e| {
            let msg = format!("Network error downloading {filename}: {e}");
            let _ = app.emit("model-download-progress", serde_json::json!({
                "model": "multilingual", "error": msg
            }));
            msg
        })?;
        if !resp.status().is_success() {
            let msg = format!("HTTP {} downloading {filename}", resp.status());
            let _ = app.emit("model-download-progress", serde_json::json!({
                "model": "multilingual", "error": msg
            }));
            return Err(msg);
        }
        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;

        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            use tokio::io::AsyncWriteExt;
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            let _ = app.emit("model-download-progress", serde_json::json!({
                "model": "multilingual", "file": filename,
                "downloaded": downloaded, "total": total, "done": false
            }));
        }
        drop(file);
        std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        tracing::info!(file = filename, "Downloaded multilingual model file");
    }

    let _ = app.emit("model-download-progress", serde_json::json!({
        "model": "multilingual", "done": true
    }));
    Ok(())
}

/// Embed and auto-tag a single image by id; updates the in-memory index.
/// Used to re-run AI tagging for one item on demand (e.g. from the detail pane).
/// Async + `spawn_blocking` so the CPU-bound CLIP inference doesn't block the
/// main thread (and freeze the whole UI) the way a plain sync command would.
#[tauri::command]
pub async fn embed_and_tag_image(
    id: String,
    db: State<'_, DbState>,
    clip: State<'_, ClipState>,
) -> Result<MediaItem, String> {
    let file_path: String = {
        let conn = db.0.lock().unwrap();
        db::file_path(&conn, &id).map_err(|e| e.to_string())?
    };

    let ml = multilingual_model(&clip).ok_or("No AI model loaded")?;

    let (embedding_bytes, auto_tags, emb_f32) =
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
            let emb = ml.embed_image(Path::new(&file_path)).map_err(|e| e.to_string())?;
            let tags = ml.auto_tag(&emb);
            let bytes = embedding_to_bytes(&emb);
            Ok((bytes, tags, emb))
        })
        .await
        .map_err(|e| e.to_string())??;

    let updated = {
        let conn = db.0.lock().unwrap();
        if auto_tags.is_empty() {
            // A confident-tag miss isn't a failure — the embedding itself is
            // still valid and worth keeping fresh — but it shouldn't blank
            // out whatever tags were already there. Re-save the embedding
            // with the item's existing tags instead of an empty list.
            let existing = db::fetch_one(&conn, &id).map_err(|e| e.to_string())?;
            db::set_embedding(&conn, &id, &embedding_bytes, &existing.auto_tags)
                .map_err(|e| e.to_string())?;
        } else {
            db::set_embedding(&conn, &id, &embedding_bytes, &auto_tags).map_err(|e| e.to_string())?;
        }
        db::fetch_one(&conn, &id).map_err(|e| e.to_string())?
    };

    // Keep the in-memory index current so searches immediately reflect this
    // item. Mutates in place under the RwLock — never clones the index, even
    // if a concurrent search is holding its own `Arc` clone of it.
    {
        let g = clip.0.lock().unwrap();
        g.emb_index.write().unwrap().upsert(id.clone(), &emb_f32);
    }

    Ok(updated)
}

/// Drop a single AI-generated tag from one item without touching its embedding
/// or any user-added tags, so a bad zero-shot match can be dismissed individually.
#[tauri::command]
pub fn remove_auto_tag(
    id: String,
    tag: String,
    db: State<'_, DbState>,
) -> Result<MediaItem, String> {
    let conn = db.0.lock().unwrap();
    let item = db::fetch_one(&conn, &id).map_err(|e| e.to_string())?;
    let remaining: Vec<String> = item.auto_tags.into_iter().filter(|t| t != &tag).collect();
    db::set_auto_tags(&conn, &id, &remaining).map_err(|e| e.to_string())?;
    db::fetch_one(&conn, &id).map_err(|e| e.to_string())
}

/// If the multilingual model is already loaded, spawn a background embed-all pass.
/// Called after every import so newly added items get indexed without user action.
pub(crate) fn trigger_embed_if_ready(app: &tauri::AppHandle) {
    let clip = app.state::<ClipState>();
    let ready = clip.0.lock().unwrap().multilingual.is_some();
    if ready {
        let app2 = app.clone();
        std::thread::spawn(move || { let _ = start_embed_all(app2); });
    }
}

/// Fire-and-forget: embed all unindexed images/videos; emits "clip-progress" events.
/// Items are already sorted by file_size ASC in the DB query (small files first).
/// Missing files are skipped rather than erroring. The in-memory embedding index
/// is refreshed in one shot at the end of the run.
#[tauri::command]
pub fn start_embed_all(app: tauri::AppHandle) -> Result<(), String> {
    // Only one full pass at a time — see EMBED_SCAN_RUNNING's doc comment.
    // A no-op return here is safe: whatever triggered this call (an import,
    // the model finishing load, etc.) added items that the currently-running
    // pass will either already include or that a later trigger will catch.
    if EMBED_SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    std::thread::spawn(move || {
        let _guard = EmbedScanGuard;
        let db   = app.state::<DbState>();
        let clip = app.state::<ClipState>();

        let items = {
            let conn = db.0.lock().unwrap();
            db::get_items_without_embeddings(&conn).unwrap_or_default()
        };
        let total = items.len();
        if total == 0 {
            let _ = app.emit("clip-progress", ClipProgress {
                current: 0, total: 0, item_id: String::new(),
                file_name: String::new(), auto_tags: vec![], done: true,
            });
            return;
        }

        for (i, (id, path, media_type, _size)) in items.iter().enumerate() {
            let p = std::path::Path::new(path);
            let done = i + 1 == total;

            // Skip files that no longer exist on disk — still emit progress (with no
            // tags) so a missing file never swallows the final "done" event and
            // leaves the UI stuck on "indexing…" forever.
            if !p.exists() {
                tracing::warn!(id, %path, "File missing, skipping embed");
                let _ = app.emit("clip-progress", ClipProgress {
                    current: i + 1, total, item_id: id.clone(),
                    file_name: String::new(), auto_tags: vec![], done,
                });
                continue;
            }

            let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();

            // If the model became unavailable mid-run (e.g. unloaded from Settings),
            // stop but still emit a "done" event — an indefinite silent stop is worse
            // than reporting an early, partial finish.
            let Some(ml) = multilingual_model(&clip) else {
                tracing::warn!("Multilingual model unavailable, stopping embed-all early");
                let _ = app.emit("clip-progress", ClipProgress {
                    current: i, total, item_id: String::new(),
                    file_name: String::new(), auto_tags: vec![], done: true,
                });
                break;
            };

            let result = {
                let emb_result = if media_type == "video" { ml.embed_video_keyframe(&app, p) }
                                 else { ml.embed_image(p) };
                emb_result.map(|emb| {
                    let tags  = ml.auto_tag(&emb);
                    let bytes = embedding_to_bytes(&emb);
                    (bytes, tags)
                })
            };

            let auto_tags = match result {
                Ok((bytes, tags)) => {
                    let conn = db.0.lock().unwrap();
                    let _ = db::set_embedding(&conn, id, &bytes, &tags);
                    tags
                }
                Err(e) => {
                    tracing::error!(id, error = %e, "CLIP embed failed");
                    vec![]
                }
            };

            let _ = app.emit("clip-progress", ClipProgress {
                current: i + 1,
                total,
                item_id: id.clone(),
                file_name,
                auto_tags,
                done,
            });
        }

        // Reload the full embedding index from DB once at the end so searches
        // immediately reflect all newly embedded items.
        let raw = {
            let conn = db.0.lock().unwrap();
            db::get_all_embeddings(&conn).unwrap_or_default()
        };
        let new_index = EmbIndex::from_pairs(
            raw.into_iter()
                .map(|(id, bytes)| (id, bytes_to_embedding(&bytes)))
                .collect(),
        );
        tracing::info!(count = new_index.len(), "Embedding index refreshed after embed-all");
        let mut g = clip.0.lock().unwrap();
        g.emb_index = Arc::new(RwLock::new(new_index));
    });
    Ok(())
}

/// Semantic text search — async so the webview stays responsive.
/// Uses the in-memory embedding index; no SQLite reads at query time.
#[tauri::command]
pub async fn semantic_search(
    query: String,
    limit: usize,
    db:   State<'_, DbState>,
    clip: State<'_, ClipState>,
) -> Result<Vec<SemanticResult>, String> {
    let (multilingual, emb_index) = {
        let g = clip.0.lock().unwrap();
        let ml = g.multilingual.clone().ok_or_else(|| "No AI model loaded".to_string())?;
        (ml, Arc::clone(&g.emb_index))
    };

    let scored = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<(f32, String)>, String> {
        let query_emb = multilingual.embed_text(&query).map_err(|e| e.to_string())?;
        let idx = emb_index.read().unwrap();
        let mut scored: Vec<(f32, String)> = idx
            .iter()
            .map(|(id, emb)| (cosine_sim(&query_emb, emb), id.to_string()))
            .collect();
        // Drop weak matches before truncating — better to return fewer,
        // genuinely relevant results than to pad out to `limit`.
        scored.retain(|(score, _)| *score > SEMANTIC_SEARCH_THRESHOLD);
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    })
    .await
    .map_err(|e| e.to_string())??;

    let conn = db.0.lock().unwrap();
    Ok(fetch_items_batch(&conn, scored))
}

/// Return the names of all available mood filters.
#[tauri::command]
pub fn get_mood_names() -> Vec<String> {
    MOOD_VOCAB.iter().map(|(name, _)| name.to_string()).collect()
}

/// Score every indexed item against a mood and return sorted results.
/// Async to keep the UI responsive; uses the in-memory embedding index.
#[tauri::command]
pub async fn mood_filter(
    mood:  String,
    limit: usize,
    db:    State<'_, DbState>,
    clip:  State<'_, ClipState>,
) -> Result<Vec<SemanticResult>, String> {
    let mood_idx = MOOD_VOCAB
        .iter()
        .position(|(name, _)| *name == mood.as_str())
        .ok_or_else(|| format!("Unknown mood: {mood}"))?;

    let (multilingual, emb_index) = {
        let g = clip.0.lock().unwrap();
        let ml = g.multilingual.clone().ok_or_else(|| "No AI model loaded".to_string())?;
        (ml, Arc::clone(&g.emb_index))
    };

    let scored = tauri::async_runtime::spawn_blocking(move || {
        let idx = emb_index.read().unwrap();
        let mut scored: Vec<(f32, String)> = idx
            .iter()
            .map(|(id, emb)| (multilingual.score_moods(emb)[mood_idx].1, id.to_string()))
            .collect();
        // Drop weak matches before truncating — better to return fewer,
        // genuinely mood-matching items than to pad out to `limit`.
        scored.retain(|(score, _)| *score > MOOD_FILTER_THRESHOLD);
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit.max(1));
        scored
    })
    .await
    .map_err(|e| e.to_string())?;

    let conn = db.0.lock().unwrap();
    Ok(fetch_items_batch(&conn, scored))
}

/// Find items visually similar to a given item (by stored embedding).
/// Uses the in-memory index when available; falls back to DB otherwise.
#[tauri::command]
pub fn find_similar(
    item_id: String,
    limit:   usize,
    db:      State<'_, DbState>,
    clip:    State<'_, ClipState>,
) -> Result<Vec<SemanticResult>, String> {
    let emb_index = Arc::clone(&clip.0.lock().unwrap().emb_index);
    let idx = emb_index.read().unwrap();

    // Look up the query embedding in the cache first; fall back to DB.
    let query_emb: Vec<f32> = if let Some(emb) = idx.get(&item_id) {
        emb.to_vec()
    } else {
        let conn = db.0.lock().unwrap();
        let bytes = db::get_embedding(&conn, &item_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Item {item_id} has no embedding. Index the library first."))?;
        bytes_to_embedding(&bytes)
    };

    let mut scored: Vec<(f32, String)> = if !idx.is_empty() {
        idx.iter()
            .filter(|(id, _)| *id != item_id)
            .map(|(id, emb)| (cosine_sim(&query_emb, emb), id.to_string()))
            .collect()
    } else {
        let conn = db.0.lock().unwrap();
        db::get_all_embeddings(&conn).map_err(|e| e.to_string())?
            .into_iter()
            .filter(|(id, _)| id != &item_id)
            .map(|(id, bytes)| (cosine_sim(&query_emb, &bytes_to_embedding(&bytes)), id))
            .collect()
    };
    drop(idx);

    // Drop weak matches before truncating — better to return fewer, genuinely
    // similar items than to pad out to `limit` with unrelated ones.
    scored.retain(|(score, _)| *score > FIND_SIMILAR_THRESHOLD);
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit.max(1));

    let conn = db.0.lock().unwrap();
    Ok(fetch_items_batch(&conn, scored))
}


