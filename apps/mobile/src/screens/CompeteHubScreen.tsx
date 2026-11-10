/**
 * CompeteHubScreen — segmented container for COMPETE tab.
 *
 * Exposes two sections: Battles + Rankings. No new dependencies, no
 * dedicated top-tab library; uses a StateSegment pill above the content.
 * Both inner screens (BattlesScreen, LeaderboardScreen) remain unchanged.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BattlesScreen from '@/screens/BattlesScreen';
import LeaderboardScreen from '@/screens/LeaderboardScreen';
import { COLORS, RADII, SPACING } from '@/theme/tokens';

type Section = 'battles' | 'rankings';

export default function CompeteHubScreen() {
  const [section, setSection] = useState<Section>('battles');

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A14" />
      <View style={styles.pillRow}>
        <TouchableOpacity
          testID="compete-tab-battles"
          onPress={() => setSection('battles')}
          style={[styles.pill, section === 'battles' && styles.pillActive]}
          activeOpacity={0.85}
        >
          <Text style={[styles.pillText, section === 'battles' && styles.pillTextActive]}>⚔️  BATTLES</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="compete-tab-rankings"
          onPress={() => setSection('rankings')}
          style={[styles.pill, section === 'rankings' && styles.pillActive]}
          activeOpacity={0.85}
        >
          <Text style={[styles.pillText, section === 'rankings' && styles.pillTextActive]}>🏆  RANKINGS</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        {section === 'battles' ? <BattlesScreen /> : <LeaderboardScreen />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgCanvas },
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 10,
    backgroundColor: 'rgba(10,10,20,0.96)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    elevation: 12,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADII.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(16,16,32,0.9)',
  },
  pillActive: {
    backgroundColor: 'rgba(0,255,136,0.18)',
    borderColor: COLORS.neonGreen,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: COLORS.textMuted,
  },
  pillTextActive: { color: COLORS.neonGreen },
  body: { flex: 1 },
});
