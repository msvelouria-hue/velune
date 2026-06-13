import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '@/config/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export interface ItemPreference {
  itemId: string;
  category: string;
  color?: string;
  style?: string;
  material?: string;
  likeCount: number;
  dislikeCount: number;
  lastUpdated: string;
}

export interface ColorPreference {
  color: string;
  likeCount: number;
  dislikeCount: number;
}

export interface StylePreference {
  style: string;
  likeCount: number;
  dislikeCount: number;
}

export interface CategoryPreference {
  category: string;
  likeCount: number;
  dislikeCount: number;
}

export interface CombinationPreference {
  topCategory: string;
  bottomCategory: string;
  topColor?: string;
  bottomColor?: string;
  likeCount: number;
  dislikeCount: number;
}

export interface WeatherStylePreference {
  temperatureRange: 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
  preferredStyles: string[];
  preferredColors: string[];
  likeCount: number;
}

export interface UserPreferences {
  items: { [itemId: string]: ItemPreference };
  colors: { [color: string]: ColorPreference };
  styles: { [style: string]: StylePreference };
  categories: { [category: string]: CategoryPreference };
  combinations: CombinationPreference[];
  weatherStyles: { [tempRange: string]: WeatherStylePreference };
  totalFeedbackCount: number;
  lastUpdated: string;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  items: {},
  colors: {},
  styles: {},
  categories: {},
  combinations: [],
  weatherStyles: {},
  totalFeedbackCount: 0,
  lastUpdated: new Date().toISOString(),
};

const PREFERENCE_STORAGE_KEY = 'userStylePreferences';

class PreferenceService {
  private preferences: UserPreferences | null = null;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async loadPreferences(): Promise<UserPreferences> {
    if (this.preferences) {
      return this.preferences;
    }

    try {
      const stored = await AsyncStorage.getItem(PREFERENCE_STORAGE_KEY);
      if (stored) {
        this.preferences = JSON.parse(stored);
        return this.preferences!;
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    }

    this.preferences = { ...DEFAULT_PREFERENCES };
    return this.preferences;
  }

  private async savePreferences(): Promise<void> {
    if (!this.preferences) return;

    this.preferences.lastUpdated = new Date().toISOString();

    try {
      await AsyncStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(this.preferences));
      console.log('✅ Preferences saved locally');
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  }

  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.savePreferences();
      this.syncToFirebase();
    }, 1000);
  }

  private removeUndefinedValues(obj: any): any {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => this.removeUndefinedValues(item)).filter(item => item !== undefined);
    }

    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.removeUndefinedValues(value);
      }
    }
    return cleaned;
  }

  async syncToFirebase(): Promise<void> {
    const user = auth.currentUser;
    if (!user || !this.preferences) return;

    try {
      const prefRef = doc(db, 'userPreferences', user.uid);
      const cleanedPreferences = this.removeUndefinedValues(this.preferences);
      await setDoc(prefRef, cleanedPreferences, { merge: true });
      console.log('☁️ Preferences synced to Firebase');
    } catch (error) {
      console.warn('Failed to sync preferences to Firebase:', error);
    }
  }

  async syncFromFirebase(): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const prefRef = doc(db, 'userPreferences', user.uid);
      const prefDoc = await getDoc(prefRef);

      if (prefDoc.exists()) {
        const cloudPrefs = prefDoc.data() as UserPreferences;
        const localPrefs = await this.loadPreferences();

        if (new Date(cloudPrefs.lastUpdated) > new Date(localPrefs.lastUpdated)) {
          this.preferences = cloudPrefs;
          await this.savePreferences();
          console.log('☁️ Loaded newer preferences from Firebase');
        }
      }
    } catch (error) {
      console.warn('Failed to sync preferences from Firebase:', error);
    }
  }

  getTemperatureRange(temp: number): 'cold' | 'cool' | 'mild' | 'warm' | 'hot' {
    if (temp < 40) return 'cold';
    if (temp < 55) return 'cool';
    if (temp < 70) return 'mild';
    if (temp < 85) return 'warm';
    return 'hot';
  }

  async recordOutfitFeedback(
    rating: 'thumbs-up' | 'thumbs-down',
    items: Array<{
      id: string;
      category: string;
      color?: string;
      style?: string;
      material?: string;
    }>,
    weather?: { temperature: number; condition: string },
    reasons?: string[]
  ): Promise<void> {
    const prefs = await this.loadPreferences();
    const isPositive = rating === 'thumbs-up';
    const increment = isPositive ? 1 : 0;
    const decrement = isPositive ? 0 : 1;

    for (const item of items) {
      if (!prefs.items[item.id]) {
        prefs.items[item.id] = {
          itemId: item.id,
          category: item.category,
          color: item.color,
          style: item.style,
          material: item.material,
          likeCount: 0,
          dislikeCount: 0,
          lastUpdated: new Date().toISOString(),
        };
      }
      prefs.items[item.id].likeCount += increment;
      prefs.items[item.id].dislikeCount += decrement;
      prefs.items[item.id].lastUpdated = new Date().toISOString();

      if (item.color) {
        const colorKey = item.color.toLowerCase();
        if (!prefs.colors[colorKey]) {
          prefs.colors[colorKey] = { color: colorKey, likeCount: 0, dislikeCount: 0 };
        }
        prefs.colors[colorKey].likeCount += increment;
        prefs.colors[colorKey].dislikeCount += decrement;
      }

      if (item.style) {
        const styleKey = item.style.toLowerCase();
        if (!prefs.styles[styleKey]) {
          prefs.styles[styleKey] = { style: styleKey, likeCount: 0, dislikeCount: 0 };
        }
        prefs.styles[styleKey].likeCount += increment;
        prefs.styles[styleKey].dislikeCount += decrement;
      }

      const catKey = item.category.toLowerCase();
      if (!prefs.categories[catKey]) {
        prefs.categories[catKey] = { category: catKey, likeCount: 0, dislikeCount: 0 };
      }
      prefs.categories[catKey].likeCount += increment;
      prefs.categories[catKey].dislikeCount += decrement;
    }

    const tops = items.filter(i => ['tops', 'outerwear'].includes(i.category.toLowerCase()));
    const bottoms = items.filter(i => ['bottoms', 'dresses'].includes(i.category.toLowerCase()));

    for (const top of tops) {
      for (const bottom of bottoms) {
        let combo = prefs.combinations.find(
          c => c.topCategory === top.category.toLowerCase() &&
               c.bottomCategory === bottom.category.toLowerCase() &&
               c.topColor === (top.color?.toLowerCase() || '') &&
               c.bottomColor === (bottom.color?.toLowerCase() || '')
        );

        if (!combo) {
          combo = {
            topCategory: top.category.toLowerCase(),
            bottomCategory: bottom.category.toLowerCase(),
            topColor: top.color?.toLowerCase() || '',
            bottomColor: bottom.color?.toLowerCase() || '',
            likeCount: 0,
            dislikeCount: 0,
          };
          prefs.combinations.push(combo);
        }

        combo.likeCount += increment;
        combo.dislikeCount += decrement;
      }
    }

    if (weather) {
      const tempRange = this.getTemperatureRange(weather.temperature);
      if (!prefs.weatherStyles[tempRange]) {
        prefs.weatherStyles[tempRange] = {
          temperatureRange: tempRange,
          preferredStyles: [],
          preferredColors: [],
          likeCount: 0,
        };
      }

      if (isPositive) {
        prefs.weatherStyles[tempRange].likeCount++;

        for (const item of items) {
          if (item.style && !prefs.weatherStyles[tempRange].preferredStyles.includes(item.style.toLowerCase())) {
            prefs.weatherStyles[tempRange].preferredStyles.push(item.style.toLowerCase());
          }
          if (item.color && !prefs.weatherStyles[tempRange].preferredColors.includes(item.color.toLowerCase())) {
            prefs.weatherStyles[tempRange].preferredColors.push(item.color.toLowerCase());
          }
        }
      }
    }

    prefs.totalFeedbackCount++;
    this.preferences = prefs;
    this.debouncedSave();

    console.log(`📊 Recorded ${rating} feedback for ${items.length} items. Total feedback: ${prefs.totalFeedbackCount}`);
  }

  async getItemScore(item: {
    id: string;
    category: string;
    color?: string;
    style?: string;
    material?: string;
  }, weather?: { temperature: number }): Promise<number> {
    const prefs = await this.loadPreferences();
    let score = 0;

    const itemPref = prefs.items[item.id];
    if (itemPref) {
      const total = itemPref.likeCount + itemPref.dislikeCount;
      if (total > 0) {
        const ratio = (itemPref.likeCount - itemPref.dislikeCount) / total;
        score += ratio * 20;
      }
    }

    if (item.color) {
      const colorPref = prefs.colors[item.color.toLowerCase()];
      if (colorPref) {
        const total = colorPref.likeCount + colorPref.dislikeCount;
        if (total > 0) {
          const ratio = (colorPref.likeCount - colorPref.dislikeCount) / total;
          score += ratio * 10;
        }
      }
    }

    if (item.style) {
      const stylePref = prefs.styles[item.style.toLowerCase()];
      if (stylePref) {
        const total = stylePref.likeCount + stylePref.dislikeCount;
        if (total > 0) {
          const ratio = (stylePref.likeCount - stylePref.dislikeCount) / total;
          score += ratio * 10;
        }
      }
    }

    const catPref = prefs.categories[item.category.toLowerCase()];
    if (catPref) {
      const total = catPref.likeCount + catPref.dislikeCount;
      if (total > 0) {
        const ratio = (catPref.likeCount - catPref.dislikeCount) / total;
        score += ratio * 5;
      }
    }

    if (weather) {
      const tempRange = this.getTemperatureRange(weather.temperature);
      const weatherPref = prefs.weatherStyles[tempRange];
      if (weatherPref && weatherPref.likeCount > 0) {
        if (item.style && weatherPref.preferredStyles.includes(item.style.toLowerCase())) {
          score += 8;
        }
        if (item.color && weatherPref.preferredColors.includes(item.color.toLowerCase())) {
          score += 5;
        }
      }
    }

    return score;
  }

  async getCombinationScore(
    topItem: { category: string; color?: string },
    bottomItem: { category: string; color?: string }
  ): Promise<number> {
    const prefs = await this.loadPreferences();

    const combo = prefs.combinations.find(
      c => c.topCategory === topItem.category.toLowerCase() &&
           c.bottomCategory === bottomItem.category.toLowerCase() &&
           c.topColor === (topItem.color?.toLowerCase() || '') &&
           c.bottomColor === (bottomItem.color?.toLowerCase() || '')
    );

    if (!combo) {
      const similarCombos = prefs.combinations.filter(
        c => c.topCategory === topItem.category.toLowerCase() &&
             c.bottomCategory === bottomItem.category.toLowerCase()
      );

      if (similarCombos.length > 0) {
        const avgLikes = similarCombos.reduce((sum, c) => sum + c.likeCount, 0) / similarCombos.length;
        const avgDislikes = similarCombos.reduce((sum, c) => sum + c.dislikeCount, 0) / similarCombos.length;
        const total = avgLikes + avgDislikes;
        if (total > 0) {
          return ((avgLikes - avgDislikes) / total) * 5;
        }
      }
      return 0;
    }

    const total = combo.likeCount + combo.dislikeCount;
    if (total === 0) return 0;

    const ratio = (combo.likeCount - combo.dislikeCount) / total;
    return ratio * 15;
  }

  async getPreferenceSummary(): Promise<{
    favoriteColors: string[];
    favoriteStyles: string[];
    dislikedColors: string[];
    dislikedStyles: string[];
    totalFeedback: number;
  }> {
    const prefs = await this.loadPreferences();

    const sortedColors = Object.values(prefs.colors)
      .map(c => ({ ...c, score: c.likeCount - c.dislikeCount }))
      .sort((a, b) => b.score - a.score);

    const sortedStyles = Object.values(prefs.styles)
      .map(s => ({ ...s, score: s.likeCount - s.dislikeCount }))
      .sort((a, b) => b.score - a.score);

    return {
      favoriteColors: sortedColors.filter(c => c.score > 0).slice(0, 5).map(c => c.color),
      favoriteStyles: sortedStyles.filter(s => s.score > 0).slice(0, 5).map(s => s.style),
      dislikedColors: sortedColors.filter(c => c.score < 0).slice(-3).map(c => c.color),
      dislikedStyles: sortedStyles.filter(s => s.score < 0).slice(-3).map(s => s.style),
      totalFeedback: prefs.totalFeedbackCount,
    };
  }

  async clearPreferences(options?: { removeFromStorage?: boolean }): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }

    if (options?.removeFromStorage) {
      this.preferences = null;
      await AsyncStorage.removeItem(PREFERENCE_STORAGE_KEY);
      console.log('🗑️ Preferences removed from local storage');
      return;
    }

    this.preferences = { ...DEFAULT_PREFERENCES };
    await this.savePreferences();
    console.log('🗑️ Preferences cleared');
  }
}

export const preferenceService = new PreferenceService();
