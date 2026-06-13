#!/usr/bin/env node
/**
 * Read-only recovery triage for a user's closet.
 *
 * This script does not update or delete Firestore documents, Storage objects,
 * or local app data. It inventories current Firestore docs, user Storage files,
 * Firestore backup/PITR metadata when accessible, and a small sample of delete
 * related Cloud Logging entries when accessible.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'style-genie-f65ef';
const STORAGE_BUCKET = 'style-genie-f65ef.firebasestorage.app';
const RAW_STORAGE_PREFIX = 'https://storage.googleapis.com/';

function parseArgs(argv) {
  const args = {
    uid: '',
    out: '',
    logsHours: 168,
    maxStorageOnly: 200,
    skipLogs: false,
    skipAdmin: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--uid') {
      args.uid = argv[++i] || '';
    } else if (arg === '--out') {
      args.out = argv[++i] || '';
    } else if (arg === '--logs-hours') {
      args.logsHours = Number(argv[++i] || 168);
    } else if (arg === '--max-storage-only') {
      args.maxStorageOnly = Number(argv[++i] || 200);
    } else if (arg === '--skip-logs') {
      args.skipLogs = true;
    } else if (arg === '--skip-admin') {
      args.skipAdmin = true;
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
  node scripts/recoveryReadOnlyScan.js --uid <firebase-uid> [--out report.json]

Options:
  --uid                 Required. Firebase Auth UID to scan.
  --out                 Optional report path. Defaults to recovery-reports/.
  --logs-hours          Cloud Logging lookback window. Default: 168.
  --max-storage-only    Max storage-only groups to include in report. Default: 200.
  --skip-logs           Skip Cloud Logging API checks.
  --skip-admin          Skip Firestore Admin backup/PITR checks.
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

function serializeDate(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toISOString();
  }
  return '';
}

function increment(map, key) {
  const normalized = key || '(empty)';
  map[normalized] = (map[normalized] || 0) + 1;
}

function isRawStorageUrl(value) {
  return typeof value === 'string' && value.startsWith(RAW_STORAGE_PREFIX);
}

function parseStoragePath(storageUrl) {
  if (typeof storageUrl !== 'string' || !storageUrl) return { storagePath: '' };

  try {
    const parsed = new URL(storageUrl);

    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      const bucketName = decodeURIComponent(parts.shift() || '');
      if (bucketName !== STORAGE_BUCKET) {
        return { error: `Unexpected bucket: ${bucketName || '(empty)'}` };
      }
      return { storagePath: parts.map(part => decodeURIComponent(part)).join('/') };
    }

    if (parsed.hostname === `${STORAGE_BUCKET}.storage.googleapis.com`) {
      return {
        storagePath: parsed.pathname
          .split('/')
          .filter(Boolean)
          .map(part => decodeURIComponent(part))
          .join('/'),
      };
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

    return { error: `Unsupported host: ${parsed.hostname}` };
  } catch (error) {
    return { error: error.message };
  }
}

function extensionForStoragePath(storagePath) {
  return path.extname(storagePath || '').toLowerCase() || '(none)';
}

function stripImageSuffix(fileBaseName) {
  return fileBaseName
    .replace(/_nobg$/i, '')
    .replace(/_\d{13}$/i, '');
}

function idVariants(itemId) {
  const variants = new Set();
  if (!itemId) return variants;

  variants.add(itemId);
  if (itemId.startsWith('detected_')) {
    variants.add(`item_${itemId.slice('detected_'.length)}`);
  } else if (itemId.startsWith('item_')) {
    variants.add(`detected_${itemId.slice('item_'.length)}`);
  }

  return variants;
}

function candidateIdsForStoragePath(storagePath) {
  const candidates = new Set();
  const parts = storagePath.split('/');
  const fileName = parts[parts.length - 1] || '';
  const ext = path.extname(fileName);
  const baseName = ext ? fileName.slice(0, -ext.length) : fileName;

  if (!baseName) return candidates;

  if (storagePath.includes('/clothing/')) {
    const stripped = stripImageSuffix(baseName);
    for (const variant of idVariants(stripped)) {
      candidates.add(variant);
    }
  }

  return candidates;
}

function urlKind(value) {
  if (!value) return 'missing';
  if (typeof value !== 'string') return 'non-string';
  if (value.startsWith('firebasestorage.googleapis.com')) return 'firebase-token-hostless';
  if (value.startsWith('https://firebasestorage.googleapis.com/')) return 'firebase-token';
  if (isRawStorageUrl(value)) return 'raw-gcs';
  if (value.startsWith('file://')) return 'local-file';
  return 'other';
}

function summarizeDoc(doc, storageNameSet) {
  const data = doc.data();
  const parsedImage = parseStoragePath(data.imageUrl);
  const parsedProcessed = parseStoragePath(data.processedImageUrl);
  const parsedOriginal = parseStoragePath(data.originalImageUrl);

  return {
    id: doc.id,
    category: data.category || '',
    detectedType: data.detectedType || '',
    color: data.color || '',
    material: data.material || '',
    style: data.style || '',
    createdAt: serializeDate(data.createdAt || data.dateAdded),
    updatedAt: serializeDate(data.updatedAt),
    imageUrlKind: urlKind(data.imageUrl),
    imagePath: parsedImage.storagePath || '',
    imageExists: parsedImage.storagePath ? storageNameSet.has(parsedImage.storagePath) : false,
    processedImageUrlKind: urlKind(data.processedImageUrl),
    processedImagePath: parsedProcessed.storagePath || '',
    processedImageExists: parsedProcessed.storagePath ? storageNameSet.has(parsedProcessed.storagePath) : false,
    originalImageUrlKind: urlKind(data.originalImageUrl),
    originalImagePath: parsedOriginal.storagePath || '',
    originalImageExists: parsedOriginal.storagePath ? storageNameSet.has(parsedOriginal.storagePath) : false,
    photoStatus: data.photoStatus || '',
    backgroundRemovalStatus: data.backgroundRemovalStatus || '',
    hasLocalPhotoField: Boolean(data.localPhoto),
    rawUrlFields: ['imageUrl', 'processedImageUrl', 'originalImageUrl'].filter(field => isRawStorageUrl(data[field])),
  };
}

async function listStorageFiles(bucket, uid) {
  const prefixes = [
    `users/${uid}/clothing/`,
    `users/${uid}/uploads/`,
  ];
  const files = [];

  for (const prefix of prefixes) {
    const [prefixFiles] = await bucket.getFiles({ prefix });
    for (const file of prefixFiles) {
      const [metadata] = await file.getMetadata();
      files.push({
        name: file.name,
        size: Number(metadata.size || 0),
        contentType: metadata.contentType || '',
        updated: metadata.updated || '',
        created: metadata.timeCreated || '',
        ext: extensionForStoragePath(file.name),
        candidateIds: Array.from(candidateIdsForStoragePath(file.name)),
      });
    }
  }

  return files;
}

function summarizeStorage(files, firestoreIds) {
  const byExt = {};
  const byFolder = {};
  const candidateGroups = new Map();

  for (const file of files) {
    increment(byExt, file.ext);
    increment(byFolder, file.name.includes('/uploads/') ? 'uploads' : 'clothing');

    for (const candidateId of file.candidateIds) {
      if (!candidateGroups.has(candidateId)) {
        candidateGroups.set(candidateId, []);
      }
      candidateGroups.get(candidateId).push(file);
    }
  }

  const storageOnlyGroups = [];
  for (const [candidateId, candidateFiles] of candidateGroups.entries()) {
    const variants = idVariants(candidateId);
    const hasFirestoreDoc = Array.from(variants).some(variant => firestoreIds.has(variant));
    if (!hasFirestoreDoc) {
      storageOnlyGroups.push({
        candidateId,
        fileCount: candidateFiles.length,
        files: candidateFiles
          .sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
          .slice(0, 8)
          .map(file => ({
            name: file.name,
            ext: file.ext,
            size: file.size,
            updated: file.updated,
            contentType: file.contentType,
          })),
      });
    }
  }

  storageOnlyGroups.sort((a, b) => a.candidateId.localeCompare(b.candidateId));

  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    byExt,
    byFolder,
    candidateIdGroups: candidateGroups.size,
    storageOnlyCandidateGroups: storageOnlyGroups,
  };
}

async function fetchGoogleMetadata(args) {
  const result = {
    database: null,
    backups: [],
    errors: [],
  };

  if (args.skipAdmin) return result;

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();

    const databaseResponse = await client.request({
      url: `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`,
      method: 'GET',
    });
    result.database = databaseResponse.data;

    const locationId = databaseResponse.data.locationId || 'nam5';
    const locations = Array.from(new Set([locationId, 'nam5', 'us-central1', 'us-east1']));

    for (const location of locations) {
      try {
        const backupsResponse = await client.request({
          url: `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/locations/${location}/backups`,
          method: 'GET',
        });
        result.backups.push({
          location,
          backups: backupsResponse.data.backups || [],
        });
      } catch (error) {
        result.errors.push({
          api: 'listBackups',
          location,
          error: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
      }
    }
  } catch (error) {
    result.errors.push({
      api: 'firestoreAdmin',
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
  }

  return result;
}

async function fetchDeleteLogs(args) {
  const result = {
    lookbackHours: args.logsHours,
    entries: [],
    errors: [],
  };

  if (args.skipLogs) return result;

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const since = new Date(Date.now() - args.logsHours * 60 * 60 * 1000).toISOString();
    const filters = [
      `timestamp >= "${since}" AND resource.type="cloud_function" AND textPayload:"deleteClosetItem"`,
      `timestamp >= "${since}" AND resource.type="cloud_run_revision" AND textPayload:"deleteClosetItem"`,
      `timestamp >= "${since}" AND resource.type="firestore_database" AND protoPayload.methodName:"DeleteDocument"`,
      `timestamp >= "${since}" AND resource.type="firestore_database" AND protoPayload.methodName:"Commit"`,
    ];

    for (const filter of filters) {
      try {
        const response = await client.request({
          url: 'https://logging.googleapis.com/v2/entries:list',
          method: 'POST',
          data: {
            resourceNames: [`projects/${PROJECT_ID}`],
            filter,
            orderBy: 'timestamp desc',
            pageSize: 25,
          },
        });

        const entries = (response.data.entries || []).map(entry => ({
          timestamp: entry.timestamp,
          logName: entry.logName,
          resource: entry.resource,
          severity: entry.severity,
          textPayload: entry.textPayload,
          jsonPayload: entry.jsonPayload,
          protoPayload: entry.protoPayload && {
            methodName: entry.protoPayload.methodName,
            resourceName: entry.protoPayload.resourceName,
            authenticationInfo: entry.protoPayload.authenticationInfo,
          },
        }));

        result.entries.push({ filter, count: entries.length, entries });
      } catch (error) {
        result.errors.push({
          filter,
          error: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
      }
    }
  } catch (error) {
    result.errors.push({
      api: 'logging',
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
  }

  return result;
}

function buildSummary(docs, docSummaries, storageSummary, args, adminMetadata, deleteLogs) {
  const firestoreIds = new Set(docs.map(doc => doc.id));
  const byCategory = {};
  const byDetectedType = {};
  const byImageUrlKind = {};
  const byProcessedUrlKind = {};
  const byBackgroundRemovalStatus = {};
  const createdTimes = [];
  const updatedTimes = [];

  for (const summary of docSummaries) {
    increment(byCategory, summary.category);
    increment(byDetectedType, summary.detectedType);
    increment(byImageUrlKind, summary.imageUrlKind);
    increment(byProcessedUrlKind, summary.processedImageUrlKind);
    increment(byBackgroundRemovalStatus, summary.backgroundRemovalStatus);
    if (summary.createdAt) createdTimes.push(summary.createdAt);
    if (summary.updatedAt) updatedTimes.push(summary.updatedAt);
  }

  createdTimes.sort();
  updatedTimes.sort();

  const docsWithMissingImageObject = docSummaries.filter(summary =>
    summary.imagePath && !summary.imageExists
  );
  const docsWithMissingProcessedObject = docSummaries.filter(summary =>
    summary.processedImagePath && !summary.processedImageExists
  );
  const docsWithoutImageUrl = docSummaries.filter(summary => !summary.imagePath);
  const rawUrlDocs = docSummaries.filter(summary => summary.rawUrlFields.length > 0);
  const storageOnlyGroups = storageSummary.storageOnlyCandidateGroups.slice(0, args.maxStorageOnly);

  return {
    generatedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    storageBucket: STORAGE_BUCKET,
    uid: args.uid,
    firestore: {
      closetItemDocsForUid: docs.length,
      byCategory,
      byDetectedType,
      byImageUrlKind,
      byProcessedUrlKind,
      byBackgroundRemovalStatus,
      createdAtRange: {
        first: createdTimes[0] || '',
        last: createdTimes[createdTimes.length - 1] || '',
      },
      updatedAtRange: {
        first: updatedTimes[0] || '',
        last: updatedTimes[updatedTimes.length - 1] || '',
      },
      docsWithoutImageUrl: docsWithoutImageUrl.length,
      docsWithMissingImageObject: docsWithMissingImageObject.length,
      docsWithMissingProcessedObject: docsWithMissingProcessedObject.length,
      docsWithRawStorageUrls: rawUrlDocs.length,
    },
    storage: {
      totalFiles: storageSummary.totalFiles,
      totalBytes: storageSummary.totalBytes,
      byExt: storageSummary.byExt,
      byFolder: storageSummary.byFolder,
      candidateIdGroups: storageSummary.candidateIdGroups,
      storageOnlyCandidateGroupsCount: storageSummary.storageOnlyCandidateGroups.length,
      storageOnlyCandidateGroupsIncluded: storageOnlyGroups.length,
    },
    restoreSignals: {
      pitrEnabled: adminMetadata.database?.pointInTimeRecoveryEnablement || '',
      earliestVersionTime: adminMetadata.database?.earliestVersionTime || '',
      databaseLocation: adminMetadata.database?.locationId || '',
      backupCount: adminMetadata.backups.reduce((sum, location) => sum + (location.backups || []).length, 0),
      loggingEntryGroups: deleteLogs.entries.length,
      loggingErrorCount: deleteLogs.errors.length,
      firestoreAdminErrorCount: adminMetadata.errors.length,
    },
    samples: {
      docsWithMissingImageObject: docsWithMissingImageObject.slice(0, 50),
      docsWithMissingProcessedObject: docsWithMissingProcessedObject.slice(0, 50),
      docsWithoutImageUrl: docsWithoutImageUrl.slice(0, 50),
      rawUrlDocs: rawUrlDocs.slice(0, 50),
      storageOnlyCandidateGroups: storageOnlyGroups,
    },
    details: {
      firestoreDocs: docSummaries,
      firestoreAdmin: adminMetadata,
      deleteLogs,
    },
  };
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

  const [storageFiles, snapshot, adminMetadata, deleteLogs] = await Promise.all([
    listStorageFiles(bucket, args.uid),
    db.collection('closetItems').where('userId', '==', args.uid).get(),
    fetchGoogleMetadata(args),
    fetchDeleteLogs(args),
  ]);

  const storageNameSet = new Set(storageFiles.map(file => file.name));
  const docs = snapshot.docs;
  const firestoreIds = new Set(docs.map(doc => doc.id));
  const docSummaries = docs.map(doc => summarizeDoc(doc, storageNameSet));
  const storageSummary = summarizeStorage(storageFiles, firestoreIds);
  const report = buildSummary(docs, docSummaries, storageSummary, args, adminMetadata, deleteLogs);

  const outputPath = args.out || path.join(
    process.cwd(),
    'recovery-reports',
    `recovery-scan-${args.uid}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    reportPath: outputPath,
    summary: {
      firestore: report.firestore,
      storage: report.storage,
      restoreSignals: report.restoreSignals,
    },
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
