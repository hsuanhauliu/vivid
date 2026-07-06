import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatClock,
} from './format';

describe('formatBytes', () => {
  it('handles zero and falsy input', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
  it('formats bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
  it('formats KB/MB with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
  it('formats GB and above with two decimals', () => {
    expect(formatBytes(1024 ** 3 * 1.25)).toBe('1.25 GB');
    expect(formatBytes(1024 ** 4 * 3)).toBe('3 TB');
  });
  it('drops trailing zeros', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });
});

describe('formatDate variants', () => {
  it('returns dash for empty input', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDateShort(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });
  it('formats a known ISO date', () => {
    // Use a fixed date; assert on substrings to stay locale/timezone tolerant.
    const out = formatDate('2026-06-19T14:30:00Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Jun/);
  });
  it('short form omits the year', () => {
    expect(formatDateShort('2026-06-19T14:30:00Z')).not.toMatch(/2026/);
  });
});

describe('formatDuration', () => {
  it('returns empty string for falsy/invalid', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(Infinity)).toBe('');
    expect(formatDuration(-3)).toBe('');
  });
  it('formats minutes:seconds', () => {
    expect(formatDuration(185)).toBe('3:05');
    expect(formatDuration(9)).toBe('0:09');
  });
  it('formats hours:minutes:seconds past an hour', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('formatClock', () => {
  it('renders zero/invalid as 0:00', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
    expect(formatClock(-1)).toBe('0:00');
  });
  it('matches formatDuration for valid input', () => {
    expect(formatClock(185)).toBe('3:05');
  });
});
