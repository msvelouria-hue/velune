import { describe, expect, it } from '@jest/globals';
import {
  buildDressCodePromptGuidance,
  normalizeDressCodeInput,
  requiresBlackClothing,
  scoreItemForDressCode,
} from '../dressCode';

describe('dressCode', () => {
  it('normalizes free-form dress code text', () => {
    expect(normalizeDressCodeInput('  concert   black  ')).toBe('concert black');
  });

  it('treats concert black as a black clothing requirement', () => {
    expect(requiresBlackClothing('concert black')).toBe(true);
    expect(requiresBlackClothing('black tie')).toBe(false);
  });

  it('boosts black pieces and penalizes non-black visible pieces for concert black', () => {
    const blackTopScore = scoreItemForDressCode(
      { category: 'Tops', color: 'black', style: 'polished blouse' },
      'concert black'
    );
    const redTopScore = scoreItemForDressCode(
      { category: 'Tops', color: 'red', style: 'polished blouse' },
      'concert black'
    );

    expect(blackTopScore).toBeGreaterThan(redTopScore);
    expect(redTopScore).toBeLessThan(0);
  });

  it('adds concert black guidance without losing the raw dress code text', () => {
    const guidance = buildDressCodePromptGuidance('concert black');

    expect(guidance).toContain('hard color constraint');
    expect(guidance).toContain('performance-appropriate');
  });
});
