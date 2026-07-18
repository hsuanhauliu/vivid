// Stable id of the virtual "Uncategorized" folder the backend always
// prepends to `list_folders` (see `db::UNCATEGORIZED_ID` in folders.rs). It
// isn't a real folder row — it stands for the library root, so a file that's
// never been filed into a named folder has `folder_id: null`. Anywhere an
// item's `folder_id` is compared against a folder's `id` (counts, active-
// folder scoping, "is this item in this folder" checks), normalize with
// `folderIdOf` first so `null` and this sentinel are treated as the same
// thing.
export const UNCATEGORIZED_ID = 'uncategorized';

/** An item's effective folder id for comparison against `Folder.id` values. */
export function folderIdOf(item) {
  return item.folder_id ?? UNCATEGORIZED_ID;
}
