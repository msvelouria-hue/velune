
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Ensure vector icons are properly resolved
config.resolver.assetExts.push('ttf');

// Add .cjs support for Firebase SDK
config.resolver.sourceExts.push('cjs');

// Disable package exports to fix Firebase import issues in React Native
config.resolver.unstable_enablePackageExports = false;

// Exclude the functions folder (Firebase Cloud Functions) from Metro bundling
// This prevents Metro from resolving modules from functions/node_modules
config.resolver.blockList = [
  ...(config.resolver.blockList || []),
  new RegExp(path.resolve(__dirname, 'functions') + '/.*'),
];

module.exports = config;
