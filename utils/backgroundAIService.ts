
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clothingDetection } from './clothingDetection';
import { photoValidation } from './photoValidation';

interface PendingAIItem {
  itemId: string;
  photoUri: string;
  timestamp: number;
}

class BackgroundAIService {
  private processingQueue: PendingAIItem[] = [];
  private isProcessing = false;

  // Add an item to the AI processing queue
  async queueItemForAI(itemId: string, photoUri: string) {
    const pendingItem: PendingAIItem = {
      itemId,
      photoUri,
      timestamp: Date.now()
    };

    this.processingQueue.push(pendingItem);

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  // Process all items in the queue
  private async processQueue() {
    if (this.processingQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const item = this.processingQueue.shift()!;
      await this.processItem(item);

      // Small delay between processing to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.isProcessing = false;
  }

  // Process a single item
  private async processItem(pendingItem: PendingAIItem) {
    try {
      console.log(`🤖 Background AI processing item: ${pendingItem.itemId}`);

      // Update status to evaluating
      await this.updateItemStatus(pendingItem.itemId, 'evaluating');

      // Run AI analysis
      const [validation, detected] = await Promise.all([
        photoValidation.validateClothingPhoto(pendingItem.photoUri),
        clothingDetection.detectClothingInImage(pendingItem.photoUri)
      ]);

      // Update the item with AI suggestions
      if (detected.length > 0) {
        await this.updateItemWithAISuggestions(pendingItem.itemId, detected[0], validation);
      }

      // Mark as done
      await this.updateItemStatus(pendingItem.itemId, 'done');

      console.log(`✅ Background AI processing complete for item: ${pendingItem.itemId}`);

    } catch (error) {
      console.error(`❌ Background AI processing failed for item: ${pendingItem.itemId}`, error);

      // Mark as done even if failed - user can still use the item
      await this.updateItemStatus(pendingItem.itemId, 'done');
    }
  }

  // Update item status
  private async updateItemStatus(itemId: string, status: 'evaluating' | 'done' | 'error') {
    try {
      const statusData = await AsyncStorage.getItem('photoStatus');
      const currentStatus = statusData ? JSON.parse(statusData) : {};

      currentStatus[itemId] = {
        status,
        result: status === 'done' ? {
          isValid: true,
          clothingItems: ['Item'],
          message: 'AI analysis complete'
        } : null,
        timestamp: Date.now()
      };

      await AsyncStorage.setItem('photoStatus', JSON.stringify(currentStatus));
    } catch (error) {
      console.error('Error updating item status:', error);
    }
  }

  // Update item with AI suggestions
  private async updateItemWithAISuggestions(itemId: string, detectedItem: any, validation: any) {
    try {
      const { auth, db } = await import('@/config/firebase');
      const { doc, serverTimestamp, setDoc } = await import('firebase/firestore');
      const user = auth.currentUser;

      if (!user) return;

      const aiSuggestions = {
        ...clothingDetection.buildAutoDetectedMetadata(detectedItem),
        details: detectedItem.detailedDescription?.details || '',
        validationResult: validation,
      };

      await setDoc(
        doc(db, 'closetItems', itemId),
        {
          aiSuggestions,
          userId: user.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      console.log(`💡 AI suggestions stored for item: ${itemId}`);

    } catch (error) {
      console.error('Error updating item with AI suggestions:', error);
    }
  }
}

export const backgroundAIService = new BackgroundAIService();
