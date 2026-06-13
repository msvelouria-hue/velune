import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VestiaryColors } from '@/constants/Colors';

export default function CameraScreen() {
  const [type, setType] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleGoBack = () => {
    if (router && router.back) {
      router.back();
    } else if (router && router.push) {
      // Fallback to navigate to onboarding if back is not available
      router.push('/onboarding');
    } else {
      console.warn('Router not available');
    }
  };

  if (!permission) {
    // Camera permissions are still loading
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Loading camera...</ThemedText>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    // Camera permissions are not granted yet
    return (
      <ThemedView style={[styles.container, styles.permissionContainer]}>
        <ThemedText style={styles.message}>We need your permission to show the camera</ThemedText>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: false,
        });

        // Navigate back with the photo URI
        router.back();

        // Use a small delay to ensure navigation completes, then notify parent
        setTimeout(() => {
          // Emit a custom event that the onboarding screen can listen for
          if (global.onPhotoTaken) {
            global.onPhotoTaken(photo.uri);
          }
        }, 100);

      } catch (error) {
        console.error('Error taking picture:', error);
        Alert.alert('Error', 'Failed to take picture. Please try again.');
      }
    }
  };

  function toggleCameraType() {
    setType(current => (current === 'back' ? 'front' : 'back'));
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView style={styles.camera} facing={type} ref={cameraRef}>
        <View style={[styles.buttonContainer, { paddingTop: insets.top }]}>
          {/* Close button */}
          <TouchableOpacity style={styles.closeButton} onPress={handleGoBack}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>

          {/* Flip camera button */}
          <TouchableOpacity style={styles.flipButton} onPress={toggleCameraType}>
            <Text style={styles.flipButtonText}>🔄</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomControls}>
          {/* Take picture button */}
          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </View>
      </CameraView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: VestiaryColors.navy,
  },
  message: {
    textAlign: 'center',
    fontSize: 18,
    marginBottom: 20,
    color: VestiaryColors.cream,
  },
  button: {
    backgroundColor: VestiaryColors.gold,
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
  },
  buttonText: {
    color: VestiaryColors.navyDark,
    fontSize: 16,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  closeButton: {
    backgroundColor: VestiaryColors.navyLight,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: VestiaryColors.cream,
    fontSize: 18,
    fontWeight: 'bold',
  },
  flipButton: {
    backgroundColor: VestiaryColors.navyLight,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButtonText: {
    color: VestiaryColors.cream,
    fontSize: 18,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(201, 167, 86, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: VestiaryColors.gold,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: VestiaryColors.gold,
  },
});
