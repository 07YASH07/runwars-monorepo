import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  StatusBar,
} from 'react-native';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';

interface FeedItem {
  id: string;
  userId: string;
  ownerName: string;
  ownerAvatar?: string;
  characterType?: string;
  color: string;
  areaSquareMeters: number;
  claimedAt: string;
  type: 'claim' | 'battle' | 'system';
  message: string;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function FeedScreen() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFeed = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/territories`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      if (!response.ok) throw new Error('Failed to load feed');
      const territories = await response.json();

      // Convert territories into feed items
      const claimItems: FeedItem[] = territories.map((t: any) => ({
        id: t.id,
        userId: t.userId,
        ownerName: t.ownerName || 'Runner',
        ownerAvatar: t.ownerAvatar,
        characterType: t.characterType || 'scout',
        color: t.color || '#00BFFF',
        areaSquareMeters: t.areaSquareMeters,
        claimedAt: t.claimedAt,
        type: 'claim',
        message: `Claimed a new zone of ${Math.round(t.areaSquareMeters)} m²!`,
      }));

      // Add a few custom system/motivational messages to pad the feed
      const systemItems: FeedItem[] = [
        {
          id: 'sys_1',
          userId: 'system',
          ownerName: 'RUNWARS COMMAND',
          color: '#000000',
          areaSquareMeters: 0,
          claimedAt: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
          type: 'system',
          message: 'Weekly Challenge: Conquer 3 opponent zones to unlock the exclusive "Ghost Shadow" tag color!',
        },
        {
          id: 'sys_2',
          userId: 'system',
          ownerName: 'GAME UPDATE',
          color: '#FF8C00',
          areaSquareMeters: 0,
          claimedAt: new Date(Date.now() - 3600000 * 12).toISOString(), // 12 hours ago
          type: 'system',
          message: 'The Arena is heating up! Double XP is active for all runs completed after sunset.',
        }
      ];

      const combined = [...claimItems, ...systemItems].sort(
        (a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime()
      );

      setFeed(combined);
    } catch (err) {
      console.error('[Feed] Error loading data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFeed();
  }, [fetchFeed]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FEED</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#000000" />
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#000" />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {feed.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>🗺️</Text>
              <Text style={styles.emptyText}>The feed is currently empty.</Text>
              <Text style={styles.emptySub}>Go complete a run to claim the first territory!</Text>
            </View>
          ) : (
            feed.map((item) => {
              const isSystem = item.type === 'system';
              const emoji = CHARACTER_EMOJI[item.characterType as CharacterType] || '🏃';

              return (
                <View key={item.id} style={styles.card}>
                  {/* Card Header */}
                  <View style={styles.cardHeader}>
                    {isSystem ? (
                      <View style={[styles.avatarContainer, { backgroundColor: item.color }]}>
                        <Text style={styles.avatarEmoji}>📢</Text>
                      </View>
                    ) : item.ownerAvatar ? (
                      <Image source={{ uri: item.ownerAvatar }} style={[styles.avatarImage, { borderColor: item.color }]} />
                    ) : (
                      <View style={[styles.avatarContainer, { borderColor: item.color }]}>
                        <Text style={styles.avatarEmoji}>{emoji}</Text>
                      </View>
                    )}

                    <View style={styles.headerInfo}>
                      <Text style={[styles.ownerName, isSystem && styles.systemName]}>
                        {item.ownerName.toUpperCase()}
                      </Text>
                      <Text style={styles.timeText}>{timeAgo(item.claimedAt)}</Text>
                    </View>
                    {!isSystem && (
                      <View style={[styles.zoneBadge, { backgroundColor: item.color + '15' }]}>
                        <Text style={[styles.zoneBadgeText, { color: item.color }]}>ZONE</Text>
                      </View>
                    )}
                  </View>

                  {/* Card Body */}
                  <View style={styles.cardBody}>
                    <Text style={styles.messageText}>{item.message}</Text>
                  </View>

                  {/* Card Actions */}
                  <View style={styles.cardFooter}>
                    <TouchableOpacity style={styles.footerBtn}>
                      <Text style={styles.footerBtnText}>❤️ Like</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.footerBtn}>
                      <Text style={styles.footerBtnText}>💬 Comment</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1.5,
    borderBottomColor: '#EBEBEB',
    paddingTop: 54,
    paddingBottom: 16,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 2,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 120,
  },
  emptyEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
  },
  emptySub: {
    fontSize: 12,
    color: '#8A8A8A',
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#EBEBEB',
    marginBottom: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
  },
  avatarEmoji: {
    fontSize: 22,
  },
  headerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  ownerName: {
    fontSize: 13,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.5,
  },
  systemName: {
    color: '#FF3B30',
  },
  timeText: {
    fontSize: 10,
    color: '#8A8A8A',
    fontWeight: '600',
    marginTop: 2,
  },
  zoneBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  zoneBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  cardBody: {
    marginVertical: 12,
  },
  messageText: {
    fontSize: 14,
    color: '#2C2C2C',
    lineHeight: 20,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#F5F5F7',
    paddingTop: 12,
    gap: 16,
  },
  footerBtn: {
    paddingVertical: 4,
  },
  footerBtnText: {
    fontSize: 12,
    color: '#8A8A8A',
    fontWeight: '700',
  },
});
