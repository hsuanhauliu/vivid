/**
 * Shared display formatters for file sizes, dates, and durations.
 *
 * These were previously re-implemented (with subtly different rounding) inside
 * StatsPage, DetailPanel, TrashView, SecondaryPanel, MusicView, and AudioPlayer.
 * Consolidated here so every surface formats values identically. Pure functions,
 * no React — unit-tested in format.test.js.
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * Human-readable byte size, e.g. `1536` → "1.5 KB", `0` → "0 B".
 * Sub-GB uses one decimal; GB and above use two for finer granularity.
 */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const i = Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const decimals = i >= 3 ? 2 : i === 0 ? 0 : 1;
  return `${parseFloat(value.toFixed(decimals))} ${SIZE_UNITS[i]}`;
}

/** Localized date, e.g. "Jun 19, 2026". Returns "—" for empty input. */
export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Localized date without the year, e.g. "Jun 19". Returns "—" for empty input. */
export function formatDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Localized date + time, e.g. "Jun 19, 2026, 02:30 PM". Returns "—" for empty input. */
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Clock-style duration from seconds: "3:05", or "1:02:05" once it passes an hour.
 * Returns "" for falsy/invalid input so callers can omit it cleanly.
 */
export function formatDuration(secs) {
  if (!secs || !isFinite(secs) || secs < 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** Like {@link formatDuration} but renders 0/invalid as "0:00" (for player time readouts). */
export function formatClock(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  return formatDuration(secs) || '0:00';
}
