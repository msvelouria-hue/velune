import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/config/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PromptType =
  | 'clothing_detection'
  | 'photo_validation'
  | 'outfit_selection_premium'
  | 'stylist_comment'
  | 'hair_suggestion';

export interface PromptLogEntry {
  userId: string;
  timestamp: Timestamp;
  promptType: PromptType;
  model: string;
  prompt: string;
  response: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
}

const getUserId = async (): Promise<string | null> => {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  try {
    const cachedUserId = await AsyncStorage.getItem('lastAuthUserId');
    if (cachedUserId) {
      console.log('📝 Using cached userId for prompt logging');
      return cachedUserId;
    }
  } catch (e) {
    console.warn('Could not get cached userId:', e);
  }

  return null;
};

export const cacheUserId = async (userId: string): Promise<void> => {
  try {
    await AsyncStorage.setItem('lastAuthUserId', userId);
  } catch (e) {
    console.warn('Could not cache userId:', e);
  }
};

export const logPrompt = async (
  promptType: PromptType,
  model: string,
  prompt: string,
  response: string,
  options?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    success?: boolean;
    errorMessage?: string;
  }
): Promise<void> => {
  const userId = await getUserId();
  if (!userId) {
    console.warn(`⚠️ Cannot log prompt (${promptType}): no authenticated user and no cached userId`);
    return;
  }

  try {
    const logEntry: PromptLogEntry = {
      userId,
      timestamp: Timestamp.now(),
      promptType,
      model,
      prompt,
      response,
      promptTokens: options?.promptTokens,
      completionTokens: options?.completionTokens,
      totalTokens: options?.totalTokens,
      durationMs: options?.durationMs,
      success: options?.success ?? true,
      errorMessage: options?.errorMessage,
    };

    const cleanedEntry = Object.fromEntries(
      Object.entries(logEntry).filter(([_, v]) => v !== undefined)
    );

    await addDoc(collection(db, 'promptLogs'), cleanedEntry);
    console.log(`📝 Logged ${promptType} prompt (${model})`);
  } catch (error: any) {
    console.warn('⚠️ Could not log prompt:', error?.message || error);
  }
};

export const logPromptWithTiming = async (
  promptType: PromptType,
  model: string,
  prompt: string,
  apiCall: () => Promise<{ response: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }>
): Promise<string> => {
  const startTime = Date.now();

  try {
    const result = await apiCall();
    const durationMs = Date.now() - startTime;

    await logPrompt(promptType, model, prompt, result.response, {
      promptTokens: result.usage?.prompt_tokens,
      completionTokens: result.usage?.completion_tokens,
      totalTokens: result.usage?.total_tokens,
      durationMs,
      success: true,
    });

    return result.response;
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    await logPrompt(promptType, model, prompt, '', {
      durationMs,
      success: false,
      errorMessage: error?.message || 'Unknown error',
    });

    throw error;
  }
};
