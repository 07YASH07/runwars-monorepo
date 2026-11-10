import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, RADII, SPACING } from '@/theme/tokens';

interface StatBadgeProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  accentColor?: string;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}

export const StatBadge: React.FC<StatBadgeProps> = ({
  label,
  value,
  unit,
  icon,
  accentColor = COLORS.neonGreen,
  size = 'md',
  style,
}) => {
  const isLarge = size === 'lg';
  const isSmall = size === 'sm';

  return (
    <View style={[styles.container, style]}>
      {icon ? <Text style={[styles.icon, isSmall && styles.iconSm]}>{icon}</Text> : null}
      <View style={styles.content}>
        <View style={styles.valueRow}>
          <Text
            style={[
              styles.valueText,
              isLarge && styles.valueTextLg,
              isSmall && styles.valueTextSm,
              { color: accentColor },
            ]}
            numberOfLines={1}
          >
            {value}
          </Text>
          {unit ? <Text style={styles.unitText}> {unit}</Text> : null}
        </View>
        <Text style={[styles.labelText, isSmall && styles.labelTextSm]}>{label}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: RADII.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
    marginRight: 8,
  },
  iconSm: {
    fontSize: 14,
    marginRight: 4,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  valueText: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  valueTextLg: {
    fontSize: 32,
    fontWeight: '900',
  },
  valueTextSm: {
    fontSize: 15,
    fontWeight: '700',
  },
  unitText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
  labelText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  labelTextSm: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
});
