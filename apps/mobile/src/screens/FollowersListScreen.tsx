/**
 * FollowersListScreen — modal list of a user's followers or following.
 *
 * Opened from ProfileScreen when the user taps the followers/following
 * counters. Uses the existing backend endpoint GET /api/followers/:userId
 * which returns { followers: [...], following: [...] }. Follow/unfollow is
 * wired to POST /api/followers/follow and /api/followers/unfollow.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/config/api';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { COLORS, RADII, SPACING } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/types';

export interface FollowersListParams {
  userId: string;
  tab: 'followers' | 'following';
  displayName?: string;
}

interface UserRow {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  character_type?: string | null;
  color?: string | null;
  bio?: string | null;
}

interface ProfileData {
  user: { id: string; display_name: string; character_type?: string; color?: string; bio?: string };
  stats?: { total_distance?: number; total_runs?: number; total_zones?: number };
}

export default function FollowersListScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'FollowersList'>>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const { userId, tab: initialTab, displayName } = route.params;
  const [tab, setTab] = useState<'followers' | 'following'>(initialTab);
  const [followers, setFollowers] = useState<UserRow[]>([]);
  const [following, setFollowing] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  // Snapshot of IDs the current logged-in user is following (for the toggle button).
  const [myFollowingIds, setMyFollowingIds] = useState<Set<string>>(new Set());

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/followers/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setFollowers(data.followers || []);
        setFollowing(data.following || []);
      } else {
        Alert.alert('Error', 'Failed to load list.');
      }
      // Also fetch my-own-following so we can render Follow/Unfollow correctly
      if (user?.uid && user.uid !== userId) {
        const mine = await apiFetch(`/api/followers/${user.uid}`);
        if (mine.ok) {
          const md = await mine.json();
          setMyFollowingIds(new Set((md.following || []).map((u: UserRow) => u.id)));
        }
      } else if (user?.uid === userId) {
        // Looking at my own lists — the "following" tab IS my following set.
        // Compute on the next render once `following` updates.
      }
    } catch {
      Alert.alert('Network', 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  }, [userId, user?.uid]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  // If the profile belongs to me, my `following` IS the source of truth
  useEffect(() => {
    if (user?.uid === userId) {
      setMyFollowingIds(new Set(following.map(u => u.id)));
    }
  }, [user?.uid, userId, following]);

  const toggleFollow = useCallback(async (target: UserRow) => {
    if (!user?.uid || user.uid === target.id) return;
    const isFollowing = myFollowingIds.has(target.id);
    setBusyRow(target.id);
    try {
      const path = isFollowing ? '/api/followers/unfollow' : '/api/followers/follow';
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, followingId: target.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        Alert.alert('Error', data.error || 'Could not update follow.');
        return;
      }
      // Update local set optimistically
      setMyFollowingIds(prev => {
        const next = new Set(prev);
        if (isFollowing) next.delete(target.id); else next.add(target.id);
        return next;
      });
    } catch {
      Alert.alert('Network', 'Could not reach server.');
    } finally {
      setBusyRow(null);
    }
  }, [user?.uid, myFollowingIds]);

  // Mini profile card for any row (same pattern as CommunityScreen).
  const [profileVisible, setProfileVisible] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const openProfile = useCallback(async (targetId: string) => {
    setProfile(null);
    setProfileVisible(true);
    setProfileLoading(true);
    try {
      const res = await apiFetch(`/api/profile/${targetId}`);
      if (res.ok) setProfile(await res.json());
    } catch {
      // card shows the failure message
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const data = tab === 'followers' ? followers : following;

  const headerTitle = useMemo(() => {
    const who = displayName ? ` · ${displayName}` : '';
    return (tab === 'followers' ? 'FOLLOWERS' : 'FOLLOWING') + who;
  }, [tab, displayName]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A14" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn} testID="followers-back">
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{headerTitle}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.segment}>
        <TouchableOpacity
          onPress={() => setTab('followers')}
          style={[styles.segBtn, tab === 'followers' && styles.segBtnActive]}
          testID="followers-tab-followers"
        >
          <Text style={[styles.segText, tab === 'followers' && styles.segTextActive]}>
            {followers.length} FOLLOWERS
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab('following')}
          style={[styles.segBtn, tab === 'following' && styles.segBtnActive]}
          testID="followers-tab-following"
        >
          <Text style={[styles.segText, tab === 'following' && styles.segTextActive]}>
            {following.length} FOLLOWING
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={COLORS.neonGreen} size="large" />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: 100 }}
          renderItem={({ item }) => {
            const isMe = user?.uid === item.id;
            const isFollowing = myFollowingIds.has(item.id);
            const emoji = CHARACTER_EMOJI[item.character_type as CharacterType] || '🏃';
            const color = item.color || COLORS.electricBlue;
            return (
              <TouchableOpacity
                style={[styles.row, { borderColor: color + '44' }]}
                activeOpacity={0.85}
                onPress={() => openProfile(item.id)}
                testID={`followers-row-${item.id}`}
              >
                <View style={[styles.avatar, { borderColor: color, backgroundColor: color + '14' }]}>
                  <Text style={styles.avatarEmoji}>{emoji}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>{item.display_name || 'Runner'}</Text>
                  {item.bio ? (
                    <Text style={styles.bio} numberOfLines={1}>{item.bio}</Text>
                  ) : null}
                </View>
                {!isMe && (
                  <TouchableOpacity
                    disabled={busyRow === item.id}
                    onPress={() => toggleFollow(item)}
                    style={[styles.followBtn, isFollowing && styles.followBtnActive]}
                    testID={`followers-toggle-${item.id}`}
                  >
                    {busyRow === item.id ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
                        {isFollowing ? 'FOLLOWING' : 'FOLLOW'}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={profileVisible} transparent animationType="fade" onRequestClose={() => setProfileVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setProfileVisible(false)}>
          <View style={styles.card} onStartShouldSetResponder={() => true}>
            {profileLoading ? (
              <ActivityIndicator color={COLORS.neonGreen} size="large" />
            ) : profile ? (
              <>
                <View style={[styles.cardAvatar, { borderColor: profile.user.color || COLORS.electricBlue }]}>
                  <Text style={{ fontSize: 40 }}>
                    {CHARACTER_EMOJI[profile.user.character_type as CharacterType] || '🏃'}
                  </Text>
                </View>
                <Text style={styles.cardName}>{profile.user.display_name || 'Runner'}</Text>
                {profile.user.character_type ? (
                  <Text style={[styles.cardClass, { color: profile.user.color || COLORS.electricBlue }]}>
                    {profile.user.character_type.toUpperCase()}
                  </Text>
                ) : null}
                {profile.user.bio ? <Text style={styles.cardBio}>"{profile.user.bio}"</Text> : null}
                <View style={styles.cardStats}>
                  <View style={styles.cardStatCol}>
                    <Text style={styles.cardStatVal}>{((profile.stats?.total_distance || 0) / 1000).toFixed(1)}</Text>
                    <Text style={styles.cardStatLbl}>KM</Text>
                  </View>
                  <View style={styles.cardStatCol}>
                    <Text style={styles.cardStatVal}>{profile.stats?.total_runs || 0}</Text>
                    <Text style={styles.cardStatLbl}>RUNS</Text>
                  </View>
                  <View style={styles.cardStatCol}>
                    <Text style={styles.cardStatVal}>{profile.stats?.total_zones || 0}</Text>
                    <Text style={styles.cardStatLbl}>ZONES</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.emptyText}>Failed to load profile.</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgCanvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  title: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  segment: {
    flexDirection: 'row',
    padding: 4,
    margin: SPACING.md,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(16,16,32,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RADII.pill },
  segBtnActive: { backgroundColor: 'rgba(0,255,136,0.18)' },
  segText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  segTextActive: { color: COLORS.neonGreen },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  emptyText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.sm,
    marginBottom: 8,
    borderRadius: RADII.md,
    backgroundColor: 'rgba(16,16,32,0.9)',
    borderWidth: 1,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 20 },
  info: { flex: 1, marginLeft: SPACING.sm },
  name: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  bio: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADII.sm,
    backgroundColor: COLORS.neonGreen,
    minWidth: 90,
    alignItems: 'center',
  },
  followBtnActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.neonGreen,
  },
  followBtnText: { color: '#080811', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  followBtnTextActive: { color: COLORS.neonGreen },
  modalOverlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center' },
  card: {
    width: '80%', padding: 24, alignItems: 'center', borderRadius: 16, borderWidth: 1.5,
    borderColor: COLORS.electricBlue, backgroundColor: '#16162A',
  },
  cardAvatar: {
    width: 76, height: 76, borderRadius: 38, borderWidth: 3, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D1A',
  },
  cardName: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  cardClass: { fontSize: 11, fontWeight: '900', marginTop: 4 },
  cardBio: { color: COLORS.textMuted, fontSize: 13, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  cardStats: { flexDirection: 'row', width: '100%', justifyContent: 'space-around', marginTop: 16 },
  cardStatCol: { alignItems: 'center' },
  cardStatVal: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  cardStatLbl: { color: COLORS.textMuted, fontSize: 9, fontWeight: '800', marginTop: 2 },
});
