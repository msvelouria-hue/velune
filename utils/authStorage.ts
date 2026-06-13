import AsyncStorage from '@react-native-async-storage/async-storage';
import { preferenceService } from './preferenceService';
import { outfitFeedbackService } from './outfitFeedbackService';

const LAST_AUTH_USER_ID_KEY = 'lastAuthUserId';
const PROFILE_STORAGE_KEY = 'userProfile';

const USER_SCOPED_STORAGE_KEYS = [
  'clothingItems',
  'closetItems',
  'dailyOutfits',
  'onboardingCompleted',
  'userProfile',
  'selectedStylist',
  'helpAreas',
  'hairProfile',
  'selectedGender',
  'clothesUploadMethod',
  'photoStatus',
  'outfitFeedback',
  'userStylePreferences',
  'temperaturePreference',
  'outfitAlgorithm',
  'lastSyncTimestamp',
  'lastSyncTime',
  'selectedImages',
  'locationAccess',
  'calendarAccess',
  'cameraRollAccess',
  'notificationsEnabled',
  'notificationTime',
];

const getProfileUserId = (rawProfile: string | null): string | null => {
  if (!rawProfile) return null;

  try {
    const parsed = JSON.parse(rawProfile);
    return typeof parsed?.uid === 'string' ? parsed.uid : null;
  } catch (error) {
    console.warn('⚠️ Could not parse cached user profile while checking account scope:', error);
    return null;
  }
};

export const clearUserScopedLocalData = async (): Promise<void> => {
  await AsyncStorage.multiRemove(USER_SCOPED_STORAGE_KEYS);
  await Promise.all([
    preferenceService.clearPreferences({ removeFromStorage: true }),
    outfitFeedbackService.clearCache(),
  ]);
};

export const prepareLocalDataForAuthenticatedUser = async (
  userId: string
): Promise<{ resetPerformed: boolean; previousUserId: string | null }> => {
  const entries = await AsyncStorage.multiGet([LAST_AUTH_USER_ID_KEY, PROFILE_STORAGE_KEY]);
  const lastAuthUserId = entries.find(([key]) => key === LAST_AUTH_USER_ID_KEY)?.[1] ?? null;
  const cachedProfileRaw = entries.find(([key]) => key === PROFILE_STORAGE_KEY)?.[1] ?? null;
  const cachedProfileUserId = getProfileUserId(cachedProfileRaw);

  const previousUserId = lastAuthUserId || cachedProfileUserId;
  const shouldReset =
    (lastAuthUserId !== null && lastAuthUserId !== userId) ||
    (cachedProfileUserId !== null && cachedProfileUserId !== userId);

  if (shouldReset) {
    console.log(`🧹 Clearing user-scoped local data before loading account ${userId} (previous: ${previousUserId})`);
    await clearUserScopedLocalData();
  }

  await AsyncStorage.setItem(LAST_AUTH_USER_ID_KEY, userId);

  return {
    resetPerformed: shouldReset,
    previousUserId,
  };
};
