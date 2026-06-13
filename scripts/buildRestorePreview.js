#!/usr/bin/env node
/**
 * Build a read-only closet restore preview from local AsyncStorage caches.
 *
 * This does not update Firestore, Storage, or local app data. It creates:
 * - a JSON report with all candidates/duplicate groups
 * - a Markdown summary for review
 * - a candidate-set JSON that can be used later only after explicit approval
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
    primaryLocalFile: '',
    secondaryLocalFile: '',
    outDir: path.join(process.cwd(), 'recovery-reports'),
    maxSamples: 25,
    maxDuplicateGroups: 80,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uid') {
      args.uid = argv[++i] || '';
    } else if (arg === '--primary-local-file') {
      args.primaryLocalFile = argv[++i] || '';
    } else if (arg === '--secondary-local-file') {
      args.secondaryLocalFile = argv[++i] || '';
    } else if (arg === '--out-dir') {
      args.outDir = argv[++i] || args.outDir;
    } else if (arg === '--max-samples') {
      args.maxSamples = Number(argv[++i] || args.maxSamples);
    } else if (arg === '--max-duplicate-groups') {
      args.maxDuplicateGroups = Number(argv[++i] || args.maxDuplicateGroups);
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
  node scripts/buildRestorePreview.js \\
    --uid <uid> \\
    --primary-local-file <clean AsyncStorage closetItems/clothingItems file> \\
    [--secondary-local-file <larger fallback cache file>]

This is read-only and only writes report files under recovery-reports/.
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

function readJsonArray(filePath, label) {
  if (!filePath) return [];
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not a JSON array: ${filePath}`);
  }
  return value;
}

function normalizeString(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
  if (value.type === 'firestore/timestamp/1.0' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  return '';
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

    if (parsed.hostname === `${STORAGE_BUCKET}.storage.googleapis.com`) {
      return parsed.pathname
        .split('/')
        .filter(Boolean)
        .map(part => decodeURIComponent(part))
        .join('/');
    }

    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!match || decodeURIComponent(match[1]) !== STORAGE_BUCKET) return '';
      return decodeURIComponent(match[2]);
    }
  } catch {
    return '';
  }

  return '';
}

function firebaseDownloadUrl(storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${
    encodeURIComponent(storagePath)
  }?alt=media&token=${token}`;
}

function firstToken(metadata) {
  const tokenValue = metadata?.metadata?.[TOKEN_METADATA_KEY];
  if (typeof tokenValue !== 'string') return '';
  return tokenValue.split(',').map(token => token.trim()).find(Boolean) || '';
}

function itemImageUrl(item) {
  return item.imageUrl || item.photo || item.processedImageUrl || item.originalImageUrl || '';
}

function idFamily(id) {
  if (typeof id !== 'string') return '';
  if (id.startsWith('detected_')) return id.slice('detected_'.length);
  if (id.startsWith('item_')) return id.slice('item_'.length);
  return id;
}

function idVariants(id) {
  const variants = new Set();
  if (typeof id !== 'string' || !id) return variants;
  variants.add(id);
  if (id.startsWith('detected_')) {
    variants.add(`item_${id.slice('detected_'.length)}`);
  } else if (id.startsWith('item_')) {
    variants.add(`detected_${id.slice('item_'.length)}`);
  }
  return variants;
}

function itemFingerprint(item) {
  return [
    item.category,
    item.color,
    item.material,
    item.style,
    item.pattern,
    normalizeString(item.notes).slice(0, 80),
  ].map(normalizeString).join('|');
}

function itemSummary(item, source) {
  const imageUrl = itemImageUrl(item);
  const storagePath = parseStoragePath(imageUrl);

  return {
    id: item.id || '',
    source,
    category: item.category || 'Uncategorized',
    detectedType: item.detectedType || '',
    color: item.color || '',
    pattern: item.pattern || '',
    material: item.material || '',
    style: item.style || '',
    notes: item.notes || '',
    tags: item.tags || { season: [], event: [] },
    confidence: item.confidence,
    isAutoDetected: item.isAutoDetected,
    wornCount: item.wornCount || 0,
    lastWorn: item.lastWorn || '',
    dateAdded: normalizeDate(item.dateAdded || item.createdAt),
    dateModified: normalizeDate(item.dateModified || item.updatedAt),
    photoStatus: item.photoStatus || 'done',
    backgroundRemovalStatus: item.backgroundRemovalStatus || '',
    imageUrl,
    processedImageUrl: item.processedImageUrl || '',
    originalImageUrl: item.originalImageUrl || '',
    tempId: item.tempId || '',
    storagePath,
    originalStoragePath: storagePath,
    fingerprint: itemFingerprint(item),
  };
}

function sourceRank(source) {
  if (source === 'currentFirestore') return 0;
  if (source === 'primary') return 1;
  if (source === 'secondary') return 2;
  return 3;
}

function firestorePresence(candidate, currentFirestoreIds) {
  const exactExists = currentFirestoreIds.has(candidate.id);
  const variantExists = Array.from(idVariants(candidate.id)).some(id => currentFirestoreIds.has(id));
  return {
    exactExists,
    variantExists,
    represented: exactExists || variantExists,
    rank: exactExists ? 0 : variantExists ? 1 : 2,
  };
}

function candidateRank(candidate, currentFirestoreIds) {
  const presence = firestorePresence(candidate, currentFirestoreIds);
  return [
    presence.rank,
    sourceRank(candidate.source),
    candidate.category === 'Uncategorized' ? 1 : 0,
    candidate.imageExists ? 0 : 1,
    candidate.imageHasToken ? 0 : 1,
    candidate.dateModified || candidate.dateAdded || '',
    candidate.id,
  ];
}

function compareCandidates(a, b, currentFirestoreIds) {
  const ar = candidateRank(a, currentFirestoreIds);
  const br = candidateRank(b, currentFirestoreIds);
  for (let i = 0; i < ar.length; i++) {
    if (i === 5) {
      const dateCompare = String(br[i]).localeCompare(String(ar[i]));
      if (dateCompare !== 0) return dateCompare;
      continue;
    }
    const compare = String(ar[i]).localeCompare(String(br[i]));
    if (compare !== 0) return compare;
  }
  return 0;
}

function increment(map, key) {
  const normalized = key || '(empty)';
  map[normalized] = (map[normalized] || 0) + 1;
}

function tableFromCounts(counts) {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join('\n');
}

function sampleRow(item) {
  const imageLabel = imageStateName(item);
  const fallback = item.usedFallback ? `${item.fallbackSource}:${item.fallbackStoragePath}` : '';
  return `| ${item.id} | ${item.category} | ${item.detectedType || ''} | ${item.color || ''} | ${imageLabel} | ${fallback} | ${item.source} |`;
}

function duplicateGroupRow(group) {
  const categories = Array.from(new Set(group.members.map(item => item.category))).join(', ');
  const ids = group.members.map(item => item.id).join(', ');
  const imageDonor = group.chosen.imageDonorId ? `${group.chosen.imageDonorId} (${group.chosen.imageDonorSource})` : '';
  return `| ${group.chosen.id} | ${group.members.length} | ${categories} | ${imageDonor} | ${ids} |`;
}

async function getStorageState(bucket, storagePath, cache) {
  if (!storagePath) return { exists: false, hasToken: false, downloadUrl: '' };
  if (cache.has(storagePath)) return cache.get(storagePath);

  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    const state = { exists: false, hasToken: false, downloadUrl: '' };
    cache.set(storagePath, state);
    return state;
  }

  const [metadata] = await file.getMetadata();
  const token = firstToken(metadata);
  const state = {
    exists: true,
    hasToken: Boolean(token),
    downloadUrl: token ? firebaseDownloadUrl(storagePath, token) : '',
  };
  cache.set(storagePath, state);
  return state;
}

async function fileExists(bucket, storagePath, cache) {
  if (!storagePath) return false;
  if (cache.has(storagePath)) return cache.get(storagePath);

  const [exists] = await bucket.file(storagePath).exists();
  cache.set(storagePath, exists);
  return exists;
}

async function listFilesByPrefix(bucket, prefix, cache) {
  if (!prefix) return [];
  if (cache.has(prefix)) return cache.get(prefix);

  const [files] = await bucket.getFiles({ prefix });
  const names = files.map(file => file.name);
  cache.set(prefix, names);
  return names;
}

async function listUserClothingFiles(bucket, uid, cache) {
  const prefix = `users/${uid}/clothing/`;
  if (cache.has(prefix)) return cache.get(prefix);

  const [files] = await bucket.getFiles({ prefix });
  const entries = files
    .map(file => ({
      storagePath: file.name,
      timestampMs: storagePathTimestamp(file.name),
      ext: path.extname(file.name).toLowerCase(),
    }))
    .filter(file => /\.(webp|png|jpe?g)$/i.test(file.storagePath));

  cache.set(prefix, entries);
  return entries;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isProcessedNoBgPath(storagePath) {
  return /_nobg\.[^.]+$/i.test(storagePath || '');
}

function getPrefixFromMissingPath(storagePath) {
  if (!storagePath) return '';
  return storagePath
    .replace(/_nobg\.[^.]+$/i, '')
    .replace(/\.[^.]+$/i, '');
}

function trailingTimestamp(storagePath) {
  const match = String(storagePath || '').match(/_(\d{13})(?:\.[^.]+)?$/);
  return match ? Number(match[1]) : 0;
}

function storagePathTimestamp(storagePath) {
  const baseName = path.basename(String(storagePath || ''));
  const leading = baseName.match(/^(\d{13})[_-]/);
  if (leading) return Number(leading[1]);

  const trailing = trailingTimestamp(baseName);
  if (trailing) return trailing;

  const anyTimestamp = baseName.match(/(\d{13})/);
  return anyTimestamp ? Number(anyTimestamp[1]) : 0;
}

function itemTimestampMs(item) {
  const idMatch = String(item.id || '').match(/(\d{13})/);
  if (idMatch) return Number(idMatch[1]);

  const dateAdded = Date.parse(item.dateAdded || '');
  if (!Number.isNaN(dateAdded)) return dateAdded;

  const dateModified = Date.parse(item.dateModified || '');
  if (!Number.isNaN(dateModified)) return dateModified;

  return storagePathTimestamp(item.originalStoragePath || item.storagePath);
}

function chooseBestFallbackCandidate(candidates) {
  const imageCandidates = candidates.filter(candidate =>
    /\.(webp|png|jpe?g)$/i.test(candidate.storagePath || '')
  );
  const preferred = imageCandidates.filter(candidate => /\.webp$/i.test(candidate.storagePath || ''));
  const pool = preferred.length > 0 ? preferred : imageCandidates;

  return pool.sort((a, b) => {
    const fallbackSourceRank = source => {
      if (source === 'clothingPrefix') return 0;
      if (source === 'originalImageUrl') return 1;
      if (source === 'uploadPrefix') return 2;
      return 3;
    };

    const sourceDelta = fallbackSourceRank(a.source) - fallbackSourceRank(b.source);
    if (sourceDelta !== 0) return sourceDelta;

    const timestampDelta = trailingTimestamp(b.storagePath) - trailingTimestamp(a.storagePath);
    if (timestampDelta !== 0) return timestampDelta;

    return String(a.storagePath).localeCompare(String(b.storagePath));
  })[0] || null;
}

async function findFallbackCandidates(bucket, uid, item, missingPath, caches) {
  const candidates = [];

  if (item.originalImageUrl) {
    const originalStoragePath = parseStoragePath(item.originalImageUrl);
    if (originalStoragePath) {
      const exists = await fileExists(bucket, originalStoragePath, caches.exists);
      if (exists) {
        candidates.push({
          source: 'originalImageUrl',
          storagePath: originalStoragePath,
          url: item.originalImageUrl,
        });
      }
    }
  }

  const prefixes = [
    getPrefixFromMissingPath(missingPath),
    ...Array.from(idVariants(item.id)).map(id => `users/${uid}/clothing/${id}`),
  ];

  if (typeof item.tempId === 'string' && item.tempId) {
    prefixes.push(`users/${uid}/uploads/${item.tempId}`);
  }

  for (const prefix of unique(prefixes)) {
    const files = await listFilesByPrefix(bucket, prefix, caches.prefixes);
    for (const storagePath of files) {
      if (storagePath === missingPath) continue;
      if (!/\.(webp|png|jpe?g)$/i.test(storagePath)) continue;

      candidates.push({
        source: storagePath.includes('/uploads/') ? 'uploadPrefix' : 'clothingPrefix',
        storagePath,
      });
    }
  }

  const seen = new Set();
  return candidates.filter(candidate => {
    const key = `${candidate.source}:${candidate.storagePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveImageState(bucket, uid, item, caches) {
  const requestedPath = item.storagePath;
  const exactState = await getStorageState(bucket, requestedPath, caches.storageStates);
  if (exactState.exists) {
    return {
      ...exactState,
      storagePath: requestedPath,
      originalStoragePath: requestedPath,
      usedFallback: false,
      fallbackStoragePath: '',
      fallbackSource: '',
      fallbackCandidates: [],
    };
  }

  const fallbackCandidates = await findFallbackCandidates(bucket, uid, item, requestedPath, caches);
  const bestFallback = chooseBestFallbackCandidate(fallbackCandidates);
  if (!bestFallback) {
    return {
      ...exactState,
      storagePath: requestedPath,
      originalStoragePath: requestedPath,
      usedFallback: false,
      fallbackStoragePath: '',
      fallbackSource: '',
      fallbackCandidates,
    };
  }

  const fallbackState = await getStorageState(bucket, bestFallback.storagePath, caches.storageStates);
  return {
    ...fallbackState,
    storagePath: bestFallback.storagePath,
    originalStoragePath: requestedPath,
    usedFallback: true,
    fallbackStoragePath: bestFallback.storagePath,
    fallbackSource: bestFallback.source,
    fallbackCandidates,
  };
}

function dedupeKeys(item) {
  const keys = [];
  const family = idFamily(item.id);
  if (family) keys.push(`id:${family}`);
  if (item.originalStoragePath) keys.push(`requested-image:${item.originalStoragePath}`);

  const fallbackIsOriginalUpload = item.usedFallback && item.fallbackSource === 'originalImageUrl';
  if (item.storagePath && !fallbackIsOriginalUpload) {
    keys.push(`image:${item.storagePath}`);
  }

  if (keys.length === 0) {
    keys.push(`fingerprint:${itemFingerprint(item)}`);
  }

  return unique(keys);
}

function timeFallbackAssignmentKey(item) {
  const family = idFamily(item.id);
  if (family) return `id:${family}`;
  if (item.originalStoragePath) return `requested-image:${item.originalStoragePath}`;
  return `fingerprint:${itemFingerprint(item)}`;
}

function findBestTimeFallback(availableFiles, itemTimestamp, assignedStoragePaths) {
  const BEFORE_MS = 15 * 1000;
  const AFTER_MS = 3 * 60 * 1000;

  return availableFiles
    .filter(file => {
      if (!file.timestampMs || assignedStoragePaths.has(file.storagePath)) return false;
      const delta = file.timestampMs - itemTimestamp;
      return delta >= -BEFORE_MS && delta <= AFTER_MS;
    })
    .sort((a, b) => {
      const deltaA = a.timestampMs - itemTimestamp;
      const deltaB = b.timestampMs - itemTimestamp;
      const directionA = deltaA < 0 ? 1 : 0;
      const directionB = deltaB < 0 ? 1 : 0;
      if (directionA !== directionB) return directionA - directionB;

      const distance = Math.abs(deltaA) - Math.abs(deltaB);
      if (distance !== 0) return distance;

      return a.storagePath.localeCompare(b.storagePath);
    })[0] || null;
}

async function assignTimeProximityFallbacks(bucket, uid, items, caches) {
  const usedStoragePaths = new Set(
    items
      .filter(item => item.imageExists && item.storagePath)
      .map(item => item.storagePath)
  );
  const availableFiles = await listUserClothingFiles(bucket, uid, caches.userClothingFiles);
  const missingGroups = new Map();

  for (const item of items) {
    if (item.imageExists) continue;

    const timestampMs = itemTimestampMs(item);
    if (!timestampMs) continue;

    const key = timeFallbackAssignmentKey(item);
    if (!missingGroups.has(key)) missingGroups.set(key, []);
    missingGroups.get(key).push(item);
  }

  const groups = Array.from(missingGroups.values()).map(members => {
    const sortedMembers = [...members].sort((a, b) => {
      const sourceCompare = sourceRank(a.source) - sourceRank(b.source);
      if (sourceCompare !== 0) return sourceCompare;
      return String(a.id).localeCompare(String(b.id));
    });
    return {
      representative: sortedMembers[0],
      members,
      timestampMs: itemTimestampMs(sortedMembers[0]),
    };
  }).sort((a, b) => {
    const timeCompare = a.timestampMs - b.timestampMs;
    if (timeCompare !== 0) return timeCompare;
    return String(a.representative.id).localeCompare(String(b.representative.id));
  });

  let assignedCount = 0;

  for (const group of groups) {
    const fallbackFile = findBestTimeFallback(availableFiles, group.timestampMs, usedStoragePaths);
    if (!fallbackFile) continue;

    const fallbackState = await getStorageState(bucket, fallbackFile.storagePath, caches.storageStates);
    if (!fallbackState.exists) continue;

    usedStoragePaths.add(fallbackFile.storagePath);
    assignedCount++;

    for (const item of group.members) {
      item.storagePath = fallbackFile.storagePath;
      item.imageExists = fallbackState.exists;
      item.imageHasToken = fallbackState.hasToken;
      item.downloadUrl = fallbackState.downloadUrl;
      item.usedFallback = true;
      item.fallbackStoragePath = fallbackFile.storagePath;
      item.fallbackSource = 'timeProximity';
      item.timeProximityMs = fallbackFile.timestampMs - itemTimestampMs(item);
      item.fallbackCandidates = [
        ...(item.fallbackCandidates || []),
        {
          source: 'timeProximity',
          storagePath: fallbackFile.storagePath,
          deltaMs: item.timeProximityMs,
        },
      ];
    }
  }

  return assignedCount;
}

function buildDedupeGroups(items) {
  const parent = items.map((_, index) => index);
  const keyToIndex = new Map();

  const find = index => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  items.forEach((item, index) => {
    item.dedupeKeys = dedupeKeys(item);
    for (const key of item.dedupeKeys) {
      if (keyToIndex.has(key)) {
        union(index, keyToIndex.get(key));
      } else {
        keyToIndex.set(key, index);
      }
    }
  });

  const groups = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });

  return Array.from(groups.entries()).map(([root, members]) => ({
    groupKey: `group:${root}`,
    dedupeKeys: unique(members.flatMap(member => member.dedupeKeys || [])),
    members,
  }));
}

function imageDonorRank(candidate) {
  return [
    candidate.imageExists ? 0 : 1,
    candidate.imageHasToken ? 0 : 1,
    candidate.usedFallback ? 1 : 0,
    sourceRank(candidate.source),
    candidate.dateModified || candidate.dateAdded || '',
    candidate.id,
  ];
}

function compareImageDonors(a, b) {
  const ar = imageDonorRank(a);
  const br = imageDonorRank(b);
  for (let i = 0; i < ar.length; i++) {
    if (i === 4) {
      const dateCompare = String(br[i]).localeCompare(String(ar[i]));
      if (dateCompare !== 0) return dateCompare;
      continue;
    }
    const compare = String(ar[i]).localeCompare(String(br[i]));
    if (compare !== 0) return compare;
  }
  return 0;
}

function mergeImageFromDonor(chosen, donor) {
  if (!donor || donor === chosen || !donor.imageExists || chosen.imageExists) {
    return chosen;
  }

  return {
    ...chosen,
    imageUrl: donor.downloadUrl || donor.imageUrl,
    storagePath: donor.storagePath,
    imageExists: donor.imageExists,
    imageHasToken: donor.imageHasToken,
    downloadUrl: donor.downloadUrl,
    usedFallback: donor.usedFallback,
    fallbackStoragePath: donor.fallbackStoragePath,
    fallbackSource: donor.fallbackSource,
    fallbackCandidates: donor.fallbackCandidates,
    imageDonorId: donor.id,
    imageDonorSource: donor.source,
  };
}

function selectGroupCandidate(members, currentFirestoreIds) {
  const sorted = [...members].sort((a, b) => compareCandidates(a, b, currentFirestoreIds));
  const chosen = sorted[0];
  const imageDonor = [...members].sort(compareImageDonors)[0];
  return {
    chosen: mergeImageFromDonor(chosen, imageDonor),
    sorted,
  };
}

function imageStateName(item) {
  if (item.imageExists && item.imageHasToken && item.usedFallback) return 'fallback-with-token';
  if (item.imageExists && item.usedFallback) return 'fallback-needs-token';
  if (item.imageExists && item.imageHasToken) return 'exists-with-token';
  if (item.imageExists) return 'exists-needs-token';
  if (item.storagePath) return 'missing-object';
  return 'no-cloud-path';
}

function sanitizeForRestore(candidate) {
  const finalImageUrl = candidate.downloadUrl || '';
  const restored = {
    id: candidate.id,
    imageUrl: finalImageUrl,
    category: candidate.category,
    color: candidate.color,
    pattern: candidate.pattern,
    material: candidate.material,
    style: candidate.style,
    notes: candidate.notes,
    tags: candidate.tags || { season: [], event: [] },
    userId: candidate.userId,
    createdAt: candidate.dateAdded || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    photoStatus: candidate.photoStatus || 'done',
    wornCount: candidate.wornCount || 0,
    sourceImageUrl: candidate.imageUrl || '',
    imageExists: candidate.imageExists,
    imageHasToken: candidate.imageHasToken,
    needsDownloadToken: Boolean(candidate.imageExists && !candidate.imageHasToken),
    imageState: imageStateName(candidate),
  };

  if (candidate.detectedType) restored.detectedType = candidate.detectedType;
  if (candidate.confidence !== undefined) restored.confidence = candidate.confidence;
  if (candidate.isAutoDetected !== undefined) restored.isAutoDetected = candidate.isAutoDetected;
  if (candidate.lastWorn) restored.lastWorn = candidate.lastWorn;
  if (candidate.backgroundRemovalStatus) restored.backgroundRemovalStatus = candidate.backgroundRemovalStatus;
  if (candidate.originalImageUrl) restored.originalImageUrl = candidate.originalImageUrl;
  if (candidate.imageExists && isProcessedNoBgPath(candidate.storagePath) && finalImageUrl) {
    restored.processedImageUrl = finalImageUrl;
  }
  if (candidate.imageExists && candidate.storagePath) {
    restored.imageStoragePath = candidate.storagePath;
  }
  if (candidate.usedFallback) {
    restored.imageRestoredFromFallback = true;
    restored.originalMissingStoragePath = candidate.originalStoragePath || '';
    restored.fallbackSource = candidate.fallbackSource || '';
  }
  if (finalImageUrl) restored.localPhoto = finalImageUrl;

  return restored;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.uid || !args.primaryLocalFile) {
    printUsage();
    throw new Error('--uid and --primary-local-file are required');
  }

  initializeAdmin();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const storageCaches = {
    storageStates: new Map(),
    exists: new Map(),
    prefixes: new Map(),
    userClothingFiles: new Map(),
  };

  const primaryItems = readJsonArray(args.primaryLocalFile, 'primary local file');
  const secondaryItems = readJsonArray(args.secondaryLocalFile, 'secondary local file');
  const currentSnapshot = await db.collection('closetItems').where('userId', '==', args.uid).get();
  const currentFirestoreIds = new Set(currentSnapshot.docs.map(doc => doc.id));
  const currentFirestoreItems = currentSnapshot.docs.map(doc => ({
    ...doc.data(),
    id: doc.id,
  }));

  const sourceItems = [
    ...primaryItems.map(item => itemSummary(item, 'primary')),
    ...currentFirestoreItems.map(item => itemSummary(item, 'currentFirestore')),
    ...secondaryItems.map(item => itemSummary(item, 'secondary')),
  ].filter(item => item.id && !item.id.startsWith('item_needed_') && !item.id.startsWith('clarification_needed_'));

  for (const item of sourceItems) {
    const storageState = await resolveImageState(bucket, args.uid, item, storageCaches);
    item.userId = args.uid;
    item.originalStoragePath = storageState.originalStoragePath || item.originalStoragePath || '';
    item.storagePath = storageState.storagePath || item.storagePath || '';
    item.imageExists = storageState.exists;
    item.imageHasToken = storageState.hasToken;
    item.downloadUrl = storageState.downloadUrl;
    item.usedFallback = storageState.usedFallback;
    item.fallbackStoragePath = storageState.fallbackStoragePath || '';
    item.fallbackSource = storageState.fallbackSource || '';
    item.fallbackCandidates = storageState.fallbackCandidates || [];
  }

  const timeProximityFallbackAssignments = await assignTimeProximityFallbacks(
    bucket,
    args.uid,
    sourceItems,
    storageCaches
  );

  const groups = buildDedupeGroups(sourceItems);
  const duplicateGroups = [];
  const selectedItems = [];
  for (const group of groups) {
    const { chosen, sorted } = selectGroupCandidate(group.members, currentFirestoreIds);
    selectedItems.push(chosen);
    if (group.members.length > 1) {
      duplicateGroups.push({
        groupKey: group.groupKey,
        dedupeKeys: group.dedupeKeys,
        chosen,
        members: sorted,
      });
    }
  }

  selectedItems.sort((a, b) => {
    const categoryCompare = a.category.localeCompare(b.category);
    if (categoryCompare !== 0) return categoryCompare;
    return a.id.localeCompare(b.id);
  });

  const selectedAlreadyInFirestore = [];
  const restoreCandidates = [];
  for (const item of selectedItems) {
    const presence = firestorePresence(item, currentFirestoreIds);
    item.firestorePresence = presence.exactExists ? 'exact' : presence.variantExists ? 'variant' : 'missing';
    if (presence.represented) selectedAlreadyInFirestore.push(item);
    else restoreCandidates.push(item);
  }

  const imageBackedRestoreCandidates = restoreCandidates.filter(item => item.imageExists);
  const missingImageRestoreCandidates = restoreCandidates.filter(item => !item.imageExists);
  const selectedCountsByCategory = {};
  const restoreCountsByCategory = {};
  const imageBackedRestoreCountsByCategory = {};
  const imageStateCounts = {};
  for (const item of selectedItems) {
    increment(selectedCountsByCategory, item.category);
    increment(imageStateCounts, imageStateName(item));
  }
  for (const item of restoreCandidates) {
    increment(restoreCountsByCategory, item.category);
  }
  for (const item of imageBackedRestoreCandidates) {
    increment(imageBackedRestoreCountsByCategory, item.category);
  }

  duplicateGroups.sort((a, b) => b.members.length - a.members.length || a.chosen.id.localeCompare(b.chosen.id));
  const needsToken = selectedItems.filter(item => item.imageExists && !item.imageHasToken).length;
  const missingImages = selectedItems.filter(item => !item.imageExists).length;
  const usedFallbacks = selectedItems.filter(item => item.usedFallback).length;
  const imageDonors = selectedItems.filter(item => item.imageDonorId).length;
  const restorePayload = imageBackedRestoreCandidates.map(sanitizeForRestore);

  fs.mkdirSync(args.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `restore-preview-${args.uid}-${timestamp}`;
  const reportPath = path.join(args.outDir, `${baseName}.json`);
  const markdownPath = path.join(args.outDir, `${baseName}.md`);
  const candidateSetPath = path.join(args.outDir, `${baseName}.candidates.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    uid: args.uid,
    inputs: {
      primaryLocalFile: args.primaryLocalFile,
      secondaryLocalFile: args.secondaryLocalFile || '',
    },
    summary: {
      primaryLocalCount: primaryItems.length,
      secondaryLocalCount: secondaryItems.length,
      currentFirestoreCount: currentFirestoreIds.size,
      sourceRowsConsidered: sourceItems.length,
      dedupedSelectedCount: selectedItems.length,
      selectedAlreadyInFirestore: selectedAlreadyInFirestore.length,
      restoreCandidateCount: restoreCandidates.length,
      imageBackedRestoreCandidateCount: imageBackedRestoreCandidates.length,
      excludedMissingImageRestoreCandidateCount: missingImageRestoreCandidates.length,
      duplicateGroupCount: duplicateGroups.length,
      needsToken,
      missingImages,
      usedFallbacks,
      imageDonors,
      timeProximityFallbackAssignments,
      selectedCountsByCategory,
      restoreCountsByCategory,
      imageBackedRestoreCountsByCategory,
      imageStateCounts,
    },
    duplicateGroups,
    samples: {
      selectedItems: selectedItems.slice(0, args.maxSamples),
      restoreCandidates: restoreCandidates.slice(0, args.maxSamples),
      imageBackedRestoreCandidates: imageBackedRestoreCandidates.slice(0, args.maxSamples),
      restoreCandidatesWithMissingImages: missingImageRestoreCandidates.slice(0, args.maxSamples),
      duplicateGroups: duplicateGroups.slice(0, args.maxDuplicateGroups),
    },
    selectedItems,
    restoreCandidates,
    imageBackedRestoreCandidates,
    missingImageRestoreCandidates,
  };

  const markdown = [
    '# Restore Preview',
    '',
    `Generated: ${report.generatedAt}`,
    `UID: ${args.uid}`,
    '',
    '## Summary',
    '',
    `- Primary local cache rows: ${primaryItems.length}`,
    `- Secondary local cache rows: ${secondaryItems.length}`,
    `- Current Firestore docs: ${currentFirestoreIds.size}`,
    `- Deduped selected closet count: ${selectedItems.length}`,
    `- Already present in Firestore: ${selectedAlreadyInFirestore.length}`,
    `- Restore candidates not currently in Firestore: ${restoreCandidates.length}`,
    `- Image-backed restore candidates in approval file: ${imageBackedRestoreCandidates.length}`,
    `- Metadata-only restore candidates excluded from approval file: ${missingImageRestoreCandidates.length}`,
    `- Duplicate groups reviewed by dedupe: ${duplicateGroups.length}`,
    `- Selected items needing Firebase download tokens before restore: ${needsToken}`,
    `- Selected items with missing Storage objects: ${missingImages}`,
    `- Selected items using fallback images: ${usedFallbacks}`,
    `- Selected items using image from a duplicate-group donor: ${imageDonors}`,
    `- Time-proximity image assignments made before dedupe: ${timeProximityFallbackAssignments}`,
    '',
    '## Deduped Selected Count By Category',
    '',
    '| Category | Count |',
    '| --- | ---: |',
    tableFromCounts(selectedCountsByCategory),
    '',
    '## Restore Candidate Count By Category',
    '',
    '| Category | Count |',
    '| --- | ---: |',
    tableFromCounts(restoreCountsByCategory),
    '',
    '## Image-Backed Restore Candidate Count By Category',
    '',
    '| Category | Count |',
    '| --- | ---: |',
    tableFromCounts(imageBackedRestoreCountsByCategory),
    '',
    '## Image-Backed Restore Candidate Samples',
    '',
    '| ID | Category | Type | Color | Image | Fallback | Source |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    imageBackedRestoreCandidates.slice(0, args.maxSamples).map(sampleRow).join('\n') || '| (none) | | | | | | |',
    '',
    '## Duplicate Group Samples',
    '',
    '| Chosen ID | Group Size | Categories In Group | Image Donor | Member IDs |',
    '| --- | ---: | --- | --- | --- |',
    duplicateGroups.slice(0, args.maxDuplicateGroups).map(duplicateGroupRow).join('\n') || '| (none) | 0 | | |',
    '',
    '## Restore Candidates With Missing Images (Excluded)',
    '',
    '| ID | Category | Type | Color | Image | Fallback | Source |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    missingImageRestoreCandidates.slice(0, args.maxSamples).map(sampleRow).join('\n') || '| (none) | | | | | | |',
    '',
  ].join('\n');

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(candidateSetPath, `${JSON.stringify({
    generatedAt: report.generatedAt,
    uid: args.uid,
    approved: false,
    policy: 'image-backed restore candidates only; missing-image candidates are excluded',
    sourceReportPath: reportPath,
    restoreCandidateCount: imageBackedRestoreCandidates.length,
    excludedMissingImageRestoreCandidateCount: missingImageRestoreCandidates.length,
    candidates: restorePayload,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    reportPath,
    markdownPath,
    candidateSetPath,
    summary: report.summary,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
