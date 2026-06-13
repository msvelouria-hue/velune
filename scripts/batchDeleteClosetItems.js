#!/usr/bin/env node
/**
 * Batch Delete Closet Items Script
 *
 * Usage: node scripts/batchDeleteClosetItems.js
 *
 * Reads item IDs from batch_closet_item_delete.txt (one ID per line)
 * and deletes each item from Firestore and optionally Firebase Storage.
 *
 * Prerequisites:
 * - GOOGLE_APPLICATION_CREDENTIALS environment variable set to service account key path
 * - Or run from a GCP environment with appropriate permissions
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROJECT_ID = 'style-genie-f65ef';
const STORAGE_BUCKET = 'style-genie-f65ef.firebasestorage.app';
const INPUT_FILE = 'batch_closet_item_delete.txt';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: PROJECT_ID,
    storageBucket: STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function deleteItem(itemId, deleteImages) {
  const result = { itemId, firestoreDeleted: false, storageFilesDeleted: 0, errors: [] };

  try {
    // Get the document to find userId for storage path
    const docRef = db.collection('closetItems').doc(itemId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.log(`⚠️  ${itemId}: Not found in Firestore (may already be deleted)`);
      result.errors.push('Document not found');
      return result;
    }

    const data = doc.data();
    const userId = data.userId;

    // Delete storage files matching the item ID (only if requested)
    if (deleteImages && userId) {
      try {
        const prefix = `users/${userId}/clothing/${itemId}`;
        const [files] = await bucket.getFiles({ prefix });

        for (const file of files) {
          try {
            await file.delete();
            result.storageFilesDeleted++;
            console.log(`   🗑️  Deleted: ${file.name}`);
          } catch (fileError) {
            result.errors.push(`Storage file error: ${fileError.message}`);
          }
        }
      } catch (storageError) {
        result.errors.push(`Storage listing error: ${storageError.message}`);
      }
    }

    // Delete the Firestore document
    await docRef.delete();
    result.firestoreDeleted = true;

    // Verify deletion
    const verifyDoc = await docRef.get();
    if (verifyDoc.exists) {
      result.firestoreDeleted = false;
      result.errors.push('Document still exists after deletion');
      console.log(`❌ ${itemId}: Firestore delete failed - document still exists`);
    } else {
      if (deleteImages) {
        console.log(`✅ ${itemId}: Deleted (${result.storageFilesDeleted} storage files)`);
      } else {
        console.log(`✅ ${itemId}: Deleted (images preserved)`);
      }
    }

    return result;
  } catch (error) {
    result.errors.push(error.message);
    console.error(`❌ ${itemId}: Error - ${error.message}`);
    return result;
  }
}

async function main() {
  const inputPath = path.join(process.cwd(), INPUT_FILE);

  if (!fs.existsSync(inputPath)) {
    console.error(`\n❌ File not found: ${INPUT_FILE}`);
    console.log('\nCreate this file in the project root with one item ID per line.');
    console.log('Example:');
    console.log('  item_1234567890_abc');
    console.log('  item_9876543210_xyz');
    console.log('');
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const ids = content
    .split('\n')
    .map(id => id.trim())
    .filter(id => id.length > 0 && !id.startsWith('#')); // Skip empty lines and comments

  if (ids.length === 0) {
    console.log('\n⚠️  No item IDs found in file.');
    process.exit(0);
  }

  console.log(`\n📋 Found ${ids.length} items to delete\n`);

  // Ask about image deletion
  const answer = await askQuestion(
    'Should images also be deleted? (Answer N if deleting duplicates that share the same image URL) [y/N]: '
  );
  const deleteImages = answer === 'y' || answer === 'yes';

  if (deleteImages) {
    console.log('\n🖼️  Images WILL be deleted along with Firestore documents\n');
  } else {
    console.log('\n🖼️  Images will be PRESERVED (only Firestore documents deleted)\n');
  }

  console.log('─'.repeat(60));

  const results = { deleted: 0, notFound: 0, errors: 0, imagesDeleted: 0 };

  for (const id of ids) {
    const result = await deleteItem(id, deleteImages);
    if (result.firestoreDeleted) {
      results.deleted++;
      results.imagesDeleted += result.storageFilesDeleted;
    } else if (result.errors.includes('Document not found')) {
      results.notFound++;
    } else {
      results.errors++;
    }
  }

  console.log('─'.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Deleted: ${results.deleted}`);
  if (deleteImages) {
    console.log(`   🖼️  Images deleted: ${results.imagesDeleted}`);
  } else {
    console.log(`   🖼️  Images preserved`);
  }
  console.log(`   ⚠️  Not found: ${results.notFound}`);
  console.log(`   ❌ Errors: ${results.errors}`);
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
