import { doc, getDoc, getDocFromServer, getDocsFromServer, setDoc, updateDoc, increment, collection, query, where, limit } from 'firebase/firestore';
import { db, auth } from '@/config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ensures a user profile document exists in Firestore.
 * If the doc doesn't exist, creates it with default values.
 * If user has closet items but no profile, marks onboarding as complete (data repair).
 * Returns the profile with onboardingCompleted status.
 */
export const ensureUserDoc = async (uid: string, email?: string | null): Promise<{ onboardingCompleted: boolean; isNewUser: boolean }> => {
  console.log(`🔐 ensureUserDoc: Checking profile for UID ${uid}`);

  const userDocRef = doc(db, 'users', uid);

  try {
    // Always read from server to avoid cache issues
    const snap = await getDocFromServer(userDocRef);

    if (snap.exists()) {
      const data = snap.data();
      console.log(`✅ ensureUserDoc: Profile exists, onboardingCompleted=${data.onboardingCompleted}`);

      // Sync to local storage
      await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data));
      if (data.onboardingCompleted) {
        await AsyncStorage.setItem('onboardingCompleted', 'true');
      }

      return {
        onboardingCompleted: data.onboardingCompleted === true,
        isNewUser: false
      };
    }

    console.log(`📋 ensureUserDoc: Profile doesn't exist, checking for existing closet items...`);

    // Profile doesn't exist - check if user has closet items (data integrity check)
    const closetRef = collection(db, 'closetItems');
    const closetQuery = query(closetRef, where('userId', '==', uid), limit(1));
    const closetSnap = await getDocsFromServer(closetQuery);
    const hasExistingItems = !closetSnap.empty;

    if (hasExistingItems) {
      console.log(`⚠️ ensureUserDoc: User has closet items but no profile - DATA REPAIR needed`);
      console.log(`🔧 ensureUserDoc: Creating profile with onboardingCompleted=true`);
    } else {
      console.log(`📝 ensureUserDoc: New user, creating profile with onboardingCompleted=false`);
    }

    // Create the profile doc
    const newProfile = {
      uid,
      email: email || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      onboardingCompleted: hasExistingItems, // true if they have items (repair), false if new user
      schemaVersion: 1,
    };

    await setDoc(userDocRef, newProfile);
    console.log(`✅ ensureUserDoc: Profile created successfully`);

    // Sync to local storage
    await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(newProfile));
    if (hasExistingItems) {
      await AsyncStorage.setItem('onboardingCompleted', 'true');
    }

    return {
      onboardingCompleted: hasExistingItems,
      isNewUser: !hasExistingItems
    };
  } catch (error) {
    console.error(`❌ ensureUserDoc: Error:`, error);

    // Fallback to local storage
    const localOnboarding = await AsyncStorage.getItem('onboardingCompleted');
    return {
      onboardingCompleted: localOnboarding === 'true',
      isNewUser: false
    };
  }
};

export interface HairProfile {
  length: string;
  texture: string;
  color: string;
  style?: string;
}

export type MakeupPreferenceLevel = 'none' | 'minimal' | 'everyday' | 'full';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  selectedStylist?: string;
  gender?: string;
  helpAreas?: string[];
  hairProfile?: HairProfile;
  makeupPreferenceLevel?: MakeupPreferenceLevel;
  makeupAllergyOrAvoid?: string;
  makeupNotes?: string;
  onboardingCompleted?: boolean;
  permissions?: string[];
  outfitAlgorithm?: 'basic' | 'premium';
  createdAt?: string;
  updatedAt?: string;
  t_login_count?: number;
  t_wardrobe_item_count?: number;
  t_wardrobe_request_submissions_basic?: number;
  t_wardrobe_request_submissions_premium_ai?: number;
}

export const isBetaTester = (profile: UserProfile | null): boolean => {
  return profile?.permissions?.includes('beta tester') ?? false;
};

export type TrackingStat =
  | 't_login_count'
  | 't_wardrobe_item_count'
  | 't_wardrobe_request_submissions_basic'
  | 't_wardrobe_request_submissions_premium_ai';

export const trackUserStat = async (
  stat: TrackingStat,
  delta: number = 1
): Promise<void> => {
  const user = auth.currentUser;
  if (!user) {
    console.log('⚠️ Cannot track stat: no authenticated user');
    return;
  }

  try {
    const userDocRef = doc(db, 'users', user.uid);
    await updateDoc(userDocRef, {
      [stat]: increment(delta),
      updatedAt: new Date().toISOString(),
    });
    console.log(`📊 Tracked ${stat}: ${delta > 0 ? '+' : ''}${delta}`);
  } catch (error: any) {
    if (error?.code === 'not-found') {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
          uid: user.uid,
          email: user.email,
          [stat]: delta > 0 ? delta : 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        console.log(`📊 Created user doc and tracked ${stat}: ${delta}`);
      } catch (createError) {
        console.warn(`⚠️ Could not create user doc for tracking:`, createError);
      }
    } else {
      console.warn(`⚠️ Could not track ${stat}:`, error?.message || error);
    }
  }
};

export const setUserStatAbsolute = async (
  stat: TrackingStat,
  absoluteValue: number
): Promise<void> => {
  const user = auth.currentUser;
  if (!user) {
    console.log('⚠️ Cannot set stat: no authenticated user');
    return;
  }

  // Clamp to zero minimum
  const value = Math.max(0, absoluteValue);

  try {
    const userDocRef = doc(db, 'users', user.uid);
    await updateDoc(userDocRef, {
      [stat]: value,
      updatedAt: new Date().toISOString(),
    });
    console.log(`📊 Set ${stat} = ${value}`);
  } catch (error: any) {
    if (error?.code === 'not-found') {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
          uid: user.uid,
          email: user.email,
          [stat]: value,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        console.log(`📊 Created user doc and set ${stat} = ${value}`);
      } catch (createError) {
        console.warn(`⚠️ Could not create user doc for stat:`, createError);
      }
    } else {
      console.warn(`⚠️ Could not set ${stat}:`, error?.message || error);
    }
  }
};

export const recomputeWardrobeItemCount = async (items: any[]): Promise<void> => {
  const count = items.filter(item =>
    item &&
    item.id &&
    !item.isDeleted &&
    item.category !== 'Evaluating' &&
    !item.isEvaluating
  ).length;

  await setUserStatAbsolute('t_wardrobe_item_count', count);
  console.log(`📊 Recomputed wardrobe item count: ${count}`);
};

const PROFILE_STORAGE_KEY = 'userProfile';

export const saveUserProfile = async (profile: Partial<UserProfile>, options?: { waitForFirestore?: boolean }): Promise<void> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user');
  }

  const userProfile: UserProfile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    ...profile,
    updatedAt: new Date().toISOString(),
  };

  // Always save to AsyncStorage first (offline-first approach)
  await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(userProfile));
  console.log('✅ User profile saved to AsyncStorage');

  // For critical saves (like onboarding completion), wait for Firestore with longer timeout
  const shouldWait = options?.waitForFirestore ?? false;
  const timeoutMs = shouldWait ? 15000 : 3000; // 15 seconds for critical saves

  let firestoreSaved = false;

  const firestorePromise = (async () => {
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        ...userProfile,
        createdAt: new Date().toISOString(),
      }, { merge: true });
      firestoreSaved = true;
      console.log('✅ User profile synced to Firestore');
      return true;
    } catch (error: any) {
      console.warn('⚠️ Could not sync to Firestore:', error?.message || error);
      return false;
    }
  })();

  // Set timeout for Firestore sync
  const timeoutPromise = new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs));
  const result = await Promise.race([firestorePromise, timeoutPromise]);

  if (shouldWait && !result) {
    console.warn('⚠️ Firestore sync timed out or failed - retrying once...');
    // Retry once for critical saves
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        ...userProfile,
        createdAt: new Date().toISOString(),
      }, { merge: true });
      console.log('✅ User profile synced to Firestore on retry');
    } catch (retryError: any) {
      console.error('❌ Firestore retry also failed:', retryError?.message || retryError);
      // Don't throw - we still have local storage
    }
  }
};

export const getUserProfile = async (userOverride?: { uid: string }): Promise<UserProfile | null> => {
  const user = userOverride || auth.currentUser;
  if (!user) {
    console.log('⚠️ getUserProfile: No user available');
    return null;
  }

  console.log(`📋 getUserProfile: Fetching profile for user ${user.uid}`);

  try {
    const userDocRef = doc(db, 'users', user.uid);
    // Use getDocFromServer to ensure we're reading from server, not cache
    // This is critical for checking onboarding status on login
    const userDoc = await getDocFromServer(userDocRef);

    if (userDoc.exists()) {
      const profile = userDoc.data() as UserProfile;
      console.log(`✅ getUserProfile: Found Firestore profile (from server), onboardingCompleted: ${profile.onboardingCompleted}`);
      await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      return profile;
    }

    console.log('📋 getUserProfile: No Firestore profile on server, checking local storage');
    const localProfile = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
    return localProfile ? JSON.parse(localProfile) : null;
  } catch (error) {
    console.error('Error getting user profile from Firestore:', error);
    // Fallback to local storage if server read fails (e.g., offline)
    const localProfile = await AsyncStorage.getItem(PROFILE_STORAGE_KEY);
    return localProfile ? JSON.parse(localProfile) : null;
  }
};

export const updateOnboardingStatus = async (completed: boolean): Promise<void> => {
  console.log(`📝 updateOnboardingStatus: Setting to ${completed} with Firestore wait...`);
  // This is critical - must wait for Firestore to ensure cross-device sync works
  await saveUserProfile({ onboardingCompleted: completed }, { waitForFirestore: true });
  await AsyncStorage.setItem('onboardingCompleted', completed.toString());
  console.log(`✅ updateOnboardingStatus: Successfully saved to both Firestore and AsyncStorage`);
};
