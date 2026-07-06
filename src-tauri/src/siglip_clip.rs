/// SigLIP (multilingual) — `google/siglip-base-patch16-256-multilingual`.
///
/// Replaces the earlier M-CLIP (XLM-RoBERTa-large text + CLIP ViT-L/14@336
/// vision) setup. Two things motivated the swap:
///   1. SigLIP's sigmoid loss consistently benchmarks above CLIP's softmax
///      contrastive loss for zero-shot classification/retrieval.
///   2. This checkpoint ships as a single `model.safetensors` file, loaded via
///      candle's native `VarBuilder::from_mmaped_safetensors` — no more
///      hand-written PyTorch `.bin` pickle parsing (the two separate
///      candle-core loader bugs that corrupted the M-CLIP vision tower for
///      weeks straight can't recur here, since this format was never at
///      risk from them).
///
/// Files (single repo, all three required):
///   • `config.json`       — feeds directly into `candle_transformers`'s own
///                           `siglip::Config` (its fields are `#[serde(default)]`,
///                           so this repo's minimal override-only JSON works
///                           as-is).
///   • `model.safetensors` — combined text + vision weights (~1.48 GB).
///   • `tokenizer.json`    — fast tokenizer (multilingual SentencePiece,
///                           250k vocab), loaded the same way as before.
///
/// Text pipeline:  tokens (padded/truncated to 64) → SigLIP text transformer
///                 → last-position pooling (built into the model) → L2-normalize
/// Image pipeline: pixels (256×256, [-1,1] normalized) → SigLIP vision transformer
///                 → attention-pooling head (built into the model) → L2-normalize
///
/// NOTE: SigLIP's own logit_scale/logit_bias only apply to `Model::forward`'s
/// joint image×text logits, which this module doesn't use (it computes
/// embeddings for each side independently, then cosine-similarities them
/// itself). Raw cosine scores here run much lower than the old M-CLIP setup's
/// did — genuinely-correct top matches land around 0.06-0.08, clearly-wrong
/// tags mostly sit below 0.02 (see `AUTO_TAG_THRESHOLD` in `crate::clip`,
/// calibrated against real photos + a byte-for-byte cross-check against the
/// official HF/PyTorch implementation).
use anyhow::{anyhow, Result};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::siglip::{Config, Model};
use std::path::Path;
use tokenizers::Tokenizer;

use crate::clip::{
    best_device, cosine_sim, extract_video_frame, heif_to_jpeg_if_needed, sips_to_jpeg,
    to_normed_vec, AUTO_TAG_MAX, AUTO_TAG_THRESHOLD, MOOD_VOCAB, SCENE_VOCAB, TAG_VOCAB,
};

const IMAGE_SIZE: usize = 256;
const SIGLIP_MEAN: f32 = 0.5;
const SIGLIP_STD: f32 = 0.5;
const MAX_TOKENS: usize = 64; // SigLIP always pads/truncates to a fixed 64-token sequence
const PAD_TOKEN_ID: u32 = 1; // `</s>`, doubles as pad and eos in this tokenizer

pub struct SiglipClip {
    model: Model,
    tokenizer: Tokenizer,
    tag_embeddings: Vec<Vec<f32>>,
    mood_embeddings: Vec<Vec<f32>>,
    scene_embeddings: Vec<Vec<f32>>,
    device: Device,
}

impl SiglipClip {
    /// Load from a directory containing `config.json`, `model.safetensors`,
    /// and `tokenizer.json`.
    pub fn load(model_dir: &Path) -> Result<Self> {
        let device = best_device();

        for f in &["config.json", "model.safetensors", "tokenizer.json"] {
            let p = model_dir.join(f);
            if !p.exists() {
                return Err(anyhow!(
                    "SigLIP missing file: {:?}. Use Settings → AI to re-download.",
                    p
                ));
            }
        }

        let config_json = std::fs::read_to_string(model_dir.join("config.json"))?;
        let config: Config = serde_json::from_str(&config_json)
            .map_err(|e| anyhow!("Invalid SigLIP config.json: {e}"))?;

        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(
                &[model_dir.join("model.safetensors")],
                DType::F32,
                &device,
            )?
        };
        let model = Model::new(&config, vb)?;

        let tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(|e| anyhow!("Tokenizer load failed: {e}"))?;

        let mut result = Self {
            model,
            tokenizer,
            tag_embeddings: Vec::new(),
            mood_embeddings: Vec::new(),
            scene_embeddings: Vec::new(),
            device,
        };

        result.tag_embeddings = result.compute_tag_embeddings()?;
        result.mood_embeddings = result.compute_mood_embeddings()?;
        result.scene_embeddings = result.compute_scene_embeddings()?;

        tracing::info!(path = ?model_dir, "SigLIP (multilingual) loaded");
        Ok(result)
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Encode text → L2-normalised embedding.
    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>> {
        let enc = self.tokenizer.encode(text, true).map_err(|e| anyhow!("{e}"))?;
        let mut ids: Vec<u32> = enc.get_ids().to_vec();
        ids.truncate(MAX_TOKENS);
        ids.resize(MAX_TOKENS, PAD_TOKEN_ID);

        let ids_t = Tensor::new(ids.as_slice(), &self.device)?.unsqueeze(0)?; // [1, 64]
        let feat = self.model.get_text_features(&ids_t)?; // [1, hidden]
        to_normed_vec(feat)
    }

    /// Encode an image file → L2-normalised embedding.
    pub fn embed_image(&self, path: &Path) -> Result<Vec<f32>> {
        let heic_path = heif_to_jpeg_if_needed(path)?;
        let open_path = heic_path.as_ref().map(|p| p.as_path()).unwrap_or(path);
        let img = match image::open(open_path) {
            Ok(img) => img,
            Err(_) if heic_path.is_none() => {
                let tmp = sips_to_jpeg(path)?;
                let loaded = image::open(&tmp).map_err(|e| anyhow!("Cannot open {:?}: {}", path, e));
                let _ = std::fs::remove_file(&tmp);
                loaded?
            }
            Err(e) => return Err(anyhow!("Cannot open {:?}: {}", path, e)),
        };
        if let Some(tmp) = heic_path {
            let _ = std::fs::remove_file(tmp);
        }
        self.embed_rgb8(
            &img.resize_exact(IMAGE_SIZE as u32, IMAGE_SIZE as u32, image::imageops::FilterType::CatmullRom)
                .to_rgb8(),
        )
    }

    /// Extract a video keyframe and embed it.
    pub fn embed_video_keyframe(&self, app: &tauri::AppHandle, path: &Path) -> Result<Vec<f32>> {
        let frame = extract_video_frame(app, path)?;
        let result = self.embed_image(&frame);
        let _ = std::fs::remove_file(&frame);
        result
    }

    /// Return auto-tags for an already-normalised image embedding.
    pub fn auto_tag(&self, emb: &[f32]) -> Vec<String> {
        let mut scored: Vec<(f32, &str)> = TAG_VOCAB
            .iter()
            .zip(&self.tag_embeddings)
            .map(|(tag, te)| (cosine_sim(emb, te), *tag))
            .filter(|(s, _)| *s >= AUTO_TAG_THRESHOLD)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(AUTO_TAG_MAX);
        scored.into_iter().map(|(_, t)| t.to_string()).collect()
    }

    /// For calibration only (see `examples/calibrate.rs`). Same scoring as
    /// `auto_tag` but returns every tag's raw score, unfiltered and
    /// untruncated, so a human can look at where "clearly right" and
    /// "clearly wrong" tags actually separate for a given photo.
    pub fn auto_tag_scores_debug(&self, emb: &[f32]) -> Vec<(f32, &str)> {
        let mut scored: Vec<(f32, &str)> = TAG_VOCAB
            .iter()
            .zip(&self.tag_embeddings)
            .map(|(tag, te)| (cosine_sim(emb, te), *tag))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
    }

    /// Score an embedding against every mood; returns (mood_name, score) sorted descending.
    pub fn score_moods(&self, emb: &[f32]) -> Vec<(String, f32)> {
        let mut scored: Vec<(String, f32)> = MOOD_VOCAB
            .iter()
            .zip(&self.mood_embeddings)
            .map(|((name, _), me)| (name.to_string(), cosine_sim(emb, me)))
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored
    }

    // ── Private ───────────────────────────────────────────────────────────────

    fn embed_rgb8(&self, img: &image::RgbImage) -> Result<Vec<f32>> {
        const HW: usize = IMAGE_SIZE * IMAGE_SIZE;
        let mut chw = vec![0f32; 3 * HW];
        for (y, row) in img.rows().enumerate() {
            let base = y * IMAGE_SIZE;
            for (x, px) in row.enumerate() {
                let pos = base + x;
                for c in 0..3usize {
                    chw[c * HW + pos] = (px[c] as f32 / 255.0 - SIGLIP_MEAN) / SIGLIP_STD;
                }
            }
        }
        let t = Tensor::from_vec(chw, (1usize, 3usize, IMAGE_SIZE, IMAGE_SIZE), &self.device)?;
        let feat = self.model.get_image_features(&t)?; // [1, hidden]
        to_normed_vec(feat)
    }

    fn compute_tag_embeddings(&self) -> Result<Vec<Vec<f32>>> {
        TAG_VOCAB.iter().map(|tag| self.embed_text(&format!("a photo of {tag}"))).collect()
    }
    fn compute_mood_embeddings(&self) -> Result<Vec<Vec<f32>>> {
        MOOD_VOCAB.iter().map(|(_, prompt)| self.embed_text(prompt)).collect()
    }
    fn compute_scene_embeddings(&self) -> Result<Vec<Vec<f32>>> {
        SCENE_VOCAB.iter().map(|scene| self.embed_text(&format!("a photo of {scene}"))).collect()
    }
}
