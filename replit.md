# Overview

**Velune** is a React Native wardrobe management app built with Expo. It allows users to photograph clothes, automatically categorizes them using AI, and provides daily outfit suggestions based on weather and calendar events. Key features include an intelligent onboarding flow, AI-powered clothing detection and categorization, background removal for clean item photos, and a comprehensive outfit recommendation system with smart layering and freshness algorithms.

## Branding
- **App Name**: Velune
- **Bundle ID**: co.velouria.vestiary
- **Theme**: Dark navy (#1a1f3c) with gold accents (#c9a756) - inspired by opening a closet
- **Color Palette**:
  - Navy: #1a1f3c (background), #252b4d (cards), #12162d (dark)
  - Gold: #c9a756 (primary), #e6c97a (light), #a68939 (dark)
  - Cream: #f5f0e1 (text), #d9d4c5 (secondary text)

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React Native with Expo SDK 54
- **Navigation**: File-based routing with `expo-router` for tab and modal screens
- **UI Components**: React Native Paper for Material Design, custom themed components
- **State Management**: React hooks with AsyncStorage for persistence
- **Animations**: React Native Reanimated for smooth transitions

## Mobile App Structure
- **Onboarding Flow**: Multi-step first-run wizard (stylist selection, gender, help areas, permissions, AI clothing detection).
- **Tab Layout**: Bottom tab navigation for Closet, Daily Picks, and Settings.
- **Modal Screens**: Add/edit clothing items.
- **Camera Integration**: Custom camera screen with permission handling.
- **Form Components**: Custom dropdowns using `react-native-paper` Menu.

## AI and Image Processing
- **Clothing Detection & Categorization**: OpenAI Vision API for item recognition and mapping to predefined categories (Tops, Bottoms, Dresses, Outerwear, Shoes, Accessories, Makeup).
- **Server-Side Batch Processing**: Firebase Cloud Function `batchProcessPhotos` handles unlimited photo uploads with AI detection and background removal server-side. Processes photos in parallel batches of 3 with 9-minute timeout.
- **Background Removal**: Non-blocking integration with Firebase Cloud Function proxy for Vuxo rembg API (5-minute function timeout, 2-minute API timeout). Falls back gracefully to original image on failure with detailed error surfacing and UI indicator ("🖼️ Original" badge on items where background removal failed).
- **Photo Validation**: AI-powered validation ensures photos contain clothing items.
- **Hair Suggestions**: AI (GPT-4 mini) provides hairstyle recommendations in Daily Picks, considering outfit, weather, and event formality.
- **Image Processing Pipeline**:
  - Images resized to 1200px width immediately after capture for efficient processing
  - For large batches (>10 photos), server-side batch processing handles AI detection
  - AI detection runs first and UI updates immediately when complete
  - Background removal runs in parallel (non-blocking) and updates image when done
  - Graceful fallback to original image if background removal fails

## Data Storage (Firebase + AsyncStorage Hybrid)
- **Firebase Authentication**: Google Sign In and Apple Sign In.
- **Firestore Database**: Stores user profiles (stylist preferences, gender, onboarding status) and closet items with cross-device sync.
- **Firebase Cloud Storage**: Stores clothing images (800px WebP, organized by user at `users/{userId}/clothing/`).
- **AsyncStorage**: Local cache for offline-first experience with background sync.
- **Cloud Sync Service**: `utils/cloudSyncService.ts` handles bidirectional sync between local storage and Firebase.
- **Photo Management**: Expo FileSystem + `expo-image-manipulator` for resizing and format conversion.

## Cloud Sync Flow
- **On Login**: Fetches items from Firestore in background, merges with local items.
- **On Item Add**: Uploads image to Firebase Storage, syncs item metadata to Firestore.
- **On Item Edit**: Updates Firestore FIRST with verification, then saves locally. If cloud sync fails, the entire operation fails (no silent failures).
- **On Item Delete**: Tracked in local deleted list immediately, then removed from Firestore with verification. Deleted items are blocked from re-download during sync.
- **Sync Verification**: All cloud operations include verification step to confirm changes persisted.
- **Manual Sync**: Settings page "Sync Data" button for full bidirectional sync.
- **Duplicate Handling**: Duplicates are automatically deleted from cloud, not just filtered locally.

## Permission System
- **Access**: Camera, Photo Library, Location Services, Calendar.

## Account Deletion (`app/(tabs)/explore.tsx`)
- **Danger Zone UI**: Red-themed section at bottom of Settings with "Delete All My Data" option
- **Confirmation Modal**: Requires user to type "Delete my data" (case insensitive) before enabling delete button
- **Data Deleted**:
  - All photos from Firebase Storage (`users/{userId}/clothing/`)
  - All clothing items from Firestore (`users/{userId}/closet`)
  - All outfit feedback (`users/{userId}/outfits`)
  - User preferences (`userPreferences/{userId}`)
  - User profile (`users/{userId}`)
  - Local AsyncStorage data
  - Firebase Auth user account
- **Error Handling**: Graceful handling of re-authentication requirements and partial deletion failures

## Outfit Recommendation Engine
- **3-Layer System**: Intelligent layering based on temperature thresholds and AI/user-defined `layerType` (base/mid/outer).
- **Weather Integration**: Location-based weather data for climate-appropriate suggestions.
- **Wind Chill Calculation**: Uses NWS formula to calculate "feels like" temperature accounting for wind speed and humidity.
- **Temperature Sensitivity**: User preference setting ("I run cold" / "Neutral" / "I run warm") adjusts all temperature thresholds.
- **Calendar Awareness**: Integrates with device calendar for event-appropriate styling.
- **Athletic Activity Detection**: Expanded keywords (skydiving, hiking, climbing, running, yoga, cycling, etc.) for athletic wear selection.
- **Freshness Algorithm**: Tracks item usage (`wornCount`, `lastWorn`) to prioritize less-worn items.
- **Preference Learning System**: Machine learning-based preference tracking via `utils/preferenceService.ts`:
  - **Item-level preferences**: Tracks like/dislike counts per clothing item (±20 points max)
  - **Color preferences**: Learns favorite and disliked colors (±10 points)
  - **Style preferences**: Tracks preferred styles like casual, formal, athletic (±10 points)
  - **Category preferences**: Learns category tendencies (±5 points)
  - **Combination tracking**: Records which top/bottom combinations work well together (±15 points)
  - **Weather-context learning**: Associates styles/colors with temperature ranges (+8/+5 points)
  - **Firebase sync**: Preferences automatically sync to `userPreferences` collection
- **Smart Clothing Filtering**: Excludes sandals below 60°F and shorts below 68°F (adjusted by user preference and wind chill).
- **Cold Weather Scoring**: Enhanced scoring for warm materials (wool, fleece, down) and windproof outerwear in cold/windy conditions.
- **Makeup Preference System**: User-level setting in Settings page to control makeup suggestions:
  - `makeupPreferenceLevel`: "none" | "minimal" | "everyday" | "full" (default: "minimal")
  - `makeupAllergyOrAvoid`: Optional free text for allergies/products to avoid
  - `makeupNotes`: Optional free text for personal preferences (e.g., "always do lips + brows")
  - Premium AI includes preferences in outfit prompts; Basic algorithm adjusts makeup suggestion frequency

## User Stats Tracking (`utils/userProfileService.ts`)
- **Atomic Firestore Counters**: Uses Firestore `increment()` for atomic updates
- **Tracking Fields** (prefixed with `t_`):
  - `t_login_count`: Incremented on each successful Google/Apple sign-in
  - `t_wardrobe_item_count`: Incremented when items added, decremented when deleted
  - `t_wardrobe_request_submissions_basic`: Tracks basic algorithm outfit requests
  - `t_wardrobe_request_submissions_premium_ai`: Tracks premium AI outfit requests
- **Non-blocking**: Tracking runs asynchronously without blocking user flow

## AI Prompt Logging (`utils/promptLogService.ts`)
- **Firestore Collection**: `promptLogs` stores all OpenAI API interactions
- **Logged Data**:
  - `userId`: User who made the request
  - `timestamp`: When the request was made
  - `promptType`: Type of AI call (clothing_detection, photo_validation, outfit_selection_premium, stylist_comment, hair_suggestion)
  - `model`: OpenAI model used (gpt-4o, gpt-4o-mini)
  - `prompt`: Full prompt sent to AI
  - `response`: AI response content
  - `promptTokens`, `completionTokens`, `totalTokens`: Token usage
  - `durationMs`: Request duration (when using timing wrapper)
  - `success`: Whether the call succeeded
  - `errorMessage`: Error details if failed
- **Integrated Services**:
  - `clothingDetection.ts`: Logs clothing item detection from photos
  - `photoValidation.ts`: Logs photo validation checks
  - `premiumAIService.ts`: Logs premium outfit selection requests
  - `outfitSelectionService.ts`: Logs stylist comments and hair suggestions
- **Non-blocking**: All logging runs asynchronously to avoid slowing down user experience
- **Use Cases**: Cost analysis, prompt optimization, debugging, usage analytics

## Beta Tester Program & A/B Testing
- **Beta Tester Permissions**: User profiles support a `permissions` array field with 'beta tester' role
- **Conditional Features**: Settings page shows additional options for beta testers:
  - Restart Onboarding button (for testing onboarding flow)
  - Algorithm Selector dropdown (Basic vs Premium AI)
- **Algorithm A/B Testing**: Two outfit selection algorithms available:
  - **Basic**: Rule-based algorithm with preference learning (default for all users)
  - **Premium AI**: GPT-4o powered selection with comprehensive context (beta testers only)

## Premium AI Outfit Service (`utils/premiumAIService.ts`)
- **Full Wardrobe Context**: Sends complete wardrobe inventory with worn counts and last worn dates
- **Past Feedback**: Includes last 10 liked/disliked outfits from feedback history
- **Weather & Calendar**: Current weather conditions and today's calendar events
- **Preference Summary**: Aggregated user preferences (colors, styles, categories)
- **Stylist Persona**: Optional AI personality matching selected stylist
- **Automatic Fallback**: Falls back to Basic algorithm if AI fails or is unavailable

## Outfit Feedback Tracking (`utils/outfitFeedbackService.ts`)
- **Firestore Collection**: `users/{userId}/outfits` stores all outfit suggestions
- **Outfit Schema**: Items array, algorithm used, weather/event context, timestamps
- **Feedback Recording**: Thumbs up/down with optional reasons and notes
- **Analytics Ready**: Structured data for comparing algorithm performance

## Ensemble Tracking (`utils/ensembleService.ts`)
- **Firestore Collection**: `ensembles` (top-level, document ID: `{userId}_{ensembleHash}`)
- **Ensemble Schema**:
  - `id`: Unique hash generated from sorted item IDs
  - `userId`: User who viewed/reacted to the ensemble
  - `itemIds`: Sorted array of clothing item IDs in the ensemble
  - `loved_count`: Incremented each time user gives thumbs-up (atomic increment)
  - `comments`: Array of timestamped comments (appended on feedback)
  - `last_viewed_at`: Updated each time user sees this outfit combination
  - `updated_at`: Last modification timestamp
  - `created_at`: First time this ensemble was shown
  - `weather_context`: Temperature and condition when viewed
  - `event_context`: Calendar event title if applicable
- **View Tracking**: Ensemble marked as viewed when user sees it in Daily Picks (non-blocking)
- **Love Recording**: Thumbs-up increments `loved_count` and optionally appends comment
- **Comment Recording**: Thumbs-down with reasons appends to `comments` array with prefix
- **AI Integration**: `getEnsemblesForAI()` provides recently viewed and loved ensembles to help LLM avoid repetition
- **Deduplication**: Same outfit combination (regardless of order) maps to same document

# External Dependencies

## Firebase Services (Serverless Backend)
- **Firebase Authentication**: Google OAuth, Apple Sign In.
- **Cloud Firestore**: NoSQL database.
- **Cloud Storage**: Object storage.
- **Firebase Analytics**: User behavior tracking.
- **Project**: `style-genie-f65ef` on Blaze plan.

## AI Services
- **OpenAI API**: GPT-4 Vision (clothing detection, categorization, description), GPT-4 mini (hair suggestions).
- **Vuxo rembg API**: Background removal (proxied via Firebase Cloud Function).
- **Remove.bg API**: Legacy background removal.
- **PhotoRoom API**: Alternative background removal.

## Expo Services
- **Expo Camera**: Camera functionality.
- **Expo Image Picker**: Photo selection.
- **Expo Location**: GPS location services.
- **Expo Calendar**: Device calendar integration.
- **Expo File System**: File operations.
- **Expo Notifications**: Push notification scheduling and management.

## UI and Animation Libraries
- **React Native Paper**: Material Design components.
- **React Native Reanimated**: High-performance animations.
- **React Native Gesture Handler**: Touch and gesture recognition.
- **React Native Keyboard Aware ScrollView**: Keyboard-responsive scrolling.

## Storage and State
- **AsyncStorage**: Local data persistence.
- **React Navigation**: Navigation state management.
