import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Last component of a filesystem path — tolerant of both `/` and `\`
 * separators (folders picked via the native dialog can be Windows-style even
 * when running elsewhere) and a trailing separator.
 */
export function basenameOf(path) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/**
 * A cached thumbnail (`item.thumb_path`) is either a real file path (the
 * default workspace's on-disk `.jpg` cache) or a `data:image/jpeg;base64,...`
 * URL (an external/user-managed workspace's in-memory-generated thumbnail —
 * see `commands::thumbs` — cached in the database instead of as a file, since
 * Vivid never writes derived files near a user-managed folder). Only the
 * former needs `convertFileSrc`; the latter is already a usable `src`.
 */
export function thumbSrcOf(thumbPath) {
  if (!thumbPath) return null;
  return thumbPath.startsWith('data:') ? thumbPath : convertFileSrc(thumbPath);
}
