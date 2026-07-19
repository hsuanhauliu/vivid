// Sorting helpers for the media library. Pure functions — no React, no I/O —
// extracted from App so the comparison logic can be reasoned about in isolation.

// Prefer capture time (EXIF date_taken) over library import time. Used by both
// sorting and the date filters so "by date" consistently means when the photo
// was taken, not when it was added to Vivid.
export function captureDate(item) {
  return item.date_taken || item.created_at;
}

// When the file was imported into Vivid — distinct from captureDate, which
// prefers EXIF capture time. Always populated (row-creation timestamp).
export function addedDate(item) {
  return item.created_at;
}

// Reused across all name sorts — far cheaper than per-pair String.localeCompare,
// and `numeric` gives natural ordering (IMG_2 before IMG_10).
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Schwartzian transform: compute each sort key once (O(n)) instead of inside the
// comparator (O(n log n)). ISO date strings compare correctly with plain </>.
function sortByKey(items, keyOf, cmp) {
  return items
    .map((item) => ({ item, key: keyOf(item) }))
    .sort((a, b) => cmp(a.key, b.key))
    .map((d) => d.item);
}

export function sortItems(items, sortBy) {
  const arr = [...items];
  switch (sortBy) {
    case 'manual':
      return arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    case 'date-asc':
      return sortByKey(arr, captureDate, (x, y) => (x < y ? -1 : x > y ? 1 : 0));
    case 'date-desc':
      return sortByKey(arr, captureDate, (x, y) => (x < y ? 1 : x > y ? -1 : 0));
    case 'added-asc':
      return sortByKey(arr, addedDate, (x, y) => (x < y ? -1 : x > y ? 1 : 0));
    case 'added-desc':
      return sortByKey(arr, addedDate, (x, y) => (x < y ? 1 : x > y ? -1 : 0));
    case 'name-asc':
      return sortByKey(
        arr,
        (i) => i.display_name,
        (x, y) => nameCollator.compare(x, y),
      );
    case 'name-desc':
      return sortByKey(
        arr,
        (i) => i.display_name,
        (x, y) => nameCollator.compare(y, x),
      );
    case 'size-asc':
      return arr.sort((a, b) => a.file_size - b.file_size);
    case 'size-desc':
      return arr.sort((a, b) => b.file_size - a.file_size);
    default:
      return arr;
  }
}

export const SORT_OPTIONS = [
  { value: 'date-desc', labelKey: 'sort.dateNewest' },
  { value: 'date-asc', labelKey: 'sort.dateOldest' },
  { value: 'added-desc', labelKey: 'sort.addedNewest' },
  { value: 'added-asc', labelKey: 'sort.addedOldest' },
  { value: 'name-asc', labelKey: 'sort.nameAz' },
  { value: 'name-desc', labelKey: 'sort.nameZa' },
  { value: 'size-desc', labelKey: 'sort.sizeDesc' },
  { value: 'size-asc', labelKey: 'sort.sizeAsc' },
  { value: 'manual', labelKey: 'sort.manual' },
];

// Collections (albums/playlists/groups) only have a name and a created-at
// timestamp — no file size or "date added vs. date taken" distinction — so
// pages that sort collections (e.g. the album group page) pass this reduced
// set into <SortDropdown options={...}> instead of the full media SORT_OPTIONS.
export const COLLECTION_SORT_OPTIONS = [
  { value: 'name-asc', labelKey: 'sort.nameAz' },
  { value: 'name-desc', labelKey: 'sort.nameZa' },
  { value: 'date-desc', labelKey: 'sort.dateNewest' },
  { value: 'date-asc', labelKey: 'sort.dateOldest' },
];
