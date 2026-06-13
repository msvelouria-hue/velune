import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { logPrompt } from './promptLogService';
import {
  parsePhotoValidationResponse,
  type ParsedPhotoValidationResult,
} from './photoValidationParsing';
import { secureAiProxy } from './secureAiProxy';

export type PhotoValidationResult = ParsedPhotoValidationResult;

export interface UploadStatus {
  status: 'uploading' | 'evaluating' | 'done' | 'needs_clarification' | 'error';
  message: string;
  progress?: number;
}

export class PhotoValidationService {
  async validateClothingPhoto(imageUri: string): Promise<PhotoValidationResult> {
    try {
      const base64Image = await this.prepareImageForValidation(imageUri);
      const { content, usage } = await secureAiProxy.validateClothingPhoto(base64Image);

      if (!content) {
        throw new Error('No response from ChatGPT');
      }

      // Log prompt to Firestore (non-blocking)
      const promptText = 'Validate clothing photo - check if image contains valid clothing items';
      logPrompt('photo_validation', 'gpt-4o-mini', promptText, content, {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      });

      return parsePhotoValidationResponse(content);

    } catch (error) {
      console.error('Photo validation error:', error);

      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

      if (errorCode === 'functions/resource-exhausted') {
        console.warn('Rate limit reached, using simulation mode for this request');
        return this.simulateValidation();
      }

      return {
        isValid: false,
        clothingItems: [],
        message: 'Failed to validate photo. Please try again.'
      };
    }
  }

  private async prepareImageForValidation(imageUri: string): Promise<string> {
    const manipulatedImage = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1024 } }],
      {
        compress: 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );

    try {
      return await FileSystem.readAsStringAsync(manipulatedImage.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } finally {
      if (manipulatedImage.uri !== imageUri) {
        await FileSystem.deleteAsync(manipulatedImage.uri, { idempotent: true });
      }
    }
  }

  private simulateValidation(): PhotoValidationResult {
    // For simulation mode, return a generic valid response without specific items
    // This prevents misleading results when OpenAI API is not available
    return {
      isValid: true,
      clothingItems: ['Clothing item'],
      message: 'Photo validated - clothing item detected (simulation mode)'
    };
  }

}

export const photoValidation = new PhotoValidationService();
