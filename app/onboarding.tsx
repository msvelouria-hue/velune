import { useState, useEffect } from "react";
import { StyleSheet, TouchableOpacity, TextInput, View, ScrollView, Platform, Image, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from 'expo-location';
import * as Calendar from 'expo-calendar';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import { useRouter } from 'expo-router';
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { VestiaryColors } from "@/constants/Colors";
import { clothingDetection, DetectedClothingItem } from '@/utils/clothingDetection';
import { photoValidation } from '@/utils/photoValidation';
import { saveUserProfile, updateOnboardingStatus, MakeupPreferenceLevel } from '@/utils/userProfileService';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedStylist, setSelectedStylist] = useState<string | null>(null);
  const [selectedHelpAreas, setSelectedHelpAreas] = useState<string[]>([]);
  const [locationAccess, setLocationAccess] = useState<string | null>(null);
  const [calendarAccess, setCalendarAccess] = useState<string | null>(null);
  const [clothesUploadMethod, setClothesUploadMethod] = useState<string | null>(null);
  const [cameraRollAccess, setCameraRollAccess] = useState<string | null>(null);
  const [selectedGender, setSelectedGender] = useState<string | null>(null);
  const [hairLength, setHairLength] = useState<string | null>(null);
  const [hairTexture, setHairTexture] = useState<string | null>(null);
  const [hairColor, setHairColor] = useState<string | null>(null);
  const [hairStyle, setHairStyle] = useState<string>('');
  const [photosTaken, setPhotosTaken] = useState<number>(0);
  const [selectedImages, setSelectedImages] = useState<{ uri: string }[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [detectedItems, setDetectedItems] = useState<DetectedClothingItem[]>([]);
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
  const [wantsMakeupSuggestions, setWantsMakeupSuggestions] = useState<boolean | null>(null);
  const [makeupPreferenceLevel, setMakeupPreferenceLevel] = useState<MakeupPreferenceLevel>('minimal');
  const handleGetStarted = () => {
    console.log('📱 Get Started button clicked!');
    // Will navigate to next step in the wizard
    setCurrentStep(1);
  };

  const stylists = [
    {
      id: "Emma",
      name: "Emma",
      title: "The trendy fashionista",
      description: "Always up-to-date with the latest trends and loves bold, statement pieces",
      icon: "👤"
    },
    {
      id: "Sophie",
      name: "Sophie",
      title: "The classic stylist",
      description: "Believes in timeless elegance and sophisticated, versatile pieces",
      icon: "👤"
    },
    {
      id: "Maya",
      name: "Maya",
      title: "The creative explorer",
      description: "Loves mixing patterns, colors, and creating unique, artistic looks",
      icon: "👤"
    },
    {
      id: "Gary",
      name: "Gary",
      title: "The gay best friend",
      description: "Honest, fun, and fearless with fashion - will tell you exactly what works and what doesn't",
      icon: "👤"
    },
    {
      id: "Marcus",
      name: "Marcus",
      title: "The modern gentleman",
      description: "Focuses on sharp, clean looks with attention to fit and quality details",
      icon: "👤"
    }
  ];

  useEffect(() => {
    // Load saved stylist selection
    const loadSavedStylist = async () => {
      try {
        const savedStylist = await AsyncStorage.getItem('selectedStylist');
        if (savedStylist) {
          setSelectedStylist(savedStylist);
        }
      } catch (error) {
        console.error('Error loading saved stylist:', error);
      }
    };

    if (currentStep === 1) {
      loadSavedStylist();
    }

    // Cleanup photo listener on unmount
    return () => {
      if (global.onPhotoTaken) {
        global.onPhotoTaken = undefined;
      }
    };
  }, [currentStep]);

  const handleStylistSelection = async (stylistId: string) => {
    setSelectedStylist(stylistId);
    try {
      await AsyncStorage.setItem('selectedStylist', stylistId);
    } catch (error) {
      console.error('Error saving stylist selection:', error);
    }
  };

  const handleStylistNext = () => {
    if (selectedStylist) {
      setCurrentStep(2);
    }
  };

  // Filter help areas based on selected gender
  const getHelpAreas = () => {
    const baseAreas = [
      "Base outfit",
      "Layers",
      "Shoes",
      "Accessories",
      "Hair"
    ];

    // Hide accessories for men
    if (selectedGender === "man") {
      return baseAreas.filter(area => area !== "Accessories");
    }

    return baseAreas;
  };

  const helpAreas = getHelpAreas();

  const handleHelpAreaSelection = (area: string) => {
    setSelectedHelpAreas(prev => {
      if (prev.includes(area)) {
        return prev.filter(item => item !== area);
      } else {
        return [...prev, area];
      }
    });
  };

  const handleHelpAreasNext = async () => {
    try {
      await AsyncStorage.setItem('helpAreas', JSON.stringify(selectedHelpAreas));
      // If "Hair" is selected, go to hair profile step (3.5)
      // Then show makeup preference step (3.6) for non-male users
      // Otherwise skip to permissions (4)
      if (selectedHelpAreas.includes('Hair')) {
        setCurrentStep(3.5);
      } else if (selectedGender !== 'man') {
        setCurrentStep(3.6);
      } else {
        setCurrentStep(4);
      }
    } catch (error) {
      console.error('Error saving help areas:', error);
    }
  };

  const handleHairProfileNext = async () => {
    if (hairLength && hairTexture && hairColor) {
      try {
        await AsyncStorage.setItem('hairProfile', JSON.stringify({
          length: hairLength,
          texture: hairTexture,
          color: hairColor,
          style: hairStyle
        }));
        // Show makeup preference step (3.6) for non-male users, otherwise permissions (4)
        if (selectedGender !== 'man') {
          setCurrentStep(3.6);
        } else {
          setCurrentStep(4);
        }
      } catch (error) {
        console.error('Error saving hair profile:', error);
      }
    }
  };

  const handleMakeupPreferenceNext = async () => {
    try {
      const level = wantsMakeupSuggestions ? makeupPreferenceLevel : 'none';
      await saveUserProfile({ makeupPreferenceLevel: level });
      setCurrentStep(4);
    } catch (error) {
      console.error('Error saving makeup preference:', error);
      setCurrentStep(4);
    }
  };

  const handleGrantLocationAccess = async () => {
    try {
      // For React Native (mobile), use Expo Location
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status === 'granted') {
          await AsyncStorage.setItem('locationAccess', 'granted');
          setLocationAccess('granted');
        } else {
          await AsyncStorage.setItem('locationAccess', 'denied');
          setLocationAccess('denied');
        }
      } else {
        // For web, use navigator.geolocation
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              // Permission granted
              await AsyncStorage.setItem('locationAccess', 'granted');
              setLocationAccess('granted');
            },
            async (error) => {
              // Permission denied or error
              await AsyncStorage.setItem('locationAccess', 'denied');
              setLocationAccess('denied');
            },
            { timeout: 10000 }
          );
        } else {
          // Geolocation not supported
          await AsyncStorage.setItem('locationAccess', 'denied');
          setLocationAccess('denied');
        }
      }
    } catch (error) {
      console.error('Error requesting location access:', error);
      await AsyncStorage.setItem('locationAccess', 'denied');
      setLocationAccess('denied');
    }
  };

  const handleGrantCalendarAccess = async () => {
    try {
      // Request Calendar permission first
      const calendarResult = await Calendar.requestCalendarPermissionsAsync();

      if (calendarResult.status === 'granted') {
        // iOS requires BOTH Calendar and Reminders permissions to access calendar events
        // Request Reminders permission immediately after Calendar is granted
        const remindersResult = await Calendar.requestRemindersPermissionsAsync();

        // Both must be granted for full calendar functionality
        const bothGranted = calendarResult.status === 'granted' && remindersResult.status === 'granted';

        if (bothGranted) {
          await AsyncStorage.setItem('calendarAccess', 'granted');
          setCalendarAccess('granted');
          console.log('📅 Both Calendar and Reminders permissions granted');
        } else {
          // Calendar granted but Reminders denied - still save as granted since calendar works partially
          await AsyncStorage.setItem('calendarAccess', 'granted');
          setCalendarAccess('granted');
          console.log('📅 Calendar granted, Reminders denied - calendar will work with limited functionality');
        }
      } else {
        await AsyncStorage.setItem('calendarAccess', 'denied');
        setCalendarAccess('denied');
      }
    } catch (error) {
      console.error('Error requesting calendar access:', error);
      await AsyncStorage.setItem('calendarAccess', 'denied');
      setCalendarAccess('denied');
    }
  };

  const handlePermissionsNext = () => {
    // All permissions are optional - user can proceed regardless
    setCurrentStep(5);
  };

  const handleGrantCameraRollAccess = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();

      if (status === 'granted') {
        await AsyncStorage.setItem('cameraRollAccess', 'granted');
        setCameraRollAccess('granted');

        // Trigger photo selection after permission is granted
        setTimeout(() => {
          handleSelectPhotos();
        }, 500); // Small delay to allow UI to update
      } else {
        await AsyncStorage.setItem('cameraRollAccess', 'denied');
        setCameraRollAccess('denied');
      }
    } catch (error) {
      console.error('Error requesting camera roll access:', error);
      await AsyncStorage.setItem('cameraRollAccess', 'denied');
      setCameraRollAccess('denied');
    }
  };

  const handleSelectPhotos = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 1,
        selectionLimit: 20, // Limit to 20 photos to prevent overwhelming the user
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newImages = result.assets.map(asset => ({ uri: asset.uri }));
        setSelectedImages(newImages);
        await AsyncStorage.setItem('clothesUploadMethod', 'camera_roll');
        setClothesUploadMethod('camera_roll');
      }
    } catch (error) {
      console.error('Error selecting photos:', error);
      Alert.alert('Error', 'Failed to select photos. Please try again.');
    }
  };



  const getCategoryFromDetectedType = (type: string): string => {
    const categoryMap: { [key: string]: string } = {
      'shirt': 'Tops',
      't-shirt': 'Tops',
      'blouse': 'Tops',
      'sweater': 'Tops',
      'hoodie': 'Tops',
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
    };
    return categoryMap[type.toLowerCase()] || 'Accessories';
  };

  const extractColorFromName = (name: string): string => {
    const colors = ['Blue', 'Black', 'White', 'Gray', 'Red', 'Navy', 'Brown', 'Green', 'Pink', 'Purple', 'Yellow', 'Orange'];
    const foundColor = colors.find(color => name.includes(color));
    return foundColor || '';
  };

  const extractStyleFromName = (name: string): string => {
    const styles = ['Casual', 'Formal', 'Athletic', 'Vintage', 'Modern'];
    const foundStyle = styles.find(style => name.includes(style));
    return foundStyle || 'Casual';
  };

  const handleTakePhoto = async () => {
    try {
      // Request camera permissions
      const { status } = await Camera.requestCameraPermissionsAsync();

      if (status === 'granted') {
        // Set up listener for when photo is taken
        global.onPhotoTaken = (photoUri: string) => {
          setSelectedImages(prev => [...prev, { uri: photoUri }]);
          setPhotosTaken(prev => prev + 1);
        };

        // Camera permission granted - navigate to camera screen
        router.push('/camera');

        await AsyncStorage.setItem('clothesUploadMethod', 'camera');
        setClothesUploadMethod('camera');
      } else {
        // Camera permission denied
        console.log('Camera permission denied');
      }
    } catch (error) {
      console.error('Error taking photo:', error);
    }
  };

  const handleIndividualPictures = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status === 'granted') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 1,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
          const newImages = result.assets.map(asset => ({ uri: asset.uri }));
          setSelectedImages(prevImages => [...prevImages, ...newImages]);
          await AsyncStorage.setItem('clothesUploadMethod', 'individual');
          setClothesUploadMethod('individual');
          setPhotosTaken(prev => prev + newImages.length);
        }
      } else {
        console.log('Image picker permission denied');
      }
    } catch (error) {
      console.error('Error picking images:', error);
    }
  };

  const handleManualUpload = async (method: string) => {
    try {
      await AsyncStorage.setItem('clothesUploadMethod', method);
      setClothesUploadMethod(method);
      if (method === 'individual') {
        setPhotosTaken(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error saving upload method:', error);
    }
  };

  const handleClothesLater = async () => {
    try {
      await AsyncStorage.setItem('clothesUploadMethod', 'later');
      setClothesUploadMethod('later');
      setCurrentStep(6);
    } catch (error) {
      console.error('Error saving upload method:', error);
    }
  };

  const handleGenderSelection = async (gender: string) => {
    setSelectedGender(gender);
    try {
      await AsyncStorage.setItem('selectedGender', gender);
    } catch (error) {
      console.error('Error saving gender selection:', error);
    }
  };

  const handleGenderNext = () => {
    if (selectedGender) {
      setCurrentStep(3);
    }
  };

  const handleAutoDetection = async () => {
    try {
      setIsAnalyzing(true);
      setAnalysisProgress({ current: 0, total: 0 });

      console.log('Starting automatic clothing detection...');

      const detectedItems = await clothingDetection.analyzeCameraRollForClothing({
        limit: 30, // Analyze last 30 photos
        onProgress: (current, total) => {
          setAnalysisProgress({ current, total });
        },
        onItemDetected: (item) => {
          setDetectedItems(prev => [...prev, item]);
        }
      });

      let newItemsCount = 0;

      if (detectedItems.length > 0) {
        // Convert detected items to closet format and save
        const closetItems = clothingDetection.convertToClosetItems(detectedItems);

        // Mark all items as "done" since they've completed the onboarding detection process
        const completedItems = closetItems.map(item => ({
          ...item,
          photoStatus: 'done' as const,
          validationResult: {
            isValid: true,
            clothingItems: [item.category],
            message: 'Successfully detected during onboarding'
          }
        }));

        const { cloudSyncService } = await import('@/utils/cloudSyncService');
        const currentItems = await cloudSyncService.loadClosetItems();

        // Filter out duplicates based on photo URI and category
        const newItems = completedItems.filter(newItem => {
          return !currentItems.some((existingItem: any) =>
            existingItem.photo === newItem.photo &&
            existingItem.category === newItem.category
          );
        });

        newItemsCount = newItems.length;

        if (newItems.length > 0) {
          for (const item of newItems) {
            const cloudItem = await cloudSyncService.syncItemToCloud(item);
            if (!cloudItem) {
              throw new Error(`Could not save onboarding item ${item.id} to Firestore`);
            }
          }

          console.log(`Auto-detection: Saved ${newItems.length} new items to Firestore:`, newItems.map(item => ({
            id: item.id,
            category: item.category,
            photoStatus: item.photoStatus,
            hasPhoto: !!item.photo,
            dateAdded: item.dateAdded
          })));

          // Also save photo status for each item
          const statusData: Record<string, any> = {};
          newItems.forEach(item => {
            statusData[item.id] = {
              status: 'done',
              result: {
                isValid: true,
                clothingItems: [item.category],
                message: 'Successfully detected during onboarding'
              },
              timestamp: Date.now()
            };
          });

          const existingStatus = await AsyncStorage.getItem('photoStatus');
          const currentStatus = existingStatus ? JSON.parse(existingStatus) : {};
          const updatedStatus = { ...currentStatus, ...statusData };
          await AsyncStorage.setItem('photoStatus', JSON.stringify(updatedStatus));
        }
      }

      // Wait a moment for AsyncStorage operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Show result and proceed
      if (newItemsCount > 0) {
        Alert.alert(
          'Success!',
          `Found and added ${newItemsCount} clothing items to your closet!`,
          [
            { text: 'Great!', onPress: () => setCurrentStep(6) }
          ]
        );
      } else {
        Alert.alert(
          'No Items Found',
          'We couldn\'t detect any clothing items in your recent photos. You can add items manually later!',
          [
            { text: 'OK', onPress: () => setCurrentStep(6) }
          ]
        );
      }

    } catch (error) {
      console.error('Auto-detection error:', error);
      Alert.alert(
        'Analysis Failed',
        'Unable to analyze your photos. You can add items manually later!',
        [
          { text: 'OK', onPress: () => setCurrentStep(6) }
        ]
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSkipAutoDetection = () => {
    setCurrentStep(6);
  };

  const handleFinish = async () => {
    console.log('🏁 Starting onboarding completion...');
    console.log('📱 Get Started button clicked!');

    setIsCompletingOnboarding(true);

    try {
      // Process any selected images using the same system as closet
      if (selectedImages.length > 0) {
        console.log(`Processing ${selectedImages.length} selected images during onboarding completion...`);

        // Create "Evaluating" items for each selected image (same as closet does)
        const evaluatingItems = selectedImages.map((image, index) => ({
          id: `evaluating_${Date.now()}_${index}`,
          photo: image.uri,
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
          photoStatus: 'evaluating' as const,
          isEvaluating: true, // Flag to identify evaluating items
        }));

        console.log(`Processing ${evaluatingItems.length} onboarding image(s) into Firestore`);
        await Promise.all(evaluatingItems.map(item => processPhotoAndReplaceEvaluatingCard(item)));
      } else {
        console.log('ℹ️ No images selected, skipping image processing');
      }

      console.log('💾 Saving user profile...');

      // Build hair profile if Hair was selected
      let hairProfileData = undefined;
      if (selectedHelpAreas.includes('Hair') && hairLength && hairTexture && hairColor) {
        hairProfileData = {
          length: hairLength,
          texture: hairTexture,
          color: hairColor,
          style: hairStyle
        };
      }

      // Save user profile to Firestore
      await saveUserProfile({
        selectedStylist: selectedStylist ?? undefined,
        gender: selectedGender ?? undefined,
        helpAreas: Array.from(selectedHelpAreas),
        hairProfile: hairProfileData,
      });
      console.log('✅ User profile saved');

      console.log('💾 Updating onboarding status...');
      // Save onboarding completion data (both Firestore and AsyncStorage)
      await updateOnboardingStatus(true);
      console.log('✅ Onboarding status updated to true');

      console.log('🧭 Navigating to main app: /(tabs)');
      // Navigate to main app
      router.replace('/(tabs)');
      console.log('✅ Navigation called successfully');
    } catch (error) {
      console.error('❌ Error completing onboarding:', error);
      if (error instanceof Error && error.stack) {
        console.error('❌ Error stack:', error.stack);
      }
      Alert.alert('Error', 'Failed to save your information. Please try again.');
    } finally {
      setIsCompletingOnboarding(false);
    }
  };

  // Helper to update an item photo after background removal completes
  const updateItemPhotoInStorage = async (itemId: string, newPhotoUri: string) => {
    try {
      const { cloudSyncService } = await import('@/utils/cloudSyncService');
      const item = await cloudSyncService.getItem(itemId);

      if (!item) return;

      await cloudSyncService.updateItem({
        ...item,
        photo: newPhotoUri,
        imageUrl: newPhotoUri,
        photoStatus: 'background_removed',
        backgroundRemovalStatus: 'complete',
      });

      if (global.onItemsUpdated) {
        global.onItemsUpdated();
      }

      console.log(`🖼️ Updated photo for item ${itemId} with background-removed image`);
    } catch (error) {
      console.warn(`⚠️ Failed to update photo for item ${itemId}:`, error);
    }
  };

  // Add the same processing function that the closet uses
  const processPhotoAndReplaceEvaluatingCard = async (evaluatingItem: any) => {
    try {
      console.log(`🤖 Starting AI processing for evaluating item: ${evaluatingItem.id}`);

      // Import background removal service
      const { createBackgroundRemovalService } = await import('@/utils/backgroundRemoval');

      // Start background removal in parallel (non-blocking)
      console.log('🚀 Starting AI detection (background removal runs in parallel)');

      const bgService = createBackgroundRemovalService('firebase');
      const bgRemovalPromise = bgService.removeBackground(evaluatingItem.photo!)
        .then(result => ({ success: true, photo: result }))
        .catch(error => {
          console.warn('⚠️ Background removal failed, using original photo:', error);
          return { success: false, photo: evaluatingItem.photo! };
        });

      // Run AI detection first - this determines when we unblock
      const detectedItems = await clothingDetection.detectClothingInImage(evaluatingItem.photo!);
      console.log(`✅ AI detection complete: ${detectedItems.length} items detected`);

      const { cloudSyncService } = await import('@/utils/cloudSyncService');
      const itemsToSave: any[] = [];

      if (detectedItems.length > 0) {
        // Convert detected items to closet format (same as closet)
        const getCategoryFromDetectedType = (type: string): string => {
          const categoryMap: { [key: string]: string } = {
            'shirt': 'Tops',
            't-shirt': 'Tops',
            'blouse': 'Tops',
            'sweater': 'Tops',
            'hoodie': 'Tops',
            'tank': 'Tops',
            'jacket': 'Outerwear',
            'coat': 'Outerwear',
            'blazer': 'Outerwear',
            'cardigan': 'Outerwear',
            'pants': 'Bottoms',
            'jeans': 'Bottoms',
            'shorts': 'Bottoms',
            'trousers': 'Bottoms',
            'skirt': 'Bottoms',
            'leggings': 'Bottoms',
            'dress': 'Dresses',
            'gown': 'Dresses',
            'jumpsuit': 'Dresses',
            'shoes': 'Shoes',
            'sneakers': 'Shoes',
            'boots': 'Shoes',
            'sandals': 'Shoes',
            'sandal': 'Shoes',
            'heels': 'Shoes',
            'hat': 'Accessories',
            'cap': 'Accessories',
            'bag': 'Accessories',
            'belt': 'Accessories',
            'scarf': 'Accessories',
          };
          return categoryMap[type.toLowerCase()] || 'Accessories';
        };

        const newClothingItems = detectedItems.map(detected => {
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
          };
        });

        itemsToSave.push(...newClothingItems);
        console.log(`✅ Replaced evaluating card with ${newClothingItems.length} detected items`);
      } else {
        // No items detected, create a generic item (same as closet)
        const genericId = `generic_${Date.now()}_${Math.random()}`;

        const genericItem = {
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

      const savedItemIds: string[] = [];
      for (const item of itemsToSave) {
        const cloudItem = await cloudSyncService.syncItemToCloud(item);
        if (!cloudItem) {
          throw new Error(`Could not save onboarding item ${item.id} to Firestore`);
        }
        savedItemIds.push(item.id);
      }

      // Trigger a refresh event that the closet screen can listen to
      if (global.onItemsUpdated) {
        global.onItemsUpdated();
      }

      // Wait for background removal to complete and update photos
      bgRemovalPromise.then(async (bgResult) => {
        if (bgResult.success && bgResult.photo !== evaluatingItem.photo) {
          console.log(`🎨 Background removal complete, updating ${savedItemIds.length} item(s)`);

          // Update each new item with the background-removed photo
          for (const itemId of savedItemIds) {
            await updateItemPhotoInStorage(itemId, bgResult.photo);
          }
        }
      });

    } catch (error) {
      console.error(`❌ AI processing failed for item: ${evaluatingItem.id}`, error);

      // On error, convert evaluating item to a generic item that needs user input (same as closet)
      try {
        const fallbackItem = {
          id: `fallback_${Date.now()}_${Math.random()}`,
          photo: evaluatingItem.photo,
          category: 'Uncategorized',
          color: '',
          pattern: '',
          material: '',
          style: '',
          notes: 'Analysis failed - please edit to add details',
          dateAdded: new Date().toISOString(),
          tags: {
            season: [],
            event: [],
          },
          photoStatus: 'needs_clarification',
          needsUserInput: true,
        };

        const { cloudSyncService } = await import('@/utils/cloudSyncService');
        await cloudSyncService.syncItemToCloud(fallbackItem);
        console.log(`🔄 Created fallback item due to processing error`);

        // Trigger a refresh event that the closet screen can listen to
        if (global.onItemsUpdated) {
          global.onItemsUpdated();
        }
      } catch (fallbackError) {
        console.error('Error creating fallback item:', fallbackError);
      }
    }
  };


  if (currentStep === 0) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>

        <View style={[styles.centeredContainer, { paddingTop: 40 }]}>
          <ThemedView style={styles.welcomeContent}>
            <ThemedText type="title" style={[styles.title, styles.brandedTitle]}>
              ✨ Velune
            </ThemedText>
            <ThemedText style={styles.description}>
              Velune helps you assemble stylish outfits from what you{"'"}ve already got
            </ThemedText>
            <TouchableOpacity style={styles.button} onPress={handleGetStarted}>
              <ThemedText style={styles.buttonText}>Get Started</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </View>
      </ThemedView>
    );
  }

  if (currentStep === 1) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20, paddingBottom: 100 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.stylistTitle, styles.brandedTitle]}>
              ✨ Pick your fashion assistant
            </ThemedText>

            <ThemedText style={styles.stylistSubtitle}>
              You can always change this later
            </ThemedText>

            <ThemedText style={styles.chooseText}>
              Choose your stylist:
            </ThemedText>

            <View style={styles.stylistContainer}>
              {stylists.map((stylist) => (
                <TouchableOpacity
                  key={stylist.id}
                  style={[
                    styles.stylistCard,
                    selectedStylist === stylist.id && styles.stylistCardSelected
                  ]}
                  onPress={() => handleStylistSelection(stylist.id)}
                >
                  <View style={styles.stylistIcon}>
                    <ThemedText style={styles.stylistIconText}>{stylist.icon}</ThemedText>
                  </View>
                  <View style={styles.stylistInfo}>
                    <ThemedText style={styles.stylistName}>
                      {stylist.name} • {stylist.title}
                    </ThemedText>
                    <ThemedText style={styles.stylistDescription}>
                      {stylist.description}
                    </ThemedText>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ThemedView>
        </ScrollView>

        {/* Fixed bottom navigation bar */}
        <View style={[styles.fixedBottomBar, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(0)}>
            <ThemedText style={styles.backButtonText}>Back</ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.nextButton,
              !selectedStylist && styles.nextButtonDisabled
            ]}
            onPress={handleStylistNext}
            disabled={!selectedStylist}
          >
            <ThemedText style={[
              styles.nextButtonText,
              !selectedStylist && styles.nextButtonTextDisabled
            ]}>
              Next →
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  if (currentStep === 2) {
    const genderOptions = [
      { id: "woman", label: "Woman" },
      { id: "man", label: "Man" },
      { id: "non-binary", label: "Non-binary" },
      { id: "prefer-not-to-say", label: "Prefer not to say" }
    ];

    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.helpTitle, styles.brandedTitle]}>
              👤 What{"'"}s your gender?
            </ThemedText>

            <ThemedText style={styles.helpSubtitle}>
              This helps us give you better style recommendations
            </ThemedText>

            <View style={styles.genderOptionsContainer}>
              {genderOptions.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.genderOption,
                    selectedGender === option.id && styles.genderOptionSelected
                  ]}
                  onPress={() => handleGenderSelection(option.id)}
                >
                  <ThemedText style={[
                    styles.genderOptionText,
                    selectedGender === option.id && styles.genderOptionTextSelected
                  ]}>
                    {option.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.navigationContainer}>
              <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(1)}>
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.nextButton,
                  !selectedGender && styles.nextButtonDisabled
                ]}
                onPress={handleGenderNext}
                disabled={!selectedGender}
              >
                <ThemedText style={[
                  styles.nextButtonText,
                  !selectedGender && styles.nextButtonTextDisabled
                ]}>
                  Next →
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </ScrollView>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  if (currentStep === 3) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.helpTitle, styles.brandedTitle]}>
              ✓ What would you like help with?
            </ThemedText>

            <ThemedText style={styles.helpSubtitle}>
              {selectedStylist} will help you with these areas
            </ThemedText>

            <View style={styles.helpAreasContainer}>
              {helpAreas.map((area) => (
                <TouchableOpacity
                  key={area}
                  style={[
                    styles.helpAreaButton,
                    selectedHelpAreas.includes(area) && styles.helpAreaButtonSelected
                  ]}
                  onPress={() => handleHelpAreaSelection(area)}
                >
                  <ThemedText style={[
                    styles.helpAreaText,
                    selectedHelpAreas.includes(area) && styles.helpAreaTextSelected
                  ]}>
                    {area}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.navigationContainer}>
              <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(2)}>
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.nextButton,
                  selectedHelpAreas.length === 0 && styles.nextButtonDisabled
                ]}
                onPress={handleHelpAreasNext}
                disabled={selectedHelpAreas.length === 0}
              >
                <ThemedText style={[
                  styles.nextButtonText,
                  selectedHelpAreas.length === 0 && styles.nextButtonTextDisabled
                ]}>
                  Next →
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </ScrollView>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  // Hair Profile Step (3.5) - only shown if "Hair" is selected in help areas
  if (currentStep === 3.5) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.helpTitle, styles.brandedTitle]}>
              💇 Tell me about your hair
            </ThemedText>

            <ThemedText style={styles.helpSubtitle}>
              This helps {selectedStylist} suggest hairstyles that complement your outfits
            </ThemedText>

            <View style={styles.hairProfileContainer}>
              <ThemedText style={styles.hairProfileLabel}>Hair Length</ThemedText>
              <View style={styles.hairOptionsRow}>
                {['Short', 'Medium', 'Long', 'Very Long'].map((length) => (
                  <TouchableOpacity
                    key={length}
                    style={[
                      styles.hairOptionButton,
                      hairLength === length && styles.hairOptionButtonSelected
                    ]}
                    onPress={() => setHairLength(length)}
                  >
                    <ThemedText style={[
                      styles.hairOptionText,
                      hairLength === length && styles.hairOptionTextSelected
                    ]}>
                      {length}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemedText style={styles.hairProfileLabel}>Hair Texture</ThemedText>
              <View style={styles.hairOptionsRow}>
                {['Straight', 'Wavy', 'Curly', 'Coily'].map((texture) => (
                  <TouchableOpacity
                    key={texture}
                    style={[
                      styles.hairOptionButton,
                      hairTexture === texture && styles.hairOptionButtonSelected
                    ]}
                    onPress={() => setHairTexture(texture)}
                  >
                    <ThemedText style={[
                      styles.hairOptionText,
                      hairTexture === texture && styles.hairOptionTextSelected
                    ]}>
                      {texture}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemedText style={styles.hairProfileLabel}>Hair Color</ThemedText>
              <View style={styles.hairOptionsRow}>
                {['Black', 'Brown', 'Blonde', 'Red', 'Gray', 'Other'].map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.hairOptionButton,
                      hairColor === color && styles.hairOptionButtonSelected
                    ]}
                    onPress={() => setHairColor(color)}
                  >
                    <ThemedText style={[
                      styles.hairOptionText,
                      hairColor === color && styles.hairOptionTextSelected
                    ]}>
                      {color}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemedText style={styles.hairProfileLabel}>Preferred Style (Optional)</ThemedText>
              <TextInput
                style={styles.hairStyleInput}
                placeholder="e.g., ponytail, bun, down, braids..."
                placeholderTextColor="#999"
                value={hairStyle}
                onChangeText={setHairStyle}
              />
            </View>

            <View style={styles.navigationContainer}>
              <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(3)}>
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.nextButton,
                  (!hairLength || !hairTexture || !hairColor) && styles.nextButtonDisabled
                ]}
                onPress={handleHairProfileNext}
                disabled={!hairLength || !hairTexture || !hairColor}
              >
                <ThemedText style={[
                  styles.nextButtonText,
                  (!hairLength || !hairTexture || !hairColor) && styles.nextButtonTextDisabled
                ]}>
                  Next →
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </ScrollView>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === 3 ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  // Makeup Preference Step (3.6) - only shown if "Makeup" is selected in help areas
  if (currentStep === 3.6) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.permissionsTitle, styles.brandedTitle]}>
              💄 Makeup Preferences
            </ThemedText>

            <ThemedText style={styles.permissionsSubtitle}>
              Would you like {selectedStylist} to suggest makeup looks with your outfits?
            </ThemedText>

            <View style={styles.makeupToggleContainer}>
              <TouchableOpacity
                style={[
                  styles.makeupToggleButton,
                  wantsMakeupSuggestions === true && styles.makeupToggleButtonActive
                ]}
                onPress={() => setWantsMakeupSuggestions(true)}
              >
                <ThemedText style={[
                  styles.makeupToggleText,
                  wantsMakeupSuggestions === true && styles.makeupToggleTextActive
                ]}>
                  Yes, please!
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.makeupToggleButton,
                  wantsMakeupSuggestions === false && styles.makeupToggleButtonActive
                ]}
                onPress={() => setWantsMakeupSuggestions(false)}
              >
                <ThemedText style={[
                  styles.makeupToggleText,
                  wantsMakeupSuggestions === false && styles.makeupToggleTextActive
                ]}>
                  No thanks
                </ThemedText>
              </TouchableOpacity>
            </View>

            {wantsMakeupSuggestions === true && (
              <View style={styles.makeupLevelContainer}>
                <ThemedText style={styles.makeupLevelTitle}>
                  How much makeup do you typically wear?
                </ThemedText>

                <View style={styles.makeupLevelButtons}>
                  <TouchableOpacity
                    style={[
                      styles.makeupLevelButton,
                      makeupPreferenceLevel === 'minimal' && styles.makeupLevelButtonActive
                    ]}
                    onPress={() => setMakeupPreferenceLevel('minimal')}
                  >
                    <ThemedText style={styles.makeupLevelEmoji}>✨</ThemedText>
                    <ThemedText style={[
                      styles.makeupLevelButtonText,
                      makeupPreferenceLevel === 'minimal' && styles.makeupLevelButtonTextActive
                    ]}>
                      Minimal
                    </ThemedText>
                    <ThemedText style={styles.makeupLevelDescription}>
                      1-2 products
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.makeupLevelButton,
                      makeupPreferenceLevel === 'everyday' && styles.makeupLevelButtonActive
                    ]}
                    onPress={() => setMakeupPreferenceLevel('everyday')}
                  >
                    <ThemedText style={styles.makeupLevelEmoji}>💫</ThemedText>
                    <ThemedText style={[
                      styles.makeupLevelButtonText,
                      makeupPreferenceLevel === 'everyday' && styles.makeupLevelButtonTextActive
                    ]}>
                      Everyday
                    </ThemedText>
                    <ThemedText style={styles.makeupLevelDescription}>
                      3-5 products
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.makeupLevelButton,
                      makeupPreferenceLevel === 'full' && styles.makeupLevelButtonActive
                    ]}
                    onPress={() => setMakeupPreferenceLevel('full')}
                  >
                    <ThemedText style={styles.makeupLevelEmoji}>💄</ThemedText>
                    <ThemedText style={[
                      styles.makeupLevelButtonText,
                      makeupPreferenceLevel === 'full' && styles.makeupLevelButtonTextActive
                    ]}>
                      Full Glam
                    </ThemedText>
                    <ThemedText style={styles.makeupLevelDescription}>
                      5-8 products
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.navigationContainer}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setCurrentStep(selectedHelpAreas.includes('Hair') ? 3.5 : 3)}
              >
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.nextButton,
                  wantsMakeupSuggestions === null && styles.nextButtonDisabled
                ]}
                onPress={handleMakeupPreferenceNext}
                disabled={wantsMakeupSuggestions === null}
              >
                <ThemedText style={[
                  styles.nextButtonText,
                  wantsMakeupSuggestions === null && styles.nextButtonTextDisabled
                ]}>
                  Next →
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </ScrollView>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === 3 ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  if (currentStep === 4) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.permissionsTitle, styles.brandedTitle]}>
              🔐 App Permissions
            </ThemedText>

            <ThemedText style={styles.permissionsSubtitle}>
              {selectedStylist} will be able to give you better recommendations with access to:
            </ThemedText>

            <View style={styles.permissionCardsContainer}>
              <View style={styles.permissionCard}>
                <View style={styles.permissionHeader}>
                  <View style={styles.permissionIcon}>
                    <ThemedText style={styles.permissionIconText}>📍</ThemedText>
                  </View>
                  <View style={styles.permissionInfo}>
                    <ThemedText style={styles.permissionTitle}>Location Access</ThemedText>
                    <ThemedText style={styles.permissionDescription}>
                      Know your location to get local weather and suggest appropriate clothing
                    </ThemedText>
                  </View>
                </View>
                <TouchableOpacity
                  style={[
                    styles.grantButton,
                    locationAccess === 'granted' && styles.grantButtonGranted,
                    locationAccess === 'denied' && styles.grantButtonDenied
                  ]}
                  onPress={handleGrantLocationAccess}
                  disabled={locationAccess !== null}
                >
                  <ThemedText style={[
                    styles.grantButtonText,
                    locationAccess === 'granted' && styles.grantButtonTextGranted,
                    locationAccess === 'denied' && styles.grantButtonTextDenied
                  ]}>
                    {locationAccess === 'granted' ? '✓ Granted' :
                     locationAccess === 'denied' ? '✗ Denied' : 'Grant Access'}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View style={styles.permissionCard}>
                <View style={styles.permissionHeader}>
                  <View style={styles.permissionIcon}>
                    <ThemedText style={styles.permissionIconText}>📅</ThemedText>
                  </View>
                  <View style={styles.permissionInfo}>
                    <ThemedText style={styles.permissionTitle}>Calendar Access</ThemedText>
                    <ThemedText style={styles.permissionDescription}>
                      Suggest outfits based on your scheduled events and activities (works with Apple Calendar, Google Calendar, and other calendar apps)
                    </ThemedText>
                  </View>
                </View>
                <TouchableOpacity
                  style={[
                    styles.grantButton,
                    calendarAccess === 'granted' && styles.grantButtonGranted,
                    calendarAccess === 'denied' && styles.grantButtonDenied
                  ]}
                  onPress={handleGrantCalendarAccess}
                  disabled={calendarAccess !== null}
                >
                  <ThemedText style={[
                    styles.grantButtonText,
                    calendarAccess === 'granted' && styles.grantButtonTextGranted,
                    calendarAccess === 'denied' && styles.grantButtonTextDenied
                  ]}>
                    {calendarAccess === 'granted' ? '✓ Granted' :
                     calendarAccess === 'denied' ? '✗ Denied' : 'Grant Access'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.navigationContainer}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setCurrentStep(selectedHelpAreas.includes('Hair') ? 3.5 : 3)}
              >
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.nextButton}
                onPress={handlePermissionsNext}
              >
                <ThemedText style={styles.nextButtonText}>
                  Next →
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </ScrollView>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  if (currentStep === 5) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 20 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.clothesTitle, styles.brandedTitle]}>
              👕 Add Your Clothes
            </ThemedText>

            <ThemedText style={styles.clothesSubtitle}>
              Pick one of the options below to add clothes!
            </ThemedText>

            <ThemedText style={styles.clothesSubtext}>
              You can always add more later
            </ThemedText>

            <View style={styles.clothesOptionsContainer}>
              <View style={styles.manualOptionsCard}>
                <TouchableOpacity
                  style={[
                    styles.manualOption,
                    selectedImages.length > 0 && styles.manualOptionSelected
                  ]}
                  onPress={handleSelectPhotos}
                >
                  <View style={styles.manualOptionIcon}>
                    <ThemedText style={styles.manualOptionIconText}>📷</ThemedText>
                  </View>
                  <ThemedText style={styles.manualOptionTitle}>
                    {selectedImages.length > 0 ? `✓ ${selectedImages.length} ${selectedImages.length === 1 ? 'Photo' : 'Photos'} Selected` : 'Select photos from Camera Roll'}
                  </ThemedText>
                </TouchableOpacity>

                <View style={styles.manualOptionDivider} />

                <TouchableOpacity
                  style={[
                    styles.manualOption,
                    clothesUploadMethod === 'camera' && styles.manualOptionSelected
                  ]}
                  onPress={handleTakePhoto}
                >
                  <View style={styles.manualOptionIcon}>
                    <ThemedText style={styles.manualOptionIconText}>📷</ThemedText>
                  </View>
                  <ThemedText style={styles.manualOptionTitle}>
                    Take photos
                  </ThemedText>
                </TouchableOpacity>
              </View>

              {selectedImages.length > 0 && (
                <View style={styles.imageThumbnailsContainer}>
                  <ThemedText style={styles.thumbnailsTitle}>Selected Images:</ThemedText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.thumbnailsScroll}
                  >
                    {selectedImages.map((image, index) => (
                      <View key={index} style={styles.thumbnailContainer}>
                        <Image
                          source={{ uri: image.uri }}
                          style={styles.thumbnail}
                        />
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.navigationContainer}>
              <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(4)}>
                <ThemedText style={styles.backButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.nextButton}
                onPress={() => setCurrentStep(6)}
              >
                <ThemedText style={styles.nextButtonText}>
                  Next →
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </ScrollView>
        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  if (currentStep === 6) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <ThemedView style={styles.content}>
            <ThemedText type="title" style={[styles.stylistTitle, styles.brandedTitle]}>
              🎉 You{"'"}re all set!
            </ThemedText>

            <ThemedText style={styles.stylistSubtitle}>
              Let{"'"}s start building your personal style.
            </ThemedText>



            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <ThemedText style={styles.featureText}>
                  👗 Browse your closet
                </ThemedText>
              </View>
              <View style={styles.featureItem}>
                <ThemedText style={styles.featureText}>
                  💡 Get daily outfit recommendations
                </ThemedText>
              </View>
              <View style={styles.featureItem}>
                <ThemedText style={styles.featureText}>
                  ✨ Discover new styles with your stylist
                </ThemedText>
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setCurrentStep(5)}
              >
                <ThemedText style={styles.secondaryButtonText}>Back</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryButton, isCompletingOnboarding && styles.nextButtonDisabled]}
                onPress={handleFinish}
                disabled={isCompletingOnboarding}
              >
                {isCompletingOnboarding ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>Get Started</ThemedText>
                )}
              </TouchableOpacity>
            </View>

            {/* Progress dots removed as breadcrumbs are now at the top */}
          </ThemedView>
        </ScrollView>

        {/* Breadcrumb at top */}
        <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
          {[...Array(6)].map((_, index) => (
            <View
              key={index}
              style={[
                styles.breadcrumbDot,
                index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
              ]}
            />
          ))}
        </View>
      </ThemedView>
    );
  }

  // Placeholder for future steps
  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top + 20 }]}>
      <View style={{ paddingTop: 20 }}>
        <ThemedText type="title">Step {currentStep + 1}</ThemedText>
      </View>
      {/* Breadcrumb at top */}
      <View style={[styles.breadcrumbContainer, { paddingTop: insets.top + 10 }]}>
        {[...Array(6)].map((_, index) => (
          <View
            key={index}
            style={[
              styles.breadcrumbDot,
              index === currentStep ? styles.breadcrumbDotActive : styles.breadcrumbDotInactive,
            ]}
          />
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  welcomeContent: {
    alignItems: "center",
    maxWidth: 400,
    width: "100%",
  },
  authContent: {
    alignItems: "center",
    maxWidth: 400,
    width: "100%",
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 40,
  },
  content: {
    alignItems: "center",
    maxWidth: 400,
    width: "100%",
    marginTop: 0,
  },
  title: {
    textAlign: "center",
    marginBottom: 30,
  },
  description: {
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 40,
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
    fontWeight: "600",
  },
  brandedTitle: {
    color: VestiaryColors.gold,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: VestiaryColors.gold,
    marginBottom: 20,
  },
  welcomeText: {
    textAlign: "center",
    fontSize: 16,
    color: VestiaryColors.creamDark,
    marginBottom: 40,
    lineHeight: 22,
  },
  inputContainer: {
    width: "100%",
    marginBottom: 40,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 12,
    color: VestiaryColors.creamDark,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 16,
    color: VestiaryColors.cream,
  },
  gradientButton: {
    backgroundColor: VestiaryColors.gold,
    width: "100%",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 30,
  },
  stylistTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: VestiaryColors.gold,
    textAlign: "center",
    marginBottom: 8,
  },
  stylistSubtitle: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginBottom: 30,
  },
  chooseText: {
    fontSize: 18,
    fontWeight: "600",
    color: VestiaryColors.cream,
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  stylistContainer: {
    width: "100%",
    marginBottom: 30,
  },
  stylistCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
  },
  stylistCardSelected: {
    borderColor: VestiaryColors.gold,
    backgroundColor: VestiaryColors.navy,
  },
  stylistIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: VestiaryColors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  stylistIconText: {
    fontSize: 20,
    color: VestiaryColors.navyDark,
  },
  stylistInfo: {
    flex: 1,
  },
  stylistName: {
    fontSize: 16,
    fontWeight: "600",
    color: VestiaryColors.cream,
    marginBottom: 4,
  },
  stylistDescription: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    lineHeight: 20,
  },
  navigationContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 30,
  },
  fixedBottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: VestiaryColors.navy,
    borderTopWidth: 1,
    borderTopColor: VestiaryColors.navyLight,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  backButtonText: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    fontWeight: "500",
  },
  nextButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: VestiaryColors.gold,
  },
  nextButtonDisabled: {
    backgroundColor: VestiaryColors.navyLight,
  },
  nextButtonText: {
    fontSize: 16,
    color: VestiaryColors.navyDark,
    fontWeight: "600",
  },
  nextButtonTextDisabled: {
    color: VestiaryColors.creamDark,
  },
  helpTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: VestiaryColors.gold,
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  helpSubtitle: {
    fontSize: 17,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginBottom: 36,
  },
  helpAreasContainer: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 36,
  },
  helpAreaButton: {
    width: "48%",
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 18,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  helpAreaButtonSelected: {
    borderColor: VestiaryColors.gold,
    backgroundColor: VestiaryColors.navy,
    shadowColor: VestiaryColors.gold,
    shadowOpacity: 0.12,
  },
  helpAreaText: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    fontWeight: "600",
  },
  helpAreaTextSelected: {
    color: VestiaryColors.gold,
    fontWeight: "700",
  },
  permissionsTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: VestiaryColors.gold,
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  permissionsSubtitle: {
    fontSize: 17,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginBottom: 36,
    lineHeight: 26,
  },
  permissionCardsContainer: {
    width: "100%",
    marginBottom: 36,
  },
  permissionCard: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 18,
    padding: 24,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  },
  permissionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  permissionIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: VestiaryColors.navy,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 18,
    overflow: "visible",
  },
  permissionIconText: {
    fontSize: 28,         // emoji font size
    lineHeight: 70,       // match container height for perfect centering
    textAlign: "center",
    textAlignVertical: "center", // Android-specific
    includeFontPadding: false,   // Android-specific, fixes vertical padding issues
    height: 70,           // explicitly match container height
  },
  permissionInfo: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: VestiaryColors.cream,
    marginBottom: 8,
  },
  permissionDescription: {
    fontSize: 15,
    color: VestiaryColors.creamDark,
    lineHeight: 22,
  },
  grantButton: {
    backgroundColor: VestiaryColors.gold,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: VestiaryColors.gold,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  grantButtonGranted: {
    backgroundColor: VestiaryColors.success,
    shadowColor: VestiaryColors.success,
  },
  grantButtonDenied: {
    backgroundColor: VestiaryColors.error,
    shadowColor: VestiaryColors.error,
  },
  grantButtonText: {
    color: VestiaryColors.navyDark,
    fontSize: 17,
    fontWeight: "600",
  },
  grantButtonTextGranted: {
    color: "white",
  },
  grantButtonTextDenied: {
    color: "white",
  },
  permissionButtonContainer: {
    gap: 12,
  },
  primaryPermissionButton: {
    marginBottom: 0,
  },
  skipButton: {
    backgroundColor: "transparent",
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
  },
  skipButtonText: {
    color: VestiaryColors.creamDark,
    fontSize: 16,
    fontWeight: "600",
  },
  clothesTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: VestiaryColors.gold,
    textAlign: "center",
    marginBottom: 8,
  },
  clothesSubtitle: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginBottom: 4,
  },
  clothesSubtext: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginBottom: 30,
  },
  clothesOptionsContainer: {
    width: "100%",
    marginBottom: 30,
  },
  cameraRollSection: {
    marginBottom: 20,
  },
  cameraRollCard: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    borderStyle: "dashed",
  },
  cameraRollIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: VestiaryColors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  cameraRollIconText: {
    fontSize: 24,
    color: VestiaryColors.navyDark,
  },
  cameraRollTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: VestiaryColors.cream,
    textAlign: "center",
    marginBottom: 8,
  },
  cameraRollDescription: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  orText: {
    fontSize: 16,
    fontWeight: "600",
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginVertical: 20,
  },
  manualOptionsCard: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  manualOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
  },
  manualOptionSelected: {
    backgroundColor: VestiaryColors.navy,
  },
  manualOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: VestiaryColors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  manualOptionIconText: {
    fontSize: 20,
    color: VestiaryColors.navyDark,
    fontWeight: "600",
  },
  manualOptionTitle: {
    flex: 1,
    fontSize: 16,
    color: VestiaryColors.cream,
    fontWeight: "500",
    lineHeight: 22,
  },
  manualOptionDivider: {
    height: 1,
    backgroundColor: VestiaryColors.navy,
    marginHorizontal: -20,
  },
  laterButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: VestiaryColors.gold,
  },
  laterButtonText: {
    fontSize: 16,
    color: VestiaryColors.navyDark,
    fontWeight: "600",
  },
  genderOptionsContainer: {
    width: "100%",
    marginBottom: 36,
    gap: 16,
  },
  genderOption: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 24,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  genderOptionSelected: {
    borderColor: VestiaryColors.gold,
    backgroundColor: VestiaryColors.navy,
    shadowColor: VestiaryColors.gold,
    shadowOpacity: 0.12,
  },
  genderOptionText: {
    fontSize: 17,
    color: VestiaryColors.creamDark,
    fontWeight: "600",
  },
  genderOptionTextSelected: {
    color: VestiaryColors.gold,
    fontWeight: "700",
  },
  imageThumbnailsContainer: {
    width: "100%",
    marginTop: 20,
    alignItems: "center",
    paddingHorizontal: 15,
  },
  thumbnailsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: VestiaryColors.cream,
    marginBottom: 15,
  },
  thumbnailsScroll: {
    width: "100%",
    paddingVertical: 15,
    paddingHorizontal: 5,
  },
  thumbnailContainer: {
    marginRight: 15,
    borderRadius: 40,
    overflow: "visible",
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    backgroundColor: VestiaryColors.navyLight,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 38,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginTop: 20,
    marginBottom: 30,
  },
  secondaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  secondaryButtonText: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    fontWeight: "500",
  },
  primaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: VestiaryColors.gold,
  },
  primaryButtonText: {
    fontSize: 16,
    color: VestiaryColors.navyDark,
    fontWeight: "600",
  },
  analysisContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  analysisText: {
    fontSize: 18,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 10,
  },
  progressText: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    marginBottom: 5,
  },
  detectedText: {
    fontSize: 16,
    color: VestiaryColors.gold,
    fontWeight: '600',
  },
  featuresList: {
    marginVertical: 30,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  featureText: {
    fontSize: 16,
    color: VestiaryColors.cream,
    marginLeft: 15,
    flex: 1,
  },
  breadcrumbContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 12,
    backgroundColor: VestiaryColors.navy,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navyLight,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  breadcrumbDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  breadcrumbDotActive: {
    backgroundColor: VestiaryColors.gold,
  },
  breadcrumbDotInactive: {
    backgroundColor: VestiaryColors.navyLight,
  },
  backgroundAnalysisBar: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    backgroundColor: VestiaryColors.navyLight,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navyLight,
    zIndex: 5,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backgroundAnalysisContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  backgroundAnalysisText: {
    fontSize: 14,
    color: VestiaryColors.gold,
    fontWeight: '500',
  },
  analysisNotice: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    padding: 16,
    marginVertical: 20,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  analysisNoticeText: {
    fontSize: 14,
    color: VestiaryColors.cream,
    textAlign: 'center',
    lineHeight: 20,
  },
  hairProfileContainer: {
    width: '100%',
    marginBottom: 30,
  },
  hairProfileLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginTop: 20,
    marginBottom: 12,
  },
  hairOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  hairOptionButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    backgroundColor: VestiaryColors.navyLight,
  },
  hairOptionButtonSelected: {
    borderColor: VestiaryColors.gold,
    backgroundColor: VestiaryColors.navy,
  },
  hairOptionText: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    fontWeight: '500',
  },
  hairOptionTextSelected: {
    color: VestiaryColors.gold,
    fontWeight: '600',
  },
  hairStyleInput: {
    width: '100%',
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: VestiaryColors.cream,
  },
  makeupToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 30,
    marginBottom: 30,
  },
  makeupToggleButton: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    backgroundColor: VestiaryColors.navyLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  makeupToggleButtonActive: {
    borderColor: VestiaryColors.gold,
    backgroundColor: VestiaryColors.navy,
  },
  makeupToggleText: {
    fontSize: 18,
    fontWeight: '600',
    color: VestiaryColors.creamDark,
  },
  makeupToggleTextActive: {
    color: VestiaryColors.gold,
  },
  makeupLevelContainer: {
    width: '100%',
    marginBottom: 30,
  },
  makeupLevelTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 16,
    textAlign: 'center',
  },
  makeupLevelButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  makeupLevelButton: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    backgroundColor: VestiaryColors.navyLight,
    alignItems: 'center',
  },
  makeupLevelButtonActive: {
    borderColor: '#EC4899',
    backgroundColor: VestiaryColors.navy,
  },
  makeupLevelEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  makeupLevelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.creamDark,
    marginBottom: 4,
  },
  makeupLevelButtonTextActive: {
    color: '#EC4899',
  },
  makeupLevelDescription: {
    fontSize: 11,
    color: VestiaryColors.creamDark,
    opacity: 0.7,
  },
});
