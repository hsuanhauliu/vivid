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
