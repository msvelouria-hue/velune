import React, { useState, useEffect, useRef } from "react";
import { StyleSheet, TouchableOpacity, View, TextInput, ScrollView, Alert, Image, ActivityIndicator, Modal } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { Provider, Chip } from 'react-native-paper';
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import { clothingDetection, DetectedClothingItem } from '@/utils/clothingDetection';
import { createBackgroundRemovalService } from '@/utils/backgroundRemoval';
import { photoValidation, UploadStatus, PhotoValidationResult } from '@/utils/photoValidation';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { VestiaryColors } from '@/constants/Colors';

const CategoryDropdown = ({
  category,
  setCategory,
}: {
  category: string;
  setCategory: (value: string) => void;
}) => {
  const [visible, setVisible] = useState(false);

  const openMenu = () => {
    console.log('Opening category menu, current category:', category);
    setVisible(true);
  };

  const closeMenu = () => {
    console.log('Closing category menu');
    setVisible(false);
  };

  const items = [
    "Tops",
    "Bottoms",
    "Dresses",
    "Outerwear",
    "Shoes",
    "Accessories",
  ];

  const handleItemSelect = (item: string) => {
    console.log('Selected category:', item);
    setCategory(item);
    closeMenu();
  };

  return (
    <View style={styles.dropdownContainer}>
      <TouchableOpacity
        style={styles.customDropdownButton}
        onPress={openMenu}
        activeOpacity={0.7}
      >
        <ThemedText style={styles.customDropdownText}>
          {category || "Select a category"}
        </ThemedText>
        <IconSymbol
          name="chevron.down"
          size={20}
          color={VestiaryColors.creamDark}
          style={visible ? styles.chevronUp : styles.chevronDown}
        />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={closeMenu}
        >
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownContent}>
              <ThemedText style={styles.dropdownTitle}>Select Category</ThemedText>
              {items.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.dropdownOption,
                    category === item && styles.selectedOption
                  ]}
                  onPress={() => handleItemSelect(item)}
                >
                  <ThemedText style={[
                    styles.dropdownOptionText,
                    category === item && styles.selectedOptionText
                  ]}>
                    {item}
                  </ThemedText>
                  {category === item && (
                    <IconSymbol name="checkmark" size={18} color={VestiaryColors.gold} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const TagSelector = ({
  title,
  options,
  selectedTags,
  onToggle
}: {
  title: string;
  options: string[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
}) => (
  <View style={styles.tagSection}>
    <ThemedText style={styles.tagSectionTitle}>{title}</ThemedText>
    <View style={styles.tagChips}>
      {options.map((tag) => (
        <Chip
          key={tag}
          selected={selectedTags.includes(tag)}
          onPress={() => onToggle(tag)}
          style={[
            styles.tagChip,
            selectedTags.includes(tag) && styles.tagChipSelected
          ]}
          textStyle={[
            styles.tagChipText,
            selectedTags.includes(tag) && styles.tagChipTextSelected
          ]}
        >
          {tag}
        </Chip>
      ))}
    </View>
  </View>
);

export default function AddClothingItemScreen() {
  const { photoUri, manualEntry } = useLocalSearchParams<{ photoUri?: string; manualEntry?: string }>();
  const [photo, setPhoto] = useState<string | null>(photoUri || null);
  const [processedPhoto, setProcessedPhoto] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [pattern, setPattern] = useState("");
  const [material, setMaterial] = useState("");
  const [style, setStyle] = useState("");
  const [notes, setNotes] = useState("");
  const [seasonTags, setSeasonTags] = useState<string[]>([]);
  const [eventTags, setEventTags] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedItems, setDetectedItems] = useState<DetectedClothingItem[]>([]);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [validationResult, setValidationResult] = useState<PhotoValidationResult | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  const notesInputRef = useRef<TextInput>(null);



  // Initialize background removal service
  const backgroundRemovalService = React.useMemo(() => {
    // Use Firebase Cloud Function for background removal (API key stored securely server-side)
    console.log('🔧 Using Firebase background removal service (secure proxy)');
    return createBackgroundRemovalService('firebase');
  }, []);

  // Process image if photo is provided via navigation params
  React.useEffect(() => {
    if (photo && !processedPhoto && !isProcessing) {
      // Skip AI processing if this is a manual entry
      if (manualEntry === 'true') {
        setProcessedPhoto(photo);
        setNotes('Manual entry - describe another item from this photo');
      } else {
        processImage(photo);
      }
    }
  }, [photo, manualEntry]);

  const handlePhotoUpload = () => {
    Alert.alert(
      "Add Photo",
      "Choose how you'd like to add a photo",
      [
        {
          text: "Camera",
          onPress: handleTakePhoto,
        },
        {
          text: "Gallery",
          onPress: handlePickFromGallery,
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
          const imageUri = result.assets[0].uri;
          setPhoto(imageUri);
          await processImage(imageUri);
        }
      } else {
        Alert.alert("Permission Denied", "Camera access is required to take photos.");
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert("Error", "Failed to take photo. Please try again.");
    }
  };

  const handlePickFromGallery = async () => {
    try {
      // Request media library permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status === 'granted') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets[0]) {
          const imageUri = result.assets[0].uri;
          setPhoto(imageUri);
          await processImage(imageUri);
        }
      } else {
        Alert.alert("Permission Denied", "Gallery access is required to select photos.");
      }
    } catch (error) {
      console.error('Error picking from gallery:', error);
      Alert.alert("Error", "Failed to select photo. Please try again.");
    }
  };

  const toggleSeasonTag = (tag: string) => {
    setSeasonTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleEventTag = (tag: string) => {
    setEventTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const applyDetectedItemToForm = (item: DetectedClothingItem, validatedItems?: string[]) => {
    const metadata = clothingDetection.buildAutoDetectedMetadata(item);
    const validatedNote = validatedItems && validatedItems.length > 0
      ? `\nAI validated: ${validatedItems.join(', ')}`
      : '';

    setCategory(getCategoryFromDetectedType(item.detectedType));
    setColor(metadata.color || extractColorFromName(item.name));
    setPattern(metadata.pattern || 'Solid');
    setMaterial(metadata.material || '');
    setStyle(metadata.style || extractStyleFromName(item.name));
    setNotes(`${metadata.notes || ''}${validatedNote}`.trim());
    setSeasonTags(metadata.tags?.season || []);
    setEventTags(metadata.tags?.event || []);
  };

  const processImage = async (imageUri: string) => {
    try {
      setIsProcessing(true);
      setValidationResult(null);

      // Step 1: Store photo locally with "Uploading" status
      setUploadStatus({
        status: 'uploading',
        message: 'Storing photo locally...',
        progress: 10
      });

      // Simulate local storage time
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 2: Set photo and allow user to continue immediately
      setProcessedPhoto(imageUri);
      setUploadStatus({
        status: 'done',
        message: 'Photo uploaded! Fill out the form and save.',
        progress: 100
      });

      setIsProcessing(false);

      // Clear status after 2 seconds
      setTimeout(() => setUploadStatus(null), 2000);

      // Step 3: Start background AI processing (don't await)
      processImageInBackground(imageUri);

    } catch (error) {
      console.error('Error processing image:', error);
      setUploadStatus({
        status: 'error',
        message: 'Failed to process image. Please try again.',
        progress: 100
      });

      Alert.alert('Processing Failed', 'Could not process the image. You can still add the item manually.');
      setProcessedPhoto(imageUri); // Use original image as fallback
      setIsProcessing(false);
      // Clear status after 3 seconds
      setTimeout(() => setUploadStatus(null), 3000);
    }
  };

  const processImageInBackground = async (imageUri: string) => {
    try {
      console.log('Starting background AI processing for:', imageUri.substring(0, 50) + '...');

      // Set evaluating status
      setUploadStatus({
        status: 'evaluating',
        message: 'AI is analyzing the image...',
        progress: 50
      });

      // Start background removal in parallel (non-blocking)
      console.log('🎨 Starting background removal (non-blocking)...');
      const backgroundRemovalPromise = backgroundRemovalService.removeBackground(imageUri)
        .then(result => {
          console.log('🎨 Background removal completed!');
          return { success: true, photo: result };
        })
        .catch(error => {
          console.error('❌ Background removal failed:', error.message);
          return { success: false, photo: imageUri };
        });

      // Run AI detection and validation first - these determine when we update the form
      console.log('🔍 Starting AI detection (primary)...');
      const [validation, detected] = await Promise.all([
        photoValidation.validateClothingPhoto(imageUri).catch(() => ({ isValid: true, clothingItems: [], message: 'Basic validation' })),
        clothingDetection.detectClothingInImage(imageUri).catch(() => [])
      ]);

      console.log(`✅ AI detection complete: ${detected.length} items detected`);

      // Update form immediately with AI results
      if (detected.length > 1) {
        await autoAddMultipleItems(detected, imageUri, validation.clothingItems);
      } else if (detected.length === 1) {
        const item = detected[0];
        setDetectedItems([item]);
        applyDetectedItemToForm(item, validation.clothingItems);

        console.log('AI detected single item:', item.name);
      }

      setValidationResult(validation);

      const needsClarification =
        detected.some((item) => item.needsAttention) ||
        !validation.isValid;

      // Update status to show AI analysis outcome
      setUploadStatus({
        status: needsClarification ? 'needs_clarification' : 'done',
        message: needsClarification
          ? 'Photo needs review before saving.'
          : 'AI analysis complete, processing background...',
        progress: 80
      });

      // Now wait for background removal to complete and update photo
      backgroundRemovalPromise.then((bgResult) => {
        if (bgResult.success && bgResult.photo !== imageUri) {
          setProcessedPhoto(bgResult.photo);
          console.log('✅ Background removed successfully, photo updated');

          setUploadStatus({
            status: 'done',
            message: 'Photo processed with background removed!',
            progress: 100
          });
        } else {
          console.warn('⚠️ Background removal failed or returned original image');

          setUploadStatus({
            status: 'done',
            message: 'Photo uploaded (background removal unavailable)',
            progress: 100
          });
        }

        // Clear status after 2 seconds
        setTimeout(() => setUploadStatus(null), 2000);
      });

    } catch (error) {
      console.error('Background AI processing failed:', error);

      setUploadStatus({
        status: 'error',
        message: 'AI processing failed, but you can still save the item',
        progress: 100
      });

      setTimeout(() => setUploadStatus(null), 3000);
    }
  };

  const proceedWithImage = async (imageUri: string, detected: DetectedClothingItem[], validatedItems?: string[]) => {
    if (detected.length === 0) {
      // No specific clothing detected, treat the whole image as one item
      try {
        const processedUri = await backgroundRemovalService.removeBackground(imageUri);
        setProcessedPhoto(processedUri);

        // Use validated items if available
        if (validatedItems && validatedItems.length > 0) {
          const detectedCategory = getCategoryFromDetectedType(validatedItems[0]);
          setCategory(detectedCategory);
          setNotes(`AI identified: ${validatedItems.join(', ')}`);
          console.log(`Auto-selected category: ${detectedCategory} for detected item: ${validatedItems[0]}`);
        } else {
          setCategory('Tops'); // Default to a common category
          setNotes('Manually uploaded item');
        }
      } catch (bgError) {
        console.error('Background removal failed:', bgError);
        setProcessedPhoto(imageUri); // Use original if background removal fails
      }
    } else if (detected.length === 1) {
      // Single item detected - proceed normally
      setDetectedItems(detected);
      setSelectedItemIndex(0);

      // Auto-fill form with the detected item
      const item = detected[0];
      setProcessedPhoto(item.thumbnail);
      applyDetectedItemToForm(item, validatedItems);
    } else {
      // Multiple items detected - auto-add all items
      await autoAddMultipleItems(detected, imageUri, validatedItems);
    }
  };

  const autoAddMultipleItems = async (detectedItems: DetectedClothingItem[], originalImageUri: string, validatedItems?: string[]) => {
    try {
      const newItems = [];
      const { cloudSyncService } = await import('@/utils/cloudSyncService');

      for (const item of detectedItems) {
        const metadata = clothingDetection.buildAutoDetectedMetadata(item);
        const validationNote = validatedItems && validatedItems.length > 0
          ? `\nAI validated: ${validatedItems.join(', ')}`
          : '';

        const newItem = {
          id: item.id,
          photo: item.thumbnail,
          category: getCategoryFromDetectedType(item.detectedType),
          ...metadata,
          color: metadata.color || extractColorFromName(item.name),
          pattern: metadata.pattern || 'Solid',
          material: metadata.material || '',
          style: metadata.style || extractStyleFromName(item.name),
          notes: `${metadata.notes || ''}${validationNote}`.trim(),
          dateAdded: new Date().toISOString(),
          isAutoDetected: true,
          originalPhoto: originalImageUri,
          photoStatus: 'done',
        };

        newItems.push(newItem);
      }

      for (const newItem of newItems) {
        const cloudItem = await cloudSyncService.syncItemToCloud(newItem);
        if (!cloudItem) {
          throw new Error(`Could not save detected item ${newItem.id} to Firestore`);
        }
      }

      if (global.onItemsUpdated) {
        global.onItemsUpdated();
      }

      Alert.alert(
        "Success!",
        `Added ${detectedItems.length} clothing items to your closet automatically!`,
        [
          {
            text: "View Items",
            onPress: () => router.replace("/(tabs)")
          },
          {
            text: "Add More From This Photo",
            onPress: () => {
              // Stay on this screen for manual entry
              setPhoto(originalImageUri);
              setProcessedPhoto(originalImageUri);
              setDetectedItems([]);
              setCategory('');
              setColor('');
              setPattern('');
              setMaterial('');
              setStyle('');
              setNotes('Manual entry from multi-item photo');
              setSeasonTags([]);
              setEventTags([]);
            }
          }
        ]
      );

    } catch (error) {
      console.error("Error auto-adding multiple items:", error);
      Alert.alert("Error", "Failed to save some items");
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

  const switchDetectedItem = (index: number) => {
    if (detectedItems.length === 0 || index >= detectedItems.length) return;

    const item = detectedItems[index];
    setSelectedItemIndex(index);
    setProcessedPhoto(item.thumbnail);
    applyDetectedItemToForm(item);
  };

  const handleSave = async () => {
    try {
      // Validate required data
      if (!photo && !processedPhoto) {
        Alert.alert("Error", "Please add a photo first");
        return;
      }

      // If category is empty, set a default
      const finalCategory = category || 'Uncategorized';

      console.log('Saving new item to Firebase...');

      // Generate a unique item ID
      const itemId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const photoToUpload = processedPhoto || photo;
      const selectedDetectedItem = detectedItems[selectedItemIndex] || detectedItems[0];
      const detectedMetadata = selectedDetectedItem
        ? clothingDetection.buildAutoDetectedMetadata(selectedDetectedItem)
        : {};
      const finalSeasonTags = seasonTags.length > 0 ? seasonTags : detectedMetadata.tags?.season || [];
      const finalEventTags = eventTags.length > 0 ? eventTags : detectedMetadata.tags?.event || [];

      // Use cloudSyncService for unified upload + Firestore save
      const { cloudSyncService } = await import('@/utils/cloudSyncService');

      const itemData = {
        id: itemId,
        photo: photoToUpload,
        ...detectedMetadata,
        category: finalCategory,
        color: color || detectedMetadata.color || '',
        pattern: pattern || detectedMetadata.pattern || '',
        material: material || detectedMetadata.material || '',
        style: style || detectedMetadata.style || '',
        notes: notes || detectedMetadata.notes || '',
        tags: {
          season: finalSeasonTags,
          event: finalEventTags,
        },
        dateAdded: new Date().toISOString(),
        isAutoDetected: detectedItems.length > 0,
        photoStatus: 'done',
      };

      const cloudItem = await cloudSyncService.syncItemToCloud(itemData);
      if (!cloudItem) {
        throw new Error('Failed to save item to cloud');
      }
      console.log('✅ Item saved to Firestore with ID:', itemId);

      const newItem = {
        id: itemId,
        photo: cloudItem.imageUrl || photoToUpload,
        ...detectedMetadata,
        category: finalCategory,
        color: color || detectedMetadata.color || '',
        pattern: pattern || detectedMetadata.pattern || '',
        material: material || detectedMetadata.material || '',
        style: style || detectedMetadata.style || '',
        notes: notes || detectedMetadata.notes || '',
        dateAdded: new Date().toISOString(),
        tags: {
          season: finalSeasonTags,
          event: finalEventTags,
        },
        isAutoDetected: detectedItems.length > 0,
        originalPhoto: photo,
        photoStatus: 'done',
      };

      // Queue for background AI processing if we have a photo and this wasn't already AI-processed
      if (photo && detectedItems.length === 0) {
        try {
          const { backgroundAIService } = await import('@/utils/backgroundAIService');
          await backgroundAIService.queueItemForAI(newItem.id, photo);
          console.log('🔄 Queued item for background AI processing');
        } catch (aiError) {
          console.warn('Failed to queue for background AI processing:', aiError);
          // Don't fail the save if background processing fails
        }
      }

      if (global.onItemsUpdated) {
        global.onItemsUpdated();
      }

      // Use replace to go directly to closet tab
      Alert.alert("Success!", "Item added to your closet", [
        {
          text: "OK",
          onPress: () => {
            // Add a small delay to ensure the alert dismisses properly
            setTimeout(() => {
              // For manual entries from existing photos, use back() to return to closet properly
              if (manualEntry === 'true') {
                router.back();
              } else {
                router.replace("/(tabs)");
              }
            }, 100);
          }
        }
      ]);

    } catch (error) {
      console.error("❌ Error saving item:", error);
      Alert.alert("Error", "Unable to add item. Please try again.");
    }
  };

  const handleCancel = () => {
    // For manual entries from existing photos, use back() to return properly
    if (manualEntry === 'true') {
      router.back();
    } else {
      // Navigate to closet instead of going back to avoid navigation issues
      router.replace("/(tabs)");
    }
  };

  // Handler for duplicating a photo for another entry
  const handleDuplicatePhoto = (originalPhotoUri: string) => {
    router.push({
      pathname: "/add-clothing-item",
      params: { photoUri: originalPhotoUri },
    });
  };

  // Handler to describe another item from the same photo (manual entry)
  const handleDescribeAnother = (originalPhotoUri: string) => {
    // Navigate to a new manual entry screen with the same photo
    router.push({
      pathname: "/add-clothing-item",
      params: {
        photoUri: originalPhotoUri,
        manualEntry: 'true'
      }
    });
  };

  return (
    <Provider>
      <ThemedView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
            <IconSymbol name="xmark" size={24} color="#666" />
          </TouchableOpacity>
          <ThemedText style={styles.title}>Add Item</ThemedText>
          <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
            <ThemedText style={styles.saveButtonText}>Save</ThemedText>
          </TouchableOpacity>
        </View>

        <KeyboardAwareScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          extraScrollHeight={150}
          keyboardShouldPersistTaps="handled"
          enableOnAndroid={true}
          enableAutomaticScroll={true}
          enableResetScrollToCoords={false}
          keyboardOpeningTime={0}
          resetScrollToCoords={{ x: 0, y: 0 }}
          scrollEventThrottle={1}
          extraHeight={120}
        >
          {/* Photo Upload */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Photo</ThemedText>
            <TouchableOpacity style={styles.photoUpload} onPress={handlePhotoUpload} disabled={isProcessing}>
              {photo ? (
                <View style={styles.photoPreview}>
                  {isProcessing ? (
                    <View style={styles.processingContainer}>
                      <ActivityIndicator size="large" color="#B565D8" />
                      <ThemedText style={styles.processingText}>
                        {uploadStatus?.message || 'Processing image...'}
                      </ThemedText>
                      <ThemedText style={styles.processingSubtext}>
                        {uploadStatus?.status === 'uploading' && 'Storing photo locally'}
                        {uploadStatus?.status === 'evaluating' && 'Validating with AI assistant'}
                        {uploadStatus?.status === 'done' && 'Analysis complete'}
                        {uploadStatus?.status === 'needs_clarification' && 'Photo needs review'}
                        {uploadStatus?.status === 'error' && 'Please try again'}
                        {!uploadStatus && 'Detecting clothing and removing background'}
                      </ThemedText>
                      {uploadStatus?.progress && (
                        <View style={styles.progressBar}>
                          <View
                            style={[styles.progressFill, { width: `${uploadStatus.progress}%` }]}
                          />
                        </View>
                      )}
                    </View>
                  ) : (
                    <>
                      <Image
                        source={{ uri: processedPhoto || photo }}
                        style={styles.photoImage}
                      />

                      {/* Validation Results */}
                      {validationResult && validationResult.isValid && (
                        <View style={styles.validationResults}>
                          <ThemedText style={styles.validationText}>
                            ✅ AI Validated: {validationResult.clothingItems.join(', ')}
                          </ThemedText>
                        </View>
                      )}

                      {/* Detection Results - only shown for single items */}
                      {detectedItems.length === 1 && (
                        <View style={styles.detectionResults}>
                          <ThemedText style={styles.detectionText}>
                            ✅ Auto-detected: {detectedItems[0].detectedType} ({Math.round(detectedItems[0].confidence * 100)}% confidence)
                          </ThemedText>
                        </View>
                      )}



                      {/* Describe Another Item Section - only show if not already in manual entry mode */}
                      {photo && !isProcessing && manualEntry !== 'true' && (
                        <View style={styles.describeAnotherSection}>
                          <TouchableOpacity
                            style={styles.describeAnotherButton}
                            onPress={() => handleDescribeAnother(photo!)}
                          >
                            <IconSymbol name="plus.circle" size={18} color="#B565D8" />
                            <ThemedText style={styles.describeAnotherText}>
                              Describe another item in this photo
                            </ThemedText>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Duplicate Photo Section for "Needs Attention" */}
                      {uploadStatus?.status === 'needs_clarification' && (
                        <View style={styles.duplicateInfoBanner}>
                          <IconSymbol name="exclamationmark.triangle" size={20} color="#1e40af" />
                          <ThemedText style={styles.duplicateInfoText}>
                            This item needs attention. You can describe it, delete it, replace the photo, or duplicate this photo for another entry.
                          </ThemedText>
                          <TouchableOpacity onPress={() => handleDuplicatePhoto(photo!)}>
                            <ThemedText style={{ color: '#2563eb', fontWeight: '600' }}>Duplicate Photo</ThemedText>
                          </TouchableOpacity>
                        </View>
                      )}
                    </>
                  )}
                </View>
              ) : (
                <View style={styles.photoPlaceholder}>
                  <IconSymbol name="camera.fill" size={40} color="#B565D8" />
                  <ThemedText style={styles.photoText}>Tap to add photo</ThemedText>
                  <ThemedText style={styles.photoSubtext}>Camera or Gallery</ThemedText>
                  <ThemedText style={styles.photoSubtext}>Auto-detects clothing & removes background</ThemedText>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Category */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>
              {manualEntry === 'true' ? 'Category' : 'Category (AI will auto-categorize if left blank)'}
            </ThemedText>
            <CategoryDropdown category={category} setCategory={setCategory} />
          </View>

          {/* Color */}
          <View style={styles.section}>
            <View style={styles.fieldHeader}>
              <ThemedText style={styles.sectionTitle}>Color</ThemedText>
              {detectedItems.length > 0 && detectedItems[0].detailedDescription?.color && (
                <TouchableOpacity
                  style={styles.aiSuggestButton}
                  onPress={() => setColor(detectedItems[0].detailedDescription!.color)}
                >
                  <IconSymbol name="sparkles" size={16} color="#B565D8" />
                  <ThemedText style={styles.aiSuggestText}>
                    Use AI: {detectedItems[0].detailedDescription.color}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.input}
              value={color}
              onChangeText={setColor}
              placeholder="e.g., Navy Blue, Red, Black..."
              placeholderTextColor="#999"
            />
          </View>

          {/* Pattern */}
          <View style={styles.section}>
            <View style={styles.fieldHeader}>
              <ThemedText style={styles.sectionTitle}>Pattern</ThemedText>
              {detectedItems.length > 0 && detectedItems[0].detailedDescription?.pattern && (
                <TouchableOpacity
                  style={styles.aiSuggestButton}
                  onPress={() => setPattern(detectedItems[0].detailedDescription!.pattern)}
                >
                  <IconSymbol name="sparkles" size={16} color="#B565D8" />
                  <ThemedText style={styles.aiSuggestText}>
                    Use AI: {detectedItems[0].detailedDescription.pattern}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.input}
              value={pattern}
              onChangeText={setPattern}
              placeholder="e.g., Solid, Striped, Floral..."
              placeholderTextColor="#999"
            />
          </View>

          {/* Material */}
          <View style={styles.section}>
            <View style={styles.fieldHeader}>
              <ThemedText style={styles.sectionTitle}>Material</ThemedText>
              {detectedItems.length > 0 && detectedItems[0].detailedDescription?.material && (
                <TouchableOpacity
                  style={styles.aiSuggestButton}
                  onPress={() => setMaterial(detectedItems[0].detailedDescription!.material)}
                >
                  <IconSymbol name="sparkles" size={16} color="#B565D8" />
                  <ThemedText style={styles.aiSuggestText}>
                    Use AI: {detectedItems[0].detailedDescription.material}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.input}
              value={material}
              onChangeText={setMaterial}
              placeholder="e.g., Cotton, Wool, Denim..."
              placeholderTextColor="#999"
            />
          </View>

          {/* Style */}
          <View style={styles.section}>
            <View style={styles.fieldHeader}>
              <ThemedText style={styles.sectionTitle}>Style</ThemedText>
              {detectedItems.length > 0 && detectedItems[0].detailedDescription?.style && (
                <TouchableOpacity
                  style={styles.aiSuggestButton}
                  onPress={() => setStyle(detectedItems[0].detailedDescription!.style)}
                >
                  <IconSymbol name="sparkles" size={16} color="#B565D8" />
                  <ThemedText style={styles.aiSuggestText}>
                    Use AI: {detectedItems[0].detailedDescription.style}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.input}
              value={style}
              onChangeText={setStyle}
              placeholder="e.g., Casual, Formal, Athletic..."
              placeholderTextColor="#999"
            />
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <View style={styles.fieldHeader}>
              <ThemedText style={styles.sectionTitle}>Notes (Optional)</ThemedText>
              {detectedItems.length > 0 && detectedItems[0].detailedDescription?.details && (
                <TouchableOpacity
                  style={styles.aiSuggestButton}
                  onPress={() => {
                    const item = detectedItems[0];
                    setNotes(clothingDetection.buildAutoDetectedNotes(item));
                  }}
                >
                  <IconSymbol name="sparkles" size={16} color="#B565D8" />
                  <ThemedText style={styles.aiSuggestText}>
                    Use AI details
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              ref={notesInputRef}
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional details..."
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              scrollEnabled={false}
              blurOnSubmit={false}
            />
          </View>

          {/* Tags */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Tags</ThemedText>
            <TagSelector
              title="Season"
              options={['Spring', 'Summer', 'Fall', 'Winter']}
              selectedTags={seasonTags}
              onToggle={toggleSeasonTag}
            />
            <TagSelector
              title="Event"
              options={['Casual', 'Formal', 'Athletic', 'Party']}
              selectedTags={eventTags}
              onToggle={toggleEventTag}
            />
          </View>

          <View style={styles.bottomPadding} />
        </KeyboardAwareScrollView>
      </ThemedView>
    </Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navyLight,
    backgroundColor: VestiaryColors.navy,
  },
  cancelButton: {
    padding: 5,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  saveButton: {
    backgroundColor: VestiaryColors.gold,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  saveButtonText: {
    color: VestiaryColors.navyDark,
    fontSize: 16,
    fontWeight: "700",
  },
  duplicateInfoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 24,
    marginBottom: 8,
    borderRadius: 8,
    gap: 8,
  },
  duplicateInfoText: {
    flex: 1,
    fontSize: 14,
    color: VestiaryColors.gold,
    fontWeight: '500',
  },
  describeAnotherSection: {
    marginTop: 16,
    marginBottom: 12,
    marginHorizontal: 24,
    alignItems: 'center',
  },
  describeAnotherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VestiaryColors.gold,
    gap: 8,
  },
  describeAnotherText: {
    fontSize: 14,
    color: VestiaryColors.gold,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: VestiaryColors.cream,
  },
  photoUpload: {
    borderWidth: 2,
    borderColor: VestiaryColors.navyLight,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
  },
  photoPlaceholder: {
    alignItems: 'center',
  },
  photoPreview: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  photoImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  changePhotoButton: {
    backgroundColor: VestiaryColors.gold,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  changePhotoText: {
    color: VestiaryColors.navyDark,
    fontSize: 14,
    fontWeight: '600',
  },
  processingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  processingText: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginTop: 12,
  },
  processingSubtext: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginTop: 4,
    textAlign: 'center',
  },
  progressBar: {
    width: 200,
    height: 4,
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 2,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: VestiaryColors.gold,
    borderRadius: 2,
  },
  validationResults: {
    marginTop: 8,
    marginBottom: 8,
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VestiaryColors.success,
  },
  validationText: {
    fontSize: 13,
    fontWeight: '600',
    color: VestiaryColors.success,
    textAlign: 'center',
  },
  detectionResults: {
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  detectionText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.gold,
    marginBottom: 8,
  },
  itemSelector: {
    maxHeight: 40,
  },
  itemSelectorButton: {
    backgroundColor: VestiaryColors.navyLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  itemSelectorButtonActive: {
    backgroundColor: VestiaryColors.gold,
    borderColor: VestiaryColors.gold,
  },
  itemSelectorText: {
    fontSize: 12,
    color: VestiaryColors.creamDark,
    fontWeight: '500',
  },
  itemSelectorTextActive: {
    color: VestiaryColors.navyDark,
    fontWeight: '600',
  },
  photoText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 8,
    color: VestiaryColors.cream,
  },
  photoSubtext: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginTop: 4,
  },
  dropdownContainer: {
    marginBottom: 4,
    zIndex: 1000,
    elevation: 1000,
  },
  customDropdownButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    minHeight: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: VestiaryColors.navyLight,
  },
  customDropdownText: {
    fontSize: 16,
    color: VestiaryColors.cream,
    flex: 1,
  },
  chevronDown: {
    transform: [{ rotate: '0deg' }],
  },
  chevronUp: {
    transform: [{ rotate: '180deg' }],
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownModal: {
    width: '80%',
    maxWidth: 300,
  },
  dropdownContent: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navy,
    color: VestiaryColors.cream,
  },
  dropdownOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navy,
  },
  selectedOption: {
    backgroundColor: VestiaryColors.navy,
  },
  dropdownOptionText: {
    fontSize: 16,
    color: VestiaryColors.cream,
    flex: 1,
  },
  selectedOptionText: {
    color: VestiaryColors.gold,
    fontWeight: '600',
  },
  input: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: VestiaryColors.cream,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  bottomPadding: {
    height: 40,
  },
  tagSection: {
    marginBottom: 16,
  },
  tagSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.creamDark,
    marginBottom: 8,
  },
  tagChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    backgroundColor: VestiaryColors.navyLight,
    borderColor: VestiaryColors.navyLight,
  },
  tagChipSelected: {
    backgroundColor: VestiaryColors.gold,
  },
  tagChipText: {
    color: VestiaryColors.creamDark,
    fontSize: 14,
  },
  tagChipTextSelected: {
    color: VestiaryColors.navyDark,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  aiSuggestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: VestiaryColors.navyLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  aiSuggestText: {
    fontSize: 12,
    color: VestiaryColors.gold,
    fontWeight: '600',
  },
});
