import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from '@/config/firebase';

type SecureAiTask =
  | 'photo_validation'
  | 'clothing_detection'
  | 'premium_outfits'
  | 'stylist_comment'
  | 'hair_suggestion';

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface SecureAiTaskResponse {
  content: string;
  model: string;
  usage?: OpenAiUsage;
}

type SecureAiTaskRequest =
  | {
      task: 'photo_validation' | 'clothing_detection';
      base64Image: string;
    }
  | {
      task: 'premium_outfits' | 'stylist_comment';
      systemPrompt: string;
      prompt: string;
    }
  | {
      task: 'hair_suggestion';
      prompt: string;
    };

class SecureAiProxy {
  private functions = getFunctions(app);
  private runSecureAiTask = httpsCallable<
    SecureAiTaskRequest,
    SecureAiTaskResponse
  >(this.functions, 'runSecureAiTask', {
    timeout: 180000,
  });

  private async invoke(request: SecureAiTaskRequest): Promise<SecureAiTaskResponse> {
    if (!auth.currentUser) {
      throw new Error('User must be authenticated before calling AI services');
    }

    const result = await this.runSecureAiTask(request);
    return result.data;
  }

  validateClothingPhoto(base64Image: string): Promise<SecureAiTaskResponse> {
    return this.invoke({ task: 'photo_validation', base64Image });
  }

  detectClothing(base64Image: string): Promise<SecureAiTaskResponse> {
    return this.invoke({ task: 'clothing_detection', base64Image });
  }

  generatePremiumOutfits(
    systemPrompt: string,
    prompt: string
  ): Promise<SecureAiTaskResponse> {
    return this.invoke({ task: 'premium_outfits', systemPrompt, prompt });
  }

  generateStylistComment(
    systemPrompt: string,
    prompt: string
  ): Promise<SecureAiTaskResponse> {
    return this.invoke({ task: 'stylist_comment', systemPrompt, prompt });
  }

  generateHairSuggestion(prompt: string): Promise<SecureAiTaskResponse> {
    return this.invoke({ task: 'hair_suggestion', prompt });
  }
}

export const secureAiProxy = new SecureAiProxy();
export type { OpenAiUsage, SecureAiTask, SecureAiTaskResponse };
