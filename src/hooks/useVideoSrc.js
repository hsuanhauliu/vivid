import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/**
 * Resolve a video file path to a webview-playable `src`. Codecs WKWebView
 * can't decode (per a backend probe) get transcoded once, cached, to
 * H.264/AAC MP4 via ffmpeg; everything else passes through `convertFileSrc`.
 *
 * Returns `{ src, status, error, retryWithTranscode }`. `status` is
 * `'checking'`, `'converting'`, `'ready'`, or `'error'`. Callers should wait
 * for `'ready'` rather than playing `src` early — an unconverted source
 * fails silently (permanently black, no catchable `<video>` error).
 *
 * `retryWithTranscode` forces the fallback for when the backend probe
 * missed a bad codec — call it on a native `<video>` playback error.
 */
export function useVideoSrc(filePath) {
  const [src, setSrc] = useState(null);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState(null);
  const triedForceRef = useRef(false);

  useEffect(() => {
    triedForceRef.current = false;
    setSrc(null);
    setError(null);
    if (!filePath) return;
    setStatus('checking');
    let cancelled = false;

    invoke('video_needs_transcode', { filePath })
      .then((needsTranscode) => {
        if (cancelled) return;
        if (!needsTranscode) {
          setSrc(convertFileSrc(filePath));
          setStatus('ready');
          return;
        }
        setStatus('converting');
        return invoke('get_playable_video_path', { filePath }).then((p) => {
          if (cancelled) return;
          setSrc(convertFileSrc(p));
          setStatus('ready');
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const retryWithTranscode = useCallback(() => {
    if (!filePath || triedForceRef.current) return;
    triedForceRef.current = true;
    setSrc(null);
    setError(null);
    setStatus('converting');
    invoke('get_playable_video_path', { filePath, force: true })
      .then((p) => {
        setSrc(convertFileSrc(p));
        setStatus('ready');
      })
      .catch((e) => {
        setError(String(e));
        setStatus('error');
      });
  }, [filePath]);

  return { src, status, error, retryWithTranscode };
}
