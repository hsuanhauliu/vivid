import { describe, it, expect } from 'vitest';
import { applyFilters, resolutionBucket } from './FilterBar';

const ids = (items) => items.map((i) => i.id).sort();

describe('applyFilters', () => {
  it('returns all items when no filters are set', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(applyFilters(items, {})).toHaveLength(2);
  });

  it('filters by color label', () => {
    const items = [
      { id: 'a', color_label: 'red' },
      { id: 'b', color_label: 'blue' },
    ];
    expect(ids(applyFilters(items, { colorLabel: ['red'] }))).toEqual(['a']);
  });

  it('filters by multiple color labels (multi-select)', () => {
    const items = [
      { id: 'a', color_label: 'red' },
      { id: 'b', color_label: 'blue' },
      { id: 'c', color_label: 'green' },
    ];
    expect(ids(applyFilters(items, { colorLabel: ['red', 'blue'] }))).toEqual(['a', 'b']);
  });

  describe('orientation', () => {
    const items = [
      { id: 'land', width: 4000, height: 3000 }, // ratio 1.33 → landscape
      { id: 'port', width: 3000, height: 4000 }, // ratio 0.75 → portrait
      { id: 'sq', width: 1000, height: 1000 }, // ratio 1.0  → square
      { id: 'nodim', width: null, height: null }, // unknown → excluded
    ];

    it('matches landscape', () => {
      expect(ids(applyFilters(items, { orientation: 'landscape' }))).toEqual(['land']);
    });
    it('matches portrait', () => {
      expect(ids(applyFilters(items, { orientation: 'portrait' }))).toEqual(['port']);
    });
    it('matches square', () => {
      expect(ids(applyFilters(items, { orientation: 'square' }))).toEqual(['sq']);
    });
    it('excludes items with unknown dimensions from every orientation', () => {
      for (const o of ['landscape', 'portrait', 'square']) {
        expect(applyFilters(items, { orientation: o }).map((i) => i.id)).not.toContain('nodim');
      }
    });
  });

  describe('file size', () => {
    const items = [
      { id: 'small', file_size: 500_000 },
      { id: 'medium', file_size: 5_000_000 },
      { id: 'large', file_size: 50_000_000 },
    ];
    it('buckets small / medium / large', () => {
      expect(ids(applyFilters(items, { fileSize: 'small' }))).toEqual(['small']);
      expect(ids(applyFilters(items, { fileSize: 'medium' }))).toEqual(['medium']);
      expect(ids(applyFilters(items, { fileSize: 'large' }))).toEqual(['large']);
    });
  });

  describe('resolutionBucket', () => {
    it('classifies by the long edge, independent of orientation', () => {
      expect(resolutionBucket(1920, 1080)).toBe('fhd');
      expect(resolutionBucket(1080, 1920)).toBe('fhd'); // portrait, same long edge
    });
    it('buckets sd / hd / fhd / uhd at the documented thresholds', () => {
      expect(resolutionBucket(640, 480)).toBe('sd');
      expect(resolutionBucket(1279, 720)).toBe('sd');
      expect(resolutionBucket(1280, 720)).toBe('hd');
      expect(resolutionBucket(1919, 1080)).toBe('hd');
      expect(resolutionBucket(1920, 1080)).toBe('fhd');
      expect(resolutionBucket(3839, 2160)).toBe('fhd');
      expect(resolutionBucket(3840, 2160)).toBe('uhd');
    });
    it('returns null for missing dimensions', () => {
      expect(resolutionBucket(null, null)).toBeNull();
      expect(resolutionBucket(1920, null)).toBeNull();
      expect(resolutionBucket(0, 0)).toBeNull();
    });
  });

  describe('resolution filter', () => {
    const items = [
      { id: 'sd', width: 640, height: 480 },
      { id: 'hd', width: 1280, height: 720 },
      { id: 'fhd', width: 1920, height: 1080 },
      { id: 'uhd', width: 3840, height: 2160 },
      { id: 'nodim', width: null, height: null },
    ];
    it('matches only the selected bucket', () => {
      expect(ids(applyFilters(items, { resolution: 'fhd' }))).toEqual(['fhd']);
    });
    it('matches any of several selected buckets (multi-select)', () => {
      expect(ids(applyFilters(items, { resolution: ['sd', 'uhd'] }))).toEqual(['sd', 'uhd']);
    });
    it('excludes items with unknown dimensions from every bucket', () => {
      for (const r of ['sd', 'hd', 'fhd', 'uhd']) {
        expect(applyFilters(items, { resolution: r }).map((i) => i.id)).not.toContain('nodim');
      }
    });
  });

  describe('custom date range (uses capture date, inclusive)', () => {
    const items = [
      { id: 'before', date_taken: '2020-12-31T23:00:00' },
      { id: 'inside', date_taken: '2021-06-15T12:00:00' },
      { id: 'edgeTo', date_taken: '2021-12-31T20:00:00' },
      { id: 'after', date_taken: '2022-01-02T00:00:00' },
      { id: 'byCreated', created_at: '2021-03-01T00:00:00' }, // no date_taken → uses created_at
    ];
    it('keeps items within [dateFrom, dateTo] by capture date', () => {
      const out = ids(applyFilters(items, { dateFrom: '2021-01-01', dateTo: '2021-12-31' }));
      expect(out).toEqual(['byCreated', 'edgeTo', 'inside']);
    });
    it('supports an open-ended lower bound', () => {
      const out = applyFilters(items, { dateTo: '2021-01-01' }).map((i) => i.id);
      expect(out).toContain('before');
      expect(out).not.toContain('after');
    });
  });
});
