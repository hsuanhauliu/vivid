/**
 * Bucket items by year-month, sorted by month with items lacking a date
 * collected into an "Unknown" bucket that always sorts last regardless of
 * `order`.
 *
 * @param {Array} items
 * @param {'asc'|'desc'} order - month order; also reverses each bucket's own
 *   item order so 'asc' flips the whole timeline, not just the section order.
 * @param {'capture'|'added'} dateField - 'capture' buckets by `date_taken`
 *   (falling back to `created_at`), matching sort.js's captureDate(); 'added'
 *   buckets by `created_at` only, matching sort.js's addedDate(). Must match
 *   whichever date the caller's active sort is using, or month headers and
 *   the items inside them can disagree about order.
 * @returns {Array<{month: string, items: Array}>}
 */
export function groupByMonth(items, order = 'desc', dateField = 'capture') {
  const buckets = new Map();
  for (const item of items) {
    const date = dateField === 'added' ? item.created_at : item.date_taken || item.created_at;
    const key = date?.slice(0, 7) ?? 'Unknown';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const sorted = [...buckets.entries()].sort(([a], [b]) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return order === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  });
  return sorted.map(([month, items]) => ({
    month,
    items: order === 'asc' ? [...items].reverse() : items,
  }));
}
