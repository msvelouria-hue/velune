import {
  signInWithCredential,
  GoogleAuthProvider,
  OAuthProvider,
  User,
  signInWithPopup
} from 'firebase/auth';
import { auth } from '@/config/firebase';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

// Google Sign In
// Note: This will be implemented in the component using Google.useIdTokenAuthRequest hook
export const signInWithGoogleCredential = async (idToken: string): Promise<{ user: User | null }> => {
  try {
    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);

    return { user: userCredential.user };
  } catch (error) {
    console.error('Google sign in error:', error);
    throw error;
  }
};

// Apple Sign In
export const signInWithApple = async (): Promise<{ user: User | null }> => {
  try {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign In is only available on iOS');
    }

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    const { identityToken } = appleCredential;

    if (!identityToken) {
      throw new Error('No identity token returned from Apple');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: identityToken,
    });

    const userCredential = await signInWithCredential(auth, credential);

    return { user: userCredential.user };
  } catch (error: any) {
    if (error.code === 'ERR_CANCELED') {
      // User cancelled the sign-in flow
      return { user: null };
    }
    console.error('Apple sign in error:', error);
    throw error;
  }
};

// Sign Out
export const signOut = async (): Promise<void> => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
};

// Get current user
export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};
