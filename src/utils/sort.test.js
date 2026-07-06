import { describe, it, expect } from 'vitest';
import { captureDate, addedDate, sortItems, SORT_OPTIONS } from './sort';

const ids = (items) => items.map((i) => i.id);

describe('captureDate', () => {
  it('prefers date_taken over created_at', () => {
    expect(captureDate({ date_taken: '2020-01-01', created_at: '2023-01-01' })).toBe('2020-01-01');
  });
  it('falls back to created_at when date_taken is absent', () => {
    expect(captureDate({ created_at: '2023-01-01' })).toBe('2023-01-01');
  });
});

describe('addedDate', () => {
  it('returns created_at regardless of date_taken', () => {
    expect(addedDate({ date_taken: '2020-01-01', created_at: '2023-01-01' })).toBe('2023-01-01');
  });
});

describe('sortItems', () => {
  const items = [
    { id: 'a', date_taken: '2021-06-01', display_name: 'IMG_10', file_size: 30, sort_order: 2 },
    { id: 'b', created_at: '2019-01-01', display_name: 'IMG_2', file_size: 10, sort_order: 0 },
    { id: 'c', date_taken: '2023-12-31', display_name: 'apple', file_size: 20, sort_order: 1 },
  ];

  it('does not mutate the input array', () => {
    const copy = [...items];
    sortItems(items, 'size-asc');
    expect(items).toEqual(copy);
  });

  it('sorts by capture date newest first', () => {
    expect(ids(sortItems(items, 'date-desc'))).toEqual(['c', 'a', 'b']);
  });

  it('sorts by capture date oldest first', () => {
    expect(ids(sortItems(items, 'date-asc'))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by time added to Vivid, independent of capture date', () => {
    // 'a' was imported most recently despite having the oldest capture date.
    const added = [
      { id: 'a', date_taken: '2021-06-01', created_at: '2024-01-01' },
      { id: 'b', date_taken: '2019-01-01', created_at: '2022-01-01' },
      { id: 'c', date_taken: '2023-12-31', created_at: '2023-01-01' },
    ];
    expect(ids(sortItems(added, 'added-desc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortItems(added, 'added-asc'))).toEqual(['b', 'c', 'a']);
  });

  it('sorts names naturally (IMG_2 before IMG_10) and case-insensitively', () => {
    // 'apple' vs 'IMG_*': case-insensitive, numeric-aware ordering
    expect(ids(sortItems(items, 'name-asc'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortItems(items, 'name-desc'))).toEqual(['a', 'b', 'c']);
  });

  it('sorts by file size', () => {
    expect(ids(sortItems(items, 'size-asc'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortItems(items, 'size-desc'))).toEqual(['a', 'c', 'b']);
  });

  it('sorts by manual sort_order', () => {
    expect(ids(sortItems(items, 'manual'))).toEqual(['b', 'c', 'a']);
  });

  it('returns items unchanged for an unknown sort key', () => {
    expect(ids(sortItems(items, 'bogus'))).toEqual(['a', 'b', 'c']);
  });
});

describe('SORT_OPTIONS', () => {
  it('has unique values and includes the defaults', () => {
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain('date-desc');
    expect(values).toContain('added-desc');
    expect(values).toContain('manual');
  });
});
