module.exports = ({ config }) => {
  return {
    ...config,
    extra: {
      ...config.extra,
      // Firebase configuration
      FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    },
  };
};
