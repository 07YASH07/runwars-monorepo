/**
 * BattlesScreen — Territory Conquest & PvP Battle Center for StrideClash.
 *
 * Dedicated esports interface for inspecting contested sectors, rival turfs,
 * defense status, and tactical territory challenges.
 *
 * Real data sources:
 * - Real territory records from `useMultiplayer().territories`
 * - Live rival players from `useMultiplayer().livePlayers`
 * - Active invasion warnings from Socket.IO events (`territory:stolen`, `pvp:warning`)
 * - Territory boost API (`/api/territory/boost`)
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useAuth } from '@/context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { CHARACTER_EMOJI } from '@runwars/shared';
import {
  COLORS,
  CLASS_THEMES,
  SPACING,
  RADII,
  SHADOWS,
} from '@/theme/tokens';
import {
  GameButton,
  GlassCard,
  StatBadge,
  ProgressBar,
  DisputeBanner,
} from '@/components/ui';
import { apiFetch } from '@/config/api';

type BattleTab = 'contested' | 'mySectors' | 'history';

interface BattleEvent {
  id: string;
  type: 'defense' | 'stolen' | 'challenge';
  playerName: string;
  playerColor: string;
  areaSqm: number;
  timestamp: string;
}

export default function BattlesScreen() {
  const { user } = useAuth();
  const { territories, livePlayers, socketService } = useMultiplayer();
  const navigation = useNavigation<any>();

  const [activeTab, setActiveTab] = useState<BattleTab>('contested');
  const [refreshing, setRefreshing] = useState(false);
  const [battleHistory, setBattleHistory] = useState<BattleEvent[]>([]);
  const [activeInvasions, setActiveInvasions] = useState<BattleEvent[]>([]);

  // Listen for real battle events
  useEffect(() => {
    const onStolen = (data: { byPlayerName: string; byPlayerColor: string; area?: number }) => {
      const evt: BattleEvent = {
        id: 'stolen_' + Date.now(),
        type: 'stolen',
        playerName: data.byPlayerName || 'Rival Runner',
        playerColor: data.byPlayerColor || COLORS.crimson,
        areaSqm: data.area || 1200,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setActiveInvasions((prev) => [evt, ...prev]);
      setBattleHistory((prev) => [evt, ...prev]);
    };

    socketService.socket?.on('territory:stolen', onStolen);
    return () => {
      socketService.socket?.off('territory:stolen', onStolen);
    };
  }, [socketService]);

  // Split territories into My Sectors vs Rival Sectors
  const myTerritories = useMemo(() => {
    return territories.filter((t) => t.userId === user?.uid);
  }, [territories, user?.uid]);

  const rivalTerritories = useMemo(() => {
    return territories.filter((t) => t.userId !== user?.uid);
  }, [territories, user?.uid]);

  const totalMyArea = useMemo(() => {
    return myTerritories.reduce((acc, t) => acc + (t.areaSquareMeters || 0), 0);
  }, [myTerritories]);

  const totalRivalArea = useMemo(() => {
    return rivalTerritories.reduce((acc, t) => acc + (t.areaSquareMeters || 0), 0);
  }, [rivalTerritories]);

  const handleChallenge = (territory: any) => {
    Alert.alert(
      'CHALLENGE SECTOR',
      `Target Sector: ${Math.round(territory.areaSquareMeters || 500).toLocaleString()} m²\nOwner: ${territory.ownerName || 'Rival'}\n\nStart a run now to overtake this territory?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'START RUN 🏃',
          style: 'default',
          onPress: () => {
            navigation.navigate('RUN');
          },
        },
      ]
    );
  };

  const handleActivateBoost = async () => {
    try {
      const res = await apiFetch('/api/territory/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.uid }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('⚡ 2X ARENA BOOST ACTIVE', `Capture speed doubled! Remaining Arena Coins: ${data.remainingCoins}`);
      } else {
        Alert.alert('Boost Failed', data.error || 'Insufficient Arena Coins.');
      }
    } catch (e) {
      Alert.alert('Network Error', 'Could not activate boost.');
    }
  };

  const renderRivalItem = ({ item }: { item: any }) => {
    const area = Math.round(item.areaSquareMeters || 0);
    const dateStr = item.claimedAt ? new Date(item.claimedAt).toLocaleDateString() : 'Active';
    const ownerSpeed = item.avgSpeedKmh ? `${item.avgSpeedKmh.toFixed(1)} km/h` : '10.5 km/h';

    return (
      <GlassCard style={styles.battleCard} variant="crimsonBorder" glow={false}>
        <View style={styles.cardHeader}>
          <View style={styles.ownerRow}>
            <View style={[styles.avatarDot, { backgroundColor: item.color || COLORS.crimson }]} />
            <View>
              <Text style={styles.ownerName}>{item.ownerName || 'Rival Runner'}</Text>
              <Text style={styles.ownerStatus}>DEFENDING CHAMPION</Text>
            </View>
          </View>

          <View style={styles.areaBadge}>
            <Text style={styles.areaBadgeText}>{area.toLocaleString()} M²</Text>
          </View>
        </View>

        <View style={styles.cardMetricsRow}>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{ownerSpeed}</Text>
            <Text style={styles.metricLbl}>DEFENSE SPEED</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{item.activityType ? item.activityType.toUpperCase() : 'RUN'}</Text>
            <Text style={styles.metricLbl}>CLASS</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{dateStr}</Text>
            <Text style={styles.metricLbl}>CLAIMED</Text>
          </View>
        </View>

        <View style={styles.cardActionRow}>
          <GameButton
            title="CHALLENGE SECTOR ⚔️"
            onPress={() => handleChallenge(item)}
            variant="secondary"
            size="sm"
            style={styles.challengeBtn}
          />
        </View>
      </GlassCard>
    );
  };

  const renderMySectorItem = ({ item }: { item: any }) => {
    const area = Math.round(item.areaSquareMeters || 0);
    const dateStr = item.claimedAt ? new Date(item.claimedAt).toLocaleDateString() : 'Active';

    return (
      <GlassCard style={styles.battleCard} variant="neonBorder" glow={false}>
        <View style={styles.cardHeader}>
          <View style={styles.ownerRow}>
            <View style={[styles.avatarDot, { backgroundColor: user?.color || COLORS.neonGreen }]} />
            <View>
              <Text style={styles.ownerName}>{user?.displayName || 'My Zone'}</Text>
              <Text style={[styles.ownerStatus, { color: COLORS.neonGreen }]}>FORTIFIED SECTOR</Text>
            </View>
          </View>

          <View style={[styles.areaBadge, { backgroundColor: 'rgba(0, 255, 136, 0.15)', borderColor: COLORS.neonGreen }]}>
            <Text style={[styles.areaBadgeText, { color: COLORS.neonGreen }]}>{area.toLocaleString()} M²</Text>
          </View>
        </View>

        <View style={styles.cardMetricsRow}>
          <View style={styles.metricCol}>
            <Text style={[styles.metricVal, { color: COLORS.neonGreen }]}>SECURE</Text>
            <Text style={styles.metricLbl}>STATUS</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{item.activityType ? item.activityType.toUpperCase() : 'RUN'}</Text>
            <Text style={styles.metricLbl}>ACTIVITY</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{dateStr}</Text>
            <Text style={styles.metricLbl}>DATE CONQUERED</Text>
          </View>
        </View>
      </GlassCard>
    );
  };

  const renderHistoryItem = ({ item }: { item: BattleEvent }) => {
    return (
      <GlassCard style={styles.historyCard}>
        <View style={styles.historyRow}>
          <Text style={styles.historyIcon}>
            {item.type === 'stolen' ? '⚔️' : item.type === 'defense' ? '🛡️' : '⚡'}
          </Text>
          <View style={styles.historyDetails}>
            <Text style={styles.historyTitle}>
              {item.type === 'stolen' ? 'SECTOR INVASION DETECTED' : 'ZONE SECURED'}
            </Text>
            <Text style={styles.historyDesc}>
              {item.playerName} contested {item.areaSqm} m² of turf
            </Text>
          </View>
          <Text style={styles.historyTime}>{item.timestamp}</Text>
        </View>
      </GlassCard>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Screen Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>BATTLE ARENA</Text>
          <Text style={styles.subtitle}>TERRITORY DISPUTES & DEFENSE</Text>
        </View>

        <TouchableOpacity style={styles.boostChip} onPress={handleActivateBoost} activeOpacity={0.8}>
          <Text style={styles.boostChipIcon}>⚡</Text>
          <Text style={styles.boostChipText}>2X BOOST</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tactical Turf Breakdown Panel ── */}
      <View style={styles.summaryGrid}>
        <StatBadge
          label="CONTESTABLE TURF"
          value={rivalTerritories.length}
          icon="⚔️"
          accentColor={COLORS.crimson}
          style={styles.summaryBadge}
        />
        <StatBadge
          label="DEFENDED ZONES"
          value={myTerritories.length}
          icon="🛡️"
          accentColor={COLORS.neonGreen}
          style={styles.summaryBadge}
        />
        <StatBadge
          label="TOTAL TURF (M²)"
          value={Math.round(totalMyArea).toLocaleString()}
          icon="🌐"
          accentColor={COLORS.electricBlue}
          style={styles.summaryBadge}
        />
      </View>

      {/* ── Active Invasions Callout (if any) ── */}
      {activeInvasions.length > 0 && (
        <View style={styles.invasionArea}>
          <DisputeBanner
            rivalName={activeInvasions[0].playerName}
            rivalColor={activeInvasions[0].playerColor}
            areaSqm={activeInvasions[0].areaSqm}
            onPressAction={() => navigation.navigate('RUN')}
            actionTitle="RETAKE"
          />
        </View>
      )}

      {/* ── Segmented Tab Switcher ── */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'contested' && styles.tabBtnActive]}
          onPress={() => setActiveTab('contested')}
        >
          <Text style={[styles.tabText, activeTab === 'contested' && styles.tabTextActive]}>
            RIVAL TURF ({rivalTerritories.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'mySectors' && styles.tabBtnActive]}
          onPress={() => setActiveTab('mySectors')}
        >
          <Text style={[styles.tabText, activeTab === 'mySectors' && styles.tabTextActive]}>
            MY ZONES ({myTerritories.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            LOGS ({battleHistory.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── List Area ── */}
      {activeTab === 'contested' && (
        <FlatList
          data={rivalTerritories}
          keyExtractor={(item) => item.id}
          renderItem={renderRivalItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🛡️</Text>
              <Text style={styles.emptyTitle}>NO RIVAL TURF NEARBY</Text>
              <Text style={styles.emptyDesc}>
                All local sectors are open for conquest! Start a run to claim the first zone.
              </Text>
              <GameButton
                title="START RUNNING"
                onPress={() => navigation.navigate('RUN')}
                variant="primary"
                size="md"
                style={{ marginTop: 16 }}
              />
            </View>
          }
        />
      )}

      {activeTab === 'mySectors' && (
        <FlatList
          data={myTerritories}
          keyExtractor={(item) => item.id}
          renderItem={renderMySectorItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🚩</Text>
              <Text style={styles.emptyTitle}>NO CLAIMED ZONES YET</Text>
              <Text style={styles.emptyDesc}>
                Complete a run session to carve out your first territory on the world map.
              </Text>
              <GameButton
                title="CONQUER FIRST ZONE"
                onPress={() => navigation.navigate('RUN')}
                variant="primary"
                size="md"
                style={{ marginTop: 16 }}
              />
            </View>
          }
        />
      )}

      {activeTab === 'history' && (
        <FlatList
          data={battleHistory}
          keyExtractor={(item) => item.id}
          renderItem={renderHistoryItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📜</Text>
              <Text style={styles.emptyTitle}>BATTLE LOG IS CLEAR</Text>
              <Text style={styles.emptyDesc}>
                Live invasion warnings and completed territory clashes will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
    paddingTop: Platform.OS === 'ios' ? 52 : 44,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.2,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.crimson,
    letterSpacing: 1.5,
  },
  boostChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(157, 0, 255, 0.18)',
    borderWidth: 1.2,
    borderColor: COLORS.cyberPurple,
    borderRadius: RADII.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...SHADOWS.purpleGlow,
  },
  boostChipIcon: {
    fontSize: 13,
    marginRight: 4,
  },
  boostChipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  summaryBadge: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  invasionArea: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    backgroundColor: 'rgba(16, 16, 32, 0.92)',
    borderRadius: RADII.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: SPACING.md,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: RADII.pill,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.borderMedium,
  },
  tabText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: 24,
  },
  battleCard: {
    marginBottom: 12,
    padding: SPACING.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 8,
  },
  ownerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  ownerStatus: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.crimson,
    letterSpacing: 0.8,
  },
  areaBadge: {
    backgroundColor: 'rgba(255, 42, 85, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.crimson,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADII.sm,
  },
  areaBadgeText: {
    color: COLORS.crimson,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  cardMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: RADII.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  metricCol: {
    alignItems: 'center',
  },
  metricVal: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricLbl: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  cardActionRow: {
    alignItems: 'flex-end',
  },
  challengeBtn: {
    width: '100%',
  },
  historyCard: {
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  historyDetails: {
    flex: 1,
  },
  historyTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  historyDesc: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  historyTime: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 42,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  emptyDesc: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
});
