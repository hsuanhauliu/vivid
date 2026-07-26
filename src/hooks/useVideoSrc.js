import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/**
 * Resolve a video file path to a webview-playable `src`. Some containers/
 * codecs WKWebView can't decode at all — always-unplayable extensions
 * (WMV/AVI/FLV/MKV) plus, since a container extension alone doesn't
 * guarantee a playable codec (.mov above all: some Android/social apps
 * remux into a .mov holding a VP9 video stream, which Apple doesn't
 * license for playback at all), anything whose actual video codec fails a
 * backend probe. Those get transcoded once (cached) to H.264/AAC MP4 via
 * ffmpeg — the one place in the app ffmpeg is still used, as a fully
 * optional fallback; everything else passes straight through
 * `convertFileSrc`.
 *
 * Returns `{ src, status, error, retryWithTranscode }`. `status` is
 * `'checking'` (deciding whether this file needs the fallback — brief,
 * no ffmpeg run yet), `'converting'` (ffmpeg is transcoding — can take a
 * while for a large file), `'ready'`, or `'error'` (transcode failed, most
 * commonly: ffmpeg isn't installed — see `error` for the reason). Callers
 * should show an explicit "converting" state rather than attempting to
 * play `src` while it's not `'ready'`: playing a not-yet-transcoded source
 * doesn't fail loudly, it just shows a permanently black frame with no
 * error a `<video>` element can catch, since the file hasn't even loaded
 * yet — indistinguishable from a hang unless the UI says otherwise.
 *
 * `retryWithTranscode` is a last-resort fallback for when the backend's
 * probe missed a bad codec (e.g. ffprobe unavailable) — call it if the
 * native <video> element fires an error while playing a `'ready'` src that
 * turned out not to actually be playable; it forces the same ffmpeg
 * fallback, skipping the extension/codec checks.
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
