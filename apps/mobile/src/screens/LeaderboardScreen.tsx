/**
 * LeaderboardScreen — Global player rankings by territory claimed.
 * Redesigned in v2.0 with Podium, Activity filters, and Sticky User card.
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
  ScrollView,
} from 'react-native';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { useAuth } from '@/context/AuthContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';

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

type ActivityFilter = 'all' | 'run' | 'walk' | 'cycle';
type MetricFilter = 'territory' | 'distance' | 'zones';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activity, setActivity] = useState<ActivityFilter>('all');
  const [metric, setMetric] = useState<MetricFilter>('territory');

  const { territories } = useMultiplayer();
  const { user } = useAuth();

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard?activity=${activity}&metric=${metric}`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      const data = await res.json();
      setEntries(data);
    } catch (err) {
      console.error('[Leaderboard] Failed to fetch:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activity, metric]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Re-fetch when new territories are claimed
  useEffect(() => {
    fetchLeaderboard();
  }, [territories.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Extract Top 3 for Podium
  const topThree = useMemo(() => entries.slice(0, 3), [entries]);
  const listEntries = useMemo(() => entries.slice(3), [entries]);

  // Find current user's entry
  const myEntry = useMemo(() => {
    const idx = entries.findIndex(e => e.id === user?.uid);
    if (idx !== -1) {
      return { entry: entries[idx], rank: idx + 1 };
    }
    return null;
  }, [entries, user]);

  const formatValue = useCallback((item: LeaderboardEntry) => {
    if (metric === 'distance') {
      return ((item.total_distance || 0) / 1000).toFixed(1) + ' km';
    }
    if (metric === 'zones') {
      return (item.total_zones || 0) + ' zone' + (item.total_zones !== 1 ? 's' : '');
    }
    return ((item.total_territory || 0) / 1_000_000).toFixed(4) + ' km²';
  }, [metric]);

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isMe = item.id === user?.uid;
    const emoji = item.character_type ? CHARACTER_EMOJI[item.character_type as CharacterType] ?? '🏃' : '🏃';
    const actualRank = index + 4; // listEntries starts at index 3 (4th place)

    return (
      <View style={[styles.row, isMe && styles.rowHighlight]}>
        <View style={styles.rankCol}>
          <Text style={styles.rankNum}>{actualRank}</Text>
        </View>

        <View style={[styles.avatar, { backgroundColor: item.color + '22', borderColor: item.color }]}>
          <Text style={styles.avatarEmoji}>{emoji}</Text>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, isMe && { color: item.color }]} numberOfLines={1}>
              {item.display_name || 'Unknown Runner'}
            </Text>
            {isMe && <Text style={styles.youBadge}>YOU</Text>}
          </View>
          <Text style={styles.subStats}>
            {((item.total_distance || 0) / 1000).toFixed(1)} km · {item.total_runs} run{item.total_runs !== 1 ? 's' : ''}
          </Text>
        </View>

        <View style={styles.metricCol}>
          <Text style={[styles.metricVal, { color: item.color }]}>{formatValue(item)}</Text>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.listHeader}>
      {/* 👑 3D-style Podium View */}
      {topThree.length > 0 && (
        <View style={styles.podiumWrapper}>
          <View style={styles.podiumContainer}>
            {/* 🥈 Second Place (Left) */}
            <View style={styles.podiumCol}>
              {topThree[1] && (
                <View style={styles.podiumPlayer}>
                  <View style={[styles.podiumAvatar, { borderColor: '#C0C0C0', shadowColor: '#C0C0C0' }]}>
                    <Text style={styles.podiumEmoji}>
                      {CHARACTER_EMOJI[topThree[1].character_type as CharacterType] || '🏃'}
                    </Text>
                    <Text style={styles.podiumBadge}>🥈</Text>
                  </View>
                  <Text style={styles.podiumName} numberOfLines={1}>{topThree[1].display_name}</Text>
                  <Text style={styles.podiumVal}>{formatValue(topThree[1])}</Text>
                </View>
              )}
              <View style={[styles.podiumBar, styles.podiumBarSecond]}>
                <Text style={styles.podiumRankText}>2</Text>
              </View>
            </View>

            {/* 🥇 First Place (Center) */}
            <View style={styles.podiumCol}>
              {topThree[0] && (
                <View style={styles.podiumPlayer}>
                  <View style={[styles.podiumAvatar, styles.podiumAvatarFirst, { borderColor: '#FFD700', shadowColor: '#FFD700' }]}>
                    <Text style={styles.podiumEmojiFirst}>
                      {CHARACTER_EMOJI[topThree[0].character_type as CharacterType] || '🏃'}
                    </Text>
                    <Text style={styles.podiumBadgeFirst}>🥇</Text>
                  </View>
                  <Text style={[styles.podiumName, { fontWeight: '900', color: '#FFF' }]} numberOfLines={1}>
                    {topThree[0].display_name}
                  </Text>
                  <Text style={[styles.podiumVal, { color: '#FFD700' }]}>{formatValue(topThree[0])}</Text>
                </View>
              )}
              <View style={[styles.podiumBar, styles.podiumBarFirst]}>
                <Text style={styles.podiumRankText}>1</Text>
              </View>
            </View>

            {/* 🥉 Third Place (Right) */}
            <View style={styles.podiumCol}>
              {topThree[2] && (
                <View style={styles.podiumPlayer}>
                  <View style={[styles.podiumAvatar, { borderColor: '#CD7F32', shadowColor: '#CD7F32' }]}>
                    <Text style={styles.podiumEmoji}>
                      {CHARACTER_EMOJI[topThree[2].character_type as CharacterType] || '🏃'}
                    </Text>
                    <Text style={styles.podiumBadge}>🥉</Text>
                  </View>
                  <Text style={styles.podiumName} numberOfLines={1}>{topThree[2].display_name}</Text>
                  <Text style={styles.podiumVal}>{formatValue(topThree[2])}</Text>
                </View>
              )}
              <View style={[styles.podiumBar, styles.podiumBarThird]}>
                <Text style={styles.podiumRankText}>3</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      {/* Header Panel */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🏆 LEADERBOARD</Text>
        <Text style={styles.headerSub}>Compete globally for regional dominance</Text>

        {/* Metric Toggles (Territory / Distance / Zones) */}
        <View style={styles.metricContainer}>
          {(['territory', 'distance', 'zones'] as MetricFilter[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.metricTab, metric === m && styles.metricTabActive]}
              onPress={() => setMetric(m)}
            >
              <Text style={[styles.metricTabText, metric === m && styles.metricTabTextActive]}>
                {m.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Activity Pills (ALL / RUN / WALK / CYCLE) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.activityScroll}
          contentContainerStyle={styles.activityContainer}
        >
          {([
            { key: 'all', label: '🌍 ALL' },
            { key: 'run', label: '🏃 RUN' },
            { key: 'walk', label: '🚶 WALK' },
            { key: 'cycle', label: '🚴 CYCLE' }
          ] as { key: ActivityFilter; label: string }[]).map((act) => (
            <TouchableOpacity
              key={act.key}
              style={[styles.activityPill, activity === act.key && styles.activityPillActive]}
              onPress={() => setActivity(act.key)}
            >
              <Text style={[styles.activityPillText, activity === act.key && styles.activityPillTextActive]}>
                {act.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#00BFFF" size="large" />
          <Text style={styles.loadingText}>Refreshing rankings...</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗺️</Text>
          <Text style={styles.emptyText}>No rankings found.</Text>
          <Text style={styles.emptySubText}>Start tracking activity to claim your spot!</Text>
        </View>
      ) : (
        <FlatList
          data={listEntries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#00BFFF"
            />
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* 🛡️ Sticky Personal Rank Card */}
      {myEntry && (
        <View style={styles.stickyCard}>
          <View style={styles.stickyRankCol}>
            <Text style={styles.stickyRankNum}>#{myEntry.rank}</Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: myEntry.entry.color + '22', borderColor: myEntry.entry.color }]}>
            <Text style={styles.avatarEmoji}>
              {CHARACTER_EMOJI[myEntry.entry.character_type as CharacterType] || '🏃'}
            </Text>
          </View>
          <View style={styles.info}>
            <Text style={styles.stickyName} numberOfLines={1}>{myEntry.entry.display_name}</Text>
            <Text style={styles.subStats}>Your active rank among competitors</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={[styles.metricVal, { color: myEntry.entry.color, fontSize: 16 }]}>
              {formatValue(myEntry.entry)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },

  header: {
    paddingTop: 55,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#111124',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E38',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#00BFFF',
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 12,
    color: '#4A4A6A',
    marginTop: 4,
  },

  // Metric selectors
  metricContainer: {
    flexDirection: 'row',
    backgroundColor: '#0A0A14',
    borderRadius: 8,
    marginTop: 16,
    padding: 3,
    borderWidth: 1,
    borderColor: '#1E1E38',
  },
  metricTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  metricTabActive: {
    backgroundColor: '#1E1E38',
  },
  metricTabText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4A4A6A',
    letterSpacing: 1,
  },
  metricTabTextActive: {
    color: '#00BFFF',
  },

  // Activity pills
  activityScroll: {
    marginTop: 12,
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  activityContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
  },
  activityPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1E1E38',
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  activityPillActive: {
    backgroundColor: '#00BFFF1F',
    borderColor: '#00BFFF',
  },
  activityPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7C7CB0',
  },
  activityPillTextActive: {
    color: '#00BFFF',
  },

  list: { paddingBottom: 110 },
  listHeader: { paddingVertical: 16 },

  // 👑 Podium design
  podiumWrapper: {
    alignItems: 'center',
    marginVertical: 10,
  },
  podiumContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '90%',
    justifyContent: 'center',
    gap: 8,
  },
  podiumCol: {
    flex: 1,
    alignItems: 'center',
  },
  podiumPlayer: {
    alignItems: 'center',
    marginBottom: 8,
    width: '100%',
  },
  podiumAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    backgroundColor: '#1E1E38',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  podiumAvatarFirst: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
  },
  podiumEmoji: { fontSize: 28 },
  podiumEmojiFirst: { fontSize: 36 },
  podiumBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    fontSize: 16,
  },
  podiumBadgeFirst: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    fontSize: 22,
  },
  podiumName: {
    color: '#8F8FBC',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
    width: 90,
  },
  podiumVal: {
    fontSize: 11,
    fontWeight: '800',
    color: '#00BFFF',
    marginTop: 2,
  },
  podiumBar: {
    width: '100%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16162E',
    borderWidth: 1,
    borderColor: '#2A2A4D',
    borderBottomWidth: 0,
  },
  podiumBarFirst: {
    height: 90,
    backgroundColor: '#FFD70014',
    borderColor: '#FFD70044',
  },
  podiumBarSecond: {
    height: 65,
    backgroundColor: '#C0C0C010',
    borderColor: '#C0C0C033',
  },
  podiumBarThird: {
    height: 48,
    backgroundColor: '#CD7F320D',
    borderColor: '#CD7F3222',
  },
  podiumRankText: {
    color: '#4A4A6A',
    fontWeight: '900',
    fontSize: 22,
  },

  // List Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#16162A',
    gap: 12,
  },
  rowHighlight: {
    backgroundColor: '#1E1E38',
  },
  rankCol: { width: 28, alignItems: 'center' },
  rankNum: { color: '#6A6A8C', fontWeight: '900', fontSize: 14 },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 20 },

  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  youBadge: {
    backgroundColor: '#00BFFF1C',
    color: '#00BFFF',
    fontSize: 9,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: '#00BFFF44',
  },
  subStats: { fontSize: 11, color: '#4A4A6A', marginTop: 3 },

  metricCol: { alignItems: 'flex-end', justifyContent: 'center' },
  metricVal: { fontSize: 15, fontWeight: '900' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D1A' },
  loadingText: { color: '#00BFFF', marginTop: 16, fontSize: 14, fontWeight: '600' },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  emptySubText: { color: '#4A4A6A', fontSize: 13, marginTop: 8 },

  // Sticky personal rank card at the bottom
  stickyCard: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#18182E9F',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#00BFFF55',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  stickyRankCol: {
    width: 32,
    alignItems: 'center',
  },
  stickyRankNum: {
    color: '#00BFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  stickyName: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
  },
});
