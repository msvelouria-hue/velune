export interface OutfitValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  itemCounts: {
    tops: number;
    bottoms: number;
    dresses: number;
    shoes: number;
    outerwear: number;
    accessories: number;
    makeup: number;
    total: number;
  };
}

export interface OutfitItems {
  top?: any;
  bottom?: any;
  dress?: any;
  shoes?: any;
  outerwear?: any;
  baseLayer?: any;
  midLayer?: any;
  outerLayer?: any;
  accessories?: any[];
  makeup?: any[];
}

export function validateOutfitItems(items: OutfitItems, context?: string): OutfitValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const prefix = context ? `[${context}] ` : '';

  const itemCounts = {
    tops: 0,
    bottoms: 0,
    dresses: 0,
    shoes: 0,
    outerwear: 0,
    accessories: 0,
    makeup: 0,
    total: 0,
  };

  const validateItem = (item: any, category: string): boolean => {
    if (!item) return false;

    if (!item.id) {
      errors.push(`${prefix}${category} item missing ID`);
      return false;
    }

    if (typeof item.id !== 'string') {
      warnings.push(`${prefix}${category} item ID is not a string: ${typeof item.id}`);
    }

    return true;
  };

  if (items.top && validateItem(items.top, 'Top')) itemCounts.tops++;
  if (items.baseLayer && validateItem(items.baseLayer, 'Base Layer')) itemCounts.tops++;
  if (items.midLayer && validateItem(items.midLayer, 'Mid Layer')) itemCounts.tops++;
  if (items.outerLayer && validateItem(items.outerLayer, 'Outer Layer')) itemCounts.tops++;
  if (items.bottom && validateItem(items.bottom, 'Bottom')) itemCounts.bottoms++;
  if (items.dress && validateItem(items.dress, 'Dress')) itemCounts.dresses++;
  if (items.shoes && validateItem(items.shoes, 'Shoes')) itemCounts.shoes++;
  if (items.outerwear && validateItem(items.outerwear, 'Outerwear')) itemCounts.outerwear++;

  if (items.accessories && Array.isArray(items.accessories)) {
    items.accessories.forEach((acc, i) => {
      if (validateItem(acc, `Accessory[${i}]`)) itemCounts.accessories++;
    });
  }

  if (items.makeup && Array.isArray(items.makeup)) {
    items.makeup.forEach((m, i) => {
      if (validateItem(m, `Makeup[${i}]`)) itemCounts.makeup++;
    });
  }

  itemCounts.total = itemCounts.tops + itemCounts.bottoms + itemCounts.dresses +
                     itemCounts.shoes + itemCounts.outerwear +
                     itemCounts.accessories + itemCounts.makeup;

  const hasTop = itemCounts.tops > 0;
  const hasBottom = itemCounts.bottoms > 0;
  const hasDress = itemCounts.dresses > 0;
  const hasShoes = itemCounts.shoes > 0;

  if (!hasDress && !hasTop) {
    errors.push(`${prefix}Outfit missing top layer (no top, base/mid/outer layer, or dress)`);
  }

  if (!hasDress && !hasBottom) {
    errors.push(`${prefix}Outfit missing bottom (no bottom or dress)`);
  }

  if (!hasShoes) {
    warnings.push(`${prefix}Outfit missing shoes`);
  }

  if (itemCounts.total === 0) {
    errors.push(`${prefix}Outfit has no valid items`);
  }

  const isValid = errors.length === 0;

  if (warnings.length > 0) {
    console.warn(`⚠️ Outfit validation warnings:`, warnings);
  }

  if (errors.length > 0) {
    console.error(`❌ Outfit validation errors:`, errors);
  }

  return { isValid, warnings, errors, itemCounts };
}

export function assertOutfitValid(items: OutfitItems, context?: string): void {
  const result = validateOutfitItems(items, context);

  if (!result.isValid) {
    console.error(`Outfit validation failed for ${context || 'unknown'}:`, result.errors);
  }
}

export function validateOutfitSuggestion(outfit: any, index: number): OutfitValidationResult {
  const context = `Outfit ${index + 1}`;

  if (!outfit) {
    return {
      isValid: false,
      warnings: [],
      errors: [`${context}: Outfit is null or undefined`],
      itemCounts: { tops: 0, bottoms: 0, dresses: 0, shoes: 0, outerwear: 0, accessories: 0, makeup: 0, total: 0 },
    };
  }

  if (!outfit.items) {
    return {
      isValid: false,
      warnings: [],
      errors: [`${context}: Outfit has no items property`],
      itemCounts: { tops: 0, bottoms: 0, dresses: 0, shoes: 0, outerwear: 0, accessories: 0, makeup: 0, total: 0 },
    };
  }

  return validateOutfitItems(outfit.items, context);
}

export function logOutfitSummary(outfit: any, index: number): void {
  const result = validateOutfitSuggestion(outfit, index);

  console.log(`📦 Outfit ${index + 1} Summary:`, {
    valid: result.isValid,
    counts: result.itemCounts,
    warnings: result.warnings.length,
    errors: result.errors.length,
  });
}
