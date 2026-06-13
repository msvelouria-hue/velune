import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '@/config/firebase';
import { backgroundRemovalQueue } from './backgroundRemoval';
import { replaceLocalClosetWithCloud, sortClosetItems } from './closetSourceOfTruth';
import {
  AI_DETAIL_FIELDS,
  AiDetailPayload,
  applyNeedsAttentionResolution,
  ClothingItem,
  shouldResolveNeedsAttentionAfterEdit,
} from './wardrobeTypes';

const CLOSET_ITEMS_KEY = 'clothingItems';
const LAST_SYNC_KEY = 'lastSyncTimestamp';

export interface CloudClothingItem extends ClothingItem {
  imageUrl: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshLocalFromCloudResult {
  cloudCount: number;
  localCountBefore: number;
  localCountAfter: number;
  refreshed: number;
  added: number;
  removedIncomplete: number;
  skippedDeleted: number;
}

type FirebaseUser = NonNullable<typeof auth.currentUser>;

type ClosetServerFetch = {
  promise: Promise<CloudClothingItem[]>;
  userId: string;
  mutationVersion: number;
};

class CloudSyncService {
  private activeClosetFetch: ClosetServerFetch | null = null;
  private activeClosetMutations = new Set<Promise<void>>();
  private closetMutationVersion = 0;

  private requireUser(): FirebaseUser {
    const user = auth.currentUser;

    if (!user) {
      throw new Error('You must be signed in to use your closet.');
    }

    return user;
  }

  private serializeFirestoreDate(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
    return '';
  }

  private stripUndefined<T extends Record<string, any>>(payload: T): T {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    ) as T;
  }

  private sortItems(items: ClothingItem[]): ClothingItem[] {
    return sortClosetItems(items);
  }

  private buildAiDetailPayload(source?: any, fallback?: any): AiDetailPayload {
    const detail = source?.detailedDescription || {};
    const fallbackDetail = fallback?.detailedDescription || {};
    const payload: AiDetailPayload = {};

    for (const field of AI_DETAIL_FIELDS) {
      const value = source?.[field] ?? detail[field] ?? fallback?.[field] ?? fallbackDetail[field];
      if (typeof value === 'string') {
        payload[field] = value;
      }
    }

    return payload;
  }

  private buildTagsPayload(source?: any, fallback?: any): ClothingItem['tags'] {
    const sourceDetail = source?.detailedDescription || {};
    const fallbackDetail = fallback?.detailedDescription || {};

    return source?.tags ?? fallback?.tags ?? {
      season: sourceDetail.season ?? fallbackDetail.season ?? [],
      event: sourceDetail.event ?? fallbackDetail.event ?? [],
    };
  }

  private buildLocalItemFromCloudDoc(docId: string, data: Record<string, any>): CloudClothingItem {
    const createdAt = this.serializeFirestoreDate(data.createdAt || data.dateAdded);
    const dateAdded = this.serializeFirestoreDate(data.dateAdded || data.createdAt) || createdAt;
    const updatedAt = this.serializeFirestoreDate(data.updatedAt);
    const imageUrl = data.imageUrl || data.processedImageUrl || data.originalImageUrl || data.photo || '';

    return this.stripUndefined({
      id: docId,
      photo: imageUrl,
      imageUrl,
      processedImageUrl: data.processedImageUrl,
      originalImageUrl: data.originalImageUrl,
      category: data.category || 'Uncategorized',
      color: data.color || '',
      pattern: data.pattern || '',
      material: data.material || '',
      style: data.style || '',
      ...this.buildAiDetailPayload(data),
      notes: data.notes || '',
      tags: this.buildTagsPayload(data),
      layerType: data.layerType,
      detectedType: data.detectedType,
      confidence: data.confidence,
      isAutoDetected: data.isAutoDetected,
      wornCount: data.wornCount || 0,
      lastWorn: data.lastWorn || '',
      lastSuggested: this.serializeFirestoreDate(data.lastSuggested),
      dateAdded,
      createdAt,
      updatedAt,
      dateModified: this.serializeFirestoreDate(data.dateModified),
      photoStatus: data.photoStatus || 'done',
      backgroundRemovalStatus: data.backgroundRemovalStatus,
      needsAttention: data.needsAttention === true,
      needsUserInput: data.needsUserInput === true,
      isEvaluating: data.isEvaluating === true,
      userId: data.userId || '',
    }) as CloudClothingItem;
  }

  private async readCache(): Promise<ClothingItem[]> {
    const rawItems = await AsyncStorage.getItem(CLOSET_ITEMS_KEY);
    const parsed = rawItems ? JSON.parse(rawItems) : [];
    return Array.isArray(parsed) ? parsed : [];
  }

  private async saveCache(items: ClothingItem[]): Promise<void> {
    await AsyncStorage.setItem(CLOSET_ITEMS_KEY, JSON.stringify(this.sortItems(items)));
    await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  }

  private async upsertCachedItem(item: ClothingItem): Promise<void> {
    const items = await this.readCache();
    const nextItems = items.filter(existing => existing.id !== item.id);
    nextItems.push(item);
    await this.saveCache(nextItems);
  }

  private async removeCachedItem(itemId: string): Promise<void> {
    const items = await this.readCache();
    await this.saveCache(items.filter(item => item.id !== itemId));
  }

  private closetCollectionQuery(userId: string) {
    return query(collection(db, 'closetItems'), where('userId', '==', userId));
  }

  private beginClosetMutation(): () => void {
    this.closetMutationVersion += 1;

    let resolveMutation: () => void = () => undefined;
    const mutation = new Promise<void>(resolve => {
      resolveMutation = resolve;
    });

    this.activeClosetMutations.add(mutation);

    return () => {
      this.activeClosetMutations.delete(mutation);
      this.closetMutationVersion += 1;
      resolveMutation();
    };
  }

  private async waitForActiveClosetMutations(): Promise<void> {
    while (this.activeClosetMutations.size > 0) {
      await Promise.all(Array.from(this.activeClosetMutations));
    }
  }

  private async fetchItemsFromServerOnce(): Promise<CloudClothingItem[]> {
    const user = this.requireUser();
    await this.waitForActiveClosetMutations();

    const mutationVersion = this.closetMutationVersion;
    if (
      this.activeClosetFetch &&
      this.activeClosetFetch.userId === user.uid &&
      this.activeClosetFetch.mutationVersion === mutationVersion
    ) {
      console.log('Sharing in-flight Firestore closet fetch');
      return this.activeClosetFetch.promise;
    }

    const fetchPromise = (async () => {
      const snapshot = await getDocsFromServer(this.closetCollectionQuery(user.uid));
      const items: CloudClothingItem[] = [];

      snapshot.forEach(itemDoc => {
        items.push(this.buildLocalItemFromCloudDoc(itemDoc.id, itemDoc.data()));
      });

      console.log(`Fetched ${items.length} closet items from Firestore server`);
      return this.sortItems(items) as CloudClothingItem[];
    })();

    this.activeClosetFetch = {
      promise: fetchPromise,
      userId: user.uid,
      mutationVersion,
    };

    try {
      return await fetchPromise;
    } finally {
      if (this.activeClosetFetch?.promise === fetchPromise) {
        this.activeClosetFetch = null;
      }
    }
  }

  private async fetchItemsFromServer(): Promise<CloudClothingItem[]> {
    await this.waitForActiveClosetMutations();
    const mutationVersionBeforeFetch = this.closetMutationVersion;
    const items = await this.fetchItemsFromServerOnce();

    if (mutationVersionBeforeFetch !== this.closetMutationVersion) {
      console.log('Closet changed during server fetch; refetching before updating local cache');
      return this.fetchItemsFromServerOnce();
    }

    return items;
  }

  async loadClosetItems(): Promise<ClothingItem[]> {
    try {
      const cloudItems = await this.fetchItemsFromServer();
      await this.saveCache(cloudItems);
      return cloudItems;
    } catch (error) {
      console.warn('Could not load closet from Firestore; showing cached items instead:', error);
      return this.sortItems(await this.readCache());
    }
  }

  async loadCachedItems(): Promise<ClothingItem[]> {
    return this.sortItems(await this.readCache());
  }

  async getItem(itemId: string): Promise<ClothingItem | null> {
    try {
      this.requireUser();
      const itemRef = doc(db, 'closetItems', itemId);
      const snapshot = await getDocFromServer(itemRef);

      if (!snapshot.exists()) {
        await this.removeCachedItem(itemId);
        return null;
      }

      const item = this.buildLocalItemFromCloudDoc(snapshot.id, snapshot.data());
      await this.upsertCachedItem(item);
      return item;
    } catch (error) {
      console.warn(`Could not load ${itemId} from Firestore; trying local cache:`, error);
      const cachedItems = await this.readCache();
      return cachedItems.find(item => item.id === itemId) || null;
    }
  }

  async fetchItemsFromCloud(): Promise<CloudClothingItem[]> {
    try {
      return await this.fetchItemsFromServer();
    } catch (error) {
      console.error('Error fetching closet from Firestore:', error);
      return [];
    }
  }

  async refreshLocalItemsFromCloud(options?: { updateLastSyncTime?: boolean }): Promise<RefreshLocalFromCloudResult> {
    const localItems = await this.readCache();

    try {
      const cloudItems = await this.fetchItemsFromServer();
      const replacement = replaceLocalClosetWithCloud(localItems, cloudItems);

      await AsyncStorage.setItem(CLOSET_ITEMS_KEY, JSON.stringify(replacement.items));
      if (options?.updateLastSyncTime ?? true) {
        await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      }

      return {
        cloudCount: cloudItems.length,
        localCountBefore: localItems.length,
        localCountAfter: replacement.items.length,
        refreshed: replacement.refreshed,
        added: replacement.added,
        removedIncomplete: replacement.removed,
        skippedDeleted: 0,
      };
    } catch (error) {
      console.error('Error refreshing closet from Firestore:', error);
      return {
        cloudCount: 0,
        localCountBefore: localItems.length,
        localCountAfter: localItems.length,
        refreshed: 0,
        added: 0,
        removedIncomplete: 0,
        skippedDeleted: 0,
      };
    }
  }

  async uploadImageToStorage(localUri: string, itemId: string): Promise<string> {
    const user = this.requireUser();
    const fileInfo = await FileSystem.getInfoAsync(localUri);

    if (!fileInfo.exists) {
      throw new Error('The selected photo could not be found on this device.');
    }

    const optimizedImage = await manipulateAsync(
      localUri,
      [{ resize: { width: 1200 } }],
      { compress: 0.85, format: SaveFormat.WEBP }
    );

    const response = await fetch(optimizedImage.uri);
    const blob = await response.blob();
    const imageRef = ref(storage, `users/${user.uid}/clothing/${itemId}/original.webp`);

    await uploadBytes(imageRef, blob, { contentType: 'image/webp' });
    return getDownloadURL(imageRef);
  }

  private buildNewItemPayload(item: any, userId: string, imageUrl: string): Record<string, any> {
    const now = new Date().toISOString();

    return this.stripUndefined({
      id: item.id,
      userId,
      imageUrl,
      category: item.category || 'Uncategorized',
      color: item.color || '',
      pattern: item.pattern || '',
      material: item.material || '',
      style: item.style || '',
      ...this.buildAiDetailPayload(item),
      notes: item.notes || '',
      tags: this.buildTagsPayload(item),
      layerType: item.layerType,
      detectedType: item.detectedType,
      confidence: item.confidence,
      isAutoDetected: item.isAutoDetected === true,
      wornCount: item.wornCount || 0,
      lastWorn: item.lastWorn || '',
      photoStatus: item.photoStatus || 'done',
      backgroundRemovalStatus: item.backgroundRemovalStatus,
      needsAttention: item.needsAttention === true,
      needsUserInput: item.needsUserInput === true,
      isEvaluating: item.isEvaluating === true,
      createdAt: item.createdAt || item.dateAdded || now,
      dateAdded: item.dateAdded || item.createdAt || now,
      updatedAt: serverTimestamp(),
    });
  }

  async syncItemToCloud(item: any): Promise<CloudClothingItem | null> {
    let finishMutation: (() => void) | null = null;

    try {
      const user = this.requireUser();
      const existingUrl = item.imageUrl || (!item.photo?.startsWith?.('file://') ? item.photo : '');
      const imageUrl = existingUrl || await this.uploadImageToStorage(item.photo, item.id);
      const itemRef = doc(db, 'closetItems', item.id);

      finishMutation = this.beginClosetMutation();
      await setDoc(itemRef, this.buildNewItemPayload(item, user.uid, imageUrl));

      const verified = await getDocFromServer(itemRef);
      if (!verified.exists()) {
        throw new Error('Firestore did not confirm the new closet item.');
      }

      const savedItem = this.buildLocalItemFromCloudDoc(verified.id, verified.data());
      await this.upsertCachedItem(savedItem);

      return savedItem;
    } catch (error) {
      console.error(`Failed to save closet item ${item?.id || ''} to Firestore:`, error);
      return null;
    } finally {
      finishMutation?.();
    }
  }

  private buildUpdatePayload(existingItem: ClothingItem, updatedItem: any): Record<string, any> {
    const shouldResolveNeedsAttention = shouldResolveNeedsAttentionAfterEdit(existingItem, updatedItem);
    const resolvedItem = shouldResolveNeedsAttention
      ? applyNeedsAttentionResolution({ ...existingItem, ...updatedItem })
      : { ...existingItem, ...updatedItem };

    return this.stripUndefined({
      category: updatedItem.category ?? existingItem.category,
      color: updatedItem.color ?? existingItem.color ?? '',
      pattern: updatedItem.pattern ?? existingItem.pattern ?? '',
      material: updatedItem.material ?? existingItem.material ?? '',
      style: updatedItem.style ?? existingItem.style ?? '',
      ...this.buildAiDetailPayload(updatedItem, existingItem),
      notes: updatedItem.notes ?? existingItem.notes ?? '',
      tags: this.buildTagsPayload(updatedItem, existingItem),
      layerType: updatedItem.layerType ?? existingItem.layerType ?? null,
      imageUrl: updatedItem.imageUrl ?? existingItem.imageUrl ?? existingItem.photo,
      processedImageUrl: updatedItem.processedImageUrl ?? existingItem.processedImageUrl,
      photoStatus: resolvedItem.photoStatus ?? existingItem.photoStatus ?? 'done',
      backgroundRemovalStatus: updatedItem.backgroundRemovalStatus ?? existingItem.backgroundRemovalStatus,
      backgroundRemovalFailed: updatedItem.backgroundRemovalFailed ?? existingItem.backgroundRemovalFailed,
      backgroundRemovalError: updatedItem.backgroundRemovalError ?? existingItem.backgroundRemovalError,
      wornCount: updatedItem.wornCount ?? existingItem.wornCount ?? 0,
      lastWorn: updatedItem.lastWorn ?? existingItem.lastWorn ?? '',
      lastSuggested: updatedItem.lastSuggested ?? existingItem.lastSuggested,
      needsAttention: resolvedItem.needsAttention === true,
      needsUserInput: resolvedItem.needsUserInput === true,
      isEvaluating: resolvedItem.isEvaluating === true,
      updatedAt: serverTimestamp(),
      dateModified: new Date().toISOString(),
    });
  }

  async updateItem(updatedItem: any): Promise<boolean> {
    let finishMutation: (() => void) | null = null;

    try {
      const user = this.requireUser();
      const itemRef = doc(db, 'closetItems', updatedItem.id);
      const existingSnapshot = await getDocFromServer(itemRef);

      if (!existingSnapshot.exists()) {
        console.error(`Cannot update ${updatedItem.id}: Firestore document does not exist.`);
        return false;
      }

      const existingItem = this.buildLocalItemFromCloudDoc(existingSnapshot.id, existingSnapshot.data());
      if (existingItem.userId && existingItem.userId !== user.uid) {
        console.error(`Cannot update ${updatedItem.id}: item belongs to a different user.`);
        return false;
      }

      let itemForUpdate = updatedItem;
      if (updatedItem.photo?.startsWith?.('file://')) {
        const imageUrl = await this.uploadImageToStorage(updatedItem.photo, updatedItem.id);
        itemForUpdate = {
          ...updatedItem,
          imageUrl,
          photo: imageUrl,
        };
      }

      const updatePayload = this.buildUpdatePayload(existingItem, itemForUpdate);
      finishMutation = this.beginClosetMutation();
      await setDoc(itemRef, { ...updatePayload, userId: user.uid }, { merge: true });

      const verified = await getDocFromServer(itemRef);
      if (!verified.exists()) {
        console.error(`Cannot verify update for ${updatedItem.id}: Firestore document disappeared.`);
        return false;
      }

      const verifiedItem = this.buildLocalItemFromCloudDoc(verified.id, verified.data());
      if (updatedItem.category && verifiedItem.category !== updatedItem.category) {
        console.error(`Cannot verify update for ${updatedItem.id}: category did not save.`);
        return false;
      }

      await this.upsertCachedItem(verifiedItem);
      return true;
    } catch (error) {
      console.error(`Failed to update closet item ${updatedItem?.id || ''}:`, error);
      return false;
    } finally {
      finishMutation?.();
    }
  }

  private async deleteStorageFolder(folderPath: string): Promise<void> {
    try {
      const folder = await listAll(ref(storage, folderPath));
      await Promise.all(folder.items.map(fileRef => deleteObject(fileRef).catch(() => undefined)));
    } catch {
      // Storage cleanup is best-effort. Firestore is the source of truth for whether a card exists.
    }
  }

  async deleteItemFromCloud(itemId: string): Promise<boolean> {
    let finishMutation: (() => void) | null = null;

    try {
      const user = this.requireUser();
      const itemRef = doc(db, 'closetItems', itemId);

      try {
        const beforeDelete = await getDocFromServer(itemRef);
        if (beforeDelete.exists()) {
          const data = beforeDelete.data();
          if (data.userId && data.userId !== user.uid) {
            console.error(`Cannot delete ${itemId}: item belongs to a different user.`);
            return false;
          }
        }
      } catch (error) {
        console.warn(`Could not pre-check ${itemId} before delete; Firestore rules will enforce ownership:`, error);
      }

      finishMutation = this.beginClosetMutation();
      await deleteDoc(itemRef);

      try {
        const afterDelete = await getDocFromServer(itemRef);
        if (afterDelete.exists()) {
          console.error(`Cannot verify delete for ${itemId}: Firestore document still exists.`);
          return false;
        }
      } catch (error) {
        console.warn(`Delete for ${itemId} was accepted, but post-delete verification could not complete:`, error);
      }

      await this.deleteStorageFolder(`users/${user.uid}/clothing/${itemId}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete closet item ${itemId} from Firestore:`, error);
      return false;
    } finally {
      finishMutation?.();
    }
  }

  async deleteItem(itemId: string): Promise<{ success: boolean; localDeleted: boolean; cloudDeleted: boolean }> {
    const cloudDeleted = await this.deleteItemFromCloud(itemId);

    if (cloudDeleted) {
      await this.removeCachedItem(itemId);
    }

    return {
      success: cloudDeleted,
      localDeleted: cloudDeleted,
      cloudDeleted,
    };
  }

  async triggerAsyncBackgroundRemoval(itemId: string, imageUrl: string): Promise<void> {
    if (!auth.currentUser) return;

    if (backgroundRemovalQueue.isItemCompleted(itemId) || backgroundRemovalQueue.isItemInFlight(itemId)) {
      return;
    }

    try {
      const functions = getFunctions();
      const processBackgroundRemovalAsync = httpsCallable(functions, 'processBackgroundRemovalAsync', {
        timeout: 5000,
      });

      processBackgroundRemovalAsync({ itemId, originalImageUrl: imageUrl }).catch(() => undefined);
    } catch (error) {
      console.error(`Failed to trigger background removal for ${itemId}:`, error);
    }
  }

  async checkCompletedBackgroundRemovals(): Promise<number> {
    const result = await this.refreshLocalItemsFromCloud({ updateLastSyncTime: false });
    return result.refreshed + result.added;
  }

  async getLastSyncTime(): Promise<string | null> {
    return AsyncStorage.getItem(LAST_SYNC_KEY);
  }
}

export const cloudSyncService = new CloudSyncService();
