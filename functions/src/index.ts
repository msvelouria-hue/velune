import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import fetch from "node-fetch";
import FormData from "form-data";
import {randomUUID} from "crypto";
import {
  parseClothingDetectionContent,
  runClothingDetectionTask,
} from "./secureAi";
export {runSecureAiTask} from "./secureAi";

admin.initializeApp();

const storage = admin.storage();
const db = admin.firestore();
const STORAGE_BUCKET_NAME = "style-genie-f65ef.firebasestorage.app";
const FIREBASE_DOWNLOAD_TOKEN_METADATA = "firebaseStorageDownloadTokens";

function createFirebaseDownloadUrl(storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET_NAME}/o/${
    encodeURIComponent(storagePath)
  }?alt=media&token=${token}`;
}

async function saveImageWithFirebaseDownloadUrl(
  file: any,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
  customMetadata: Record<string, string> = {}
): Promise<string> {
  const token = randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: {
        ...customMetadata,
        [FIREBASE_DOWNLOAD_TOKEN_METADATA]: token,
      },
    },
  });

  return createFirebaseDownloadUrl(storagePath, token);
}

interface RemoveBackgroundRequest {
  imageBase64: string;
  fileName?: string;
}

export const removeBackground = functions
  .runWith({
    secrets: ["VUXO_API_KEY"],
    timeoutSeconds: 300, // 5 minutes to allow for large images
    memory: "512MB",
  })
  .https.onCall(
    async (
      data: RemoveBackgroundRequest,
      context: functions.https.CallableContext
    ) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "User must be authenticated to use this function"
        );
      }

      const userId = context.auth.uid;
      const {imageBase64, fileName} = data;

      if (!imageBase64) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "imageBase64 is required"
        );
      }

      const vuxoApiKey = process.env.VUXO_API_KEY!;

      try {
      console.log(`Processing background removal for user: ${userId}`);

      const imageBuffer = Buffer.from(imageBase64, "base64");
      console.log(`Image size: ${imageBuffer.length} bytes`);

      const formData = new FormData();
      formData.append("api_key", vuxoApiKey);
      formData.append("image", imageBuffer, {
        filename: "image.jpg",
        contentType: "image/jpeg",
      });

      console.log("Making request to Vuxo API...");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout for Vuxo API

      const response = await fetch("https://rembg.vuxo.com/image-submit", {
        method: "POST",
        body: formData,
        signal: controller.signal as any,
      });

      clearTimeout(timeoutId);

      console.log(`Vuxo API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Vuxo API error: ${response.status} - ${errorText}`);
        throw new functions.https.HttpsError(
          "internal",
          `Background removal failed: ${response.status}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const processedImageBuffer = Buffer.from(arrayBuffer);

      if (processedImageBuffer.length === 0) {
        throw new functions.https.HttpsError(
          "internal",
          "Received empty image from background removal service"
        );
      }

      console.log(
        `Processed image size: ${processedImageBuffer.length} bytes`
      );

      const bucket = storage.bucket(STORAGE_BUCKET_NAME);
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const storagePath = `users/${userId}/clothing/${
        fileName || `${timestamp}_${randomStr}`
      }.png`;

      const file = bucket.file(storagePath);
      const publicUrl = await saveImageWithFirebaseDownloadUrl(
        file,
        storagePath,
        processedImageBuffer,
        "image/png",
        {
          processedAt: new Date().toISOString(),
          originalSize: imageBuffer.length.toString(),
          processedSize: processedImageBuffer.length.toString(),
        }
      );

      console.log(`Image stored successfully at: ${publicUrl}`);

      return {
        success: true,
        imageUrl: publicUrl,
        storagePath: storagePath,
      };
    } catch (error: any) {
      console.error("Background removal error:", error);

      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      if (error.name === "AbortError") {
        throw new functions.https.HttpsError(
          "deadline-exceeded",
          "Background removal request timed out"
        );
      }

      throw new functions.https.HttpsError(
        "internal",
        `Background removal failed: ${error.message}`
      );
    }
  }
);

// Async background removal that persists results directly to Firestore
// This runs independently and survives app closure
interface AsyncBackgroundRemovalRequest {
  itemId: string;
  originalImageUrl: string;
}

export const processBackgroundRemovalAsync = functions
  .runWith({
    secrets: ["VUXO_API_KEY"],
    timeoutSeconds: 300, // 5 minutes
    memory: "512MB",
  })
  .https.onCall(
    async (
      data: AsyncBackgroundRemovalRequest,
      context: functions.https.CallableContext
    ) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "User must be authenticated"
        );
      }

      const userId = context.auth.uid;
      const {itemId, originalImageUrl} = data;

      if (!itemId || !originalImageUrl) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "itemId and originalImageUrl are required"
        );
      }

      console.log(`🎨 Starting async background removal for item: ${itemId}`);

      // Update status to processing
      const itemRef = db.collection("closetItems").doc(itemId);
      await itemRef.update({
        backgroundRemovalStatus: "processing",
        backgroundRemovalStartedAt: new Date().toISOString(),
      });

      try {
        // Download the original image
        console.log(`📥 Downloading image from: ${originalImageUrl}`);
        const imageResponse = await fetch(originalImageUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.status}`);
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        console.log(`📊 Downloaded image: ${imageBuffer.length} bytes`);

        // Call Vuxo API
        const vuxoApiKey = process.env.VUXO_API_KEY!;
        const formData = new FormData();
        formData.append("api_key", vuxoApiKey);
        formData.append("image", imageBuffer, {
          filename: "image.jpg",
          contentType: "image/jpeg",
        });

        console.log("📤 Calling Vuxo API...");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        const response = await fetch("https://rembg.vuxo.com/image-submit", {
          method: "POST",
          body: formData,
          signal: controller.signal as any,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Vuxo API error: ${response.status} - ${errorText}`);
          throw new Error(`Background removal failed: ${response.status}`);
        }

        const processedBuffer = Buffer.from(await response.arrayBuffer());
        if (processedBuffer.length === 0) {
          throw new Error("Received empty image from Vuxo");
        }

        console.log(`✅ Processed image: ${processedBuffer.length} bytes`);

        // Save to Firebase Storage
        const bucket = storage.bucket(STORAGE_BUCKET_NAME);
        const storagePath = `users/${userId}/clothing/${itemId}_nobg.png`;
        const file = bucket.file(storagePath);

        const publicUrl = await saveImageWithFirebaseDownloadUrl(
          file,
          storagePath,
          processedBuffer,
          "image/png",
          {
            processedAt: new Date().toISOString(),
            originalUrl: originalImageUrl,
          }
        );

        console.log(`💾 Saved processed image: ${publicUrl}`);

        // Update Firestore with the new image URL
        await itemRef.update({
          imageUrl: publicUrl,
          backgroundRemovalStatus: "complete",
          backgroundRemovalCompletedAt: new Date().toISOString(),
          processedImageUrl: publicUrl,
        });

        console.log(`✅ Item ${itemId} updated with background-removed image`);

        return {
          success: true,
          itemId,
          imageUrl: publicUrl,
        };
      } catch (error: any) {
        console.error(`❌ Background removal failed for ${itemId}:`, error);

        // Update status to failed
        await itemRef.update({
          backgroundRemovalStatus: "failed",
          backgroundRemovalError: error.message,
          backgroundRemovalFailedAt: new Date().toISOString(),
        });

        throw new functions.https.HttpsError(
          "internal",
          `Background removal failed: ${error.message}`
        );
      }
    }
  );

// Batch process multiple photos with AI detection
interface BatchProcessPhotosRequest {
  photos: Array<{
    imageUrl: string;
    tempId: string; // Client-side temporary ID for tracking
  }>;
}

interface DetectedItem {
  name: string;
  detectedType: string;
  confidence: number;
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
  season?: string[] | string;
  event?: string[] | string;
  stylingNotes?: string;
  details?: string;
  category: string;
}

const DETECTION_DETAIL_FIELDS = [
  "fit",
  "silhouette",
  "neckline",
  "sleeveLength",
  "length",
  "closure",
  "rise",
  "wash",
  "heelHeight",
  "toeShape",
  "hardware",
  "brandOrLogo",
  "formality",
  "warmth",
  "layeringRole",
  "stylingNotes",
] as const;

const ALLOWED_SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const ALLOWED_EVENTS = ["Casual", "Formal", "Athletic", "Party"];

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  return [];
}

function allowedTags(value: unknown, allowed: string[]): string[] {
  const normalizedAllowed = new Map(allowed.map((tag) => [tag.toLowerCase(), tag]));
  return stringArray(value)
    .map((tag) => normalizedAllowed.get(tag.toLowerCase()))
    .filter((tag): tag is string => Boolean(tag));
}

function buildDetectionDetailPayload(item: DetectedItem): Record<string, string> {
  const payload: Record<string, string> = {};

  for (const field of DETECTION_DETAIL_FIELDS) {
    const value = item[field];
    if (typeof value === "string") {
      payload[field] = value;
    }
  }

  return payload;
}

function buildDetectedItemNotes(item: DetectedItem): string {
  return item.details?.trim() || "";
}

function getLayerTypeFromDetectedItem(item: DetectedItem): string | undefined {
  const role = item.layeringRole?.toLowerCase();
  if (role === "base" || role === "mid" || role === "outer") {
    return role;
  }

  const type = item.detectedType?.toLowerCase() || "";
  const material = item.material?.toLowerCase() || "";
  if (["jacket", "coat", "blazer", "parka", "raincoat", "trench"].some((entry) => type.includes(entry))) {
    return "outer";
  }
  if (["sweater", "sweatshirt", "hoodie", "cardigan", "pullover", "fleece"].some((entry) => type.includes(entry)) || material.includes("knit")) {
    return "mid";
  }
  if (["shirt", "t-shirt", "tank", "tee", "blouse", "top"].some((entry) => type.includes(entry))) {
    return "base";
  }

  return undefined;
}

const CLOTHING_CATEGORIES: { [key: string]: string } = {
  "shirt": "Tops", "t-shirt": "Tops", "blouse": "Tops", "tank": "Tops",
  "top": "Tops", "sweater": "Tops", "hoodie": "Tops",
  "sweatshirt": "Tops", "pullover": "Tops", "fleece": "Outerwear",
  "jacket": "Outerwear", "coat": "Outerwear", "blazer": "Outerwear",
  "cardigan": "Outerwear", "vest": "Outerwear", "pants": "Bottoms",
  "jeans": "Bottoms", "shorts": "Bottoms", "skirt": "Bottoms",
  "leggings": "Bottoms", "trousers": "Bottoms", "dress": "Dresses",
  "gown": "Dresses", "jumpsuit": "Dresses", "romper": "Dresses",
  "shoes": "Shoes", "sneakers": "Shoes", "boots": "Shoes",
  "sandals": "Shoes", "sandal": "Shoes", "heels": "Shoes", "flats": "Shoes",
  "slippers": "Shoes", "loafers": "Shoes", "oxfords": "Shoes",
  "hat": "Accessories", "cap": "Accessories", "beanie": "Accessories",
  "bag": "Accessories", "purse": "Accessories", "backpack": "Accessories",
  "belt": "Accessories", "scarf": "Accessories", "gloves": "Accessories",
  "lipstick": "Makeup", "eyeshadow": "Makeup", "mascara": "Makeup",
  "foundation": "Makeup", "makeup": "Makeup", "cosmetics": "Makeup",
};

function getCategoryFromType(type: string): string {
  const lowerType = type.toLowerCase();
  for (const [keyword, category] of Object.entries(CLOTHING_CATEGORIES)) {
    if (lowerType.includes(keyword)) {
      return category;
    }
  }
  return "Accessories";
}

export const batchProcessPhotos = functions
  .runWith({
    secrets: ["OPENAI_API_KEY", "VUXO_API_KEY"],
    timeoutSeconds: 540, // 9 minutes for batch processing
    memory: "1GB",
  })
  .https.onCall(
    async (
      data: BatchProcessPhotosRequest,
      context: functions.https.CallableContext
    ) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "User must be authenticated"
        );
      }

      const userId = context.auth.uid;
      const {photos} = data;

      if (!photos || !Array.isArray(photos) || photos.length === 0) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "photos array is required"
        );
      }

      console.log(`📸 Starting batch processing: ${photos.length} photos for user ${userId}`);

      const vuxoApiKey = process.env.VUXO_API_KEY;

      const results: Array<{
        tempId: string;
        success: boolean;
        itemId?: string;
        error?: string;
        detectedItems?: DetectedItem[];
      }> = [];

      // Process photos in parallel batches of 3 to balance speed and API limits
      const batchSize = 3;
      for (let i = 0; i < photos.length; i += batchSize) {
        const batch = photos.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(photos.length/batchSize)}`);

        const batchResults = await Promise.allSettled(
          batch.map(async (photo) => {
            try {
              // Download the image
              const imageResponse = await fetch(photo.imageUrl);
              if (!imageResponse.ok) {
                throw new Error(`Failed to download: ${imageResponse.status}`);
              }
              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
              const base64Image = imageBuffer.toString("base64");
              const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

              console.log(`🔍 Analyzing image ${photo.tempId}...`);
              const detectionResponse = await runClothingDetectionTask(base64Image, mimeType);
              const detectedItems: DetectedItem[] = parseClothingDetectionContent(detectionResponse.content)
                .map((item) => {
                  const detectedType = item.detectedType || "accessory";
                  return {
                    ...item,
                    detectedType,
                    category: getCategoryFromType(detectedType),
                  };
                });

              console.log(`✅ Detected ${detectedItems.length} items in ${photo.tempId}`);

              // If items detected, save them to Firestore
              if (detectedItems.length > 0) {
                for (const item of detectedItems) {
                  const itemId = db.collection("closetItems").doc().id;

                  // Process background removal if API key available
                  let processedImageUrl = photo.imageUrl;
                  if (vuxoApiKey) {
                    try {
                      const formData = new FormData();
                      formData.append("api_key", vuxoApiKey);
                      formData.append("image", imageBuffer, {
                        filename: "image.jpg",
                        contentType: "image/jpeg",
                      });

                      const bgResponse = await fetch("https://rembg.vuxo.com/image-submit", {
                        method: "POST",
                        body: formData,
                      });

                      if (bgResponse.ok) {
                        const processedBuffer = Buffer.from(await bgResponse.arrayBuffer());
                        if (processedBuffer.length > 0) {
                          // Save to Storage
                          const bucket = storage.bucket(STORAGE_BUCKET_NAME);
                          const storagePath = `users/${userId}/clothing/${itemId}.png`;
                          const file = bucket.file(storagePath);
                          processedImageUrl = await saveImageWithFirebaseDownloadUrl(
                            file,
                            storagePath,
                            processedBuffer,
                            "image/png"
                          );
                          console.log(`🎨 Background removed for ${itemId}`);
                        }
                      }
                    } catch (bgErr) {
                      console.warn(`Background removal failed for ${itemId}:`, bgErr);
                    }
                  }

                  // Save item to Firestore
                  const layerType = getLayerTypeFromDetectedItem(item);
                  const firestoreItem = {
                    userId,
                    imageUrl: processedImageUrl,
                    originalImageUrl: photo.imageUrl,
                    category: item.category,
                    color: item.color || "",
                    pattern: item.pattern || "",
                    material: item.material || "",
                    style: item.style || "",
                    ...buildDetectionDetailPayload(item),
                    notes: buildDetectedItemNotes(item),
                    tags: {
                      season: allowedTags(item.season, ALLOWED_SEASONS),
                      event: allowedTags(item.event, ALLOWED_EVENTS),
                    },
                    dateAdded: new Date().toISOString(),
                    isAutoDetected: true,
                    detectedType: item.detectedType,
                    confidence: item.confidence,
                    tempId: photo.tempId,
                    batchProcessed: true,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    ...(layerType ? {layerType} : {}),
                  };

                  await db.collection("closetItems").doc(itemId).set(firestoreItem);

                  console.log(`💾 Saved item ${itemId} to Firestore`);
                }
              }

              return {
                tempId: photo.tempId,
                success: true,
                detectedItems,
                itemCount: detectedItems.length,
              };
            } catch (error: any) {
              console.error(`❌ Failed to process ${photo.tempId}:`, error.message);
              return {
                tempId: photo.tempId,
                success: false,
                error: error.message,
              };
            }
          })
        );

        // Collect results
        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
          } else {
            results.push({
              tempId: "unknown",
              success: false,
              error: result.reason?.message || "Unknown error",
            });
          }
        }

        // Small delay between batches to avoid rate limits
        if (i + batchSize < photos.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const totalItems = results.reduce((sum, r) => sum + (r.detectedItems?.length || 0), 0);

      console.log(`✅ Batch complete: ${successCount}/${photos.length} photos, ${totalItems} items detected`);

      return {
        success: true,
        processed: photos.length,
        successful: successCount,
        failed: photos.length - successCount,
        totalItemsDetected: totalItems,
        results,
      };
    }
  );

interface DeleteClosetItemRequest {
  itemId: string;
}

export const deleteClosetItem = functions
  .runWith({
    timeoutSeconds: 60,
    memory: "256MB",
  })
  .https.onCall(
    async (
      data: DeleteClosetItemRequest,
      context: functions.https.CallableContext
    ) => {
      if (!context.auth) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "User must be authenticated to delete items"
        );
      }

      const userId = context.auth.uid;
      const {itemId} = data;

      if (!itemId) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "itemId is required"
        );
      }

      console.log(`🗑️ Deleting item ${itemId} for user ${userId}`);

      const bucket = storage.bucket("style-genie-f65ef.firebasestorage.app");
      const errors: string[] = [];
      let firestoreDeleted = false;
      let storageFilesDeleted = 0;

      try {
        // Step 1: Get the item from Firestore to find the imageUrl
        const itemDoc = await db.collection("closetItems").doc(itemId).get();
        let imageUrl: string | null = null;

        if (itemDoc.exists) {
          const itemData = itemDoc.data();
          imageUrl = itemData?.imageUrl || null;

          // Verify the item belongs to this user
          if (itemData?.userId !== userId) {
            throw new functions.https.HttpsError(
              "permission-denied",
              "You can only delete your own items"
            );
          }
        }

        // Step 2: Delete associated files from Storage
        // Try multiple possible file patterns
        const possiblePaths = [
          `users/${userId}/clothing/${itemId}.webp`,
          `users/${userId}/clothing/${itemId}.png`,
          `users/${userId}/clothing/${itemId}.jpg`,
        ];

        // Also try to extract path from imageUrl if available
        if (imageUrl && imageUrl.includes("storage.googleapis.com")) {
          try {
            const urlPath = new URL(imageUrl).pathname;
            // Extract the path after the bucket name
            const pathMatch = urlPath.match(/\/[^/]+\/(.+)/);
            if (pathMatch && pathMatch[1]) {
              const decodedPath = decodeURIComponent(pathMatch[1]);
              if (!possiblePaths.includes(decodedPath)) {
                possiblePaths.unshift(decodedPath); // Add to front as most likely
              }
            }
          } catch (urlError) {
            console.warn("Could not parse imageUrl:", urlError);
          }
        }

        // Also search for files with the itemId prefix (handles timestamped files)
        try {
          const [files] = await bucket.getFiles({
            prefix: `users/${userId}/clothing/${itemId}`,
          });

          for (const file of files) {
            try {
              await file.delete();
              storageFilesDeleted++;
              console.log(`🗑️ Deleted file: ${file.name}`);
            } catch (fileError: any) {
              console.warn(`⚠️ Could not delete file ${file.name}:`, fileError);
              errors.push(`storage:${file.name}`);
            }
          }
        } catch (listError) {
          console.warn("Could not list files with prefix:", listError);
        }

        // Try deleting from known paths (in case prefix search missed them)
        for (const path of possiblePaths) {
          try {
            const file = bucket.file(path);
            const [exists] = await file.exists();
            if (exists) {
              await file.delete();
              storageFilesDeleted++;
              console.log(`🗑️ Deleted file: ${path}`);
            }
          } catch (deleteError: any) {
            // Ignore "not found" errors
            if (deleteError.code !== 404) {
              console.warn(`⚠️ Could not delete ${path}:`, deleteError);
            }
          }
        }

        // Step 3: Delete the Firestore document
        if (itemDoc.exists) {
          await db.collection("closetItems").doc(itemId).delete();
          firestoreDeleted = true;
          console.log(`🗑️ Deleted Firestore document: ${itemId}`);
        }

        console.log(
          `✅ Delete complete for ${itemId}: ` +
          `firestore=${firestoreDeleted}, storage=${storageFilesDeleted} files`
        );

        return {
          success: true,
          itemId,
          firestoreDeleted,
          storageFilesDeleted,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (error: any) {
        console.error(`❌ Delete failed for ${itemId}:`, error);

        if (error instanceof functions.https.HttpsError) {
          throw error;
        }

        throw new functions.https.HttpsError(
          "internal",
          `Failed to delete item: ${error.message}`
        );
      }
    }
  );

export const cleanupOldPromptLogs = functions.pubsub
  .schedule("every day 03:00")
  .timeZone("America/Los_Angeles")
  .onRun(async () => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    const cutoffTimestamp = cutoffDate.toISOString();

    console.log(`🧹 Starting prompt log cleanup. Deleting logs older than ${cutoffTimestamp}`);

    try {
      const promptLogsRef = db.collection("promptLogs");
      const oldLogsQuery = promptLogsRef.where("timestamp", "<", cutoffTimestamp);
      const snapshot = await oldLogsQuery.get();

      if (snapshot.empty) {
        console.log("✅ No old prompt logs to delete");
        return null;
      }

      const batch = db.batch();
      let deleteCount = 0;

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });

      if (deleteCount > 500) {
        console.log(`⚠️ Large batch detected (${deleteCount} docs). Deleting in chunks...`);
        const chunks = [];
        for (let i = 0; i < snapshot.docs.length; i += 500) {
          chunks.push(snapshot.docs.slice(i, i + 500));
        }

        for (const chunk of chunks) {
          const chunkBatch = db.batch();
          chunk.forEach((doc) => chunkBatch.delete(doc.ref));
          await chunkBatch.commit();
          console.log(`🗑️ Deleted batch of ${chunk.length} logs`);
        }
      } else {
        await batch.commit();
      }

      console.log(`✅ Cleanup complete: deleted ${deleteCount} prompt logs older than 1 week`);
      return null;
    } catch (error: any) {
      console.error("❌ Prompt log cleanup failed:", error.message);
      return null;
    }
  });
