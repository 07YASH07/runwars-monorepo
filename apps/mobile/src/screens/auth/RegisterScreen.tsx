/**
 * RegisterScreen — New account creation for RunWars.
 * Collects display name, email, and password.
 * On success, navigates to CharacterSelectScreen.
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
  ScrollView,
  StatusBar,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '@/navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Register'>;
};

export default function RegisterScreen({ navigation }: Props) {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = useCallback(async () => {
    if (!displayName.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, displayName.trim());
      // Navigate to character select — pass the firebase user uid via route
      navigation.navigate('CharacterSelect');
    } catch (error) {
      Alert.alert(
        'Registration Failed',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setLoading(false);
    }
  }, [displayName, email, password, confirmPassword, signUp, navigation]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            id="register-back-btn"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Join the War</Text>
          <Text style={styles.subtitle}>Create your runner identity</Text>
        </View>

        {/* Form */}
        <View style={styles.formCard}>
          <Text style={styles.formLabel}>Runner Name</Text>
          <TextInput
            id="register-name"
            style={styles.input}
            placeholder="e.g. ShadowRunner42"
            placeholderTextColor="#4A4A6A"
            autoCapitalize="words"
            value={displayName}
            onChangeText={setDisplayName}
            returnKeyType="next"
            editable={!loading}
            maxLength={30}
          />

          <Text style={styles.formLabel}>Email</Text>
          <TextInput
            id="register-email"
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
            id="register-password"
            style={styles.input}
            placeholder="Min. 6 characters"
            placeholderTextColor="#4A4A6A"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            returnKeyType="next"
            editable={!loading}
          />

          <Text style={styles.formLabel}>Confirm Password</Text>
          <TextInput
            id="register-confirm-password"
            style={[
              styles.input,
              confirmPassword.length > 0 &&
                confirmPassword !== password &&
                styles.inputError,
            ]}
            placeholder="Repeat password"
            placeholderTextColor="#4A4A6A"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            returnKeyType="done"
            onSubmitEditing={handleRegister}
            editable={!loading}
          />
          {confirmPassword.length > 0 && confirmPassword !== password && (
            <Text style={styles.errorHint}>Passwords do not match</Text>
          )}

          <TouchableOpacity
            id="register-submit-btn"
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#0D0D1A" />
            ) : (
              <Text style={styles.primaryButtonText}>Choose Your Character →</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            id="register-login-link"
            style={styles.linkButton}
            onPress={() => navigation.navigate('Login')}
            disabled={loading}
          >
            <Text style={styles.linkText}>
              Already have an account?{' '}
              <Text style={styles.linkTextAccent}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 60,
  },
  header: {
    marginBottom: 32,
  },
  backButton: {
    marginBottom: 24,
  },
  backButtonText: {
    color: '#00BFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#8888AA',
    marginTop: 6,
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
  inputError: {
    borderColor: '#FF4D4D',
  },
  errorHint: {
    color: '#FF4D4D',
    fontSize: 12,
    marginTop: -12,
    marginBottom: 16,
    marginLeft: 4,
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
});
