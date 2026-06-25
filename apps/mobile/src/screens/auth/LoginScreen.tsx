/**
 * LoginScreen — Email/password sign-in for RunWars.
 * Dark themed, premium design with animated logo.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  StatusBar,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '@/navigation/types';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Configure Google Sign-In
  React.useEffect(() => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
    });
  }, []);

  // Subtle pulse animation on the logo
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter both email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (error) {
      Alert.alert(
        'Login Failed',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setLoading(false);
    }
  }, [email, password, signIn]);

  const handleGoogleSignIn = useCallback(async () => {
    setGoogleLoading(true);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken ?? (userInfo as any).idToken;
      if (!idToken) throw new Error('No ID token from Google');
      await signInWithGoogle(idToken);
    } catch (error: any) {
      if (error.code === 'SIGN_IN_CANCELLED') return; // User cancelled
      Alert.alert(
        'Google Sign-In Failed',
        error instanceof Error ? error.message : 'Could not sign in with Google.'
      );
    } finally {
      setGoogleLoading(false);
    }
  }, [signInWithGoogle]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      {/* Logo / Hero */}
      <View style={styles.heroSection}>
        <Animated.Text
          style={[styles.logoEmoji, { transform: [{ scale: pulseAnim }] }]}
        >
          🏃
        </Animated.Text>
        <Text style={styles.logoTitle}>RunWars</Text>
        <Text style={styles.logoSubtitle}>Claim the streets. Rule the city.</Text>
      </View>

      {/* Form */}
      <View style={styles.formCard}>
        <Text style={styles.formLabel}>Email</Text>
        <TextInput
          id="login-email"
          style={styles.input}
          placeholder="runner@example.com"
          placeholderTextColor="#4A4A6A"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          editable={!loading}
        />

        <Text style={styles.formLabel}>Password</Text>
        <TextInput
          id="login-password"
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#4A4A6A"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
          editable={!loading}
        />

        <TouchableOpacity
          id="login-submit-btn"
          style={[styles.primaryButton, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#0D0D1A" />
          ) : (
            <Text style={styles.primaryButtonText}>Enter the Arena</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          id="login-register-link"
          style={styles.linkButton}
          onPress={() => navigation.navigate('Register')}
          disabled={loading}
        >
          <Text style={styles.linkText}>
            New warrior?{' '}
            <Text style={styles.linkTextAccent}>Create Account →</Text>
          </Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google Sign-In */}
        <TouchableOpacity
          id="login-google-btn"
          style={[styles.googleButton, (loading || googleLoading) && styles.buttonDisabled]}
          onPress={handleGoogleSignIn}
          disabled={loading || googleLoading}
          activeOpacity={0.8}
        >
          {googleLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.googleBtnInner}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoEmoji: {
    fontSize: 72,
    marginBottom: 8,
  },
  logoTitle: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
    textShadowColor: '#00BFFF',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  logoSubtitle: {
    fontSize: 14,
    color: '#8888AA',
    marginTop: 6,
    letterSpacing: 1,
  },
  formCard: {
    backgroundColor: '#16162A',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  formLabel: {
    color: '#8888AA',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#0D0D1A',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 16,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#00BFFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#00BFFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#0D0D1A',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 8,
  },
  linkText: {
    color: '#8888AA',
    fontSize: 14,
  },
  linkTextAccent: {
    color: '#00BFFF',
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A4A',
  },
  dividerText: {
    color: '#4A4A6A',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  googleButton: {
    backgroundColor: '#1E1E38',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  googleBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '900',
    color: '#4285F4',
    backgroundColor: '#FFFFFF',
    width: 26,
    height: 26,
    borderRadius: 13,
    textAlign: 'center',
    lineHeight: 26,
    overflow: 'hidden',
  },
  googleButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
