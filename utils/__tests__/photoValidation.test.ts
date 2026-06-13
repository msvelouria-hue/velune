import { describe, expect, it, jest } from '@jest/globals';
import { parsePhotoValidationResponse } from '../photoValidationParsing';

describe('parsePhotoValidationResponse', () => {
  it('parses fenced JSON responses', () => {
    const parsed = parsePhotoValidationResponse(`
\`\`\`json
{"isValid": true, "clothingItems": ["shirt", "jeans"], "message": "Looks good"}
\`\`\`
`);

    expect(parsed).toEqual({
      isValid: true,
      clothingItems: ['shirt', 'jeans'],
      message: 'Looks good',
    });
  });

  it('falls back gracefully when JSON is malformed', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const parsed = parsePhotoValidationResponse(
      'Valid wardrobe photo with a shirt and jacket, but not valid JSON'
    );

    expect(parsed.isValid).toBe(true);
    expect(parsed.clothingItems).toEqual(expect.arrayContaining(['shirt', 'jacket']));
    expect(parsed.message).toContain('Valid wardrobe photo');
    warnSpy.mockRestore();
  });
});
