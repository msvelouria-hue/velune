import { describe, expect, it } from '@jest/globals';
import { buildPremiumOutfitReasoning } from '../premiumOutfitReasoning';

describe('buildPremiumOutfitReasoning', () => {
  it('uses freshnessReasoning for the freshness row and generic reasoning for style', () => {
    const reasoning = buildPremiumOutfitReasoning(
      {
        reasoning: 'The proportions stay clean and the colors feel intentional together.',
        occasion: 'Creative office day',
        freshnessReasoning: 'It rotates away from pieces you saw yesterday to keep the mix feeling new.',
      },
      {
        temperature: 68,
        tempUnit: 'F',
        description: 'Sunny',
      },
      [{ title: 'Design review' }]
    );

    expect(reasoning).toEqual({
      weather: '68°F, Sunny',
      events: 'Design review',
      style: 'The proportions stay clean and the colors feel intentional together.',
      freshness:
        'It rotates away from pieces you saw yesterday to keep the mix feeling new.',
    });
  });

  it('falls back to a freshness-safe default when the AI omits freshnessReasoning', () => {
    const reasoning = buildPremiumOutfitReasoning(
      {
        reasoning: 'Easy layers keep the outfit polished without feeling overdone.',
        occasion: 'Coffee catch-up',
      },
      null,
      []
    );

    expect(reasoning.freshness).toBe(
      'Built around wardrobe rotation so the outfit still feels fresh today'
    );
    expect(reasoning.style).toBe(
      'Easy layers keep the outfit polished without feeling overdone.'
    );
  });

  it('includes dress code context in event reasoning', () => {
    const reasoning = buildPremiumOutfitReasoning(
      {
        reasoning: 'Black separates keep the stage look unified.',
      },
      null,
      [{ title: 'Orchestra concert' }],
      'concert black'
    );

    expect(reasoning.events).toContain('Orchestra concert');
    expect(reasoning.events).toContain('Dress code: concert black');
  });
});
