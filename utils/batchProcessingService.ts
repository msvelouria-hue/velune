import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage as firebaseStorage } from '@/config/firebase';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

interface BatchPhoto {
  uri: string;
  tempId: string;
}

export interface BatchResult {
  tempId: string;
  success: boolean;
  itemId?: string;
  error?: string;
  detectedItems?: Array<{
    name: string;
    detectedType: string;
    confidence: number;
    category: string;
    color?: string;
    pattern?: string;
    material?: string;
    style?: string;
    fit?: string;
    silhouette?: string;
    neckline?: string;
    sleeveLength?: string;
    length?: string;
    closure?: string;
    rise?: string;
    wash?: string;
    heelHeight?: string;
    toeShape?: string;
    hardware?: string;
    brandOrLogo?: string;
    formality?: string;
    warmth?: string;
    layeringRole?: string;
    season?: string[];
    event?: string[];
    stylingNotes?: string;
    details?: string;
  }>;
}

export interface BatchProcessingResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  totalItemsDetected: number;
  results: BatchResult[];
}

class BatchProcessingService {
  private maxPhotosPerBatch = 20;

  async processPhotos(
    photos: BatchPhoto[],
    onProgress?: (current: number, total: number, status: string) => void
  ): Promise<BatchProcessingResult> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated');
    }

    if (photos.length === 0) {
      return {
        success: true,
        processed: 0,
        successful: 0,
        failed: 0,
        totalItemsDetected: 0,
        results: [],
      };
    }

    console.log(`📸 Starting batch processing: ${photos.length} photos`);
    onProgress?.(0, photos.length, 'Preparing photos...');

    const uploadedPhotos: Array<{ imageUrl: string; tempId: string }> = [];

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      onProgress?.(i + 1, photos.length, `Uploading photo ${i + 1} of ${photos.length}...`);

      try {
        const imageUrl = await this.uploadPhotoToStorage(photo.uri, photo.tempId, user.uid);
        uploadedPhotos.push({ imageUrl, tempId: photo.tempId });
        console.log(`✅ Uploaded ${photo.tempId}`);
      } catch (error) {
        console.error(`❌ Failed to upload ${photo.tempId}:`, error);
      }
    }

    if (uploadedPhotos.length === 0) {
      throw new Error('Failed to upload any photos');
    }

    onProgress?.(photos.length, photos.length, 'AI is analyzing your clothes...');

    const functions = getFunctions();
    const batchProcessPhotos = httpsCallable<
      { photos: Array<{ imageUrl: string; tempId: string }> },
      BatchProcessingResult
    >(functions, 'batchProcessPhotos', {
      timeout: 600000,
    });

    try {
      const result = await batchProcessPhotos({ photos: uploadedPhotos });
      console.log(`✅ Batch processing complete:`, result.data);
      return result.data;
    } catch (error: any) {
      console.error('❌ Batch processing failed:', error);
      throw new Error(error.message || 'Batch processing failed');
    }
  }

  private async uploadPhotoToStorage(
    uri: string,
    tempId: string,
    userId: string
  ): Promise<string> {
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    const response = await fetch(resized.uri);
    const blob = await response.blob();

    const storage = getStorage();
    const timestamp = Date.now();
    const storagePath = `users/${userId}/uploads/${tempId}_${timestamp}.jpg`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, blob);
    const downloadUrl = await getDownloadURL(storageRef);

    return downloadUrl;
  }

  async processPhotosInChunks(
    photos: BatchPhoto[],
    onProgress?: (current: number, total: number, status: string) => void,
    onChunkComplete?: (chunkResults: BatchProcessingResult) => void
  ): Promise<BatchProcessingResult> {
    const allResults: BatchResult[] = [];
    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalItems = 0;

    const chunks: BatchPhoto[][] = [];
    for (let i = 0; i < photos.length; i += this.maxPhotosPerBatch) {
      chunks.push(photos.slice(i, i + this.maxPhotosPerBatch));
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const chunkStart = chunkIndex * this.maxPhotosPerBatch;

      const wrappedProgress = (current: number, total: number, status: string) => {
        onProgress?.(
          chunkStart + current,
          photos.length,
          `Chunk ${chunkIndex + 1}/${chunks.length}: ${status}`
        );
      };

      try {
        const chunkResult = await this.processPhotos(chunk, wrappedProgress);
        allResults.push(...chunkResult.results);
        totalProcessed += chunkResult.processed;
        totalSuccessful += chunkResult.successful;
        totalFailed += chunkResult.failed;
        totalItems += chunkResult.totalItemsDetected;

        onChunkComplete?.(chunkResult);
      } catch (error) {
        console.error(`Chunk ${chunkIndex + 1} failed:`, error);
        totalFailed += chunk.length;
      }
    }

    return {
      success: totalSuccessful > 0,
      processed: totalProcessed,
      successful: totalSuccessful,
      failed: totalFailed,
      totalItemsDetected: totalItems,
      results: allResults,
    };
  }
}

export const batchProcessingService = new BatchProcessingService();
