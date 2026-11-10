import React, { useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  Animated,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, RADII, SHADOWS, SPACING } from '@/theme/tokens';

export type GameButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
export type GameButtonSize = 'sm' | 'md' | 'lg';

interface GameButtonProps {
  title: string;
  onPress: () => void;
  variant?: GameButtonVariant;
  size?: GameButtonSize;
  icon?: string | React.ReactNode;
  isLoading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  hapticFeedback?: boolean;
  testID?: string;
}

export const GameButton: React.FC<GameButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  isLoading = false,
  disabled = false,
  style,
  textStyle,
  hapticFeedback = true,
  testID,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 40,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
    }).start();
  };

  const handlePress = () => {
    if (disabled || isLoading) return;
    if (hapticFeedback) {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch (e) {}
    }
    onPress();
  };

  const getVariantStyles = (): { btn: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'secondary':
        return {
          btn: {
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            borderWidth: 1.5,
            borderColor: COLORS.electricBlue,
            ...SHADOWS.blueGlow,
          },
          text: { color: '#FFFFFF' },
        };
      case 'danger':
        return {
          btn: {
            backgroundColor: COLORS.crimson,
            borderWidth: 1,
            borderColor: '#FF6B8B',
            ...SHADOWS.crimsonGlow,
          },
          text: { color: '#FFFFFF' },
        };
      case 'warning':
        return {
          btn: {
            backgroundColor: COLORS.warningAmber,
            borderWidth: 1,
            borderColor: '#FFE082',
            shadowColor: COLORS.warningAmber,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.45,
            shadowRadius: 8,
            elevation: 6,
          },
          text: { color: '#0B1220' },
        };
      case 'ghost':
        return {
          btn: {
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
          },
          text: { color: COLORS.textSecondary },
        };
      case 'primary':
      default:
        return {
          btn: {
            backgroundColor: COLORS.neonGreen,
            borderWidth: 1,
            borderColor: '#80FFA8',
            ...SHADOWS.neonGlow,
          },
          text: { color: '#0B1220' },
        };
    }
  };

  const getSizeStyles = (): { btn: ViewStyle; text: TextStyle } => {
    switch (size) {
      case 'sm':
        return {
          btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RADII.sm },
          text: { fontSize: 12, letterSpacing: 0.6 },
        };
      case 'lg':
        return {
          btn: { paddingVertical: 18, paddingHorizontal: 24, borderRadius: RADII.lg },
          text: { fontSize: 16, letterSpacing: 1.2 },
        };
      case 'md':
      default:
        return {
          btn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: RADII.md },
          text: { fontSize: 14, letterSpacing: 0.8 },
        };
    }
  };

  const vStyles = getVariantStyles();
  const sStyles = getSizeStyles();

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <TouchableOpacity
        testID={testID}
        activeOpacity={0.88}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        disabled={disabled || isLoading}
        style={[
          styles.baseButton,
          vStyles.btn,
          sStyles.btn,
          disabled && styles.disabledButton,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator
            color={variant === 'primary' || variant === 'warning' ? '#0B1220' : '#FFFFFF'}
            size="small"
          />
        ) : (
          <View style={styles.contentRow}>
            {typeof icon === 'string' ? (
              <Text style={[styles.iconText, sStyles.text]}>{icon}</Text>
            ) : (
              icon
            )}
            <Text
              style={[
                styles.baseText,
                vStyles.text,
                sStyles.text,
                disabled && styles.disabledText,
                textStyle,
              ]}
            >
              {title}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  baseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  baseText: {
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  iconText: {
    marginRight: 8,
  },
  disabledButton: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledText: {
    opacity: 0.8,
  },
});
