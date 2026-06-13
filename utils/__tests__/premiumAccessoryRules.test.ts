import { describe, expect, it } from '@jest/globals';
import type { ClothingItem } from '../dailyPicksTypes';
import {
  buildAccessoryPromptRules,
  hasAccessoryCategoryItems,
  resolveAccessoryItemNumbers,
} from '../premiumAccessoryRules';

describe('premium accessory rules', () => {
  it('only treats Accessories category items as available accessories', () => {
    expect(hasAccessoryCategoryItems([
      { category: 'Tops' },
      { category: 'Shoes' },
    ])).toBe(false);

    expect(hasAccessoryCategoryItems([
      { category: 'Tops' },
      { category: 'Accessories' },
    ])).toBe(true);
  });

  it('does not require accessories when none exist', () => {
    const rules = buildAccessoryPromptRules(false);

    expect(rules).toContain('accessoryItemNumbers MUST be []');
    expect(rules).not.toContain('Every outfit MUST include');
  });

  it('rejects non-accessory item numbers before they can be selected as accessories', () => {
    const items: ClothingItem[] = [
      { id: 'top-1', category: 'Tops' },
      { id: 'bag-1', category: 'Accessories' },
      { category: 'Accessories' } as ClothingItem,
      { id: 'shoe-1', category: 'Shoes' },
    ];

    const result = resolveAccessoryItemNumbers(items, [1, 2, 3, 4, 5]);

    expect(result.accessories.map(item => item.id)).toEqual(['bag-1']);
    expect(result.rejections).toEqual([
      { itemNumber: 1, reason: 'wrong_category', category: 'Tops' },
      { itemNumber: 3, reason: 'missing_item' },
      { itemNumber: 4, reason: 'wrong_category', category: 'Shoes' },
      { itemNumber: 5, reason: 'out_of_range' },
    ]);
  });
});
