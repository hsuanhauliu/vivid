import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/**
 * Resolve a file path to a `src` the webview can actually render.
 *
 * Most formats pass straight through `convertFileSrc`. HEIC/HEIF can't be shown
 * by the webview, so those are handed to the backend `get_displayable_path`
 * command (which transcodes to a viewable JPEG) and the converted path is used
 * instead. While that async conversion is in flight `src` is `null`, so callers
 * should render a skeleton/placeholder until it resolves; on error we fall back
 * to the original path rather than showing nothing.
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
        .then((p) => setSrc(convertFileSrc(p)))
        .catch(() => setSrc(convertFileSrc(filePath)));
    } else {
      setSrc(convertFileSrc(filePath));
    }
  }, [filePath, isHeic]);

  return src;
}
