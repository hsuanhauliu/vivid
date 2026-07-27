import { BookImage, Disc, FolderOpen, Layers } from 'lucide-react';

/**
 * Canonical entity icons for album/playlist/folder — Sidebar.jsx imports
 * these same constants, so other UI (list rows, breadcrumbs, pickers, cover
 * fallbacks) should too, rather than picking its own icon.
 *
 * Not for action/verb icons (e.g. "move to folder") — those represent an
 * operation, not the entity.
 */
export const COLLECTION_KIND_ICONS = {
  album: BookImage,
  playlist: Disc,
  album_group: Layers,
};

export const FOLDER_ICON = FolderOpen;

/** Icon for a collection's `kind`, falling back to the generic marker. */
export function collectionKindIcon(kind) {
  return COLLECTION_KIND_ICONS[kind] ?? Layers;
}
