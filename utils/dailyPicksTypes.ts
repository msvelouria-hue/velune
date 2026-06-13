import type {
  ClothingItem,
  ClothingItemTags,
  LayerType,
  PermissionState,
  PhotoStatus,
} from './wardrobeTypes';

export type {
  ClothingItem,
  ClothingItemTags,
  LayerType,
  PermissionState,
  PhotoStatus,
} from './wardrobeTypes';

export interface WeatherData {
  temperature: number;
  feelsLike?: number;
  lowTemperature?: number;
  highTemperature?: number;
  tempUnit?: string;
  condition: string;
  humidity?: number;
  windSpeed?: number;
  description: string;
  weatherProvider?: string;
  locationName?: string;
  locationAccuracyMeters?: number;
  forecastEntryCount?: number;
  lowTemperatureAt?: string;
  highTemperatureAt?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  location?: string;
  allDay?: boolean;
}

export interface HairSuggestion {
  name: string;
  description: string;
  reasoning: string;
}

export interface OutfitFeedbackRecord {
  id: string;
  outfitId: string;
  rating: 'thumbs-up' | 'thumbs-down';
  reason?: string;
  reasons?: string[];
  timestamp: string;
  weatherConditions?: {
    temperature: number;
    condition: string;
  };
  itemCategories: string[];
}

export interface DailyOutfitItems {
  top?: ClothingItem;
  bottom?: ClothingItem;
  dress?: ClothingItem;
  outerwear?: ClothingItem;
  shoes?: ClothingItem;
  accessories?: ClothingItem[];
  makeup?: ClothingItem[];
  baseLayer?: ClothingItem;
  midLayer?: ClothingItem;
  outerLayer?: ClothingItem;
}

export interface OutfitReasoning {
  weather: string;
  events: string;
  style: string;
  freshness: string;
}

export interface DailyOutfitSuggestion {
  id: string;
  date: string;
  items: DailyOutfitItems;
  reasoning: OutfitReasoning;
  weatherData?: WeatherData;
  calendarEvents?: CalendarEvent[];
  dressCode?: string;
  feedback?: OutfitFeedbackRecord;
  stylistComment?: string;
  hairSuggestion?: HairSuggestion;
  isPremiumAI?: boolean;
}
