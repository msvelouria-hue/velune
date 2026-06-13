import React, { useState, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Image, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { signInWithGoogleCredential, signInWithApple } from '@/utils/firebaseAuth';
import { warmupBackgroundRemovalServer } from '@/utils/serverWarmup';
import { cloudSyncService } from '@/utils/cloudSyncService';
import { ensureUserDoc, trackUserStat } from '@/utils/userProfileService';
import { cacheUserId } from '@/utils/promptLogService';
import { prepareLocalDataForAuthenticatedUser } from '@/utils/authStorage';
import { VestiaryColors } from '@/constants/Colors';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Configure Google Sign In
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      handleGoogleSignInWithToken(id_token);
    } else if (response?.type === 'cancel' || response?.type === 'dismiss') {
      // User cancelled the Google sign-in flow, reset loading state
      setLoading(false);
    }
  }, [response]);

  const handleGoogleSignInWithToken = async (idToken: string) => {
    try {
      setLoading(true);
      const result = await signInWithGoogleCredential(idToken);

      if (result.user) {
        const { uid, email } = result.user;

        // Log auth info for debugging
        console.log(`🔐 AUTH uid: ${uid}`);
        console.log(`🔐 AUTH email: ${email}`);
        console.log(`🔐 AUTH providers:`, result.user.providerData?.map(p => p.providerId));

        await prepareLocalDataForAuthenticatedUser(uid);

        // Cache userId for prompt logging (handles auth edge cases)
        await cacheUserId(uid);

        // Track login count
        trackUserStat('t_login_count');

        // Warm up the background removal server immediately after authentication
        warmupBackgroundRemovalServer();

        // Refresh existing local rows from Firestore without changing Settings sync state.
        cloudSyncService.refreshLocalItemsFromCloud({ updateLastSyncTime: false }).then((result) => {
          console.log(`📥 Refreshed ${result.refreshed} local items and added ${result.added} cloud items on login`);
        }).catch((error) => {
          console.warn('⚠️ Background sync failed:', error);
        });

        // Ensure user profile doc exists and get onboarding status
        const { onboardingCompleted } = await ensureUserDoc(uid, email);

        if (onboardingCompleted) {
          router.replace('/(tabs)');
        } else {
          router.replace('/onboarding');
        }
      }
    } catch (error: any) {
      console.error('Google sign in error:', error);
      Alert.alert('Sign In Failed', error.message || 'Could not sign in with Google');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      await promptAsync();
    } catch (error: any) {
      console.error('Google sign in error:', error);
      Alert.alert('Sign In Failed', error.message || 'Could not sign in with Google');
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      const result = await signInWithApple();

      if (result.user) {
        const { uid, email } = result.user;

        // Log auth info for debugging
        console.log(`🔐 AUTH uid: ${uid}`);
        console.log(`🔐 AUTH email: ${email}`);
        console.log(`🔐 AUTH providers:`, result.user.providerData?.map(p => p.providerId));

        await prepareLocalDataForAuthenticatedUser(uid);

        // Cache userId for prompt logging (handles auth edge cases)
        await cacheUserId(uid);

        // Track login count
        trackUserStat('t_login_count');

        // Warm up the background removal server immediately after authentication
        warmupBackgroundRemovalServer();

        // Refresh existing local rows from Firestore without changing Settings sync state.
        cloudSyncService.refreshLocalItemsFromCloud({ updateLastSyncTime: false }).then((result) => {
          console.log(`📥 Refreshed ${result.refreshed} local items and added ${result.added} cloud items on login`);
        }).catch((error) => {
          console.warn('⚠️ Background sync failed:', error);
        });

        // Ensure user profile doc exists and get onboarding status
        const { onboardingCompleted } = await ensureUserDoc(uid, email);

        if (onboardingCompleted) {
          router.replace('/(tabs)');
        } else {
          router.replace('/onboarding');
        }
      }
    } catch (error: any) {
      // Check if user cancelled the sign-in (not an error, just user action)
      const isCancellation = error?.message?.toLowerCase().includes('cancel') ||
                             error?.code === 'ERR_REQUEST_CANCELED';

      if (!isCancellation) {
        console.error('Apple sign in error:', error);
        Alert.alert('Sign In Failed', error.message || 'Could not sign in with Apple');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20
          }
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* App Logo/Icon */}
        <View style={styles.logoContainer}>
          <IconSymbol name="tshirt.fill" size={80} color={VestiaryColors.gold} />
          <ThemedText style={styles.appName}>Velune</ThemedText>
          <ThemedText style={styles.tagline}>
            Your personal AI stylist for daily outfit recommendations
          </ThemedText>
        </View>

        {/* Feature highlights */}
        <View style={styles.featuresContainer}>
          <View style={styles.feature}>
            <IconSymbol name="camera.fill" size={24} color={VestiaryColors.gold} />
            <ThemedText style={styles.featureText}>
              Digitize your wardrobe with AI-powered photo detection
            </ThemedText>
          </View>

          <View style={styles.feature}>
            <IconSymbol name="sparkles" size={24} color={VestiaryColors.gold} />
            <ThemedText style={styles.featureText}>
              Get personalized outfit suggestions based on weather and events
            </ThemedText>
          </View>

          <View style={styles.feature}>
            <IconSymbol name="arrow.triangle.2.circlepath" size={24} color={VestiaryColors.gold} />
            <ThemedText style={styles.featureText}>
              Sync your closet across all your devices
            </ThemedText>
          </View>
        </View>

        {/* Sign in buttons */}
        <View style={styles.authContainer}>
          <TouchableOpacity
            style={[styles.authButton, styles.googleButton]}
            onPress={handleGoogleSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#1f2937" />
            ) : (
              <>
                <View style={styles.googleIcon}>
                  <ThemedText style={styles.googleIconText}>G</ThemedText>
                </View>
                <ThemedText style={styles.googleButtonText}>Continue with Google</ThemedText>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.authButton, styles.appleButton]}
              onPress={handleAppleSignIn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <IconSymbol name="apple.logo" size={20} color="white" />
                  <ThemedText style={styles.appleButtonText}>Continue with Apple</ThemedText>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Terms and privacy */}
        <ThemedText style={styles.termsText}>
          By continuing, you agree to Velune{"'"}s{'\n'}Terms of Service and Privacy Policy
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  appName: {
    fontSize: 36,
    fontWeight: '700',
    marginTop: 24,
    color: VestiaryColors.cream,
    lineHeight: 44,
  },
  tagline: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
  },
  featuresContainer: {
    gap: 20,
    marginTop: 60,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  featureText: {
    flex: 1,
    fontSize: 15,
    color: VestiaryColors.creamDark,
    lineHeight: 22,
  },
  authContainer: {
    gap: 12,
    marginTop: 60,
  },
  authButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 12,
  },
  googleButton: {
    backgroundColor: VestiaryColors.gold,
    borderWidth: 0,
    borderColor: VestiaryColors.gold,
  },
  googleIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: VestiaryColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: '#DB4437',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.navyDark,
  },
  appleButton: {
    backgroundColor: VestiaryColors.navyLight,
    borderWidth: 1,
    borderColor: VestiaryColors.creamDark,
  },
  appleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  termsText: {
    fontSize: 12,
    color: VestiaryColors.creamDark,
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 20,
    lineHeight: 18,
  },
});
