# TODO

## Code Consolidation

### Background Removal Code Duplication
**Priority:** Medium
**Status:** Pending

The background removal logic is duplicated across multiple files. Consolidate into a single shared utility.

**Files with duplicate code:**
- `app/(tabs)/index.tsx` - `processPhotoAndReplaceEvaluatingCard` function
- `app/add-clothing-item.tsx` - `backgroundRemovalService` initialization
- `app/onboarding.tsx` - `processPhotoAndReplaceEvaluatingCard` function
- `utils/clothingDetection.ts` - `ClothingDetectionService` class

**Recommended approach:**
1. Create a shared `processPhotoWithAI()` function in `utils/` that handles:
   - Background removal (via Firebase Cloud Function)
   - AI clothing detection
   - Item creation with proper formatting
2. Import and use this shared function in all three screens
3. Keep `utils/backgroundRemoval.ts` as the low-level service, but add a higher-level orchestration function

**Benefits:**
- Single place to update AI processing logic
- Consistent behavior across all entry points
- Easier testing and debugging



## Other TO DO items
1. Check whether the background removal code duplication has been done
2. Investigate sync issue - why the mass duplication
3. I suspect that data is not stored cleanly locally and that is how items can back propagate into Firestore after deletion
4. I've opened the app the day after sync doubled my item count in Firestore (now 113 items). But my local count has dropped to 57. How can this be?
5. There are so many duplicate code runs. The logs are littered with multiples of the same output. What is causing this?