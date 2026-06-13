import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import { preferenceService } from './preferenceService';
import { logPrompt } from './promptLogService';
import { getUserProfile, MakeupPreferenceLevel } from './userProfileService';
import { secureAiProxy } from './secureAiProxy';
import { fetchWeatherForCoordinates } from './weatherService';
import {
  formatWeatherForDisplay,
  formatWeatherRange,
  getWeatherTemperatureContext,
  toFahrenheit,
  type WeatherTemperatureContext,
} from './weatherUtils';
import {
  buildDressCodeReasoning,
  normalizeDressCodeInput,
  scoreItemForDressCode,
} from './dressCode';
import type {
  CalendarEvent,
  ClothingItem,
  DailyOutfitSuggestion,
  HairSuggestion,
  OutfitFeedbackRecord,
  WeatherData,
} from './dailyPicksTypes';

interface WeatherCondition {
  temperature: number;
  feelsLike?: number;
  lowTemperature?: number;
  highTemperature?: number;
  tempUnit?: string;
  condition: string;
  humidity?: number;
  windSpeed?: number;
  description?: string;
}

interface StylistPersonality {
  id: string;
  name: string;
  style: string;
  phrases: string[];
  priorities: string[];
  recommendations: {
    casual: string[];
    formal: string[];
    weather: string[];
  };
}

export interface OutfitRecommendation {
  top: ClothingItem | null;
  bottom: ClothingItem | null;
  shoes: ClothingItem | null;
  outerwear?: ClothingItem | null;
  accessories?: ClothingItem[];
  styleReasoning: string;
  weatherAppropriate: boolean;
  stylistComment?: string;
  hairSuggestion?: HairSuggestion;
}

export class OutfitSelectionService {
  private userTemperaturePreference: 'cold' | 'neutral' | 'warm' = 'neutral';

  // Calculate wind chill for more accurate "feels like" temperature
  // Uses the NWS wind chill formula (for temps <= 50°F and wind >= 3 mph)
  private calculateFeelsLike(tempF: number, windSpeedMph: number, humidity: number): number {
    let feelsLike = tempF;

    // Wind chill applies when temp <= 50°F and wind >= 3 mph
    if (tempF <= 50 && windSpeedMph >= 3) {
      feelsLike = 35.74 + (0.6215 * tempF) - (35.75 * Math.pow(windSpeedMph, 0.16)) + (0.4275 * tempF * Math.pow(windSpeedMph, 0.16));
    }

    // High humidity makes cold feel colder (damp cold)
    if (humidity > 70 && tempF < 65) {
      feelsLike -= (humidity - 70) * 0.1; // Subtract up to 3 degrees for very humid conditions
    }

    return Math.round(feelsLike);
  }

  private buildWeatherContext(weather: WeatherData | null): WeatherTemperatureContext {
    const currentF = weather ? toFahrenheit(weather.temperature, weather.tempUnit) : 68;
    const calculatedFeelsLikeF = weather
      ? this.calculateFeelsLike(currentF, weather.windSpeed || 0, weather.humidity || 50)
      : currentF;
    const tempAdjustment = this.getTemperatureAdjustment(this.userTemperaturePreference);

    return getWeatherTemperatureContext(weather, tempAdjustment, calculatedFeelsLikeF);
  }

  private formatWeatherCondition(weather: WeatherCondition): string {
    return formatWeatherForDisplay({
      ...weather,
      description: weather.description || weather.condition,
    });
  }

  // Get user's temperature sensitivity preference
  private async getUserTemperaturePreference(): Promise<'cold' | 'neutral' | 'warm'> {
    try {
      const pref = await AsyncStorage.getItem('temperaturePreference');
      if (pref === 'cold' || pref === 'neutral' || pref === 'warm') {
        return pref;
      }
      return 'neutral';
    } catch {
      return 'neutral';
    }
  }

  // Get temperature adjustment based on user preference
  // Returns degrees Fahrenheit to ADD to thresholds (positive = user runs cold, needs warmer clothes at higher temps)
  private getTemperatureAdjustment(preference: 'cold' | 'neutral' | 'warm'): number {
    switch (preference) {
      case 'cold': return 8; // User runs cold - treat 68°F like 60°F (suggest warmer clothes)
      case 'warm': return -5; // User runs warm - treat 60°F like 65°F (suggest lighter clothes)
      default: return 0;
    }
  }

  // Infer layer type from detectedType, category, style, and material
  // Returns 'base' for t-shirts/tanks, 'mid' for sweaters/hoodies, 'outer' for jackets/coats
  private inferLayerType(item: ClothingItem): 'base' | 'mid' | 'outer' | null {
    // CRITICAL: Exclude non-clothing categories from layer inference
    // Accessories, Makeup, Shoes, and Bottoms should NEVER be considered layers
    const category = (item.category || '').toLowerCase();
    const nonLayerCategories = ['accessories', 'makeup', 'shoes', 'bottoms', 'dresses'];
    if (nonLayerCategories.includes(category)) {
      return null;
    }

    // If explicitly set, use it
    if (item.layerType) return item.layerType;

    const detectedType = (item.detectedType || '').toLowerCase();
    const style = (item.style || '').toLowerCase();
    const material = (item.material || '').toLowerCase();
    const notes = (item.notes || '').toLowerCase();

    // Outer layer items (jackets, coats, blazers)
    const outerKeywords = ['jacket', 'coat', 'blazer', 'parka', 'windbreaker', 'vest', 'trench', 'puffer', 'bomber', 'denim jacket', 'leather jacket', 'rain jacket'];
    if (category === 'outerwear' || outerKeywords.some(k =>
      detectedType.includes(k) || style.includes(k) || notes.includes(k)
    )) {
      return 'outer';
    }

    // Mid layer items (sweaters, hoodies, cardigans, fleeces)
    const midKeywords = ['sweater', 'hoodie', 'cardigan', 'pullover', 'sweatshirt', 'fleece', 'knit', 'turtleneck', 'crewneck'];
    if (midKeywords.some(k =>
      detectedType.includes(k) || style.includes(k) || material.includes(k) || notes.includes(k)
    )) {
      return 'mid';
    }

    // Base layer items (t-shirts, tanks, blouses, button-ups)
    const baseKeywords = ['t-shirt', 'tee', 'tank', 'blouse', 'shirt', 'polo', 'camisole', 'crop top', 'button'];
    if (category === 'tops' || baseKeywords.some(k =>
      detectedType.includes(k) || style.includes(k) || notes.includes(k)
    )) {
      return 'base';
    }

    return null;
  }

  // Check if an item is a "base only" item that shouldn't be worn alone in cool weather
  // (t-shirts, tank tops, sleeveless items)
  private isBaseOnlyItem(item: ClothingItem): boolean {
    const detectedType = (item.detectedType || '').toLowerCase();
    const style = (item.style || '').toLowerCase();
    const notes = (item.notes || '').toLowerCase();
    const material = (item.material || '').toLowerCase();

    // Items that are definitely base-only (need layering in cool weather)
    const baseOnlyKeywords = ['t-shirt', 'tee', 'tank', 'sleeveless', 'camisole', 'crop', 'thin', 'light'];

    // Check if it's a thin/light top
    if (baseOnlyKeywords.some(k =>
      detectedType.includes(k) || style.includes(k) || notes.includes(k) || material.includes(k)
    )) {
      return true;
    }

    // Mid-layer items are NOT base-only (can be worn alone)
    const layerType = this.inferLayerType(item);
    if (layerType === 'mid' || layerType === 'outer') {
      return false;
    }

    // Default: if it's a "Tops" category without specific mid-layer keywords, treat as base-only
    if (item.category === 'Tops') {
      const midKeywords = ['sweater', 'hoodie', 'cardigan', 'pullover', 'sweatshirt', 'fleece'];
      if (!midKeywords.some(k =>
        detectedType.includes(k) || style.includes(k) || notes.includes(k)
      )) {
        return true;
      }
    }

    return false;
  }

  private stylistPersonalities: StylistPersonality[] = [
    {
      id: 'Emma',
      name: 'Emma',
      style: 'trendy and bold',
      phrases: [
        "This look is absolutely on-trend!",
        "You're going to turn heads with this combo!",
        "Perfect for your Instagram story!",
        "This screams main character energy!",
        "So chic and current!"
      ],
      priorities: ['pattern mixing', 'statement pieces', 'current trends', 'bold colors'],
      recommendations: {
        casual: ["Try layering different textures", "Mix patterns for visual interest", "Add a statement accessory"],
        formal: ["Go bold with a pop of color", "Choose pieces with interesting details", "Don't be afraid to stand out"],
        weather: ["Layer stylishly for warmth", "Bright colors for gloomy days", "Weather is no excuse to be boring!"]
      }
    },
    {
      id: 'Sophie',
      name: 'Sophie',
      style: 'classic and elegant',
      phrases: [
        "Timeless elegance never goes out of style.",
        "This combination exudes sophistication.",
        "A classic choice that works every time.",
        "Refined and polished - perfect!",
        "This will look great today and in 10 years."
      ],
      priorities: ['quality over quantity', 'neutral colors', 'classic silhouettes', 'versatile pieces'],
      recommendations: {
        casual: ["Stick to classic combinations", "Neutral colors always work", "Invest in quality basics"],
        formal: ["Opt for timeless silhouettes", "Less is more with accessories", "Focus on fit and quality"],
        weather: ["Layer thoughtfully", "Choose quality outerwear", "Comfort meets elegance"]
      }
    },
    {
      id: 'Maya',
      name: 'Maya',
      style: 'creative and artistic',
      phrases: [
        "What a creative color combination!",
        "I love how artistic this looks!",
        "This outfit tells a story!",
        "So unique and expressive!",
        "Fashion is art, and this is a masterpiece!"
      ],
      priorities: ['unique combinations', 'artistic expression', 'creative mixing', 'personal style'],
      recommendations: {
        casual: ["Don't be afraid to experiment", "Mix unexpected elements", "Express your creativity"],
        formal: ["Add an artistic touch", "Make it uniquely yours", "Break some fashion rules"],
        weather: ["Make weather functional AND beautiful", "Use layers as art", "Every season is inspiration"]
      }
    },
    {
      id: 'Gary',
      name: 'Gary',
      style: 'honest and fearless',
      phrases: [
        "Honey, this look is SERVING!",
        "Absolutely yes to this combination!",
        "You're about to serve some serious looks!",
        "This is giving main character vibes!",
        "Stunning! No notes!",
        "This outfit said 'I'm THAT person' and I'm here for it!"
      ],
      priorities: ['confidence', 'authenticity', 'making a statement', 'feeling fabulous'],
      recommendations: {
        casual: ["Own your look, darling", "Confidence is your best accessory", "Make casual feel special"],
        formal: ["Serve elegance with personality", "Make them remember you", "Formal doesn't mean boring"],
        weather: ["Weather is temporary, style is forever", "Make practical look amazing", "No excuses for not looking good"]
      }
    },
    {
      id: 'Marcus',
      name: 'Marcus',
      style: 'modern and sharp',
      phrases: [
        "Sharp and modern - excellent choice.",
        "This combination shows attention to detail.",
        "Clean lines and perfect fit.",
        "Professional and polished.",
        "This demonstrates great style sense."
      ],
      priorities: ['clean lines', 'perfect fit', 'attention to detail', 'modern aesthetics'],
      recommendations: {
        casual: ["Keep it clean and well-fitted", "Focus on quality materials", "Simple can be stunning"],
        formal: ["Sharp silhouettes are key", "Pay attention to fit", "Details matter"],
        weather: ["Function and form together", "Clean layers work best", "Stay sharp in any weather"]
      }
    }
  ];

  async getCurrentWeather(): Promise<WeatherData | null> {
    try {
      // Get user location
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission not granted');
        return null;
      }

      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;
      return fetchWeatherForCoordinates({
        latitude,
        longitude,
        accuracy: location.coords.accuracy,
      });
    } catch (error) {
      console.error('Error fetching weather:', error);
      return null;
    }
  }

  async getTodaysCalendarEvents(): Promise<CalendarEvent[]> {
    try {
      // On iOS, we need BOTH Calendar and Reminders permissions to access calendar events
      // Request calendar permissions first
      const { status: calendarStatus } = await Calendar.getCalendarPermissionsAsync();
      if (calendarStatus !== 'granted') {
        const { status: newCalendarStatus } = await Calendar.requestCalendarPermissionsAsync();
        if (newCalendarStatus !== 'granted') {
          console.log('ℹ️ Calendar permission not granted, skipping calendar integration');
          return [];
        }
      }

      // Request reminders permissions (required on iOS to access calendars)
      // Note: iOS requires this even though we're only reading calendar events, not reminders
      const { status: remindersStatus } = await Calendar.getRemindersPermissionsAsync();
      if (remindersStatus !== 'granted') {
        const { status: newRemindersStatus } = await Calendar.requestRemindersPermissionsAsync();
        if (newRemindersStatus !== 'granted') {
          console.log('ℹ️ Reminders permission not granted - iOS requires this to access calendar events');
          return [];
        }
      }

      console.log('✅ Both Calendar and Reminders permissions granted');

      const calendars = await Calendar.getCalendarsAsync();
      console.log(`📅 Found ${calendars.length} calendars: ${calendars.map(c => c.title).join(', ')}`);

      if (calendars.length === 0) {
        console.log('📅 No calendars found on device');
        return [];
      }

      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      const events = await Calendar.getEventsAsync(
        calendars.map(cal => cal.id),
        startOfDay,
        endOfDay
      );

      console.log(`📅 Found ${events.length} calendar events for today`);
      if (events.length > 0) {
        console.log(`📅 Events: ${events.map(e => e.title).join(', ')}`);
      }

      return events.map(event => ({
        id: event.id,
        title: event.title,
        startDate: event.startDate instanceof Date ? event.startDate.toISOString() : new Date(event.startDate).toISOString(),
        endDate: event.endDate instanceof Date ? event.endDate.toISOString() : new Date(event.endDate).toISOString(),
        location: event.location ?? undefined,
        allDay: event.allDay,
      }));
    } catch (error: any) {
      // Check if it's a permission error
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('REMINDERS permission') || errorMessage.includes('permission')) {
        console.log('ℹ️ Calendar access requires additional iOS permissions - continuing without calendar integration');
        return [];
      }
      // Only log non-permission errors as warnings
      console.warn('⚠️ Could not access calendar:', errorMessage);
      return [];
    }
  }

  async getClothingItems(): Promise<ClothingItem[]> {
    try {
      const itemsData = await AsyncStorage.getItem('clothingItems');
      if (!itemsData) return [];
      const items = JSON.parse(itemsData);
      return items;
    } catch (error) {
      console.error('Error loading clothing items:', error);
      return [];
    }
  }

  private getRecentlyWornItems(items: ClothingItem[], days: number = 7): ClothingItem[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return items.filter(item => {
      if (!item.lastWorn) return false;
      const lastWornDate = new Date(item.lastWorn);
      return lastWornDate > cutoffDate;
    });
  }

  // Select layered tops based on temperature and style
  private async selectLayeredTops(
    items: ClothingItem[],
    weather: WeatherData | null,
    events: CalendarEvent[],
    recentlyWorn: ClothingItem[],
    usedItemIds: string[],
    seed: number,
    dressCode: string
  ): Promise<{ items: any; usedIds: string[]; reasoning: string }> {
    const weatherContext = this.buildWeatherContext(weather);
    const weatherLabel = formatWeatherRange(weather);

    const result: any = {};
    const newUsedIds: string[] = [];
    let layerCount = 0;
    let reasoningParts: string[] = [];

    // Determine layering strategy based on temperature
    // Cold (< 10°C / 50°F): 3 layers (base + mid + outer)
    // Cool (10-18°C / 50-64°F): 2 layers (base + mid OR base + outer)
    // Moderate (18-24°C / 64-75°F): 1 layer (base only)
    // Warm (> 24°C / 75°F): 1 layer (base, preferably light material)

    if (weather && (weatherContext.coolNowWarmLater || weatherContext.coldNowWarmerLater)) {
      const preferOuterLayer = weatherContext.effectiveCurrentF < 55;
      let hasRemovableLayer = false;

      if (preferOuterLayer) {
        const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
        if (outerLayer) {
          result.outerLayer = outerLayer;
          newUsedIds.push(outerLayer.id);
          layerCount++;
          hasRemovableLayer = true;
        }
      }

      if (!hasRemovableLayer) {
        const midLayer = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 1, dressCode);
        if (midLayer) {
          result.midLayer = midLayer;
          newUsedIds.push(midLayer.id);
          layerCount++;
          hasRemovableLayer = true;
        }
      }

      if (!hasRemovableLayer && !preferOuterLayer) {
        const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 2, dressCode);
        if (outerLayer) {
          result.outerLayer = outerLayer;
          newUsedIds.push(outerLayer.id);
          layerCount++;
          hasRemovableLayer = true;
        }
      }

      const baseLayer = await this.selectItemByLayerType(items, 'base', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 3, dressCode);
      if (baseLayer) {
        result.baseLayer = baseLayer;
        newUsedIds.push(baseLayer.id);
        layerCount++;
      }

      reasoningParts.push(`${weatherLabel} - base outfit for the warmer part of the day with a removable layer now`);
    } else if (weatherContext.effectiveCurrentF < 50) {
      // Very cold - attempt 3 layers

      // Base layer
      const baseLayer = await this.selectItemByLayerType(items, 'base', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
      if (baseLayer) {
        result.baseLayer = baseLayer;
        newUsedIds.push(baseLayer.id);
        layerCount++;
      }

      // Mid layer
      const midLayer = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 1, dressCode);
      if (midLayer) {
        result.midLayer = midLayer;
        newUsedIds.push(midLayer.id);
        layerCount++;
      }

      // Outer layer
      const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 2, dressCode);
      if (outerLayer) {
        result.outerLayer = outerLayer;
        newUsedIds.push(outerLayer.id);
        layerCount++;
      }

      // Add reasoning based on actual layers selected
      reasoningParts.push(`Cold weather (${weatherLabel}) - ${layerCount}-layer system for warmth`);
    } else if (weatherContext.effectiveCurrentF < 64) {
      // Cool - attempt 2 layers (t-shirts MUST have a layer over them at this temp)

      // Try to get mid or outer layer first to ensure we have something warm
      let hasWarmLayer = false;

      // Try mid layer first
      const midLayer = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
      if (midLayer) {
        result.midLayer = midLayer;
        newUsedIds.push(midLayer.id);
        layerCount++;
        hasWarmLayer = true;
      }

      // Also try outer layer if no mid layer found, or if it's on the cooler side
      if (!hasWarmLayer || weatherContext.effectiveCurrentF < 57) {
        const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 1, dressCode);
        if (outerLayer) {
          result.outerLayer = outerLayer;
          newUsedIds.push(outerLayer.id);
          layerCount++;
          hasWarmLayer = true;
        }
      }

      // Now select base layer if we have a warm layer to go over it
      // OR if we couldn't find any warm layers (use a sweater/mid-layer type top as the single layer)
      if (hasWarmLayer) {
        // We have a warm layer, so we can use a t-shirt as base
        const baseLayer = await this.selectItemByLayerType(items, 'base', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed + 2, dressCode);
        if (baseLayer) {
          result.baseLayer = baseLayer;
          newUsedIds.push(baseLayer.id);
          layerCount++;
        }
      } else {
        // No warm layers available - try to use a mid-layer item (sweater/hoodie) as the main top
        // This prevents recommending a t-shirt alone in cool weather
        const midAsBase = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
        if (midAsBase) {
          result.baseLayer = midAsBase; // Use the mid-layer item as the base
          newUsedIds.push(midAsBase.id);
          layerCount++;
          reasoningParts.push(`Cool weather requires warmer top - selected ${midAsBase.style || 'sweater'}`);
        } else {
          // Last resort: warn that we don't have appropriate layers
          reasoningParts.push(`⚠️ No warm layers available - consider adding sweaters or jackets to your closet`);

          // Still pick a base layer but note the issue
          const baseLayer = await this.selectItemByLayerType(items, 'base', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
          if (baseLayer && !this.isBaseOnlyItem(baseLayer)) {
            // It's a thicker top (like a long-sleeve), use it
            result.baseLayer = baseLayer;
            newUsedIds.push(baseLayer.id);
            layerCount++;
          }
        }
      }

      // Add reasoning based on actual layers selected
      reasoningParts.push(`Cool weather (${weatherLabel}) - ${layerCount}-layer system`);
    } else {
      // Moderate to warm - 1 layer

      // Just base layer
      const baseLayer = await this.selectItemByLayerType(items, 'base', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
      if (baseLayer) {
        result.baseLayer = baseLayer;
        newUsedIds.push(baseLayer.id);
        layerCount++;
      }

      reasoningParts.push(`Comfortable weather (${weatherLabel}) - single layer`);
    }

    // Fallback: if no layered items found, use traditional top selection
    if (layerCount === 0) {
      // IMPORTANT: Use usedItemIds.concat(newUsedIds) to exclude any items already selected
      const top = await this.selectItemByCategory(items, 'Tops', weather, events, recentlyWorn, usedItemIds.concat(newUsedIds), seed, dressCode);
      if (top) {
        result.top = top;
        newUsedIds.push(top.id);
        reasoningParts.push('Selected single top');
      }
    }

    const reasoning = reasoningParts.join('; ');
    return { items: result, usedIds: newUsedIds, reasoning };
  }

  // Select item by specific layer type
  private async selectItemByLayerType(
    items: ClothingItem[],
    layerType: 'base' | 'mid' | 'outer',
    weather: WeatherData | null,
    events: CalendarEvent[],
    recentlyWorn: ClothingItem[],
    excludeIds: string[],
    seed: number,
    dressCode: string
  ): Promise<ClothingItem | null> {
    // Filter items by layer type using the inferLayerType helper
    const layerItems = items.filter(item => {
      if (excludeIds.includes(item.id)) return false;

      // Use the centralized inferLayerType function
      const inferredLayer = this.inferLayerType(item);
      return inferredLayer === layerType;
    });

    if (layerItems.length === 0) return null;

    // Use the existing scoring logic from selectItemByCategory
    return this.selectItemByCategory(layerItems, layerItems[0].category, weather, events, recentlyWorn, excludeIds, seed, dressCode);
  }

  private async selectItemByCategory(items: ClothingItem[], category: string, weather: WeatherData | null, events: CalendarEvent[], recentlyWorn: ClothingItem[], excludeIds: string[] = [], seed: number = 0, dressCode: string = ''): Promise<ClothingItem | null> {
    const categoryItems = items.filter(item => {
      // Fix category mapping - sandals should be shoes, not accessories
      let itemCategory = item.category;

      // Check all possible places where sandals might be identified
      const isSandal = item.style?.toLowerCase().includes('sandal') ||
                      item.notes?.toLowerCase().includes('sandal') ||
                      (item as any).detectedType?.toLowerCase().includes('sandal') ||
                      item.notes?.toLowerCase().includes('auto-detected') && item.notes?.toLowerCase().includes('sandal');

      if (isSandal) {
        itemCategory = 'Shoes';
      }

      // Basic category filtering
      if (itemCategory !== category || excludeIds.includes(item.id)) {
        return false;
      }

      // Weather-based shoe filtering: exclude sandals in cold weather
      if (category === 'Shoes' && weather && isSandal) {
        const weatherContext = this.buildWeatherContext(weather);

        // Don't suggest sandals when the wearable part of the day stays cold.
        if (weatherContext.baseOutfitTemperatureF < 60) {
          return false;
        }
      }

      // Weather-based shorts filtering: exclude shorts in cool/cold weather
      if (category === 'Bottoms' && weather) {
        const isShorts = item.style?.toLowerCase().includes('short') ||
                        item.notes?.toLowerCase().includes('short') ||
                        (item as any).detectedType?.toLowerCase().includes('short');

        if (isShorts) {
          const weatherContext = this.buildWeatherContext(weather);

          // Don't suggest shorts when the day does not warm enough for them.
          if (weatherContext.baseOutfitTemperatureF < 68) {
            return false;
          }
        }
      }

      return true;
    });
    if (categoryItems.length === 0) return null;

    // Apply feedback filtering
    const feedbackFilteredItems = await this.applyFeedbackToSelection(categoryItems, category, weather);

    // Filter out recently worn items from feedback-filtered items
    const availableItems = feedbackFilteredItems.filter(item =>
      !recentlyWorn.some(worn => worn.id === item.id)
    );

    // Strict recency guard: exclude items worn OR suggested today/yesterday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const notWornTodayOrYesterday = feedbackFilteredItems.filter(item => {
      // Check lastWorn
      if (item.lastWorn) {
        const lastWornDate = new Date(item.lastWorn);
        lastWornDate.setHours(0, 0, 0, 0);
        if (lastWornDate >= yesterday) return false;
      }
      // Check lastSuggested (if present)
      if ((item as any).lastSuggested) {
        const lastSuggestedDate = new Date((item as any).lastSuggested);
        lastSuggestedDate.setHours(0, 0, 0, 0);
        if (lastSuggestedDate >= yesterday) return false;
      }
      return true;
    });

    // Create a filter for items not worn in the last 2 days (slightly less strict)
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const notWornIn2Days = feedbackFilteredItems.filter(item => {
      if (!item.lastWorn && !(item as any).lastSuggested) return true;
      const lastDate = new Date(item.lastWorn || (item as any).lastSuggested);
      lastDate.setHours(0, 0, 0, 0);
      return lastDate < twoDaysAgo;
    });

    // Prioritize: fresh items > not worn today/yesterday > not worn in 2 days > all items
    // Items worn/suggested today or yesterday are absolute last resort
    const itemsToChooseFrom = availableItems.length > 0 ? availableItems :
                              notWornTodayOrYesterday.length > 0 ? notWornTodayOrYesterday :
                              notWornIn2Days.length > 0 ? notWornIn2Days :
                              feedbackFilteredItems.length > 0 ? feedbackFilteredItems :
                              categoryItems;

    const preferenceWeatherContext = weather ? this.buildWeatherContext(weather) : null;

    // Score items based on weather, events, and user preferences
    const scoredItems = await Promise.all(itemsToChooseFrom.map(async (item) => {
      let score = 0;

      // Apply learned user preferences (colors, styles, items they've liked)
      const preferenceScore = await preferenceService.getItemScore(
        {
          id: item.id,
          category: item.category,
          color: item.color,
          style: item.style,
          material: item.material,
        },
        preferenceWeatherContext ? { temperature: preferenceWeatherContext.baseOutfitTemperatureF } : undefined
      );
      score += preferenceScore;
      score += scoreItemForDressCode(item, dressCode);

      // Weather-based scoring with wind chill and user preference
      if (weather) {
        const weatherContext = this.buildWeatherContext(weather);
        const effectiveTempF = weatherContext.baseOutfitTemperatureF;

        // Cold weather scoring (effective temp < 55°F)
        if (effectiveTempF < 55) {
          if (item.material?.toLowerCase().includes('wool') ||
              item.material?.toLowerCase().includes('fleece') ||
              item.material?.toLowerCase().includes('down') ||
              item.style?.toLowerCase().includes('warm') ||
              item.style?.toLowerCase().includes('insulated')) score += 4;
          if (item.tags?.season?.includes('Winter')) score += 3;
          // Extra boost for outerwear in cold + windy conditions
          if (category === 'Outerwear' && (weather.windSpeed ?? 0) > 10) {
            if (item.material?.toLowerCase().includes('windproof') ||
                item.style?.toLowerCase().includes('parka') ||
                item.style?.toLowerCase().includes('puffer')) score += 3;
          }
        } else if (effectiveTempF < 65) {
          // Cool weather - moderate warmth boost
          if (item.material?.toLowerCase().includes('wool') ||
              item.style?.toLowerCase().includes('warm')) score += 2;
          if (item.tags?.season?.includes('Fall') || item.tags?.season?.includes('Spring')) score += 2;
        } else if (effectiveTempF > 75) {
          // Warm weather - light/breathable materials
          if (item.material?.toLowerCase().includes('cotton') ||
              item.material?.toLowerCase().includes('linen')) score += 2;
          if (item.tags?.season?.includes('Summer')) score += 2;
        }

        // Weather condition considerations
        if (weather.condition.includes('Rain') || (weather.humidity ?? 0) > 80) {
          if (category === 'Outerwear' && item.material?.toLowerCase().includes('waterproof')) score += 3;
          if (category === 'Shoes' && !item.style?.toLowerCase().includes('canvas')) score += 2;
        }
      }

      // Event-based scoring
      events.forEach(event => {
        const eventTitle = event.title.toLowerCase();
        if (eventTitle.includes('meeting') || eventTitle.includes('work') || eventTitle.includes('office')) {
          if (item.style?.toLowerCase().includes('formal') || item.style?.toLowerCase().includes('business')) score += 3;
          if (item.tags?.event?.includes('Formal')) score += 2;
        }
        if (eventTitle.includes('gym') || eventTitle.includes('workout') || eventTitle.includes('exercise') ||
            eventTitle.includes('skydiving') || eventTitle.includes('hiking') || eventTitle.includes('climbing') ||
            eventTitle.includes('running') || eventTitle.includes('yoga') || eventTitle.includes('cycling') ||
            eventTitle.includes('swimming') || eventTitle.includes('sports') || eventTitle.includes('training') ||
            eventTitle.includes('outdoor') || eventTitle.includes('adventure')) {
          if (item.style?.toLowerCase().includes('athletic') || item.style?.toLowerCase().includes('sport')) score += 3;
          if (item.tags?.event?.includes('Athletic')) score += 2;
          if (item.notes?.toLowerCase().includes('legging')) score += 3;
          if (item.category === 'Bottoms' && (item.material?.toLowerCase().includes('stretch') || item.material?.toLowerCase().includes('spandex') || item.material?.toLowerCase().includes('lycra'))) score += 2;
        }
        if (eventTitle.includes('dinner') || eventTitle.includes('party') || eventTitle.includes('date')) {
          if (item.style?.toLowerCase().includes('formal') || item.style?.toLowerCase().includes('dressy')) score += 2;
          if (item.tags?.event?.includes('Party')) score += 2;
        }
      });

      // Freshness bonus (items worn less recently get higher scores)
      const wornCount = item.wornCount || 0;
      score += Math.max(0, 5 - wornCount);

      // STRONG recency penalty - items worn recently should be avoided
      if (item.lastWorn) {
        const lastWornDate = new Date(item.lastWorn);
        const now = new Date();
        const daysSinceWorn = Math.floor((now.getTime() - lastWornDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceWorn === 0) {
          // Worn today - massive penalty, almost never re-select
          score -= 50;
        } else if (daysSinceWorn === 1) {
          // Worn yesterday - very strong penalty
          score -= 30;
        } else if (daysSinceWorn === 2) {
          // Worn 2 days ago - significant penalty
          score -= 15;
        } else if (daysSinceWorn <= 4) {
          // Worn 3-4 days ago - moderate penalty
          score -= 8;
        } else if (daysSinceWorn <= 7) {
          // Worn in the last week - small penalty
          score -= 3;
        }
        // Items worn over a week ago get no penalty
      }

      // Add variety bonus based on seed for different outfit generations
      if (seed > 0) {
        // Create more pronounced differences between outfits using multiple item characteristics
        const idHash = item.id.split('').reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0);
        const colorHash = (item.color || '').split('').reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0);
        const styleHash = (item.style || '').split('').reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0);
        const materialHash = (item.material || '').split('').reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0);

        const varietyBonus = ((idHash * seed * 13) +
                             (colorHash * seed * 11) +
                             (styleHash * seed * 7) +
                             (materialHash * seed * 5) +
                             (category.charCodeAt(0) * seed * 3)) % 20;
        score += varietyBonus;
      }

      return { item, score };
    }));

    // Sort by score and return the best item, but add variety for different seeds
    scoredItems.sort((a, b) => b.score - a.score);

    // For variety, select different items based on seed with better distribution
    const numOptions = Math.min(scoredItems.length, 5); // Consider top 5 options
    if (numOptions <= 1) {
      return scoredItems[0]?.item || null;
    }

    // Use seed to select from different tiers of items with more variety
    let selectedIndex;
    const seedMod = seed % 5; // Use modulo for more variety

    if (seedMod === 0) {
      selectedIndex = 0; // Best option
    } else if (seedMod === 1) {
      selectedIndex = Math.min(1, numOptions - 1); // Second best
    } else if (seedMod === 2) {
      selectedIndex = Math.min(Math.floor(numOptions / 2), numOptions - 1); // Middle option
    } else if (seedMod === 3) {
      selectedIndex = Math.min(Math.floor(numOptions * 0.7), numOptions - 1); // 70% down the list
    } else {
      selectedIndex = Math.min(numOptions - 1, 2); // Third option or last
    }

    return scoredItems[selectedIndex]?.item || scoredItems[0]?.item || null;
  }

  async generateDailyOutfit(outfitIndex: number = 0, dressCode?: string | null): Promise<DailyOutfitSuggestion> {
    // Load user temperature preference first
    this.userTemperaturePreference = await this.getUserTemperaturePreference();
    const normalizedDressCode = normalizeDressCodeInput(dressCode);

    const [weather, events, items] = await Promise.all([
      this.getCurrentWeather(),
      this.getTodaysCalendarEvents(),
      this.getClothingItems(),
    ]);

    const recentlyWorn = this.getRecentlyWornItems(items, 7);
    const today = new Date().toISOString().split('T')[0];

    // Generate a unique seed based on outfit index to ensure variety
    const seed = outfitIndex + 1;

    // Core clothing categories - including dresses as requested
    const coreCategories = ['Tops', 'Bottoms', 'Dresses', 'Shoes'];
    const supportCategories = ['Outerwear', 'Accessories', 'Makeup'];

    // Create more variety in outfit types based on seed
    const outfitStrategy = seed % 3;
    const preferDress = outfitStrategy === 1; // Change seed 1 to prefer dresses instead of 0
    let dress = null;

    if (preferDress) {
      dress = await this.selectItemByCategory(items, 'Dresses', weather, events, recentlyWorn, [], seed, normalizedDressCode);
    }

    let selectedItems: any = {};
    let usedItemIds: string[] = [];
    let reasoning = {
      weather: formatWeatherForDisplay(weather),
      events: (() => {
        const eventSummary = events.length > 0 ? events.map(e => e.title).join(', ') : 'No special events today';
        const dressCodeReasoning = buildDressCodeReasoning(normalizedDressCode);
        return dressCodeReasoning ? `${eventSummary}; Dress code: ${dressCodeReasoning}` : eventSummary;
      })(),
      style: '',
      freshness: 'Avoided recently worn items and incorporated your feedback'
    };

    if (dress) {
      // Dress-based outfit
      selectedItems.dress = dress;
      usedItemIds.push(dress.id);

      const shoes = await this.selectItemByCategory(items, 'Shoes', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
      if (shoes) {
        selectedItems.shoes = shoes;
        usedItemIds.push(shoes.id);
      }

      // Add layers based on effective temperature (with wind chill and user preference)
      let dressLayers = 0;
      if (weather) {
        const weatherContext = this.buildWeatherContext(weather);
        const weatherLabel = formatWeatherRange(weather);

        // Cool weather (< 18°C / 64°F): add mid layer or outer layer
        // Cold weather (< 10°C / 50°F): add both mid and outer layers

        if (weatherContext.coolNowWarmLater || weatherContext.coldNowWarmerLater) {
          const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
          if (outerLayer) {
            selectedItems.outerLayer = outerLayer;
            usedItemIds.push(outerLayer.id);
            dressLayers++;
          } else {
            const midLayer = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
            if (midLayer) {
              selectedItems.midLayer = midLayer;
              usedItemIds.push(midLayer.id);
              dressLayers++;
            }
          }

          reasoning.style = dressLayers > 0
            ? `Dress with removable layer for ${weatherLabel}`
            : 'Selected a dress for the warmer part of the day';
        } else if (weatherContext.effectiveCurrentF < 50) {
          // Very cold - try to add both mid and outer layers
          const midLayer = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
          if (midLayer) {
            selectedItems.midLayer = midLayer;
            usedItemIds.push(midLayer.id);
            dressLayers++;
          }

          const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds, seed + 1, normalizedDressCode);
          if (outerLayer) {
            selectedItems.outerLayer = outerLayer;
            usedItemIds.push(outerLayer.id);
            dressLayers++;
          }

          reasoning.style = `Dress with ${dressLayers}-layer system for cold weather (${weatherLabel})`;
        } else if (weatherContext.effectiveCurrentF < 64) {
          // Cool - add one layer (prefer outer, but accept mid if no outer available)
          const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
          if (outerLayer) {
            selectedItems.outerLayer = outerLayer;
            usedItemIds.push(outerLayer.id);
            dressLayers++;
          } else {
            const midLayer = await this.selectItemByLayerType(items, 'mid', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
            if (midLayer) {
              selectedItems.midLayer = midLayer;
              usedItemIds.push(midLayer.id);
              dressLayers++;
            }
          }

          reasoning.style = dressLayers > 0
            ? `Dress with ${dressLayers}-layer for cool weather (${weatherLabel})`
            : 'Selected a dress for a complete, elegant look';
        } else if (weather.condition.includes('Rain')) {
          // Rainy weather - add outer layer for protection
          const outerLayer = await this.selectItemByLayerType(items, 'outer', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
          if (outerLayer) {
            selectedItems.outerLayer = outerLayer;
            usedItemIds.push(outerLayer.id);
            dressLayers++;
          }

          reasoning.style = 'Dress with outer layer for rain protection';
        } else {
          reasoning.style = 'Selected a dress for a complete, elegant look';
        }
      } else {
        reasoning.style = 'Selected a dress for a complete, elegant look';
      }
    } else {
      // Traditional top + bottom outfit with layering support
      const layers = await this.selectLayeredTops(items, weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
      Object.assign(selectedItems, layers.items);
      usedItemIds.push(...layers.usedIds);
      reasoning.style = layers.reasoning;

      // COMPLETENESS VALIDATION: Ensure we have at least one top layer
      const hasTopLayer = selectedItems.baseLayer || selectedItems.midLayer || selectedItems.outerLayer || selectedItems.top;
      if (!hasTopLayer) {
        // Last resort - try to find ANY top from the wardrobe
        const fallbackTop = await this.selectItemByCategory(items, 'Tops', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
        if (fallbackTop) {
          selectedItems.top = fallbackTop;
          usedItemIds.push(fallbackTop.id);
          reasoning.style = 'Selected available top from wardrobe';
        } else {
          // Check for outerwear that could work as a standalone
          const fallbackOuterwear = await this.selectItemByCategory(items, 'Outerwear', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
          if (fallbackOuterwear) {
            selectedItems.outerLayer = fallbackOuterwear;
            usedItemIds.push(fallbackOuterwear.id);
            reasoning.style = 'Using outerwear as top layer';
          }
        }
      }

      const bottom = await this.selectItemByCategory(items, 'Bottoms', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
      if (bottom) {
        selectedItems.bottom = bottom;
        usedItemIds.push(bottom.id);
      }

      const shoes = await this.selectItemByCategory(items, 'Shoes', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
      if (shoes) {
        selectedItems.shoes = shoes;
        usedItemIds.push(shoes.id);
      }
    }

    // Add accessories using the same smart scoring as other categories
    // This considers weather, events, freshness, and variety
    const accessory = await this.selectItemByCategory(items, 'Accessories', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
    if (accessory) {
      selectedItems.accessories = [accessory];
      usedItemIds.push(accessory.id);
    }

    // Add makeup suggestion based on user's makeup preference level
    // Default to 'minimal' if not set
    let shouldIncludeMakeup = true;
    try {
      const userProfile = await getUserProfile();
      const makeupLevel = userProfile?.makeupPreferenceLevel || 'minimal';

      if (makeupLevel === 'none') {
        shouldIncludeMakeup = false;
      } else if (makeupLevel === 'minimal') {
        shouldIncludeMakeup = seed % 3 === 0;
      } else if (makeupLevel === 'everyday') {
        shouldIncludeMakeup = true;
      } else if (makeupLevel === 'full') {
        shouldIncludeMakeup = true;
      }
    } catch (error) {
      console.warn('Could not load makeup preferences:', error);
    }

    if (shouldIncludeMakeup) {
      const makeup = await this.selectItemByCategory(items, 'Makeup', weather, events, recentlyWorn, usedItemIds, seed, normalizedDressCode);
      if (makeup) {
        selectedItems.makeup = [makeup];
        usedItemIds.push(makeup.id);
      }
    }

    // Get stylist personality and generate comment
    const stylist = await this.getStylistPersonality();
    const stylistComment = stylist ? await this.generateStylistComment(stylist, selectedItems, weather ?? undefined, normalizedDressCode) : undefined;

    // Generate hair suggestion if user has hair profile
    const eventTitle = events.length > 0 ? events[0].title : undefined;
    const hairSuggestion = await this.generateHairSuggestion(selectedItems, weather || undefined, eventTitle, undefined, normalizedDressCode);

    // Update lastSuggested for all items in this outfit (non-blocking)
    this.updateLastSuggested(usedItemIds).catch(err => {
      console.warn('Failed to update lastSuggested:', err);
    });

    return {
      id: `outfit_${today}_${Date.now()}`,
      date: today,
      items: selectedItems,
      reasoning,
      weatherData: weather || undefined,
      calendarEvents: events.length > 0 ? events : undefined,
      dressCode: normalizedDressCode || undefined,
      stylistComment,
      hairSuggestion: hairSuggestion ?? undefined,
    };
  }

  private async getStylistPersonality(): Promise<StylistPersonality | null> {
    try {
      const selectedStylist = await AsyncStorage.getItem('selectedStylist');
      if (selectedStylist) {
        return this.stylistPersonalities.find(s => s.id === selectedStylist) || null;
      }
    } catch (error) {
      console.error('Error getting stylist personality:', error);
    }
    return null;
  }

  private formatOutfitItemForStylist(item: any, fallbackLabel: string): string {
    if (!item) return '';

    return [
      item.color,
      item.style,
      item.material,
      item.detectedType,
    ].filter(Boolean).join(' ').trim() || fallbackLabel;
  }

  private collectStylingNotes(outfit: any): string {
    const itemEntries: Array<[string, any]> = [
      ['dress', outfit.dress],
      ['base layer', outfit.baseLayer],
      ['mid layer', outfit.midLayer],
      ['outer layer', outfit.outerLayer],
      ['top', outfit.top],
      ['bottom', outfit.bottom],
      ['shoes', outfit.shoes],
      ...(outfit.accessories || []).map((item: any): [string, any] => ['accessory', item]),
      ...(outfit.makeup || []).map((item: any): [string, any] => ['makeup', item]),
    ];

    return itemEntries
      .filter(([, item]) => item?.stylingNotes)
      .map(([label, item]) => `${label}: ${item.stylingNotes}`)
      .join('; ');
  }

  private async generateStylistComment(
    stylist: StylistPersonality,
    outfit: any,
    weather?: WeatherCondition,
    dressCode?: string | null
  ): Promise<string> {
    // Build a detailed outfit description with layering support
    const outfitParts: string[] = [];

    if (outfit.dress) {
      outfitParts.push(this.formatOutfitItemForStylist(outfit.dress, 'dress'));
    } else {
      // Handle layered tops
      if (outfit.baseLayer) {
        outfitParts.push(`${this.formatOutfitItemForStylist(outfit.baseLayer, 'base layer')} base layer`);
      }
      if (outfit.midLayer) {
        outfitParts.push(`${this.formatOutfitItemForStylist(outfit.midLayer, 'mid layer')} mid layer`);
      }
      if (outfit.outerLayer) {
        outfitParts.push(`${this.formatOutfitItemForStylist(outfit.outerLayer, 'outer layer')} outer layer`);
      }
      // Fallback to traditional top
      if (outfit.top && !outfit.baseLayer) {
        outfitParts.push(this.formatOutfitItemForStylist(outfit.top, 'top'));
      }
      if (outfit.bottom) outfitParts.push(this.formatOutfitItemForStylist(outfit.bottom, 'bottoms'));
    }
    if (outfit.shoes) outfitParts.push(this.formatOutfitItemForStylist(outfit.shoes, 'shoes'));

    const outfitDescription = outfitParts.join(', ');
    const stylingNotes = this.collectStylingNotes(outfit);

    // Enhanced weather context for layering
    let weatherContext = '';
    if (weather) {
      weatherContext = `Weather: ${this.formatWeatherCondition(weather)}`;
      // Add layering context if multiple layers are present
      const layerCount = [outfit.baseLayer, outfit.midLayer, outfit.outerLayer].filter(Boolean).length;
      if (layerCount > 1) {
        weatherContext += ` (${layerCount}-layer outfit for temperature control)`;
      }
    }

    // Build the personality prompt for each stylist
    const personalityPrompts: Record<string, string> = {
      'Marcus': `You are Marcus, a sharp and modern stylist with inner whimsy. Your style is professional and polished, but you love adding subtle, wry twists with unexpected similes. Your comments should be 15-25 words, always include a whimsical simile (like "sharp as a tack at a balloon convention" or "balanced as a tightrope walker's breakfast"), and focus on clean lines, perfect fit, and attention to detail. Be sophisticated yet playful.`,

      'Emma': `You are Emma, a trendy and bold stylist who's enthusiastic about fashion. You love pattern mixing, statement pieces, and current trends. Your comments should be 15-25 words, energetic and upbeat with phrases like "obsessed with," "living for," or "absolutely loving." Use exclamations and fashion-forward language. Be enthusiastic and confident.`,

      'Sophie': `You are Sophie, a classic and elegant stylist who values timeless style. You focus on quality over quantity, neutral colors, classic silhouettes, and versatile pieces. Your comments should be 15-25 words, refined and sophisticated with phrases about timeless elegance and lasting style. Be graceful and understated.`,

      'Maya': `You are Maya, a creative and artistic stylist who sees fashion as art. You love unique combinations and creative mixing. Your comments should be 15-25 words, using artistic language like "tells a story," "creates visual poetry," or "expresses artistic vision." Be expressive and imaginative.`,

      'Gary': `You are Gary, an honest and fearless stylist with fabulous personality. You're all about confidence, authenticity, and making a statement. Your comments should be 15-25 words, starting with terms of endearment like "Honey," "Darling," or "Sweetie," using phrases like "SERVING," "understood the assignment," or "came to slay." Be fierce, fabulous, and supportive.`
    };

    const prompt = `${personalityPrompts[stylist.id] || personalityPrompts['Marcus']} When item styling notes are provided, include one specific styling-note or pairing detail.`;

    try {
      const stylingNotesContext = stylingNotes ? `Styling notes: ${stylingNotes}.` : '';
      const dressCodeContext = normalizeDressCodeInput(dressCode)
        ? `Dress code: ${normalizeDressCodeInput(dressCode)}.`
        : '';
      const userPrompt = `Comment on this outfit: ${outfitDescription}. ${stylingNotesContext} ${weatherContext}. ${dressCodeContext} Give a single comment in your unique voice, 15-25 words.`;
      const { content, usage } = await secureAiProxy.generateStylistComment(prompt, userPrompt);
      const comment = content?.trim();

      if (!comment) {
        return this.generateFallbackComment(stylist, outfitDescription, weather);
      }

      // Log prompt to Firestore (non-blocking)
      const fullPrompt = `System: ${prompt}\n\nUser: ${userPrompt}`;
      logPrompt('stylist_comment', 'gpt-4o-mini', fullPrompt, comment, {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      });

      return comment;
    } catch (error) {
      console.error('Error generating stylist comment with ChatGPT:', error);
      return this.generateFallbackComment(stylist, outfitDescription, weather);
    }
  }

  private generateFallbackComment(stylist: StylistPersonality, outfitDescription: string, weather?: WeatherCondition): string {
    // Simple fallback in case API fails
    const phrase = stylist.phrases[Math.floor(Math.random() * stylist.phrases.length)];
    const priority = stylist.priorities[Math.floor(Math.random() * stylist.priorities.length)];
    return `${phrase} ${outfitDescription}—${priority} executed perfectly.`;
  }

  private categorizeItems(items: any[]) {
    // This method appears to be incomplete in the original code,
    // and is not directly modified by the provided changes.
    // If it needs specific modifications, please provide them.
    return {}; // Placeholder return
  }

  // Placeholder for generateStyleReasoning - assuming it exists and is used.
  private generateStyleReasoning(top: any, bottom: any, shoes: any, outerwear: any, weather: WeatherData | null): string {
    let reasoning = '';
    if (top) reasoning += `Top: ${top.style}, `;
    if (bottom) reasoning += `Bottom: ${bottom.style}, `;
    if (shoes) reasoning += `Shoes: ${shoes.style}, `;
    if (outerwear) reasoning += `Outerwear: ${outerwear.style}, `;
    if (weather) reasoning += `Weather: ${weather.condition}.`;
    return reasoning.trim();
  }

  // Placeholder for checkWeatherAppropriateness - assuming it exists and is used.
  private checkWeatherAppropriateness(top: any, bottom: any, shoes: any, outerwear: any, weather: WeatherData | null): boolean {
    if (!weather) return true; // Assume appropriate if no weather data

    const weatherContext = this.buildWeatherContext(weather);
    if (weatherContext.effectiveCurrentF < 50 && outerwear?.material !== 'waterproof' && !outerwear?.style.includes('warm')) return false;
    if (weather.condition.includes('Rain') && outerwear?.material !== 'waterproof' && !outerwear?.style.includes('waterproof')) return false;
    if (weatherContext.baseOutfitTemperatureF > 77 && top?.material.includes('wool')) return false;

    return true;
  }

  async generateHairSuggestion(
    outfit: any,
    weather?: WeatherCondition,
    eventTitle?: string,
    cachedProfile?: any,
    dressCode?: string | null
  ): Promise<HairSuggestion | null> {
    try {
      const userProfile = cachedProfile || await (async () => {
        const { getUserProfile } = await import('./userProfileService');
        return getUserProfile();
      })();

      console.log('💇 Hair Suggestion Check:', {
        hasProfile: !!userProfile,
        helpAreas: userProfile?.helpAreas,
        hasHairInHelpAreas: userProfile?.helpAreas?.includes('Hair'),
        hasHairProfile: !!userProfile?.hairProfile,
        hairProfile: userProfile?.hairProfile,
        usingCached: !!cachedProfile
      });

      // Only generate hair suggestions if user selected Hair in help areas and has a hair profile
      if (!userProfile?.helpAreas?.includes('Hair') || !userProfile?.hairProfile) {
        console.log('⏭️ Skipping hair suggestion - user did not select Hair or no hair profile');
        return null;
      }

      const hairProfile = userProfile.hairProfile;
      const stylist = await this.getStylistPersonality();

      // Build context for hair suggestion
      let context = `User's hair: ${hairProfile.length} length, ${hairProfile.texture} texture, ${hairProfile.color} color`;
      if (hairProfile.style) {
        context += `, usually wears: ${hairProfile.style}`;
      }

      let outfitContext = `Outfit: `;
      // Handle layered outfits
      if (outfit.dress) {
        outfitContext += `${outfit.dress.color} ${outfit.dress.style || ''} dress, `;
      } else {
        if (outfit.baseLayer) outfitContext += `${outfit.baseLayer.color} ${outfit.baseLayer.style || ''} base layer, `;
        if (outfit.midLayer) outfitContext += `${outfit.midLayer.color} ${outfit.midLayer.style || ''} mid layer, `;
        if (outfit.outerLayer) outfitContext += `${outfit.outerLayer.color} ${outfit.outerLayer.style || ''} outer layer, `;
        // Fallback to traditional top
        if (outfit.top && !outfit.baseLayer) outfitContext += `${outfit.top.color} ${outfit.top.style || ''} top, `;
      }
      if (outfit.bottom) outfitContext += `${outfit.bottom.color} ${outfit.bottom.style || ''} bottoms, `;
      if (outfit.shoes) outfitContext += `${outfit.shoes.color} ${outfit.shoes.style || 'shoes'}`;

      console.log('🎨 Hair suggestion outfit context:', outfitContext);

      let weatherContext = '';
      if (weather) {
        weatherContext = `Weather: ${this.formatWeatherCondition(weather)}`;
      }

      let eventContext = '';
      if (eventTitle) {
        eventContext = `Event: ${eventTitle}`;
      }

      const normalizedDressCode = normalizeDressCodeInput(dressCode);
      const dressCodeContext = normalizedDressCode ? `Dress code: ${normalizedDressCode}` : '';

      const prompt = `As ${stylist?.name || 'a stylist'}, suggest a hairstyle for someone with this hair:
${context}

They're wearing:
${outfitContext}

${weatherContext}
${eventContext}
${dressCodeContext}

Provide a hairstyle suggestion that:
1. Works well with their hair type and length
2. Complements the outfit style
3. Is practical for the weather
4. Matches the event formality and dress code (if applicable)

Respond ONLY with valid JSON in this format:
{
  "name": "hairstyle name (e.g., 'Low ponytail', 'Beach waves', 'Sleek bun')",
  "description": "brief 1-sentence description of how to style it",
  "reasoning": "1-sentence explanation of why it works with this outfit and weather"
}`;

      console.log('💇 Calling secure AI function for hair suggestion...');
      const { content, usage } = await secureAiProxy.generateHairSuggestion(prompt);

      if (!content) {
        console.warn('⚠️ No content in secure AI response');
        return null;
      }

      console.log('✅ Hair suggestion response:', content);

      // Log prompt to Firestore (non-blocking)
      logPrompt('hair_suggestion', 'gpt-4o-mini', prompt, content, {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      });

      // Parse JSON response
      const cleanedContent = content.trim().replace(/```json\n?/g, '').replace(/```/g, '');
      const hairSuggestion = JSON.parse(cleanedContent);

      console.log('✨ Hair suggestion generated:', hairSuggestion.name);
      return {
        name: hairSuggestion.name,
        description: hairSuggestion.description,
        reasoning: hairSuggestion.reasoning
      };
    } catch (error) {
      console.error('❌ Error generating hair suggestion:', error);
      return null;
    }
  }

  async generateOutfit(items: ClothingItem[], weather?: WeatherCondition, preferredStyle?: string, eventTitle?: string): Promise<OutfitRecommendation | null> {
    // Get stylist personality and generate comment
    const stylist = await this.getStylistPersonality();
    const outfit = {
      top: items.find(i => i.category === 'Tops'),
      bottom: items.find(i => i.category === 'Bottoms'),
      shoes: items.find(i => i.category === 'Shoes'),
      outerwear: items.find(i => i.category === 'Outerwear')
    };

    const stylistComment = stylist ? await this.generateStylistComment(stylist, outfit, weather) : undefined;

    // Generate hair suggestion if user has hair profile
    const hairSuggestion = await this.generateHairSuggestion(outfit, weather, eventTitle);

    return {
      top: outfit.top ?? null,
      bottom: outfit.bottom ?? null,
      shoes: outfit.shoes ?? null,
      outerwear: outfit.outerwear ?? null,
      accessories: items.filter(i => i.category === 'Accessories'),
      styleReasoning: this.generateStyleReasoning(outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, weather as WeatherData),
      weatherAppropriate: this.checkWeatherAppropriateness(outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, weather as WeatherData),
      stylistComment,
      hairSuggestion: hairSuggestion ?? undefined,
    };
  }


  async markItemAsWorn(itemId: string): Promise<void> {
    try {
      const items = await this.getClothingItems();
      const itemIndex = items.findIndex(item => item.id === itemId);

      if (itemIndex !== -1) {
        const now = new Date().toISOString();
        const newWornCount = (items[itemIndex].wornCount || 0) + 1;

        const { cloudSyncService } = await import('./cloudSyncService');
        const saved = await cloudSyncService.updateItem({
          ...items[itemIndex],
          lastWorn: now,
          wornCount: newWornCount,
        });
        if (!saved) {
          throw new Error(`Failed to save worn state for ${itemId}`);
        }
        await AsyncStorage.removeItem('dailyOutfits');
        console.log(`✅ Marked item ${itemId} as worn in Firestore (count: ${newWornCount})`);
        console.log('🧹 Invalidated saved Daily Picks after wear history update');
      }
    } catch (error) {
      console.error('Error marking item as worn:', error);
    }
  }

  private async updateLastSuggested(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;

    try {
      const now = new Date().toISOString();
      const items = await this.getClothingItems();
      let updated = false;

      for (const itemId of itemIds) {
        const itemIndex = items.findIndex(item => item.id === itemId);
        if (itemIndex !== -1) {
          (items[itemIndex] as any).lastSuggested = now;
          updated = true;
        }
      }

      if (updated) {
        const { cloudSyncService } = await import('./cloudSyncService');
        for (const item of items) {
          if (itemIds.includes(item.id)) {
            await cloudSyncService.updateItem(item);
          }
        }
        console.log(`📅 Updated lastSuggested for ${itemIds.length} items`);
      }
    } catch (error) {
      console.error('Error updating lastSuggested:', error);
    }
  }

  async saveOutfitFeedback(feedback: OutfitFeedbackRecord): Promise<void> {
    try {
      const existingFeedback = await this.getOutfitFeedback();
      const updatedFeedback = [...existingFeedback, feedback];

      await AsyncStorage.setItem('outfitFeedback', JSON.stringify(updatedFeedback));
      console.log('Saved outfit feedback:', feedback.rating, feedback.reason);
    } catch (error) {
      console.error('Error saving outfit feedback:', error);
    }
  }

  async getOutfitFeedback(): Promise<OutfitFeedbackRecord[]> {
    try {
      const feedbackData = await AsyncStorage.getItem('outfitFeedback');
      if (!feedbackData) return [];
      return JSON.parse(feedbackData);
    } catch (error) {
      console.error('Error loading outfit feedback:', error);
      return [];
    }
  }

  private async applyFeedbackToSelection(items: ClothingItem[], category: string, weather: WeatherData | null): Promise<ClothingItem[]> {
    const feedback = await this.getOutfitFeedback();

    // Filter negative feedback for similar conditions
    const negativeFeedback = feedback.filter(f => f.rating === 'thumbs-down');

    return items.filter(item => {
      // Check if this item was in negatively rated outfits under similar conditions
      const wasNegativelyRated = negativeFeedback.some(nf => {
        const itemWasInOutfit = nf.itemCategories.includes(item.category);
        const similarWeather = !weather || !nf.weatherConditions ||
          Math.abs((nf.weatherConditions.temperature - weather.temperature)) < 10;

        return itemWasInOutfit && similarWeather && nf.reason;
      });

      return !wasNegativelyRated;
    });
  }
}

export const outfitSelectionService = new OutfitSelectionService();
