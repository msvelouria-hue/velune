import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useColorScheme } from '@/hooks/useColorScheme';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Add global error handler for unhandled promise rejections
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('Unhandled promise rejection:', event.reason);
    // Prevent the default behavior of logging to console
    event.preventDefault();
  });
} else {
  // For React Native environments, use global error tracking
  const originalConsoleError = console.error;
  console.error = (...args) => {
    if (args[0]?.includes?.('Possible Unhandled Promise Rejection')) {
      console.warn('Unhandled promise rejection detected in React Native');
    }
    originalConsoleError.apply(console, args);
  };
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="add-clothing-item"
            options={{
              headerShown: false,
              presentation: 'modal'
            }}
          />
          <Stack.Screen
            name="edit-clothing-item"
            options={{
              headerShown: false,
              presentation: 'modal'
            }}
          />
          <Stack.Screen name="camera" options={{ headerShown: false }} />
          <Stack.Screen name="+not-found" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}