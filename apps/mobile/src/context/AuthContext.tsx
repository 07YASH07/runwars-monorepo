/**
 * AuthContext — StrideClash session lifecycle.
 *
 * One credential for everything: the backend JWT (email/password AND Google,
 * which is exchanged via /api/auth/google). Stored in SecureStore; profile
 * cache in AsyncStorage.
 *
 * - Startup: validates the stored token with /api/auth/me. Expired/invalid →
 *   signed out. Offline → keeps the cached session (the run engine must work
 *   without connectivity) and re-validates later.
 * - Any API 401 with TOKEN_EXPIRED/TOKEN_INVALID → automatic sign-out.
 * - Logout: Firebase sign-out, socket teardown, secure + cached auth cleared,
 *   navigation reset to Login (RootRouter renders Auth when user is null).
 *   Never deletes server-side data or queued runs.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '@/config/firebase';
import type { CharacterType } from '@runwars/shared';
import { apiFetch, setAuthToken, setUnauthorizedHandler, NetworkError } from '@/config/api';
import { socketService } from '@/services/SocketService';
import { clearFirebaseSession, ensureFirebaseSession } from '@/services/FirebaseSession';
import { RunSyncService } from '@/services/RunSyncService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  uid: string;
  selectedAvatar?: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  characterType?: CharacterType;
  color?: string;
  token?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True only while the stored session is being restored at app start. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, characterType?: string, color?: string) => Promise<void>;
  logout: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string, characterType?: string, color?: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  setCharacterAndColor: (character: CharacterType, color: string) => Promise<void>;
  updateLocalUser: (patch: Partial<AuthUser>) => void;
}

const TOKEN_KEY = 'runwars_jwt';
const USER_KEY = '@runwars:user';
// Per-user caches that must not leak into the next account on this device.
const USER_SCOPED_CACHE_KEYS = ['@runwars:profileCache', '@runwars:feedCache'];

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(apiUser: any, email: string | null, token: string): AuthUser {
  return {
    uid: apiUser.id,
    email: apiUser.email ?? email,
    displayName: apiUser.display_name ?? null,
    characterType: apiUser.character_type,
    color: apiUser.color,
    photoURL: apiUser.avatar_url || null,
    token,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loggingOut = useRef(false);

  const persistSession = useCallback(async (u: AuthUser) => {
    if (u.token) await SecureStore.setItemAsync(TOKEN_KEY, u.token);
    const { token: _omit, ...cacheable } = u;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(cacheable));
  }, []);

  const startSession = useCallback(async (u: AuthUser) => {
    setAuthToken(u.token || null);
    await persistSession(u);
    setUser(u);
    // Background work — never blocks sign-in.
    RunSyncService.flush(u.uid).catch(() => {});
    ensureFirebaseSession(u.uid).catch((e) => console.log('[Auth] Firebase session not ready:', e?.message));
  }, [persistSession]);

  const logout = useCallback(async (): Promise<void> => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      socketService.disconnect();
      await clearFirebaseSession();
      setAuthToken(null);
      await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      await AsyncStorage.multiRemove([USER_KEY, ...USER_SCOPED_CACHE_KEYS]).catch(() => {});
      setUser(null); // RootRouter swaps to the Auth stack → Login screen.
    } finally {
      loggingOut.current = false;
    }
  }, []);

  // Server says the session is no longer valid → sign out once, with a notice.
  useEffect(() => {
    setUnauthorizedHandler((code) => {
      if (loggingOut.current) return;
      logout().then(() => {
        Alert.alert(
          code === 'TOKEN_EXPIRED' ? 'Session expired' : 'Signed out',
          'Please log in again to continue.'
        );
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Restore + validate session at startup.
  useEffect(() => {
    (async () => {
      try {
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        const storedUser = await AsyncStorage.getItem(USER_KEY);
        if (!storedToken || !storedUser) {
          // Partial leftovers from older builds: clean them up.
          if (storedToken || storedUser) await logout();
          return;
        }
        const cached: AuthUser = { ...JSON.parse(storedUser), token: storedToken };
        setAuthToken(storedToken);
        try {
          const res = await apiFetch('/api/auth/me');
          if (res.status === 401) {
            await logout();
            return;
          }
          if (res.ok) {
            const { user: apiUser } = await res.json();
            const fresh = { ...cached, ...toAuthUser(apiUser, cached.email, storedToken), selectedAvatar: cached.selectedAvatar };
            await persistSession(fresh);
            setUser(fresh);
          } else {
            setUser(cached);
          }
        } catch (e) {
          // Offline / server asleep: keep the cached session so runs still work.
          if (!(e instanceof NetworkError)) console.warn('[Auth] validate failed', e);
          setUser(cached);
        }
        RunSyncService.flush(cached.uid).catch(() => {});
        ensureFirebaseSession(cached.uid).catch(() => {});
      } catch (err) {
        console.error('[AuthContext] Restore session failed:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [logout, persistSession]);

  // Register push token when logged in (best effort).
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#22C55E',
          });
        }
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          finalStatus = (await Notifications.requestPermissionsAsync()).status;
        }
        if (finalStatus !== 'granted') return;
        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: projectId && projectId !== 'your-eas-project-id' ? projectId : 'd957dd92-6e79-494f-9173-b05d21ebe446',
        });
        await apiFetch('/api/users/push-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokenData.data }),
        });
      } catch (e) {
        console.log('[AuthContext] Push token not registered:', (e as Error)?.message);
      }
    })();
  }, [user?.uid]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed');
    await startSession(toAuthUser(data.user, email.trim().toLowerCase(), data.token));
  }, [startSession]);

  const register = useCallback(async (email: string, password: string, displayName: string, characterType: string = 'scout', color: string = '#22C55E'): Promise<void> => {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, displayName: displayName.trim(), characterType, color }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    await startSession(toAuthUser(data.user, email.trim().toLowerCase(), data.token));
  }, [startSession]);

  const signInWithGoogle = useCallback(async (googleIdToken: string): Promise<void> => {
    // 1. Firebase session from the Google credential.
    const credential = GoogleAuthProvider.credential(googleIdToken);
    const cred = await signInWithCredential(auth, credential);
    // 2. Exchange the Firebase ID token for a backend session (server verifies it).
    const res = await apiFetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: await cred.user.getIdToken() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await clearFirebaseSession();
      throw new Error(data.error || 'Google sign-in failed');
    }
    const u = toAuthUser(data.user, cred.user.email, data.token);
    u.photoURL = u.photoURL || cred.user.photoURL;
    await startSession(u);
  }, [startSession]);

  const updateLocalUser = useCallback((patch: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      persistSession(next).catch(() => {});
      return next;
    });
  }, [persistSession]);

  const setCharacterAndColor = useCallback(async (character: CharacterType, color: string): Promise<void> => {
    updateLocalUser({ characterType: character, color });
  }, [updateLocalUser]);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      login,
      register,
      logout,
      signIn: login,
      signUp: register,
      signOut: logout,
      signInWithGoogle,
      setCharacterAndColor,
      updateLocalUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}
