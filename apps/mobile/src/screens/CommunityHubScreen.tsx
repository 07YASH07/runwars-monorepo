/**
 * CommunityHubScreen — segmented container for COMMUNITY tab.
 *
 * Exposes two sections: Feed + Players. Reuses the existing (previously
 * orphaned) FeedScreen and CommunityScreen with zero code changes to
 * either. Switch is local state; no new deps.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FeedScreen from '@/screens/FeedScreen';
import CommunityScreen from '@/screens/CommunityScreen';
import { COLORS, RADII, SPACING } from '@/theme/tokens';

type Section = 'feed' | 'players';

export default function CommunityHubScreen() {
  const [section, setSection] = useState<Section>('feed');

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A14" />
      <View style={styles.pillRow}>
        <TouchableOpacity
          testID="community-tab-feed"
          onPress={() => setSection('feed')}
          style={[styles.pill, section === 'feed' && styles.pillActive]}
          activeOpacity={0.85}
        >
          <Text style={[styles.pillText, section === 'feed' && styles.pillTextActive]}>📡  FEED</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="community-tab-players"
          onPress={() => setSection('players')}
          style={[styles.pill, section === 'players' && styles.pillActive]}
          activeOpacity={0.85}
        >
          <Text style={[styles.pillText, section === 'players' && styles.pillTextActive]}>👥  PLAYERS</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        {section === 'feed' ? <FeedScreen /> : <CommunityScreen />}
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
