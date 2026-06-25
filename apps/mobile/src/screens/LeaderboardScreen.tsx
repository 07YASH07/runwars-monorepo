/**
 * LeaderboardScreen — Global player rankings by territory claimed.
 * Shows top 20 players with gold/silver/bronze medals for top 3.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
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
  total_runs: number;
  total_distance: number;
}

const MEDAL = ['🥇', '🥈', '🥉'];

function getRankStyle(index: number) {
  if (index === 0) return { color: '#FFD700', fontSize: 22 };
  if (index === 1) return { color: '#C0C0C0', fontSize: 20 };
  if (index === 2) return { color: '#CD7F32', fontSize: 18 };
  return { color: '#4A4A6A', fontSize: 16 };
}

export default function LeaderboardScreen() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { territories } = useMultiplayer();
  const { user } = useAuth();

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard`, {
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
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Re-fetch leaderboard when a new territory is claimed
  useEffect(() => {
    fetchLeaderboard();
  }, [territories.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const renderItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isMe = item.id === user?.uid;
    const emoji = item.character_type ? CHARACTER_EMOJI[item.character_type as CharacterType] ?? '🏃' : '🏃';
    const territoryKm2 = (item.total_territory / 1_000_000).toFixed(4);
    const distanceKm = (item.total_distance / 1000).toFixed(1);

    return (
      <View style={[styles.row, isMe && styles.rowHighlight]}>
        {/* Rank */}
        <View style={styles.rankCol}>
          {index < 3 ? (
            <Text style={styles.medal}>{MEDAL[index]}</Text>
          ) : (
            <Text style={[styles.rankNum, getRankStyle(index)]}>{index + 1}</Text>
          )}
        </View>

        {/* Avatar bubble */}
        <View style={[styles.avatar, { backgroundColor: item.color + '33', borderColor: item.color }]}>
          <Text style={styles.avatarEmoji}>{emoji}</Text>
        </View>

        {/* Name + stats */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, isMe && { color: item.color }]} numberOfLines={1}>
              {item.display_name || 'Unknown Runner'}
            </Text>
            {isMe && <Text style={styles.youBadge}>YOU</Text>}
          </View>
          <Text style={styles.subStats}>
            {distanceKm} km · {item.total_runs} run{item.total_runs !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Territory */}
        <View style={styles.territoryCol}>
          <Text style={[styles.territoryVal, { color: item.color }]}>{territoryKm2}</Text>
          <Text style={styles.territoryUnit}>km²</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🏆 LEADERBOARD</Text>
        <Text style={styles.headerSub}>Ranked by territory claimed</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFD700" size="large" />
          <Text style={styles.loadingText}>Loading rankings...</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗺️</Text>
          <Text style={styles.emptyText}>No territories claimed yet.</Text>
          <Text style={styles.emptySubText}>Start a run to get on the board!</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FFD700"
            />
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },

  header: {
    paddingTop: 60,
    paddingBottom: 24,
    paddingHorizontal: 24,
    backgroundColor: '#16162A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFD700',
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 12,
    color: '#4A4A6A',
    marginTop: 4,
    letterSpacing: 1,
  },

  list: { paddingVertical: 8 },

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
    borderLeftWidth: 3,
    borderLeftColor: '#00BFFF',
  },

  rankCol: { width: 36, alignItems: 'center' },
  medal: { fontSize: 22 },
  rankNum: { fontWeight: '900' },

  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 22 },

  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  youBadge: {
    backgroundColor: '#00BFFF22',
    color: '#00BFFF',
    fontSize: 10,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: '#00BFFF44',
  },
  subStats: { fontSize: 12, color: '#4A4A6A', marginTop: 3 },

  territoryCol: { alignItems: 'flex-end' },
  territoryVal: { fontSize: 18, fontWeight: '900' },
  territoryUnit: { fontSize: 10, color: '#4A4A6A', fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#4A4A6A', marginTop: 16, fontSize: 14 },
  emptyEmoji: { fontSize: 64, marginBottom: 16 },
  emptyText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  emptySubText: { color: '#4A4A6A', fontSize: 13, marginTop: 8 },
});
