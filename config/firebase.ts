import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth } from 'firebase/auth';
// @ts-ignore - getReactNativePersistence exists in RN bundle but TypeScript can't see it
import { getReactNativePersistence } from 'firebase/auth';
import { getFirestore, initializeFirestore, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Firebase configuration using Replit secrets via EXPO_PUBLIC_ prefix
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: `${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'style-genie-f65ef'}.firebaseapp.com`,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'style-genie-f65ef',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'style-genie-f65ef.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '918311556677',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:918311556677:web:8c8b15db366b83ab55752c',
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-SN3C8GR7CE',
};

// Initialize Firebase - handle hot reload/multiple initializations
let app: FirebaseApp;
let auth: Auth;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);

  // Initialize Firebase Auth with proper persistence for React Native
  // This ensures login sessions persist across app restarts
  if (Platform.OS === 'web') {
    auth = getAuth(app);
  } else {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
} else {
  app = getApp();
  auth = getAuth(app);
}

// Initialize Firestore with specific settings for React Native
const db = initializeFirestore(app, {
  cacheSizeBytes: CACHE_SIZE_UNLIMITED,
  experimentalForceLongPolling: true,
});

const storage = getStorage(app);

export { app, auth, db, storage };
export default app;
