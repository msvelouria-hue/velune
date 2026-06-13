export const DRESS_CODE_PRESETS = [
  'Concert black',
  'Business casual',
  'Cocktail',
  'Formal',
  'Black tie',
  'Athletic',
] as const;

export const normalizeDressCodeInput = (value?: string | null): string =>
  (value || '').replace(/\s+/g, ' ').trim();

type DressCodeItem = {
  category?: string;
  color?: string;
  style?: string;
  material?: string;
  pattern?: string;
  notes?: string;
  detectedType?: string;
  formality?: string;
  tags?: {
    event?: string[];
  };
};

const includesAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const isCoreVisibleCategory = (category: string): boolean =>
  ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'].includes(category);

const readsAsDressy = (itemText: string): boolean =>
  includesAny(itemText, [
    'formal',
    'business',
    'smart casual',
    'dressy',
    'polished',
    'blazer',
    'button',
    'loafer',
    'heel',
    'pump',
    'flat',
    'dress shoe',
    'gown',
  ]);

const readsAsAthletic = (itemText: string): boolean =>
  includesAny(itemText, [
    'athletic',
    'sport',
    'gym',
    'running',
    'trainer',
    'sneaker',
    'legging',
    'workout',
    'yoga',
  ]);

export const requiresBlackClothing = (dressCode?: string | null): boolean => {
  const normalized = normalizeDressCodeInput(dressCode).toLowerCase();

  return includesAny(normalized, [
    'concert black',
    'all black',
    'all-black',
    'black attire',
    'wear black',
    'dress in black',
    'black dress code',
    'black clothing',
  ]);
};

export const buildDressCodePromptGuidance = (dressCode?: string | null): string => {
  const normalized = normalizeDressCodeInput(dressCode);
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  const guidance: string[] = [];

  if (requiresBlackClothing(normalized)) {
    guidance.push(
      'Treat this as a hard color constraint: prioritize black visible clothing and avoid bright, loud, or high-contrast pieces unless there are not enough black wardrobe options.'
    );
    guidance.push(
      'For concert black, choose performance-appropriate pieces: polished, comfortable, modest enough for stage, and easy to move or sit in.'
    );
  }

  if (includesAny(lower, ['business casual', 'smart casual'])) {
    guidance.push('Aim for polished pieces; avoid athletic, loungewear, distressed, or overly casual items.');
  }

  if (includesAny(lower, ['cocktail', 'wedding', 'date night'])) {
    guidance.push('Lean dressy and intentional, with polished shoes and elevated accessories.');
  }

  if (includesAny(lower, ['black tie', 'formal', 'gala'])) {
    guidance.push('Lean formal, elegant, and refined.');
  }

  if (includesAny(lower, ['athletic', 'gym', 'workout', 'hike', 'hiking'])) {
    guidance.push('Prioritize athletic or performance-friendly pieces and practical footwear.');
  }

  if (includesAny(lower, ['no jeans', 'no denim'])) {
    guidance.push('Do not include jeans or denim pieces.');
  }

  return guidance.join(' ');
};

export const scoreItemForDressCode = (item: DressCodeItem, dressCode?: string | null): number => {
  const normalized = normalizeDressCodeInput(dressCode).toLowerCase();
  if (!normalized) return 0;

  const category = (item.category || '').toLowerCase();
  const color = (item.color || '').toLowerCase();
  const pattern = (item.pattern || '').toLowerCase();
  const itemText = [
    item.category,
    item.color,
    item.style,
    item.material,
    item.pattern,
    item.notes,
    item.detectedType,
    item.formality,
    ...(item.tags?.event || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 0;

  if (requiresBlackClothing(normalized) && isCoreVisibleCategory(category)) {
    score += color.includes('black') ? 24 : -28;

    if (includesAny(pattern, ['graphic', 'floral', 'stripe', 'plaid', 'print']) && !color.includes('black')) {
      score -= 8;
    }

    if (readsAsDressy(itemText)) {
      score += 4;
    }
  }

  if (includesAny(normalized, ['business casual', 'smart casual'])) {
    if (readsAsDressy(itemText)) score += 10;
    if (readsAsAthletic(itemText) || includesAny(itemText, ['loungewear', 'sweatpant', 'distressed'])) {
      score -= 12;
    }
  }

  if (includesAny(normalized, ['cocktail', 'wedding', 'date night'])) {
    if (readsAsDressy(itemText) || includesAny(itemText, ['party', 'silk', 'satin'])) score += 10;
    if (readsAsAthletic(itemText) || includesAny(itemText, ['loungewear'])) score -= 12;
  }

  if (includesAny(normalized, ['black tie', 'formal', 'gala'])) {
    if (readsAsDressy(itemText)) score += 12;
    if (readsAsAthletic(itemText) || includesAny(itemText, ['casual', 'loungewear'])) score -= 10;
  }

  if (includesAny(normalized, ['athletic', 'gym', 'workout', 'hike', 'hiking'])) {
    if (readsAsAthletic(itemText)) score += 14;
    if (readsAsDressy(itemText) && category !== 'shoes') score -= 6;
  }

  if (includesAny(normalized, ['no jeans', 'no denim']) && includesAny(itemText, ['jean', 'denim'])) {
    score -= 30;
  }

  return score;
};

export const buildDressCodeReasoning = (dressCode?: string | null): string | null => {
  const normalized = normalizeDressCodeInput(dressCode);
  if (!normalized) return null;

  if (requiresBlackClothing(normalized)) {
    return `${normalized} (black, polished, performance-ready)`;
  }

  return normalized;
};
