import React, { useState, useEffect, useCallback } from "react";
import { StyleSheet, TouchableOpacity, View, FlatList, Dimensions, ScrollView, Platform, Alert, ActivityIndicator } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { VestiaryColors } from "@/constants/Colors";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { Chip, Provider, SegmentedButtons } from 'react-native-paper';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { warmupBackgroundRemovalServer } from '@/utils/serverWarmup';
import { cloudSyncService } from '@/utils/cloudSyncService';
import { batchProcessingService } from '@/utils/batchProcessingService';
import { recomputeWardrobeItemCount } from '@/utils/userProfileService';
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { createBackgroundRemovalService, backgroundRemovalQueue } from '../../utils/backgroundRemoval';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence } from 'react-native-reanimated';
import {
  formatPhotoStatus,
  itemNeedsAttention,
  normalizePhotoStatus,
  type ClothingItem,
  type LayerType,
} from '@/utils/wardrobeTypes';

// Sleek minimalist spinner component with color transitions
const SpinnerComponent = () => {
  const rotation = useSharedValue(0);
  const colorPhase = useSharedValue(0);

  useEffect(() => {
    // Smooth rotation
    rotation.value = withRepeat(
      withTiming(360, { duration: 2000 }),
      -1,
      false
    );

    // Color cycling
    colorPhase.value = withRepeat(
      withTiming(1, { duration: 3000 }),
      -1,
      true
    );
  }, []);

  const animatedBar1Style = useAnimatedStyle(() => {
    const opacity = 0.3 + 0.7 * Math.sin((rotation.value + 0) * Math.PI / 180);
    return {
      transform: [{ rotate: `${rotation.value}deg` }],
      opacity,
    };
  });

  const animatedBar2Style = useAnimatedStyle(() => {
    const opacity = 0.3 + 0.7 * Math.sin((rotation.value + 120) * Math.PI / 180);
    return {
      transform: [{ rotate: `${rotation.value + 120}deg` }],
      opacity,
    };
  });

  const animatedBar3Style = useAnimatedStyle(() => {
    const opacity = 0.3 + 0.7 * Math.sin((rotation.value + 240) * Math.PI / 180);
    return {
      transform: [{ rotate: `${rotation.value + 240}deg` }],
      opacity,
    };
  });

  const centerDotStyle = useAnimatedStyle(() => {
    const scale = 0.8 + 0.4 * Math.sin((colorPhase.value * 2 * Math.PI));
    return {
      transform: [{ scale }],
    };
  });

  return (
    <View style={styles.spinnerContainer}>
      {/* Three rotating bars */}
      <Animated.View style={[styles.spinnerBar, animatedBar1Style]} />
      <Animated.View style={[styles.spinnerBar, animatedBar2Style]} />
      <Animated.View style={[styles.spinnerBar, animatedBar3Style]} />

      {/* Center pulsing dot */}
      {/* Removed: <Animated.View style={[styles.spinnerCenter, centerDotStyle]} /> */}
    </View>
  );
};

// PhotoStatusBadge component
const PhotoStatusBadge = ({ status }: { status: string }) => {
  const normalizedStatus = normalizePhotoStatus(status);
  const displayStatus = formatPhotoStatus(status);

  const getBadgeColor = () => {
    switch (normalizedStatus) {
      case 'uploading':
        return '#60a5fa'; // Blue
      case 'evaluating':
        return '#a855f7'; // Purple
      case 'needs_clarification':
        return '#f59e0b'; // Amber
      case 'pending':
        return '#facc15'; // Yellow
      case 'rejected':
        return '#ef4444'; // Red
      case 'approved':
        return '#10b981'; // Green
      default:
        return '#94a3b8'; // Gray
    }
  };

  const getBadgeIcon = () => {
    switch (normalizedStatus) {
      case 'uploading':
        return '⬆️';
      case 'evaluating':
        return '🔄';
      case 'needs_clarification':
        return '⚠️';
      case 'pending':
        return '⏳';
      case 'rejected':
        return '❌';
      case 'approved':
        return '✅';
      default:
        return '📄';
    }
  };

  return (
    <View style={[styles.statusBadge, { backgroundColor: getBadgeColor() }]}>
      <ThemedText style={styles.statusIcon}>{getBadgeIcon()}</ThemedText>
      <ThemedText style={styles.statusBadgeText}>{displayStatus}</ThemedText>
    </View>
  );
};

export default function ClosetScreen({ navigation }: { navigation: any }) { // Added navigation prop
  const [clothingItems, setClothingItems] = useState<ClothingItem[]>([]);
  const [filters, setFilters] = useState<{ season: string[], event: string[], clothingType: string[], sortBy: string }>({
    season: [],
    event: [],
    clothingType: [],
    sortBy: ''
  });
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [backgroundRemovalErrors, setBackgroundRemovalErrors] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastTone, setToastTone] = useState<'warning' | 'info'>('warning');
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();

  // Track cancelled evaluating items to prevent AI detection from creating items after deletion
  const cancelledEvaluatingItemsRef = React.useRef<Set<string>>(new Set());
  const pendingEvaluatingItemsRef = React.useRef<Map<string, ClothingItem>>(new Map());

  const isEvaluatingPlaceholder = (item?: ClothingItem | null): boolean => {
    return Boolean(
      item &&
      (item.isEvaluating || item.category === 'Evaluating' || normalizePhotoStatus(item.photoStatus) === 'evaluating')
    );
  };

  const getPendingEvaluatingItems = (): ClothingItem[] => {
    return Array.from(pendingEvaluatingItemsRef.current.values()).filter(
      item => !cancelledEvaluatingItemsRef.current.has(item.id)
    );
  };

  const mergeCloudItemsWithPendingEvaluating = (cloudItems: ClothingItem[]): ClothingItem[] => {
    const cloudIds = new Set(cloudItems.map(item => item.id));
    const pendingItems = getPendingEvaluatingItems().filter(item => !cloudIds.has(item.id));

    return [...pendingItems, ...cloudItems];
  };

  const removeEvaluatingPlaceholder = (
    itemId: string,
    options: { clearCancellation?: boolean } = {}
  ) => {
    pendingEvaluatingItemsRef.current.delete(itemId);
    if (options.clearCancellation) {
      cancelledEvaluatingItemsRef.current.delete(itemId);
    }
    setClothingItems(prev => prev.filter(item => item.id !== itemId));
  };

  const removeEvaluatingPlaceholders = (
    itemIds: string[],
    options: { clearCancellation?: boolean } = {}
  ) => {
    if (itemIds.length === 0) return;
    const idsToRemove = new Set(itemIds);

    itemIds.forEach(itemId => {
      pendingEvaluatingItemsRef.current.delete(itemId);
      if (options.clearCancellation) {
        cancelledEvaluatingItemsRef.current.delete(itemId);
      }
    });

    setClothingItems(prev => prev.filter(item => !idsToRemove.has(item.id)));
  };

  const showToastBanner = (message: string, tone: 'warning' | 'info' = 'warning', durationMs: number = 6000) => {
    setToastTone(tone);
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), durationMs);
  };

  // Initialize background removal service with real API keys from environment
  const backgroundRemovalService = React.useMemo(() => {
    // Error callback for background removal failures
    const handleBackgroundRemovalErrors = (errorCount: number) => {
      console.warn(`Background removal failed ${errorCount} times`);
      setBackgroundRemovalErrors(errorCount);

      if (errorCount >= 5) {
        showToastBanner(
          'Background removal service is experiencing issues. Photos will be processed without background removal.',
          'warning',
          10000
        );
      }
    };

    // Use Firebase Cloud Function for background removal (API key stored securely server-side)
    console.log('Using Firebase background removal service (secure proxy)');
    return createBackgroundRemovalService('firebase', undefined, handleBackgroundRemovalErrors);
  }, []);

  // Helper to check if a photo URL is already a processed (background-removed) image
  const isProcessedImageUrl = (url: string): boolean => {
    if (!url) return false;
    // Check for common patterns in processed image URLs
    return url.includes('_nobg.png') ||
           url.includes('/processed/') ||
           url.includes('background_removed') ||
           (url.includes('storage.googleapis.com') && url.endsWith('.png'));
  };

  // Initialize the background removal queue with callback to update items
  useEffect(() => {
    backgroundRemovalQueue.setService(backgroundRemovalService);

    // Set up callbacks for both success and failure with idempotency rules
    backgroundRemovalQueue.setCallbacks({
      onItemComplete: async (itemId: string, newImageUrl: string, attemptId: string) => {
        console.log(`🎨 Background removal complete for ${itemId} (attempt: ${attemptId}), updating storage...`);

        try {
          const currentItem = await cloudSyncService.getItem(itemId);
          if (!currentItem) return;

          if (
            currentItem.backgroundRemovalStatus === 'complete' &&
            isProcessedImageUrl(currentItem.photo ?? '')
          ) {
            console.log(`Item ${itemId} already has processed image, skipping update`);
            backgroundRemovalQueue.markItemCompleted(itemId);
            return;
          }

          const currentAttemptId = backgroundRemovalQueue.getCurrentAttemptId(itemId);
          if (currentAttemptId && currentAttemptId !== attemptId) {
            console.log(`Stale attempt ${attemptId} for ${itemId}, current is ${currentAttemptId}, skipping`);
            return;
          }

          const saved = await cloudSyncService.updateItem({
            ...currentItem,
            photo: newImageUrl,
            imageUrl: newImageUrl,
            photoStatus: 'background_removed',
            backgroundRemovalFailed: false,
            backgroundRemovalStatus: 'complete',
          });

          if (!saved) {
            throw new Error(`Firestore did not confirm background removal update for ${itemId}`);
          }

          backgroundRemovalQueue.markItemCompleted(itemId);
          await loadClothingItems();

          if (global.onItemsUpdated) {
            global.onItemsUpdated();
          }

          console.log(`Updated item ${itemId} with new background-removed image`);
        } catch (error) {
          console.error(`❌ Failed to update item ${itemId} after background removal:`, error);
        }
      },
      onItemFailed: async (itemId: string, errorMessage: string, errorCode, attemptId: string) => {
        console.warn(`⚠️ Background removal failed for ${itemId}: ${errorMessage} (${errorCode}) (attempt: ${attemptId})`);

        try {
          const currentItem = await cloudSyncService.getItem(itemId);
          if (!currentItem) return;

          if (
            currentItem.backgroundRemovalStatus === 'complete' ||
            isProcessedImageUrl(currentItem.photo ?? '')
          ) {
            console.log(`Item ${itemId} already completed, ignoring failure`);
            backgroundRemovalQueue.markItemCompleted(itemId);
            return;
          }

          const currentAttemptId = backgroundRemovalQueue.getCurrentAttemptId(itemId);
          if (currentAttemptId && currentAttemptId !== attemptId) {
            console.log(`Stale failure for attempt ${attemptId}, current is ${currentAttemptId}, ignoring`);
            return;
          }

          await cloudSyncService.updateItem({
            ...currentItem,
            backgroundRemovalFailed: true,
            backgroundRemovalError: errorMessage,
            backgroundRemovalStatus: 'failed',
          });

          await loadClothingItems();
          console.log(`Marked item ${itemId} with background removal failure`);

          // Show a brief toast for persistent errors
          if (errorCode === 'api_key' || errorCode === 'credits_exhausted') {
            showToastBanner(
              'Background removal is currently unavailable. Photos will keep their original background.',
              'warning',
              5000
            );
          }
        } catch (error) {
          console.error(`❌ Failed to update item ${itemId} failure status:`, error);
        }
      }
    });

    console.log('📋 Background removal queue initialized with idempotent success/failure callbacks');
  }, [backgroundRemovalService]);

  // Background removal function
  const removeBackground = async (imageUri: string): Promise<string> => {
    return await backgroundRemovalService.removeBackground(imageUri);
  };



  const loadClothingItems = async (retryCount = 0) => {
    const timeString = new Date().toLocaleTimeString();
    console.log(`Loading closet items from Firestore... (attempt ${retryCount + 1}, ${timeString})`);

    try {
      const items = await cloudSyncService.loadClosetItems();
      const validItems = items.filter((item): item is ClothingItem => Boolean(item.id && item.category));
      const visibleItems = mergeCloudItemsWithPendingEvaluating(validItems);

      console.log(`Loaded ${validItems.length} closet items from Firestore/cache, preserving ${visibleItems.length - validItems.length} evaluating placeholder(s)`);
      setClothingItems(visibleItems);

      recomputeWardrobeItemCount(validItems).catch(err =>
        console.warn('Failed to recompute wardrobe count on load:', err)
      );
    } catch (error) {
      console.error("Error loading clothing items:", error);

      // Retry logic for storage access errors
      if (retryCount < 2) {
        console.log(`Retrying closet load in ${(retryCount + 1) * 200}ms...`);
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 200));
        return loadClothingItems(retryCount + 1);
      }

      setClothingItems(prev => {
        const pendingItems = getPendingEvaluatingItems();
        const existingItems = prev.filter(item => !isEvaluatingPlaceholder(item));
        return [...pendingItems, ...existingItems];
      });
    }
  };



  // Reload items when screen comes into focus (e.g., returning from onboarding)
  useFocusEffect(
    useCallback(() => {
      console.log('🔄 Closet screen focused, reloading items...');

      // Warm up the background removal server (async, non-blocking)
      warmupBackgroundRemovalServer();

      loadClothingItems();
    }, []) // Remove loadClothingItems dependency to prevent infinite loop
  );

  // Additional effect to check for new items on mount and when app becomes active
  useEffect(() => {
    const checkForNewItems = async () => {
      const onboardingCompleted = await AsyncStorage.getItem('onboardingCompleted');
      if (onboardingCompleted === 'true') {
        console.log('🔄 Onboarding completed detected, ensuring items are loaded...');
        loadClothingItems();
      }
    };

    checkForNewItems();
  }, []);

  // Add listener for background item updates
  useEffect(() => {
    // Listen for background item updates (from onboarding or add-item processing)
    // Use a global function that can be called from anywhere
    global.onItemsUpdated = () => {
      console.log('🔄 Background item update detected, reloading items...');
      loadClothingItems();
    };

    // Cleanup the global listener when the component unmounts
    return () => {
      if (global.onItemsUpdated) {
        global.onItemsUpdated = undefined;
      }
    };
  }, []); // Empty dependency array ensures this effect runs only once on mount and cleans up on unmount

  const handleAddClothes = () => {
    Alert.alert(
      "Add Item",
      "Choose how you'd like to add a photo:",
      [
        {
          text: "Take a Photo",
          onPress: handleTakePhoto,
        },
        {
          text: "Upload from Camera Roll",
          onPress: handleUploadFromCameraRoll,
        },
        {
          text: "Cancel",
          style: "cancel",
        },
      ]
    );
  };

  const handleTakePhoto = async () => {
    try {
      // Request camera permissions
      const { status } = await Camera.requestCameraPermissionsAsync();

      if (status === 'granted') {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets[0]) {
          await handlePhotoAdded([result.assets[0]]);
        }
      } else {
        Alert.alert("Permission Denied", "Camera access is required to take photos.");
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert("Error", "Failed to take photo. Please try again.");
    }
  };

  const handleUploadFromCameraRoll = async () => {
    try {
      // Request media library permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status === 'granted') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          selectionLimit: 50,
          quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
          if (result.assets.length > 10) {
            Alert.alert(
              "Large Batch Upload",
              `You've selected ${result.assets.length} photos. They will be processed in the background - you can continue using the app while they're being analyzed.`,
              [
                { text: "Cancel", style: "cancel" },
                { text: "Process All", onPress: () => handlePhotoAdded(result.assets) }
              ]
            );
            return;
          }
          await handlePhotoAdded(result.assets);
        }
      } else {
        Alert.alert("Permission Denied", "Gallery access is required to select photos.");
      }
    } catch (error) {
      console.error('Error picking from gallery:', error);
      Alert.alert("Error", "Failed to select photos. Please try again.");
    }
  };



  // Resize image to max 1200px width for efficient processing
  const resizeImage = async (uri: string): Promise<string> => {
    try {
      const resized = await manipulateAsync(
        uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.8, format: SaveFormat.JPEG }
      );
      console.log(`📐 Resized image to 1200px width`);
      return resized.uri;
    } catch (error) {
      console.warn('⚠️ Image resize failed, using original:', error);
      return uri;
    }
  };

  // Handle photo(s) added - create evaluating cards immediately and queue for AI processing
  const handlePhotoAdded = async (assets: ImagePicker.ImagePickerAsset[]) => {
    try {
      console.log(`📸 Processing ${assets.length} photo(s)...`);

      const newEvaluatingItems: ClothingItem[] = [];

      // Create temporary "Evaluating" items for each photo
      for (const [index, asset] of assets.entries()) {
        // Resize image immediately after capture for efficient processing
        const resizedUri = await resizeImage(asset.uri);

        const evaluatingItem: ClothingItem = {
          id: `evaluating_${Date.now()}_${Math.random()}`,
          photo: resizedUri,
          category: 'Evaluating',
          color: '',
          pattern: '',
          material: '',
          style: '',
          notes: 'AI is analyzing this image...',
          dateAdded: new Date().toISOString(),
          tags: {
            season: [],
            event: [],
          },
          photoStatus: 'evaluating',
          isEvaluating: true, // Flag to identify evaluating items
        };

        newEvaluatingItems.push(evaluatingItem);
        pendingEvaluatingItemsRef.current.set(evaluatingItem.id, evaluatingItem);
      }

      // Evaluating cards are UI-only placeholders. Completed cards are saved to Firestore.
      const newEvaluatingIds = new Set(newEvaluatingItems.map(item => item.id));
      setClothingItems(prev => [
        ...newEvaluatingItems,
        ...prev.filter(item => !newEvaluatingIds.has(item.id)),
      ]);

      console.log(`✅ Created ${newEvaluatingItems.length} evaluating cards`);

      // Use server-side batch processing for large batches (10+ photos)
      // This prevents client-side timeouts and processes photos in parallel on the server
      const BATCH_THRESHOLD = 10;

      if (assets.length >= BATCH_THRESHOLD) {
        console.log(`📦 Using server-side batch processing for ${assets.length} photos`);
        processPhotosWithServerBatch(newEvaluatingItems).catch(err => {
          console.error('Error in server batch processing:', err);
        });
      } else {
        // Process photos sequentially for small batches (client-side)
        // Each photo must complete before starting the next to prevent data corruption
        const processPhotosSequentially = async () => {
          for (const item of newEvaluatingItems) {
            await processPhotoAndReplaceEvaluatingCard(item);
          }
        };

        // Start sequential processing in background (don't await at this level)
        processPhotosSequentially().catch(err => {
          console.error('Error in sequential photo processing:', err);
        });
      }

    } catch (error) {
      console.error('Error handling photo addition:', error);
      Alert.alert("Error", "Failed to process photos. Please try again.");
    }
  };

  // Process photos using server-side Firebase Cloud Function for large batches
  const processPhotosWithServerBatch = async (evaluatingItems: ClothingItem[]) => {
    try {
      // Check if user is authenticated (required for server-side processing)
      const { auth } = await import('@/config/firebase');
      if (!auth.currentUser) {
        console.warn('⚠️ User not authenticated, falling back to client-side processing');
        for (const item of evaluatingItems) {
          await processPhotoAndReplaceEvaluatingCard(item);
        }
        return;
      }

      // Prepare photos for batch processing
      const batchPhotos = evaluatingItems.map(item => ({
        uri: item.photo!,
        tempId: item.id,
      }));

      console.log(`🚀 Sending ${batchPhotos.length} photos to server for batch processing...`);

      // Process using server-side batch function
      const result = await batchProcessingService.processPhotosInChunks(
        batchPhotos,
        (current, total, status) => {
          console.log(`📊 Batch progress: ${current}/${total} - ${status}`);
        },
        (chunkResult) => {
          console.log(`✅ Chunk complete: ${chunkResult.successful}/${chunkResult.processed} successful`);
        }
      );

      console.log(`📦 Server batch processing complete: ${result.successful}/${result.processed} photos, ${result.totalItemsDetected} items detected`);

      const completedTempIds = result.results
        .filter(photoResult => photoResult.success && (photoResult.detectedItems?.length ?? 0) > 0)
        .map(photoResult => photoResult.tempId);

      removeEvaluatingPlaceholders(completedTempIds, { clearCancellation: true });

      // The batch Cloud Function creates the Firestore closet docs.
      // Do not recreate those items locally; reload the Firestore source of truth.
      await loadClothingItems();

      // Show completion message for large batches
      if (result.processed >= 10) {
        Alert.alert(
          "Batch Processing Complete",
          `Successfully analyzed ${result.successful} of ${result.processed} photos.\n${result.totalItemsDetected} clothing items were detected.`,
          [{ text: "OK" }]
        );
      }

    } catch (error: any) {
      console.error('❌ Server batch processing failed:', error);

      // Fall back to client-side processing
      Alert.alert(
        "Server Processing Failed",
        "Switching to local processing. This may take longer for large batches.",
        [{ text: "OK" }]
      );

      for (const item of evaluatingItems) {
        if (!cancelledEvaluatingItemsRef.current.has(item.id)) {
          await processPhotoAndReplaceEvaluatingCard(item);
        }
      }
    }
  };

  // Process a photo and replace the evaluating card with completed items
  const processPhotoAndReplaceEvaluatingCard = async (evaluatingItem: ClothingItem) => {
    try {
      // Check if this item was cancelled/deleted before starting
      if (cancelledEvaluatingItemsRef.current.has(evaluatingItem.id)) {
        console.log(`🚫 Skipping AI processing for cancelled item: ${evaluatingItem.id}`);
        removeEvaluatingPlaceholder(evaluatingItem.id, { clearCancellation: true });
        return;
      }

      console.log(`🤖 Starting AI processing for evaluating item: ${evaluatingItem.id}`);

      // Import AI services
      const { clothingDetection } = await import('@/utils/clothingDetection');

      // Run AI detection first - this determines when we unblock the UI
      // Background removal will be queued after items are created
      console.log('🚀 Starting AI detection first...');

      const detectedItems = await clothingDetection.detectClothingInImage(evaluatingItem.photo!);
      console.log(`✅ AI detection complete: ${detectedItems.length} items detected`);

      // Check again if item was cancelled during AI detection
      if (cancelledEvaluatingItemsRef.current.has(evaluatingItem.id)) {
        console.log(`🚫 Item ${evaluatingItem.id} was cancelled during AI detection, skipping save`);
        removeEvaluatingPlaceholder(evaluatingItem.id, { clearCancellation: true });
        return;
      }

      const itemsToSave: ClothingItem[] = [];

      if (detectedItems.length > 0) {
        // Convert detected items to closet format - use original photo initially
        // Mark with backgroundRemovalStatus: 'pending' so checkCompletedBackgroundRemovals can find them
        const newClothingItems: ClothingItem[] = detectedItems.map((detected) => {
          const metadata = clothingDetection.buildAutoDetectedMetadata(detected);
          return {
            id: detected.id,
            photo: evaluatingItem.photo!, // Use original photo initially
            category: getCategoryFromDetectedType(detected.detectedType),
            ...metadata,
            color: metadata.color || '',
            pattern: metadata.pattern || 'Solid',
            material: metadata.material || '',
            style: metadata.style || 'Casual',
            dateAdded: new Date().toISOString(),
            photoStatus: 'done',
            isAutoDetected: true,
            originalPhoto: evaluatingItem.photo,
            layerType: (metadata.layerType as LayerType | undefined) ?? getLayerTypeFromDetectedType(detected.detectedType),
            backgroundRemovalStatus: 'pending' as const,
          };
        });

        itemsToSave.push(...newClothingItems);
        console.log(`✅ Replaced evaluating card with ${newClothingItems.length} detected items`);
      } else {
        // No items detected, create a generic item
        const genericId = `generic_${Date.now()}_${Math.random()}`;

        const genericItem: ClothingItem = {
          id: genericId,
          photo: evaluatingItem.photo!, // Use original photo initially
          category: 'Uncategorized',
          color: '',
          pattern: '',
          material: '',
          style: '',
          notes: 'No specific clothing items detected - please edit to add details',
          dateAdded: new Date().toISOString(),
          tags: {
            season: [],
            event: [],
          },
          photoStatus: 'needs_clarification',
          needsUserInput: true,
        };

        itemsToSave.push(genericItem);
        console.log(`⚠️ No items detected, created generic item for manual editing`);
      }

      for (const item of itemsToSave) {
        const cloudItem = await cloudSyncService.syncItemToCloud(item);
        if (!cloudItem) {
          throw new Error(`Could not save ${item.id} to Firestore`);
        }

        if (cloudItem.imageUrl) {
          await cloudSyncService.triggerAsyncBackgroundRemoval(item.id, cloudItem.imageUrl);
        }
      }

      removeEvaluatingPlaceholder(evaluatingItem.id, { clearCancellation: true });
      await loadClothingItems();

      if (global.onItemsUpdated) {
        global.onItemsUpdated();
      }
    } catch (error) {
      console.error(`❌ AI processing failed for item: ${evaluatingItem.id}`, error);

      // On error, convert evaluating item to a generic item that needs user input
      try {
        const fallbackItem = await cloudSyncService.syncItemToCloud({
          id: `fallback_${Date.now()}_${Math.random()}`,
          photo: evaluatingItem.photo,
          category: 'Uncategorized',
          color: '',
          pattern: '',
          material: '',
          style: '',
          notes: 'AI processing failed - please edit to add details',
          dateAdded: new Date().toISOString(),
          tags: {
            season: [],
            event: [],
          },
          photoStatus: 'needs_clarification',
          needsUserInput: true,
        });

        if (!fallbackItem) {
          throw new Error('Could not save fallback item to Firestore');
        }

        removeEvaluatingPlaceholder(evaluatingItem.id, { clearCancellation: true });
        await loadClothingItems();

        // Notify other parts of the app that items have been updated
        if (global.onItemsUpdated) {
          global.onItemsUpdated();
        }
      } catch (saveError) {
        console.error('Error saving fallback item:', saveError);
      }
    }
  };

  // Helper function to convert detected type to category
  const getCategoryFromDetectedType = (type: string): string => {
    const categoryMap: { [key: string]: string } = {
      'shirt': 'Tops',
      't-shirt': 'Tops',
      'tank top': 'Tops',
      'tank-top': 'Tops',
      'tanktop': 'Tops',
      'blouse': 'Tops',
      'sweater': 'Outerwear',
      'hoodie': 'Outerwear',
      'cardigan': 'Outerwear',
      'pullover': 'Outerwear',
      'sweatshirt': 'Outerwear',
      'fleece': 'Outerwear',
      'jacket': 'Outerwear',
      'coat': 'Outerwear',
      'blazer': 'Outerwear',
      'pants': 'Bottoms',
      'jeans': 'Bottoms',
      'shorts': 'Bottoms',
      'skirt': 'Bottoms',
      'dress': 'Dresses',
      'shoes': 'Shoes',
      'sneakers': 'Shoes',
      'boots': 'Shoes',
      'sandals': 'Shoes',
      'hat': 'Accessories',
      'cap': 'Accessories',
      'bag': 'Accessories',
      'belt': 'Accessories',
      'necklace': 'Accessories',
      'bracelet': 'Accessories',
      'earrings': 'Accessories',
      'ring': 'Accessories',
      'watch': 'Accessories',
      'scarf': 'Accessories',
      'hair clip': 'Accessories',
      'hair accessory': 'Accessories',
      'lipstick': 'Makeup',
      'lip gloss': 'Makeup',
      'lip-gloss': 'Makeup',
      'eyeshadow': 'Makeup',
      'eye shadow': 'Makeup',
      'eye-shadow': 'Makeup',
      'mascara': 'Makeup',
      'foundation': 'Makeup',
      'concealer': 'Makeup',
      'blush': 'Makeup',
      'bronzer': 'Makeup',
      'highlighter': 'Makeup',
      'eyeliner': 'Makeup',
      'eye liner': 'Makeup',
      'eye-liner': 'Makeup',
      'lip liner': 'Makeup',
      'lip-liner': 'Makeup',
      'makeup palette': 'Makeup',
      'palette': 'Makeup',
      'powder': 'Makeup',
      'setting spray': 'Makeup',
      'primer': 'Makeup',
      'makeup brush': 'Makeup',
      'beauty blender': 'Makeup',
      'nail polish': 'Makeup',
      'nail-polish': 'Makeup',
      'makeup': 'Makeup',
      'cosmetics': 'Makeup',
    };
    return categoryMap[type.toLowerCase()] || 'Accessories';
  };

  // Helper function to infer layer type from detected clothing type
  // Used for outfit layering logic - base items (t-shirts) need layers in cool weather
  const getLayerTypeFromDetectedType = (type: string): LayerType | undefined => {
    const typeLower = type.toLowerCase();

    // Outer layer items (jackets, coats, blazers)
    const outerKeywords = ['jacket', 'coat', 'blazer', 'parka', 'windbreaker', 'vest', 'trench', 'puffer', 'bomber'];
    if (outerKeywords.some(k => typeLower.includes(k))) {
      return 'outer';
    }

    // Mid layer items (sweaters, hoodies, cardigans)
    const midKeywords = ['sweater', 'hoodie', 'cardigan', 'pullover', 'sweatshirt', 'fleece', 'knit', 'turtleneck'];
    if (midKeywords.some(k => typeLower.includes(k))) {
      return 'mid';
    }

    // Base layer items (t-shirts, tanks, blouses, shirts)
    const baseKeywords = ['t-shirt', 'tee', 'tank', 'blouse', 'shirt', 'polo', 'camisole', 'crop', 'top'];
    if (baseKeywords.some(k => typeLower.includes(k))) {
      return 'base';
    }

    return undefined;
  };

  const handleAutoDetection = async () => {
    try {
      setIsAutoDetecting(true);

      const { clothingDetection } = await import('@/utils/clothingDetection');

      const detectedItems = await clothingDetection.analyzeCameraRollForClothing({
        limit: 20,
        onProgress: (current, total) => {
          console.log(`Analyzing photo ${current} of ${total}`);
        },
      });

      if (detectedItems.length > 0) {
        const closetItems = clothingDetection.convertToClosetItems(detectedItems);

        // Get existing items from Firestore/cache and check for duplicates
        const currentItems = await cloudSyncService.loadClosetItems();

        // Filter out duplicates based on photo URI and category
        const newItems = closetItems.filter(newItem => {
          return !currentItems.some((existingItem: any) =>
            existingItem.photo === newItem.photo &&
            existingItem.category === newItem.category
          );
        });

        if (newItems.length > 0) {
          for (const item of newItems) {
            const cloudItem = await cloudSyncService.syncItemToCloud(item);
            if (!cloudItem) {
              throw new Error(`Could not save detected item ${item.id} to Firestore`);
            }
          }

          // Refresh the display
          await loadClothingItems();

          // Notify other parts of the app that items have been updated
          if (global.onItemsUpdated) {
            global.onItemsUpdated();
          }

          Alert.alert(
            'Success!',
            `Found and added ${newItems.length} new clothing items to your closet! (${closetItems.length - newItems.length} duplicates were skipped)`
          );
        } else {
          Alert.alert(
            'No New Items',
            'All detected items were already in your closet.'
          );
        }
      } else {
        Alert.alert(
          'No Items Found',
          'We couldn\'t detect any clothing items in your recent photos.'
        );
      }

    } catch (error) {
      console.error('Auto-detection error:', error);
      Alert.alert(
        'Analysis Failed',
        'Unable to analyze your photos. Please try again later.'
      );
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const handleEditItem = (itemId: string) => {
    router.push(`/edit-clothing-item?itemId=${itemId}`);
  };

  const toggleFilter = (type: 'season' | 'event' | 'clothingType', value: string) => {
    setFilters(prev => {
      const updated = { ...prev };
      const currentFilters = new Set(prev[type]);
      if (currentFilters.has(value)) {
        currentFilters.delete(value);
      } else {
        currentFilters.add(value);
      }
      updated[type] = Array.from(currentFilters);
      return updated;
    });
  };

  const setSortFilter = (value: string) => {
    setFilters(prev => ({
      ...prev,
      sortBy: prev.sortBy === value ? '' : value
    }));
  };

  const filteredClothingItems = clothingItems.filter(item => {
    // Allow evaluating items through regardless of missing data
    if (item.isEvaluating || item.category === 'Evaluating') {
      return true;
    }

    // Only filter out items that are completely invalid
    if (!item.id) {
      return false;
    }

    // Show items even if they don't have a photo or category - user can edit them
    const itemTags = item.tags || { season: [], event: [] };
    const seasonTags = Array.isArray(itemTags) ? itemTags : (itemTags.season || []);
    const eventTags = Array.isArray(itemTags) ? itemTags : (itemTags.event || []);

    const matchesSeason = filters.season.length === 0 || filters.season.some(s => seasonTags.includes(s));
    const matchesEvent = filters.event.length === 0 || filters.event.some(e => eventTags.includes(e));
    const matchesClothingType = filters.clothingType.length === 0 || filters.clothingType.some(type => {
      if (!item.category) return true; // Show uncategorized items when no filter is applied

      const category = item.category.toLowerCase();
      switch (type) {
        case 'Tops':
          return category === 'tops' || ['t-shirt', 'shirt', 'blouse', 'sweater', 'hoodie', 'tank top'].some(t => category.includes(t.toLowerCase()));
        case 'Bottoms':
          return category === 'bottoms' || ['pants', 'jeans', 'shorts', 'skirt', 'leggings', 'trousers'].some(t => category.includes(t.toLowerCase()));
        case 'Shoes':
          return category === 'shoes' || ['shoes', 'sneakers', 'boots', 'sandals', 'heels', 'flats', 'slippers'].some(t => category.includes(t.toLowerCase()));
        case 'Accessories':
          return category === 'accessories' || ['hat', 'bag', 'belt', 'scarf', 'jewelry', 'watch', 'sunglasses'].some(t => category.includes(t.toLowerCase()));
        case 'Outerwear':
          return category === 'outerwear' || ['jacket', 'blazer', 'coat', 'cardigan'].some(t => category.includes(t.toLowerCase()));
        case 'Dresses':
          return category === 'dresses' || ['dress', 'gown'].some(t => category.includes(t.toLowerCase()));
        case 'Makeup':
          return category === 'makeup' || ['lipstick', 'mascara', 'foundation', 'eyeshadow', 'blush', 'concealer', 'eyeliner', 'bronzer'].some(t => category.includes(t.toLowerCase()));
        default:
          return true;
      }
    });

    return matchesSeason && matchesEvent && matchesClothingType;
  }).sort((a, b) => {
    if (filters.sortBy === 'Most Worn') {
      // For now, we'll sort by category name as a placeholder since we don't have wear count data
      return (a.category || 'Uncategorized').localeCompare(b.category || 'Uncategorized');
    } else if (filters.sortBy === 'Last Worn') {
      // Sort by date added as a placeholder for last worn
      return (
        new Date(b.dateAdded ?? 0).getTime() -
        new Date(a.dateAdded ?? 0).getTime()
      );
    }
    return 0;
  });

  // Pagination calculations
  const totalItems = filteredClothingItems.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = filteredClothingItems.slice(startIndex, endIndex);
  const needsAttentionItems = clothingItems.filter(itemNeedsAttention);

  // Reset to page 1 when filters change
  const resetPagination = () => {
    setCurrentPage(1);
  };

  // Reset pagination when filters change
  useFocusEffect(
    useCallback(() => {
      resetPagination();
    }, [filters])
  );

  // Function to handle item deletion (uses consolidated cloudSyncService.deleteItem)
  const handleDeleteItem = async (itemId: string) => {
    const item = clothingItems.find(i => i.id === itemId);
    const isEvaluating = item?.isEvaluating || item?.category === 'Evaluating';

    Alert.alert(
      "Delete Item",
      isEvaluating
        ? "Are you sure you want to cancel the analysis and delete this item?"
        : "Are you sure you want to delete this item from your closet?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (isEvaluating) {
                cancelledEvaluatingItemsRef.current.add(itemId);
                removeEvaluatingPlaceholder(itemId);

                const remainingItems = clothingItems.filter(item => item.id !== itemId);
                recomputeWardrobeItemCount(remainingItems).catch(err =>
                  console.warn('Failed to recompute wardrobe count:', err)
                );

                console.log(`🚫 Cancelled evaluating item ${itemId}`);
                return;
              }

              // Use consolidated delete method (handles local + cloud deletion atomically)
              const result = await cloudSyncService.deleteItem(itemId);

              if (result.success) {
                // Update local state
                setClothingItems(prev => prev.filter(item => item.id !== itemId));

                // Recompute wardrobe item count from current state
                const remainingItems = clothingItems.filter(item => item.id !== itemId);
                recomputeWardrobeItemCount(remainingItems).catch(err =>
                  console.warn('Failed to recompute wardrobe count:', err)
                );

                // Notify other parts of the app that items have been updated
                if (global.onItemsUpdated) {
                  global.onItemsUpdated();
                }

                console.log(`🗑️ Deleted ${isEvaluating ? 'evaluating ' : ''}item: ${itemId} (local: ${result.localDeleted}, cloud: ${result.cloudDeleted})`);
              } else {
                Alert.alert("Error", "Failed to delete item");
              }
            } catch (error) {
              console.error('Error deleting item:', error);
              Alert.alert("Error", "Failed to delete item");
            }
          },
        },
      ]
    );
  };

  // Component for items that need attention/clarification
  const NeedsAttentionCard = ({ item, onAction }: { item: ClothingItem; onAction: () => void }) => {
    // Skip background removal to prevent excessive API calls

    const handleCardAction = () => {
      Alert.alert(
        "Needs Attention",
        "What would you like to do with this item?",
        [
          {
            text: "Describe Item",
            onPress: () => router.push(`/edit-clothing-item?itemId=${item.id}`),
          },
          {
            text: "Replace Photo",
            onPress: () => handleReplacePhoto(item.id),
          },
          {
            text: "Describe Another Item",
            onPress: () => handleDuplicateForNewItem(item),
          },
          {
            text: "Delete Item",
            style: "destructive",
            onPress: () => handleDeleteItem(item.id),
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
    };

    const handleReplacePhoto = async (itemId: string) => {
      Alert.alert(
        "Replace Photo",
        "Choose how you'd like to replace the photo:",
        [
          {
            text: "Take a Photo",
            onPress: async () => {
              try {
                const { status } = await Camera.requestCameraPermissionsAsync();
                if (status === 'granted') {
                  const result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ImagePicker.MediaTypeOptions.Images,
                    allowsEditing: true,
                    aspect: [4, 3],
                    quality: 0.8,
                  });
                  if (!result.canceled && result.assets && result.assets[0]) {
                    await updateItemPhoto(itemId, result.assets[0].uri);
                  }
                } else {
                  Alert.alert("Permission Denied", "Camera access is required to take photos.");
                }
              } catch (error) {
                console.error('Error taking photo:', error);
                Alert.alert("Error", "Failed to take photo. Please try again.");
              }
            },
          },
          {
            text: "Upload from Gallery",
            onPress: async () => {
              try {
                const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (status === 'granted') {
                  const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ImagePicker.MediaTypeOptions.Images,
                    allowsEditing: true,
                    aspect: [4, 3],
                    quality: 0.8,
                  });
                  if (!result.canceled && result.assets && result.assets[0]) {
                    await updateItemPhoto(itemId, result.assets[0].uri);
                  }
                } else {
                  Alert.alert("Permission Denied", "Gallery access is required to select photos.");
                }
              } catch (error) {
                console.error('Error picking from gallery:', error);
                Alert.alert("Error", "Failed to select photo. Please try again.");
              }
            },
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
    };

    const updateItemPhoto = async (itemId: string, newPhotoUri: string) => {
      try {
        const existingItem = await cloudSyncService.getItem(itemId);
        if (existingItem) {
          const saved = await cloudSyncService.updateItem({
            ...existingItem,
            photo: newPhotoUri,
            photoStatus: 'done',
          });

          if (!saved) {
            throw new Error('Firestore did not confirm the photo update.');
          }

          onAction(); // Refresh the list
          Alert.alert("Success", "Photo updated successfully!");
        }
      } catch (error) {
        console.error('Error updating photo:', error);
        Alert.alert("Error", "Failed to update photo");
      }
    };

    const handleDuplicateForNewItem = (originalItem: ClothingItem) => {
      // Create a new item with the same photo but different ID
      router.push({
        pathname: '/add-clothing-item',
        params: {
          photoUri: originalItem.photo,
          isFromDuplicate: 'true',
          originalItemId: originalItem.id
        }
      });
    };

    return (
      <TouchableOpacity style={styles.needsAttentionCard} onPress={handleCardAction}>
        <View style={styles.needsAttentionImage}>
          {item.photo ? (
            <>
              <Image
                source={{ uri: item.photo }}
                style={styles.needsAttentionPhoto}
                contentFit="cover"
                transition={200}
              />
              <View style={styles.needsAttentionBadge}>
                <IconSymbol name="exclamationmark" size={12} color="white" />
              </View>
            </>
          ) : (
            <IconSymbol name="tshirt.fill" size={32} color="#CBD5E1" />
          )}
        </View>
        <View style={styles.needsAttentionDetails}>
          <ThemedText style={styles.needsAttentionItemName} numberOfLines={1}>
            {item.category || 'Unknown Item'}
          </ThemedText>
          <ThemedText style={styles.needsAttentionAction} numberOfLines={1}>
            Tap to clarify
          </ThemedText>
        </View>
      </TouchableOpacity>
    );
  };

  // Helper function to get status indicator for cards and lists
  const getStatusIndicator = (item: ClothingItem) => {
    // Show indicator for background removal failures
    if (item.backgroundRemovalFailed) {
      return {
        icon: '🖼️',
        text: 'Original',
        color: 'rgba(100, 116, 139, 0.85)',
      };
    }
    return null;
  };


  // Separate component for clothing item card to properly use hooks
  const ClothingItemCard = ({ item }: { item: ClothingItem }) => {
    // Only require an ID - be more lenient with other fields
    if (!item.id) {
      console.warn('🚫 ClothingItemCard: Refusing to render item with no ID:', item);
      return null;
    }

    const screenWidth = Dimensions.get('window').width;
    const itemWidth = (screenWidth - 60) / 2; // 20px padding on each side + 20px gap between items
    const statusIndicator = getStatusIndicator(item);
    const isEvaluating = item.isEvaluating || item.category === 'Evaluating';
    const normalizedStatus = normalizePhotoStatus(item.photoStatus);
    const isProcessing = isEvaluating || ['uploading', 'evaluating', 'pending'].includes(normalizedStatus ?? '');
    const needsAttention = itemNeedsAttention({ ...item, photoStatus: normalizedStatus });
    const hasNoPhoto = !item.photo || item.photo.trim() === '';

    const showItemMenu = () => {
      if (isEvaluating) {
        // Show limited menu for evaluating items
        Alert.alert(
          "Analyzing Item",
          "This item is still being analyzed. What would you like to do?",
          [
            {
              text: "Delete",
              style: "destructive",
              onPress: () => handleDeleteItem(item.id),
            },
            {
              text: "Cancel",
              style: "cancel",
            },
          ]
        );
        return;
      }

      Alert.alert(
        item.category,
        "What would you like to do with this item?",
        [
          {
            text: "Edit",
            onPress: () => handleEditItem(item.id),
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => handleDeleteItem(item.id),
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
    };

    const renderImageContent = () => {
      if (isEvaluating) {
        return (
          <View style={[styles.cardImage, styles.processingImageContainer]}>
            {item.photo && item.photo.trim() !== '' ? (
              <>
                <Image
                  source={{ uri: item.photo }}
                  style={[styles.cardImage, styles.processingImage]}
                  contentFit="cover"
                  transition={200}
                />
                <View style={styles.processingOverlay}>
                  <SpinnerComponent />
                  <ThemedText style={styles.processingText}>Analyzing...</ThemedText>
                </View>
              </>
            ) : (
              <>
                <IconSymbol name="tshirt.fill" size={32} color="#94a3b8" />
                <View style={styles.processingOverlay}>
                  <SpinnerComponent />
                  <ThemedText style={styles.processingText}>Processing</ThemedText>
                </View>
              </>
            )}
          </View>
        );
      }

      if (isProcessing) {
        return (
          <View style={[styles.cardImage, styles.processingImageContainer]}>
            {item.photo && item.photo.trim() !== '' ? (
              <>
                <Image
                  source={{ uri: item.photo }}
                  style={[styles.cardImage, styles.processingImage]}
                  contentFit="cover"
                  transition={200}
                />
                <View style={styles.processingOverlay}>
                  <SpinnerComponent />
                  <ThemedText style={styles.processingText}>Analyzing...</ThemedText>
                </View>
              </>
            ) : (
              <>
                <IconSymbol name="tshirt.fill" size={32} color="#94a3b8" />
                <View style={styles.processingOverlay}>
                  <SpinnerComponent />
                  <ThemedText style={styles.processingText}>Processing</ThemedText>
                </View>
              </>
            )}
          </View>
        );
      }

      if (hasNoPhoto || needsAttention) {
        return (
          <View style={[styles.cardImage, styles.placeholderImageContainer,
                        needsAttention && styles.needsAttentionImageContainer]}>
            <IconSymbol
              name={needsAttention ? "exclamationmark.triangle.fill" : "tshirt.fill"}
              size={32}
              color={needsAttention ? "#f59e0b" : "#CBD5E1"}
            />
            <ThemedText style={[styles.placeholderText, needsAttention && styles.needsAttentionText]}>
              {needsAttention ? 'Needs Info' : 'No Photo'}
            </ThemedText>
          </View>
        );
      }

      return (
        <Image
          source={{ uri: item.photo }}
          style={styles.cardImage}
          contentFit="cover"
          transition={200}
          onError={(error) => {
            console.warn('Image failed to load for item:', item.id, error);
          }}
        />
      );
    };

    return (
      <View style={[styles.clothingItem, { width: itemWidth }]}>
        {/* Menu button - always visible for deletion */}
        <TouchableOpacity
          style={styles.menuButton}
          onPress={showItemMenu}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <IconSymbol name="ellipsis" size={16} color="#64748b" />
        </TouchableOpacity>

        {/* Main card content - tappable */}
        <TouchableOpacity
          style={styles.cardContent}
          onPress={() => {
            if (!isEvaluating) {
              handleEditItem(item.id);
            }
          }}
          activeOpacity={isEvaluating ? 1 : 0.7}
          disabled={isEvaluating}
        >
          <View style={styles.imageContainer}>
            {renderImageContent()}

            {/* Status badge - hide for evaluating items since they have spinner overlay */}
            {statusIndicator && !isEvaluating && (
              <View style={[styles.statusBadge, { backgroundColor: statusIndicator.color }]}>
                <ThemedText style={styles.statusIcon}>{statusIndicator.icon}</ThemedText>
                <ThemedText style={styles.statusBadgeText}>{statusIndicator.text}</ThemedText>
              </View>
            )}
          </View>

          <View style={styles.cardInfo}>
            <ThemedText style={[styles.itemName, isEvaluating && styles.evaluatingText]} numberOfLines={1}>
              {isEvaluating ? 'Evaluating' : (item.category || 'Uncategorized')}
            </ThemedText>
            {!isEvaluating && isProcessing && (
              <ThemedText style={styles.processingNote} numberOfLines={1}>
                Still analyzing...
              </ThemedText>
            )}
            {item.color && !isProcessing && !isEvaluating && (
              <ThemedText style={styles.itemAttribute} numberOfLines={1}>
                Color: {item.color}
              </ThemedText>
            )}
            {item.material && !isProcessing && !isEvaluating && (
              <ThemedText style={styles.itemAttribute} numberOfLines={1}>
                Material: {item.material}
              </ThemedText>
            )}
            {item.tags &&
              (((item.tags.season ?? []).length > 0) || ((item.tags.event ?? []).length > 0)) &&
              !isProcessing &&
              !isEvaluating && (
              <ThemedText style={styles.itemAttribute} numberOfLines={1}>
                Tags: {[...(item.tags.season || []), ...(item.tags.event || [])].join(', ')}
              </ThemedText>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCardItem = ({ item }: { item: ClothingItem }) => {
    return <ClothingItemCard item={item} />;
  };

  const renderListItem = ({ item }: { item: ClothingItem }) => {
    // Only require an ID - be more lenient with other fields
    if (!item.id) {
      console.warn('🚫 ListItem: Refusing to render item with no ID:', item);
      return null;
    }

    return (
      <TouchableOpacity
        style={styles.listItem}
        onPress={() => handleEditItem(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.listItemContent}>
          <View style={styles.listImageContainer}>
            <Image
              source={{ uri: item.photo }}
              style={styles.listImage}
              contentFit="cover"
              transition={200}
              onError={(error) => {
                console.warn('List image failed to load for item:', item.id, error);
              }}
            />
            {getStatusIndicator(item) && (
              <View style={[styles.listStatusBadge, { backgroundColor: getStatusIndicator(item)!.color }]}>
                <ThemedText style={styles.listStatusText}>
                  {getStatusIndicator(item)!.icon}
                </ThemedText>
              </View>
            )}
          </View>
          <View style={styles.listInfo}>
            <View style={styles.listHeader}>
              <ThemedText style={styles.listCategory}>{item.category || 'Uncategorized'}</ThemedText>
              {getStatusIndicator(item) && (
                <ThemedText style={[styles.listStatusLabel, { color: getStatusIndicator(item)!.color }]}>
                  {getStatusIndicator(item)!.text}
                </ThemedText>
              )}
            </View>
            <ThemedText style={styles.listDetails}>
              {[item.color, item.material].filter(Boolean).join(' • ') || 'No details yet'}
            </ThemedText>
            {item.notes && (
              <ThemedText style={styles.listNotes} numberOfLines={1}>
                {item.notes}
              </ThemedText>
            )}
          </View>
        </View>
        <IconSymbol name="chevron.right" size={16} color="#94a3b8" />
      </TouchableOpacity>
    );
  };

  const seasonOptions = ['Spring', 'Summer', 'Fall', 'Winter'];
  const eventOptions = ['Casual', 'Formal', 'Athletic', 'Party'];
  const clothingTypeOptions = ['Tops', 'Bottoms', 'Shoes', 'Accessories', 'Dresses', 'Outerwear', 'Makeup'];
  const sortOptions = ['Most Worn', 'Last Worn'];

  return (
    <Provider>
      <SafeAreaView style={styles.safeAreaContainer}>
        <ThemedView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText style={styles.headerTitle}>My Closet</ThemedText>
            <View style={styles.headerActions}>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewToggleButton, viewMode === 'card' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('card')}
                >
                  <IconSymbol
                    name="grid"
                    size={18}
                    color={viewMode === 'card' ? 'white' : '#64748b'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleButton, viewMode === 'list' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('list')}
                >
                  <IconSymbol
                    name="list.bullet"
                    size={18}
                    color={viewMode === 'list' ? 'white' : '#64748b'}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Content */}
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Collapsible Filter Section */}
            <View style={styles.filterContainer}>
              <TouchableOpacity
                style={styles.filterHeader}
                onPress={() => setIsFiltersExpanded(!isFiltersExpanded)}
                activeOpacity={0.7}
              >
                <View style={styles.filterHeaderContent}>
                  <ThemedText style={styles.filterTitle}>Filters</ThemedText>
                  {/* Show active filter count */}
                  {(filters.season.length + filters.event.length + filters.clothingType.length + (filters.sortBy ? 1 : 0)) > 0 && (
                    <View style={styles.filterBadge}>
                      <ThemedText style={styles.filterBadgeText}>
                        {filters.season.length + filters.event.length + filters.clothingType.length + (filters.sortBy ? 1 : 0)}
                      </ThemedText>
                    </View>
                  )}
                </View>
                <IconSymbol
                  name={isFiltersExpanded ? "chevron.up" : "chevron.down"}
                  size={16}
                  color="#64748b"
                />
              </TouchableOpacity>

              {isFiltersExpanded && (
                <View style={styles.filterContent}>
                  <View style={styles.filterRow}>
                    <ThemedText style={styles.filterLabel}>Type</ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTags}>
                      {clothingTypeOptions.map((tag) => (
                        <Chip
                          key={tag}
                          mode="outlined"
                          selected={filters.clothingType.includes(tag)}
                          onPress={() => toggleFilter('clothingType', tag)}
                          style={[styles.filterTag, filters.clothingType.includes(tag) && styles.filterTagSelected]}
                          textStyle={[styles.filterTagText, filters.clothingType.includes(tag) && styles.filterTagTextSelected]}
                        >
                          {tag}
                        </Chip>
                      ))}
                    </ScrollView>
                  </View>

                  <View style={styles.filterRow}>
                    <ThemedText style={styles.filterLabel}>Season</ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTags}>
                      {seasonOptions.map((tag) => (
                        <Chip
                          key={tag}
                          mode="outlined"
                          selected={filters.season.includes(tag)}
                          onPress={() => toggleFilter('season', tag)}
                          style={[styles.filterTag, filters.season.includes(tag) && styles.filterTagSelected]}
                          textStyle={[styles.filterTagText, filters.season.includes(tag) && styles.filterTagTextSelected]}
                        >
                          {tag}
                        </Chip>
                      ))}
                    </ScrollView>
                  </View>

                  <View style={styles.filterRow}>
                    <ThemedText style={styles.filterLabel}>Event</ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTags}>
                      {eventOptions.map((tag) => (
                        <Chip
                          key={tag}
                          mode="outlined"
                          selected={filters.event.includes(tag)}
                          onPress={() => toggleFilter('event', tag)}
                          style={[styles.filterTag, filters.event.includes(tag) && styles.filterTagSelected]}
                          textStyle={[styles.filterTagText, filters.event.includes(tag) && styles.filterTagTextSelected]}
                        >
                          {tag}
                        </Chip>
                      ))}
                    </ScrollView>
                  </View>

                  <View style={styles.filterRow}>
                    <ThemedText style={styles.filterLabel}>Sort</ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTags}>
                      {sortOptions.map((option) => (
                        <Chip
                          key={option}
                          mode="outlined"
                          selected={filters.sortBy === option}
                          onPress={() => setSortFilter(option)}
                          style={[styles.filterTag, filters.sortBy === option && styles.filterTagSelected]}
                          textStyle={[styles.filterTagText, filters.sortBy === option && styles.filterTagTextSelected]}
                        >
                          {option}
                        </Chip>
                      ))}
                    </ScrollView>
                  </View>

                  {/* Clear all filters button */}
                  {(filters.season.length + filters.event.length + filters.clothingType.length + (filters.sortBy ? 1 : 0)) > 0 && (
                    <TouchableOpacity
                      style={styles.clearFiltersButton}
                      onPress={() => setFilters({ season: [], event: [], clothingType: [], sortBy: '' })}
                    >
                      <ThemedText style={styles.clearFiltersText}>Clear All Filters</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Needs Attention Section */}
            {needsAttentionItems.length > 0 && (
              <View style={styles.needsAttentionSection}>
                <View style={styles.needsAttentionHeader}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#f59e0b" />
                  <ThemedText style={styles.needsAttentionTitle}>
                    Needs Attention ({needsAttentionItems.length})
                  </ThemedText>
                </View>
                <ThemedText style={styles.needsAttentionSubtitle}>
                  These items need more information or clarification
                </ThemedText>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.needsAttentionScrollView}>
                  {needsAttentionItems.map((item) => (
                    <NeedsAttentionCard key={item.id} item={item} onAction={loadClothingItems} />
                  ))}
                </ScrollView>
              </View>
            )}

            <ThemedText style={styles.sectionTitle}>Your Items</ThemedText>

            {clothingItems.length === 0 || filteredClothingItems.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconContainer}>
                  <IconSymbol name="tshirt.fill" size={64} color="#CBD5E1" />
                </View>
                {clothingItems.length === 0 ? (
                  <>
                    <ThemedText style={styles.emptyTitle}>No clothes in your closet</ThemedText>
                    <ThemedText style={styles.emptySubtitle}>
                      Tap the {'+'} button to add your first item.
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <ThemedText style={styles.emptyTitle}>No items match your filters</ThemedText>
                    <ThemedText style={styles.emptySubtitle}>
                      Try adjusting your season or event selections.
                    </ThemedText>
                  </>
                )}
              </View>
            ) : (
              <>
                {/* Items Display */}
                {viewMode === 'card' ? (
                  <View style={styles.gridContainer}>
                    <FlatList
                      key="card-view"
                      data={paginatedItems}
                      renderItem={renderCardItem}
                      keyExtractor={(item) => item.id}
                      numColumns={2}
                      contentContainerStyle={styles.itemsListContent}
                      columnWrapperStyle={styles.row}
                      showsVerticalScrollIndicator={false}
                      scrollEnabled={false} // Disable scroll for FlatList to allow ScrollView to handle it
                    />
                  </View>
                ) : (
                  <View style={styles.listContainer}>
                    <FlatList
                      key="list-view"
                      data={paginatedItems}
                      renderItem={renderListItem}
                      keyExtractor={(item) => item.id}
                      contentContainerStyle={styles.itemsListContent}
                      showsVerticalScrollIndicator={false}
                      scrollEnabled={false} // Disable scroll for FlatList to allow ScrollView to handle it
                    />
                  </View>
                )}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <View style={styles.paginationContainer}>
                    <View style={styles.paginationInfo}>
                      <ThemedText style={styles.paginationText}>
                        Showing {startIndex + 1}–{Math.min(endIndex, totalItems)} of {totalItems} items
                      </ThemedText>
                    </View>
                    <View style={styles.paginationControls}>
                      <TouchableOpacity
                        style={[styles.paginationButton, currentPage === 1 && styles.paginationButtonDisabled]}
                        onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                      >
                        <IconSymbol
                          name="chevron.left"
                          size={16}
                          color={currentPage === 1 ? '#cbd5e1' : '#6366f1'}
                        />
                        <ThemedText style={[styles.paginationButtonText, currentPage === 1 && styles.paginationButtonTextDisabled]}>
                          Previous
                        </ThemedText>
                      </TouchableOpacity>

                      <View style={styles.pageIndicator}>
                        <ThemedText style={styles.pageText}>
                          {currentPage} of {totalPages}
                        </ThemedText>
                      </View>

                      <TouchableOpacity
                        style={[styles.paginationButton, currentPage === totalPages && styles.paginationButtonDisabled]}
                        onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                      >
                        <ThemedText style={[styles.paginationButtonText, currentPage === totalPages && styles.paginationButtonTextDisabled]}>
                          Next
                        </ThemedText>
                        <IconSymbol
                          name="chevron.right"
                          size={16}
                          color={currentPage === totalPages ? '#cbd5e1' : '#6366f1'}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Floating Add Item Button */}
          <View style={styles.floatingButtonContainer}>
            <TouchableOpacity onPress={handleAddClothes} style={styles.floatingAddButton}>
              <IconSymbol name="plus" size={24} color="white" />
              <ThemedText style={styles.floatingAddButtonText}>Add Item</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Persistent Toast for Background Removal Errors */}
          {showToast && (
            <View style={[styles.toastContainer, { top: insets.top + 80 }]}>
              <View style={styles.toast}>
                <IconSymbol
                  name={toastTone === 'info' ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
                  size={20}
                  color={toastTone === 'info' ? VestiaryColors.gold : "#f59e0b"}
                />
                <ThemedText style={styles.toastText}>{toastMessage}</ThemedText>
                <TouchableOpacity
                  style={styles.toastCloseButton}
                  onPress={() => setShowToast(false)}
                >
                  <IconSymbol name="xmark" size={16} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>
          )}

        </ThemedView>
      </SafeAreaView>
    </Provider>
  );
}

const styles = StyleSheet.create({
  safeAreaContainer: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: VestiaryColors.navy,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navyLight,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: VestiaryColors.cream,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 8,
    padding: 2,
  },
  viewToggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleButtonActive: {
    backgroundColor: VestiaryColors.gold,
  },

  addButton: {
    backgroundColor: VestiaryColors.gold,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: VestiaryColors.gold,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 160,
  },
  filterContainer: {
    marginBottom: 28,
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 16,
  },
  filterHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: VestiaryColors.cream,
  },
  filterBadge: {
    backgroundColor: VestiaryColors.gold,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    color: VestiaryColors.navyDark,
    fontSize: 12,
    fontWeight: '700',
  },
  filterContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  clearFiltersButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: VestiaryColors.navy,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  clearFiltersText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.creamDark,
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 15,
    fontWeight: '600',
    width: 80,
    marginRight: 16,
    color: VestiaryColors.creamDark,
    alignSelf: 'flex-start',
    paddingTop: 6,
  },
  filterTags: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterTag: {
    backgroundColor: VestiaryColors.navy,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  filterTagSelected: {
    backgroundColor: VestiaryColors.gold,
    borderColor: VestiaryColors.gold,
  },
  filterTagText: {
    fontSize: 13,
    color: VestiaryColors.creamDark,
    fontWeight: '600',
  },
  filterTagTextSelected: {
    color: VestiaryColors.navyDark,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 20,
    color: VestiaryColors.cream,
    letterSpacing: -0.5,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  clothingItem: {
    width: '48%',
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
    position: 'relative',
  },
  menuButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: 'rgba(37, 43, 77, 0.9)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardContent: {
    padding: 16,
    flex: 1,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
  },
  cardImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  placeholderImageContainer: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: VestiaryColors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    borderStyle: 'dashed',
  },
  placeholderText: {
    fontSize: 12,
    color: VestiaryColors.creamDark,
    marginTop: 4,
    fontWeight: '500',
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    gap: 2,
  },
  statusIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'white',
  },
  cardInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    color: VestiaryColors.cream,
  },
  itemAttribute: {
    fontSize: 13,
    color: VestiaryColors.creamDark,
    marginBottom: 4,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    marginTop: 50,
  },
  emptyIconContainer: {
    marginBottom: 24,
    opacity: 0.7,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
    color: VestiaryColors.cream,
  },
  emptySubtitle: {
    fontSize: 15,
    color: VestiaryColors.creamDark,
    textAlign: 'center',
    lineHeight: 22,
  },

  itemsListContent: {
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'space-between',
  },
  listContainer: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  listItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  listImageContainer: {
    position: 'relative',
    marginRight: 15,
  },
  listImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  listStatusBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
  },
  listStatusText: {
    fontSize: 10,
    color: 'white',
  },
  listInfo: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  listCategory: {
    fontSize: 16,
    fontWeight: '700',
    color: VestiaryColors.cream,
  },
  listStatusLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  listDetails: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginBottom: 2,
    fontWeight: '500',
  },
  listNotes: {
    fontSize: 12,
    color: VestiaryColors.creamDark,
    fontWeight: '400',
  },
  paginationContainer: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: VestiaryColors.navyLight,
  },
  paginationInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  paginationText: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    fontWeight: '500',
  },
  paginationControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paginationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: VestiaryColors.navyLight,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    gap: 8,
  },
  paginationButtonDisabled: {
    opacity: 0.5,
  },
  paginationButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.gold,
  },
  paginationButtonTextDisabled: {
    color: VestiaryColors.creamDark,
  },
  pageIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: VestiaryColors.gold,
    borderRadius: 8,
  },
  pageText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.navyDark,
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  spinnerContainer: {
    width: 36,
    height: 36,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerBar: {
    position: 'absolute',
    width: 3,
    height: 16,
    backgroundColor: 'white',
    borderRadius: 2,
    top: 2,
    shadowColor: 'white',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  spinnerCenter: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: 'white',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
  },
  processingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  floatingButtonContainer: {
    position: 'absolute',
    bottom: 100, // Above tab bar
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  floatingAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.gold,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 32,
    shadowColor: VestiaryColors.gold,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
    gap: 8,
  },
  floatingAddButtonText: {
    color: VestiaryColors.navyDark,
    fontSize: 16,
    fontWeight: '700',
  },
  statusBadgeNoImage: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  processingImageContainer: {
    position: 'relative',
  },
  processingImage: {
    opacity: 0.7,
  },
  processingNote: {
    fontSize: 12,
    color: VestiaryColors.gold,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  evaluatingText: {
    color: VestiaryColors.gold,
    fontWeight: '700',
  },
  evaluatingNote: {
    fontSize: 12,
    color: VestiaryColors.gold,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  needsAttentionImageContainer: {
    borderColor: '#f59e0b',
    borderWidth: 2,
    backgroundColor: '#fef3c7',
  },
  needsAttentionText: {
    color: '#f59e0b',
    fontWeight: '600',
  },
  needsAttentionSection: {
    marginBottom: 32,
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: VestiaryColors.gold,
  },
  needsAttentionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  needsAttentionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: VestiaryColors.gold,
  },
  needsAttentionSubtitle: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginBottom: 16,
  },
  needsAttentionScrollView: {
    marginHorizontal: -4,
  },
  needsAttentionCard: {
    width: 120,
    backgroundColor: VestiaryColors.navy,
    borderRadius: 12,
    marginHorizontal: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: VestiaryColors.gold,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  needsAttentionImage: {
    width: '100%',
    height: 80,
    borderRadius: 8,
    backgroundColor: VestiaryColors.navyLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  needsAttentionPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  needsAttentionBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: VestiaryColors.gold,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  needsAttentionDetails: {
    alignItems: 'center',
  },
  needsAttentionItemName: {
    fontSize: 12,
    fontWeight: '600',
    color: VestiaryColors.cream,
    textAlign: 'center',
    marginBottom: 2,
  },
  needsAttentionAction: {
    fontSize: 10,
    color: VestiaryColors.gold,
    fontWeight: '500',
    textAlign: 'center',
  },
  toastContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    borderWidth: 1,
    borderColor: VestiaryColors.gold,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    gap: 12,
  },
  toastText: {
    flex: 1,
    fontSize: 14,
    color: VestiaryColors.cream,
    fontWeight: '500',
  },
  toastCloseButton: {
    padding: 4,
  },
  statusIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 1,
  },
  evaluatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
