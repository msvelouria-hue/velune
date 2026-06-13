import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../config/firebase';

export interface BackgroundRemovalService {
  removeBackground(imageUri: string): Promise<string>;
}

// Remove.bg service implementation
export class RemoveBgService implements BackgroundRemovalService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    // Basic API key validation
    if (!apiKey || apiKey.length < 10) {
      console.warn('Remove.bg API key appears to be invalid or too short');
    }

    if (apiKey === 'demo-key') {
      console.warn('Using demo API key - this will not work with Remove.bg');
    }
  }

  async removeBackground(imageUri: string): Promise<string> {
    try {
      console.log('🎨 Starting Remove.bg background removal for:', imageUri.substring(0, 50) + '...');
      console.log('🔑 API key status:', this.apiKey ? `Present (${this.apiKey.length} chars)` : 'Missing');
      console.log('🔑 API key preview:', this.apiKey ? this.apiKey.substring(0, 12) + '...' : 'N/A');

      // Validate API key first
      if (!this.apiKey || this.apiKey === 'demo-key' || this.apiKey.length < 10) {
        console.error('❌ Invalid Remove.bg API key:', this.apiKey);
        throw new Error('Invalid API key');
      }

      // Always convert to JPEG to handle iOS HEIC format
      // Remove.bg only accepts jpg/png/webp, not heic
      let processedImageUri = imageUri;
      const originalInfo = await FileSystem.getInfoAsync(imageUri);
      const originalSizeMB = originalInfo.exists && originalInfo.size ? originalInfo.size / (1024 * 1024) : 0;

      console.log('📏 Original image size:', originalSizeMB.toFixed(2), 'MB');
      console.log('📸 Converting image to JPEG format (handles iOS HEIC)...');

      // Calculate compression quality based on file size
      let quality = 0.9; // High quality for small files
      if (originalSizeMB > 8) {
        quality = 0.5;
      } else if (originalSizeMB > 5) {
        quality = 0.6;
      } else if (originalSizeMB > 3) {
        quality = 0.8;
      }

      try {
        const convertedImage = await manipulateAsync(
          imageUri,
          originalSizeMB > 3 ? [{ resize: { width: 1200 } }] : [], // Only resize if large
          {
            compress: quality,
            format: SaveFormat.JPEG,
          }
        );

        processedImageUri = convertedImage.uri;
        const convertedInfo = await FileSystem.getInfoAsync(processedImageUri);
        const convertedSizeMB = convertedInfo.exists && convertedInfo.size ? convertedInfo.size / (1024 * 1024) : 0;

        console.log('✅ Image converted to JPEG:', originalSizeMB.toFixed(2), 'MB →', convertedSizeMB.toFixed(2), 'MB');
      } catch (conversionError: unknown) {
        const errMsg = conversionError instanceof Error ? conversionError.message : 'Unknown error';
        console.warn('⚠️ Image conversion failed, using original:', errMsg);
        processedImageUri = imageUri;
      }

      const base64Image = await FileSystem.readAsStringAsync(processedImageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const imageSizeKB = base64Image.length * 0.75 / 1024;
      console.log('📄 Image loaded, base64 length:', base64Image.length);
      console.log('📏 Estimated image size:', imageSizeKB.toFixed(0), 'KB');

      // Warn about very large images
      if (imageSizeKB > 8000) { // > 8MB
        console.warn('⚠️ Very large image detected - this may timeout or fail');
        console.log('💡 Consider using a smaller image for better results');
      }
      console.log('🔑 API key prefix:', this.apiKey.substring(0, 8) + '...');
      console.log('🔑 API key length:', this.apiKey.length);

      const requestBody = {
        image_file_b64: base64Image,
        size: 'auto',
        format: 'png',
      };

      console.log('Making request to Remove.bg API...');
      console.log('Request body size:', JSON.stringify(requestBody).length);

      // Check image size and adjust timeout accordingly
      let timeoutMs = 30000; // Default 30 seconds for compressed images

      if (imageSizeKB > 3000) { // > 3MB (should be rare after compression)
        timeoutMs = 60000; // 60 seconds for large images
        console.log('🐌 Large image detected, extending timeout to 60 seconds');
      } else if (imageSizeKB > 1500) { // > 1.5MB
        timeoutMs = 45000; // 45 seconds for medium images
        console.log('📏 Medium image detected, extending timeout to 45 seconds');
      }

      console.log('⏱️ Using timeout of', timeoutMs / 1000, 'seconds for this image');

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log('Response received:');
      console.log('- Status:', response.status);
      console.log('- Status Text:', response.statusText);
      console.log('- Headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        try {
          // Check content type to determine response format
          const contentType = response.headers.get('content-type');
          console.log('📋 Response content type:', contentType);

          if (contentType?.includes('image/')) {
            // Binary image response - convert to base64
            console.log('🖼️ Processing binary image response...');
            const arrayBuffer = await response.arrayBuffer();
            console.log('📊 Binary data length:', arrayBuffer.byteLength);

            if (arrayBuffer.byteLength === 0) {
              throw new Error('Received empty image data');
            }

            // Convert ArrayBuffer to base64
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i]);
            }
            const base64Image = btoa(binary);

            console.log('✅ Converted to base64, length:', base64Image.length);

            // Create temporary file for processed image
            const tempPath = `${FileSystem.cacheDirectory}removed_bg_${Date.now()}.png`;
            await FileSystem.writeAsStringAsync(
              tempPath,
              base64Image,
              { encoding: FileSystem.EncodingType.Base64 }
            );

            console.log('💾 Saved processed image to:', tempPath);

            // Verify the file was created successfully
            const fileInfo = await FileSystem.getInfoAsync(tempPath);
            if (fileInfo.exists && fileInfo.size > 0) {
              console.log('✅ Background removal successful! File size:', fileInfo.size);

              // Clean up compressed image if it was created
              if (processedImageUri !== imageUri) {
                await FileSystem.deleteAsync(processedImageUri, { idempotent: true });
                console.log('🗑️ Cleaned up compressed temporary image');
              }

              return tempPath;
            } else {
              throw new Error('Failed to save processed image');
            }
          } else {
            // JSON response format (fallback)
            const responseText = await response.text();
            console.log('📝 Remove.bg JSON response preview:', responseText ? responseText.substring(0, 200) : 'Empty response');

            if (!responseText) {
              throw new Error('Empty response from Remove.bg API');
            }

            const result = JSON.parse(responseText);
            if (result.data && result.data.result_b64) {
              // Create temporary file for processed image
              const tempPath = `${FileSystem.cacheDirectory}removed_bg_${Date.now()}.png`;
              await FileSystem.writeAsStringAsync(
                tempPath,
                result.data.result_b64,
                { encoding: FileSystem.EncodingType.Base64 }
              );

              console.log('✅ Background removal successful via JSON!');
              return tempPath;
            } else {
              throw new Error('No result data in API response');
            }
          }
        } catch (error: unknown) {
          console.error('❌ Failed to process Remove.bg response:', error);
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to process API response: ${errMsg}`);
        }
      } else {
        // API returned an error - try to get the error message
        let errorMessage = `API error: ${response.status}`;
        let isUnknownForegroundError = false;

        try {
          const responseText = await response.text();
          console.log('❌ Remove.bg error response:', responseText ? responseText.substring(0, 400) : 'Empty error response');

          if (responseText) {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.errors?.[0]?.title || errorData.message || errorMessage;

            // Check if this is the "unknown foreground" error
            if (errorData.errors?.[0]?.code === 'unknown_foreground') {
              isUnknownForegroundError = true;
              console.log('🤷‍♂️ Remove.bg could not identify foreground - image may not have a clear subject');
            }

            // Log specific error details
            if (errorData.errors) {
              console.log('📋 Error details:', errorData.errors);
            }
          }
        } catch (parseError) {
          console.log('❌ Failed to parse error response:', parseError);
          errorMessage = `API error: ${response.status} ${response.statusText}`;
        }

        // For unknown foreground errors, provide a more user-friendly message
        if (isUnknownForegroundError) {
          console.warn('⚠️ Remove.bg cannot identify subject in image - skipping background removal');
          // Return original image instead of throwing for this specific error
          console.log('📸 Returning original image due to unclear subject matter');
          return imageUri;
        }

        console.error('❌ Remove.bg API error:', errorMessage);
        throw new Error(errorMessage);
      }

      throw new Error('Failed to remove background');
    } catch (error: unknown) {
      console.error('❌ Remove.bg error:', error);

      const errMsg = error instanceof Error ? error.message : 'Unknown error';

      // Check if it's a network error
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error('🌐 Network error - fetch failed:', error.message);
      } else if (errMsg.includes('timeout') || errMsg.includes('Aborted')) {
        console.error('⏰ Request timeout - image too large or slow connection');
        console.log('💡 Try using a smaller image or check your internet connection');
      } else if (errMsg.includes('Invalid API key')) {
        console.error('🔑 API key issue - check your Remove.bg configuration');
      } else if (errMsg.includes('API error: 402')) {
        console.error('💳 Remove.bg API credits exhausted');
      } else if (errMsg.includes('API error: 429')) {
        console.error('🚦 Remove.bg rate limit exceeded');
      }

      console.error('❌ Background removal failed, returning original image. Error:', errMsg);

      // Don't return original image - throw error so it can be handled properly
      throw error;
    }
  }
}

// PhotoRoom service implementation
export class PhotoRoomService implements BackgroundRemovalService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async removeBackground(imageUri: string): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('image_file', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'image.jpg',
      } as any);

      const response = await fetch('https://sdk.photoroom.com/v1/segment', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
        },
        body: formData,
      });

      if (response.ok) {
        const blob = await response.blob();

        // Convert to base64 and save
        const reader = new FileReader();
        return new Promise((resolve, reject) => {
          reader.onloadend = async () => {
            try {
              const base64data = reader.result as string;
              const tempPath = `${FileSystem.cacheDirectory}temp_${Date.now()}.png`;

              await FileSystem.writeAsStringAsync(
                tempPath,
                base64data.split(',')[1],
                { encoding: FileSystem.EncodingType.Base64 }
              );

              resolve(tempPath);
            } catch (error) {
              reject(error);
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        console.error(`PhotoRoom API error: ${response.status}`);
        return imageUri;
      }
    } catch (error) {
      console.error('PhotoRoom error:', error);
      // Return original image as fallback instead of throwing
      return imageUri;
    }
  }
}

// Vuxo RemoveBG service implementation
export class VuxoRemoveBgService implements BackgroundRemovalService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    if (!apiKey || apiKey.length < 10) {
      console.warn('Vuxo API key appears to be invalid or too short');
    }
  }

  async removeBackground(imageUri: string): Promise<string> {
    try {
      console.log('🎨 Starting Vuxo background removal for:', imageUri.substring(0, 50) + '...');

      // Check original image size and compress if needed
      let processedImageUri = imageUri;
      const originalInfo = await FileSystem.getInfoAsync(imageUri);
      const originalSizeMB = originalInfo.exists && originalInfo.size ? originalInfo.size / (1024 * 1024) : 0;

      console.log('📏 Original image size:', originalSizeMB.toFixed(2), 'MB');

      // Compress image if it's larger than 3MB
      if (originalSizeMB > 3) {
        console.log('🗜️ Image is large, compressing...');

        let quality = 0.8;
        if (originalSizeMB > 8) {
          quality = 0.5;
        } else if (originalSizeMB > 5) {
          quality = 0.6;
        }

        try {
          const compressedImage = await manipulateAsync(
            imageUri,
            [{ resize: { width: 1200 } }],
            {
              compress: quality,
              format: SaveFormat.JPEG,
            }
          );

          processedImageUri = compressedImage.uri;
          const compressedInfo = await FileSystem.getInfoAsync(processedImageUri);
          const compressedSizeMB = compressedInfo.exists && compressedInfo.size ? compressedInfo.size / (1024 * 1024) : 0;

          console.log('✅ Image compressed from', originalSizeMB.toFixed(2), 'MB to', compressedSizeMB.toFixed(2), 'MB');
        } catch (compressionError: unknown) {
          const errMsg = compressionError instanceof Error ? compressionError.message : 'Unknown error';
          console.warn('⚠️ Image compression failed, using original:', errMsg);
          processedImageUri = imageUri;
        }
      }

      // Create form data - Vuxo API uses multipart form
      const formData = new FormData();
      formData.append('api_key', this.apiKey);
      formData.append('image', {
        uri: processedImageUri,
        type: 'image/jpeg',
        name: 'image.jpg',
      } as any);

      console.log('📤 Making request to Vuxo API...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

      const response = await fetch('https://rembg.vuxo.com/', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log('📥 Response status:', response.status);

      if (response.ok) {
        // Get binary image data
        const arrayBuffer = await response.arrayBuffer();
        console.log('📊 Received image data:', arrayBuffer.byteLength, 'bytes');

        if (arrayBuffer.byteLength === 0) {
          throw new Error('Received empty image data');
        }

        // Convert ArrayBuffer to base64
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const resultBase64 = btoa(binary);

        // Save to file
        const tempPath = `${FileSystem.cacheDirectory}vuxo_removed_bg_${Date.now()}.png`;
        await FileSystem.writeAsStringAsync(
          tempPath,
          resultBase64,
          { encoding: FileSystem.EncodingType.Base64 }
        );

        // Verify file was created
        const fileInfo = await FileSystem.getInfoAsync(tempPath);
        if (fileInfo.exists && fileInfo.size > 0) {
          console.log('✅ Vuxo background removal successful! File size:', fileInfo.size);

          // Clean up compressed image if it was created
          if (processedImageUri !== imageUri) {
            await FileSystem.deleteAsync(processedImageUri, { idempotent: true });
          }

          return tempPath;
        } else {
          throw new Error('Failed to save processed image');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Vuxo API error:', response.status, errorText);
        throw new Error(`Vuxo API error: ${response.status}`);
      }
    } catch (error: unknown) {
      console.error('❌ Vuxo background removal error:', error);

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      if (errMsg.includes('Aborted')) {
        console.error('⏰ Request timeout');
      }

      throw error;
    }
  }
}

// Firebase Cloud Function based background removal service
// This proxies the call through Firebase, keeping the API key secure and storing the image directly
export class FirebaseBackgroundRemovalService implements BackgroundRemovalService {
  private functions: ReturnType<typeof getFunctions>;
  private removeBackgroundFn: ReturnType<typeof httpsCallable>;

  constructor() {
    this.functions = getFunctions(app);
    // Set a 3-minute client-side timeout to handle cold starts and large images
    this.removeBackgroundFn = httpsCallable(this.functions, 'removeBackground', {
      timeout: 180000, // 3 minutes in milliseconds
    });
  }

  async removeBackground(imageUri: string): Promise<string> {
    try {
      console.log('🔥 Starting Firebase background removal for:', imageUri.substring(0, 50) + '...');

      // Check if this is a remote URL (Firebase Storage, etc)
      const isRemoteUrl = imageUri.startsWith('http://') || imageUri.startsWith('https://');
      let localImageUri = imageUri;

      if (isRemoteUrl) {
        console.log('🌐 Detected remote URL, downloading image first...');
        const tempPath = `${FileSystem.cacheDirectory}reprocess_${Date.now()}.jpg`;
        try {
          const downloadResult = await FileSystem.downloadAsync(imageUri, tempPath);
          if (downloadResult.status === 200) {
            localImageUri = downloadResult.uri;
            console.log('✅ Downloaded image to:', localImageUri);
          } else {
            throw new Error(`Download failed with status ${downloadResult.status}`);
          }
        } catch (downloadError) {
          console.error('❌ Failed to download remote image:', downloadError);
          throw new Error('Failed to download image for reprocessing');
        }
      }

      // Read the image and convert to base64
      let processedImageUri = localImageUri;
      const originalInfo = await FileSystem.getInfoAsync(localImageUri);
      const originalSizeMB = originalInfo.exists && originalInfo.size ? originalInfo.size / (1024 * 1024) : 0;

      console.log('📏 Original image size:', originalSizeMB.toFixed(2), 'MB');

      // Compress image if it's larger than 3MB to reduce upload size
      if (originalSizeMB > 3) {
        console.log('🗜️ Image is large, compressing before upload...');

        let quality = 0.8;
        if (originalSizeMB > 8) {
          quality = 0.5;
        } else if (originalSizeMB > 5) {
          quality = 0.6;
        }

        try {
          const compressedImage = await manipulateAsync(
            imageUri,
            [{ resize: { width: 1200 } }],
            {
              compress: quality,
              format: SaveFormat.JPEG,
            }
          );

          processedImageUri = compressedImage.uri;
          const compressedInfo = await FileSystem.getInfoAsync(processedImageUri);
          const compressedSizeMB = compressedInfo.exists && compressedInfo.size ? compressedInfo.size / (1024 * 1024) : 0;

          console.log('✅ Image compressed from', originalSizeMB.toFixed(2), 'MB to', compressedSizeMB.toFixed(2), 'MB');
        } catch (compressionError: unknown) {
          const errMsg = compressionError instanceof Error ? compressionError.message : 'Unknown error';
          console.warn('⚠️ Image compression failed, using original:', errMsg);
          processedImageUri = localImageUri;
        }
      }

      // Read image as base64
      const imageBase64 = await FileSystem.readAsStringAsync(processedImageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log('📤 Calling Firebase function (3 min timeout)...');

      // Call the Firebase function - the 3-minute timeout is configured in the constructor
      const result = await this.removeBackgroundFn({ imageBase64: imageBase64 });

      const data = result.data as { success: boolean; imageUrl: string; storagePath: string };

      if (data.success && data.imageUrl) {
        console.log('✅ Firebase background removal successful!');
        console.log('📍 Image stored at:', data.imageUrl);

        // Clean up compressed image if it was created
        if (processedImageUri !== localImageUri) {
          await FileSystem.deleteAsync(processedImageUri, { idempotent: true });
        }

        // Clean up downloaded temp file if we downloaded from a remote URL
        if (isRemoteUrl && localImageUri !== imageUri) {
          await FileSystem.deleteAsync(localImageUri, { idempotent: true });
        }

        // Return the Firebase Storage URL directly
        // The image is already stored, no need for the client to re-upload
        return data.imageUrl;
      } else {
        throw new Error('Firebase function returned unsuccessful result');
      }
    } catch (error: any) {
      console.error('❌ Firebase background removal error:', error);

      // Parse Firebase function errors
      if (error.code === 'functions/unauthenticated') {
        console.error('🔒 User not authenticated');
        throw new Error('Please sign in to use background removal');
      } else if (error.code === 'functions/deadline-exceeded') {
        console.error('⏰ Request timeout');
        throw new Error('Background removal timed out. Try a smaller image.');
      }

      throw error;
    }
  }
}

// Result object to surface whether background removal succeeded
export interface BackgroundRemovalResult {
  imageUrl: string;
  success: boolean;
  errorMessage?: string;
  errorCode?: 'api_key' | 'credits_exhausted' | 'rate_limit' | 'timeout' | 'auth' | 'unknown';
}

// Cached background removal with detailed error surfacing
export class CachedBackgroundRemovalService {
  private service: BackgroundRemovalService;
  private cacheDir: string;
  private errorCount: number = 0;
  private onErrorThreshold?: (count: number) => void;
  private lastError: string | null = null;
  private lastErrorCode: BackgroundRemovalResult['errorCode'] | null = null;

  constructor(service: BackgroundRemovalService, onErrorThreshold?: (count: number) => void) {
    this.service = service;
    this.cacheDir = `${FileSystem.cacheDirectory}processed_images/`;
    this.onErrorThreshold = onErrorThreshold;
  }

  getLastError(): { message: string | null; code: BackgroundRemovalResult['errorCode'] | null } {
    return { message: this.lastError, code: this.lastErrorCode };
  }

  clearLastError(): void {
    this.lastError = null;
    this.lastErrorCode = null;
  }

  async removeBackgroundWithStatus(imageUri: string): Promise<BackgroundRemovalResult> {
    try {
      // Create cache directory if it doesn't exist
      await FileSystem.makeDirectoryAsync(this.cacheDir, { intermediates: true });

      // Create hash for caching
      const imageHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.MD5,
        imageUri
      );

      const cachedImagePath = `${this.cacheDir}${imageHash}.png`;

      // Check if cached version exists
      const cacheInfo = await FileSystem.getInfoAsync(cachedImagePath);
      if (cacheInfo.exists) {
        console.log('✅ Background removal: Using cached image');
        this.clearLastError();
        return { imageUrl: cachedImagePath, success: true };
      }

      console.log('🎨 Starting background removal for:', imageUri.substring(0, 60) + '...');

      // Process image using the selected service
      const processedUri = await this.service.removeBackground(imageUri);

      // Check if the processed URI is a remote URL or local file
      const isRemoteUrl = processedUri.startsWith('http://') || processedUri.startsWith('https://');

      if (isRemoteUrl) {
        // For remote URLs (like Firebase Storage), download to cache
        console.log('📥 Downloading processed image from Firebase Storage...');
        const downloadResult = await FileSystem.downloadAsync(processedUri, cachedImagePath);
        if (downloadResult.status !== 200) {
          throw new Error(`Failed to download processed image: HTTP ${downloadResult.status}`);
        }
      } else {
        // For local files, copy to cache
        await FileSystem.copyAsync({
          from: processedUri,
          to: cachedImagePath,
        });

        // Clean up temporary file if it's different from cache
        if (processedUri !== cachedImagePath) {
          await FileSystem.deleteAsync(processedUri, { idempotent: true });
        }
      }

      console.log('✅ Background removal successful!');
      this.clearLastError();
      return { imageUrl: cachedImagePath, success: true };

    } catch (error: unknown) {
      this.errorCount++;

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      let errorCode: BackgroundRemovalResult['errorCode'] = 'unknown';
      let userMessage = 'Background removal temporarily unavailable';

      // Categorize and log specific error types
      if (errMsg.includes('Invalid API key') || errMsg.includes('VUXO_API_KEY')) {
        errorCode = 'api_key';
        userMessage = 'Background removal service not configured';
        console.error('🔑 BACKGROUND REMOVAL ERROR: API key not configured or invalid');
        console.error('   → Check Firebase Functions secrets: VUXO_API_KEY');
      } else if (errMsg.includes('402') || errMsg.includes('payment') || errMsg.includes('credits')) {
        errorCode = 'credits_exhausted';
        userMessage = 'Background removal credits exhausted';
        console.error('💳 BACKGROUND REMOVAL ERROR: API credits exhausted');
        console.error('   → Vuxo account needs more credits');
      } else if (errMsg.includes('429') || errMsg.includes('rate limit')) {
        errorCode = 'rate_limit';
        userMessage = 'Too many requests, please try again later';
        console.error('🚦 BACKGROUND REMOVAL ERROR: Rate limit exceeded');
      } else if (errMsg.includes('timeout') || errMsg.includes('deadline') || errMsg.includes('Aborted')) {
        errorCode = 'timeout';
        userMessage = 'Request timed out, try a smaller image';
        console.error('⏰ BACKGROUND REMOVAL ERROR: Request timed out');
      } else if (errMsg.includes('unauthenticated') || errMsg.includes('sign in')) {
        errorCode = 'auth';
        userMessage = 'Please sign in to use background removal';
        console.error('🔒 BACKGROUND REMOVAL ERROR: User not authenticated');
      } else {
        console.error('❌ BACKGROUND REMOVAL ERROR:', errMsg);
        console.error('   Full error:', error);
      }

      // Store last error for UI access
      this.lastError = userMessage;
      this.lastErrorCode = errorCode;

      // Trigger callback for accumulated errors
      if (this.errorCount % 3 === 0 && this.onErrorThreshold) {
        this.onErrorThreshold(this.errorCount);
      }

      console.log('⚠️ Falling back to original image. Error count:', this.errorCount);
      return {
        imageUrl: imageUri,
        success: false,
        errorMessage: userMessage,
        errorCode
      };
    }
  }

  // Legacy method for backward compatibility - still returns original on failure
  async removeBackground(imageUri: string): Promise<string> {
    const result = await this.removeBackgroundWithStatus(imageUri);
    return result.imageUrl;
  }
}

// Factory function to create the service
export function createBackgroundRemovalService(
  type: 'removebg' | 'photoroom' | 'vuxo' | 'firebase' | 'demo' = 'demo',
  apiKey?: string,
  onErrorThreshold?: (count: number) => void
): CachedBackgroundRemovalService {
  let service: BackgroundRemovalService;

  switch (type) {
    case 'removebg':
      if (!apiKey) throw new Error('API key required for remove.bg');
      service = new RemoveBgService(apiKey);
      break;
    case 'photoroom':
      if (!apiKey) throw new Error('API key required for PhotoRoom');
      service = new PhotoRoomService(apiKey);
      break;
    case 'vuxo':
      if (!apiKey) throw new Error('API key required for Vuxo');
      service = new VuxoRemoveBgService(apiKey);
      break;
    case 'firebase':
      // Firebase-based service - API key is stored securely in the cloud function
      // No client-side API key needed
      service = new FirebaseBackgroundRemovalService();
      break;
    default:
      // Demo service that just returns original image
      service = {
        async removeBackground(imageUri: string) {
          return imageUri;
        }
      };
  }

  return new CachedBackgroundRemovalService(service, onErrorThreshold);
}

// Global background removal queue that persists across navigation
// Processes items sequentially to avoid overwhelming the service during cold starts
interface QueuedItem {
  itemId: string;
  imageUri: string;
  retryCount: number;
  addedAt: number;
  attemptId: string; // Rule C: per-attempt token to prevent stale completions
  onSuccess?: (itemId: string, newImageUrl: string) => void;
  onFailure?: (itemId: string, errorMessage: string) => void;
}

export interface BackgroundRemovalQueueCallbacks {
  onItemComplete?: (itemId: string, newImageUrl: string, attemptId: string) => void;
  onItemFailed?: (itemId: string, errorMessage: string, errorCode: BackgroundRemovalResult['errorCode'], attemptId: string) => void;
}

class BackgroundRemovalQueue {
  private queue: QueuedItem[] = [];
  private isProcessing: boolean = false;
  private service: CachedBackgroundRemovalService | null = null;
  private callbacks: BackgroundRemovalQueueCallbacks = {};
  private maxRetries: number = 2;
  private failedItems: Map<string, { message: string; code: BackgroundRemovalResult['errorCode'] }> = new Map();

  // Rule B: Track in-flight promises to deduplicate requests
  private inFlightItems: Map<string, { promise: Promise<void>; attemptId: string }> = new Map();

  // Rule C: Track current attempt IDs for each item
  private currentAttemptIds: Map<string, string> = new Map();

  // Rule D: Track completed items to prevent overwrites
  private completedItems: Set<string> = new Set();

  setService(service: CachedBackgroundRemovalService) {
    this.service = service;
  }

  setCallbacks(callbacks: BackgroundRemovalQueueCallbacks) {
    this.callbacks = callbacks;
  }

  setOnItemComplete(callback: (itemId: string, newImageUrl: string) => void) {
    this.callbacks.onItemComplete = callback;
  }

  getFailedItem(itemId: string): { message: string; code: BackgroundRemovalResult['errorCode'] } | undefined {
    return this.failedItems.get(itemId);
  }

  clearFailedItem(itemId: string) {
    this.failedItems.delete(itemId);
  }

  hasFailures(): boolean {
    return this.failedItems.size > 0;
  }

  getFailureCount(): number {
    return this.failedItems.size;
  }

  // Rule A & D: Check if item is already completed (success wins)
  isItemCompleted(itemId: string): boolean {
    return this.completedItems.has(itemId);
  }

  // Rule D: Mark an item as completed (called when we know it has a processed image)
  markItemCompleted(itemId: string) {
    this.completedItems.add(itemId);
    this.inFlightItems.delete(itemId);
    console.log(`✅ Marked ${itemId} as completed (success wins)`);
  }

  // Rule B: Check if there's an in-flight request for this item
  isItemInFlight(itemId: string): boolean {
    return this.inFlightItems.has(itemId);
  }

  // Rule C: Get the current attempt ID for an item
  getCurrentAttemptId(itemId: string): string | undefined {
    return this.currentAttemptIds.get(itemId);
  }

  // Rule C: Generate a new attempt ID
  private generateAttemptId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  addToQueue(
    itemId: string,
    imageUri: string,
    onSuccess?: (itemId: string, newImageUrl: string) => void,
    onFailure?: (itemId: string, errorMessage: string) => void
  ) {
    // Rule A & D: Never re-process completed items (success wins)
    if (this.completedItems.has(itemId)) {
      console.log(`✅ Item ${itemId} already completed, skipping (success wins)`);
      return;
    }

    // Rule B: Check if item is already in queue
    const existing = this.queue.find(item => item.itemId === itemId);
    if (existing) {
      console.log(`🔄 Item ${itemId} already in background removal queue`);
      return;
    }

    // Rule B: Check if there's already an in-flight request
    if (this.inFlightItems.has(itemId)) {
      console.log(`🔄 Item ${itemId} has in-flight request, skipping duplicate`);
      return;
    }

    // Clear any previous failure for this item (allow retry)
    this.failedItems.delete(itemId);

    // Rule C: Generate new attempt ID for this request
    const attemptId = this.generateAttemptId();
    this.currentAttemptIds.set(itemId, attemptId);

    this.queue.push({
      itemId,
      imageUri,
      retryCount: 0,
      addedAt: Date.now(),
      attemptId,
      onSuccess,
      onFailure,
    });

    console.log(`📥 Added item ${itemId} to background removal queue (attempt: ${attemptId}). Queue size: ${this.queue.length}`);

    // Start processing if not already running
    this.processQueue();
  }

  removeFromQueue(itemId: string) {
    this.queue = this.queue.filter(item => item.itemId !== itemId);
    this.failedItems.delete(itemId);
    console.log(`🗑️ Removed item ${itemId} from background removal queue`);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  isItemInQueue(itemId: string): boolean {
    return this.queue.some(item => item.itemId === itemId);
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0 || !this.service) {
      return;
    }

    this.isProcessing = true;
    console.log(`🚀 Starting background removal queue processing. Items: ${this.queue.length}`);

    while (this.queue.length > 0) {
      const item = this.queue[0];

      // Rule A & D: Skip if item was completed by another process (success wins)
      if (this.completedItems.has(item.itemId)) {
        console.log(`✅ Item ${item.itemId} already completed, skipping (success wins)`);
        this.queue.shift();
        continue;
      }

      // Rule C: Check if this attempt is still current
      const currentAttemptId = this.currentAttemptIds.get(item.itemId);
      if (currentAttemptId && currentAttemptId !== item.attemptId) {
        console.log(`🔄 Item ${item.itemId} has newer attempt (${currentAttemptId}), skipping stale attempt (${item.attemptId})`);
        this.queue.shift();
        continue;
      }

      console.log(`🎨 Processing background removal for ${item.itemId} (attempt ${item.retryCount + 1}/${this.maxRetries + 1}, attemptId: ${item.attemptId})`);

      // Rule B: Mark as in-flight
      const processPromise = (async () => {
        const startTime = Date.now();
        const result = await this.service!.removeBackgroundWithStatus(item.imageUri);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        // Rule C: Validate attemptId is still current before applying result
        const stillCurrentAttempt = this.currentAttemptIds.get(item.itemId) === item.attemptId;

        // Rule A & D: Check if item was completed while we were processing
        if (this.completedItems.has(item.itemId)) {
          console.log(`✅ Item ${item.itemId} completed by another process during our attempt, ignoring our result (success wins)`);
          return;
        }

        if (result.success) {
          console.log(`✅ Background removal complete for ${item.itemId} in ${duration}s`);

          // Rule D: Mark as completed to prevent future overwrites
          this.completedItems.add(item.itemId);
          this.inFlightItems.delete(item.itemId);

          // Only notify if this is still the current attempt
          if (stillCurrentAttempt && result.imageUrl !== item.imageUri) {
            // Notify per-item success callback first
            if (item.onSuccess) {
              item.onSuccess(item.itemId, result.imageUrl);
            }

            // Notify global success callback with attemptId
            if (this.callbacks.onItemComplete) {
              this.callbacks.onItemComplete(item.itemId, result.imageUrl, item.attemptId);
            }
          } else if (!stillCurrentAttempt) {
            console.log(`⚠️ Attempt ${item.attemptId} is stale, not notifying callbacks`);
          }
        } else {
          console.error(`❌ Background removal failed for ${item.itemId}: ${result.errorMessage}`);

          // Rule A: Don't record failure if item is already completed
          if (this.completedItems.has(item.itemId)) {
            console.log(`✅ Item ${item.itemId} is completed, ignoring failure (success wins)`);
            return;
          }

          // Increment retry count
          item.retryCount++;

          // Check if it's a permanent error (no point retrying)
          const isPermanentError = result.errorCode === 'api_key' ||
                                    result.errorCode === 'credits_exhausted' ||
                                    result.errorCode === 'auth';

          if (isPermanentError || item.retryCount > this.maxRetries) {
            console.log(`⚠️ ${isPermanentError ? 'Permanent error' : 'Max retries exceeded'} for ${item.itemId}`);

            // Clean up in-flight tracking
            this.inFlightItems.delete(item.itemId);

            // Only record failure if still current attempt
            if (stillCurrentAttempt) {
              // Record the failure
              this.failedItems.set(item.itemId, {
                message: result.errorMessage || 'Background removal failed',
                code: result.errorCode
              });

              // Notify per-item failure callback first
              if (item.onFailure) {
                item.onFailure(item.itemId, result.errorMessage || 'Unknown error');
              }

              // Notify global failure callback with attemptId
              if (this.callbacks.onItemFailed) {
                this.callbacks.onItemFailed(item.itemId, result.errorMessage || 'Unknown error', result.errorCode, item.attemptId);
              }
            }
          } else {
            // Move to end of queue for retry with delay
            this.queue.push({ ...item });

            // Wait before retrying (exponential backoff: 10s, 30s)
            const delay = Math.pow(3, item.retryCount) * 10000;
            console.log(`⏳ Retrying ${item.itemId} in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      })();

      // Rule B: Track in-flight promise
      this.inFlightItems.set(item.itemId, { promise: processPromise, attemptId: item.attemptId });

      // Wait for this item to complete
      await processPromise;

      // Remove from queue
      this.queue.shift();

      // Small delay between items to avoid overwhelming the service
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.isProcessing = false;
    console.log(`✅ Background removal queue empty. Failed items: ${this.failedItems.size}`);
  }
}

// Singleton instance
export const backgroundRemovalQueue = new BackgroundRemovalQueue();