import { describe, expect, it } from '@jest/globals';
import {
  applyNeedsAttentionResolution,
  formatPhotoStatus,
  itemNeedsAttention,
  normalizePhotoStatus,
  shouldResolveNeedsAttentionAfterEdit,
} from '../wardrobeTypes';

describe('wardrobeTypes', () => {
  it('normalizes canonical and legacy photo status spellings', () => {
    expect(normalizePhotoStatus('pending')).toBe('pending');
    expect(normalizePhotoStatus('Pending')).toBe('pending');
    expect(normalizePhotoStatus('Uploading')).toBe('uploading');
    expect(normalizePhotoStatus('Evaluating')).toBe('evaluating');
    expect(normalizePhotoStatus('Needs Clarification')).toBe('needs_clarification');
    expect(normalizePhotoStatus('Needs clarification')).toBe('needs_clarification');
    expect(normalizePhotoStatus('needs_clarification')).toBe('needs_clarification');
    expect(normalizePhotoStatus('background_removed')).toBe('background_removed');
    expect(normalizePhotoStatus('Background Removed')).toBe('background_removed');
    expect(normalizePhotoStatus('Approved')).toBe('approved');
    expect(normalizePhotoStatus('Rejected')).toBe('rejected');
    expect(normalizePhotoStatus(null)).toBeUndefined();
    expect(normalizePhotoStatus('')).toBeUndefined();
  });

  it('formats normalized statuses for display', () => {
    expect(formatPhotoStatus('needs_clarification')).toBe('Needs Clarification');
    expect(formatPhotoStatus('Needs clarification')).toBe('Needs Clarification');
    expect(formatPhotoStatus('background_removed')).toBe('Background Removed');
    expect(formatPhotoStatus('')).toBe('');
    expect(formatPhotoStatus('Custom Status')).toBe('Custom Status');
  });

  it('resolves a needs-attention item after the user edits it with a category', () => {
    const existingItem = {
      id: 'item-1',
      category: 'Uncategorized',
      photoStatus: 'needs_clarification' as const,
      needsAttention: true,
      needsUserInput: true,
    };
    const edit = {
      category: 'Tops',
      notes: 'Resolved by user',
    };

    expect(itemNeedsAttention(existingItem)).toBe(true);
    expect(shouldResolveNeedsAttentionAfterEdit(existingItem, edit)).toBe(true);

    const resolved = applyNeedsAttentionResolution({
      ...existingItem,
      ...edit,
    });

    expect(resolved).toMatchObject({
      category: 'Tops',
      photoStatus: 'done',
      needsAttention: false,
      needsUserInput: false,
      isEvaluating: false,
    });
    expect(itemNeedsAttention(resolved)).toBe(false);
  });
});
