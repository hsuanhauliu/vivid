import { convertFileSrc } from '@tauri-apps/api/core';
import { thumbSrcOf } from './path';

/**
 * Resolve a collection's cover item from the library.
 *
 * Order of preference: the collection's explicitly chosen cover, then its first
 * image. When `allowAny` is set, falls back to its first member of any media
 * type (used by the collections page, where a folder may hold only videos).
 *
 * Centralizes logic that was duplicated across the sidebar, settings, context
 * menu, results bar, and collection pickers.
 *
 * @param {object|null} group - the collection (needs `id`, `cover_item_id`).
 * @param {Array}       items - the full library item list.
 * @param {{ allowAny?: boolean }} [opts]
 * @returns {object|null} the cover item, or null when none can be resolved.
 */
export function resolveCoverItem(group, items, { allowAny = false } = {}) {
  if (!group || !items) return null;
  if (group.cover_item_id) {
    const chosen = items.find((i) => i.id === group.cover_item_id);
    if (chosen) return chosen;
  }
  const image = items.find((i) => i.collection_ids?.includes(group.id) && i.media_type === 'image');
  if (image || !allowAny) return image ?? null;
  return items.find((i) => i.collection_ids?.includes(group.id)) ?? null;
}

/**
 * Resolve a displayable thumbnail URL for a cover *item* (the result of
 * `resolveCoverItem`). Prefers a cheap thumbnail/embedded cover over the
 * full-resolution source, and never returns a raw video path (which can't
 * render in an `<img>`).
 *
 * @param {object|null} item - a media item (needs `media_type`, `file_path`,
 *                             and optionally `thumb_path` / `audio_cover`).
 * @returns {string|null} an asset URL, or null when nothing renderable exists.
 */
export function coverSrc(item) {
  if (!item) return null;
  if (item.media_type === 'image') {
    return item.thumb_path ? thumbSrcOf(item.thumb_path) : convertFileSrc(item.file_path);
  }
  const cover = item.audio_cover || item.thumb_path;
  return cover ? thumbSrcOf(cover) : null;
}
