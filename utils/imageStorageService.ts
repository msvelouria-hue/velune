import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/config/firebase';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

const MAX_IMAGE_SIZE = 500;

export const uploadClothingImage = async (
  imageUri: string,
  itemId?: string
): Promise<string> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user');
  }

  try {
    const manipulatedImage = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: MAX_IMAGE_SIZE, height: MAX_IMAGE_SIZE } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.WEBP }
    );

    const response = await fetch(manipulatedImage.uri);
    const blob = await response.blob();

    const filename = itemId || `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const storageRef = ref(storage, `users/${user.uid}/clothing/${filename}.webp`);

    await uploadBytes(storageRef, blob);

    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  } catch (error) {
    console.error('Error uploading image to Firebase Storage:', error);
    throw error;
  }
};

// NOTE: deleteClothingImage removed - use cloudSyncService.deleteItem() instead
// NOTE: uploadProfileImage removed - was unused
