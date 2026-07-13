//! Centralized, hand-tunable thresholds for the AI/embedding-similarity
//! features (auto-tagging, semantic search, mood filter, find-similar).
//! These are plain `const`s — change a value and rebuild to take effect.
//!
//! Two different embedding comparisons are in play here, and they sit on
//! very different numeric scales:
//! - **Text vs. image** (auto-tag, semantic search, mood filter): a text
//!   prompt embedding compared against an image embedding, both from the
//!   same SigLIP multilingual model. Calibrated against 4 real photos with
//!   unambiguous content (beach, food, dog, car), cross-checked byte-for-byte
//!   against the official HF/PyTorch implementation to rule out an
//!   implementation bug before tuning anything: the correct top-1 match
//!   scored 0.066-0.078 in every case, with genuinely-unrelated matches
//!   usually below 0.02-0.03 (a few plausibly-related secondary matches —
//!   e.g. "cooking"/"cafe" for a burger photo — legitimately scored in the
//!   0.02-0.05 range too, which is fine, they're not wrong). Small sample
//!   size (4 images, 1 per category) — revisit if real usage shows it's off.
//! - **Image vs. image** (find-similar): two image embeddings compared
//!   directly. Not from the same calibration run as the text-vs-image
//!   numbers above, so treat as a reasonable starting default rather than an
//!   empirically verified one — revisit if it over/under-filters in
//!   practice.
//!
//! All comparisons are `cosine_sim` (`crate::clip::cosine_sim`) — a plain dot
//! product, since every embedding stored/produced by this app is already
//! L2-normalized.

/// Minimum cosine similarity for an auto-suggested tag to be shown.
/// 0.035 sits comfortably below every real top-1 match and above most
/// unrelated noise (see module doc for the calibration behind this).
pub const AUTO_TAG_THRESHOLD: f32 = 0.035;

/// Max number of auto-tags suggested per item.
pub const AUTO_TAG_MAX: usize = 5;

/// Minimum text-query-to-image cosine similarity for a semantic search
/// result to be included, rather than padding out to the requested `limit`
/// with increasingly irrelevant matches. Same model/embedding space as
/// `AUTO_TAG_THRESHOLD` (text vs. image), so given the same default.
pub const SEMANTIC_SEARCH_THRESHOLD: f32 = 0.035;

/// Minimum mood-prompt-to-image cosine similarity for `mood_filter` to
/// include an item. Same reasoning/scale as `SEMANTIC_SEARCH_THRESHOLD`.
pub const MOOD_FILTER_THRESHOLD: f32 = 0.035;

/// Minimum image-to-image cosine similarity for `find_similar` to include an
/// item as "similar" to the clicked one. Without this, `find_similar`
/// degenerates into "rank the whole library and take the top `limit`" —
/// for any library with fewer embedded items than `limit`, that returns
/// literally everything.
pub const FIND_SIMILAR_THRESHOLD: f32 = 0.8;
