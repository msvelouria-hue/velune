export type LayerType = 'base' | 'mid' | 'outer';

export type PhotoStatus =
  | 'pending'
  | 'uploading'
  | 'evaluating'
  | 'done'
  | 'needs_clarification'
  | 'background_removed'
  | 'approved'
  | 'rejected';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface ClothingItemTags {
  season?: string[];
  event?: string[];
}

export const AI_DETAIL_FIELDS = [
  'fit',
  'silhouette',
  'neckline',
  'sleeveLength',
  'length',
  'closure',
  'rise',
  'wash',
  'heelHeight',
  'toeShape',
  'hardware',
  'brandOrLogo',
  'formality',
  'warmth',
  'layeringRole',
  'stylingNotes',
] as const;

export type AiDetailField = typeof AI_DETAIL_FIELDS[number];
export type AiDetailPayload = Partial<Record<AiDetailField, string>>;

export type AiClothingDescription = AiDetailPayload & {
  color: string;
  pattern: string;
  material: string;
  style: string;
  fit: string;
  details: string;
  season?: string[];
  event?: string[];
};

export interface ClothingItem {
  id: string;
  category: string;
  color?: string;
  pattern?: string;
  material?: string;
  style?: string;
  fit?: string;
  silhouette?: string;
  neckline?: string;
  sleeveLength?: string;
  length?: string;
  closure?: string;
  rise?: string;
  wash?: string;
  heelHeight?: string;
  toeShape?: string;
  hardware?: string;
  brandOrLogo?: string;
  formality?: string;
  warmth?: string;
  layeringRole?: string;
  stylingNotes?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  dateAdded?: string;
  dateModified?: string;
  photo?: string;
  imageUrl?: string;
  localPhoto?: string;
  processedImageUrl?: string;
  originalPhoto?: string;
  originalImageUrl?: string;
  thumbnail?: string;
  tags?: ClothingItemTags;
  layerType?: LayerType;
  detectedType?: string;
  displayCategory?: string;
  confidence?: number;
  aiDetected?: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  photoStatus?: PhotoStatus;
  backgroundRemovalStatus?: 'pending' | 'processing' | 'complete' | 'failed';
  backgroundRemovalFailed?: boolean;
  backgroundRemovalError?: string;
  isEvaluating?: boolean;
  needsAttention?: boolean;
  needsUserInput?: boolean;
  isAutoDetected?: boolean;
  wornCount?: number;
  lastWorn?: string;
  lastSuggested?: string;
  userId?: string;
}

const LEGACY_STATUS_MAP: Record<string, PhotoStatus> = {
  approved: 'approved',
  'background removed': 'background_removed',
  background_removed: 'background_removed',
  done: 'done',
  evaluating: 'evaluating',
  'needs clarification': 'needs_clarification',
  needs_clarification: 'needs_clarification',
  pending: 'pending',
  rejected: 'rejected',
  uploading: 'uploading',
};

const PHOTO_STATUS_LABELS: Record<PhotoStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  evaluating: 'Evaluating',
  done: 'Done',
  needs_clarification: 'Needs Clarification',
  background_removed: 'Background Removed',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function normalizePhotoStatus(value?: string | null): PhotoStatus | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedKey = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ');

  return LEGACY_STATUS_MAP[normalizedKey];
}

export function formatPhotoStatus(value?: string | null): string {
  const normalized = normalizePhotoStatus(value);

  if (!normalized) {
    return value?.trim() || '';
  }

  return PHOTO_STATUS_LABELS[normalized];
}

export function hasNeedsAttentionStatus(value?: string | null): boolean {
  return normalizePhotoStatus(value) === 'needs_clarification';
}

export function itemNeedsAttention(
  item?: Pick<ClothingItem, 'photoStatus' | 'needsAttention' | 'needsUserInput'> | null
): boolean {
  if (!item) {
    return false;
  }

  return (
    hasNeedsAttentionStatus(item.photoStatus) ||
    Boolean(item.needsAttention) ||
    Boolean(item.needsUserInput)
  );
}

export function shouldResolveNeedsAttentionAfterEdit(
  existingItem: Pick<ClothingItem, 'photoStatus' | 'needsAttention' | 'needsUserInput'> | null | undefined,
  updatedItem: Partial<Pick<ClothingItem, 'category'>>
): boolean {
  return itemNeedsAttention(existingItem) && typeof updatedItem.category === 'string' && updatedItem.category.trim().length > 0;
}

export function applyNeedsAttentionResolution<T extends Partial<ClothingItem>>(item: T): T {
  return {
    ...item,
    photoStatus: 'done',
    needsAttention: false,
    needsUserInput: false,
    isEvaluating: false,
  };
}
