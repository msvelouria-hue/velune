#!/usr/bin/env node
/**
 * Read-only comparison of a local AsyncStorage closet JSON file against
 * current Firestore docs and Storage objects.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ID = 'style-genie-f65ef';
const STORAGE_BUCKET = 'style-genie-f65ef.firebasestorage.app';
const TOKEN_METADATA_KEY = 'firebaseStorageDownloadTokens';

function parseArgs(argv) {
  const args = {
    uid: '',
    localFile: '',
    out: '',
    maxSamples: 50,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uid') {
      args.uid = argv[++i] || '';
    } else if (arg === '--local-file') {
      args.localFile = argv[++i] || '';
    } else if (arg === '--out') {
      args.out = argv[++i] || '';
    } else if (arg === '--max-samples') {
      args.maxSamples = Number(argv[++i] || 50);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/compareLocalClosetRecovery.js --uid <uid> --local-file <AsyncStorage clothingItems/closetItems file>
`);
}

function initializeAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    });
  }
}

function increment(map, key) {
  const normalized = key || '(empty)';
  map[normalized] = (map[normalized] || 0) + 1;
}

function parseStoragePath(value) {
  if (typeof value !== 'string' || !value) return '';

  try {
    const parsed = new URL(value);

    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const bucketName = decodeURIComponent(parts.shift() || '');
      if (bucketName !== STORAGE_BUCKET) return '';
      return parts.map(part => decodeURIComponent(part)).join('/');
    }

    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!match || decodeURIComponent(match[1]) !== STORAGE_BUCKET) return '';
      return decodeURIComponent(match[2]);
    }

    if (parsed.hostname === `${STORAGE_BUCKET}.storage.googleapis.com`) {
      return parsed.pathname
        .split('/')
        .filter(Boolean)
        .map(part => decodeURIComponent(part))
        .join('/');
    }
  } catch {
    return '';
  }

  return '';
}

function getImageUrl(item) {
  return item.imageUrl || item.photo || item.processedImageUrl || '';
}

function storagePathPrefix(pathValue) {
  if (!pathValue) return '';
  return pathValue
    .replace(/_nobg\.[^.]+$/i, '')
    .replace(/_\d{13}\.[^.]+$/i, '')
    .replace(/\.[^.]+$/i, '');
}

function normalizeDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  return '';
}

async function listStorageNames(bucket, uid) {
  const names = new Set();
  for (const prefix of [`users/${uid}/clothing/`, `users/${uid}/uploads/`]) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      names.add(file.name);
    }
  }
  return names;
}

async function getTokenState(bucket, storagePath, cache) {
  if (!storagePath) return { exists: false, hasToken: false };
  if (cache.has(storagePath)) return cache.get(storagePath);

  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    const value = { exists: false, hasToken: false };
    cache.set(storagePath, value);
    return value;
  }

  const [metadata] = await file.getMetadata();
  const token = metadata?.metadata?.[TOKEN_METADATA_KEY] || '';
  const value = { exists: true, hasToken: Boolean(String(token).trim()) };
  cache.set(storagePath, value);
  return value;
}

function idVariants(id) {
  const variants = new Set([id]);
  if (typeof id === 'string' && id.startsWith('detected_')) {
    variants.add(`item_${id.slice('detected_'.length)}`);
  } else if (typeof id === 'string' && id.startsWith('item_')) {
    variants.add(`detected_${id.slice('item_'.length)}`);
  }
  return variants;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.uid || !args.localFile) {
    printUsage();
    throw new Error('--uid and --local-file are required');
  }

  initializeAdmin();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const localItems = JSON.parse(fs.readFileSync(args.localFile, 'utf8'));
  if (!Array.isArray(localItems)) {
    throw new Error('Local file is not a JSON array');
  }

  const [snapshot, storageNames] = await Promise.all([
    db.collection('closetItems').where('userId', '==', args.uid).get(),
    listStorageNames(bucket, args.uid),
  ]);

  const firestoreIds = new Set(snapshot.docs.map(doc => doc.id));
  const tokenCache = new Map();
  const byCategory = {};
  const missingFromFirestoreByCategory = {};
  const imageState = {};
  const samples = {
    missingFromFirestore: [],
    missingFromFirestoreImageExists: [],
    missingFromFirestoreImageMissing: [],
    localItemsWithNoCloudPath: [],
  };

  let exactIdInFirestore = 0;
  let variantIdInFirestore = 0;
  let missingFromFirestore = 0;
  let missingFromFirestoreImageExists = 0;
  let missingFromFirestoreImageMissing = 0;
  let imageExists = 0;
  let imageMissing = 0;
  let imageNoCloudPath = 0;
  let needsToken = 0;
  let hasToken = 0;

  for (const item of localItems) {
    increment(byCategory, item.category);

    const exactExists = firestoreIds.has(item.id);
    const variantExists = Array.from(idVariants(item.id)).some(id => firestoreIds.has(id));
    if (exactExists) exactIdInFirestore++;
    if (!exactExists && variantExists) variantIdInFirestore++;

    const imageUrl = getImageUrl(item);
    const imagePath = parseStoragePath(imageUrl);
    const state = imagePath
      ? await getTokenState(bucket, imagePath, tokenCache)
      : { exists: false, hasToken: false };

    if (!imagePath) {
      imageNoCloudPath++;
      increment(imageState, 'no-cloud-path');
    } else if (state.exists) {
      imageExists++;
      increment(imageState, state.hasToken ? 'exists-with-token' : 'exists-needs-token');
      if (state.hasToken) hasToken++;
      else needsToken++;
    } else {
      imageMissing++;
      increment(imageState, 'missing-object');
    }

    if (!variantExists) {
      missingFromFirestore++;
      increment(missingFromFirestoreByCategory, item.category);
      const sample = {
        id: item.id,
        category: item.category || '',
        detectedType: item.detectedType || '',
        color: item.color || '',
        material: item.material || '',
        style: item.style || '',
        dateAdded: normalizeDate(item.dateAdded || item.createdAt),
        imagePath,
        imageExists: state.exists,
        imageHasToken: state.hasToken,
        relatedStoragePrefix: storagePathPrefix(imagePath),
      };

      if (samples.missingFromFirestore.length < args.maxSamples) {
        samples.missingFromFirestore.push(sample);
      }

      if (state.exists) {
        missingFromFirestoreImageExists++;
        if (samples.missingFromFirestoreImageExists.length < args.maxSamples) {
          samples.missingFromFirestoreImageExists.push(sample);
        }
      } else if (imagePath) {
        missingFromFirestoreImageMissing++;
        if (samples.missingFromFirestoreImageMissing.length < args.maxSamples) {
          samples.missingFromFirestoreImageMissing.push(sample);
        }
      } else if (samples.localItemsWithNoCloudPath.length < args.maxSamples) {
        samples.localItemsWithNoCloudPath.push(sample);
      }
    }
  }

  const duplicateIds = localItems.length - new Set(localItems.map(item => item.id)).size;
  const duplicateImageUrls = localItems.length - new Set(localItems.map(item => getImageUrl(item)).filter(Boolean)).size;

  const report = {
    generatedAt: new Date().toISOString(),
    uid: args.uid,
    localFile: args.localFile,
    summary: {
      localItemCount: localItems.length,
      currentFirestoreCount: snapshot.docs.length,
      exactIdInFirestore,
      variantIdInFirestore,
      missingFromFirestore,
      missingFromFirestoreImageExists,
      missingFromFirestoreImageMissing,
      imageExists,
      imageMissing,
      imageNoCloudPath,
      hasToken,
      needsToken,
      duplicateIds,
      duplicateImageUrls,
      storageFilesForUid: storageNames.size,
      byCategory,
      missingFromFirestoreByCategory,
      imageState,
    },
    samples,
  };

  const outputPath = args.out || path.join(
    process.cwd(),
    'recovery-reports',
    `local-closet-compare-${args.uid}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    reportPath: outputPath,
    summary: report.summary,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
