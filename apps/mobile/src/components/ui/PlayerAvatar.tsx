import React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, RADII } from '@/theme/tokens';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';

interface PlayerAvatarProps {
  avatarUrl?: string | null;
  selectedAvatar?: string | null;
  characterType?: CharacterType | string;
  color?: string;
  level?: number;
  isOnline?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: ViewStyle;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatarUrl,
  selectedAvatar,
  characterType = 'scout',
  color = COLORS.neonGreen,
  level,
  isOnline,
  size = 'md',
  style,
}) => {
  const getDimensions = () => {
    switch (size) {
      case 'sm':
        return { container: 36, font: 18, border: 2, levelSize: 14 };
      case 'lg':
        return { container: 68, font: 34, border: 3, levelSize: 18 };
      case 'xl':
        return { container: 92, font: 46, border: 4, levelSize: 22 };
      case 'md':
      default:
        return { container: 52, font: 26, border: 2.5, levelSize: 16 };
    }
  };

  const dim = getDimensions();
  const fallbackEmoji = selectedAvatar || (CHARACTER_EMOJI as any)[characterType] || '🏃';

  return (
    <View style={[{ width: dim.container, height: dim.container }, style]}>
      <View
        style={[
          styles.avatarRing,
          {
            width: dim.container,
            height: dim.container,
            borderRadius: dim.container / 2,
            borderColor: color || COLORS.neonGreen,
            borderWidth: dim.border,
          },
        ]}
      >
        {avatarUrl && avatarUrl.startsWith('http') ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{
              width: dim.container - dim.border * 2,
              height: dim.container - dim.border * 2,
              borderRadius: (dim.container - dim.border * 2) / 2,
            }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize: dim.font }}>{fallbackEmoji}</Text>
        )}
      </View>

      {/* Online indicator */}
      {isOnline && (
        <View
          style={[
            styles.onlineBadge,
            {
              backgroundColor: COLORS.neonGreen,
              borderColor: COLORS.bgCanvas,
            },
          ]}
        />
      )}

      {/* Level badge */}
      {typeof level === 'number' && (
        <View
          style={[
            styles.levelBadge,
            {
              backgroundColor: COLORS.bgSurfaceElevated,
              borderColor: color || COLORS.neonGreen,
            },
          ]}
        >
          <Text style={styles.levelText}>{level}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  avatarRing: {
    backgroundColor: '#162238',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  levelBadge: {
    position: 'absolute',
    bottom: -4,
    alignSelf: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
  },
  levelText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
  },
});
