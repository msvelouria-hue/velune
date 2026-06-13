import type { AiClothingDescription } from './wardrobeTypes';

export interface ClarificationDetectedItem {
  id: string;
  name: string;
  detectedType: string;
  confidence: number;
  needsAttention?: boolean;
  detailedDescription?: AiClothingDescription;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const CLOTHING_CATEGORIES: Record<string, string> = {
  'shirt': 'Tops',
  't-shirt': 'Tops',
  'blouse': 'Tops',
  'tank': 'Tops',
  'top': 'Tops',
  'sweater': 'Tops',
  'hoodie': 'Tops',
  'sweatshirt': 'Tops',
  'pullover': 'Tops',
  'fleece': 'Outerwear',
  'jacket': 'Outerwear',
  'coat': 'Outerwear',
  'blazer': 'Outerwear',
  'cardigan': 'Outerwear',
  'vest': 'Outerwear',
  'pants': 'Bottoms',
  'jeans': 'Bottoms',
  'shorts': 'Bottoms',
  'skirt': 'Bottoms',
  'leggings': 'Bottoms',
  'trousers': 'Bottoms',
  'dress': 'Dresses',
  'gown': 'Dresses',
  'jumpsuit': 'Dresses',
  'romper': 'Dresses',
  'shoes': 'Shoes',
  'sneakers': 'Shoes',
  'boots': 'Shoes',
  'sandals': 'Shoes',
  'sandal': 'Shoes',
  'heels': 'Shoes',
  'flats': 'Shoes',
  'slippers': 'Shoes',
  'loafers': 'Shoes',
  'oxfords': 'Shoes',
  'hat': 'Accessories',
  'cap': 'Accessories',
  'beanie': 'Accessories',
  'bag': 'Accessories',
  'purse': 'Accessories',
  'backpack': 'Accessories',
  'belt': 'Accessories',
  'scarf': 'Accessories',
  'gloves': 'Accessories',
  'hair clip': 'Accessories',
  'claw clip': 'Accessories',
  'barrette': 'Accessories',
  'headband': 'Accessories',
  'hair accessory': 'Accessories',
  'necklace': 'Accessories',
  'bracelet': 'Accessories',
  'earrings': 'Accessories',
  'ring': 'Accessories',
  'watch': 'Accessories',
  'lipstick': 'Makeup',
  'lip gloss': 'Makeup',
  'eyeshadow': 'Makeup',
  'mascara': 'Makeup',
  'foundation': 'Makeup',
  'concealer': 'Makeup',
  'blush': 'Makeup',
  'bronzer': 'Makeup',
  'highlighter': 'Makeup',
  'eyeliner': 'Makeup',
  'lip liner': 'Makeup',
  'palette': 'Makeup',
  'powder': 'Makeup',
  'primer': 'Makeup',
  'setting spray': 'Makeup',
  'makeup brush': 'Makeup',
  'beauty blender': 'Makeup',
  'nail polish': 'Makeup',
  'makeup': 'Makeup',
  'cosmetics': 'Makeup',
};

export function getClothingCategory(detectedType: string): string {
  const detectedTypeLower = detectedType.toLowerCase();

  if (detectedTypeLower.includes('sandal')) {
    return 'Shoes';
  }

  return CLOTHING_CATEGORIES[detectedTypeLower] || 'Accessories';
}

export function createNeedsClarificationItem(
  id: string = `item_${Date.now()}`
): ClarificationDetectedItem {
  return {
    id,
    name: 'Needs Clarification',
    detectedType: 'clarification',
    confidence: 0,
    needsAttention: true,
    detailedDescription: {
      color: '',
      pattern: '',
      material: '',
      style: '',
      fit: '',
      details: 'Unable to identify clothing items in this image. Please try a clearer photo or manual entry.',
    },
    boundingBox: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    },
  };
}

export { CLOTHING_CATEGORIES };
