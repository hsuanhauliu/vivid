use anyhow::{anyhow, Result};
use candle_core::{Device, Tensor, D};
use std::path::Path;

// ── Tag vocabulary (auto-tagging) ─────────────────────────────────────────────

pub const TAG_VOCAB: &[&str] = &[
    // Landscapes & nature
    "mountain", "ocean", "beach", "forest", "river", "lake", "desert",
    "waterfall", "canyon", "valley", "field", "cliff",
    // Sky / weather
    "sunset", "sunrise", "clouds", "night sky", "fog", "snow", "rain",
    // Flora
    "flowers", "trees", "grass", "garden", "leaves",
    // Fauna
    "dog", "cat", "bird", "horse", "wildlife", "fish",
    // People
    "portrait", "group of people", "children", "family",
    "wedding", "selfie", "crowd",
    // Urban & architecture
    "city skyline", "street", "building", "bridge", "interior",
    "cafe", "market", "church", "skyscraper",
    // Transport
    "car", "airplane", "boat", "train",
    // Food & drink
    "food", "coffee", "drink", "cooking", "restaurant",
    // Activities
    "sports", "hiking", "swimming", "cycling", "yoga",
    "music performance", "art", "reading",
    // Objects
    "technology", "fashion", "furniture",
    // Lighting / mood
    "golden hour", "neon lights", "candlelight",
    // Style
    "black and white", "minimalist", "colorful", "vintage", "abstract",
    // Scene type
    "landscape", "aerial view", "macro photography", "studio photo",
    "underwater", "space",
    // Scene classification labels
    "indoor scene", "outdoor scene", "urban scene", "nature scene",
];

// ── Mood vocabulary (vibe filter) ─────────────────────────────────────────────
// Each entry: (display_name, embedding_prompt)

pub const MOOD_VOCAB: &[(&str, &str)] = &[
    ("Calm",         "a peaceful, serene, tranquil photograph with soft light and gentle atmosphere"),
    ("Energetic",    "a dynamic, exciting, high-energy action photograph with vibrant motion"),
    ("Romantic",     "a warm, intimate, romantic photograph with soft bokeh and golden tones"),
    ("Melancholic",  "a moody, melancholic, nostalgic photograph with muted tones and solitude"),
    ("Cozy",         "a cozy, warm, homely photograph indoors with comfort and soft lighting"),
    ("Adventurous",  "an adventurous outdoor photograph in wild nature with dramatic scenery"),
    ("Elegant",      "an elegant, sophisticated, luxurious photograph with refined composition"),
    ("Playful",      "a fun, playful, joyful photograph with bright colors and happy subjects"),
    ("Dramatic",     "a dramatic, intense, cinematic photograph with strong contrast and shadows"),
    ("Minimalist",   "a minimalist, clean, simple photograph with negative space and few elements"),
];

// ── Utilities (public) ────────────────────────────────────────────────────────

/// Dot product of two L2-normalised vectors = cosine similarity.
pub fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// Serialise a Vec<f32> embedding to raw little-endian bytes for SQLite BLOB storage.
pub fn embedding_to_bytes(emb: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(emb.len() * 4);
    for f in emb { out.extend_from_slice(&f.to_le_bytes()); }
    out
}

/// Deserialise raw bytes back to Vec<f32>.
pub fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// ── Private helpers ───────────────────────────────────────────────────────────

pub(crate) fn best_device() -> Device {
    // layer-norm is not implemented in the candle Metal backend; use CPU.
    Device::Cpu
}

/// L2-normalise a [1, D] tensor and extract as Vec<f32>.
pub(crate) fn to_normed_vec(t: Tensor) -> Result<Vec<f32>> {
    let norm = t.sqr()?.sum_keepdim(D::Minus1)?.sqrt()?;
    let normed = t.broadcast_div(&norm)?;
    Ok(normed.squeeze(0)?.to_vec1::<f32>()?)
}

/// If `path` is HEIC/HEIF, convert it to a temp JPEG via `sips` and return the
/// temp path. Returns `None` for every other format (no conversion needed).
pub(crate) fn heif_to_jpeg_if_needed(path: &Path) -> Result<Option<std::path::PathBuf>> {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext != "heic" && ext != "heif" {
        return Ok(None);
    }
    Ok(Some(sips_to_jpeg(path)?))
}

/// Convert any image file to a temp JPEG via macOS `sips`.
pub(crate) fn sips_to_jpeg(path: &Path) -> Result<std::path::PathBuf> {
    let tmp = std::env::temp_dir().join(format!("vivid_sips_{}.jpg", uuid::Uuid::new_v4()));
    let status = std::process::Command::new("sips")
        .args([
            "-s", "format", "jpeg",
            "--out", tmp.to_str().ok_or_else(|| anyhow!("non-UTF8 tmp path"))?,
            path.to_str().ok_or_else(|| anyhow!("non-UTF8 path"))?,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| anyhow!("sips not available: {e}"))?;

    if !status.success() || !tmp.exists() {
        return Err(anyhow!("sips failed to convert {:?}", path));
    }
    Ok(tmp)
}

/// Read the EXIF orientation tag (1–8). Defaults to 1 (no transform) when the
/// file has no EXIF or can't be read.
pub(crate) fn exif_orientation(path: &Path) -> u32 {
    let file = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return 1 };
    let mut buf = std::io::BufReader::new(file);
    match exif::Reader::new().read_from_container(&mut buf) {
        Ok(e) => e
            .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0))
            .unwrap_or(1),
        Err(_) => 1,
    }
}

/// Rotate/flip a decoded image to match its EXIF orientation. `rotate90` is
/// clockwise; values 5/7 combine a rotation with a horizontal flip.
///
/// The `image` crate never applies this itself — every caller that decodes a
/// file for pixel-level work (thumbnails, the image editor's transforms) must
/// call this or its output silently disagrees with however the file displays
/// in a browser/OS viewer, which auto-rotates per this same tag. That gap is
/// exactly what caused the image editor's crop/rotate/flip to save from the
/// wrong pixel orientation despite looking right in the on-screen preview.
pub(crate) fn apply_exif_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_sim_identical_unit_vector() {
        let v = vec![1.0f32, 0.0, 0.0];
        assert!((cosine_sim(&v, &v) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_sim_orthogonal() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![0.0f32, 1.0, 0.0];
        assert!(cosine_sim(&a, &b).abs() < 1e-6);
    }

    #[test]
    fn cosine_sim_opposite() {
        let a = vec![1.0f32, 0.0, 0.0];
        let b = vec![-1.0f32, 0.0, 0.0];
        assert!((cosine_sim(&a, &b) - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn cosine_sim_diagonal() {
        // Two identical 45-degree vectors: [0.707, 0.707] · [0.707, 0.707] ≈ 1.0
        let v = vec![0.70710678f32, 0.70710678];
        assert!((cosine_sim(&v, &v) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn embedding_bytes_roundtrip() {
        let original = vec![1.0f32, -0.5, 3.14159, 0.0, f32::MAX, f32::MIN_POSITIVE];
        let bytes = embedding_to_bytes(&original);
        let recovered = bytes_to_embedding(&bytes);
        assert_eq!(original.len(), recovered.len());
        for (a, b) in original.iter().zip(recovered.iter()) {
            assert!((a - b).abs() < 1e-10, "mismatch: {a} != {b}");
        }
    }

    #[test]
    fn embedding_bytes_length() {
        let emb = vec![0.0f32; 512]; // CLIP produces 512-dim embeddings
        let bytes = embedding_to_bytes(&emb);
        assert_eq!(bytes.len(), 512 * 4); // 4 bytes per f32
        let recovered = bytes_to_embedding(&bytes);
        assert_eq!(recovered.len(), 512);
    }

    #[test]
    fn empty_embedding_roundtrip() {
        let emb: Vec<f32> = vec![];
        let bytes = embedding_to_bytes(&emb);
        assert!(bytes.is_empty());
        let recovered = bytes_to_embedding(&bytes);
        assert!(recovered.is_empty());
    }

    // ── EXIF orientation ────────────────────────────────────────────────────

    use image::{DynamicImage, GenericImageView, Rgb, RgbImage};

    // 3 wide × 2 tall, every pixel a distinct gray so transforms are observable.
    fn sample() -> DynamicImage {
        let mut img = RgbImage::new(3, 2);
        let mut v = 0u8;
        for y in 0..2 {
            for x in 0..3 {
                img.put_pixel(x, y, Rgb([v, v, v]));
                v += 10;
            }
        }
        DynamicImage::ImageRgb8(img)
    }

    #[test]
    fn identity_for_normal_and_unknown_orientation() {
        let img = sample();
        for o in [1u32, 0, 99] {
            let out = apply_exif_orientation(img.clone(), o);
            assert_eq!((out.width(), out.height()), (3, 2), "orientation {o}");
        }
    }

    #[test]
    fn quarter_turns_swap_dimensions() {
        let img = sample();
        for o in [5u32, 6, 7, 8] {
            let out = apply_exif_orientation(img.clone(), o);
            assert_eq!((out.width(), out.height()), (2, 3), "orientation {o}");
        }
    }

    #[test]
    fn flips_and_half_turn_preserve_dimensions() {
        let img = sample();
        for o in [2u32, 3, 4] {
            let out = apply_exif_orientation(img.clone(), o);
            assert_eq!((out.width(), out.height()), (3, 2), "orientation {o}");
        }
    }

    #[test]
    fn horizontal_flip_mirrors_columns() {
        let orig = sample().to_rgb8();
        let out = apply_exif_orientation(sample(), 2).to_rgb8();
        assert_eq!(out.get_pixel(0, 0), orig.get_pixel(2, 0));
        assert_eq!(out.get_pixel(2, 0), orig.get_pixel(0, 0));
    }

    #[test]
    fn rotate180_sends_top_left_to_bottom_right() {
        let orig = sample().to_rgb8();
        let out = apply_exif_orientation(sample(), 3).to_rgb8();
        assert_eq!(out.get_pixel(0, 0), orig.get_pixel(2, 1));
    }
}

/// Extract a single poster frame from a video file to a temp JPEG via the
/// Swift helper (AVFoundation — no ffmpeg). The helper tries 5s first, falls
/// back to 0s if the video is shorter.
pub(crate) fn extract_video_frame(
    app: &tauri::AppHandle,
    video_path: &Path,
) -> Result<std::path::PathBuf> {
    let tmp_path = std::env::temp_dir().join(format!("vivid_frame_{}.jpg", uuid::Uuid::new_v4()));
    let helper = crate::commands::helper_path(app);
    let out = std::process::Command::new(&helper)
        .arg("frame")
        .arg(video_path)
        .arg(&tmp_path)
        .output()
        .map_err(|e| anyhow!("failed to run vivid-helper: {e}"))?;
    if !out.status.success() || !tmp_path.exists() {
        return Err(anyhow!(
            "vivid-helper could not extract a frame from {:?}: {}",
            video_path,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(tmp_path)
}

/// Extract embedded cover art (album art) from an audio file to a temp image.
/// Returns `Ok(None)` when the file has no artwork.
pub(crate) fn extract_audio_cover(
    app: &tauri::AppHandle,
    audio_path: &Path,
) -> Result<Option<std::path::PathBuf>> {
    // Primary path: read the embedded picture straight out of the file's tags
    // via lofty (already a dependency). This covers the overwhelmingly common
    // case — MP3 APIC, FLAC/Vorbis pictures, M4A cover atoms.
    if let Some(p) = cover_via_lofty(audio_path)? {
        return Ok(Some(p));
    }
    // Fallback: the rare container where the artwork is only present as an
    // embedded video/picture track lofty can't surface, via AVFoundation.
    // Silently skipped (`Ok(None)`) if the helper finds nothing — never fatal.
    let tmp_path = std::env::temp_dir().join(format!("vivid_cover_{}.jpg", uuid::Uuid::new_v4()));
    let helper = crate::commands::helper_path(app);
    let out = std::process::Command::new(&helper)
        .arg("audiocover")
        .arg(audio_path)
        .arg(&tmp_path)
        .output();
    match out {
        Ok(o) if o.status.success() && tmp_path.exists() => Ok(Some(tmp_path)),
        _ => Ok(None),
    }
}

/// Pull the first embedded picture from the file's tags using lofty (no ffmpeg).
fn cover_via_lofty(audio_path: &Path) -> Result<Option<std::path::PathBuf>> {
    use lofty::prelude::*;
    use lofty::probe::Probe;

    let tagged = match Probe::open(audio_path).and_then(|p| p.read()) {
        Ok(t) => t,
        Err(_) => return Ok(None), // unreadable/unsupported — not fatal
    };
    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return Ok(None);
    };
    let Some(pic) = tag.pictures().first() else {
        return Ok(None);
    };
    let data = pic.data();
    if data.is_empty() {
        return Ok(None);
    }
    // The decoder downstream guesses format from the bytes, so the extension is
    // cosmetic — write the raw picture data as-is (JPEG, PNG, etc.).
    let tmp = std::env::temp_dir().join(format!("vivid_cover_{}.img", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, data).map_err(|e| anyhow!("write cover: {e}"))?;
    Ok(Some(tmp))
}

