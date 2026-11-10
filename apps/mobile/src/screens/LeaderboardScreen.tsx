/**
 * LeaderboardScreen — Global Esports Rankings for StrideClash.
 *
 * Features:
 * - 3D Tiered Glowing Podium (1st Gold Crown, 2nd Silver, 3rd Bronze)
 * - Scope toggle: GLOBAL 🌐 / COUNTRY 🇮🇳 / CITY 🏙️
 * - Metric toggles: TERRITORY M² / DISTANCE KM / CONQUERED ZONES
 * - Activity pills: ALL / RUN / WALK / BIKE
 * - Sticky bottom player rank card with gap-to-next-rank indicator
 * - Auto-refreshes when new territory is claimed
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Platform,
} from 'react-native';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { useAuth } from '@/context/AuthContext';
import {
  COLORS,
  CLASS_THEMES,
  SPACING,
  RADII,
  SHADOWS,
} from '@/theme/tokens';
import { GlassCard, StatBadge, PlayerAvatar } from '@/components/ui';
import { apiFetch, errorMessage } from '@/config/api';

interface LeaderboardEntry {
  id: string;
  display_name: string;
  character_type: string;
  color: string;
  total_territory: number;
  total_zones: number;
  total_runs: number;
  total_distance: number;
}

type ScopeFilter = 'global' | 'friends';
type ActivityFilter = 'all' | 'run' | 'walk' | 'cycle';
type MetricFilter = 'territory' | 'distance' | 'zones';

export default function LeaderboardScreen() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState<ScopeFilter>('global');
  const [activity, setActivity] = useState<ActivityFilter>('all');
  const [metric, setMetric] = useState<MetricFilter>('territory');

  const { territories } = useMultiplayer();
  const { user } = useAuth();

  const [lbError, setLbError] = useState<string | null>(null);
  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await apiFetch(`/leaderboard?activity=${activity}&metric=${metric}&scope=${scope}`);
      if (!res.ok) throw new Error(await errorMessage(res, 'Could not load rankings.'));
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
      setLbError(null);
    } catch (err: any) {
      setLbError(err?.message || 'Could not load rankings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activity, metric, scope]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    fetchLeaderboard();
  }, [territories.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const topThree = useMemo(() => entries.slice(0, 3), [entries]);
  const listEntries = useMemo(() => entries.slice(3), [entries]);

  const myEntry = useMemo(() => {
    const idx = entries.findIndex((e) => e.id === user?.uid);
    if (idx !== -1) {
      return { entry: entries[idx], rank: idx + 1 };
    }
    return null;
  }, [entries, user?.uid]);

  const formatValue = useCallback(
    (item: LeaderboardEntry) => {
      if (metric === 'distance') {
        return ((item.total_distance || 0) / 1000).toFixed(1) + ' km';
      }
      if (metric === 'zones') {
        return (item.total_zones || 0) + ' zones';
      }
      const sqm = Math.round(item.total_territory || 0);
      if (sqm >= 1000000) {
        return (sqm / 1000000).toFixed(2) + ' km²';
      }
      return sqm.toLocaleString() + ' m²';
    },
    [metric]
  );

  const renderHeader = () => (
    <View style={styles.headerArea}>
      {/* Scope: everyone, or you + the runners you follow */}
      {!!lbError && <Text style={{ color: '#EF4444', textAlign: 'center', marginBottom: 8 }}>{lbError}</Text>}
      <View style={styles.scopeRow}>
        <TouchableOpacity
          style={[styles.scopeBtn, scope === 'global' && styles.scopeBtnActive]}
          onPress={() => setScope('global')}
        >
          <Text style={[styles.scopeText, scope === 'global' && styles.scopeTextActive]}>
            GLOBAL 🌐
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.scopeBtn, scope === 'friends' && styles.scopeBtnActive]}
          onPress={() => setScope('friends')}
          testID="rank-scope-friends"
        >
          <Text style={[styles.scopeText, scope === 'friends' && styles.scopeTextActive]}>
            FRIENDS 🤝
          </Text>
        </TouchableOpacity>
      </View>

      {/* Metric Filter Chips */}
      <View style={styles.metricFilterRow}>
        <TouchableOpacity
          style={[styles.metricChip, metric === 'territory' && styles.metricChipActive]}
          onPress={() => setMetric('territory')}
        >
          <Text style={[styles.metricChipText, metric === 'territory' && styles.metricChipTextActive]}>
            TURF AREA
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricChip, metric === 'distance' && styles.metricChipActive]}
          onPress={() => setMetric('distance')}
        >
          <Text style={[styles.metricChipText, metric === 'distance' && styles.metricChipTextActive]}>
            DISTANCE
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.metricChip, metric === 'zones' && styles.metricChipActive]}
          onPress={() => setMetric('zones')}
        >
          <Text style={[styles.metricChipText, metric === 'zones' && styles.metricChipTextActive]}>
            ZONES
          </Text>
        </TouchableOpacity>
      </View>

      {/* 👑 3D-Tiered Esports Podium */}
      {topThree.length > 0 && (
        <View style={styles.podiumWrapper}>
          {/* 🥈 2nd Place (Silver - Left) */}
          <View style={[styles.podiumCol, { marginTop: 28 }]}>
            {topThree[1] && (
              <View style={styles.podiumPlayer}>
                <View style={[styles.podiumAvatar, { borderColor: COLORS.silver, ...SHADOWS.surface }]}>
                  <Text style={styles.podiumEmoji}>
                    {(CHARACTER_EMOJI as any)[topThree[1].character_type] || '🏃'}
                  </Text>
                  <View style={[styles.medalPill, { backgroundColor: COLORS.silver }]}>
                    <Text style={styles.medalPillText}>2</Text>
                  </View>
                </View>
                <Text style={styles.podiumName} numberOfLines={1}>
                  {topThree[1].display_name}
                </Text>
                <Text style={[styles.podiumScore, { color: COLORS.silver }]}>
                  {formatValue(topThree[1])}
                </Text>
              </View>
            )}
            <View style={[styles.podiumPedestal, styles.podiumPedestal2]}>
              <Text style={styles.pedestalRank}>2ND</Text>
            </View>
          </View>

          {/* 🥇 1st Place (Gold Crown - Center) */}
          <View style={styles.podiumCol}>
            {topThree[0] && (
              <View style={styles.podiumPlayer}>
                <Text style={styles.crownEmoji}>👑</Text>
                <View style={[styles.podiumAvatar, styles.podiumAvatar1, { borderColor: COLORS.gold, ...SHADOWS.goldGlow }]}>
                  <Text style={styles.podiumEmoji}>
                    {(CHARACTER_EMOJI as any)[topThree[0].character_type] || '⚡'}
                  </Text>
                  <View style={[styles.medalPill, { backgroundColor: COLORS.gold }]}>
                    <Text style={styles.medalPillText}>1</Text>
                  </View>
                </View>
                <Text style={[styles.podiumName, { fontWeight: '900' }]} numberOfLines={1}>
                  {topThree[0].display_name}
                </Text>
                <Text style={[styles.podiumScore, { color: COLORS.gold }]}>
                  {formatValue(topThree[0])}
                </Text>
              </View>
            )}
            <View style={[styles.podiumPedestal, styles.podiumPedestal1]}>
              <Text style={[styles.pedestalRank, { color: COLORS.gold }]}>1ST</Text>
            </View>
          </View>

          {/* 🥉 3rd Place (Bronze - Right) */}
          <View style={[styles.podiumCol, { marginTop: 42 }]}>
            {topThree[2] && (
              <View style={styles.podiumPlayer}>
                <View style={[styles.podiumAvatar, { borderColor: COLORS.bronze, ...SHADOWS.surface }]}>
                  <Text style={styles.podiumEmoji}>
                    {(CHARACTER_EMOJI as any)[topThree[2].character_type] || '🏃'}
                  </Text>
                  <View style={[styles.medalPill, { backgroundColor: COLORS.bronze }]}>
                    <Text style={styles.medalPillText}>3</Text>
                  </View>
                </View>
                <Text style={styles.podiumName} numberOfLines={1}>
                  {topThree[2].display_name}
                </Text>
                <Text style={[styles.podiumScore, { color: COLORS.bronze }]}>
                  {formatValue(topThree[2])}
                </Text>
              </View>
            )}
            <View style={[styles.podiumPedestal, styles.podiumPedestal3]}>
              <Text style={styles.pedestalRank}>3RD</Text>
            </View>
          </View>
        </View>
      )}

      {/* Activity Filter Sub-Tabs */}
      <View style={styles.activityFilterRow}>
        {(['all', 'run', 'walk', 'cycle'] as ActivityFilter[]).map((act) => (
          <TouchableOpacity
            key={act}
            style={[styles.activityPill, activity === act && styles.activityPillActive]}
            onPress={() => setActivity(act)}
          >
            <Text style={[styles.activityPillText, activity === act && styles.activityPillTextActive]}>
              {act === 'all' ? 'ALL MODES' : act === 'cycle' ? 'BIKE' : act.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isMe = item.id === user?.uid;
    const actualRank = index + 4;
    const emoji = (CHARACTER_EMOJI as any)[item.character_type] || '🏃';

    return (
      <GlassCard
        style={styles.playerRow}
        variant={isMe ? 'neonBorder' : 'default'}
        glow={isMe}
      >
        <View style={styles.rankCol}>
          <Text style={[styles.rankNumber, isMe && { color: COLORS.neonGreen }]}>
            #{actualRank}
          </Text>
        </View>

        <View style={[styles.avatarRing, { borderColor: item.color || COLORS.electricBlue }]}>
          <Text style={styles.avatarEmoji}>{emoji}</Text>
        </View>

        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text style={[styles.playerName, isMe && { color: COLORS.neonGreen }]} numberOfLines={1}>
              {item.display_name || 'Runner'}
            </Text>
            {isMe && <Text style={styles.youTag}>YOU</Text>}
          </View>
          <Text style={styles.playerSub}>
            {((item.total_distance || 0) / 1000).toFixed(1)} km · {item.total_runs || 0} runs
          </Text>
        </View>

        <View style={styles.metricCol}>
          <Text style={[styles.metricValText, { color: item.color || COLORS.electricBlue }]}>
            {formatValue(item)}
          </Text>
        </View>
      </GlassCard>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Screen Title Header ── */}
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>ESPORTS RANKINGS</Text>
        <Text style={styles.screenSub}>GLOBAL TURF LEADERBOARD</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.neonGreen} size="large" />
          <Text style={styles.loadingText}>SYNCING LEADERBOARD...</Text>
        </View>
      ) : (
        <FlatList
          data={listEntries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.neonGreen}
              colors={[COLORS.neonGreen]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No runners logged for this filter yet.</Text>
            </View>
          }
        />
      )}

      {/* ── Sticky Personal Ranking Floating Card ── */}
      {myEntry && (
        <View style={styles.stickyUserCardContainer}>
          <GlassCard style={styles.stickyCard} variant="neonBorder" glow>
            <View style={styles.stickyRow}>
              <View style={styles.stickyRankCol}>
                <Text style={styles.stickyRankNum}>#{myEntry.rank}</Text>
                <Text style={styles.stickyRankLabel}>YOUR RANK</Text>
              </View>

              <View style={styles.stickyInfoCol}>
                <Text style={styles.stickyName}>{myEntry.entry.display_name}</Text>
                <Text style={styles.stickySub}>
                  {myEntry.rank === 1
                    ? '🏆 Reigning Champion of the Sector!'
                    : `Keep running to overtake #${myEntry.rank - 1}!`}
                </Text>
              </View>

              <View style={styles.stickyScoreCol}>
                <Text style={styles.stickyScoreVal}>{formatValue(myEntry.entry)}</Text>
                <Text style={styles.stickyScoreLbl}>TOTAL SCORE</Text>
              </View>
            </View>
          </GlassCard>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
    paddingTop: 8, // hub screen owns the safe area
  },
  screenHeader: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.2,
  },
  screenSub: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.neonGreen,
    letterSpacing: 1.5,
  },
  headerArea: {
    marginBottom: 8,
  },
  scopeRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16, 27, 45, 0.9)',
    borderRadius: RADII.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  scopeBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: RADII.pill,
  },
  scopeBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.borderMedium,
  },
  scopeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
  },
  scopeTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  metricFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  metricChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  metricChipActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
    borderColor: COLORS.electricBlue,
  },
  metricChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.6,
  },
  metricChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  podiumWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    height: 195,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  podiumCol: {
    flex: 1,
    alignItems: 'center',
  },
  podiumPlayer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  crownEmoji: {
    fontSize: 18,
    marginBottom: 2,
  },
  podiumAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#162238',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  podiumAvatar1: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
  },
  podiumEmoji: {
    fontSize: 24,
  },
  medalPill: {
    position: 'absolute',
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalPillText: {
    color: '#0B1220',
    fontSize: 10,
    fontWeight: '900',
  },
  podiumName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    maxWidth: 90,
    textAlign: 'center',
  },
  podiumScore: {
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  podiumPedestal: {
    width: '92%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: RADII.sm,
    borderTopRightRadius: RADII.sm,
    backgroundColor: 'rgba(22, 22, 45, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  podiumPedestal1: {
    height: 72,
    borderColor: COLORS.gold,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
  },
  podiumPedestal2: {
    height: 52,
    borderColor: COLORS.silver,
    backgroundColor: 'rgba(192, 192, 216, 0.10)',
  },
  podiumPedestal3: {
    height: 38,
    borderColor: COLORS.bronze,
    backgroundColor: 'rgba(205, 127, 50, 0.10)',
  },
  pedestalRank: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  activityFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 8,
  },
  activityPill: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  activityPillActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
    borderWidth: 1,
    borderColor: COLORS.neonGreen,
  },
  activityPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
  },
  activityPillTextActive: {
    color: COLORS.neonGreen,
    fontWeight: '900',
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: 94,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  rankCol: {
    width: 32,
    alignItems: 'center',
  },
  rankNumber: {
    fontSize: 13,
    fontWeight: '900',
    color: COLORS.textMuted,
    fontVariant: ['tabular-nums'],
  },
  avatarRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#162238',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarEmoji: {
    fontSize: 18,
  },
  infoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerName: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    maxWidth: 160,
  },
  youTag: {
    fontSize: 9,
    fontWeight: '900',
    color: '#0B1220',
    backgroundColor: COLORS.neonGreen,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 6,
  },
  playerSub: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  metricCol: {
    alignItems: 'flex-end',
  },
  metricValText: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  stickyUserCardContainer: {
    position: 'absolute',
    bottom: 12,
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 30,
  },
  stickyCard: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(18, 18, 38, 0.95)',
  },
  stickyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stickyRankCol: {
    alignItems: 'center',
    paddingRight: 12,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
  },
  stickyRankNum: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.neonGreen,
    fontVariant: ['tabular-nums'],
  },
  stickyRankLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
  },
  stickyInfoCol: {
    flex: 1,
    paddingHorizontal: 12,
  },
  stickyName: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  stickySub: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  stickyScoreCol: {
    alignItems: 'flex-end',
  },
  stickyScoreVal: {
    fontSize: 14,
    fontWeight: '900',
    color: COLORS.neonGreen,
    fontVariant: ['tabular-nums'],
  },
  stickyScoreLbl: {
    fontSize: 8,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 12,
    letterSpacing: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
});
