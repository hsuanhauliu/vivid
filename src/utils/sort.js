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

// Missing-last comparator for the "date" sort specifically: items without a
// captured date (screenshots, stripped EXIF, etc.) always sort to the end
// regardless of direction, rather than routing through captureDate()'s `||`
// fallback and getting chronologically interleaved by import time — which
// looks like a wrong capture date rather than an absent one. captureDate()
// itself is untouched (still used by FilterBar's date-range filter, where
// falling back to added-date is the right call — a range filter needs some
// date to test, unlike a sort where interleaving reads as wrong data).
function compareDateMissingLast(x, y, ascending) {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  if (x === y) return 0;
  const xFirst = ascending ? x < y : x > y;
  return xFirst ? -1 : 1;
}

export function sortItems(items, sortBy) {
  const arr = [...items];
  switch (sortBy) {
    case 'manual':
      return arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    case 'date-asc':
    case 'date-desc': {
      const ascending = sortBy === 'date-asc';
      // Two stable passes: sort by added-date (oldest-added first, fixed
      // regardless of asc/desc) so undated items — all tied at the "missing"
      // end — land in a sensible relative order instead of arbitrary array
      // order, then sort by captured-date. Array.prototype.sort's stability
      // means the added-date order survives as the tiebreaker within that group.
      const byAdded = sortByKey(arr, addedDate, (x, y) => (x < y ? -1 : x > y ? 1 : 0));
      return sortByKey(
        byAdded,
        (i) => i.date_taken || null,
        (x, y) => compareDateMissingLast(x, y, ascending),
      );
    }
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

// "Date" sorts by captured date, with undated items pushed to the end and
// tie-broken by added date (see sortItems) — no separate "Added" sort is
// needed on top of that anymore.
export const SORT_OPTIONS = [
  { value: 'date-desc', labelKey: 'sort.dateNewest' },
  { value: 'date-asc', labelKey: 'sort.dateOldest' },
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
