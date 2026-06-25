/**
 * Firebase configuration for RunWars mobile app.
 * All values are loaded from environment variables via EXPO_PUBLIC_ prefix.
 * Never hardcode Firebase credentials here.
 *
 * In development with placeholder keys, auth features will show errors
 * gracefully — the app shell will still render and navigate correctly.
 */
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
// @ts-ignore
import { initializeAuth, getAuth, Auth, getReactNativePersistence } from 'firebase/auth';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

// Warn in dev if keys aren't configured yet
if (__DEV__ && !firebaseConfig.apiKey.startsWith('AIza')) {
  console.warn(
    '[RunWars] Firebase keys are placeholders. Auth features will not work.\n' +
    'Copy apps/mobile/.env.example → .env and fill in your Firebase config.'
  );
}

// Prevent duplicate app initialization in development (hot reload)
let app: FirebaseApp;
let auth: Auth;

if (getApps().length === 0) {
  console.log('[Firebase] Initializing new app...');
  app = initializeApp(firebaseConfig);
  console.log('[Firebase] App initialized. Initializing auth...');
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    console.log('[Firebase] Auth initialized successfully.');
  } catch (error) {
    console.error('[Firebase] Error in initializeAuth:', error);
    throw error;
  }
} else {
  console.log('[Firebase] App already exists. Getting app and auth...');
  app = getApps()[0]!;
  try {
    auth = getAuth(app);
    console.log('[Firebase] getAuth successful.');
  } catch (error) {
    console.error('[Firebase] Error in getAuth:', error);
    throw error;
  }
}

export { auth };
export const storage: FirebaseStorage = getStorage(app);
export default app;
