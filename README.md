# Velune

Velune is a full-stack React Native wardrobe assistant I built and shipped through VUXO I, CORP., the company behind the app. Users photograph closet items, Velune classifies and enriches the items with AI, removes image backgrounds, syncs the wardrobe across devices, and generates daily outfit recommendations using weather, calendar context, preference history, and wardrobe freshness.

## Portfolio Highlights

- Offline-first mobile app with Firestore as the source of truth
- Firebase Auth, Firestore, Storage, and Cloud Functions backend
- Secure AI proxy pattern so OpenAI and image-processing secrets stay out of the app bundle
- Typed wardrobe, outfit, preference, and feedback models
- Weather-aware and calendar-aware recommendation logic
- Jest coverage for wardrobe type normalization, daily outfit caching, dress code parsing, weather utilities, and premium outfit validation rules

## Core Product Features

- AI clothing detection from uploaded photos
- Background removal and cloud-hosted item imagery
- Closet management with categories, colors, materials, styling notes, layer roles, and wear history
- Daily outfit recommendations using either a deterministic rule engine or premium AI reasoning
- Calendar and weather context for occasion-appropriate styling
- Feedback loops for liked/disliked items, outfit combinations, and preference learning
- Firebase-backed account deletion/data cleanup flow

## Tech Stack

### Mobile App

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- expo-router file-based navigation
- React Native Paper
- AsyncStorage for local/offline cache
- Jest + jest-expo

### Backend

- Firebase Auth
- Cloud Firestore
- Firebase Storage
- Firebase Cloud Functions on Node.js 20
- OpenAI via callable Cloud Functions
- Vuxo background removal API via callable Cloud Functions

## System Architecture

```text
React Native app
├── app/                         # Screens and expo-router navigation
├── components/                  # Shared UI components
├── config/firebase.ts           # Firebase client initialization
├── utils/cloudSyncService.ts    # Firestore + Storage source-of-truth sync
├── utils/secureAiProxy.ts       # Callable Functions client for AI work
├── utils/premiumAIService.ts    # Premium outfit generation and validation
├── utils/outfitSelectionService.ts
├── utils/preferenceService.ts
├── utils/outfitFeedbackService.ts
└── utils/wardrobeTypes.ts       # Shared wardrobe domain types

Firebase backend
├── Auth                         # User identity
├── Firestore                    # Users, closet items, outfits, preferences
├── Storage                      # Original and processed clothing images
└── Cloud Functions
    ├── runSecureAiTask          # OpenAI task router
    ├── removeBackground         # Synchronous background removal
    └── processBackgroundRemovalAsync
```

## Architecture Decisions

- **Firestore is the source of truth**: Closet items are read from Firestore server state when possible, then mirrored into AsyncStorage for offline and degraded-network use.
- **Local cache is replaceable**: The app treats local closet state as a cache and provides explicit refresh/repair paths instead of merging stale local items into cloud truth.
- **API keys stay server-side**: OpenAI and background-removal secrets are configured as Firebase Function secrets. The client calls typed callable functions through `secureAiProxy`.
- **Image storage is per-user and per-item**: Closet imagery is uploaded to Firebase Storage under `users/{uid}/clothing/{itemId}/...`, then referenced from Firestore.
- **AI output is validated before display**: Premium outfit generation parses, validates, repairs, and rejects incomplete outfits before they reach the UI.
- **Domain types live near behavior**: Wardrobe and outfit types are defined in `utils/wardrobeTypes.ts` and `utils/dailyPicksTypes.ts`, keeping Firestore payloads and UI behavior aligned.
- **Feedback improves future suggestions**: Outfit ratings, item-level preferences, color/style preferences, and ensemble history are stored separately so recommendation logic can combine them without overloading closet item documents.

## Database Schema

Velune uses Cloud Firestore. The most important collections are below.

### `users/{uid}`

User profile, onboarding, permissions, and tracking counters.

| Field | Type | Notes |
| --- | --- | --- |
| `uid` | string | Firebase Auth UID |
| `email` | string \| null | Auth email |
| `displayName` | string \| null | Auth display name |
| `photoURL` | string \| null | Auth avatar |
| `selectedStylist` | string | Preferred stylist persona |
| `gender` | string | Used for onboarding and recommendations |
| `helpAreas` | string[] | Style goals selected in onboarding |
| `hairProfile` | object | Hair length, texture, color, and optional style |
| `makeupPreferenceLevel` | string | `none`, `minimal`, `everyday`, or `full` |
| `makeupAllergyOrAvoid` | string | Optional user-entered constraints |
| `makeupNotes` | string | Optional user-entered notes |
| `onboardingCompleted` | boolean | Controls first-run flow |
| `permissions` | string[] | Feature flags such as beta tester access |
| `outfitAlgorithm` | string | `basic` or `premium` |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
| `t_login_count` | number | Tracking counter |
| `t_wardrobe_item_count` | number | Tracking counter |
| `t_wardrobe_request_submissions_basic` | number | Tracking counter |
| `t_wardrobe_request_submissions_premium_ai` | number | Tracking counter |

### `closetItems/{itemId}`

Canonical clothing item documents. Items are queryable by `userId`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Matches document ID |
| `userId` | string | Owner UID |
| `imageUrl` | string | Display image URL |
| `processedImageUrl` | string | Background-removed image URL |
| `originalImageUrl` | string | Original uploaded image URL |
| `category` | string | Tops, Bottoms, Dresses, Shoes, Accessories, etc. |
| `detectedType` | string | More specific AI-detected item type |
| `displayCategory` | string | Optional display override |
| `color` | string | Primary color |
| `pattern` | string | Pattern description |
| `material` | string | Material/fabric |
| `style` | string | Style descriptor |
| `fit` | string | Fit descriptor |
| `silhouette` | string | Shape descriptor |
| `neckline` | string | Top/dress detail |
| `sleeveLength` | string | Top/dress detail |
| `length` | string | Hem/item length |
| `closure` | string | Closure detail |
| `rise` | string | Bottoms detail |
| `wash` | string | Denim/wash detail |
| `heelHeight` | string | Shoe detail |
| `toeShape` | string | Shoe detail |
| `hardware` | string | Hardware detail |
| `brandOrLogo` | string | Visible brand/logo detail |
| `formality` | string | Outfit-matching signal |
| `warmth` | string | Weather/layering signal |
| `layeringRole` | string | Layering signal |
| `stylingNotes` | string | AI-generated pairing guidance |
| `tags.season` | string[] | Seasonal tags |
| `tags.event` | string[] | Occasion tags |
| `layerType` | string | `base`, `mid`, or `outer` |
| `confidence` | number | AI detection confidence |
| `isAutoDetected` | boolean | Detection provenance |
| `wornCount` | number | Wear tracking |
| `lastWorn` | string | ISO timestamp |
| `lastSuggested` | string | ISO timestamp |
| `photoStatus` | string | `pending`, `uploading`, `evaluating`, `done`, `needs_clarification`, `background_removed`, `approved`, or `rejected` |
| `backgroundRemovalStatus` | string | `pending`, `processing`, `complete`, or `failed` |
| `needsAttention` | boolean | User action required |
| `needsUserInput` | boolean | User input required |
| `isEvaluating` | boolean | AI evaluation in progress |
| `createdAt` | string | ISO timestamp |
| `dateAdded` | string | ISO timestamp |
| `updatedAt` | timestamp/string | Firestore server timestamp or serialized timestamp |
| `dateModified` | string | ISO timestamp |

### `userPreferences/{uid}`

Aggregated preference model used by recommendation logic.

| Field | Type | Notes |
| --- | --- | --- |
| `items` | map | Item-level likes/dislikes keyed by item ID |
| `colors` | map | Color preference counters |
| `styles` | map | Style preference counters |
| `categories` | map | Category preference counters |
| `combinations` | array | Top/bottom category and color pair counters |
| `weatherStyles` | map | Preferences by temperature range |
| `totalFeedbackCount` | number | Total feedback events recorded |
| `lastUpdated` | string | ISO timestamp |

### `users/{uid}/outfits/{outfitId}`

Outfit suggestion and feedback records.

| Field | Type | Notes |
| --- | --- | --- |
| `date` | string | Local date for the outfit |
| `itemIds` | string[] | Items included in the outfit |
| `items` | array | Snapshot of item ID, category, color, style, detected type |
| `thumbsUp` | number | Positive feedback flag/count |
| `thumbsDown` | number | Negative feedback flag/count |
| `feedbackReasons` | string[] | Structured dislike reasons |
| `notes` | string | Optional user feedback |
| `weatherContext` | object | Temperature and condition |
| `eventContext` | string | Calendar event title/context |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |

### `ensembles/{uid}_{ensembleId}`

History for previously viewed, loved, and commented item combinations.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Deterministic ensemble ID derived from sorted item IDs |
| `userId` | string | Owner UID |
| `itemIds` | string[] | Sorted closet item IDs |
| `loved_count` | number | Positive ensemble count |
| `comments` | string[] | Dated user comments |
| `last_viewed_at` | string | ISO timestamp |
| `updated_at` | string | ISO timestamp |
| `created_at` | string | ISO timestamp |
| `weather_context` | object | Optional weather context |
| `event_context` | string | Optional event context |

### `promptLogs/{autoId}`

AI observability log for prompt/response debugging.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | string | Owner UID |
| `timestamp` | timestamp | Firestore timestamp |
| `promptType` | string | `clothing_detection`, `photo_validation`, `outfit_selection_premium`, `stylist_comment`, or `hair_suggestion` |
| `model` | string | AI model name |
| `prompt` | string | Prompt text |
| `response` | string | Model response |
| `promptTokens` | number | Optional usage metric |
| `completionTokens` | number | Optional usage metric |
| `totalTokens` | number | Optional usage metric |
| `durationMs` | number | Optional latency metric |
| `success` | boolean | Whether the call succeeded |
| `errorMessage` | string | Optional error detail |

### Storage Paths

```text
users/{uid}/clothing/{itemId}/original.webp
users/{uid}/clothing/{itemId}_nobg.png
users/{uid}/uploads/{tempId}_{timestamp}.jpg
```

## Local Development

### Prerequisites

- Node.js 20+
- npm
- Xcode for iOS simulator/device builds
- Expo CLI through `npx`
- Firebase CLI for deploying backend resources
- A Firebase project with Auth, Firestore, Storage, and Functions enabled
- API keys/secrets for OpenAI, Vuxo background removal, Google sign-in, and weather

### Setup

```bash
git clone <repository-url>
cd style-genie
npm install
cp .env.example .env
```

Fill in `.env` with Firebase, Google sign-in, weather, and app configuration values. Only `EXPO_PUBLIC_*` values are bundled into the client app.

Use `EXPO_PUBLIC_*` only for values that are safe to expose in a compiled mobile app, such as Firebase client config and OAuth client IDs. Do **not** use `EXPO_PUBLIC_OPENAI_API_KEY`, `EXPO_PUBLIC_VUXO_API_KEY`, `EXPO_PUBLIC_REMOVE_BG_API_KEY`, or `EXPO_PUBLIC_PHOTOROOM_API_KEY`; those provider keys must stay server-side. If one of those keys has ever been built into an Expo client bundle, rotate it with the provider.

Configure server-side secrets in Firebase Functions:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set VUXO_API_KEY
```

Install Cloud Functions dependencies:

```bash
cd functions
npm install
npm run build
cd ..
```

### Running the App

For an Expo development client:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device
npx expo start --dev-client --host lan
```

For Metro only:

```bash
npx expo start
```

For web preview:

```bash
npm run web
```

## Backend Development

Build Cloud Functions locally:

```bash
cd functions
npm run build
```

Deploy functions:

```bash
firebase deploy --only functions
```

Deploy Firestore indexes:

```bash
firebase deploy --only firestore:indexes
```

The configured function runtime is Node.js 20 in `firebase.json`.

## Quality Checks

```bash
npm run typecheck
npm run lint
npm test -- --watchAll=false
```

The test suite includes coverage for:

- Closet source-of-truth replacement behavior
- Wardrobe type/status normalization
- Daily outfit cache invalidation
- Dress code parsing
- Weather utility behavior
- Premium accessory and outfit reasoning rules

## Utility Scripts

Recovery and maintenance scripts live in `scripts/`.

| Script | Purpose |
| --- | --- |
| `recoveryReadOnlyScan.js` | Inspect Firestore/Storage recovery candidates without writing |
| `buildRestorePreview.js` | Generate recovery preview reports |
| `restoreApprovedDedupedSet.js` | Restore approved deduplicated recovery candidates |
| `auditRepairStorageUrls.js` | Audit and repair item image URL references |
| `compareLocalClosetRecovery.js` | Compare local cache against recovery data |
| `bigqueryRecoveryScan.js` | Scan exported/recovered data sources |
| `batchDeleteClosetItems.js` | Delete selected closet items from Firestore and Storage |

Read each script before running it, especially scripts that write to Firestore or Storage.

## Production Builds

EAS cloud build:

```bash
npx eas build --platform ios --profile production
```

Production submit:

```bash
npx eas submit --platform ios --profile production
```

The `ios/` directory is generated by Expo prebuild and should be treated as build output unless native configuration changes are intentional.

## License

Proprietary. All rights reserved.
