/**
 * RunWars Mobile App — Root Entry Point
 * Configured with Cloudflare quick tunnel - profile image fix.
 *
 * Wraps the app in:
 * - AuthProvider (Firebase auth state)
 * - NavigationContainer (React Navigation)
 *
 * Navigation logic:
 * - If not authenticated → AuthStack (Login/Register/CharacterSelect)
 * - If authenticated → MainTabs (Map/Leaderboard/Profile)
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});

import { AuthProvider, useAuth } from '@/context/AuthContext';
import type { RootStackParamList, AuthStackParamList, MainTabParamList } from '@/navigation/types';
import { CHARACTER_EMOJI } from '@runwars/shared';
import type { PostRunParams } from '@/screens/PostRunScreen';

// ─── Auth Screens ─────────────────────────────────────────────────────────────
import LoginScreen from '@/screens/auth/LoginScreen';
import RegisterScreen from '@/screens/auth/RegisterScreen';
import CharacterSelectScreen from '@/screens/auth/CharacterSelectScreen';

// ─── Main Screens ─────────────────────────────────────────────────────────────
import FeedScreen from '@/screens/FeedScreen';
import CommunityScreen from '@/screens/CommunityScreen';
import RunScreen from '@/screens/RunScreen';
import LeaderboardScreen from '@/screens/LeaderboardScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import PostRunScreen from '@/screens/PostRunScreen';

// ─── Extended Root Params (includes modal) ────────────────────────────────────
type ExtendedRootStack = RootStackParamList & { PostRun: PostRunParams };

// ─── Navigators ───────────────────────────────────────────────────────────────
const RootStack = createNativeStackNavigator<ExtendedRootStack>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="CharacterSelect" component={CharacterSelectScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#16162A' : '#FFFFFF',
          borderTopColor: isDark ? '#2A2A4A' : '#E0E0E0',
          borderTopWidth: 1.5,
          height: 84,
          paddingBottom: 22,
          paddingTop: 10,
        },
        tabBarActiveTintColor: isDark ? '#00BFFF' : '#007BFF',
        tabBarInactiveTintColor: isDark ? '#8A8A8A' : '#8A8A8A',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '900',
          letterSpacing: 0.8,
        },
      }}
    >
      <MainTab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          tabBarLabel: 'FEED',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 2, color }}>📋</Text>
          ),
        }}
      />
      <MainTab.Screen
        name="Community"
        component={CommunityScreen}
        options={{
          tabBarLabel: 'COMMUNITY',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 2, color }}>👥</Text>
          ),
        }}
      />
      <MainTab.Screen
        name="Activity"
        component={RunScreen}
        options={{
          tabBarLabel: 'ACTIVITY',
          tabBarIcon: ({ color, size }) => (
            <View style={{
              backgroundColor: '#00BFFF',
              width: size + 20,
              height: size + 20,
              borderRadius: (size + 20) / 2,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 5,
              shadowColor: '#00BFFF',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 8,
              elevation: 5
            }}>
              <Text style={{ fontSize: size, color: '#FFF' }}>
                {user?.characterType
                  ? CHARACTER_EMOJI[user.characterType]
                  : '🏃'}
              </Text>
            </View>
          ),
        }}
      />
      <MainTab.Screen
        name="Progress"
        component={LeaderboardScreen}
        options={{
          tabBarLabel: 'PROGRESS',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 2, color }}>📊</Text>
          ),
        }}
      />
      <MainTab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'PROFILE',
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size - 2, color }}>👤</Text>
          ),
        }}
      />
    </MainTab.Navigator>
  );
}

// ─── Root Router ──────────────────────────────────────────────────────────────

function RootRouter() {
  const { user, loading } = useAuth();

  React.useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  if (loading) {
    return (
      <View style={loadingStyles.container}>
        <Text style={loadingStyles.logo}>🏃</Text>
        <Text style={loadingStyles.title}>RunWars</Text>
        <ActivityIndicator color="#00BFFF" style={{ marginTop: 24 }} />
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
        </>
      ) : (
        <RootStack.Screen name="Auth" component={AuthNavigator} />
      )}
    </RootStack.Navigator>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  console.log('APP COMPONENT IS MOUNTING!');
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer
          theme={{
            dark: true,
            colors: {
              primary: '#00BFFF',
              background: '#0D0D1A',
              card: '#16162A',
              text: '#FFFFFF',
              border: '#2A2A4A',
              notification: '#FF4D4D',
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



const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { fontSize: 80 },
  title: {
    fontSize: 40,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
    marginTop: 8,
  },
});
