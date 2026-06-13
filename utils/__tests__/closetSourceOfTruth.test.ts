import { describe, expect, it } from '@jest/globals';
import { replaceLocalClosetWithCloud } from '../closetSourceOfTruth';

describe('replaceLocalClosetWithCloud', () => {
  it('uses Firestore rows as the complete closet and removes local-only rows', () => {
    const result = replaceLocalClosetWithCloud(
      [
        { id: 'item-1', category: 'Accessories', photo: 'old-url', dateAdded: '2026-01-01T00:00:00.000Z' },
        { id: 'deleted-locally', category: 'Shoes', photo: 'stale-url', dateAdded: '2026-01-02T00:00:00.000Z' },
      ],
      [
        { id: 'item-1', category: 'Tops', photo: 'cloud-url', imageUrl: 'cloud-url', dateAdded: '2026-01-01T00:00:00.000Z' },
        { id: 'cloud-only', category: 'Dresses', photo: 'dress-url', imageUrl: 'dress-url', dateAdded: '2026-01-03T00:00:00.000Z' },
      ]
    );

    expect(result.items.map(item => item.id)).toEqual(['cloud-only', 'item-1']);
    expect(result.items.find(item => item.id === 'item-1')).toMatchObject({
      category: 'Tops',
      photo: 'cloud-url',
    });
    expect(result.items.some(item => item.id === 'deleted-locally')).toBe(false);
    expect(result).toMatchObject({
      refreshed: 1,
      added: 1,
      removed: 1,
    });
  });
});
