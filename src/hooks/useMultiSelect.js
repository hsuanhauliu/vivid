import { useState, useCallback } from 'react';

/**
 * Multi-select state for the media grid: the set of checked item ids plus the
 * toggle/clear actions. `setCheckedIds` is exposed for the cases that need
 * direct control (select-all, removing a just-deleted id).
 */
export default function useMultiSelect() {
  const [checkedIds, setCheckedIds] = useState(new Set());
  const isSelecting = checkedIds.size > 0;

  const toggleCheck = useCallback(
    (id) =>
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    [],
  );

  const clearChecked = useCallback(() => setCheckedIds(new Set()), []);

  // Union a range of ids into the selection (shift-click range select) —
  // additive rather than a toggle, matching Finder/Photos convention.
  const checkRange = useCallback(
    (ids) =>
      setCheckedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      }),
    [],
  );

  return { checkedIds, setCheckedIds, isSelecting, toggleCheck, checkRange, clearChecked };
}
