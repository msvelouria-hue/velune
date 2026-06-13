import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { logPrompt } from './promptLogService';
import type { AiClothingDescription, ClothingItem } from './wardrobeTypes';
import { AI_DETAIL_FIELDS } from './wardrobeTypes';
import {
  CLOTHING_CATEGORIES,
  createNeedsClarificationItem,
  getClothingCategory,
} from './clothingDetectionHelpers';
import { secureAiProxy } from './secureAiProxy';

export interface DetectedClothingItem {
  id: string;
  name: string;
  detectedType: string;
  confidence: number;
  originalPhoto: string;
  thumbnail: string;
  detailedDescription?: AiClothingDescription;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  needsAttention?: boolean;
}

// Clothing categories mapping
// Basic clothing and makeup keywords for detection
const CLOTHING_KEYWORDS = [
  'shirt', 't-shirt', 'blouse', 'sweater', 'hoodie', 'tank', 'top',
  'jacket', 'coat', 'blazer', 'cardigan', 'vest',
  'pants', 'jeans', 'shorts', 'trousers', 'leggings', 'joggers',
  'skirt', 'dress', 'gown', 'jumpsuit', 'romper',
  'shoes', 'sneakers', 'boots', 'sandals', 'heels', 'flats',
  'hat', 'cap', 'beanie', 'helmet',
  'bag', 'purse', 'backpack', 'tote', 'clutch',
  'belt', 'tie', 'scarf', 'gloves', 'socks', 'underwear',
  'hair clip', 'claw clip', 'barrette', 'headband', 'hair accessory',
  'lipstick', 'lip gloss', 'eyeshadow', 'mascara', 'foundation',
  'concealer', 'blush', 'bronzer', 'highlighter', 'eyeliner',
  'lip liner', 'palette', 'powder', 'primer', 'setting spray',
  'makeup brush', 'beauty blender', 'nail polish', 'makeup', 'cosmetics'
];

export class ClothingDetectionService {
  // Request permissions for full camera roll access
  async requestPermissions(): Promise<boolean> {
    try {
      console.log('Requesting media library permissions...');

      const { status } = await MediaLibrary.requestPermissionsAsync();

      if (status === 'granted') {
        console.log('Full media library access granted');
        return true;
      } else {
        console.log('Media library permissions denied:', status);
        return false;
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return false;
    }
  }

  // Get recent photos from camera roll
  async getRecentPhotos(limit: number = 50): Promise<MediaLibrary.Asset[]> {
    try {
      console.log(`Fetching ${limit} recent photos...`);

      const media = await MediaLibrary.getAssetsAsync({
        mediaType: 'photo',
        sortBy: 'creationTime',
        first: limit,
      });

      console.log(`Found ${media.assets.length} recent photos`);
      return media.assets;
    } catch (error) {
      console.error('Error getting recent photos:', error);
      return [];
    }
  }

  // Use OpenAI vision API for clothing detection
  async detectClothingInImage(imageUri: string): Promise<DetectedClothingItem[]> {
    try {
      console.log('Analyzing image for clothing items:', imageUri.substring(0, 50) + '...');

      // Validate image URI format
      if (!imageUri || typeof imageUri !== 'string') {
        console.warn('Invalid image URI provided:', imageUri);
        return [];
      }

      // Handle blob URLs - they might not work with getInfoAsync
      if (imageUri.startsWith('blob:')) {
        console.log('⚠️ Detected blob URL, proceeding with caution...');
        // For blob URLs, we'll rely on the base64 conversion error handling
      } else {
        // Get image info for file:// URLs
        const imageInfo = await FileSystem.getInfoAsync(imageUri);
        if (!imageInfo.exists) {
          console.log('Image file does not exist');
          return [];
        }
        console.log('📏 Image file validated, size:', imageInfo.size, 'bytes');
      }

      const detectedItems: DetectedClothingItem[] = [];

      try {
        // Use OpenAI vision API for actual clothing detection
        const possibleItems = await this.detectWithOpenAI(imageUri);

        for (const item of possibleItems) {
          // Skip background removal for now to avoid file handling issues
          console.log(`Processing detected ${item.detectedType}...`);

          detectedItems.push({
            ...item,
            originalPhoto: imageUri,
            thumbnail: imageUri, // Use original image as thumbnail for now
          });

          console.log(`Successfully processed ${item.detectedType}`);
        }
      } catch (detectionError) {
        console.error('Error during OpenAI detection:', detectionError);
        // Return empty array instead of throwing to prevent black screen
        return [];
      }

      console.log(`Detected ${detectedItems.length} clothing items`);
      return detectedItems;

    } catch (error) {
      console.error('Error detecting clothing in image:', error);
      return [];
    }
  }

  // Use OpenAI vision API for clothing detection with detailed descriptions
  private async detectWithOpenAI(imageUri: string): Promise<Omit<DetectedClothingItem, 'originalPhoto' | 'thumbnail'>[]> {
    let manipulatedUri = imageUri;

    try {
      // Convert image to JPEG format to ensure OpenAI compatibility (HEIC not supported)
      console.log('Converting image to JPEG for OpenAI compatibility...');
      const manipulatedImage = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 1024 } }], // Resize to reduce API costs
        {
          compress: 0.8,
          format: ImageManipulator.SaveFormat.JPEG
        }
      );
      manipulatedUri = manipulatedImage.uri;

      // Convert image to base64
      const base64Image = await FileSystem.readAsStringAsync(manipulatedUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { content, usage } = await secureAiProxy.detectClothing(base64Image);

      if (!content) {
        console.warn('No response from OpenAI, falling back to simulation');
        return this.simulateClothingDetection(imageUri);
      }

      // Log prompt to Firestore (non-blocking)
      const promptText =
        'Server-side clothing detection schema v2: requires detectedType, name, construction fields, season/event, stylingNotes, and non-repetitive visual details.';
      logPrompt('clothing_detection', 'gpt-4o-mini', promptText, content, {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      });

      // Log the raw response for debugging
      console.log('Raw OpenAI response:', JSON.stringify(content).substring(0, 500) + '...');

      // Clean the response to extract JSON
      let cleanedContent = content.trim();

      // Handle case where OpenAI says no clothing items found
      if (cleanedContent.toLowerCase().includes('no clothing') ||
          cleanedContent.toLowerCase().includes('cannot identify') ||
          cleanedContent.toLowerCase().includes('unable to detect')) {
        console.log('OpenAI explicitly stated no clothing items found');
        return this.simulateClothingDetection(imageUri);
      }

      // Remove any leading text before JSON
      if (cleanedContent.includes('Here\'s') || cleanedContent.includes('analyzing') || cleanedContent.includes('Based on')) {
        const jsonStart = cleanedContent.indexOf('[');
        if (jsonStart !== -1) {
          cleanedContent = cleanedContent.substring(jsonStart);
        }
      }

      // Remove any markdown code blocks (handles ```json, ```, and variations)
      cleanedContent = cleanedContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

      // Also handle cases where fences are in the middle
      if (cleanedContent.includes('```json')) {
        const jsonStartBlock = cleanedContent.indexOf('```json') + 7;
        const jsonEndBlock = cleanedContent.lastIndexOf('```');
        if (jsonStartBlock < jsonEndBlock) {
          cleanedContent = cleanedContent.substring(jsonStartBlock, jsonEndBlock).trim();
        }
      } else if (cleanedContent.includes('```')) {
        const jsonStartBlock = cleanedContent.indexOf('```') + 3;
        const jsonEndBlock = cleanedContent.lastIndexOf('```');
        if (jsonStartBlock < jsonEndBlock) {
          cleanedContent = cleanedContent.substring(jsonStartBlock, jsonEndBlock).trim();
        }
      }

      // Ensure JSON array/object bounds are correct. New structured responses use { items: [...] }.
      const objectStart = cleanedContent.indexOf('{');
      const objectEnd = cleanedContent.lastIndexOf('}');
      const jsonStart = cleanedContent.indexOf('[');
      let jsonEnd = cleanedContent.lastIndexOf(']');

      if (
        objectStart !== -1 &&
        objectEnd !== -1 &&
        objectEnd > objectStart &&
        (jsonStart === -1 || objectStart < jsonStart)
      ) {
        cleanedContent = cleanedContent.substring(objectStart, objectEnd + 1);
      } else if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1);
      } else if (jsonStart !== -1) {
        // If we can't find closing bracket, try to reconstruct
        cleanedContent = cleanedContent.substring(jsonStart);

        // Count open vs closed brackets to see if JSON is incomplete
        const openBrackets = (cleanedContent.match(/\{/g) || []).length;
        const closeBrackets = (cleanedContent.match(/\}/g) || []).length;

        if (openBrackets > closeBrackets) {
          // Add missing closing brackets
          const missing = openBrackets - closeBrackets;
          cleanedContent += '}'.repeat(missing);
        }

        // Ensure array is closed
        if (!cleanedContent.endsWith(']')) {
          cleanedContent += ']';
        }
      } else {
        // No JSON array found at all
        console.log('No JSON array found in response, checking for object format...');

        // Try to find if there's a single object that we can wrap in an array
        const objStart = cleanedContent.indexOf('{');
        const objEnd = cleanedContent.lastIndexOf('}');

        if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
          const singleObj = cleanedContent.substring(objStart, objEnd + 1);
          cleanedContent = `[${singleObj}]`;
          console.log('Wrapped single object in array:', cleanedContent);
        } else {
          console.log('No valid JSON structure found, needs clarification');
          return [createNeedsClarificationItem()];
        }
      }

      console.log('Cleaned content (first 200 chars):', cleanedContent.substring(0, 200) + '...');

      try {
        const parsedJson = JSON.parse(cleanedContent);
        const parsedResponse = Array.isArray(parsedJson)
          ? parsedJson
          : Array.isArray(parsedJson?.items)
            ? parsedJson.items
            : parsedJson?.detectedType || parsedJson?.type
              ? [parsedJson]
              : undefined;

        if (!Array.isArray(parsedResponse) || parsedResponse.length === 0) {
          console.warn('OpenAI returned invalid or empty array, needs clarification');
          return [createNeedsClarificationItem()];
        }

        console.log('Parsed OpenAI response:', parsedResponse);

        // Filter out clothing parts and only keep complete items
        const validClothingItems = parsedResponse.filter((item: any) => {
          const type = (item.detectedType || item.type || '').toLowerCase();

          // Filter out clothing parts/components
          const isClothingPart = type.includes('sole') ||
                                type.includes('strap') ||
                                type.includes('heel') ||
                                type.includes('lace') ||
                                type.includes('button') ||
                                type.includes('zipper') ||
                                type.includes('collar') ||
                                type.includes('sleeve') ||
                                type.includes('pocket') ||
                                type.includes('cuff') ||
                                type.includes('hem') ||
                                type.includes('seam');

          return !isClothingPart;
        });

        const processedItems = validClothingItems.map((item: any, index: number) => {
          const clothingType = item.detectedType || item.type || 'shirt';
          const color = item.color || 'unknown';
          const material = item.material || '';
          const season = this.toStringArray(item.season);
          const event = this.toStringArray(item.event);

          return {
            id: `item_${Date.now()}_${index}`,
            name: item.name || this.generateClothingName(clothingType, color),
            detectedType: clothingType,
            confidence: typeof item.confidence === 'number' ? item.confidence : 0.85,
            // Store detailed descriptions for form auto-fill
            detailedDescription: {
              color: item.color || '',
              pattern: item.pattern || 'solid',
              material: material,
              style: item.style || 'casual',
              fit: item.fit || '',
              details: item.details || '',
              silhouette: item.silhouette || '',
              neckline: item.neckline || '',
              sleeveLength: item.sleeveLength || '',
              length: item.length || '',
              closure: item.closure || '',
              rise: item.rise || '',
              wash: item.wash || '',
              heelHeight: item.heelHeight || '',
              toeShape: item.toeShape || '',
              hardware: item.hardware || '',
              brandOrLogo: item.brandOrLogo || '',
              formality: item.formality || '',
              warmth: item.warmth || '',
              layeringRole: item.layeringRole || '',
              season,
              event,
              stylingNotes: item.stylingNotes || '',
            },
            // Auto-detect layer type based on clothing characteristics
            layerType: this.detectLayerType(clothingType, material, item.style || '', item.layeringRole),
            boundingBox: {
              x: Math.random() * 100,
              y: Math.random() * 100,
              width: Math.random() * 200 + 100,
              height: Math.random() * 300 + 150,
            },
          };
        });

        console.log('Successfully processed OpenAI detection results:', processedItems);
        console.log(`📊 Detection summary: ${parsedResponse.length} items from AI, ${validClothingItems.length} after filter, ${processedItems.length} final`);

        // If we parsed items but all got filtered out, return the original parsed items
        // rather than an empty array (which would create "Uncategorized")
        if (processedItems.length === 0 && parsedResponse.length > 0) {
          console.log('⚠️ All items were filtered out, using unfiltered response');
          const unfilteredItems = parsedResponse.map((item: any, index: number) => {
            const clothingType = item.detectedType || item.type || 'accessory';
            const color = item.color || 'unknown';
            const material = item.material || '';
            const season = this.toStringArray(item.season);
            const event = this.toStringArray(item.event);

            return {
              id: `item_${Date.now()}_${index}`,
              name: item.name || this.generateClothingName(clothingType, color),
              detectedType: clothingType,
              confidence: typeof item.confidence === 'number' ? item.confidence : 0.85,
              detailedDescription: {
                color: item.color || '',
                pattern: item.pattern || 'solid',
                material: material,
                style: item.style || 'casual',
                fit: item.fit || '',
                details: item.details || '',
                silhouette: item.silhouette || '',
                neckline: item.neckline || '',
                sleeveLength: item.sleeveLength || '',
                length: item.length || '',
                closure: item.closure || '',
                rise: item.rise || '',
                wash: item.wash || '',
                heelHeight: item.heelHeight || '',
                toeShape: item.toeShape || '',
                hardware: item.hardware || '',
                brandOrLogo: item.brandOrLogo || '',
                formality: item.formality || '',
                warmth: item.warmth || '',
                layeringRole: item.layeringRole || '',
                season,
                event,
                stylingNotes: item.stylingNotes || '',
              },
              layerType: this.detectLayerType(clothingType, material, item.style || '', item.layeringRole),
              boundingBox: {
                x: Math.random() * 100,
                y: Math.random() * 100,
                width: Math.random() * 200 + 100,
                height: Math.random() * 300 + 150,
              },
            };
          });
          return unfilteredItems;
        }

        return processedItems;

      } catch (parseError) {
        console.warn('Failed to parse OpenAI response:', parseError);
        console.warn('Raw content was:', content);
        return this.simulateClothingDetection(imageUri);
      }

    } catch (error) {
      console.error('OpenAI clothing detection error:', error);
      return this.simulateClothingDetection(imageUri);
    } finally {
      // Clean up the temporary JPEG generated for the AI request.
      if (manipulatedUri !== imageUri) {
        await FileSystem.deleteAsync(manipulatedUri, { idempotent: true });
      }
    }
  }

  // Simulate clothing detection (fallback method)
  private async simulateClothingDetection(imageUri: string): Promise<Omit<DetectedClothingItem, 'originalPhoto' | 'thumbnail'>[]> {
    console.log('Using simulation mode for clothing detection');

    // Create a more realistic simulated item
    const clothingTypes = ['shirt', 't-shirt', 'pants', 'dress', 'jacket', 'sweater'];
    const colors = ['blue', 'black', 'white', 'gray', 'red', 'navy'];
    const styles = ['casual', 'formal', 'athletic'];

    const randomType = clothingTypes[Math.floor(Math.random() * clothingTypes.length)];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];

    return [{
      id: `item_${Date.now()}_0`,
      name: `${randomStyle.charAt(0).toUpperCase() + randomStyle.slice(1)} ${randomColor.charAt(0).toUpperCase() + randomColor.slice(1)} ${randomType.charAt(0).toUpperCase() + randomType.slice(1)}`,
      detectedType: randomType,
      confidence: 0.75,
      detailedDescription: {
        color: randomColor,
        pattern: 'solid',
        material: '',
        style: randomStyle,
        fit: 'regular',
        details: 'Detected using simulation mode',
        season: ['Spring', 'Summer', 'Fall'],
        event: randomStyle === 'athletic' ? ['Athletic'] : ['Casual'],
        formality: randomStyle,
        warmth: 'medium',
        layeringRole: 'base',
        stylingNotes: 'Simulation fallback; replace with a clearer photo for more precise styling guidance.',
      },
      boundingBox: {
        x: 50,
        y: 50,
        width: 200,
        height: 250,
      },
    }];
  }

  // Generate descriptive names for detected clothing
  private generateClothingName(type: string, color?: string): string {
    const adjectives = ['Casual', 'Formal', 'Stylish', 'Comfortable', 'Classic', 'Modern', 'Vintage', 'Trendy'];
    const fallbackColors = ['Blue', 'Black', 'White', 'Gray', 'Red', 'Navy', 'Brown', 'Green', 'Pink', 'Purple'];

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const finalColor = color || fallbackColors[Math.floor(Math.random() * fallbackColors.length)];

    const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);

    return `${adjective} ${finalColor} ${capitalizedType}`;
  }

  // Create thumbnail from processed image
  private async createThumbnail(imageUri: string, size: number = 200): Promise<string> {
    try {
      // For now, return the processed image as-is
      // In production, you might want to resize it to create actual thumbnails
      return imageUri;
    } catch (error) {
      console.error('Error creating thumbnail:', error);
      return imageUri;
    }
  }

  // Convert detected items to closet format
  convertToClosetItems(detectedItems: DetectedClothingItem[]): ClothingItem[] {
    return detectedItems.map((item) => {
      const metadata = this.buildAutoDetectedMetadata(item);

      return {
        id: item.id,
        photo: item.originalPhoto, // Use original photo to ensure it's always valid
        category: getClothingCategory(item.detectedType),
        ...metadata,
        color: metadata.color || this.extractColor(item.name),
        pattern: metadata.pattern || 'solid',
        material: metadata.material || '',
        style: metadata.style || this.extractStyle(item.name),
        dateAdded: new Date().toISOString(),
        wornCount: 0,
        photoStatus: 'done',
        // AI metadata
        originalPhoto: item.originalPhoto,
        thumbnail: item.thumbnail,
        aiDetected: true,
        boundingBox: item.boundingBox,
      };
    });
  }

  buildAutoDetectedMetadata(item: DetectedClothingItem): Partial<ClothingItem> {
    const description = item.detailedDescription;
    const detailPayload: Record<string, string> = {};

    for (const field of AI_DETAIL_FIELDS) {
      const value = description?.[field];
      if (typeof value === 'string') {
        detailPayload[field] = value;
      }
    }

    return {
      color: description?.color || '',
      pattern: description?.pattern || 'solid',
      material: description?.material || '',
      style: description?.style || '',
      notes: this.buildAutoDetectedNotes(item),
      tags: {
        season: this.toAllowedTags(description?.season, ['Spring', 'Summer', 'Fall', 'Winter']),
        event: this.toAllowedTags(description?.event, ['Casual', 'Formal', 'Athletic', 'Party']),
      },
      confidence: item.confidence,
      detectedType: item.detectedType,
      layerType: (item as any).layerType,
      ...detailPayload,
    };
  }

  buildAutoDetectedNotes(item: DetectedClothingItem): string {
    return item.detailedDescription?.details?.trim() || '';
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.split(',').map(entry => entry.trim()).filter(Boolean);
    }

    return [];
  }

  private toAllowedTags(value: unknown, allowedTags: string[]): string[] {
    const normalizedAllowed = new Map(allowedTags.map(tag => [tag.toLowerCase(), tag]));
    return this.toStringArray(value)
      .map(tag => normalizedAllowed.get(tag.toLowerCase()))
      .filter((tag): tag is string => Boolean(tag));
  }

  private extractColor(name: string): string {
    const colors = ['Blue', 'Black', 'White', 'Gray', 'Red', 'Navy', 'Brown', 'Green', 'Pink', 'Purple'];
    const foundColor = colors.find(color => name.includes(color));
    return foundColor || '';
  }

  private extractStyle(name: string): string {
    const styles = ['Casual', 'Formal', 'Athletic', 'Vintage', 'Modern'];
    const foundStyle = styles.find(style => name.includes(style));
    return foundStyle || 'Casual';
  }

  // Detect layer type for tops based on clothing characteristics
  private detectLayerType(type: string, material: string, style: string, layeringRole?: string): 'base' | 'mid' | 'outer' | undefined {
    const typeLower = type.toLowerCase();
    const materialLower = material.toLowerCase();
    const styleLower = style.toLowerCase();
    const layeringLower = layeringRole?.toLowerCase() || '';

    if (layeringLower === 'base' || layeringLower === 'mid' || layeringLower === 'outer') {
      return layeringLower;
    }

    // Base layer - thin, worn directly on skin
    const baseTypes = ['t-shirt', 'tank', 'camisole', 'undershirt', 'tee'];
    const baseMaterials = ['cotton', 'linen', 'silk', 'jersey', 'bamboo'];

    // Mid layer - insulating, worn over base
    const midTypes = ['sweater', 'sweatshirt', 'hoodie', 'cardigan', 'pullover', 'knit', 'fleece'];
    const midMaterials = ['wool', 'fleece', 'cashmere', 'knit', 'polyester'];

    // Outer layer - protective, worn on top
    const outerTypes = ['jacket', 'coat', 'blazer', 'parka', 'windbreaker', 'raincoat', 'trench'];
    const outerMaterials = ['leather', 'denim', 'nylon', 'canvas', 'waterproof', 'shell'];

    // Only classify tops and outerwear - everything else returns undefined
    const category = CLOTHING_CATEGORIES[typeLower] || '';
    if (category !== 'Tops' && category !== 'Outerwear') {
      return undefined;
    }

    // Check outer layer first (most specific)
    if (outerTypes.some(t => typeLower.includes(t)) || outerMaterials.some(m => materialLower.includes(m))) {
      return 'outer';
    }

    // Check mid layer
    if (midTypes.some(t => typeLower.includes(t)) || midMaterials.some(m => materialLower.includes(m))) {
      return 'mid';
    }

    // Check base layer
    if (baseTypes.some(t => typeLower.includes(t)) || baseMaterials.some(m => materialLower.includes(m))) {
      return 'base';
    }

    // Default classification based on category
    if (category === 'Outerwear') {
      return 'outer';
    } else if (category === 'Tops') {
      // For tops without clear indicators, use a heuristic
      if (styleLower.includes('athletic') || materialLower.includes('performance')) {
        return 'base';
      }
      return 'base'; // Default tops to base layer
    }

    return undefined;
  }

  // Main method to analyze camera roll and detect clothing
  async analyzeCameraRollForClothing(options?: {
    limit?: number;
    onProgress?: (current: number, total: number) => void;
    onItemDetected?: (item: DetectedClothingItem) => void;
  }): Promise<DetectedClothingItem[]> {
    const { limit = 50, onProgress, onItemDetected } = options || {};

    try {
      console.log('Starting camera roll analysis...');

      // Check permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        throw new Error('Media library permissions required');
      }

      // Get recent photos
      const photos = await this.getRecentPhotos(limit);
      if (photos.length === 0) {
        console.log('No photos found in camera roll');
        return [];
      }

      console.log(`Analyzing ${photos.length} photos for clothing...`);

      const allDetectedItems: DetectedClothingItem[] = [];

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];

        try {
          onProgress?.(i + 1, photos.length);

          const detectedItems = await this.detectClothingInImage(photo.uri);

          detectedItems.forEach(item => {
            allDetectedItems.push(item);
            onItemDetected?.(item);
          });

          // Add delay to prevent overwhelming the API
          if (i < photos.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

        } catch (error) {
          console.error(`Error analyzing photo ${i + 1}:`, error);
          continue;
        }
      }

      // Remove duplicates based on same image URI
      const uniqueItems = allDetectedItems.filter((item, index, array) => {
        return array.findIndex(other =>
          other.originalPhoto === item.originalPhoto &&
          other.detectedType === item.detectedType
        ) === index;
      });

      console.log(`Analysis complete. Found ${uniqueItems.length} unique clothing items from ${allDetectedItems.length} total detections across ${photos.length} photos`);
      return uniqueItems;

    } catch (error) {
      console.error('Error analyzing camera roll:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const clothingDetection = new ClothingDetectionService();
