#!/usr/bin/env node
/**
 * Audits closet item image URLs that use raw Google Cloud Storage URLs and,
 * with --write, replaces them with Firebase Storage download-token URLs.
 *
 * Usage:
 *   node scripts/auditRepairStorageUrls.js --uid JJr3... --dry-run
 *   node scripts/auditRepairStorageUrls.js --uid JJr3... --write
 *
 * Prerequisites:
 * - GOOGLE_APPLICATION_CREDENTIALS points to a service account key, or
 * - the command runs in an environment with Firebase Admin credentials.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const PROJECT_ID = 'style-genie-f65ef';
const STORAGE_BUCKET = 'style-genie-f65ef.firebasestorage.app';
const TOKEN_METADATA_KEY = 'firebaseStorageDownloadTokens';
const RAW_STORAGE_PREFIX = 'https://storage.googleapis.com/';

function parseArgs(argv) {
  const args = {
    dryRun: true,
    write: false,
    uid: '',
    limit: 0,
    repairMissingProcessed: false,
    processedUrlMode: 'clear',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uid') {
      args.uid = argv[++i] || '';
    } else if (arg === '--write') {
      args.write = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.write = false;
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i] || 0);
    } else if (arg === '--repair-missing-processed') {
      args.repairMissingProcessed = true;
    } else if (arg === '--clear-processed-url') {
      args.processedUrlMode = 'clear';
    } else if (arg === '--preserve-processed-url') {
      args.processedUrlMode = 'preserve';
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
  node scripts/auditRepairStorageUrls.js --uid <firebase-uid> [--dry-run]
  node scripts/auditRepairStorageUrls.js --uid <firebase-uid> --write
  node scripts/auditRepairStorageUrls.js --uid <firebase-uid> --repair-missing-processed --dry-run
  node scripts/auditRepairStorageUrls.js --uid <firebase-uid> --repair-missing-processed --write

Options:
  --uid                       Required. Firebase auth UID whose closetItems should be audited.
  --dry-run                   Default. Audit only; do not update Storage metadata or Firestore.
  --write                     Create missing download tokens and update Firestore URL fields.
  --limit                     Optional max document count, useful for a small test run.
  --repair-missing-processed  For missing *_nobg imageUrl values, replace imageUrl with
                              the best fallback .webp file. This is separate from raw URL
                              token repair and still requires --write to mutate data.
  --clear-processed-url       Default with --repair-missing-processed. Delete broken
                              processedImageUrl values that point to missing *_nobg files.
  --preserve-processed-url    Keep broken processedImageUrl values while repairing imageUrl.
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

function isRawStorageUrl(value) {
  return typeof value === 'string' && value.startsWith(RAW_STORAGE_PREFIX);
}

function parseRawStoragePath(rawUrl) {
  return parseStoragePath(rawUrl, { requireRawStorageUrl: true });
}

function parseStoragePath(storageUrl, options = {}) {
  try {
    const parsed = new URL(storageUrl);

    if (options.requireRawStorageUrl && !isRawStorageUrl(storageUrl)) {
      return { error: 'Not a raw Storage URL' };
    }

    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const bucketName = decodeURIComponent(parts.shift() || '');
      if (bucketName !== STORAGE_BUCKET) {
        return { error: `Unexpected bucket: ${bucketName || '(empty)'}` };
      }
      return { storagePath: parts.map(part => decodeURIComponent(part)).join('/') };
    }

    if (parsed.hostname === `${STORAGE_BUCKET}.storage.googleapis.com`) {
      const storagePath = parsed.pathname
        .split('/')
        .filter(Boolean)
        .map(part => decodeURIComponent(part))
        .join('/');
      return { storagePath };
    }

    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (!match) {
        return { error: 'Unsupported Firebase Storage URL path' };
      }

      const bucketName = decodeURIComponent(match[1]);
      if (bucketName !== STORAGE_BUCKET) {
        return { error: `Unexpected bucket: ${bucketName || '(empty)'}` };
      }

      return { storagePath: decodeURIComponent(match[2]) };
    }

    return { error: `Unsupported Storage host: ${parsed.hostname}` };
  } catch (error) {
    return { error: error.message };
  }
}

function createFirebaseDownloadUrl(storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${
    encodeURIComponent(storagePath)
  }?alt=media&token=${token}`;
}

function firstToken(metadata) {
  const tokenValue = metadata && metadata.metadata && metadata.metadata[TOKEN_METADATA_KEY];
  if (typeof tokenValue !== 'string') return '';
  return tokenValue.split(',').map(token => token.trim()).find(Boolean) || '';
}

async function getOrCreateDownloadUrl(bucket, storagePath, write) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    return { exists: false };
  }

  const [metadata] = await file.getMetadata();
  let token = firstToken(metadata);
  let createdToken = false;

  if (!token && write) {
    token = crypto.randomUUID();
    await file.setMetadata({
      metadata: {
        ...(metadata.metadata || {}),
        [TOKEN_METADATA_KEY]: token,
      },
    });
    createdToken = true;
  }

  return {
    exists: true,
    hasToken: Boolean(token),
    createdToken,
    downloadUrl: token ? createFirebaseDownloadUrl(storagePath, token) : '',
  };
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

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getItemIdVariants(docId, data) {
  const ids = [docId, data.id];

  for (const id of [...ids]) {
    if (typeof id !== 'string') continue;

    if (id.startsWith('item_')) {
      ids.push(`detected_${id.slice('item_'.length)}`);
    } else if (id.startsWith('detected_')) {
      ids.push(`item_${id.slice('detected_'.length)}`);
    }
  }

  return unique(ids);
}

function isProcessedNoBgPath(storagePath) {
  return /_nobg\.[^.]+$/i.test(storagePath || '');
}

function trailingTimestamp(storagePath) {
  const match = String(storagePath || '').match(/_(\d{13})(?:\.[^.]+)?$/);
  return match ? Number(match[1]) : 0;
}

function chooseBestFallbackCandidate(candidates) {
  const imageCandidates = candidates.filter(candidate =>
    /\.(webp|png|jpe?g)$/i.test(candidate.storagePath || '')
  );
  const preferred = imageCandidates.filter(candidate => /\.webp$/i.test(candidate.storagePath || ''));
  const pool = preferred.length > 0 ? preferred : imageCandidates;

  return pool.sort((a, b) => {
    const sourceRank = source => {
      if (source === 'clothingPrefix') return 0;
      if (source === 'originalImageUrl') return 1;
      if (source === 'uploadPrefix') return 2;
      return 3;
    };

    const sourceDelta = sourceRank(a.source) - sourceRank(b.source);
    if (sourceDelta !== 0) return sourceDelta;

    const timestampDelta = trailingTimestamp(b.storagePath) - trailingTimestamp(a.storagePath);
    if (timestampDelta !== 0) return timestampDelta;

    return String(a.storagePath).localeCompare(String(b.storagePath));
  })[0] || null;
}

function getPrefixFromMissingPath(storagePath) {
  if (!storagePath) return '';
  return storagePath
    .replace(/_nobg\.[^.]+$/i, '')
    .replace(/\.[^.]+$/i, '');
}

async function findFallbackCandidates(bucket, uid, docId, data, missingPath, caches) {
  const candidates = [];

  if (data.originalImageUrl) {
    const parsedOriginal = parseStoragePath(data.originalImageUrl);
    if (parsedOriginal.storagePath) {
      const exists = await fileExists(bucket, parsedOriginal.storagePath, caches.exists);
      if (exists) {
        candidates.push({
          source: 'originalImageUrl',
          storagePath: parsedOriginal.storagePath,
          url: data.originalImageUrl,
        });
      }
    }
  }

  const idVariants = getItemIdVariants(docId, data);
  const prefixes = [
    getPrefixFromMissingPath(missingPath),
    ...idVariants.map(id => `users/${uid}/clothing/${id}`),
  ];

  if (typeof data.tempId === 'string' && data.tempId) {
    prefixes.push(`users/${uid}/uploads/${data.tempId}`);
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

function addToGroup(groups, key, item) {
  if (!key) return;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(item);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.uid) {
    printUsage();
    throw new Error('--uid is required');
  }

  initializeAdmin();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const pathCache = new Map();
  const fallbackCaches = {
    exists: new Map(),
    prefixes: new Map(),
  };
  const duplicateImageGroups = new Map();
  const duplicateOriginalGroups = new Map();

  let query = db.collection('closetItems').where('userId', '==', args.uid);
  if (args.limit > 0) query = query.limit(args.limit);

  const snapshot = await query.get();
  const stats = {
    scanned: 0,
    docsWithRawUrls: 0,
    rawFields: 0,
    existingObjects: 0,
    missingObjects: 0,
    missingFieldsWithFallbacks: 0,
    missingFieldsWithoutFallbacks: 0,
    missingProcessedImageUrlRepairCandidates: 0,
    missingProcessedImageUrlsRepaired: 0,
    missingProcessedProcessedUrlsCleared: 0,
    missingProcessedProcessedUrlsPreserved: 0,
    fallbackTokensToCreate: 0,
    fallbackTokensCreated: 0,
    fieldsWithExistingTokens: 0,
    tokensToCreate: 0,
    tokensCreated: 0,
    docsUpdated: 0,
    parseErrors: 0,
    updateErrors: 0,
  };
  const missing = [];
  const parseErrors = [];
  const noToken = [];
  const updated = [];
  const missingProcessedRepairs = [];

  for (const doc of snapshot.docs) {
    stats.scanned++;
    const data = doc.data();
    const duplicatePayload = {
      id: doc.id,
      category: data.category || '',
      detectedType: data.detectedType || '',
      createdAt: data.createdAt || data.dateAdded || '',
    };

    addToGroup(duplicateImageGroups, data.imageUrl, duplicatePayload);
    addToGroup(duplicateOriginalGroups, data.originalImageUrl, duplicatePayload);

    const fieldsToCheck = ['imageUrl', 'processedImageUrl'];
    const updates = {};
    let docHadRawUrl = false;

    for (const field of fieldsToCheck) {
      const value = data[field];
      if (!isRawStorageUrl(value)) continue;

      docHadRawUrl = true;
      stats.rawFields++;

      const parsed = parseRawStoragePath(value);
      if (parsed.error || !parsed.storagePath) {
        stats.parseErrors++;
        parseErrors.push({ id: doc.id, field, url: value, error: parsed.error || 'No storage path' });
        continue;
      }

      let repair = pathCache.get(parsed.storagePath);
      if (!repair) {
        repair = await getOrCreateDownloadUrl(bucket, parsed.storagePath, args.write);
        pathCache.set(parsed.storagePath, repair);
      }

      if (!repair.exists) {
        stats.missingObjects++;
        const fallbackCandidates = await findFallbackCandidates(
          bucket,
          args.uid,
          doc.id,
          data,
          parsed.storagePath,
          fallbackCaches
        );

        if (fallbackCandidates.length > 0) {
          stats.missingFieldsWithFallbacks++;
        } else {
          stats.missingFieldsWithoutFallbacks++;
        }

        const missingEntry = {
          id: doc.id,
          field,
          storagePath: parsed.storagePath,
          category: data.category || '',
          detectedType: data.detectedType || '',
          fallbackCandidates,
        };

        if (args.repairMissingProcessed && isProcessedNoBgPath(parsed.storagePath)) {
          if (field === 'imageUrl') {
            const bestFallback = chooseBestFallbackCandidate(fallbackCandidates);

            if (bestFallback) {
              let fallbackRepair = pathCache.get(bestFallback.storagePath);
              if (!fallbackRepair) {
                fallbackRepair = await getOrCreateDownloadUrl(bucket, bestFallback.storagePath, args.write);
                pathCache.set(bestFallback.storagePath, fallbackRepair);
              }

              if (fallbackRepair.exists) {
                stats.missingProcessedImageUrlRepairCandidates++;

                if (!fallbackRepair.hasToken && !args.write) {
                  stats.fallbackTokensToCreate++;
                }

                if (fallbackRepair.createdToken) {
                  stats.fallbackTokensCreated++;
                }

                const repairPlan = {
                  id: doc.id,
                  action: 'replace imageUrl with fallback',
                  missingStoragePath: parsed.storagePath,
                  fallbackStoragePath: bestFallback.storagePath,
                  fallbackSource: bestFallback.source,
                  fallbackHasToken: fallbackRepair.hasToken,
                  fallbackNeedsToken: !fallbackRepair.hasToken,
                  willWrite: Boolean(args.write && fallbackRepair.downloadUrl),
                  processedUrlMode: args.processedUrlMode,
                };

                missingProcessedRepairs.push(repairPlan);
                missingEntry.repairPlan = repairPlan;

                if (args.write && fallbackRepair.downloadUrl) {
                  updates.imageUrl = fallbackRepair.downloadUrl;
                  stats.missingProcessedImageUrlsRepaired++;
                }
              }
            }
          } else if (field === 'processedImageUrl') {
            const repairPlan = {
              id: doc.id,
              action: args.processedUrlMode === 'clear'
                ? 'delete broken processedImageUrl'
                : 'preserve broken processedImageUrl',
              missingStoragePath: parsed.storagePath,
              willWrite: Boolean(args.write && args.processedUrlMode === 'clear'),
            };

            missingProcessedRepairs.push(repairPlan);
            missingEntry.repairPlan = repairPlan;

            if (args.processedUrlMode === 'clear') {
              if (args.write) {
                updates.processedImageUrl = admin.firestore.FieldValue.delete();
                stats.missingProcessedProcessedUrlsCleared++;
              }
            } else {
              stats.missingProcessedProcessedUrlsPreserved++;
            }
          }
        }

        missing.push({
          ...missingEntry,
        });
        continue;
      }

      stats.existingObjects++;
      if (repair.hasToken) {
        stats.fieldsWithExistingTokens++;
      } else {
        stats.tokensToCreate++;
        noToken.push({ id: doc.id, field, storagePath: parsed.storagePath, category: data.category || '' });
      }

      if (repair.createdToken) {
        stats.tokensCreated++;
      }

      if (!args.repairMissingProcessed && args.write && repair.downloadUrl && repair.downloadUrl !== value) {
        updates[field] = repair.downloadUrl;
      }
    }

    if (docHadRawUrl) {
      stats.docsWithRawUrls++;
    }

    if (Object.keys(updates).length > 0) {
      try {
        updates.urlRepairedAt = admin.firestore.FieldValue.serverTimestamp();
        await doc.ref.update(updates);
        stats.docsUpdated++;
        updated.push({ id: doc.id, fields: Object.keys(updates).filter(field => field !== 'urlRepairedAt') });
      } catch (error) {
        stats.updateErrors++;
        console.error(`Failed to update ${doc.id}: ${error.message}`);
      }
    }
  }

  const duplicateImages = Array.from(duplicateImageGroups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([url, items]) => ({ url, items }));
  const duplicateOriginals = Array.from(duplicateOriginalGroups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([url, items]) => ({ url, items }));

  console.log(JSON.stringify({
    mode: args.write ? 'write' : 'dry-run',
    repairMissingProcessed: args.repairMissingProcessed,
    processedUrlMode: args.processedUrlMode,
    uid: args.uid,
    stats,
    missing,
    missingProcessedRepairs,
    noToken: args.write ? [] : noToken,
    parseErrors,
    updated,
    duplicateImages,
    duplicateOriginals,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
