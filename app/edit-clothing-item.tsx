import { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  TextInput,
  Alert,
  Modal,
  Platform,
} from "react-native";
import { Image } from 'expo-image';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { Menu, Button, Provider, Chip } from "react-native-paper";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera } from "expo-camera";
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { cloudSyncService } from "@/utils/cloudSyncService";
import { getUserProfile } from "@/utils/userProfileService";
import { VestiaryColors } from '@/constants/Colors';
import {
  AI_DETAIL_FIELDS,
  type AiDetailField,
  type AiDetailPayload,
} from '@/utils/wardrobeTypes';

type AiDetailInput = {
  field: AiDetailField;
  label: string;
  placeholder: string;
  multiline?: boolean;
};

const AI_DETAIL_INPUTS: AiDetailInput[] = [
  { field: 'fit', label: 'Fit', placeholder: 'e.g., slim, relaxed, cropped, oversized' },
  { field: 'silhouette', label: 'Silhouette', placeholder: 'e.g., boxy tee, A-line skirt, straight-leg pants' },
  { field: 'neckline', label: 'Neckline', placeholder: 'e.g., crew neck, v-neck, square neck' },
  { field: 'sleeveLength', label: 'Sleeves / Straps', placeholder: 'e.g., short sleeve, cap sleeve, spaghetti straps' },
  { field: 'length', label: 'Length', placeholder: 'e.g., hip length, cropped, midi, ankle length' },
  { field: 'closure', label: 'Closure', placeholder: 'e.g., pullover, button front, side zipper' },
  { field: 'rise', label: 'Rise', placeholder: 'e.g., high rise, mid rise, low rise' },
  { field: 'wash', label: 'Wash', placeholder: 'e.g., dark wash, acid wash, faded blue' },
  { field: 'heelHeight', label: 'Heel Height', placeholder: 'e.g., flat, low heel, platform, 3 inch heel' },
  { field: 'toeShape', label: 'Toe Shape', placeholder: 'e.g., round toe, pointed toe, almond toe' },
  { field: 'hardware', label: 'Hardware', placeholder: 'e.g., silver zipper, pearl buttons, gold buckle' },
  { field: 'brandOrLogo', label: 'Brand / Logo', placeholder: 'Visible brand, logo, label, or graphic text' },
  { field: 'formality', label: 'Formality', placeholder: 'e.g., casual, smart casual, formal, athletic' },
  { field: 'warmth', label: 'Warmth', placeholder: 'e.g., lightweight, medium, warm, very warm' },
  { field: 'layeringRole', label: 'Layering Role', placeholder: 'e.g., base, mid, outer, standalone' },
  {
    field: 'stylingNotes',
    label: 'Styling Notes',
    placeholder: 'Specific pairing guidance...',
    multiline: true,
  },
];

const TagSelector = ({
  title,
  options,
  selectedTags,
  onToggle,
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
            selectedTags.includes(tag) && styles.tagChipSelected,
          ]}
          textStyle={[
            styles.tagChipText,
            selectedTags.includes(tag) && styles.tagChipTextSelected,
          ]}
        >
          {tag}
        </Chip>
      ))}
    </View>
  </View>
);

const CategoryDropdown = ({
  category,
  setCategory,
}: {
  category: string | null;
  setCategory: (value: string | null) => void;
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
    "Makeup",
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

export default function EditClothingItemScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const [photo, setPhoto] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [color, setColor] = useState("");
  const [pattern, setPattern] = useState("");
  const [material, setMaterial] = useState("");
  const [style, setStyle] = useState("");
  const [notes, setNotes] = useState("");
  const [aiDetails, setAiDetails] = useState<AiDetailPayload>({});
  const [stylistName, setStylistName] = useState('your stylist');
  const [seasonTags, setSeasonTags] = useState<string[]>([]);
  const [eventTags, setEventTags] = useState<string[]>([]);
  const [layerType, setLayerType] = useState<'base' | 'mid' | 'outer' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesInputRef = useRef<TextInput>(null);

  useEffect(() => {
    loadItem();
  }, [itemId]);

  useEffect(() => {
    loadStylistName();
  }, []);

  const loadStylistName = async () => {
    try {
      const storedStylist = await AsyncStorage.getItem('selectedStylist');
      if (storedStylist) {
        setStylistName(storedStylist);
        return;
      }

      const profile = await getUserProfile();
      setStylistName(profile?.selectedStylist || 'your stylist');
    } catch (error) {
      console.error('Error loading stylist name:', error);
      setStylistName('your stylist');
    }
  };

  const getDetailPlaceholder = (input: AiDetailInput): string => {
    if (input.field === 'stylingNotes') {
      return `Specific pairing guidance for ${stylistName}...`;
    }

    return input.placeholder;
  };

  // Auto-save function with debouncing - now syncs to Firebase too
  const autoSave = async () => {
    if (!category) {
      // Don't save if category is missing
      return;
    }

    const updatedItem = {
      id: itemId,
      photo,
      category,
      color,
      pattern,
      material,
      style,
      notes,
      ...aiDetails,
      tags: {
        season: seasonTags,
        event: eventTags,
      },
      layerType: layerType || undefined,
    };

    try {
      // Use cloudSyncService.updateItem which saves locally AND syncs to Firebase
      const success = await cloudSyncService.updateItem(updatedItem);
      if (success) {
        console.log("✅ Auto-saved item changes (local + cloud sync initiated)");
      }
    } catch (error) {
      console.error("Error auto-saving item:", error);
    }
  };

  // Debounced auto-save effect
  useEffect(() => {
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSave();
    }, 1000); // Save after 1 second of inactivity

    // Cleanup timeout on unmount
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [category, color, pattern, material, style, notes, aiDetails, seasonTags, eventTags, photo, layerType]);



  const loadItem = async () => {
    try {
      const item = await cloudSyncService.getItem(itemId as string);

      if (item) {
        console.log(`Loading item ${itemId} from Firestore/cache`);
        setPhoto(item.photo || null);
        setCategory(item.category || null);
        setColor(item.color || '');
        setPattern(item.pattern || '');
        setMaterial(item.material || '');
        setStyle(item.style || '');
        setNotes(item.notes || '');
        setAiDetails(
          AI_DETAIL_FIELDS.reduce<AiDetailPayload>((details, field) => {
            const value = item[field];
            if (typeof value === 'string') {
              details[field] = value;
            }
            return details;
          }, {})
        );
        setSeasonTags(item.tags?.season || []);
        setEventTags(item.tags?.event || []);
        setLayerType((item as any).layerType || null);
      } else {
        console.warn(`Item with ID ${itemId} was not found in Firestore or cache`);
      }
    } catch (error) {
      console.error("Error loading item:", error);
      Alert.alert("Error", "Failed to load item");
    }
  };

  const handlePhotoUpload = () => {
    Alert.alert("Update Photo", "Choose how you'd like to update the photo", [
      {
        text: "Camera",
        onPress: handleTakePhoto,
      },
      {
        text: "Gallery",
        onPress: handlePickFromGallery,
      },
      {
        text: "Remove Photo",
        onPress: () => setPhoto(null),
        style: "destructive",
      },
      {
        text: "Cancel",
        style: "cancel",
      },
    ]);
  };

  const handleTakePhoto = async () => {
    try {
      // Request camera permissions
      const { status } = await Camera.requestCameraPermissionsAsync();

      if (status === "granted") {
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets[0]) {
          setPhoto(result.assets[0].uri);
        }
      } else {
        Alert.alert(
          "Permission Denied",
          "Camera access is required to take photos.",
        );
      }
    } catch (error) {
      console.error("Error taking photo:", error);
      Alert.alert("Error", "Failed to take photo. Please try again.");
    }
  };

  const handlePickFromGallery = async () => {
    try {
      // Request media library permissions
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status === "granted") {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets[0]) {
          setPhoto(result.assets[0].uri);
        }
      } else {
        Alert.alert(
          "Permission Denied",
          "Gallery access is required to select photos.",
        );
      }
    } catch (error) {
      console.error("Error picking from gallery:", error);
      Alert.alert("Error", "Failed to select photo. Please try again.");
    }
  };

  const toggleSeasonTag = (tag: string) => {
    setSeasonTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const toggleEventTag = (tag: string) => {
    setEventTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const setAiDetail = (field: AiDetailField, value: string) => {
    setAiDetails((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleCancel = () => {
    // Trigger final save before leaving
    autoSave();
    router.back();
  };

  const handleDelete = () => {
    console.log("Delete button pressed"); // Debug log
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    console.log("Delete confirmed"); // Debug log
    setShowDeleteConfirm(false);
    try {
      // Use consolidated delete method (handles local + cloud deletion)
      const result = await cloudSyncService.deleteItem(itemId as string);

      if (result.success) {
        console.log(`🗑️ Deleted item: ${itemId} (local: ${result.localDeleted}, cloud: ${result.cloudDeleted})`);

        // Notify other parts of the app that items have been updated
        if (global.onItemsUpdated) {
          global.onItemsUpdated();
        }

        router.replace("/(tabs)" as any);
      } else {
        Alert.alert("Error", "Failed to delete item");
      }
    } catch (error) {
      console.error("Error deleting item:", error);
      Alert.alert("Error", "Failed to delete item");
    }
  };

  const cancelDelete = () => {
    console.log("Delete cancelled"); // Debug log
    setShowDeleteConfirm(false);
  };

  const handleDescribeAnother = (originalPhotoUri: string | null) => {
    if (originalPhotoUri) {
      router.push({
        pathname: "/add-clothing-item",
        params: {
          photoUri: originalPhotoUri,
          manualEntry: "true",
        },
      });
    }
  };

  return (
    <Provider>
      <ThemedView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
            <IconSymbol name="xmark" size={24} color="#666" />
          </TouchableOpacity>
          <ThemedText style={styles.title}>Edit Item</ThemedText>
          <View style={styles.headerButtons}>
            <TouchableOpacity
              onPress={handleDelete}
              style={styles.deleteButton}
            >
              <IconSymbol name="trash" size={22} color="#FF4444" />
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAwareScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContentContainer}
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
            <TouchableOpacity
              style={styles.photoUpload}
              onPress={handlePhotoUpload}
            >
              {photo && photo.trim() !== '' ? (
                <View style={styles.photoPreview}>
                  <Image
                    source={{ uri: photo }}
                    style={styles.photoImage}
                    contentFit="cover"
                    transition={200}
                    onError={(error) => {
                      console.warn('Failed to load image in edit screen:', photo, error);
                    }}
                    onLoad={() => {
                      console.log('Image loaded successfully in edit screen:', photo);
                    }}
                  />
                  <TouchableOpacity
                    style={styles.changePhotoButton}
                    onPress={handlePhotoUpload}
                  >
                    <ThemedText style={styles.changePhotoText}>
                      Change Photo
                    </ThemedText>
                  </TouchableOpacity>

                  {/* Describe Another Item Section */}
                  <View style={styles.describeAnotherSection}>
                    <TouchableOpacity
                      style={styles.describeAnotherButton}
                      onPress={() => handleDescribeAnother(photo)}
                    >
                      <IconSymbol
                        name="plus.circle"
                        size={18}
                        color="#B565D8"
                      />
                      <ThemedText style={styles.describeAnotherText}>
                        Describe another item in this photo
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.photoPlaceholder}>
                  <IconSymbol name="camera.fill" size={40} color="#B565D8" />
                  <ThemedText style={styles.photoText}>
                    Tap to add photo
                  </ThemedText>
                  <ThemedText style={styles.photoSubtext}>
                    Camera or Gallery
                  </ThemedText>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Category */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Category *</ThemedText>
            <CategoryDropdown category={category} setCategory={setCategory} />
          </View>

          {/* Color */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Color</ThemedText>
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
            <ThemedText style={styles.sectionTitle}>Pattern</ThemedText>
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
            <ThemedText style={styles.sectionTitle}>Material</ThemedText>
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
            <ThemedText style={styles.sectionTitle}>Style</ThemedText>
            <TextInput
              style={styles.input}
              value={style}
              onChangeText={setStyle}
              placeholder="e.g., Casual, Formal, Athletic..."
              placeholderTextColor="#999"
            />
          </View>

          {/* Details */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Details</ThemedText>
            <ThemedText style={styles.sectionSubtitle}>
              These help {stylistName} understand shape, weather, formality, and pairing ideas.
            </ThemedText>
            {AI_DETAIL_INPUTS.map((input) => (
              <View key={input.field} style={styles.detailField}>
                <ThemedText style={styles.detailLabel}>{input.label}</ThemedText>
                <TextInput
                  style={[
                    styles.input,
                    input.multiline && styles.notesInput,
                  ]}
                  value={aiDetails[input.field] || ''}
                  onChangeText={(value) => setAiDetail(input.field, value)}
                  placeholder={getDetailPlaceholder(input)}
                  placeholderTextColor="#999"
                  multiline={input.multiline}
                  textAlignVertical={input.multiline ? 'top' : 'center'}
                  scrollEnabled={false}
                  blurOnSubmit={!input.multiline}
                />
              </View>
            ))}
          </View>

          {/* Layer Type - only show for Tops and Outerwear */}
          {(category === 'Tops' || category === 'Outerwear') && (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Layer Type (Optional)</ThemedText>
              <ThemedText style={styles.sectionSubtitle}>
                Helps create better layered outfits for different weather
              </ThemedText>
              <View style={styles.layerTypeButtons}>
                <TouchableOpacity
                  style={[
                    styles.layerTypeButton,
                    layerType === 'base' && styles.layerTypeButtonSelected
                  ]}
                  onPress={() => setLayerType(layerType === 'base' ? null : 'base')}
                >
                  <ThemedText style={[
                    styles.layerTypeButtonText,
                    layerType === 'base' && styles.layerTypeButtonTextSelected
                  ]}>
                    Base Layer
                  </ThemedText>
                  <ThemedText style={styles.layerTypeButtonHint}>
                    T-shirt, tank, thin long-sleeve
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.layerTypeButton,
                    layerType === 'mid' && styles.layerTypeButtonSelected
                  ]}
                  onPress={() => setLayerType(layerType === 'mid' ? null : 'mid')}
                >
                  <ThemedText style={[
                    styles.layerTypeButtonText,
                    layerType === 'mid' && styles.layerTypeButtonTextSelected
                  ]}>
                    Mid Layer
                  </ThemedText>
                  <ThemedText style={styles.layerTypeButtonHint}>
                    Sweater, hoodie, cardigan
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.layerTypeButton,
                    layerType === 'outer' && styles.layerTypeButtonSelected
                  ]}
                  onPress={() => setLayerType(layerType === 'outer' ? null : 'outer')}
                >
                  <ThemedText style={[
                    styles.layerTypeButtonText,
                    layerType === 'outer' && styles.layerTypeButtonTextSelected
                  ]}>
                    Outer Layer
                  </ThemedText>
                  <ThemedText style={styles.layerTypeButtonHint}>
                    Jacket, coat, blazer
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Notes */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>
              Notes (Optional)
            </ThemedText>
            <TextInput
              ref={notesInputRef}
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional details..."
              placeholderTextColor="#999"
              multiline={true}
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
              options={["Spring", "Summer", "Fall", "Winter"]}
              selectedTags={seasonTags}
              onToggle={toggleSeasonTag}
            />
            <TagSelector
              title="Event"
              options={["Casual", "Formal", "Athletic", "Party"]}
              selectedTags={eventTags}
              onToggle={toggleEventTag}
            />
          </View>

          <View style={styles.bottomPadding} />
        </KeyboardAwareScrollView>

        {/* Delete Confirmation Modal */}
        <Modal
          visible={showDeleteConfirm}
          transparent={true}
          animationType="fade"
          onRequestClose={cancelDelete}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ThemedText style={styles.modalTitle}>Delete Item</ThemedText>
              <ThemedText style={styles.modalMessage}>
                Are you sure you want to delete this?
              </ThemedText>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelModalButton]}
                  onPress={cancelDelete}
                >
                  <ThemedText style={styles.cancelButtonText}>
                    Cancel
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmButton]}
                  onPress={confirmDelete}
                >
                  <ThemedText style={styles.confirmButtonText}>
                    Delete
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 20,
    borderBottomWidth: 0,
    backgroundColor: VestiaryColors.navy,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  cancelButton: {
    padding: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: VestiaryColors.cream,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  deleteButton: {
    padding: 10,
  },

  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  section: {
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    color: VestiaryColors.cream,
  },
  photoUpload: {
    borderWidth: 2,
    borderColor: VestiaryColors.gold,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    backgroundColor: VestiaryColors.navyLight,
    shadowColor: VestiaryColors.gold,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  photoPlaceholder: {
    alignItems: "center",
  },
  photoPreview: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  photoImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 12,
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
    fontWeight: "600",
  },
  photoText: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: 12,
    color: VestiaryColors.cream,
  },
  photoSubtext: {
    fontSize: 15,
    color: VestiaryColors.creamDark,
    marginTop: 8,
  },
  dropdownContainer: {
    marginBottom: 4,
    zIndex: 1000,
    elevation: 1000,
  },
  menuButton: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    justifyContent: "flex-start",
    minHeight: 50,
  },
  menuButtonContent: {
    height: 50,
    justifyContent: "flex-start",
    paddingHorizontal: 16,
  },
  menuButtonLabel: {
    fontSize: 16,
    color: VestiaryColors.cream,
    textAlign: "left",
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
    minHeight: 140,
    textAlignVertical: 'top',
  },
  detailField: {
    marginBottom: 14,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: VestiaryColors.creamDark,
    marginBottom: 8,
  },
  bottomPadding: {
    height: 100,
  },
  scrollContentContainer: {
    flexGrow: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 16,
    padding: 24,
    margin: 20,
    minWidth: 280,
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
    color: VestiaryColors.cream,
  },
  modalMessage: {
    fontSize: 16,
    color: VestiaryColors.creamDark,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelModalButton: {
    backgroundColor: VestiaryColors.navy,
  },
  confirmButton: {
    backgroundColor: VestiaryColors.error,
  },
  cancelButtonText: {
    color: VestiaryColors.cream,
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButtonText: {
    color: VestiaryColors.white,
    fontSize: 16,
    fontWeight: "600",
  },
  tagSection: {
    marginBottom: 16,
  },
  tagSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: VestiaryColors.creamDark,
    marginBottom: 8,
  },
  tagChips: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  describeAnotherSection: {
    marginTop: 16,
    alignItems: "center",
  },
  describeAnotherButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
    fontWeight: "600",
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
  sectionSubtitle: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginTop: 4,
    marginBottom: 12,
  },
  layerTypeButtons: {
    gap: 12,
  },
  layerTypeButton: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  layerTypeButtonSelected: {
    backgroundColor: VestiaryColors.gold,
    borderColor: VestiaryColors.gold,
  },
  layerTypeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 4,
  },
  layerTypeButtonTextSelected: {
    color: VestiaryColors.navyDark,
  },
  layerTypeButtonHint: {
    fontSize: 13,
    color: VestiaryColors.creamDark,
  },
});
