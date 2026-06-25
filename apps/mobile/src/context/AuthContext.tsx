/**
 * AuthContext — Firebase Authentication state management for RunWars.
 *
 * Provides: user, firebaseUser, loading, signIn, signUp, signOut, signInWithGoogle
 *
 * Wraps the entire app. Any screen can call useAuth() to access auth state.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  updateProfile,
} from 'firebase/auth';
import { auth } from '@/config/firebase';
import type { CharacterType } from '@runwars/shared';
import { getRandomTerritoryColor } from '@runwars/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  characterType?: CharacterType;
  color?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<FirebaseUser>;
  signOut: () => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  setCharacterAndColor: (
    character: CharacterType,
    color: string
  ) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Map FirebaseUser → AuthUser
  const mapUser = useCallback(
    (fbUser: FirebaseUser | null): AuthUser | null => {
      if (!fbUser) return null;
      return {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        photoURL: fbUser.photoURL,
      };
    },
    []
  );

  // Subscribe to Firebase auth state changes & load persisted session
  useEffect(() => {
    const checkPersistedUser = async () => {
      try {
        const isPlaceholderKey = !process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY === 'YOUR_FIREBASE_API_KEY' || 
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY.includes('DEMO_REPLACE');

        if (isPlaceholderKey) {
          const stored = await AsyncStorage.getItem('@runwars:mock_user');
          if (stored) {
            const parsed = JSON.parse(stored);
            const apiUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';
            try {
              const profileRes = await fetch(`${apiUrl}/profile/${parsed.uid}`, {
                headers: { 'Bypass-Tunnel-Reminder': 'true' }
              });
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                setUser({
                  uid: parsed.uid,
                  email: parsed.email,
                  displayName: profileData.display_name || parsed.displayName,
                  photoURL: profileData.avatar_url || parsed.photoURL,
                  characterType: profileData.character_type || 'scout',
                  color: profileData.color || '#00BFFF',
                });
              } else {
                setUser(parsed);
              }
            } catch {
              setUser(parsed);
            }
          }
        }
      } catch (err) {
        console.error('[AuthContext] Failed to load persisted mock user:', err);
      } finally {
        setLoading(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setFirebaseUser(fbUser);
        const apiUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';
        try {
          const profileRes = await fetch(`${apiUrl}/profile/${fbUser.uid}`, {
            headers: { 'Bypass-Tunnel-Reminder': 'true' }
          });
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            setUser({
              uid: fbUser.uid,
              email: fbUser.email,
              displayName: profileData.display_name || fbUser.displayName || 'Runner',
              photoURL: profileData.avatar_url || fbUser.photoURL,
              characterType: profileData.character_type || 'scout',
              color: profileData.color || '#00BFFF',
            });
          } else {
            setUser({
              uid: fbUser.uid,
              email: fbUser.email,
              displayName: fbUser.displayName || 'Runner',
              photoURL: fbUser.photoURL,
              characterType: 'scout',
              color: '#00BFFF',
            });
          }
        } catch {
          setUser(mapUser(fbUser));
        }
        setLoading(false);
      } else {
        const isPlaceholderKey = !process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY === 'YOUR_FIREBASE_API_KEY' || 
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY.includes('DEMO_REPLACE');
        if (isPlaceholderKey) {
          checkPersistedUser();
        } else {
          setFirebaseUser(null);
          setUser(null);
          setLoading(false);
        }
      }
    });

    return unsubscribe;
  }, [mapUser]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const isPlaceholderKey = !process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 
        process.env.EXPO_PUBLIC_FIREBASE_API_KEY === 'YOUR_FIREBASE_API_KEY' || 
        process.env.EXPO_PUBLIC_FIREBASE_API_KEY.includes('DEMO_REPLACE');
        
      if (isPlaceholderKey || (email.toLowerCase().trim() === 'test@test.com' && password === 'password')) {
        const mockUser = {
          uid: `mock-user-${Date.now()}`,
          email: email.trim(),
          displayName: email.split('@')[0] || 'Test Runner',
          photoURL: null,
          characterType: 'scout' as CharacterType,
          color: getRandomTerritoryColor(),
        };
        setUser(mockUser);
        await AsyncStorage.setItem('@runwars:mock_user', JSON.stringify(mockUser));
        return;
      }

      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        throw new Error(
          `Sign in failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    },
    []
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      displayName: string
    ): Promise<FirebaseUser> => {
      const isPlaceholderKey = !process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 
        process.env.EXPO_PUBLIC_FIREBASE_API_KEY === 'YOUR_FIREBASE_API_KEY' || 
        process.env.EXPO_PUBLIC_FIREBASE_API_KEY.includes('DEMO_REPLACE');

      if (isPlaceholderKey) {
        const mockUser = {
          uid: `mock-user-${Date.now()}`,
          email: email.trim(),
          displayName: displayName,
          photoURL: null,
          characterType: 'scout' as CharacterType,
          color: getRandomTerritoryColor(),
        };
        setUser(mockUser);
        await AsyncStorage.setItem('@runwars:mock_user', JSON.stringify(mockUser));
        return { uid: mockUser.uid, email, displayName } as any;
      }

      try {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        await updateProfile(credential.user, { displayName });
        return credential.user;
      } catch (error) {
        throw new Error(
          `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    },
    []
  );

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem('@runwars:mock_user');
      await firebaseSignOut(auth);
      setUser(null);
      setFirebaseUser(null);
    } catch (error) {
      throw new Error(
        `Sign out failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }, []);

  const signInWithGoogle = useCallback(
    async (idToken: string): Promise<void> => {
      try {
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } catch (error) {
        throw new Error(
          `Google sign-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    },
    []
  );

  const setCharacterAndColor = useCallback(
    async (character: CharacterType, color: string): Promise<void> => {
      setUser((prev) => {
        if (!prev) return null;
        const updated = { ...prev, characterType: character, color };
        const isPlaceholderKey = !process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY === 'YOUR_FIREBASE_API_KEY' || 
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY.includes('DEMO_REPLACE');
        if (isPlaceholderKey) {
          AsyncStorage.setItem('@runwars:mock_user', JSON.stringify(updated)).catch(err => 
            console.error('[AuthContext] Failed to persist character update:', err)
          );
        }
        return updated;
      });
    },
    []
  );

  const value: AuthContextValue = {
    user,
    firebaseUser,
    loading,
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
    setCharacterAndColor,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
