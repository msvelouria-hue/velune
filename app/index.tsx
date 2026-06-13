import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/config/firebase';
import { warmupBackgroundRemovalServer } from '@/utils/serverWarmup';
import { cloudSyncService } from '@/utils/cloudSyncService';
import { ensureUserDoc } from '@/utils/userProfileService';
import { prepareLocalDataForAuthenticatedUser } from '@/utils/authStorage';

export default function Index() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          // No user is signed in, go to login
          router.replace('/login');
        } else {
          await prepareLocalDataForAuthenticatedUser(user.uid);

          // User is authenticated, warm up the background removal server (async, non-blocking)
          warmupBackgroundRemovalServer();

          // Firestore is the closet source of truth. Load it before deciding where to go.
          console.log('Loading closet from Firestore on login...');
          const closetItems = await cloudSyncService.loadClosetItems();

          // Ensure user profile doc exists and check onboarding status
          const { onboardingCompleted } = await ensureUserDoc(user.uid, user.email);

          if (onboardingCompleted) {
            if (closetItems.length === 0) {
              // No closet items, direct to closet tab
              router.replace('/(tabs)');
            } else {
              // Has items, go to daily picks
              router.replace('/(tabs)/dailypicks');
            }
          } else {
            // Onboarding not completed, go to onboarding
            router.replace('/onboarding');
          }
        }
      } catch (error) {
        console.error('Error checking auth/onboarding status:', error);
        // On error, try to go to login
        router.replace('/login');
      } finally {
        setIsLoading(false);
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa' }}>
        <ActivityIndicator size="large" color="#B565D8" />
      </View>
    );
  }

  return null;
}
