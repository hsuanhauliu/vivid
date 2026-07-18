import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

const MEDIA_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tiff',
  'avif',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'm4v',
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'opus',
];

/**
 * All media-acquisition flows in one place: file/folder picking, URL & yt-dlp
 * downloads, screenshots, the import-progress/done event listeners (with the
 * StrictMode-safe unlisten guard), and native OS drag-and-drop. Owns the
 * transient import UI state (progress, loading spinner, drag overlay) and the
 * paths awaiting a destination (`pendingImportPaths`).
 *
 * @param {object} deps
 * @param {Function} deps.setAllItems  - library state setter (prepend new items).
 * @param {Function} deps.setConfirm   - open the confirm dialog (screenshot perms).
 * @param {Function} deps.t            - i18n translator.
 * @param {Function} deps.showToast    - (type, message, duration) transient toast.
 */
export default function useImport({ setAllItems, setConfirm, t, showToast }) {
  const [pendingImportPaths, setPendingImportPaths] = useState(null); // paths waiting for destination
  const [importProgress, setImportProgress] = useState(null); // {current,total,file_name}
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Stable refs so the mount-only event listener always calls the latest
  // t/showToast without re-subscribing.
  const tRef = useRef(t);
  const showToastRef = useRef(showToast);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // ── Import progress / done events from Rust ───────────────────────────────
  //
  // listen() is async. Under StrictMode (and HMR in dev) the effect runs,
  // cleans up, then runs again — but the first cleanup fires before the
  // listen() promise resolves, so the old listener is never removed and they
  // accumulate. Guard with a `cancelled` flag: if cleanup already ran by the
  // time a promise resolves, immediately unlisten that handler.
  useEffect(() => {
    let cancelled = false;
    const unlisteners = [];
    const track = (promise) => {
      promise.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    };

    track(
      listen('import-progress', (event) => {
        setImportProgress(event.payload);
      }),
    );

    // New items stream in as chunks during the import — prepend them so the grid
    // fills incrementally instead of waiting for a full library reload.
    track(
      listen('import-batch', (event) => {
        const items = event.payload?.items ?? [];
        if (items.length) setAllItems((prev) => [...items, ...prev]);
      }),
    );

    // A file changed on disk in an external workspace while Vivid was
    // running (the live watcher in watch.rs), independent of anything the
    // frontend itself invoked — these two mirror `import-batch`'s "splice
    // into `allItems` without a full reload" shape for updates/removals
    // instead of additions.
    track(
      listen('media-updated', (event) => {
        const item = event.payload;
        if (item?.id) setAllItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
      }),
    );

    track(
      listen('media-removed', (event) => {
        const ids = new Set(event.payload?.ids ?? []);
        if (ids.size) setAllItems((prev) => prev.filter((it) => !ids.has(it.id)));
      }),
    );

    track(
      listen('import-done', (event) => {
        const { imported, skipped_type, skipped_dupe, failed } = event.payload;
        setImportProgress(null);
        setLoading(false);

        // Summarize the import as a single transient toast. Severity escalates to
        // the worst outcome; an active import is immediate/obvious, so this never
        // goes to the persistent messages page.
        const tr = tRef.current;
        const parts = [];
        if (imported > 0) parts.push(tr('notif.importedN', { count: imported }));
        if (skipped_type > 0) parts.push(tr('notif.skippedType', { count: skipped_type }));
        if (skipped_dupe > 0) parts.push(tr('notif.skippedDupe', { count: skipped_dupe }));
        if (failed > 0) parts.push(tr('notif.importFailed', { count: failed }));
        if (parts.length === 0) return;

        const issues = skipped_type + skipped_dupe + failed;
        const severity =
          failed > 0 ? 'error' : skipped_type > 0 || skipped_dupe > 0 ? 'warning' : 'success';
        showToastRef.current(severity, parts.join(' · '), issues > 0 ? 8000 : 4000);
      }),
    );

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // ── Native drag-drop (web File.path is unavailable in WKWebView) ───────────
  useEffect(() => {
    let unlisten;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        const { type, paths } = event.payload;
        if ((type === 'enter' || type === 'over') && paths && paths.length > 0) {
          setIsDragging(true);
        } else if (type === 'leave' || type === 'cancelled') {
          setIsDragging(false);
        } else if (type === 'drop') {
          setIsDragging(false);
          const filePaths = paths ?? [];
          if (!filePaths.length) return;
          // Route through the destination chooser just like the Import button, so
          // the user can pick a folder/collection before the copy starts.
          setPendingImportPaths(filePaths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Picking ────────────────────────────────────────────────────────────────
  // Single unified import — picks multiple files; drag-and-drop covers folders.
  const handleImport = useCallback(async () => {
    const files = await open({
      multiple: true,
      filters: [{ name: 'Media', extensions: MEDIA_EXTENSIONS }],
    });
    if (!files || (Array.isArray(files) && files.length === 0)) return;
    setPendingImportPaths(Array.isArray(files) ? files : [files]);
  }, []);

  const handleImportFolder = useCallback(async () => {
    const folder = await open({ directory: true, multiple: false });
    if (!folder) return;
    setPendingImportPaths([folder]);
  }, []);

  const handleImportPaths = useCallback(async (paths) => {
    setPendingImportPaths(paths);
  }, []);

  // Kick off a background import under an optional group/folder. Returns as soon
  // as the backend thread is spawned — imported items stream back via the
  // `import-batch` event and `loading` is cleared by the `import-done` listener.
  const doImport = useCallback(async (paths, collectionId, folderId, filename) => {
    setLoading(true);
    setImportProgress(null);
    invoke('import_paths', {
      paths,
      collectionId: collectionId ?? null,
      folderId: folderId ?? null,
      filename: filename ?? null,
    }).catch((e) => {
      console.error(e);
      setLoading(false);
      setImportProgress(null);
    });
  }, []);

  // ── Remote acquisition ──────────────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    try {
      const item = await invoke('capture_screenshot');
      setAllItems((prev) => [item, ...prev]);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('PERMISSION_DENIED')) {
        setConfirm({
          title: t('screenshot.permissionTitle'),
          message: t('screenshot.permissionMessage'),
          confirmLabel: t('screenshot.openSystemSettings'),
          onConfirm: () => {
            invoke('open_system_settings_privacy').catch(() =>
              openUrl(
                'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
              ),
            );
            setConfirm(null);
          },
        });
      } else if (!msg.includes('cancelled')) {
        console.warn('Screenshot:', e);
      }
    }
  }, [t, setAllItems, setConfirm]);

  return {
    pendingImportPaths,
    setPendingImportPaths,
    importProgress,
    loading,
    isDragging,
    handleImport,
    handleImportFolder,
    handleImportPaths,
    doImport,
    handleScreenshot,
  };
}
