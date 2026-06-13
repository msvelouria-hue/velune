#!/usr/bin/env node
/**
 * Restore an explicitly approved deduped closet candidate set.
 *
 * Default mode is dry-run. This script does not delete anything. In write mode
 * it only creates/uses Firebase Storage download tokens and creates missing
 * Firestore closetItems from the approved candidate file.
 */

const fs = require('fs');
const admin = require('firebase-admin');
const crypto = require('crypto');

const PROJECT_ID = 'style-genie-f65ef';
const STORAGE_BUCKET = 'style-genie-f65ef.firebasestorage.app';
const TOKEN_METADATA_KEY = 'firebaseStorageDownloadTokens';

function parseArgs(argv) {
  const args = {
    candidateSet: '',
    uid: '',
    dryRun: true,
    write: false,
    confirmApproved: false,
    limit: 0,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--candidate-set') {
      args.candidateSet = argv[++i] || '';
    } else if (arg === '--uid') {
      args.uid = argv[++i] || '';
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.write = false;
    } else if (arg === '--write') {
      args.write = true;
      args.dryRun = false;
    } else if (arg === '--confirm-approved') {
      args.confirmApproved = true;
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i] || 0);
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
  node scripts/restoreApprovedDedupedSet.js --candidate-set <file> --dry-run
  node scripts/restoreApprovedDedupedSet.js --candidate-set <file> --write --confirm-approved

The candidate file is produced by scripts/buildRestorePreview.js.
Write mode refuses to run unless --confirm-approved is present.
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

async function getOrCreateDownloadUrl(bucket, storagePath, write) {
  if (!storagePath) return { exists: false, hasToken: false, downloadUrl: '' };

  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return { exists: false, hasToken: false, downloadUrl: '' };

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
    downloadUrl: token ? firebaseDownloadUrl(storagePath, token) : '',
  };
}

function buildFirestorePayload(candidate, uid, imageUrl) {
  const payload = {
    ...candidate,
    userId: uid,
    imageUrl,
    localPhoto: imageUrl,
    restoredFromRecovery: true,
    restoredAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: new Date().toISOString(),
  };

  delete payload.id;
  delete payload.sourceImageUrl;
  delete payload.imageExists;
  delete payload.imageHasToken;
  delete payload.needsDownloadToken;
  delete payload.imageState;

  if (candidate.imageStoragePath && /_nobg\.[^.]+$/i.test(candidate.imageStoragePath)) {
    payload.processedImageUrl = imageUrl;
  } else {
    delete payload.processedImageUrl;
  }

  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.candidateSet) {
    printUsage();
    throw new Error('--candidate-set is required');
  }
  if (args.write && !args.confirmApproved) {
    throw new Error('Refusing to write without --confirm-approved');
  }

  const candidateSet = JSON.parse(fs.readFileSync(args.candidateSet, 'utf8'));
  const uid = args.uid || candidateSet.uid;
  if (!uid) throw new Error('No uid provided and candidate set has no uid');
  if (candidateSet.uid && candidateSet.uid !== uid) {
    throw new Error(`Candidate set uid ${candidateSet.uid} does not match requested uid ${uid}`);
  }

  const candidates = Array.isArray(candidateSet.candidates) ? candidateSet.candidates : [];
  const limitedCandidates = args.limit > 0 ? candidates.slice(0, args.limit) : candidates;

  initializeAdmin();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const currentSnapshot = await db.collection('closetItems').where('userId', '==', uid).get();
  const currentIds = new Set(currentSnapshot.docs.map(doc => doc.id));

  const stats = {
    mode: args.write ? 'write' : 'dry-run',
    uid,
    candidateSet: args.candidateSet,
    inputCandidates: candidates.length,
    considered: limitedCandidates.length,
    skippedAlreadyExists: 0,
    skippedMissingStorage: 0,
    skippedNoDownloadUrlInDryRun: 0,
    tokensToCreate: 0,
    tokensCreated: 0,
    docsToCreate: 0,
    docsCreated: 0,
    errors: 0,
  };
  const planned = [];
  const skipped = [];
  let batch = db.batch();
  let batchWrites = 0;

  for (const candidate of limitedCandidates) {
    const represented = Array.from(idVariants(candidate.id)).some(id => currentIds.has(id));
    if (represented) {
      stats.skippedAlreadyExists++;
      skipped.push({ id: candidate.id, reason: 'already represented in Firestore' });
      continue;
    }

    const imageStoragePath = candidate.imageStoragePath;
    const imageState = await getOrCreateDownloadUrl(bucket, imageStoragePath, args.write);
    if (!imageState.exists) {
      stats.skippedMissingStorage++;
      skipped.push({ id: candidate.id, reason: 'missing Storage object', imageStoragePath });
      continue;
    }

    if (!imageState.hasToken && !args.write) {
      stats.tokensToCreate++;
    }
    if (imageState.createdToken) {
      stats.tokensCreated++;
    }

    if (!imageState.downloadUrl && !args.write) {
      stats.docsToCreate++;
      planned.push({
        id: candidate.id,
        category: candidate.category,
        imageStoragePath,
        action: 'would create token and Firestore doc in write mode',
      });
      continue;
    }
    if (!imageState.downloadUrl) {
      stats.skippedNoDownloadUrlInDryRun++;
      skipped.push({ id: candidate.id, reason: 'no download URL after token check', imageStoragePath });
      continue;
    }

    stats.docsToCreate++;
    planned.push({
      id: candidate.id,
      category: candidate.category,
      imageStoragePath,
      action: args.write ? 'create Firestore doc' : 'would create Firestore doc',
    });

    if (args.write) {
      const ref = db.collection('closetItems').doc(candidate.id);
      batch.set(ref, buildFirestorePayload(candidate, uid, imageState.downloadUrl), { merge: false });
      batchWrites++;
      currentIds.add(candidate.id);
    }

    if (batchWrites === 450) {
      await batch.commit();
      stats.docsCreated += batchWrites;
      batch = db.batch();
      batchWrites = 0;
    }
  }

  if (args.write && batchWrites > 0) {
    await batch.commit();
    stats.docsCreated += batchWrites;
  }

  console.log(JSON.stringify({
    stats,
    planned: planned.slice(0, 50),
    skipped: skipped.slice(0, 50),
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
