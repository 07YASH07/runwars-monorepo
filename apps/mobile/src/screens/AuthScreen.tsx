/**
 * AuthScreen — Cyberpunk Esports Login & Onboarding for StrideClash.
 *
 * Features:
 * - High-contrast futuristic theme with neon green & electric blue accents
 * - Quick toggle between INITIATE LINK (Login) and CREATE ACCOUNT (Register)
 * - Class Archetype Selector during registration (Scout ⚡ / Warrior ⚔️ / Titan 🛡️ / Ghost 👻)
 * - Safe area & keyboard-avoiding handling
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  COLORS,
  CLASS_THEMES,
  SPACING,
  RADII,
  SHADOWS,
} from '@/theme/tokens';
import { GameButton, GlassCard } from '@/components/ui';
import { CharacterType } from '@runwars/shared';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

// Google sign-in is only offered when a web client ID is configured for this build.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
if (GOOGLE_WEB_CLIENT_ID) {
  try { GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID }); } catch {}
}

export default function AuthScreen() {
  const { login, register, signInWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedClass, setSelectedClass] = useState<CharacterType>('scout');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (submitting) return;
    const cleanEmail = email.trim();
    if (!cleanEmail || !password || (!isLogin && !displayName.trim())) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!isLogin && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(cleanEmail, password);
      } else {
        const theme = CLASS_THEMES[selectedClass as keyof typeof CLASS_THEMES];
        const classColor = theme ? theme.color : COLORS.neonGreen;
        await register(cleanEmail, password, displayName.trim(), selectedClass, classColor);
      }
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (googleBusy) return;
    setError('');
    setGoogleBusy(true);
    try {
      await GoogleSignin.hasPlayServices();
      const result: any = await GoogleSignin.signIn();
      const idToken = result?.data?.idToken ?? result?.idToken;
      if (!idToken) {
        if (result?.type === 'cancelled') return;
        throw new Error('Google did not return a sign-in token.');
      }
      await signInWithGoogle(idToken);
    } catch (err: any) {
      if (err?.code === statusCodes.SIGN_IN_CANCELLED) return;
      setError(err?.message || 'Google sign-in failed.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const selectedClassMeta = CLASS_THEMES[selectedClass as keyof typeof CLASS_THEMES];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Branding Header */}
        <View style={styles.header}>
          <Text style={styles.logoIcon}>⚡</Text>
          <Text style={styles.title}>STRIDECLASH</Text>
          <Text style={styles.subtitle}>
            {isLogin ? 'Welcome back, runner' : 'Join the territory race'}
          </Text>
        </View>

        <GlassCard style={styles.card} variant="neonBorder" glow>
          {/* Mode Switcher */}
          <View style={styles.modeTabs}>
            <TouchableOpacity
              style={[styles.modeTab, isLogin && styles.modeTabActive]}
              onPress={() => {
                setIsLogin(true);
                setError('');
              }}
            >
              <Text style={[styles.modeTabText, isLogin && styles.modeTabTextActive]}>
                LOGIN
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeTab, !isLogin && styles.modeTabActive]}
              onPress={() => {
                setIsLogin(false);
                setError('');
              }}
            >
              <Text style={[styles.modeTabText, !isLogin && styles.modeTabTextActive]}>
                REGISTER
              </Text>
            </TouchableOpacity>
          </View>

          {/* Error Callout */}
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          ) : null}

          {/* Form Fields */}
          {!isLogin && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>CALLSIGN / RUNNER NAME</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="e.g. ApexRunner"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="runner@strideclash.com"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>ACCESS KEY / PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
            />
          </View>

          {/* Class Archetype Selection (Only during registration) */}
          {!isLogin && (
            <View style={styles.classSection}>
              <Text style={styles.inputLabel}>CHOOSE YOUR CLASS ARCHETYPE</Text>
              <View style={styles.classPickerRow}>
                {(['scout', 'warrior', 'titan', 'ghost'] as CharacterType[]).map((cKey) => {
                  const meta = CLASS_THEMES[cKey as keyof typeof CLASS_THEMES];
                  const isCur = selectedClass === cKey;

                  return (
                    <TouchableOpacity
                      key={cKey}
                      style={[
                        styles.classChip,
                        isCur && { borderColor: meta.color, borderWidth: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.08)' },
                      ]}
                      onPress={() => setSelectedClass(cKey)}
                    >
                      <Text style={styles.classChipEmoji}>{meta.emoji}</Text>
                      <Text style={[styles.classChipName, isCur && { color: meta.color, fontWeight: '900' }]}>
                        {meta.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Selected Class Perk Description */}
              <View style={[styles.perkBox, { borderColor: selectedClassMeta.color }]}>
                <Text style={[styles.perkTitle, { color: selectedClassMeta.color }]}>
                  {selectedClassMeta.name.toUpperCase()} PERK: {selectedClassMeta.bonus}
                </Text>
                <Text style={styles.perkDesc}>{selectedClassMeta.description}</Text>
              </View>
            </View>
          )}

          {/* Submit Action */}
          <GameButton
            title={isLogin ? 'Log in' : 'Create account'}
            onPress={handleSubmit}
            variant="primary"
            size="lg"
            isLoading={submitting}
            disabled={googleBusy}
            style={{ marginTop: 18 }}
            testID="auth-submit-btn"
          />

          {!!GOOGLE_WEB_CLIENT_ID && (
            <TouchableOpacity
              style={styles.googleBtn}
              onPress={handleGoogle}
              disabled={googleBusy || submitting}
              testID="auth-google-btn"
            >
              {googleBusy ? <ActivityIndicator color={COLORS.textPrimary} /> : <Text style={styles.googleText}>Continue with Google</Text>}
            </TouchableOpacity>
          )}
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: 48,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoIcon: {
    fontSize: 40,
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.neonGreen,
    letterSpacing: 1.5,
    marginTop: 4,
  },
  card: {
    padding: SPACING.lg,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: RADII.pill,
    padding: 3,
    marginBottom: SPACING.lg,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: RADII.pill,
  },
  modeTabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.borderMedium,
  },
  modeTabText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  modeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.crimson,
    borderRadius: RADII.sm,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: COLORS.crimson,
    fontSize: 12,
    fontWeight: '700',
  },
  inputContainer: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: RADII.sm,
    color: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  classSection: {
    marginTop: 6,
    marginBottom: 10,
  },
  classPickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  classChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  classChipEmoji: {
    fontSize: 18,
    marginBottom: 2,
  },
  classChipName: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
  },
  perkBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1,
    borderRadius: RADII.sm,
  },
  perkTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  googleBtn: {
    marginTop: 12,
    height: 52,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.borderMedium,
    backgroundColor: COLORS.bgSurfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleText: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  perkDesc: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});
