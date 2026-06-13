import { ClothingItem } from './wardrobeTypes';

export interface ClosetReplacementResult {
  items: ClothingItem[];
  refreshed: number;
  added: number;
  removed: number;
}

export function sortClosetItems(items: ClothingItem[]): ClothingItem[] {
  return [...items].sort((left, right) => {
    const leftDate = left.dateAdded || left.createdAt || '';
    const rightDate = right.dateAdded || right.createdAt || '';
    return rightDate.localeCompare(leftDate);
  });
}

export function replaceLocalClosetWithCloud(
  localItems: ClothingItem[],
  cloudItems: ClothingItem[]
): ClosetReplacementResult {
  const localById = new Map(localItems.map(item => [item.id, item]));
  const cloudIds = new Set(cloudItems.map(item => item.id));
  const added = cloudItems.filter(item => !localById.has(item.id)).length;
  const refreshed = cloudItems.filter(item => {
    const localItem = localById.get(item.id);
    return localItem && JSON.stringify(localItem) !== JSON.stringify(item);
  }).length;
  const removed = localItems.filter(item => !cloudIds.has(item.id)).length;

  return {
    items: sortClosetItems(cloudItems),
    refreshed,
    added,
    removed,
  };
}
