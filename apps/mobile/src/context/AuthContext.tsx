import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { CharacterType } from '@runwars/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  characterType?: CharacterType;
  color?: string;
  token?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, characterType: string, color: string) => Promise<void>;
  logout: () => Promise<void>;
  setCharacterAndColor: (character: CharacterType, color: string) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);
const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync('runwars_jwt');
        const storedUser = await AsyncStorage.getItem('@runwars:user');
        if (storedToken && storedUser) {
          const parsedUser = JSON.parse(storedUser);
          parsedUser.token = storedToken;
          
          // Fetch latest profile
          try {
            const profileRes = await fetch(`${API_URL}/api/profile/${parsedUser.uid}`, {
              headers: { 'Bypass-Tunnel-Reminder': 'true' }
            });
            if (profileRes.ok) {
              const profileData = await profileRes.json();
              setUser({
                ...parsedUser,
                displayName: profileData.user.display_name,
                characterType: profileData.user.character_type,
                color: profileData.user.color,
                photoURL: profileData.user.avatar_url,
              });
            } else {
              setUser(parsedUser);
            }
          } catch {
            setUser(parsedUser);
          }
        }
      } catch (err) {
        console.error('[AuthContext] Restore session failed:', err);
      } finally {
        setIsLoading(false);
      }
    };
    restoreSession();
  }, []);

  // Register Push Token when user is logged in
  useEffect(() => {
    if (user && user.uid) {
      const registerPushToken = async () => {
        try {
          if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
              name: 'default',
              importance: Notifications.AndroidImportance.MAX,
              vibrationPattern: [0, 250, 250, 250],
              lightColor: '#FF231F7C',
            });
          }

          const { status: existingStatus } = await Notifications.getPermissionsAsync();
          let finalStatus = existingStatus;
          if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
          }
          if (finalStatus !== 'granted') {
            return;
          }
          const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
          const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId: projectId && projectId !== 'your-eas-project-id' ? projectId : 'b212f0ad-ab87-4340-a159-867df3c15814'
          });
          const token = tokenData.data;
          
          await fetch(`${API_URL}/api/users/push-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.uid, token })
          });
        } catch (e) {
          console.error('[AuthContext] Push token error:', e);
        }
      };
      registerPushToken();
    }
  }, [user?.uid]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      
      const loggedUser: AuthUser = {
        uid: data.user.id,
        email,
        displayName: data.user.display_name,
        characterType: data.user.character_type,
        color: data.user.color,
        photoURL: null,
        token: data.token,
      };

      await SecureStore.setItemAsync('runwars_jwt', data.token);
      await AsyncStorage.setItem('@runwars:user', JSON.stringify(loggedUser));
      setUser(loggedUser);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string, characterType: string, color: string): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName, characterType, color })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      
      const loggedUser: AuthUser = {
        uid: data.user.id,
        email,
        displayName: data.user.display_name,
        characterType: data.user.character_type,
        color: data.user.color,
        photoURL: null,
        token: data.token,
      };

      await SecureStore.setItemAsync('runwars_jwt', data.token);
      await AsyncStorage.setItem('@runwars:user', JSON.stringify(loggedUser));
      setUser(loggedUser);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await SecureStore.deleteItemAsync('runwars_jwt');
      await AsyncStorage.removeItem('@runwars:user');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setCharacterAndColor = useCallback(async (character: CharacterType, color: string): Promise<void> => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, characterType: character, color };
      AsyncStorage.setItem('@runwars:user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, setCharacterAndColor }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}
