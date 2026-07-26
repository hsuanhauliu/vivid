import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

// WKWebView's native <video> can't decode these at all, even though they're
// recognized, importable video types (models::extension_to_media_type on the
// Rust side). Kept in sync with UNPLAYABLE_VIDEO_EXTS in commands/export.rs.
const UNPLAYABLE_EXTS = new Set(['wmv', 'avi', 'flv', 'mkv']);

/**
 * Resolve a video file path to a webview-playable `src`. Unplayable
 * containers/codecs are handed to the backend `get_playable_video_path`
 * command, which transcodes them once (cached) to H.264/AAC MP4 via ffmpeg —
 * the one place in the app ffmpeg is still used, as a fully optional
 * fallback (AVFoundation can't demux these containers at all) — everything
 * else passes straight through convertFileSrc.
 *
 * `src` is `null` while an unsupported format is transcoding — that first
 * play can take a while for a large file, so callers should show a loading
 * state rather than an empty/broken player. `error` is set if the transcode
 * failed (most commonly: ffmpeg isn't installed) — callers should show it
 * rather than silently trying to play the untranscoded, undecodable file.
 *
 * Extension alone doesn't fully determine playability — .mov in particular
 * is a container that can hold codecs WKWebView can't decode (VP9 above
 * all — some Android/social apps remux into a .mov holding a VP9 video
 * stream, which Apple doesn't license for playback at all — plus older
 * codecs like Cinepak/Sorenson/MPEG-4 Part 2, or unsupported audio codecs)
 * even though most .mov files (H.264/HEVC) play fine. So beyond the always-
 * unplayable extensions, the backend also probes the actual video codec
 * (via ffprobe, when installed) before deciding whether to transcode.
 * `retryWithTranscode` is a last-resort fallback for when even that probe
 * missed it (e.g. ffprobe unavailable) — call it if the native <video>
 * element fires an error while playing a file this hook assumed was fine;
 * it forces the same ffmpeg fallback, skipping the extension/codec checks.
 */
export function useVideoSrc(filePath) {
  const ext = filePath?.split('.').pop()?.toLowerCase();
  // Fast synchronous guess for the very first paint, before the backend's
  // (extension + probed-codec) verdict comes back — refined below.
  const assumedUnplayable = !!ext && UNPLAYABLE_EXTS.has(ext);
  const [src, setSrc] = useState(() => (assumedUnplayable ? null : convertFileSrc(filePath ?? '')));
  const [error, setError] = useState(null);
  const triedForceRef = useRef(false);

  useEffect(() => {
    triedForceRef.current = false;
    if (!filePath) return;
    setError(null);
    setSrc(assumedUnplayable ? null : convertFileSrc(filePath));
    invoke('get_playable_video_path', { filePath })
      .then((p) => setSrc(convertFileSrc(p)))
      .catch((e) => setError(String(e)));
  }, [filePath, assumedUnplayable]);

  const retryWithTranscode = useCallback(() => {
    if (!filePath || triedForceRef.current) return;
    triedForceRef.current = true;
    setSrc(null);
    setError(null);
    invoke('get_playable_video_path', { filePath, force: true })
      .then((p) => setSrc(convertFileSrc(p)))
      .catch((e) => setError(String(e)));
  }, [filePath]);

  return { src, error, retryWithTranscode };
}
