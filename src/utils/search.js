// Text-search predicate for the top-bar search box — shared by the library
// view and World Map view so "search bar doesn't work in map view" can't
// happen again from the two filters drifting apart. Pure function, no React.

/**
 * @param {object} item - a MediaItem
 * @param {string} q - already-trimmed, lowercased query (empty string matches everything)
 * @param {{name?: boolean, description?: boolean, ocr?: boolean, tags?: boolean}} searchScope
 */
export function matchesSearch(item, q, searchScope) {
  if (!q) return true;
  return Boolean(
    (searchScope.name &&
      (item.display_name.toLowerCase().includes(q) || item.file_name.toLowerCase().includes(q))) ||
    (searchScope.description && item.description?.toLowerCase().includes(q)) ||
    (searchScope.ocr && item.ocr_text?.toLowerCase().includes(q)) ||
    (searchScope.tags &&
      (item.tags?.some((t) => t.includes(q)) || item.auto_tags?.some((t) => t.includes(q)))),
  );
}
