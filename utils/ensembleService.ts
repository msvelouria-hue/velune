import { auth, db } from '@/config/firebase';
import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  updateDoc,
  increment,
  arrayUnion
} from 'firebase/firestore';

export interface EnsembleRecord {
  id: string;
  userId: string;
  itemIds: string[];
  loved_count: number;
  comments: string[];
  last_viewed_at: string;
  updated_at: string;
  created_at: string;
  weather_context?: {
    temperature: number;
    condition: string;
  };
  event_context?: string;
}

class EnsembleService {
  private generateEnsembleId(itemIds: string[]): string {
    const sortedIds = [...itemIds].sort();
    let hash = 0;
    const str = sortedIds.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `ens_${Math.abs(hash).toString(36)}`;
  }

  async markEnsembleViewed(
    itemIds: string[],
    weatherContext?: { temperature: number; condition: string },
    eventContext?: string
  ): Promise<string | null> {
    const user = auth.currentUser;
    if (!user || itemIds.length === 0) return null;

    const sortedItemIds = [...itemIds].sort();
    const ensembleId = this.generateEnsembleId(sortedItemIds);
    const now = new Date().toISOString();

    try {
      const ensembleRef = doc(db, 'ensembles', `${user.uid}_${ensembleId}`);
      const existingDoc = await getDoc(ensembleRef);

      if (existingDoc.exists()) {
        await updateDoc(ensembleRef, {
          last_viewed_at: now,
          updated_at: now,
          ...(weatherContext && { weather_context: weatherContext }),
          ...(eventContext && { event_context: eventContext }),
        });
        console.log(`👁️ Updated ensemble view: ${ensembleId}`);
      } else {
        const newEnsemble: EnsembleRecord = {
          id: ensembleId,
          userId: user.uid,
          itemIds: sortedItemIds,
          loved_count: 0,
          comments: [],
          last_viewed_at: now,
          updated_at: now,
          created_at: now,
          ...(weatherContext && { weather_context: weatherContext }),
          ...(eventContext && { event_context: eventContext }),
        };
        await setDoc(ensembleRef, newEnsemble);
        console.log(`✅ Created new ensemble record: ${ensembleId}`);
      }

      return ensembleId;
    } catch (error: any) {
      console.warn('⚠️ Could not track ensemble view:', error?.message || error);
      return null;
    }
  }

  async recordLove(
    itemIds: string[],
    comment?: string
  ): Promise<boolean> {
    const user = auth.currentUser;
    if (!user || itemIds.length === 0) return false;

    const sortedItemIds = [...itemIds].sort();
    const ensembleId = this.generateEnsembleId(sortedItemIds);
    const now = new Date().toISOString();

    try {
      const ensembleRef = doc(db, 'ensembles', `${user.uid}_${ensembleId}`);
      const existingDoc = await getDoc(ensembleRef);

      if (existingDoc.exists()) {
        const updateData: any = {
          loved_count: increment(1),
          updated_at: now,
        };
        if (comment && comment.trim()) {
          updateData.comments = arrayUnion(`[${now.split('T')[0]}] ${comment.trim()}`);
        }
        await updateDoc(ensembleRef, updateData);
        console.log(`❤️ Incremented love count for ensemble: ${ensembleId}`);
      } else {
        const newEnsemble: EnsembleRecord = {
          id: ensembleId,
          userId: user.uid,
          itemIds: sortedItemIds,
          loved_count: 1,
          comments: comment?.trim() ? [`[${now.split('T')[0]}] ${comment.trim()}`] : [],
          last_viewed_at: now,
          updated_at: now,
          created_at: now,
        };
        await setDoc(ensembleRef, newEnsemble);
        console.log(`❤️ Created loved ensemble: ${ensembleId}`);
      }

      return true;
    } catch (error: any) {
      console.warn('⚠️ Could not record ensemble love:', error?.message || error);
      return false;
    }
  }

  async addComment(
    itemIds: string[],
    comment: string
  ): Promise<boolean> {
    const user = auth.currentUser;
    if (!user || itemIds.length === 0 || !comment.trim()) return false;

    const sortedItemIds = [...itemIds].sort();
    const ensembleId = this.generateEnsembleId(sortedItemIds);
    const now = new Date().toISOString();

    try {
      const ensembleRef = doc(db, 'ensembles', `${user.uid}_${ensembleId}`);
      const existingDoc = await getDoc(ensembleRef);

      if (existingDoc.exists()) {
        await updateDoc(ensembleRef, {
          comments: arrayUnion(`[${now.split('T')[0]}] ${comment.trim()}`),
          updated_at: now,
        });
        console.log(`💬 Added comment to ensemble: ${ensembleId}`);
        return true;
      } else {
        console.warn('⚠️ Ensemble not found, cannot add comment');
        return false;
      }
    } catch (error: any) {
      console.warn('⚠️ Could not add ensemble comment:', error?.message || error);
      return false;
    }
  }

  async getEnsemble(itemIds: string[]): Promise<EnsembleRecord | null> {
    const user = auth.currentUser;
    if (!user || itemIds.length === 0) return null;

    const sortedItemIds = [...itemIds].sort();
    const ensembleId = this.generateEnsembleId(sortedItemIds);

    try {
      const ensembleRef = doc(db, 'ensembles', `${user.uid}_${ensembleId}`);
      const docSnap = await getDoc(ensembleRef);

      if (docSnap.exists()) {
        return docSnap.data() as EnsembleRecord;
      }
      return null;
    } catch (error: any) {
      console.warn('⚠️ Could not fetch ensemble:', error?.message || error);
      return null;
    }
  }

  async getRecentlyViewedEnsembles(limitCount: number = 20): Promise<EnsembleRecord[]> {
    const user = auth.currentUser;
    if (!user) return [];

    try {
      const ensemblesRef = collection(db, 'ensembles');
      const q = query(
        ensemblesRef,
        where('userId', '==', user.uid),
        orderBy('last_viewed_at', 'desc'),
        limit(limitCount)
      );
      const snapshot = await getDocs(q);
      const ensembles: EnsembleRecord[] = [];
      snapshot.forEach((doc) => {
        ensembles.push(doc.data() as EnsembleRecord);
      });
      return ensembles;
    } catch (error: any) {
      console.warn('⚠️ Could not fetch recent ensembles:', error?.message || error);
      return [];
    }
  }

  async getLovedEnsembles(limitCount: number = 50): Promise<EnsembleRecord[]> {
    const user = auth.currentUser;
    if (!user) return [];

    try {
      const ensemblesRef = collection(db, 'ensembles');
      const q = query(
        ensemblesRef,
        where('userId', '==', user.uid),
        where('loved_count', '>', 0),
        orderBy('loved_count', 'desc'),
        limit(limitCount)
      );
      const snapshot = await getDocs(q);
      const ensembles: EnsembleRecord[] = [];
      snapshot.forEach((doc) => {
        ensembles.push(doc.data() as EnsembleRecord);
      });
      return ensembles;
    } catch (error: any) {
      console.warn('⚠️ Could not fetch loved ensembles:', error?.message || error);
      return [];
    }
  }

  async getEnsemblesForAI(): Promise<{
    recentlyViewed: { itemIds: string[]; last_viewed_at: string }[];
    loved: { itemIds: string[]; loved_count: number }[];
  }> {
    const user = auth.currentUser;
    if (!user) return { recentlyViewed: [], loved: [] };

    try {
      const [recent, loved] = await Promise.all([
        this.getRecentlyViewedEnsembles(30),
        this.getLovedEnsembles(20),
      ]);

      return {
        recentlyViewed: recent.map(e => ({
          itemIds: e.itemIds,
          last_viewed_at: e.last_viewed_at,
        })),
        loved: loved.map(e => ({
          itemIds: e.itemIds,
          loved_count: e.loved_count,
        })),
      };
    } catch (error: any) {
      console.warn('⚠️ Could not fetch ensembles for AI:', error?.message || error);
      return { recentlyViewed: [], loved: [] };
    }
  }
}

export const ensembleService = new EnsembleService();
