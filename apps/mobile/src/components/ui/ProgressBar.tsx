import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ViewStyle } from 'react-native';
import { COLORS, RADII, SPACING } from '@/theme/tokens';

interface ProgressBarProps {
  progress: number; // 0 to 1
  label?: string;
  valueText?: string;
  height?: number;
  color?: string;
  glow?: boolean;
  style?: ViewStyle;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  label,
  valueText,
  height = 8,
  color = COLORS.neonGreen,
  glow = true,
  style,
}) => {
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const animWidth = useRef(new Animated.Value(clampedProgress)).current;

  useEffect(() => {
    Animated.timing(animWidth, {
      toValue: clampedProgress,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [clampedProgress, animWidth]);

  const widthInterpolated = animWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.container, style]}>
      {(label || valueText) && (
        <View style={styles.headerRow}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          {valueText ? <Text style={styles.valueText}>{valueText}</Text> : null}
        </View>
      )}

      <View style={[styles.track, { height, borderRadius: height / 2 }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              width: widthInterpolated,
              backgroundColor: color,
              borderRadius: height / 2,
              shadowColor: glow ? color : 'transparent',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: glow ? 0.7 : 0,
              shadowRadius: 6,
              elevation: glow ? 4 : 0,
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  valueText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  track: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
