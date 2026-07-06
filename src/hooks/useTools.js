import { useEffect } from 'react';
import { useDownloadStore, refreshToolStatus, downloadTool } from '../stores/downloadStore';

/**
 * Status + on-demand download for the external CLI tools (ffmpeg, yt-dlp).
 *
 * Thin wrapper over the module-level download store so in-flight progress
 * survives navigation: the store owns the persistent `tool-download-progress`
 * listener, this hook just reads the current snapshot and refreshes status on
 * mount.
 *
 * `status[name] = { available, source }` where source is system|managed|missing.
 */
export default function useTools() {
  const snap = useDownloadStore();

  // Refresh availability on mount (e.g. a download may have finished while the
  // component was unmounted, so what we last saw could be stale).
  useEffect(() => {
    refreshToolStatus();
  }, []);

  return {
    status: snap.toolStatus,
    progress: snap.toolProgress,
    downloading: snap.toolDownloading,
    error: snap.toolError,
    download: downloadTool,
    refresh: refreshToolStatus,
  };
}
