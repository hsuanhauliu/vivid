import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/**
 * Resolve a file path to a `src` the webview can actually render.
 *
 * Most formats pass straight through `convertFileSrc`. HEIC/HEIF can't be shown
 * by the webview, so those are handed to the backend `get_displayable_path`
 * command, which converts them entirely in memory and returns a
 * `data:image/jpeg;base64,...` URL — no converted copy is ever written to
 * disk, and a data URL sidesteps the webview's asset-protocol scope entirely
 * (returning a real path outside that scope, e.g. under system temp, would
 * just 403). While that async conversion is in flight `src` is `null`, so
 * callers should render a skeleton/placeholder until it resolves; on error we
 * fall back to the original path rather than showing nothing.
 *
 * Shared by every component that previews an original (not-thumbnailed) file —
 * MediaCard, DetailPanel, FileViewer — so the HEIC handling lives in exactly
 * one place.
 *
 * @param {string|null|undefined} filePath - absolute path to the media file.
 * @returns {string|null} a webview-usable src, or `null` while HEIC converts.
 */
export function useDisplayableSrc(filePath) {
  const ext = filePath?.split('.').pop()?.toLowerCase();
  const isHeic = ext === 'heic' || ext === 'heif';
  const [src, setSrc] = useState(() => (isHeic ? null : convertFileSrc(filePath ?? '')));

  useEffect(() => {
    if (!filePath) return;
    if (isHeic) {
      invoke('get_displayable_path', { filePath })
        .then((p) => setSrc(p)) // already a data: URL — not a filesystem path
        .catch(() => setSrc(convertFileSrc(filePath)));
    } else {
      setSrc(convertFileSrc(filePath));
    }
  }, [filePath, isHeic]);

  return src;
}
