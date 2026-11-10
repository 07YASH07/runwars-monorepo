/**
 * StrideClash Mobile App — Root Entry Point
 *
 * 5-Tab Hierarchy (recovery plan 2026-11-10):
 *   MAP | COMPETE | RUN | COMMUNITY | PROFILE
 *
 *   COMPETE   → nested stack: Battles + Rankings
 *   COMMUNITY → nested stack: Feed + Players (from pre-rebrand CommunityScreen)
 *
 * Wraps the app in:
 * - SafeAreaProvider
 * - AuthProvider (Multi-endpoint fallback + resilient session cache)
 * - NavigationContainer (React Navigation)
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});

import { AuthProvider, useAuth } from '@/context/AuthContext';
import type {
  RootStackParamList,
  AuthStackParamList,
  MainTabParamList,
} from '@/navigation/types';
import { CHARACTER_EMOJI } from '@runwars/shared';
import { COLORS, RADII, SHADOWS } from '@/theme/tokens';

// ─── Screens ──────────────────────────────────────────────────────────────────
import AuthScreen from '@/screens/AuthScreen';
import MapDashboardScreen from '@/screens/MapDashboardScreen';
import RunScreen from '@/screens/RunScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import PostRunScreen from '@/screens/PostRunScreen';
import CompeteHubScreen from '@/screens/CompeteHubScreen';
import CommunityHubScreen from '@/screens/CommunityHubScreen';
import FollowersListScreen from '@/screens/FollowersListScreen';

// ─── Navigators ───────────────────────────────────────────────────────────────
const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      <AuthStack.Screen name="Login" component={AuthScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  const { user } = useAuth();

  return (
    <MainTab.Navigator
      initialRouteName="MAP"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(10, 10, 20, 0.96)',
          borderTopColor: 'rgba(255, 255, 255, 0.1)',
          borderTopWidth: 1.2,
          height: Platform.OS === 'ios' ? 88 : 74,
          paddingBottom: Platform.OS === 'ios' ? 24 : 12,
          paddingTop: 8,
          position: 'absolute',
          elevation: 16,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.6,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: COLORS.neonGreen,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '900',
          letterSpacing: 0.8,
          marginTop: 2,
        },
      }}
    >
      {/* 1. MAP — Tactical Conquest Dashboard */}
      <MainTab.Screen
        name="MAP"
        component={MapDashboardScreen}
        options={{
          tabBarLabel: 'MAP',
          tabBarIcon: ({ focused }) => (
            <View style={focused ? styles.activeTabGlow : undefined}>
              <Text style={{ fontSize: focused ? 22 : 19 }}>🌐</Text>
            </View>
          ),
        }}
      />

      {/* 2. COMPETE — Battles + Rankings */}
      <MainTab.Screen
        name="COMPETE"
        component={CompeteHubScreen}
        options={{
          tabBarLabel: 'COMPETE',
          tabBarIcon: ({ focused }) => (
            <View style={focused ? styles.activeTabGlow : undefined}>
              <Text style={{ fontSize: focused ? 22 : 19 }}>⚔️</Text>
            </View>
          ),
        }}
      />

      {/* 3. RUN — Elevated Center Hero Cockpit */}
      <MainTab.Screen
        name="RUN"
        component={RunScreen}
        options={{
          tabBarLabel: 'RUN',
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.centerRunBtn,
                {
                  backgroundColor: user?.color || COLORS.neonGreen,
                  shadowColor: user?.color || COLORS.neonGreen,
                },
              ]}
            >
              <Text style={styles.centerRunEmoji}>⚡</Text>
            </View>
          ),
        }}
      />

      {/* 4. COMMUNITY — Feed + Players (restored from pre-rebrand nav) */}
      <MainTab.Screen
        name="COMMUNITY"
        component={CommunityHubScreen}
        options={{
          tabBarLabel: 'COMMUNITY',
          tabBarIcon: ({ focused }) => (
            <View style={focused ? styles.activeTabGlow : undefined}>
              <Text style={{ fontSize: focused ? 22 : 19 }}>👥</Text>
            </View>
          ),
        }}
      />

      {/* 5. PROFILE — RPG Character & Shop */}
      <MainTab.Screen
        name="PROFILE"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'PROFILE',
          tabBarIcon: ({ focused }) => (
            <View style={focused ? styles.activeTabGlow : undefined}>
              <Text style={{ fontSize: focused ? 22 : 19 }}>
                {user?.selectedAvatar ||
                  (user?.characterType ? (CHARACTER_EMOJI as any)[user.characterType] : '👤')}
              </Text>
            </View>
          ),
        }}
      />
    </MainTab.Navigator>
  );
}

// ─── Root Router ──────────────────────────────────────────────────────────────

function RootRouter() {
  const { user, isLoading } = useAuth();

  React.useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingLogo}>⚡</Text>
        <Text style={styles.loadingTitle}>STRIDECLASH</Text>
        <Text style={styles.loadingSub}>INITIALIZING TACTICAL SATELLITE...</Text>
        <ActivityIndicator color={COLORS.neonGreen} style={{ marginTop: 24 }} size="large" />
      </View>
    );
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <RootStack.Screen name="Main" component={MainNavigator} />
          <RootStack.Screen
            name="PostRun"
            component={PostRunScreen}
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <RootStack.Screen
            name="FollowersList"
            component={FollowersListScreen}
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </>
      ) : (
        <RootStack.Screen name="Auth" component={AuthNavigator} />
      )}
    </RootStack.Navigator>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer
          theme={{
            dark: true,
            colors: {
              primary: COLORS.neonGreen,
              background: COLORS.bgCanvas,
              card: COLORS.bgSurface,
              text: COLORS.textPrimary,
              border: COLORS.borderSubtle,
              notification: COLORS.crimson,
            },
            fonts: {
              regular: { fontFamily: 'System', fontWeight: '400' },
              medium: { fontFamily: 'System', fontWeight: '600' },
              bold: { fontFamily: 'System', fontWeight: '700' },
              heavy: { fontFamily: 'System', fontWeight: '900' },
            },
          }}
        >
          <StatusBar style="light" />
          <RootRouter />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centerRunBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Platform.OS === 'ios' ? 14 : 18,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 8,
  },
  centerRunEmoji: {
    fontSize: 26,
    color: '#080811',
  },
  activeTabGlow: {
    transform: [{ scale: 1.15 }],
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingLogo: {
    fontSize: 64,
    marginBottom: 8,
  },
  loadingTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  loadingSub: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.neonGreen,
    letterSpacing: 1.5,
    marginTop: 6,
  },
});
