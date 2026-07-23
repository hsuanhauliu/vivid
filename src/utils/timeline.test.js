import { describe, it, expect } from 'vitest';
import { groupByMonth } from './timeline';

function item(id, date) {
  return { id, date_taken: date };
}

describe('groupByMonth', () => {
  it('buckets items by year-month', () => {
    const groups = groupByMonth([
      item('a', '2024-03-01'),
      item('b', '2024-03-15'),
      item('c', '2024-01-01'),
    ]);
    expect(groups.map((g) => g.month)).toEqual(['2024-03', '2024-01']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('defaults to descending month order', () => {
    const groups = groupByMonth([item('jan', '2024-01-01'), item('mar', '2024-03-01')]);
    expect(groups.map((g) => g.month)).toEqual(['2024-03', '2024-01']);
  });

  it('ascending order reverses both section order and item order within each section', () => {
    const groups = groupByMonth(
      [item('a', '2024-01-01'), item('b', '2024-01-15'), item('c', '2024-03-01')],
      'asc',
    );
    expect(groups.map((g) => g.month)).toEqual(['2024-01', '2024-03']);
    // 'a' then 'b' was insertion order; ascending flips it to 'b' then 'a'.
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('falls back to created_at when date_taken is missing', () => {
    const groups = groupByMonth([{ id: 'x', created_at: '2024-05-01' }]);
    expect(groups[0].month).toBe('2024-05');
  });

  it('collects items with neither date into an Unknown bucket', () => {
    const groups = groupByMonth([item('dated', '2024-01-01'), { id: 'undated' }]);
    expect(groups.map((g) => g.month)).toEqual(['2024-01', 'Unknown']);
  });

  it('sorts the Unknown bucket last in both asc and desc order', () => {
    const desc = groupByMonth([{ id: 'u' }, item('d', '2024-01-01')], 'desc');
    expect(desc.map((g) => g.month)).toEqual(['2024-01', 'Unknown']);

    const asc = groupByMonth([{ id: 'u' }, item('d', '2024-01-01')], 'asc');
    expect(asc.map((g) => g.month)).toEqual(['2024-01', 'Unknown']);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
