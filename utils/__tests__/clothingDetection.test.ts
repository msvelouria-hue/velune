import { describe, expect, it } from '@jest/globals';
import {
  createNeedsClarificationItem,
  getClothingCategory,
} from '../clothingDetectionHelpers';

describe('clothingDetection helpers', () => {
  it('maps sandals to shoes and unknown types to accessories', () => {
    expect(getClothingCategory('sandals')).toBe('Shoes');
    expect(getClothingCategory('Sandal heel')).toBe('Shoes');
    expect(getClothingCategory('shirt')).toBe('Tops');
    expect(getClothingCategory('mystery piece')).toBe('Accessories');
  });

  it('creates a clarification fallback item that flags manual review', () => {
    const item = createNeedsClarificationItem('clarify-1');

    expect(item).toMatchObject({
      id: 'clarify-1',
      name: 'Needs Clarification',
      detectedType: 'clarification',
      confidence: 0,
      needsAttention: true,
    });
    expect(item.detailedDescription?.details).toContain('Unable to identify');
  });
});
