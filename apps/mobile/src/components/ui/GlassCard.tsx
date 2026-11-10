import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, RADII, SHADOWS, SPACING } from '@/theme/tokens';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[] | any;
  variant?: 'default' | 'elevated' | 'neonBorder' | 'blueBorder' | 'crimsonBorder';
  glow?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  style,
  variant = 'default',
  glow = false,
}) => {
  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: COLORS.bgSurfaceElevated,
          borderColor: COLORS.borderMedium,
          ...SHADOWS.surface,
        };
      case 'neonBorder':
        return {
          backgroundColor: COLORS.bgGlassCard,
          borderColor: COLORS.neonGreen,
          borderWidth: 1.5,
          ...(glow ? SHADOWS.neonGlow : {}),
        };
      case 'blueBorder':
        return {
          backgroundColor: COLORS.bgGlassCard,
          borderColor: COLORS.electricBlue,
          borderWidth: 1.5,
          ...(glow ? SHADOWS.blueGlow : {}),
        };
      case 'crimsonBorder':
        return {
          backgroundColor: COLORS.bgGlassCard,
          borderColor: COLORS.crimson,
          borderWidth: 1.5,
          ...(glow ? SHADOWS.crimsonGlow : {}),
        };
      case 'default':
      default:
        return {
          backgroundColor: COLORS.bgGlassCard,
          borderColor: COLORS.borderSubtle,
          borderWidth: 1,
          ...SHADOWS.surface,
        };
    }
  };

  return (
    <View style={[styles.card, getVariantStyle(), style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.md,
    padding: SPACING.md,
    overflow: 'hidden',
  },
});
