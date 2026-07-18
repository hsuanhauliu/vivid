//! In-memory embedding index with a flat, cache-friendly layout.
//!
//! Embeddings are stored contiguously in a single `Vec<f32>` (dim-strided)
//! rather than as a `Vec<Vec<f32>>`, so the cosine-similarity scan over the
//! whole library walks one contiguous buffer instead of chasing N separate heap
//! allocations. Ids live in a parallel `Vec<String>`, with a `HashMap` from id
//! to row index alongside it so lookups/upserts are O(1) instead of an O(n)
//! scan of `ids` — `from_pairs` calls `upsert` once per row, so without this
//! building the index from a large library would be O(n²).

use std::collections::HashMap;

/// All embeddings have the same dimensionality (CLIP produces 512-dim vectors).
#[derive(Clone, Default)]
pub struct EmbIndex {
    ids: Vec<String>,
    data: Vec<f32>, // flat: row i occupies data[i*dim .. (i+1)*dim]
    dim: usize,
    index: HashMap<String, usize>, // id -> row index into ids/data
}

impl EmbIndex {
    /// Build from `(id, embedding)` pairs. Rows whose length doesn't match the
    /// first row's dimensionality are skipped (defensive against corruption).
    pub fn from_pairs(pairs: Vec<(String, Vec<f32>)>) -> Self {
        let dim = pairs.first().map(|(_, e)| e.len()).unwrap_or(0);
        let mut idx = Self {
            ids: Vec::with_capacity(pairs.len()),
            data: Vec::with_capacity(pairs.len() * dim),
            dim,
            index: HashMap::with_capacity(pairs.len()),
        };
        for (id, emb) in pairs {
            idx.upsert(id, &emb);
        }
        idx
    }

    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Iterate over `(id, embedding)` rows.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &[f32])> {
        let (dim, data) = (self.dim, &self.data);
        self.ids
            .iter()
            .enumerate()
            .map(move |(i, id)| (id.as_str(), &data[i * dim..(i + 1) * dim]))
    }

    /// Look up a single embedding by id.
    pub fn get(&self, id: &str) -> Option<&[f32]> {
        let i = *self.index.get(id)?;
        Some(&self.data[i * self.dim..(i + 1) * self.dim])
    }

    /// Insert a new embedding or overwrite the existing one for `id`.
    pub fn upsert(&mut self, id: String, emb: &[f32]) {
        if self.dim == 0 {
            self.dim = emb.len();
        }
        if emb.len() != self.dim {
            return;
        }
        if let Some(&i) = self.index.get(&id) {
            self.data[i * self.dim..(i + 1) * self.dim].copy_from_slice(emb);
        } else {
            let i = self.ids.len();
            self.index.insert(id.clone(), i);
            self.ids.push(id);
            self.data.extend_from_slice(emb);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs() -> Vec<(String, Vec<f32>)> {
        vec![
            ("a".into(), vec![1.0, 0.0, 0.0]),
            ("b".into(), vec![0.0, 1.0, 0.0]),
            ("c".into(), vec![0.0, 0.0, 1.0]),
        ]
    }

    #[test]
    fn iter_matches_input_order_and_values() {
        let idx = EmbIndex::from_pairs(pairs());
        let collected: Vec<(String, Vec<f32>)> =
            idx.iter().map(|(id, e)| (id.to_string(), e.to_vec())).collect();
        assert_eq!(collected, pairs());
        assert_eq!(idx.len(), 3);
    }

    #[test]
    fn get_returns_the_right_row() {
        let idx = EmbIndex::from_pairs(pairs());
        assert_eq!(idx.get("b"), Some([0.0, 1.0, 0.0].as_slice()));
        assert_eq!(idx.get("missing"), None);
    }

    #[test]
    fn upsert_overwrites_existing_and_appends_new() {
        let mut idx = EmbIndex::from_pairs(pairs());
        idx.upsert("a".into(), &[9.0, 9.0, 9.0]); // overwrite
        idx.upsert("d".into(), &[2.0, 2.0, 2.0]); // append
        assert_eq!(idx.len(), 4);
        assert_eq!(idx.get("a"), Some([9.0, 9.0, 9.0].as_slice()));
        assert_eq!(idx.get("d"), Some([2.0, 2.0, 2.0].as_slice()));
    }

    #[test]
    fn skips_mismatched_dimensions() {
        let mut idx = EmbIndex::from_pairs(pairs());
        idx.upsert("bad".into(), &[1.0, 2.0]); // wrong dim — ignored
        assert_eq!(idx.len(), 3);
        assert_eq!(idx.get("bad"), None);
    }
}
