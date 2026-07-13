//! Calibration tool for `AUTO_TAG_THRESHOLD`/`AUTO_TAG_MAX` (config.rs) against
//! the SigLIP model. Not part of the app itself — run manually whenever you
//! want to sanity-check tag scoring against real photos.
//!
//! Usage:
//!   cargo run --example calibrate -- <model_dir> <image1> [image2] [image3] ...
//!
//! <model_dir> is the folder containing config.json / model.safetensors /
//! tokenizer.json — normally
//!   ~/Library/Application Support/com.vivid.app/models/clip-multilingual
//!
//! For each image, prints every tag in TAG_VOCAB sorted by score (highest
//! first), so you can eyeball where "clearly right" tags stop and "clearly
//! wrong" tags start for photos you already know the content of.

use std::path::Path;
use vivid_lib::siglip_clip::SiglipClip;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: {} <model_dir> <image1> [image2] ...", args[0]);
        std::process::exit(1);
    }
    let model_dir = Path::new(&args[1]);
    let image_paths = &args[2..];

    eprintln!("Loading SigLIP from {:?} ...", model_dir);
    let model = SiglipClip::load(model_dir).expect("failed to load SigLIP model");
    eprintln!("Loaded. Scoring {} image(s)...\n", image_paths.len());

    for path in image_paths {
        println!("=== {path} ===");
        let emb = match model.embed_image(Path::new(path)) {
            Ok(e) => e,
            Err(e) => {
                println!("  (failed to embed: {e})\n");
                continue;
            }
        };
        let scores = model.auto_tag_scores_debug(&emb);
        for (score, tag) in scores.iter().take(15) {
            println!("  {score:.4}  {tag}");
        }
        println!();
    }
}
