import { useState, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { folderIdOf } from '../utils/folders';

/**
 * On-disk folder tree state and CRUD, extracted from App so the folder domain
 * lives in one place. Owns the folder list and the currently selected folder
 * (the subtree filter), derives per-folder item counts and the active scope,
 * and wraps the backend folder commands with toast/confirm UX.
 *
 * Folders are a real filesystem concept (distinct from album/playlist
 * collections): each maps to a directory under the managed library root, so
 * rename/delete/move shift files on disk and require a media reload.
 *
 * @param {object} deps
 * @param {Array}    deps.allItems     - full library item list (for counts).
 * @param {Function} deps.reloadMedia  - re-fetch media after file_paths shift.
 * @param {Function} deps.showToast    - (type, message) transient notification.
 * @param {Function} deps.setConfirm   - open the confirm dialog (delete needs it).
 * @param {Function} deps.t            - i18n translator.
 */
export default function useFolders({ allItems, reloadMedia, showToast, setConfirm, t }) {
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null); // selected folder_id (subtree filter)

  useEffect(() => {
    invoke('list_folders').then(setFolders).catch(console.error);
  }, []);

  // Refresh the tree when the backend reports folder changes (e.g. an import
  // that recreated a nested directory structure under the destination).
  useEffect(() => {
    let unlisten;
    listen('folders-changed', () => {
      invoke('list_folders').then(setFolders).catch(console.error);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Items directly in each folder, for the tree's per-row counts. A `null`
  // `folder_id` (never filed into a real folder) counts toward the virtual
  // Uncategorized bucket, same as every other folder row.
  const folderCounts = useMemo(() => {
    const m = {};
    for (const i of allItems) {
      const key = folderIdOf(i);
      m[key] = (m[key] || 0) + 1;
    }
    return m;
  }, [allItems]);

  // The selected folder plus all its descendants (by rel_path prefix), so
  // selecting a folder shows everything nested under it on disk.
  const folderScope = useMemo(() => {
    if (!activeFolder) return null;
    const sel = folders.find((f) => f.id === activeFolder);
    if (!sel) return null;
    const prefix = sel.rel_path + '/';
    return new Set(
      folders
        .filter((f) => f.rel_path === sel.rel_path || f.rel_path.startsWith(prefix))
        .map((f) => f.id),
    );
  }, [activeFolder, folders]);

  const createFolder = useCallback(
    async (name, parentId) => {
      try {
        const folder = await invoke('create_folder', { name, parentId: parentId ?? null });
        setFolders((prev) => [...prev, folder]);
      } catch (e) {
        if (String(e).includes('DUPLICATE_NAME'))
          showToast('error', t('notif.duplicateFolder', { name }));
        else showToast('error', String(e));
      }
    },
    [t, showToast],
  );

  const renameFolder = useCallback(
    async (id, name) => {
      if (!name?.trim()) return;
      try {
        await invoke('rename_folder', { id, name: name.trim() });
        const fresh = await invoke('list_folders');
        setFolders(fresh);
        await reloadMedia(); // file_paths shifted under the renamed subtree
      } catch (e) {
        if (String(e).includes('DUPLICATE_NAME'))
          showToast('error', t('notif.duplicateFolder', { name: name.trim() }));
        else showToast('error', String(e));
      }
    },
    [t, showToast, reloadMedia],
  );

  const deleteFolder = useCallback(
    (id, name) => {
      setConfirm({
        title: t('contextMenu.deleteFolderTitle'),
        message: t('contextMenu.deleteFolderMsg', { name }),
        confirmLabel: t('contextMenu.deleteCollectionConfirm'),
        onConfirm: async () => {
          try {
            await invoke('delete_folder', { id });
            const fresh = await invoke('list_folders');
            setFolders(fresh);
            await reloadMedia(); // contents were flattened into Uncategorized
            setActiveFolder((cur) => (cur === id ? null : cur));
          } catch (e) {
            showToast('error', String(e));
          }
          setConfirm(null);
        },
      });
    },
    [t, showToast, reloadMedia, setConfirm],
  );

  const moveFolder = useCallback(
    async (id, newParentId) => {
      try {
        await invoke('move_folder', { id, newParentId: newParentId ?? null });
        const fresh = await invoke('list_folders');
        setFolders(fresh);
      } catch (e) {
        showToast('error', String(e));
      }
    },
    [showToast],
  );

  return {
    folders,
    setFolders,
    activeFolder,
    setActiveFolder,
    folderCounts,
    folderScope,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
  };
}
