import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { COLORS, RADII, SHADOWS, SPACING } from '@/theme/tokens';

interface DisputeBannerProps {
  rivalName: string;
  rivalColor?: string;
  areaSqm?: number;
  onPressAction?: () => void;
  actionTitle?: string;
  style?: ViewStyle;
}

export const DisputeBanner: React.FC<DisputeBannerProps> = ({
  rivalName,
  rivalColor = COLORS.crimson,
  areaSqm,
  onPressAction,
  actionTitle = 'DEFEND',
  style,
}) => {
  return (
    <View style={[styles.container, { borderColor: rivalColor }, style]}>
      <View style={styles.leftCol}>
        <View style={styles.badgeRow}>
          <Text style={styles.alertIcon}>⚠️</Text>
          <Text style={styles.badgeText}>ZONE CONTESTED</Text>
        </View>
        <Text style={styles.titleText}>
          <Text style={{ color: rivalColor, fontWeight: '900' }}>{rivalName.toUpperCase()}</Text> is invading!
        </Text>
        {typeof areaSqm === 'number' && (
          <Text style={styles.subText}>Contested turf: {Math.round(areaSqm).toLocaleString()} m²</Text>
        )}
      </View>

      {onPressAction && (
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: rivalColor }]}
          onPress={onPressAction}
          activeOpacity={0.85}
        >
          <Text style={styles.actionBtnText}>{actionTitle}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(25, 12, 24, 0.92)',
    borderWidth: 1.5,
    borderRadius: RADII.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...SHADOWS.crimsonGlow,
  },
  leftCol: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.crimson,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
