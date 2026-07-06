import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * The media library's data layer: the full item list, the currently-selected
 * item (detail panel), a `reload` helper, and the background event listeners
 * that keep them in sync with OCR results.
 *
 * Mutation handlers (star, group, remove, import, …) stay in the host component
 * because they're coupled to its view state (viewer, modals, multi-select) —
 * they use the setters this hook returns.
 */
export default function useMediaLibrary() {
  const [allItems, setAllItems] = useState([]);
  const [selected, setSelected] = useState(null); // detail panel item

  /** Refetch the full library from the backend. */
  const reload = useCallback(async () => {
    setAllItems(await invoke('get_all_media'));
  }, []);

  // Keep items/selection in sync with background OCR.
  useEffect(() => {
    const uns = [];
    // Single-image auto-OCR (on import): patch just that item — no full refetch.
    listen('ocr-item', ({ payload }) => {
      if (!payload?.id) return;
      setAllItems((prev) =>
        prev.map((it) => (it.id === payload.id ? { ...it, ocr_text: payload.text } : it)),
      );
      setSelected((prev) => (prev?.id === payload.id ? { ...prev, ocr_text: payload.text } : prev));
    }).then((fn) => uns.push(fn));
    // Full library scan (manual "Scan text"): refetch once when the batch ends,
    // and re-sync the open detail panel (its `selected` item is a snapshot).
    listen('ocr-progress', ({ payload }) => {
      if (!payload?.done) return;
      invoke('get_all_media')
        .then((items) => {
          setAllItems(items);
          setSelected((prev) => (prev ? (items.find((i) => i.id === prev.id) ?? prev) : prev));
        })
        .catch(console.error);
    }).then((fn) => uns.push(fn));
    // New-import thumbnail ready: swap in the cheap preview for that one item.
    listen('thumb-item', ({ payload }) => {
      if (!payload?.id) return;
      setAllItems((prev) =>
        prev.map((it) =>
          it.id === payload.id
            ? { ...it, thumb_path: payload.thumb_path, width: payload.width, height: payload.height }
            : it,
        ),
      );
    }).then((fn) => uns.push(fn));
    // Backfill pass finished with work done: refetch so existing items pick up
    // their thumbnails. (total === 0 means nothing to do — skip the reload.)
    listen('thumb-progress', ({ payload }) => {
      if (!payload?.done || !payload.total) return;
      invoke('get_all_media').then(setAllItems).catch(console.error);
    }).then((fn) => uns.push(fn));
    return () => uns.forEach((fn) => fn());
  }, []);

  return { allItems, setAllItems, selected, setSelected, reload };
}
