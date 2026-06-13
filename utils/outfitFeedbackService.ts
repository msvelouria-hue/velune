import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '@/config/firebase';
import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, orderBy, limit, updateDoc } from 'firebase/firestore';

export interface OutfitFeedback {
  id?: string;
  date: string;
  itemIds: string[];
  items: {
    id: string;
    category: string;
    color?: string;
    style?: string;
    detectedType?: string;
  }[];
  thumbsUp: number;
  thumbsDown: number;
  notes?: string;
  feedbackReasons?: string[];
  weatherContext?: {
    temperature: number;
    condition: string;
  };
  eventContext?: string;
  createdAt: string;
  updatedAt: string;
}

const OUTFIT_FEEDBACK_KEY = 'outfitFeedback';

class OutfitFeedbackService {
  private cache: OutfitFeedback[] | null = null;

  async saveOutfitSuggestion(outfit: {
    items: any;
    weatherData?: any;
    calendarEvents?: any[];
  }): Promise<string> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No authenticated user');
    }

    const allItems: any[] = [];
    const itemIds: string[] = [];

    const addItem = (item: any) => {
      if (item) {
        allItems.push({
          id: item.id,
          category: item.category,
          color: item.color,
          style: item.style,
          detectedType: item.detectedType,
        });
        itemIds.push(item.id);
      }
    };

    if (outfit.items.dress) addItem(outfit.items.dress);
    if (outfit.items.top) addItem(outfit.items.top);
    if (outfit.items.baseLayer) addItem(outfit.items.baseLayer);
    if (outfit.items.midLayer) addItem(outfit.items.midLayer);
    if (outfit.items.outerLayer) addItem(outfit.items.outerLayer);
    if (outfit.items.bottom) addItem(outfit.items.bottom);
    if (outfit.items.shoes) addItem(outfit.items.shoes);
    if (outfit.items.outerwear) addItem(outfit.items.outerwear);
    if (outfit.items.accessories) {
      outfit.items.accessories.forEach((acc: any) => addItem(acc));
    }
    if (outfit.items.makeup) {
      (Array.isArray(outfit.items.makeup) ? outfit.items.makeup : [outfit.items.makeup])
        .forEach((m: any) => addItem(m));
    }

    const now = new Date().toISOString();
    const feedbackData: OutfitFeedback = {
      date: now.split('T')[0],
      itemIds,
      items: allItems,
      thumbsUp: 0,
      thumbsDown: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Only add optional fields if they have values (Firestore doesn't accept undefined)
    if (outfit.weatherData) {
      feedbackData.weatherContext = {
        temperature: outfit.weatherData.temperature,
        condition: outfit.weatherData.description || 'Unknown',
      };
    }
    if (outfit.calendarEvents?.[0]?.title) {
      feedbackData.eventContext = outfit.calendarEvents[0].title;
    }

    try {
      const outfitsRef = collection(db, 'users', user.uid, 'outfits');
      const docRef = await addDoc(outfitsRef, feedbackData);
      feedbackData.id = docRef.id;
      console.log('✅ Outfit suggestion saved to Firestore:', docRef.id);

      await this.cacheOutfitLocally(feedbackData);
      return docRef.id;
    } catch (error: any) {
      console.warn('⚠️ Could not save outfit to Firestore:', error.message);
      const localId = `local_${Date.now()}`;
      feedbackData.id = localId;
      await this.cacheOutfitLocally(feedbackData);
      return localId;
    }
  }

  async recordFeedback(
    outfitId: string,
    type: 'thumbs-up' | 'thumbs-down',
    reasons?: string[],
    notes?: string
  ): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;

    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };

    if (type === 'thumbs-up') {
      updateData.thumbsUp = 1;
    } else {
      updateData.thumbsDown = 1;
      if (reasons?.length) {
        updateData.feedbackReasons = reasons;
      }
      if (notes) {
        updateData.notes = notes;
      }
    }

    try {
      const outfitRef = doc(db, 'users', user.uid, 'outfits', outfitId);
      await updateDoc(outfitRef, updateData);
      console.log(`✅ Recorded ${type} feedback for outfit:`, outfitId);
    } catch (error: any) {
      console.warn('⚠️ Could not record feedback to Firestore:', error.message);
    }

    await this.updateLocalCache(outfitId, updateData);
  }

  async getRecentFeedback(limitCount: number = 50): Promise<OutfitFeedback[]> {
    const user = auth.currentUser;
    if (!user) return [];

    try {
      const outfitsRef = collection(db, 'users', user.uid, 'outfits');
      const q = query(
        outfitsRef,
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      const snapshot = await getDocs(q);
      const outfits: OutfitFeedback[] = [];
      snapshot.forEach((doc) => {
        outfits.push({ id: doc.id, ...doc.data() } as OutfitFeedback);
      });
      return outfits;
    } catch (error) {
      console.error('Error fetching feedback:', error);
      return this.getLocalCache();
    }
  }

  async getFeedbackWithNotes(): Promise<OutfitFeedback[]> {
    const allFeedback = await this.getRecentFeedback(100);
    return allFeedback.filter(f =>
      (f.thumbsDown > 0 && (f.notes || f.feedbackReasons?.length)) ||
      f.thumbsUp > 0
    );
  }

  async getLikedOutfits(): Promise<OutfitFeedback[]> {
    const allFeedback = await this.getRecentFeedback(100);
    return allFeedback.filter(f => f.thumbsUp > 0);
  }

  async getDislikedOutfits(): Promise<OutfitFeedback[]> {
    const allFeedback = await this.getRecentFeedback(100);
    return allFeedback.filter(f => f.thumbsDown > 0);
  }

  private async cacheOutfitLocally(outfit: OutfitFeedback): Promise<void> {
    try {
      const cached = await this.getLocalCache();
      cached.unshift(outfit);
      const trimmed = cached.slice(0, 100);
      await AsyncStorage.setItem(OUTFIT_FEEDBACK_KEY, JSON.stringify(trimmed));
      this.cache = trimmed;
    } catch (error) {
      console.error('Error caching outfit locally:', error);
    }
  }

  private async updateLocalCache(outfitId: string, update: any): Promise<void> {
    try {
      const cached = await this.getLocalCache();
      const index = cached.findIndex(o => o.id === outfitId);
      if (index >= 0) {
        cached[index] = { ...cached[index], ...update };
        await AsyncStorage.setItem(OUTFIT_FEEDBACK_KEY, JSON.stringify(cached));
        this.cache = cached;
      }
    } catch (error) {
      console.error('Error updating local cache:', error);
    }
  }

  private async getLocalCache(): Promise<OutfitFeedback[]> {
    if (this.cache) return this.cache;
    try {
      const data = await AsyncStorage.getItem(OUTFIT_FEEDBACK_KEY);
      this.cache = data ? JSON.parse(data) : [];
      return this.cache!;
    } catch (error) {
      return [];
    }
  }

  async clearCache(): Promise<void> {
    this.cache = null;
    await AsyncStorage.removeItem(OUTFIT_FEEDBACK_KEY);
  }
}

export const outfitFeedbackService = new OutfitFeedbackService();
