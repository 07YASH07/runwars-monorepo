import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { THEME } from '../utils/theme';

export default function AuthScreen() {
  const { login, register, isLoading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email || !password || (!isLogin && !displayName)) {
      setError('Please fill in all fields');
      return;
    }
    setError('');
    
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        // Defaulting new users to Scout
        await register(email, password, displayName, 'scout', THEME.classes.scout);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>STRIDECLASH</Text>
          <Text style={styles.subtitle}>{isLogin ? 'Welcome Back, Runner' : 'Join the Battle'}</Text>
        </View>

        <View style={styles.form}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {!isLogin && (
            <View style={styles.inputContainer}>
              <Text style={styles.label}>DISPLAY NAME</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="e.g. SonicRunner"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="runner@example.com"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
            />
          </View>

          <TouchableOpacity 
            style={[styles.button, isLoading && styles.buttonDisabled]} 
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>{isLogin ? 'INITIATE LINK' : 'CREATE ACCOUNT'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.switchButton} 
            onPress={() => { setIsLogin(!isLogin); setError(''); }}
            disabled={isLoading}
          >
            <Text style={styles.switchText}>
              {isLogin ? "DON'T HAVE AN ACCOUNT? RECRUIT NOW" : 'ALREADY A VETERAN? LOG IN'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontFamily: 'BlackOpsOne-Regular',
    fontSize: 48,
    color: THEME.colors.primary,
    textShadowColor: THEME.colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: THEME.colors.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    color: THEME.colors.primary,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 1,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.3)',
    borderRadius: 8,
    padding: 16,
    color: THEME.colors.text,
    fontSize: 16,
  },
  button: {
    backgroundColor: THEME.colors.primary,
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  switchButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  switchText: {
    color: THEME.colors.textSecondary,
    fontSize: 12,
    letterSpacing: 1,
  },
  errorText: {
    color: '#FF4D4D',
    textAlign: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(255, 77, 77, 0.1)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.3)',
  },
});
