import { describe, it, expect } from 'vitest';
import { resolveCoverItem } from './cover';

const img1 = { id: 'i1', collection_ids: ['g1'], media_type: 'image' };
const img2 = { id: 'i2', collection_ids: ['g1'], media_type: 'image' };
const vid1 = { id: 'v1', collection_ids: ['g1'], media_type: 'video' };
const otherGroupImg = { id: 'i9', collection_ids: ['g2'], media_type: 'image' };

describe('resolveCoverItem', () => {
  it('returns null for missing group or items', () => {
    expect(resolveCoverItem(null, [img1])).toBeNull();
    expect(resolveCoverItem({ id: 'g1' }, null)).toBeNull();
  });

  it('prefers the explicitly chosen cover when it exists', () => {
    const group = { id: 'g1', cover_item_id: 'i2' };
    expect(resolveCoverItem(group, [img1, img2])).toBe(img2);
  });

  it('falls back to first image when the chosen cover id is not found', () => {
    const group = { id: 'g1', cover_item_id: 'missing' };
    expect(resolveCoverItem(group, [img1, img2])).toBe(img1);
  });

  it('returns the first image of the group when no cover is set', () => {
    const group = { id: 'g1' };
    expect(resolveCoverItem(group, [vid1, img1, img2])).toBe(img1);
  });

  it('ignores images belonging to other groups', () => {
    const group = { id: 'g1' };
    expect(resolveCoverItem(group, [otherGroupImg, vid1])).toBeNull();
  });

  it('returns null for a video-only group when allowAny is false', () => {
    const group = { id: 'g1' };
    expect(resolveCoverItem(group, [vid1])).toBeNull();
  });

  it('falls back to any member for a video-only group when allowAny is true', () => {
    const group = { id: 'g1' };
    expect(resolveCoverItem(group, [vid1], { allowAny: true })).toBe(vid1);
  });

  it('still prefers an image over a video even when allowAny is true', () => {
    const group = { id: 'g1' };
    expect(resolveCoverItem(group, [vid1, img1], { allowAny: true })).toBe(img1);
  });
});
