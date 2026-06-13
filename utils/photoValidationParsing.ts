export interface ParsedPhotoValidationResult {
  isValid: boolean;
  clothingItems: string[];
  message: string;
}

function extractClothingItemsFromText(text: string): string[] {
  const clothingKeywords = [
    'shirt', 't-shirt', 'blouse', 'sweater', 'hoodie', 'jacket', 'coat',
    'pants', 'jeans', 'shorts', 'skirt', 'dress', 'shoes', 'boots',
    'sneakers', 'hat', 'cap', 'belt', 'scarf', 'tie'
  ];

  const items: string[] = [];
  const words = text.toLowerCase().split(/\s+/);

  clothingKeywords.forEach(keyword => {
    if (words.some(word => word.includes(keyword))) {
      items.push(keyword);
    }
  });

  return items;
}

export function parsePhotoValidationResponse(content: string): ParsedPhotoValidationResult {
  const cleanedContent = content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    const result = JSON.parse(cleanedContent);
    return {
      isValid: Boolean(result.isValid),
      clothingItems: Array.isArray(result.clothingItems) ? result.clothingItems : [],
      message: typeof result.message === 'string' ? result.message : 'Analysis complete',
    };
  } catch (parseError) {
    console.warn('Failed to parse cleaned OpenAI response:', parseError);
    console.warn('Cleaned content was:', cleanedContent);

    return {
      isValid: content.toLowerCase().includes('valid'),
      clothingItems: extractClothingItemsFromText(content),
      message: content,
    };
  }
}
