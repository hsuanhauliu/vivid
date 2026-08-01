import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Native OS window fullscreen — not the browser Fullscreen API, which is
 * unreliable inside Tauri's WKWebView. Shared by VideoPlayer and FileViewer's
 * image view, both of which toggle the same app window fullscreen and need
 * the native traffic-light buttons (hidden by default behind the app's own
 * custom titlebar) shown while it's active.
 *
 * @param {Function} [onChange] - called with the new fullscreen state
 *                                 whenever it changes, including exits via
 *                                 OS controls (green button, Mission Control).
 * @returns {{
 *   fullscreen: boolean,
 *   fullscreenRef: React.RefObject<boolean>,
 *   toggleFullscreen: () => Promise<void>,
 *   exitFullscreen: () => Promise<void>,
 * }}
 */
export default function useWindowFullscreen(onChange) {
  const [fullscreen, setFullscreen] = useState(false);
  // Ref so keyboard handlers can read the current value without needing to
  // re-register every time it changes.
  const fullscreenRef = useRef(false);

  const apply = useCallback(
    (isFs) => {
      fullscreenRef.current = isFs;
      setFullscreen(isFs);
      onChange?.(isFs);
      invoke('set_native_traffic_lights_visible', { visible: isFs }).catch(() => {});
    },
    [onChange],
  );

  const toggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const isFs = await win.isFullscreen();
    await win.setFullscreen(!isFs);
    apply(!isFs);
  }, [apply]);

  const exitFullscreen = useCallback(async () => {
    await getCurrentWindow().setFullscreen(false);
    apply(false);
  }, [apply]);

  // Sync state when the user exits fullscreen via OS controls rather than
  // our own toggle.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten;
    win
      .onResized(async () => {
        const isFs = await win.isFullscreen();
        apply(isFs);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [apply]);

  return { fullscreen, fullscreenRef, toggleFullscreen, exitFullscreen };
}
