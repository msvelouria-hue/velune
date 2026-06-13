import type { ClothingItem } from './dailyPicksTypes';

export type AccessoryItemNumberRejectionReason =
  | 'out_of_range'
  | 'missing_item'
  | 'wrong_category';

export interface AccessoryItemNumberRejection {
  itemNumber: number;
  reason: AccessoryItemNumberRejectionReason;
  category?: string;
}

export interface AccessoryItemNumberResolution {
  accessories: ClothingItem[];
  rejections: AccessoryItemNumberRejection[];
}

export function isAccessoryCategoryItem(item: Pick<ClothingItem, 'category'>): boolean {
  return item.category?.toLowerCase() === 'accessories';
}

export function hasAccessoryCategoryItems(items: Array<Pick<ClothingItem, 'category'>>): boolean {
  return items.some(isAccessoryCategoryItem);
}

export function buildAccessoryPromptRules(hasAccessoryItems: boolean): string {
  if (!hasAccessoryItems) {
    return `- ACCESSORIES:
  * The wardrobe has no items in the Accessories category
  * accessoryItemNumbers MUST be [] for every outfit
  * Do not put Tops, Bottoms, Dresses, Outerwear, Shoes, or Makeup items in accessoryItemNumbers`;
  }

  return `- ACCESSORIES (HARD RULE):
  * Every outfit MUST include 1-3 accessory items in accessoryItemNumbers
  * At minimum, include ONE accessory item ID per outfit
  * Accessories MAY repeat across outfits
  * VALIDATION: Reject any outfit with empty accessoryItemNumbers`;
}

export function resolveAccessoryItemNumbers(
  items: ClothingItem[],
  itemNumbers: number[]
): AccessoryItemNumberResolution {
  const accessories: ClothingItem[] = [];
  const rejections: AccessoryItemNumberRejection[] = [];

  for (const itemNumber of itemNumbers) {
    if (itemNumber < 1 || itemNumber > items.length) {
      rejections.push({ itemNumber, reason: 'out_of_range' });
      continue;
    }

    const item = items[itemNumber - 1];
    if (!item?.id) {
      rejections.push({ itemNumber, reason: 'missing_item' });
      continue;
    }

    if (!isAccessoryCategoryItem(item)) {
      rejections.push({
        itemNumber,
        reason: 'wrong_category',
        category: item.category,
      });
      continue;
    }

    accessories.push(item);
  }

  return { accessories, rejections };
}
