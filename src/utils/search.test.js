import { describe, it, expect } from 'vitest';
import { matchesSearch } from './search';

const item = {
  display_name: 'Sunset Beach',
  file_name: 'IMG_0042.jpg',
  description: 'Golden hour at the pier',
  ocr_text: 'NO PARKING',
  tags: ['vacation'],
  auto_tags: ['sky', 'ocean'],
};

const allScopes = { name: true, description: true, ocr: true, tags: true };

describe('matchesSearch', () => {
  it('matches everything for an empty query', () => {
    expect(matchesSearch(item, '', allScopes)).toBe(true);
  });

  it('matches display_name and file_name when name scope is on', () => {
    expect(matchesSearch(item, 'sunset', allScopes)).toBe(true);
    expect(matchesSearch(item, 'img_0042', allScopes)).toBe(true);
  });

  it('respects the name scope toggle', () => {
    expect(matchesSearch(item, 'sunset', { ...allScopes, name: false })).toBe(false);
  });

  it('matches description only when that scope is on', () => {
    expect(matchesSearch(item, 'golden hour', allScopes)).toBe(true);
    expect(matchesSearch(item, 'golden hour', { ...allScopes, description: false })).toBe(false);
  });

  it('matches ocr text only when that scope is on', () => {
    expect(matchesSearch(item, 'no parking', allScopes)).toBe(true);
    expect(matchesSearch(item, 'no parking', { ...allScopes, ocr: false })).toBe(false);
  });

  it('matches tags and auto_tags only when that scope is on', () => {
    expect(matchesSearch(item, 'vacation', allScopes)).toBe(true);
    expect(matchesSearch(item, 'ocean', allScopes)).toBe(true);
    expect(matchesSearch(item, 'vacation', { ...allScopes, tags: false })).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSearch(item, 'nonexistent', allScopes)).toBe(false);
  });

  it('tolerates missing optional fields', () => {
    const sparse = { display_name: 'Plain', file_name: 'plain.jpg' };
    expect(matchesSearch(sparse, 'plain', allScopes)).toBe(true);
    expect(matchesSearch(sparse, 'anything', allScopes)).toBe(false);
  });
});
