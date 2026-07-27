import { BookImage, Disc, FolderOpen, Layers } from 'lucide-react';

/**
 * Canonical entity icons for album/playlist/folder — the single source of
 * truth every part of the app (including the primary sidebar, Sidebar.jsx,
 * which imports these same constants for its Albums/Playlists/Folders nav
 * items) defers to. Anywhere that identifies "this is an album", "this is a
 * playlist", or "this is a folder" (list rows, breadcrumbs, pickers,
 * cover-art fallbacks, nav entries, …) should import from here instead of
 * picking its own icon, so it can't quietly drift out of sync again.
 *
 * Deliberately NOT for action/verb icons (e.g. "move to folder", "remove
 * from collection") — those represent an operation, not the entity itself,
 * and reusing these noun icons for them would blur the two.
 */
export const COLLECTION_KIND_ICONS = {
  album: BookImage,
  playlist: Disc,
  // Holds other albums, never files directly — distinct enough from a plain
  // album that it keeps the generic-collection icon already used elsewhere
  // for kind-agnostic contexts (FilterBar's "in collection" toggle,
  // SecondaryPanel's collection-count stat and album-group row badge).
  album_group: Layers,
};

export const FOLDER_ICON = FolderOpen;

/** Icon for a collection's `kind`, falling back to the generic marker. */
export function collectionKindIcon(kind) {
  return COLLECTION_KIND_ICONS[kind] ?? Layers;
}
