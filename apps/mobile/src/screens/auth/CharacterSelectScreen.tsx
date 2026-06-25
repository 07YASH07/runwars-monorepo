/**
 * CharacterSelectScreen — Pick your runner's character type + territory color.
 *
 * Shown once after registration. Character and color are saved to AuthContext
 * and synced to the backend in Phase 4.
 *
 * Characters: warrior | ninja | mage | scout
 * Color: random from 20-color TERRITORY_COLORS palette (user can re-roll)
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import {
  CHARACTER_EMOJI,
  CHARACTER_DESCRIPTIONS,
  TERRITORY_COLORS,
  getRandomTerritoryColor,
} from '@runwars/shared';
import type { CharacterType } from '@runwars/shared';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '@/navigation/types';

// ─── Character card data ──────────────────────────────────────────────────────

interface CharacterCard {
  type: CharacterType;
  name: string;
  emoji: string;
  description: string;
  accentColor: string;
  bgColor: string;
}

const CHARACTERS: CharacterCard[] = [
  {
    type: 'warrior',
    name: 'Warrior',
    emoji: CHARACTER_EMOJI.warrior,
    description: CHARACTER_DESCRIPTIONS.warrior,
    accentColor: '#FF4D4D',
    bgColor: '#2A0A0A',
  },
  {
    type: 'ninja',
    name: 'Ninja',
    emoji: CHARACTER_EMOJI.ninja,
    description: CHARACTER_DESCRIPTIONS.ninja,
    accentColor: '#8A2BE2',
    bgColor: '#1A0A2A',
  },
  {
    type: 'mage',
    name: 'Mage',
    emoji: CHARACTER_EMOJI.mage,
    description: CHARACTER_DESCRIPTIONS.mage,
    accentColor: '#00BFFF',
    bgColor: '#0A1A2A',
  },
  {
    type: 'scout',
    name: 'Scout',
    emoji: CHARACTER_EMOJI.scout,
    description: CHARACTER_DESCRIPTIONS.scout,
    accentColor: '#32CD32',
    bgColor: '#0A1A0A',
  },
];

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'CharacterSelect'>;
};

export default function CharacterSelectScreen({ navigation: _navigation }: Props) {
  const { setCharacterAndColor } = useAuth();
  const [selected, setSelected] = useState<CharacterType | null>(null);
  const [territoryColor, setTerritoryColor] = useState<string>(
    getRandomTerritoryColor()
  );
  const [loading, setLoading] = useState(false);

  // Scale animations for card press feedback
  const scaleAnims = useRef(
    CHARACTERS.reduce(
      (acc, c) => ({ ...acc, [c.type]: new Animated.Value(1) }),
      {} as Record<CharacterType, Animated.Value>
    )
  ).current;

  const handleCardPress = useCallback(
    (type: CharacterType) => {
      setSelected(type);
      Animated.sequence([
        Animated.timing(scaleAnims[type], {
          toValue: 0.95,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnims[type], {
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [scaleAnims]
  );

  const handleRerollColor = useCallback(() => {
    let newColor: string;
    do {
      newColor = getRandomTerritoryColor();
    } while (newColor === territoryColor);
    setTerritoryColor(newColor);
  }, [territoryColor]);

  const handleConfirm = useCallback(async () => {
    if (!selected) {
      Alert.alert('Pick a character', 'Choose your warrior before entering the arena!');
      return;
    }
    setLoading(true);
    try {
      await setCharacterAndColor(selected, territoryColor);
      // Navigation handled automatically by root navigator watching auth state
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to save character.'
      );
    } finally {
      setLoading(false);
    }
  }, [selected, territoryColor, setCharacterAndColor]);

  const selectedCard = CHARACTERS.find((c) => c.type === selected);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.title}>Choose Your{'\n'}Character</Text>
        <Text style={styles.subtitle}>
          Your identity on the battlefield. Choose wisely.
        </Text>

        {/* Character Cards Grid */}
        <View style={styles.grid}>
          {CHARACTERS.map((char) => {
            const isSelected = selected === char.type;
            return (
              <Animated.View
                key={char.type}
                style={[
                  styles.cardWrapper,
                  { transform: [{ scale: scaleAnims[char.type] }] },
                ]}
              >
                <TouchableOpacity
                  id={`character-card-${char.type}`}
                  style={[
                    styles.card,
                    { backgroundColor: char.bgColor },
                    isSelected && {
                      borderColor: char.accentColor,
                      borderWidth: 2,
                      shadowColor: char.accentColor,
                      shadowOpacity: 0.6,
                      shadowRadius: 16,
                      elevation: 12,
                    },
                  ]}
                  onPress={() => handleCardPress(char.type)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cardEmoji}>{char.emoji}</Text>
                  <Text style={[styles.cardName, { color: char.accentColor }]}>
                    {char.name}
                  </Text>
                  <Text style={styles.cardDescription}>{char.description}</Text>
                  {isSelected && (
                    <View
                      style={[
                        styles.selectedBadge,
                        { backgroundColor: char.accentColor },
                      ]}
                    >
                      <Text style={styles.selectedBadgeText}>✓ SELECTED</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        {/* Territory Color Picker */}
        <View style={styles.colorSection}>
          <Text style={styles.colorTitle}>Your Territory Color</Text>
          <Text style={styles.colorSubtitle}>
            This color marks your claimed zones on the map
          </Text>
          <View style={styles.colorRow}>
            <View
              style={[styles.colorSwatch, { backgroundColor: territoryColor }]}
            />
            <Text style={styles.colorHex}>{territoryColor}</Text>
            <TouchableOpacity
              id="reroll-color-btn"
              style={styles.rerollButton}
              onPress={handleRerollColor}
            >
              <Text style={styles.rerollText}>🎲 Re-roll</Text>
            </TouchableOpacity>
          </View>
          {/* Color palette preview */}
          <View style={styles.paletteRow}>
            {TERRITORY_COLORS.map((color) => (
              <TouchableOpacity
                key={color}
                id={`color-pick-${color.replace('#', '')}`}
                style={[
                  styles.paletteColor,
                  { backgroundColor: color },
                  color === territoryColor && styles.paletteColorSelected,
                ]}
                onPress={() => setTerritoryColor(color)}
              />
            ))}
          </View>
        </View>

        {/* Confirm Button */}
        <TouchableOpacity
          id="character-confirm-btn"
          style={[
            styles.confirmButton,
            selectedCard && { backgroundColor: selectedCard.accentColor, shadowColor: selectedCard.accentColor },
            (!selected || loading) && styles.buttonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!selected || loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#0D0D1A" />
          ) : (
            <Text style={styles.confirmButtonText}>
              {selected
                ? `Enter as ${selectedCard?.name} →`
                : 'Select a Character First'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 38,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
    lineHeight: 44,
  },
  subtitle: {
    fontSize: 14,
    color: '#8888AA',
    marginTop: 10,
    marginBottom: 28,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  cardWrapper: {
    width: '48%',
  },
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: {
    fontSize: 44,
    marginBottom: 10,
  },
  cardName: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  cardDescription: {
    fontSize: 11,
    color: '#8888AA',
    textAlign: 'center',
    lineHeight: 16,
  },
  selectedBadge: {
    marginTop: 10,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  selectedBadgeText: {
    color: '#0D0D1A',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  colorSection: {
    marginTop: 28,
    backgroundColor: '#16162A',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  colorTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  colorSubtitle: {
    fontSize: 12,
    color: '#8888AA',
    marginBottom: 16,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  colorHex: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 1,
    flex: 1,
  },
  rerollButton: {
    backgroundColor: '#2A2A4A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rerollText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  paletteColor: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  paletteColorSelected: {
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.2 }],
  },
  confirmButton: {
    backgroundColor: '#00BFFF',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 28,
    shadowColor: '#00BFFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
  },
  buttonDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
  },
  confirmButtonText: {
    color: '#0D0D1A',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
