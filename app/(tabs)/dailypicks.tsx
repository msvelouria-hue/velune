import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View, ScrollView, Image, ActivityIndicator, Alert, Platform, Modal, TextInput, KeyboardAvoidingView, Keyboard, AppState, AppStateStatus } from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { VestiaryColors } from '@/constants/Colors';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { outfitSelectionService, OutfitSelectionService } from '@/utils/outfitSelectionService';
import { preferenceService } from '@/utils/preferenceService';
import { premiumAIService } from '@/utils/premiumAIService';
import { outfitFeedbackService } from '@/utils/outfitFeedbackService';
import { ensembleService } from '@/utils/ensembleService';
import { trackUserStat, getUserProfile } from '@/utils/userProfileService';
import { validateOutfitSuggestion, logOutfitSummary } from '@/utils/outfitValidation';
import { buildCoarseLocationSignature, buildLocalDateKey } from '@/utils/dailyOutfitsCache';
import {
  DRESS_CODE_PRESETS,
  normalizeDressCodeInput,
} from '@/utils/dressCode';
import type {
  ClothingItem,
  DailyOutfitSuggestion,
} from '@/utils/dailyPicksTypes';
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SavedDailyOutfits {
  date: string;
  outfits: DailyOutfitSuggestion[];
  currentIndex?: number;
  selectedStylist?: string | null;
  calendarEventSignature?: string | null;
  calendarSignature?: string | null;
  locationSignature?: string | null;
  dressCode?: string | null;
}

export default function DailyPicksScreen() {
  const insets = useSafeAreaInsets();
  const [outfits, setOutfits] = useState<DailyOutfitSuggestion[]>([]);
  const [currentOutfitIndex, setCurrentOutfitIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showThumbsUpModal, setShowThumbsUpModal] = useState(false);
  const [feedbackReasons, setFeedbackReasons] = useState<string[]>([]);
  const [customFeedbackReason, setCustomFeedbackReason] = useState('');
  const [thumbsUpComment, setThumbsUpComment] = useState('');
  const [pendingFeedback, setPendingFeedback] = useState<'thumbs-up' | 'thumbs-down' | null>(null);
  const [missingPermissions, setMissingPermissions] = useState<{location: boolean, calendar: boolean}>({location: false, calendar: false});
  const [stylistName, setStylistName] = useState<string>('Your Stylist');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [selectedItemForPreview, setSelectedItemForPreview] = useState<ClothingItem | null>(null);
  const [showItemPreviewModal, setShowItemPreviewModal] = useState(false);
  const [makeupExpanded, setMakeupExpanded] = useState(false);
  const [calendarEventSignature, setCalendarEventSignature] = useState<string | null>(null);
  const [locationSignature, setLocationSignature] = useState<string | null>(null);
  const [dressCode, setDressCode] = useState('');
  const [dressCodeDraft, setDressCodeDraft] = useState('');

  const appState = useRef(AppState.currentState);
  const isCheckingOutfits = useRef(false);
  const isGenerating = useRef(false);
  const hasInitialLoad = useRef(false);
  const loadOrGenerateOutfitsRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    loadOrGenerateOutfits();
    checkPermissions();
    loadStylistName();
    hasInitialLoad.current = true;
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (!hasInitialLoad.current) {
          appState.current = nextAppState;
          return;
        }
        console.log('📱 App came to foreground - checking for stale data');
        loadOrGenerateOutfits();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hasInitialLoad.current) {
        return;
      }

      console.log('🔎 Daily Picks focused - checking for calendar changes');
      void loadOrGenerateOutfitsRef.current();
    }, [])
  );

  const getOutfitItemIds = (outfit: DailyOutfitSuggestion): string[] => {
    const itemIds: string[] = [];
    if (outfit.items.dress?.id) itemIds.push(outfit.items.dress.id);
    if (outfit.items.baseLayer?.id) itemIds.push(outfit.items.baseLayer.id);
    if (outfit.items.midLayer?.id) itemIds.push(outfit.items.midLayer.id);
    if (outfit.items.outerLayer?.id) itemIds.push(outfit.items.outerLayer.id);
    if (outfit.items.top?.id) itemIds.push(outfit.items.top.id);
    if (outfit.items.bottom?.id) itemIds.push(outfit.items.bottom.id);
    if (outfit.items.outerwear?.id) itemIds.push(outfit.items.outerwear.id);
    if (outfit.items.shoes?.id) itemIds.push(outfit.items.shoes.id);
    if (outfit.items.accessories) {
      outfit.items.accessories.forEach((acc: any) => {
        if (acc?.id) itemIds.push(acc.id);
      });
    }
    return itemIds;
  };

  useEffect(() => {
    if (outfits.length > 0 && currentOutfitIndex >= 0 && currentOutfitIndex < outfits.length && !loading) {
      const outfit = outfits[currentOutfitIndex];
      const itemIds = getOutfitItemIds(outfit);
      if (itemIds.length > 0) {
        ensembleService.markEnsembleViewed(
          itemIds,
          outfit.weatherData ? {
            temperature: outfit.weatherData.temperature,
            condition: outfit.weatherData.condition || outfit.weatherData.description || '',
          } : undefined,
          outfit.calendarEvents?.[0]?.title
        ).catch(err => console.warn('Could not track ensemble view:', err));
      }
    }
  }, [currentOutfitIndex, outfits, loading]);

  const getCalendarEventSignature = async (): Promise<string | null> => {
    try {
      const permission = await Calendar.getCalendarPermissionsAsync();
      if (permission.status !== 'granted') {
        return null;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const calendarIds = calendars.map((calendar) => calendar.id);

      if (calendarIds.length === 0) {
        return '';
      }

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);

      const events = await Calendar.getEventsAsync(calendarIds, startOfDay, endOfDay);
      const normalizedEvents = events
        .map((event) => ({
          id: event.id ?? '',
          title: event.title ?? '',
          startDate: event.startDate instanceof Date ? event.startDate.toISOString() : new Date(event.startDate).toISOString(),
          endDate: event.endDate instanceof Date ? event.endDate.toISOString() : new Date(event.endDate).toISOString(),
          location: event.location ?? '',
          allDay: Boolean(event.allDay),
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

      return JSON.stringify(normalizedEvents);
    } catch (error) {
      console.warn('Could not compute calendar signature for Daily Picks cache:', error);
      return null;
    }
  };

  const getCurrentLocationSignature = async (): Promise<string | null> => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return buildCoarseLocationSignature(location.coords);
    } catch (error) {
      console.warn('Could not compute location signature for Daily Picks cache:', error);
      return null;
    }
  };

  // Load saved outfits from today, or generate new ones if none exist
  const loadOrGenerateOutfits = async () => {
    if (isCheckingOutfits.current || isGenerating.current) {
      console.log('⏳ Daily Picks update already in progress, skipping duplicate call');
      return;
    }

    try {
      isCheckingOutfits.current = true;
      const shouldShowFullScreenLoading = outfits.length === 0;
      if (shouldShowFullScreenLoading) {
        setLoading(true);
      }

      const currentStylist = await loadStylistName();
      const [currentCalendarSignature, currentLocationSignature] = await Promise.all([
        getCalendarEventSignature(),
        getCurrentLocationSignature(),
      ]);
      const today = buildLocalDateKey();
      const savedData = await AsyncStorage.getItem('dailyOutfits');
      let currentDressCode = '';

      if (savedData) {
        const parsed: SavedDailyOutfits = JSON.parse(savedData);
        const cachedStylist = parsed.selectedStylist ?? null;
        const cachedCalendarSignature =
          parsed.calendarEventSignature ?? parsed.calendarSignature ?? null;
        const cachedLocationSignature = parsed.locationSignature ?? null;
        const cachedDressCode = normalizeDressCodeInput(parsed.dressCode);
        currentDressCode = parsed.date === today ? cachedDressCode : '';
        setDressCode(currentDressCode);
        setDressCodeDraft(currentDressCode);

        // Check if saved outfits are from today
        if (
          parsed.date === today &&
          parsed.outfits &&
          parsed.outfits.length > 0 &&
          cachedStylist === currentStylist &&
          cachedCalendarSignature === currentCalendarSignature &&
          cachedLocationSignature === currentLocationSignature &&
          cachedDressCode === currentDressCode
        ) {
          console.log('📅 Loading saved outfits from today');

          // Validate loaded outfits
          parsed.outfits.forEach((outfit: any, index: number) => {
            const result = validateOutfitSuggestion(outfit, index);
            if (!result.isValid) {
              console.warn(`⚠️ Loaded outfit ${index + 1} has validation issues:`, result.errors);
            }
          });

          setOutfits(parsed.outfits);
          setCurrentOutfitIndex(parsed.currentIndex || 0);
          setCalendarEventSignature(cachedCalendarSignature);
          setLocationSignature(cachedLocationSignature);
          setLoading(false);
          return;
        }

        if (parsed.date === today && parsed.outfits && parsed.outfits.length > 0) {
          const invalidationReasons: string[] = [];
          if (cachedStylist !== currentStylist) {
            invalidationReasons.push(`stylist changed from "${cachedStylist ?? 'unknown'}" to "${currentStylist ?? 'none'}"`);
          }
          if (cachedCalendarSignature !== currentCalendarSignature) {
            invalidationReasons.push('calendar events changed');
          }
          if (cachedLocationSignature !== currentLocationSignature) {
            invalidationReasons.push('location changed');
          }
          if (cachedDressCode !== currentDressCode) {
            invalidationReasons.push('dress code changed');
          }

          console.log(`🔄 Ignoring cached outfits: ${invalidationReasons.join(', ')}`);
        }
      }

      if (!savedData) {
        setDressCode('');
        setDressCodeDraft('');
      }

      // No saved outfits for today - generate new ones
      console.log('🆕 Generating new outfits for today');
      await generateOutfit(false, currentCalendarSignature, currentLocationSignature, currentDressCode);
    } catch (error) {
      console.error('Error loading outfits:', error);
      await generateOutfit();
    } finally {
      isCheckingOutfits.current = false;
    }
  };
  loadOrGenerateOutfitsRef.current = loadOrGenerateOutfits;

  // Save outfits to storage whenever they change
  const saveOutfitsToStorage = async (
    outfitsToSave: DailyOutfitSuggestion[],
    index: number,
    selectedStylistOverride?: string | null,
    calendarEventSignatureOverride?: string | null,
    locationSignatureOverride?: string | null,
    dressCodeOverride?: string | null
  ) => {
    try {
      const today = buildLocalDateKey();
      const selectedStylist =
        selectedStylistOverride !== undefined
          ? selectedStylistOverride
          : await AsyncStorage.getItem('selectedStylist');
      const calendarSignatureToSave =
        calendarEventSignatureOverride !== undefined
          ? calendarEventSignatureOverride
          : calendarEventSignature;
      const locationSignatureToSave =
        locationSignatureOverride !== undefined
          ? locationSignatureOverride
          : locationSignature;
      const dressCodeToSave =
        dressCodeOverride !== undefined
          ? normalizeDressCodeInput(dressCodeOverride)
          : dressCode;
      await AsyncStorage.setItem('dailyOutfits', JSON.stringify({
        date: today,
        outfits: outfitsToSave,
        currentIndex: index,
        selectedStylist: selectedStylist ?? null,
        calendarEventSignature: calendarSignatureToSave ?? null,
        locationSignature: locationSignatureToSave ?? null,
        dressCode: dressCodeToSave || null,
      }));
      console.log('💾 Saved outfits to storage');
    } catch (error) {
      console.error('Error saving outfits:', error);
    }
  };

  const loadStylistName = async (): Promise<string | null> => {
    try {
      const selectedStylist = await AsyncStorage.getItem('selectedStylist');
      setStylistName(selectedStylist || 'Your Stylist');
      return selectedStylist;
    } catch (error) {
      console.error('Error loading stylist name:', error);
      setStylistName('Your Stylist');
      return null;
    }
  };

  const checkPermissions = async () => {
    try {
      const [locationStatus, calendarStatus] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Calendar.getCalendarPermissionsAsync()
      ]);

      setMissingPermissions({
        location: locationStatus.status !== 'granted',
        calendar: calendarStatus.status !== 'granted'
      });

      // Auto-request location permission if never asked before (first-time user flow)
      if (locationStatus.status === 'undetermined') {
        console.log('📍 Location permission never requested - auto-prompting...');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          await AsyncStorage.setItem('locationAccess', 'granted');
          setMissingPermissions(prev => ({ ...prev, location: false }));
          console.log('✅ Location permission granted via auto-prompt');
        } else {
          await AsyncStorage.setItem('locationAccess', 'denied');
          console.log('❌ Location permission denied via auto-prompt');
        }
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        await AsyncStorage.setItem('locationAccess', 'granted');
        setMissingPermissions(prev => ({ ...prev, location: false }));
        Alert.alert('Success!', 'Location access granted. Your outfit recommendations will now consider local weather.', [
          { text: 'Refresh Outfits', onPress: () => { void generateOutfit(); } }
        ]);
      } else {
        await AsyncStorage.setItem('locationAccess', 'denied');
      }
    } catch (error) {
      console.error('Error requesting location permission:', error);
    }
  };

  const requestCalendarPermission = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status === 'granted') {
        await AsyncStorage.setItem('calendarAccess', 'granted');
        setMissingPermissions(prev => ({ ...prev, calendar: false }));
        Alert.alert('Success!', 'Calendar access granted. Your outfit recommendations will now consider your scheduled events.', [
          { text: 'Refresh Outfits', onPress: () => { void generateOutfit(); } }
        ]);
      } else {
        await AsyncStorage.setItem('calendarAccess', 'denied');
      }
    } catch (error) {
      console.error('Error requesting calendar permission:', error);
    }
  };

  const generateOutfit = async (
    isRefresh: boolean = false,
    calendarEventSignatureOverride?: string | null,
    locationSignatureOverride?: string | null,
    dressCodeOverride?: string | null
  ) => {
    if (isGenerating.current) {
      console.log('⏳ Outfit generation already in progress, skipping duplicate call');
      return;
    }

    const shouldUseRefreshIndicator = outfits.length > 0;

    try {
      isGenerating.current = true;
      if (shouldUseRefreshIndicator) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const currentStylist = await loadStylistName();
      const [currentCalendarSignature, currentLocationSignature, currentDressCode] = await Promise.all([
        calendarEventSignatureOverride !== undefined
          ? Promise.resolve(calendarEventSignatureOverride)
          : getCalendarEventSignature(),
        locationSignatureOverride !== undefined
          ? Promise.resolve(locationSignatureOverride)
          : getCurrentLocationSignature(),
        dressCodeOverride !== undefined
          ? Promise.resolve(normalizeDressCodeInput(dressCodeOverride))
          : Promise.resolve(dressCode),
      ]);
      setDressCode(currentDressCode);
      setDressCodeDraft(currentDressCode);

      // Check AsyncStorage first, then fall back to user profile
      let algorithm = await AsyncStorage.getItem('outfitAlgorithm');

      // If AsyncStorage is empty, check user profile (Firebase)
      if (!algorithm) {
        const profile = await getUserProfile();
        algorithm = profile?.outfitAlgorithm || 'basic';
        // Sync to AsyncStorage for future reads
        if (algorithm) {
          await AsyncStorage.setItem('outfitAlgorithm', algorithm);
        }
        console.log(`🔍 Algorithm from profile: "${algorithm}"`);
      } else {
        console.log(`🔍 Algorithm from storage: "${algorithm}"`);
      }

      let suggestions: DailyOutfitSuggestion[];

      if (algorithm === 'premium') {
        console.log('🧠 Using Premium AI for outfit generation');
        console.log('🚀 Calling premiumAIService.generateOutfits(3)...');
        try {
          suggestions = await premiumAIService.generateOutfits(3, currentDressCode);
          console.log(`✅ Premium AI returned ${suggestions?.length || 0} outfits`);

          // Generate hair suggestions for premium AI outfits (they don't include them by default)
          // Fetch profile once and reuse for all hair suggestions
          const cachedProfile = await getUserProfile();
          const suggestionsWithHair = await Promise.all(
            suggestions.map(async (outfit) => {
              try {
                const eventTitle = outfit.calendarEvents?.[0]?.title;
                const hairSuggestion = await outfitSelectionService.generateHairSuggestion(
                  outfit.items,
                  outfit.weatherData || undefined,
                  eventTitle,
                  cachedProfile,
                  currentDressCode
                );
                return { ...outfit, hairSuggestion: hairSuggestion ?? undefined };
              } catch (hairError) {
                console.warn('Could not generate hair suggestion for premium outfit:', hairError);
                return outfit;
              }
            })
          );
          suggestions = suggestionsWithHair;

          // Track premium AI outfit request
          trackUserStat('t_wardrobe_request_submissions_premium_ai');
        } catch (aiError: any) {
          console.warn('❌ Premium AI failed');
          console.warn('❌ Error name:', aiError.name);
          console.warn('❌ Error message:', aiError.message);
          console.warn('❌ Error stack:', aiError.stack);
          throw aiError;
        }
      } else {
        console.log(`📋 Using Basic algorithm for outfit generation (algorithm="${algorithm}")`);
        const timestamp = Date.now();
        const outfitPromises = [
          outfitSelectionService.generateDailyOutfit(timestamp % 100, currentDressCode),
          outfitSelectionService.generateDailyOutfit((timestamp + 1) % 100, currentDressCode),
          outfitSelectionService.generateDailyOutfit((timestamp + 2) % 100, currentDressCode)
        ];
        suggestions = await Promise.all(outfitPromises);
        // Track basic algorithm outfit request
        trackUserStat('t_wardrobe_request_submissions_basic');
      }

      // Validate all outfit suggestions before displaying
      suggestions.forEach((outfit, index) => {
        const result = validateOutfitSuggestion(outfit, index);
        logOutfitSummary(outfit, index);
        if (!result.isValid) {
          console.warn(`⚠️ Outfit ${index + 1} has validation issues:`, result.errors);
        }
      });

      setOutfits(suggestions);
      setCurrentOutfitIndex(0);
      setCalendarEventSignature(currentCalendarSignature);
      setLocationSignature(currentLocationSignature);

      await saveOutfitsToStorage(
        suggestions,
        0,
        currentStylist,
        currentCalendarSignature,
        currentLocationSignature,
        currentDressCode
      );

      for (const outfit of suggestions) {
        try {
          await outfitFeedbackService.saveOutfitSuggestion(outfit);
        } catch (feedbackError) {
          console.warn('Could not save outfit for feedback tracking:', feedbackError);
        }
      }
    } catch (err) {
      console.error('Error generating outfit:', err);
      setError('Failed to generate outfit. Please try again.');
    } finally {
      if (shouldUseRefreshIndicator) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      isGenerating.current = false;
    }
  };

  const saveDressCodeAndRegenerate = async (nextDressCodeValue: string) => {
    const normalizedDressCode = normalizeDressCodeInput(nextDressCodeValue);
    if (normalizedDressCode === dressCode) {
      setDressCodeDraft(normalizedDressCode);
      return;
    }

    setDressCode(normalizedDressCode);
    setDressCodeDraft(normalizedDressCode);
    await generateOutfit(true, undefined, undefined, normalizedDressCode);
  };

  const applyDressCode = () => {
    void saveDressCodeAndRegenerate(dressCodeDraft);
  };

  const clearDressCode = () => {
    void saveDressCodeAndRegenerate('');
  };

  const chooseDressCodePreset = (preset: string) => {
    setDressCodeDraft(preset);
    void saveDressCodeAndRegenerate(preset);
  };

  const nextOutfit = () => {
    if (outfits.length > 0) {
      const newIndex = (currentOutfitIndex + 1) % outfits.length;
      setCurrentOutfitIndex(newIndex);
      saveOutfitsToStorage(outfits, newIndex, undefined, calendarEventSignature);
    }
  };

  const previousOutfit = () => {
    if (outfits.length > 0) {
      const newIndex = (currentOutfitIndex - 1 + outfits.length) % outfits.length;
      setCurrentOutfitIndex(newIndex);
      saveOutfitsToStorage(outfits, newIndex, undefined, calendarEventSignature);
    }
  };

  const handleSwipe = (event: any) => {
    const { translationX, state } = event.nativeEvent;

    // Only handle swipe on gesture end
    if (state === State.END) {
      if (translationX > 100) {
        // Swipe right - go to previous outfit
        previousOutfit();
      } else if (translationX < -100) {
        // Swipe left - go to next outfit
        nextOutfit();
      }
    }
  };

  const regenerateAfterWearHistoryChange = async (reason: string) => {
    await AsyncStorage.removeItem('dailyOutfits');
    console.log(`♻️ Regenerating Daily Picks after ${reason}`);
    await generateOutfit(true);
  };

  const markAsWorn = async (itemId: string) => {
    try {
      await outfitSelectionService.markItemAsWorn(itemId);
      setShowItemPreviewModal(false);
      setSelectedItemForPreview(null);
      Alert.alert('Success', 'Item marked as worn! Refreshing Daily Picks.');
      regenerateAfterWearHistoryChange('manual item marked worn')
        .catch(err => console.warn('Could not regenerate Daily Picks after marking item worn:', err));
    } catch (error) {
      Alert.alert('Error', 'Failed to mark item as worn');
    }
  };

  const openItemPreview = (item: any, category: string) => {
    setSelectedItemForPreview({ ...item, displayCategory: category });
    setShowItemPreviewModal(true);
  };

  const handleFeedback = async (rating: 'thumbs-up' | 'thumbs-down') => {
    const outfit = outfits[currentOutfitIndex];
    if (!outfit) return;

    if (rating === 'thumbs-up') {
      setPendingFeedback(rating);
      setShowThumbsUpModal(true);
    } else {
      setPendingFeedback(rating);
      setShowFeedbackModal(true);
    }
  };

  const handleThumbsUpModalSubmit = async () => {
    if (pendingFeedback === 'thumbs-up') {
      await saveFeedback('thumbs-up', []);
    }
    setShowThumbsUpModal(false);
    setThumbsUpComment('');
    setPendingFeedback(null);
  };

  const handleThumbsUpModalSkip = async () => {
    setThumbsUpComment('');
    if (pendingFeedback === 'thumbs-up') {
      await saveFeedback('thumbs-up', []);
    }
    setShowThumbsUpModal(false);
    setPendingFeedback(null);
  };

  const saveFeedback = async (rating: 'thumbs-up' | 'thumbs-down', reasons: string[]) => {
    const outfit = outfits[currentOutfitIndex];
    if (!outfit) return;

    // Use thumbsUpComment for thumbs-up, customFeedbackReason for thumbs-down
    const commentToUse = rating === 'thumbs-up' ? thumbsUpComment.trim() : customFeedbackReason.trim();

    // Combine selected reasons and custom reason
    const allReasons = [...reasons];
    if (commentToUse && rating === 'thumbs-down') {
      allReasons.push(commentToUse);
    }

    const feedback = {
      id: `feedback_${Date.now()}`,
      outfitId: outfit.id,
      rating,
      reason: rating === 'thumbs-up' ? commentToUse : allReasons.join('; '),
      reasons: allReasons,
      timestamp: new Date().toISOString(),
      weatherConditions: outfit.weatherData ? {
        temperature: outfit.weatherData.temperature,
        condition: outfit.weatherData.condition,
      } : undefined,
      itemCategories: Object.keys(outfit.items).filter(key => outfit.items[key as keyof typeof outfit.items]),
    };

    try {
      await outfitSelectionService.saveOutfitFeedback(feedback);

      try {
        await outfitFeedbackService.recordFeedback(
          outfit.id,
          rating,
          allReasons.length > 0 ? allReasons : undefined,
          commentToUse || undefined
        );
      } catch (feedbackError) {
        console.warn('Could not record feedback to Firestore:', feedbackError);
      }

      // Record feedback to preference learning system
      const outfitItems: Array<{
        id: string;
        category: string;
        color?: string;
        style?: string;
        material?: string;
      }> = [];

      // Collect all items from the outfit for preference learning
      // Note: For Shoes and Accessories, the 'style' field often contains item types (e.g., "ankle boot")
      // rather than actual styles (casual, formal), so we exclude it for those categories
      const categoriesWithMeaningfulStyle = ['tops', 'bottoms', 'dresses', 'outerwear'];

      const itemSlots = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'baseLayer', 'midLayer', 'outerLayer'];
      for (const slot of itemSlots) {
        const item = outfit.items[slot as keyof typeof outfit.items];
        if (item && typeof item === 'object' && 'id' in item) {
          const category = item.category || slot;
          const shouldIncludeStyle = categoriesWithMeaningfulStyle.includes(category.toLowerCase());
          outfitItems.push({
            id: item.id,
            category: category,
            color: item.color,
            style: shouldIncludeStyle ? item.style : undefined,
            material: item.material,
          });
        }
      }

      // Also include accessories (without style since it's often item type, not aesthetic style)
      if (outfit.items.accessories && Array.isArray(outfit.items.accessories)) {
        for (const acc of outfit.items.accessories) {
          if (acc && acc.id) {
            outfitItems.push({
              id: acc.id,
              category: 'Accessories',
              color: acc.color,
              style: undefined, // Accessories style field often contains item type, not aesthetic style
              material: acc.material,
            });
          }
        }
      }

      // Record to preference service for learning
      await preferenceService.recordOutfitFeedback(
        rating,
        outfitItems,
        outfit.weatherData ? {
          temperature: outfit.weatherData.temperature,
          condition: outfit.weatherData.condition || '',
        } : undefined,
        allReasons
      );

      console.log(`📊 Recorded ${rating} preference feedback for ${outfitItems.length} items`);

      // If thumbs up, mark all items in the outfit as worn and record ensemble love
      if (rating === 'thumbs-up') {
        const itemsToMarkAsWorn: string[] = [];

        // Collect all items in the outfit (handling both layered and non-layered outfits)
        if (outfit.items.dress?.id) itemsToMarkAsWorn.push(outfit.items.dress.id);
        if (outfit.items.baseLayer?.id) itemsToMarkAsWorn.push(outfit.items.baseLayer.id);
        if (outfit.items.midLayer?.id) itemsToMarkAsWorn.push(outfit.items.midLayer.id);
        if (outfit.items.outerLayer?.id) itemsToMarkAsWorn.push(outfit.items.outerLayer.id);
        if (outfit.items.top?.id) itemsToMarkAsWorn.push(outfit.items.top.id);
        if (outfit.items.bottom?.id) itemsToMarkAsWorn.push(outfit.items.bottom.id);
        if (outfit.items.shoes?.id) itemsToMarkAsWorn.push(outfit.items.shoes.id);

        // Deduplicate item IDs (same item may appear as both baseLayer and top)
        const uniqueItemIds = [...new Set(itemsToMarkAsWorn)];

        // Mark each item as worn
        for (const itemId of uniqueItemIds) {
          await outfitSelectionService.markItemAsWorn(itemId);
        }

        // Record ensemble love (non-blocking)
        const ensembleItemIds = getOutfitItemIds(outfit);
        ensembleService.recordLove(ensembleItemIds, thumbsUpComment.trim() || undefined)
          .then(() => console.log('❤️ Recorded ensemble love'))
          .catch(err => console.warn('Could not record ensemble love:', err));
      } else {
        // For thumbs-down, add comment to ensemble if provided
        if (allReasons.length > 0 || commentToUse) {
          const ensembleItemIds = getOutfitItemIds(outfit);
          const comment = allReasons.join('; ') + (commentToUse ? ` - ${commentToUse}` : '');
          ensembleService.addComment(ensembleItemIds, `👎 ${comment}`)
            .catch(err => console.warn('Could not add ensemble comment:', err));
        }
      }

      // Update outfit with feedback
      const updatedOutfits = [...outfits];
      updatedOutfits[currentOutfitIndex].feedback = feedback;
      setOutfits(updatedOutfits);

      // Save updated outfits with feedback to storage
      await saveOutfitsToStorage(updatedOutfits, currentOutfitIndex, undefined, calendarEventSignature);

      if (rating === 'thumbs-up') {
        regenerateAfterWearHistoryChange('thumbs-up wear feedback')
          .catch(err => console.warn('Could not regenerate Daily Picks after thumbs-up feedback:', err));
      }

      Alert.alert(
        'Thank you!',
        rating === 'thumbs-up'
          ? 'Items marked as worn! Refreshing Daily Picks so we prioritize other pieces.'
          : 'Your feedback will help improve future suggestions.'
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to save feedback');
    }
  };

  const handleFeedbackModalSubmit = async () => {
    if (pendingFeedback) {
      await saveFeedback(pendingFeedback, feedbackReasons);
    }
    setShowFeedbackModal(false);
    setFeedbackReasons([]);
    setCustomFeedbackReason('');
    setPendingFeedback(null);
  };

  const handleFeedbackModalCancel = () => {
    setShowFeedbackModal(false);
    setFeedbackReasons([]);
    setCustomFeedbackReason('');
    setPendingFeedback(null);
  };

  const toggleFeedbackReason = (reason: string) => {
    setFeedbackReasons(prev => {
      if (prev.includes(reason)) {
        // If already selected, remove it
        return prev.filter(r => r !== reason);
      } else {
        // If selecting a temperature-related reason, remove conflicting ones
        let newReasons = [...prev, reason];

        if (reason === 'Not warm enough') {
          newReasons = newReasons.filter(r => r !== 'Too warm for weather');
        } else if (reason === 'Too warm for weather') {
          newReasons = newReasons.filter(r => r !== 'Not warm enough');
        }

        return newReasons;
      }
    });
  };

  const formatItemDescription = (item: any, category: string) => {
    const color = item.color?.toLowerCase() || '';
    const style = item.style?.toLowerCase() || '';
    const material = item.material?.toLowerCase() || '';

    // Build description avoiding duplicates with proper formatting
    let parts = [];

    // Add color if it exists
    if (color && color.trim()) {
      parts.push(color);
    }

    // Add material if it's different from existing parts
    if (material && material.trim() && !parts.some(part => part.includes(material) || material.includes(part))) {
      parts.push(material);
    }

    // Add style if it's different from color/material and not generic
    if (style && style.trim() && style !== 'casual' && style !== color && style !== material && !parts.includes(style)) {
      parts.push(style);
    }

    // Join parts with commas between different types of attributes
    let description = '';
    if (parts.length > 0) {
      description = parts[0]; // Start with first part (usually color)
      for (let i = 1; i < parts.length; i++) {
        // Add comma between color and material, space for style
        if (i === 1 && material && parts[i] === material) {
          description += `, ${parts[i]}`;
        } else {
          description += ` ${parts[i]}`;
        }
      }
    }

    return description.charAt(0).toUpperCase() + description.slice(1);
  };

  const renderClothingItem = (item: any, category: string) => {
    // Defensive validation: skip invalid or deleted items
    if (!item) {
      console.warn(`⚠️ Skipping null ${category} item`);
      return null;
    }
    if (!item.id) {
      console.warn(`⚠️ Skipping ${category} item with no ID:`, item);
      return null;
    }

    // Correct category classification for sandals
    const displayCategory = (category === 'Accessory' && item.type === 'sandals') ? 'Shoes' : category;

    // Debug logging to check photo availability
    console.log(`Rendering ${displayCategory} item:`, {
      id: item.id,
      hasPhoto: !!item.photo,
      photoUri: item.photo ? item.photo.substring(0, 50) + '...' : 'none'
    });

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.clothingItem}
        onPress={() => openItemPreview(item, displayCategory)}
      >
        {item.photo && item.photo.trim() !== '' ? (
          <Image
            source={{ uri: item.photo }}
            style={styles.itemImage}
            onError={(error) => {
              console.warn(`Failed to load image for ${displayCategory} (${item.id}):`, {
                error: error.nativeEvent?.error || 'Unknown error',
                photoUri: item.photo
              });
            }}
            onLoad={() => {
              console.log(`Successfully loaded image for ${displayCategory} (${item.id})`);
            }}
            defaultSource={require('@/assets/images/icon.png')}
          />
        ) : (
          <View style={[styles.itemImage, styles.placeholderImage]}>
            <IconSymbol
              name={displayCategory === 'Shoes' ? 'shoe.fill' : 'tshirt'}
              size={40}
              color="#ccc"
            />
          </View>
        )}
        <View style={styles.itemDetails}>
          <ThemedText style={styles.itemCategory}>{displayCategory}</ThemedText>
          <ThemedText style={styles.itemDescription}>
            {formatItemDescription(item, displayCategory)}
          </ThemedText>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    // Stylist-specific loading messages
    const loadingMessages: Record<string, { main: string; sub: string }> = {
      'Emma': {
        main: `Emma is curating your perfect looks...`,
        sub: `This can take up to a minute! ✨`
      },
      'Gary': {
        main: `Honey, Gary is working his magic...`,
        sub: `Style takes time, darling! Usually 30-60 seconds. 💅`
      },
      'Sophie': {
        main: `Sophie is selecting timeless pieces for you...`,
        sub: `Please allow 30-60 seconds for perfection.`
      },
      'Maya': {
        main: `Maya is creating artistic combinations...`,
        sub: `This usually takes 30-60 seconds. 🎨`
      },
      'Marcus': {
        main: `Marcus is ensuring every detail is perfect...`,
        sub: `Quality takes time - usually about a minute. ✂️`
      }
    };

    const message = loadingMessages[stylistName] || {
      main: `${stylistName} is selecting your perfect outfits...`,
      sub: `This usually takes 30-60 seconds.`
    };

    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#B565D8" />
          <ThemedText style={styles.loadingText}>
            {message.main}
          </ThemedText>
          <ThemedText style={styles.loadingSubtext}>
            {message.sub}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.errorContainer}>
          <IconSymbol name="exclamationmark.triangle" size={48} color="#ef4444" />
          <ThemedText style={styles.errorText}>{error}</ThemedText>
          <TouchableOpacity style={styles.retryButton} onPress={() => { void generateOutfit(); }}>
            <ThemedText style={styles.retryButtonText}>Try Again</ThemedText>
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  if (outfits.length === 0) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.errorContainer}>
          <IconSymbol name="tshirt" size={48} color="#ccc" />
          <ThemedText style={styles.errorText}>
            No outfit could be generated. Add more clothes to your closet!
          </ThemedText>
          <TouchableOpacity style={styles.retryButton} onPress={() => { void generateOutfit(); }}>
            <ThemedText style={styles.retryButtonText}>Try Again</ThemedText>
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  const outfit = outfits[currentOutfitIndex];
  const normalizedDressCodeDraft = normalizeDressCodeInput(dressCodeDraft);
  const dressCodeIsDirty = normalizedDressCodeDraft !== dressCode;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingBottom: 120
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.headerContainer, { paddingTop: insets.top + 20 }]}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>Today{"'"}s Outfit</ThemedText>
            <View style={styles.headerControls}>
              <ThemedText style={styles.outfitCounter}>
                {currentOutfitIndex + 1} of {outfits.length}
              </ThemedText>
              <TouchableOpacity style={styles.refreshButton} onPress={() => generateOutfit(true)} disabled={refreshing}>
                {refreshing ? (
                  <ActivityIndicator size="small" color="#B565D8" />
                ) : (
                  <IconSymbol name="arrow.clockwise" size={20} color="#B565D8" />
                )}
              </TouchableOpacity>
            </View>
          </View>
          {outfits.length > 1 && (
            <View style={styles.swipeControls}>
              <TouchableOpacity style={styles.swipeButton} onPress={previousOutfit}>
                <IconSymbol name="chevron.left" size={24} color="#B565D8" />
              </TouchableOpacity>
              <View style={styles.outfitIndicators}>
                {outfits.map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.indicator,
                      index === currentOutfitIndex && styles.activeIndicator
                    ]}
                  />
                ))}
              </View>
              <TouchableOpacity style={styles.swipeButton} onPress={nextOutfit}>
                <IconSymbol name="chevron.right" size={24} color="#B565D8" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.dressCodeSection}>
          <View style={styles.dressCodeHeader}>
            <ThemedText style={styles.dressCodeTitle}>Dress Code</ThemedText>
            {dressCode ? (
              <ThemedText style={styles.dressCodeApplied}>{dressCode}</ThemedText>
            ) : null}
          </View>

          <View style={styles.dressCodeInputRow}>
            <TextInput
              style={styles.dressCodeInput}
              value={dressCodeDraft}
              onChangeText={setDressCodeDraft}
              placeholder="Custom dress code"
              placeholderTextColor={VestiaryColors.creamDark}
              returnKeyType="done"
              maxLength={80}
              onSubmitEditing={applyDressCode}
            />
            <TouchableOpacity
              style={[
                styles.dressCodeApplyButton,
                !dressCodeIsDirty && styles.dressCodeApplyButtonDisabled,
              ]}
              onPress={applyDressCode}
              disabled={!dressCodeIsDirty || refreshing}
            >
              <ThemedText style={[
                styles.dressCodeApplyText,
                !dressCodeIsDirty && styles.dressCodeApplyTextDisabled,
              ]}>
                Apply
              </ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dressCodePresetRow}
          >
            {DRESS_CODE_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset}
                style={[
                  styles.dressCodePreset,
                  dressCode === preset && styles.dressCodePresetSelected,
                ]}
                onPress={() => chooseDressCodePreset(preset)}
                disabled={refreshing}
              >
                <ThemedText style={[
                  styles.dressCodePresetText,
                  dressCode === preset && styles.dressCodePresetTextSelected,
                ]}>
                  {preset}
                </ThemedText>
              </TouchableOpacity>
            ))}
            {dressCode ? (
              <TouchableOpacity
                style={styles.dressCodeClear}
                onPress={clearDressCode}
                disabled={refreshing}
              >
                <ThemedText style={styles.dressCodeClearText}>Clear</ThemedText>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        </View>

        {/* Outfit Display */}
        <View style={styles.outfitSection}>
          <ThemedText style={styles.sectionTitle}>Selected Outfit</ThemedText>

          <View style={styles.outfitGrid}>
            {outfit.items.dress && renderClothingItem(outfit.items.dress, 'Dress')}
            {outfit.items.baseLayer && renderClothingItem(outfit.items.baseLayer, 'Base Layer')}
            {outfit.items.midLayer && renderClothingItem(outfit.items.midLayer, 'Mid Layer')}
            {outfit.items.outerLayer && renderClothingItem(outfit.items.outerLayer, 'Outer Layer')}
            {outfit.items.outerwear && renderClothingItem(outfit.items.outerwear, 'Outerwear')}
            {outfit.items.top && !outfit.items.baseLayer && !outfit.items.midLayer && !outfit.items.outerLayer && renderClothingItem(outfit.items.top, 'Top')}
            {outfit.items.bottom && renderClothingItem(outfit.items.bottom, 'Bottom')}
            {outfit.items.shoes && renderClothingItem(outfit.items.shoes, 'Shoes')}
            {outfit.items.accessories?.map((a: any) => (
              <React.Fragment key={a.id}>
                {renderClothingItem(a, 'Accessory')}
              </React.Fragment>
            ))}
          </View>

          {outfit.items.makeup && outfit.items.makeup.length > 0 && (
            <View style={styles.makeupSection}>
              <TouchableOpacity
                style={styles.makeupHeader}
                onPress={() => setMakeupExpanded(!makeupExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.makeupHeaderLeft}>
                  <ThemedText style={styles.makeupHeaderTitle}>Makeup</ThemedText>
                  <View style={styles.makeupCountBadge}>
                    <ThemedText style={styles.makeupCountText}>{outfit.items.makeup.length}</ThemedText>
                  </View>
                </View>
                <IconSymbol
                  name={makeupExpanded ? 'chevron.up' : 'chevron.down'}
                  size={18}
                  color={VestiaryColors.gold}
                />
              </TouchableOpacity>
              {makeupExpanded && (
                <View style={styles.makeupItemsList}>
                  {outfit.items.makeup.map((m: any) => (
                    <React.Fragment key={m.id}>
                      {renderClothingItem(m, 'Makeup')}
                    </React.Fragment>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Stylist Comment */}
        {outfit.stylistComment && (
          <View style={styles.stylistSection}>
            <ThemedText style={styles.sectionTitle}>{stylistName} Says</ThemedText>
            <View style={styles.stylistCommentContainer}>
              <ThemedText style={styles.stylistComment}>
                {'"'}
                {outfit.stylistComment}
                {'"'}
              </ThemedText>
            </View>
          </View>
        )}

        {/* Hair Suggestion */}
        {outfit.hairSuggestion && (
          <View style={styles.hairSection}>
            <ThemedText style={styles.sectionTitle}>💇 Hair Suggestion</ThemedText>
            <View style={styles.hairSuggestionCard}>
              <View style={styles.hairSuggestionHeader}>
                <ThemedText style={styles.hairSuggestionName}>
                  {outfit.hairSuggestion.name}
                </ThemedText>
              </View>
              <ThemedText style={styles.hairSuggestionDescription}>
                {outfit.hairSuggestion.description}
              </ThemedText>
              <View style={styles.hairSuggestionReasoningContainer}>
                <IconSymbol name="lightbulb.fill" size={16} color="#8B5CF6" />
                <ThemedText style={styles.hairSuggestionReasoning}>
                  {outfit.hairSuggestion.reasoning}
                </ThemedText>
              </View>
            </View>
          </View>
        )}

        {/* Reasoning */}
        <View style={styles.reasoningSection}>
          <ThemedText style={styles.sectionTitle}>Why This Outfit?</ThemedText>

          <View style={styles.reasoningCard}>
            <View style={styles.reasoningItem}>
              <IconSymbol name="thermometer" size={18} color="#B565D8" />
              <ThemedText style={styles.reasoningText}>
                <ThemedText style={styles.reasoningLabel}>Weather: </ThemedText>
                {outfit.reasoning.weather}
              </ThemedText>
            </View>

            <View style={styles.reasoningItem}>
              <IconSymbol name="calendar" size={18} color="#B565D8" />
              <ThemedText style={styles.reasoningText}>
                <ThemedText style={styles.reasoningLabel}>Events: </ThemedText>
                {outfit.reasoning.events}
              </ThemedText>
            </View>

            <View style={styles.reasoningItem}>
              <IconSymbol name="sparkles" size={18} color="#B565D8" />
              <ThemedText style={styles.reasoningText}>
                <ThemedText style={styles.reasoningLabel}>Style: </ThemedText>
                {outfit.reasoning.style}
              </ThemedText>
            </View>

            <View style={styles.reasoningItem}>
              <IconSymbol name="clock" size={18} color="#B565D8" />
              <ThemedText style={styles.reasoningText}>
                <ThemedText style={styles.reasoningLabel}>Freshness: </ThemedText>
                {outfit.reasoning.freshness}
              </ThemedText>
            </View>
          </View>
        </View>

        {/* Get Better Picks - Show if any permissions are missing */}
        {(missingPermissions.location || missingPermissions.calendar) && (
          <View style={styles.improveSection}>
            <ThemedText style={styles.improveSectionTitle}>Get better daily picks!</ThemedText>
            <ThemedText style={styles.improveSectionSubtitle}>
              Grant these permissions to get more personalized recommendations
            </ThemedText>

            <View style={styles.improveCards}>
              {missingPermissions.location && (
                <TouchableOpacity
                  style={styles.improveCard}
                  onPress={requestLocationPermission}
                >
                  <View style={styles.improveCardHeader}>
                    <IconSymbol name="location.fill" size={24} color="#B565D8" />
                    <ThemedText style={styles.improveCardTitle}>Location Access</ThemedText>
                  </View>
                  <ThemedText style={styles.improveCardDescription}>
                    Get weather-appropriate outfit suggestions based on your local conditions
                  </ThemedText>
                  <View style={styles.improveCardButton}>
                    <ThemedText style={styles.improveCardButtonText}>Enable</ThemedText>
                    <IconSymbol name="chevron.right" size={16} color="#B565D8" />
                  </View>
                </TouchableOpacity>
              )}

              {missingPermissions.calendar && (
                <TouchableOpacity
                  style={styles.improveCard}
                  onPress={requestCalendarPermission}
                >
                  <View style={styles.improveCardHeader}>
                    <IconSymbol name="calendar" size={24} color="#B565D8" />
                    <ThemedText style={styles.improveCardTitle}>Calendar Access</ThemedText>
                  </View>
                  <ThemedText style={styles.improveCardDescription}>
                    Get event-appropriate outfits based on what{"'"}s on your schedule
                  </ThemedText>
                  <View style={styles.improveCardButton}>
                    <ThemedText style={styles.improveCardButtonText}>Enable</ThemedText>
                    <IconSymbol name="chevron.right" size={16} color="#B565D8" />
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Feedback Section */}
        <View style={styles.feedbackSection}>
          <ThemedText style={styles.sectionTitle}>How do you like this outfit?</ThemedText>
          {outfit.feedback ? (
            <View style={styles.feedbackGiven}>
              <IconSymbol
                name={outfit.feedback.rating === 'thumbs-up' ? 'hand.thumbsup.fill' : 'hand.thumbsdown.fill'}
                size={24}
                color={outfit.feedback.rating === 'thumbs-up' ? '#22c55e' : '#ef4444'}
              />
              <ThemedText style={styles.feedbackText}>
                Feedback: {outfit.feedback.rating === 'thumbs-up' ? 'Liked' : 'Disliked'}
                {outfit.feedback.reason ? ` - ${outfit.feedback.reason}` : ''}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.feedbackButtons}>
              <TouchableOpacity
                style={[styles.feedbackButton, styles.thumbsUpButton]}
                onPress={() => handleFeedback('thumbs-up')}
              >
                <IconSymbol name="hand.thumbsup" size={24} color="white" />
                <ThemedText style={styles.feedbackButtonText}>Love it!</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.feedbackButton, styles.thumbsDownButton]}
                onPress={() => handleFeedback('thumbs-down')}
              >
                <IconSymbol name="hand.thumbsdown" size={24} color="white" />
                <ThemedText style={styles.feedbackButtonText}>Not for me</ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionSection}>
          <ThemedText style={styles.actionHint}>
            Use arrows above to see {outfits.length} different outfit options
          </ThemedText>
        </View>
        </ScrollView>

      {/* Feedback Modal */}
      <Modal
        visible={showFeedbackModal}
        transparent={true}
        animationType="slide"
        onRequestClose={handleFeedbackModalCancel}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => Keyboard.dismiss()}
          />
          <View style={styles.modalContent}>
            <ThemedText style={styles.modalTitle}>Help us improve</ThemedText>
            <ThemedText style={styles.modalSubtitle}>
              What didn{"'"}t work about this outfit? (Select all that apply)
            </ThemedText>

            <ScrollView
              style={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.reasonButtons}>
                {[
                  'Not warm enough',
                  'Too warm for weather',
                  'Not my style',
                  'Colors don\'t match',
                  'Worn recently',
                  'Wrong for the occasion'
                ].map((reason) => (
                  <TouchableOpacity
                    key={reason}
                    style={[
                      styles.reasonButton,
                      feedbackReasons.includes(reason) && styles.reasonButtonSelected
                    ]}
                    onPress={() => toggleFeedbackReason(reason)}
                  >
                    <ThemedText style={[
                      styles.reasonButtonText,
                      feedbackReasons.includes(reason) && styles.reasonButtonTextSelected
                    ]}>
                      {reason}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.customReasonInput}
                placeholder="Or tell us in your own words..."
                value={customFeedbackReason}
                onChangeText={setCustomFeedbackReason}
                multiline
                numberOfLines={2}
                placeholderTextColor="#999"
                returnKeyType="done"
                blurOnSubmit={true}
              />
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={handleFeedbackModalCancel}
              >
                <ThemedText style={styles.modalCancelText}>Skip</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitButton}
                onPress={handleFeedbackModalSubmit}
              >
                <ThemedText style={styles.modalSubmitText}>Submit</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Thumbs Up Comment Modal */}
      <Modal
        visible={showThumbsUpModal}
        transparent={true}
        animationType="slide"
        onRequestClose={handleThumbsUpModalSkip}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => Keyboard.dismiss()}
          />
          <View style={styles.modalContent}>
            <View style={styles.thumbsUpHeader}>
              <IconSymbol name="heart.fill" size={32} color={VestiaryColors.gold} />
              <ThemedText style={styles.modalTitle}>You love this outfit!</ThemedText>
            </View>
            <ThemedText style={styles.modalSubtitle}>
              Want to add a note about why? (optional)
            </ThemedText>

            <TextInput
              style={styles.thumbsUpCommentInput}
              placeholder="e.g., Perfect for date night, Great color combo..."
              value={thumbsUpComment}
              onChangeText={setThumbsUpComment}
              multiline
              numberOfLines={3}
              placeholderTextColor="#999"
              returnKeyType="done"
              blurOnSubmit={true}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={handleThumbsUpModalSkip}
              >
                <ThemedText style={styles.modalCancelText}>Skip</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSubmitButton, styles.thumbsUpSubmitButton]}
                onPress={handleThumbsUpModalSubmit}
              >
                <ThemedText style={styles.modalSubmitText}>
                  {thumbsUpComment.trim() ? 'Save Note' : 'Done'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Item Preview Modal */}
      <Modal
        visible={showItemPreviewModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowItemPreviewModal(false);
          setSelectedItemForPreview(null);
        }}
      >
        <TouchableOpacity
          style={styles.previewModalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowItemPreviewModal(false);
            setSelectedItemForPreview(null);
          }}
        >
          <View style={styles.previewModalContent}>
            {selectedItemForPreview?.photo && (
              <Image
                source={{ uri: selectedItemForPreview.photo }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
            <View style={styles.previewDetails}>
              <ThemedText style={styles.previewCategory}>
                {selectedItemForPreview?.displayCategory || selectedItemForPreview?.category}
              </ThemedText>
              {selectedItemForPreview && (
                <ThemedText style={styles.previewDescription}>
                  {formatItemDescription(
                    selectedItemForPreview,
                    selectedItemForPreview.displayCategory || selectedItemForPreview.category
                  )}
                </ThemedText>
              )}
            </View>
            <TouchableOpacity
              style={styles.markWornButton}
              onPress={() => selectedItemForPreview && markAsWorn(selectedItemForPreview.id)}
            >
              <IconSymbol name="checkmark.circle.fill" size={20} color="white" />
              <ThemedText style={styles.markWornButtonText}>Mark as Worn</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.closePreviewButton}
              onPress={() => {
                setShowItemPreviewModal(false);
                setSelectedItemForPreview(null);
              }}
            >
              <ThemedText style={styles.closePreviewButtonText}>Close</ThemedText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  outfitCounter: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    fontWeight: '500',
  },
  swipeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 15,
  },
  swipeButton: {
    padding: 12,
    borderRadius: 20,
    backgroundColor: VestiaryColors.navyLight,
  },
  outfitIndicators: {
    flexDirection: 'row',
    gap: 8,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: VestiaryColors.navyLight,
  },
  activeIndicator: {
    backgroundColor: VestiaryColors.gold,
    width: 24,
  },
  headerContainer: {
    backgroundColor: VestiaryColors.navy,
    paddingHorizontal: 20,
    paddingBottom: 20,
    zIndex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: VestiaryColors.gold,
    flexShrink: 1,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: VestiaryColors.navyLight,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  loadingSubtext: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginTop: 8,
    textAlign: 'center',
  },
  progressText: {
    fontSize: 16,
    fontWeight: '500',
    color: VestiaryColors.gold,
    marginTop: 16,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
    color: VestiaryColors.creamDark,
  },
  retryButton: {
    backgroundColor: VestiaryColors.gold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: VestiaryColors.navyDark,
    fontSize: 16,
    fontWeight: '600',
  },
  contextSection: {
    marginBottom: 24,
    marginTop: 20,
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  contextInfo: {
    marginLeft: 12,
    flex: 1,
  },
  contextTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    color: VestiaryColors.cream,
  },
  contextText: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
  },
  dressCodeSection: {
    marginBottom: 24,
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  dressCodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  dressCodeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: VestiaryColors.cream,
  },
  dressCodeApplied: {
    flexShrink: 1,
    fontSize: 13,
    color: VestiaryColors.gold,
    fontWeight: '600',
    textAlign: 'right',
  },
  dressCodeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dressCodeInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VestiaryColors.navy,
    backgroundColor: VestiaryColors.navy,
    paddingHorizontal: 12,
    fontSize: 15,
    color: VestiaryColors.cream,
  },
  dressCodeApplyButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestiaryColors.gold,
  },
  dressCodeApplyButtonDisabled: {
    backgroundColor: VestiaryColors.navy,
  },
  dressCodeApplyText: {
    fontSize: 14,
    fontWeight: '700',
    color: VestiaryColors.navyDark,
  },
  dressCodeApplyTextDisabled: {
    color: VestiaryColors.creamDark,
  },
  dressCodePresetRow: {
    gap: 8,
    paddingTop: 12,
  },
  dressCodePreset: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: VestiaryColors.navy,
    borderWidth: 1,
    borderColor: VestiaryColors.navy,
  },
  dressCodePresetSelected: {
    borderColor: VestiaryColors.gold,
    backgroundColor: VestiaryColors.gold,
  },
  dressCodePresetText: {
    fontSize: 13,
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  dressCodePresetTextSelected: {
    color: VestiaryColors.navyDark,
  },
  dressCodeClear: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VestiaryColors.gold,
  },
  dressCodeClearText: {
    fontSize: 13,
    fontWeight: '600',
    color: VestiaryColors.gold,
  },
  outfitSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
    color: VestiaryColors.cream,
  },
  outfitGrid: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  makeupSection: {
    marginTop: 12,
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  makeupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  makeupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  makeupHeaderTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  makeupCountBadge: {
    backgroundColor: VestiaryColors.goldDark,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  makeupCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: VestiaryColors.cream,
  },
  makeupItemsList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: VestiaryColors.navy,
  },
  clothingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navy,
  },
  itemImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: '#FFFFFF',
  },
  placeholderImage: {
    backgroundColor: VestiaryColors.navy,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemDetails: {
    flex: 1,
  },
  itemCategory: {
    fontSize: 12,
    color: VestiaryColors.gold,
    fontWeight: '600',
    marginBottom: 2,
  },
  itemDescription: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
    color: VestiaryColors.cream,
  },
  itemMaterial: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
  },
  reasoningSection: {
    marginBottom: 24,
  },
  reasoningCard: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  reasoningItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  reasoningText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    lineHeight: 20,
    color: VestiaryColors.cream,
  },
  reasoningLabel: {
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  actionSection: {
    marginBottom: 40,
    alignItems: 'center',
  },
  actionHint: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  weatherInfo: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    fontStyle: 'italic',
    marginTop: 8,
  },
  stylistSection: {
    marginBottom: 24,
  },
  stylistCommentContainer: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: VestiaryColors.gold,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  stylistComment: {
    fontSize: 15,
    color: VestiaryColors.cream,
    fontStyle: 'italic',
    lineHeight: 22,
    fontWeight: '500',
  },
  hairSection: {
    marginBottom: 24,
  },
  hairSuggestionCard: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: VestiaryColors.gold,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  hairSuggestionHeader: {
    marginBottom: 8,
  },
  hairSuggestionName: {
    fontSize: 17,
    fontWeight: '700',
    color: VestiaryColors.gold,
    letterSpacing: 0.2,
  },
  hairSuggestionDescription: {
    fontSize: 14,
    color: VestiaryColors.cream,
    lineHeight: 20,
    marginBottom: 12,
  },
  hairSuggestionReasoningContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: VestiaryColors.navy,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  hairSuggestionReasoning: {
    flex: 1,
    fontSize: 13,
    color: VestiaryColors.creamDark,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  feedbackSection: {
    marginBottom: 24,
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  feedbackButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  thumbsUpButton: {
    backgroundColor: '#22c55e',
  },
  thumbsDownButton: {
    backgroundColor: '#ef4444',
  },
  feedbackButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  feedbackGiven: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  feedbackText: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: VestiaryColors.navy,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '80%',
  },
  modalScrollContent: {
    flexGrow: 0,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    color: VestiaryColors.cream,
  },
  modalSubtitle: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    marginBottom: 24,
    textAlign: 'center',
  },
  reasonButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  reasonButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: VestiaryColors.navyLight,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  reasonButtonSelected: {
    backgroundColor: VestiaryColors.gold,
    borderColor: VestiaryColors.gold,
  },
  reasonButtonText: {
    fontSize: 14,
    color: VestiaryColors.cream,
  },
  reasonButtonTextSelected: {
    color: VestiaryColors.navyDark,
  },
  customReasonInput: {
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: VestiaryColors.navyLight,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 24,
    color: VestiaryColors.cream,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: VestiaryColors.navyLight,
    alignItems: 'center',
  },
  modalSubmitButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: VestiaryColors.gold,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    fontWeight: '500',
  },
  modalSubmitText: {
    fontSize: 16,
    color: VestiaryColors.navyDark,
    fontWeight: '600',
  },
  thumbsUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 8,
  },
  thumbsUpCommentInput: {
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: VestiaryColors.navyLight,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 24,
    marginTop: 8,
    color: VestiaryColors.cream,
  },
  thumbsUpSubmitButton: {
    backgroundColor: VestiaryColors.gold,
  },
  improveSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  improveSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: VestiaryColors.cream,
    marginBottom: 8,
  },
  improveSectionSubtitle: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginBottom: 16,
  },
  improveCards: {
    gap: 12,
  },
  improveCard: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  improveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  improveCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  improveCardDescription: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    lineHeight: 20,
    marginBottom: 12,
  },
  improveCardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  improveCardButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.gold,
  },
  previewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  previewModalContent: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  previewDetails: {
    width: '100%',
    marginTop: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  previewCategory: {
    fontSize: 18,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 4,
  },
  previewDescription: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    textAlign: 'center',
  },
  markWornButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    width: '100%',
    marginBottom: 12,
  },
  markWornButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  closePreviewButton: {
    paddingVertical: 10,
  },
  closePreviewButtonText: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
  },
});
