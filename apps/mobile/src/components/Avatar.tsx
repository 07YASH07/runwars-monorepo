/**
 * Avatar Component - StrideClash
 * 
 * Renders a user's avatar with priority:
 * 1. Custom photo (avatar_url from profile)
 * 2. Selected emoji avatar (from avatar shop)
 * 3. Class-based emoji (character_type)
 * 4. Default runner emoji 🏃
 */
import React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';

interface AvatarProps {
  avatarUrl?: string | null;
  selectedAvatar?: string | null;
  characterType?: string | null;
  color?: string;
  size?: number;
  style?: ViewStyle;
}

export default function Avatar({
  avatarUrl,
  selectedAvatar,
  characterType,
  color = '#00BFFF',
  size = 44,
  style,
}: AvatarProps) {
  const borderRadius = size / 2;
  const fontSize = size * 0.5;

  const borderColor = color;

  const containerStyle = [
    styles.container,
    {
      width: size,
      height: size,
      borderRadius,
      borderColor,
    },
    style,
  ];

  // Priority 1: custom photo
  if (avatarUrl) {
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size - 4, height: size - 4, borderRadius: borderRadius - 2 }}
          resizeMode="cover"
        />
      </View>
    );
  }

  // Priority 2: selected emoji avatar
  const emoji =
    selectedAvatar ||
    (characterType ? CHARACTER_EMOJI[characterType as CharacterType] : null) ||
    '🏃';

  return (
    <View style={[containerStyle, { backgroundColor: color + '18' }]}>
      <Text style={{ fontSize }}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D0D1A',
    overflow: 'hidden',
  },
});
