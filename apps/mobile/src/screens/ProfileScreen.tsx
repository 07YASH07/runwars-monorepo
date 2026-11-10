/**
 * ProfileScreen — own profile (PROFILE tab) and any user's profile
 * (root "UserProfile" route with { userId }).
 *
 * Header: cover photo, overlapping avatar, name, handle, bio, class,
 * Edit Profile / Follow, more-options menu.
 * Stats: posts · followers · following, distance, runs, territories, area, level.
 * Tabs: POSTS (grid) · ACTIVITIES · ACHIEVEMENTS (server-computed) · STATISTICS.
 *
 * Everything shown comes from the backend; nothing is fabricated client-side.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  RefreshControl,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { CHARACTER_EMOJI } from '@runwars/shared';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, errorMessage } from '@/config/api';
import { uploadPostImage } from '@/services/ImageUploadService';
import { COLORS, CLASS_THEMES, RADII, SPACING, CONTROL } from '@/theme/tokens';
import { CYBER_DARK_MAP_STYLE } from '@/theme/mapStyle';
import { ModalContainer } from '@/components/ui';
import ArenaShopSheet from '@/components/profile/ArenaShopSheet';

const SCREEN_W = Dimensions.get('window').width;
const GRID_GAP = 2;
const TILE = Math.floor((SCREEN_W - SPACING.lg * 2 - GRID_GAP * 2) / 3);

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileUser {
  id: string;
  display_name: string;
  character_type: string;
  color: string;
  bio: string;
  avatar_url: string;
  cover_image_url: string;
  coins: number;
  unlocked_colors: string[];
  selected_avatar: string | null;
  unlocked_avatars: string[];
}
interface ProfileStats { total_distance: number; total_runs: number; total_zones: number; total_territory?: number }
interface PostRow { id: string | number; content: string; image_url: string | null; post_type: string; created_at: string; likes_count: number; comments_count: number }
interface UserRow { id: string }
interface RunRow {
  id: number; distance_meters: number; activity_type: string; created_at: string;
  duration_seconds: number; pace_seconds_per_km: number | null; avg_speed_kmh: number | null;
}
interface Achievement { id: string; icon: string; title: string; description: string; progress: number; target: number; earned: boolean }

type Tab = 'posts' | 'activities' | 'achievements' | 'statistics';

// ─── Formatting helpers ──────────────────────────────────────────────────────

const fmtKm = (m: number) => (m / 1000).toFixed(m >= 100000 ? 0 : 1);
const fmtDuration = (s: number) => {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtPace = (secPerKm: number | null) => {
  if (!secPerKm || !isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
};
const fmtArea = (sqm: number) => (sqm >= 1e6 ? `${(sqm / 1e6).toFixed(2)} km²` : `${Math.round(sqm).toLocaleString()} m²`);
const ACTIVITY_ICON: Record<string, string> = { run: '🏃', walk: '🚶', cycle: '🚴' };
const handleOf = (name: string) => '@' + (name || 'runner').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { user, logout, updateLocalUser } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;

  const profileId: string | undefined = route.params?.userId || user?.uid;
  const isOwn = !!user?.uid && profileId === user.uid;
  const showBack = !!route.params?.userId;

  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [followers, setFollowers] = useState<UserRow[]>([]);
  const [following, setFollowing] = useState<UserRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [achievements, setAchievements] = useState<Achievement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('posts');

  // Viewer state for other profiles
  const [amFollowing, setAmFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  // Sheets
  const [menuOpen, setMenuOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploading, setUploading] = useState<null | { kind: 'avatar' | 'cover'; progress: number }>(null);
  const [openPost, setOpenPost] = useState<PostRow | null>(null);
  const [deletingPost, setDeletingPost] = useState(false);
  const [runDetail, setRunDetail] = useState<any | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const shotRef = useRef<any>(null);

  // ─── Data ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoadError(null);
    try {
      const [pRes, rRes, aRes, myRes] = await Promise.all([
        apiFetch(`/api/profile/${profileId}`),
        apiFetch(`/runs/${profileId}`),
        apiFetch(`/api/profile/${profileId}/achievements`),
        !isOwn && user?.uid ? apiFetch(`/api/followers/${user.uid}`) : Promise.resolve(null),
      ]);
      if (!pRes.ok) throw new Error(await errorMessage(pRes, 'Could not load this profile.'));
      const pd = await pRes.json();
      setProfile(pd.user);
      setStats(pd.stats);
      setPosts(Array.isArray(pd.posts) ? pd.posts.filter((x: PostRow) => x.post_type === 'user' || x.image_url) : []);
      setFollowers(pd.followers || []);
      setFollowing(pd.following || []);
      setRuns(rRes.ok ? await rRes.json() : []);
      setAchievements(aRes.ok ? await aRes.json() : null);
      if (myRes && myRes.ok) {
        const md = await myRes.json();
        setAmFollowing((md.following || []).some((u: UserRow) => u.id === profileId));
      }
      if (isOwn) {
        updateLocalUser({
          displayName: pd.user.display_name,
          characterType: pd.user.character_type,
          color: pd.user.color,
          photoURL: pd.user.avatar_url || null,
          selectedAvatar: pd.user.selected_avatar || undefined,
        });
      }
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load this profile.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profileId, isOwn, user?.uid, updateLocalUser]);

  // Refresh whenever the screen gains focus (e.g. after posting or a run).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  // ─── Derived ───────────────────────────────────────────────────────────────

  const totalKm = (stats?.total_distance || 0) / 1000;
  const level = Math.floor(totalKm / 5) + 1;
  const levelProgress = (totalKm % 5) / 5;
  const accent = profile?.color || COLORS.primary;
  const classMeta = CLASS_THEMES[(profile?.character_type || 'scout') as keyof typeof CLASS_THEMES] || CLASS_THEMES.scout;

  const statistics = useMemo(() => {
    const byType: Record<string, { count: number; meters: number; seconds: number }> = {};
    let longest: RunRow | null = null;
    let fastest: RunRow | null = null;
    let weekMeters = 0;
    const weekAgo = Date.now() - 7 * 864e5;
    for (const r of runs) {
      const t = r.activity_type || 'run';
      byType[t] = byType[t] || { count: 0, meters: 0, seconds: 0 };
      byType[t].count++;
      byType[t].meters += r.distance_meters || 0;
      byType[t].seconds += r.duration_seconds || 0;
      if (!longest || r.distance_meters > longest.distance_meters) longest = r;
      if (t === 'run' && r.pace_seconds_per_km && r.distance_meters >= 500 && (!fastest || r.pace_seconds_per_km < (fastest.pace_seconds_per_km || Infinity))) fastest = r;
      if (new Date(r.created_at).getTime() >= weekAgo) weekMeters += r.distance_meters || 0;
    }
    const totalSeconds = runs.reduce((s, r) => s + (r.duration_seconds || 0), 0);
    return { byType, longest, fastest, weekMeters, totalSeconds };
  }, [runs]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const toggleFollow = async () => {
    if (!profileId || followBusy) return;
    setFollowBusy(true);
    const next = !amFollowing;
    try {
      const res = await apiFetch(next ? '/api/followers/follow' : '/api/followers/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followingId: profileId }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Could not update follow.'));
      setAmFollowing(next);
      setFollowers(prev => next ? [...prev, { id: user!.uid }] : prev.filter(f => f.id !== user!.uid));
    } catch (e: any) {
      Alert.alert('Follow', e?.message || 'Could not update follow.');
    } finally {
      setFollowBusy(false);
    }
  };

  const saveProfilePatch = async (patch: Record<string, any>) => {
    const res = await apiFetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'The server rejected the update.'));
  };

  const pickImage = async (kind: 'avatar' | 'cover') => {
    if (!user?.uid || uploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos permission needed', 'Allow photo access in Settings to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [16, 9],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    setUploading({ kind, progress: 0 });
    try {
      const up = await uploadPostImage(
        { uri: a.uri, mimeType: a.mimeType, fileSize: a.fileSize },
        { userId: user.uid, kind, onProgress: (f) => setUploading({ kind, progress: f }) }
      );
      await saveProfilePatch(kind === 'avatar' ? { avatarUrl: up.url } : { coverImageUrl: up.url });
      await load();
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Could not upload the image.');
    } finally {
      setUploading(null);
    }
  };

  const removeImage = (kind: 'avatar' | 'cover') => {
    Alert.alert(kind === 'avatar' ? 'Remove profile photo?' : 'Remove cover photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await saveProfilePatch(kind === 'avatar' ? { avatarUrl: '' } : { coverImageUrl: '' });
            await load();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not remove the image.');
          }
        },
      },
    ]);
  };

  const openEdit = () => {
    setEditName(profile?.display_name || '');
    setEditBio(profile?.bio || '');
    setMenuOpen(false);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const name = editName.trim();
    if (name.length < 2) { Alert.alert('Display name', 'Use at least 2 characters.'); return; }
    setSavingEdit(true);
    try {
      await saveProfilePatch({ displayName: name, bio: editBio.trim() });
      setEditOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmLogout = () => {
    setMenuOpen(false);
    // Let the menu sheet finish closing before the native alert opens.
    setTimeout(() => {
      Alert.alert('Log out?', 'You can log back in at any time. Your runs and posts are kept.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: () => { logout().catch(() => Alert.alert('Error', 'Logout failed. Please try again.')); } },
      ]);
    }, 250);
  };

  const deletePost = (p: PostRow) => {
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingPost(true);
          try {
            const res = await apiFetch(`/api/posts/${p.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await errorMessage(res, 'Could not delete the post.'));
            setOpenPost(null);
            setPosts(prev => prev.filter(x => x.id !== p.id));
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not delete the post.');
          } finally {
            setDeletingPost(false);
          }
        },
      },
    ]);
  };

  const openRun = async (r: RunRow) => {
    setRunDetail({ loadingFor: r });
    setRunDetailLoading(true);
    try {
      const res = await apiFetch(`/runs/details/${r.id}`);
      if (!res.ok) throw new Error(await errorMessage(res, 'Could not load this activity.'));
      setRunDetail(await res.json());
    } catch (e: any) {
      setRunDetail(null);
      Alert.alert('Activity', e?.message || 'Could not load this activity.');
    } finally {
      setRunDetailLoading(false);
    }
  };

  const shareRun = async () => {
    try {
      const uri = await shotRef.current?.capture?.();
      if (uri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { dialogTitle: 'Share activity', mimeType: 'image/jpeg' });
      }
    } catch (e: any) {
      Alert.alert('Share', e?.message || 'Could not share this activity.');
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!profileId) return null;

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (loadError && !profile) {
    return (
      <View style={[styles.center, { paddingTop: insets.top, padding: SPACING.xl }]}>
        <Text style={styles.errorTitle}>Profile unavailable</Text>
        <Text style={styles.errorBody}>{loadError}</Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: SPACING.lg }]} onPress={() => { setLoading(true); load(); }}>
          <Text style={styles.btnPrimaryText}>Try again</Text>
        </TouchableOpacity>
        {showBack && (
          <TouchableOpacity style={[styles.btn, styles.btnOutline, { marginTop: SPACING.sm }]} onPress={() => navigation.goBack()}>
            <Text style={styles.btnOutlineText}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const p = profile!;
  const avatarFallback = p.selected_avatar || (CHARACTER_EMOJI as any)[p.character_type] || '🏃';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: (tabBarHeight ? 0 : insets.bottom) + SPACING.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover */}
        <View style={styles.coverWrap}>
          {p.cover_image_url ? (
            <Image source={{ uri: p.cover_image_url }} style={styles.cover} resizeMode="cover" testID="profile-cover-image" />
          ) : (
            <View style={[styles.cover, { backgroundColor: accent + '33' }]} />
          )}
          <View style={styles.coverShade} />
          <View style={[styles.topBar, { top: insets.top + 6 }]}>
            {showBack ? (
              <TouchableOpacity style={styles.roundBtn} onPress={() => navigation.goBack()} testID="profile-back" accessibilityLabel="Back">
                <Text style={styles.roundBtnText}>‹</Text>
              </TouchableOpacity>
            ) : <View />}
            {isOwn && (
              <TouchableOpacity style={styles.roundBtn} onPress={() => setMenuOpen(true)} testID="profile-more" accessibilityLabel="More options">
                <Text style={styles.roundBtnText}>⋯</Text>
              </TouchableOpacity>
            )}
          </View>
          {isOwn && (
            <TouchableOpacity
              style={styles.coverEdit}
              onPress={() => pickImage('cover')}
              onLongPress={() => p.cover_image_url && removeImage('cover')}
              disabled={!!uploading}
              testID="profile-cover-edit"
            >
              <Text style={styles.coverEditText}>
                {uploading?.kind === 'cover' ? `Uploading ${Math.round(uploading.progress * 100)}%` : '📷 Cover'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.avatarRow}>
            <TouchableOpacity
              activeOpacity={isOwn ? 0.8 : 1}
              onPress={() => isOwn && pickImage('avatar')}
              onLongPress={() => isOwn && p.avatar_url && removeImage('avatar')}
              disabled={!isOwn || !!uploading}
              testID="profile-avatar-edit"
            >
              <View style={[styles.avatar, { borderColor: accent }]}>
                {p.avatar_url ? (
                  <Image source={{ uri: p.avatar_url }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarEmoji}>{avatarFallback}</Text>
                )}
                {uploading?.kind === 'avatar' && (
                  <View style={styles.avatarUploading}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.avatarUploadingText}>{Math.round(uploading.progress * 100)}%</Text>
                  </View>
                )}
              </View>
              {isOwn && <View style={[styles.avatarBadge, { backgroundColor: accent }]}><Text style={styles.avatarBadgeText}>📷</Text></View>}
            </TouchableOpacity>

            <View style={styles.headerActions}>
              {isOwn ? (
                <>
                  <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={openEdit} testID="profile-edit">
                    <Text style={styles.btnOutlineText}>Edit profile</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, styles.btnOutline, styles.btnIcon]} onPress={() => setShopOpen(true)} testID="profile-shop" accessibilityLabel="Arena shop">
                    <Text style={styles.btnOutlineText}>🪙 {p.coins ?? 0}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.btn, amFollowing ? styles.btnOutline : styles.btnPrimary, { minWidth: 120 }]}
                  onPress={toggleFollow}
                  disabled={followBusy}
                  testID="profile-follow"
                >
                  {followBusy ? <ActivityIndicator size="small" color={amFollowing ? COLORS.primary : COLORS.textInverse} /> :
                    <Text style={amFollowing ? styles.btnOutlineText : styles.btnPrimaryText}>{amFollowing ? 'Following' : 'Follow'}</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.name} numberOfLines={1}>{p.display_name}</Text>
          <Text style={styles.handle}>{handleOf(p.display_name)}</Text>
          {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : isOwn ? (
            <TouchableOpacity onPress={openEdit}><Text style={styles.bioPlaceholder}>Add a bio</Text></TouchableOpacity>
          ) : null}
          <View style={[styles.classChip, { borderColor: classMeta.color + '88' }]}>
            <Text style={[styles.classChipText, { color: classMeta.color }]}>{classMeta.emoji}  {classMeta.name} · Level {level}</Text>
          </View>
          <View style={styles.levelTrack}><View style={[styles.levelFill, { width: `${Math.max(2, levelProgress * 100)}%`, backgroundColor: accent }]} /></View>
          <Text style={styles.levelHint}>{(5 - (totalKm % 5)).toFixed(1)} km to level {level + 1}</Text>
        </View>

        {/* Social counts */}
        <View style={styles.socialRow}>
          <TouchableOpacity style={styles.socialCell} onPress={() => setTab('posts')} testID="profile-stat-posts">
            <Text style={styles.socialVal}>{posts.length}</Text>
            <Text style={styles.socialLbl}>Posts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.socialCell}
            onPress={() => navigation.navigate('FollowersList', { userId: p.id, tab: 'followers', displayName: p.display_name })}
            testID="profile-stat-followers"
          >
            <Text style={styles.socialVal}>{followers.length}</Text>
            <Text style={styles.socialLbl}>Followers</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.socialCell}
            onPress={() => navigation.navigate('FollowersList', { userId: p.id, tab: 'following', displayName: p.display_name })}
            testID="profile-stat-following"
          >
            <Text style={styles.socialVal}>{following.length}</Text>
            <Text style={styles.socialLbl}>Following</Text>
          </TouchableOpacity>
        </View>

        {/* Performance stats */}
        <View style={styles.statGrid}>
          <StatTile label="Distance" value={`${fmtKm(stats?.total_distance || 0)} km`} />
          <StatTile label="Activities" value={String(stats?.total_runs || 0)} />
          <StatTile label="Territories" value={String(stats?.total_zones || 0)} />
          <StatTile label="Area held" value={fmtArea(stats?.total_territory || 0)} />
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {([
            ['posts', 'POSTS'], ['activities', 'ACTIVITIES'], ['achievements', 'ACHIEVEMENTS'], ['statistics', 'STATISTICS'],
          ] as [Tab, string][]).map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.tab, tab === key && { borderBottomColor: accent }]} onPress={() => setTab(key)} testID={`profile-tab-${key}`}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.tabBody}>
          {tab === 'posts' && (posts.length === 0 ? (
            <Empty icon="📷" title="No posts yet" body={isOwn ? 'Share your first post from Community → Feed.' : 'Nothing shared yet.'} />
          ) : (
            <View style={styles.grid}>
              {posts.map((post) => (
                <TouchableOpacity key={String(post.id)} style={styles.tile} onPress={() => setOpenPost(post)} testID={`profile-post-${post.id}`}>
                  {post.image_url ? (
                    <Image source={{ uri: post.image_url }} style={styles.tileImg} />
                  ) : (
                    <View style={[styles.tileText, { backgroundColor: COLORS.bgCard }]}>
                      <Text style={styles.tileTextBody} numberOfLines={5}>{post.content}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {tab === 'activities' && (runs.length === 0 ? (
            <Empty icon="🏃" title="No activities yet" body={isOwn ? 'Start a run from the RUN tab.' : 'No recorded activities.'} />
          ) : runs.map((r) => (
            <TouchableOpacity key={r.id} style={styles.runCard} onPress={() => openRun(r)} testID={`profile-run-${r.id}`}>
              <Text style={styles.runIcon}>{ACTIVITY_ICON[r.activity_type] || '🏃'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.runTitle}>{fmtKm(r.distance_meters)} km {r.activity_type === 'cycle' ? 'ride' : r.activity_type}</Text>
                <Text style={styles.runMeta}>
                  {new Date(r.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                  {'  ·  '}{fmtDuration(r.duration_seconds)}
                  {'  ·  '}{r.activity_type === 'cycle' ? (r.avg_speed_kmh ? `${r.avg_speed_kmh} km/h` : '—') : fmtPace(r.pace_seconds_per_km)}
                </Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </TouchableOpacity>
          )))}

          {tab === 'achievements' && (achievements === null ? (
            <Empty icon="🏆" title="Achievements unavailable" body="Pull down to retry." />
          ) : (
            <View style={styles.achGrid}>
              {achievements.map((a) => (
                <View key={a.id} style={[styles.achCard, a.earned && { borderColor: accent }]}>
                  <Text style={[styles.achIcon, !a.earned && { opacity: 0.35 }]}>{a.icon}</Text>
                  <Text style={styles.achTitle}>{a.title}</Text>
                  <Text style={styles.achDesc}>{a.description}</Text>
                  <View style={styles.achTrack}>
                    <View style={[styles.achFill, { width: `${Math.min(100, (a.progress / a.target) * 100)}%`, backgroundColor: a.earned ? accent : COLORS.textMuted }]} />
                  </View>
                  <Text style={[styles.achState, a.earned && { color: accent }]}>
                    {a.earned ? 'Earned' : `${Math.min(a.progress, a.target)} / ${a.target}`}
                  </Text>
                </View>
              ))}
            </View>
          ))}

          {tab === 'statistics' && (
            <View>
              <View style={styles.statGrid}>
                <StatTile label="This week" value={`${fmtKm(statistics.weekMeters)} km`} />
                <StatTile label="Total time" value={fmtDuration(statistics.totalSeconds)} />
                <StatTile label="Longest" value={statistics.longest ? `${fmtKm(statistics.longest.distance_meters)} km` : '—'} />
                <StatTile label="Best run pace" value={statistics.fastest ? fmtPace(statistics.fastest.pace_seconds_per_km) : '—'} />
              </View>
              <Text style={styles.sectionLabel}>BY ACTIVITY</Text>
              {(['run', 'walk', 'cycle'] as const).map((t) => {
                const s = statistics.byType[t];
                return (
                  <View key={t} style={styles.breakdownRow}>
                    <Text style={styles.breakdownIcon}>{ACTIVITY_ICON[t]}</Text>
                    <Text style={styles.breakdownName}>{t === 'cycle' ? 'Bike' : t[0].toUpperCase() + t.slice(1)}</Text>
                    <Text style={styles.breakdownVal}>{s ? `${s.count} · ${fmtKm(s.meters)} km · ${fmtDuration(s.seconds)}` : 'No activities'}</Text>
                  </View>
                );
              })}
              <Text style={styles.footnote}>Statistics cover your 50 most recent activities. Battle win records are not stored by the server yet, so they are not shown.</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* More-options menu */}
      <ModalContainer visible={menuOpen} onClose={() => setMenuOpen(false)} title="Profile options">
        <MenuItem icon="✏️" label="Edit profile" onPress={openEdit} testID="menu-edit" />
        <MenuItem icon="🪙" label="Arena shop · class · colours" onPress={() => { setMenuOpen(false); setShopOpen(true); }} testID="menu-shop" />
        <MenuItem icon="🖼️" label="Change cover photo" onPress={() => { setMenuOpen(false); pickImage('cover'); }} />
        <MenuItem icon="👤" label="Change profile photo" onPress={() => { setMenuOpen(false); pickImage('avatar'); }} />
        {!!p.cover_image_url && <MenuItem icon="🗑️" label="Remove cover photo" onPress={() => { setMenuOpen(false); removeImage('cover'); }} />}
        {!!p.avatar_url && <MenuItem icon="🗑️" label="Remove profile photo" onPress={() => { setMenuOpen(false); removeImage('avatar'); }} />}
        <MenuItem icon="↪️" label="Log out" danger onPress={confirmLogout} testID="menu-logout" />
      </ModalContainer>

      {/* Edit profile */}
      <ModalContainer visible={editOpen} onClose={() => setEditOpen(false)} title="Edit profile">
        <Text style={styles.inputLabel}>Display name</Text>
        <TextInput style={styles.input} value={editName} onChangeText={setEditName} maxLength={40} placeholder="Your name" placeholderTextColor={COLORS.textMuted} testID="edit-name" />
        <Text style={[styles.inputLabel, { marginTop: SPACING.md }]}>Bio</Text>
        <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} value={editBio} onChangeText={setEditBio} maxLength={160} multiline placeholder="Tell runners about yourself" placeholderTextColor={COLORS.textMuted} testID="edit-bio" />
        <Text style={styles.counter}>{editBio.length}/160</Text>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary, styles.btnBlock]} onPress={saveEdit} disabled={savingEdit} testID="edit-save">
          {savingEdit ? <ActivityIndicator color={COLORS.textInverse} /> : <Text style={styles.btnPrimaryText}>Save changes</Text>}
        </TouchableOpacity>
      </ModalContainer>

      {/* Post viewer */}
      <ModalContainer visible={!!openPost} onClose={() => setOpenPost(null)} title="Post">
        {openPost && (
          <View>
            {openPost.image_url ? <Image source={{ uri: openPost.image_url }} style={styles.postImg} resizeMode="cover" /> : null}
            {!!openPost.content && <Text style={styles.postText}>{openPost.content}</Text>}
            <Text style={styles.postMeta}>❤️ {openPost.likes_count || 0}   💬 {openPost.comments_count || 0}   ·   {new Date(openPost.created_at).toLocaleString()}</Text>
            {isOwn && (
              <TouchableOpacity style={[styles.btn, styles.btnDanger, styles.btnBlock]} onPress={() => deletePost(openPost)} disabled={deletingPost} testID="post-delete">
                {deletingPost ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerText}>Delete post</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      </ModalContainer>

      {/* Activity detail */}
      <ModalContainer visible={!!runDetail} onClose={() => setRunDetail(null)} title="Activity">
        {runDetailLoading || !runDetail || runDetail.loadingFor ? (
          <View style={{ paddingVertical: 40 }}><ActivityIndicator color={COLORS.primary} /></View>
        ) : (
          <View>
            <ViewShot ref={shotRef} options={{ format: 'jpg', quality: 0.9 }} style={{ backgroundColor: COLORS.bgSurface }}>
              {runDetail.route_visible && runDetail.route_points?.length > 1 ? (
                <View style={styles.routeMap}>
                  <MapView
                    provider={PROVIDER_GOOGLE}
                    style={StyleSheet.absoluteFill}
                    customMapStyle={CYBER_DARK_MAP_STYLE}
                    initialRegion={regionFor(runDetail.route_points)}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                  >
                    <Polyline coordinates={runDetail.route_points} strokeColor={accent} strokeWidth={5} />
                  </MapView>
                </View>
              ) : (
                <View style={[styles.routeMap, styles.center]}>
                  <Text style={styles.routePrivate}>{runDetail.route_visible ? 'Not enough GPS points for a route preview.' : '🔒 Routes are private to their owner.'}</Text>
                </View>
              )}
              <View style={[styles.statGrid, { marginHorizontal: 0 }]}>
                <StatTile label="Distance" value={`${fmtKm(runDetail.distance_meters)} km`} />
                <StatTile label="Duration" value={fmtDuration(runDetail.duration_seconds)} />
                <StatTile label={runDetail.activity_type === 'cycle' ? 'Avg speed' : 'Avg pace'} value={runDetail.activity_type === 'cycle' ? (runDetail.avg_speed_kmh ? `${runDetail.avg_speed_kmh} km/h` : '—') : fmtPace(runDetail.pace_seconds_per_km)} />
                <StatTile label="Date" value={new Date(runDetail.created_at).toLocaleDateString()} />
              </View>
            </ViewShot>
            {runDetail.route_visible && (
              <TouchableOpacity style={[styles.btn, styles.btnPrimary, styles.btnBlock]} onPress={shareRun} testID="run-share">
                <Text style={styles.btnPrimaryText}>Share activity</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ModalContainer>

      {isOwn && (
        <ArenaShopSheet
          visible={shopOpen}
          onClose={() => setShopOpen(false)}
          coins={p.coins ?? 0}
          totalKm={totalKm}
          characterType={p.character_type}
          color={p.color}
          selectedAvatar={p.selected_avatar}
          unlockedAvatars={p.unlocked_avatars || []}
          unlockedColors={p.unlocked_colors || []}
          onChanged={(patch) => {
            if (patch?.characterType || patch?.color) {
              updateLocalUser({ ...(patch.characterType ? { characterType: patch.characterType } : {}), ...(patch.color ? { color: patch.color } : {}) });
            }
            load();
          }}
        />
      )}
    </View>
  );
}

function regionFor(points: { latitude: number; longitude: number }[]) {
  const lats = points.map(p => p.latitude), lngs = points.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.004, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(0.004, (maxLng - minLng) * 1.6),
  };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statVal} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function MenuItem({ icon, label, onPress, danger, testID }: { icon: string; label: string; onPress: () => void; danger?: boolean; testID?: string }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} testID={testID}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={[styles.menuLabel, danger && { color: COLORS.crimson }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgCanvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgCanvas },
  errorTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  errorBody: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 6 },

  coverWrap: { height: 190, backgroundColor: COLORS.bgSurface },
  cover: { width: '100%', height: '100%' },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,18,32,0.25)' },
  topBar: { position: 'absolute', left: SPACING.lg, right: SPACING.lg, flexDirection: 'row', justifyContent: 'space-between' },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(11,18,32,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  roundBtnText: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700', marginTop: -2 },
  coverEdit: { position: 'absolute', right: SPACING.lg, bottom: SPACING.md, backgroundColor: 'rgba(11,18,32,0.75)', borderRadius: RADII.pill, paddingHorizontal: 14, height: 34, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  coverEditText: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700' },

  identity: { paddingHorizontal: SPACING.lg },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -46 },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, backgroundColor: COLORS.bgCard, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarEmoji: { fontSize: 46 },
  avatarUploading: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  avatarUploadingText: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 2 },
  avatarBadge: { position: 'absolute', right: 0, bottom: 2, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.bgCanvas },
  avatarBadgeText: { fontSize: 13 },
  headerActions: { flexDirection: 'row', gap: SPACING.sm, marginBottom: 4 },
  name: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', marginTop: SPACING.md },
  handle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 2 },
  bio: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20, marginTop: SPACING.sm },
  bioPlaceholder: { color: COLORS.secondary, fontSize: 14, marginTop: SPACING.sm, fontWeight: '600' },
  classChip: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADII.pill, paddingHorizontal: 12, paddingVertical: 5, marginTop: SPACING.md },
  classChipText: { fontSize: 12, fontWeight: '700' },
  levelTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.bgSurfaceElevated, marginTop: SPACING.sm, overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 3 },
  levelHint: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },

  socialRow: { flexDirection: 'row', marginHorizontal: SPACING.lg, marginTop: SPACING.lg, backgroundColor: COLORS.bgCard, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border },
  socialCell: { flex: 1, alignItems: 'center', paddingVertical: SPACING.md },
  socialVal: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  socialLbl: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.md },
  statTile: { flexBasis: '47%', flexGrow: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border, paddingVertical: SPACING.md, paddingHorizontal: SPACING.md },
  statVal: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' },
  statLbl: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  tabs: { flexDirection: 'row', marginTop: SPACING.xl, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: SPACING.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  tabTextActive: { color: COLORS.textPrimary },
  tabBody: { paddingTop: SPACING.md },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, paddingHorizontal: SPACING.lg },
  tile: { width: TILE, height: TILE, overflow: 'hidden', borderRadius: 4 },
  tileImg: { width: '100%', height: '100%' },
  tileText: { flex: 1, padding: 8, justifyContent: 'center' },
  tileTextBody: { color: COLORS.textPrimary, fontSize: 11, lineHeight: 15 },

  runCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, backgroundColor: COLORS.bgCard, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, minHeight: 64 },
  runIcon: { fontSize: 24, marginRight: SPACING.md },
  runTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  runMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  chev: { color: COLORS.textMuted, fontSize: 24, marginLeft: SPACING.sm },

  achGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  achCard: { width: (SCREEN_W - SPACING.lg * 2 - SPACING.sm) / 2 - 0.5, backgroundColor: COLORS.bgCard, borderRadius: RADII.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  achIcon: { fontSize: 26 },
  achTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 6 },
  achDesc: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, minHeight: 32 },
  achTrack: { height: 4, borderRadius: 2, backgroundColor: COLORS.bgSurfaceElevated, marginTop: SPACING.sm, overflow: 'hidden' },
  achFill: { height: '100%' },
  achState: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginTop: 4 },

  sectionLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginHorizontal: SPACING.lg, marginTop: SPACING.xl, marginBottom: SPACING.sm },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  breakdownIcon: { fontSize: 20, width: 32 },
  breakdownName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', width: 64 },
  breakdownVal: { color: COLORS.textSecondary, fontSize: 13, flex: 1, textAlign: 'right' },
  footnote: { color: COLORS.textMuted, fontSize: 11, marginHorizontal: SPACING.lg, marginTop: SPACING.md, lineHeight: 16 },

  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: SPACING.xl },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginTop: SPACING.sm },
  emptyBody: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },

  btn: { height: CONTROL.md, paddingHorizontal: SPACING.lg, borderRadius: RADII.sm, alignItems: 'center', justifyContent: 'center' },
  btnBlock: { marginTop: SPACING.lg, height: CONTROL.lg },
  btnIcon: { paddingHorizontal: SPACING.md },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { color: COLORS.textInverse, fontSize: 15, fontWeight: '800' },
  btnOutline: { borderWidth: 1, borderColor: COLORS.borderMedium, backgroundColor: COLORS.bgCard },
  btnOutlineText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  btnDanger: { backgroundColor: COLORS.crimson },
  btnDangerText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  menuItem: { flexDirection: 'row', alignItems: 'center', minHeight: CONTROL.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  menuIcon: { fontSize: 18, width: 36 },
  menuLabel: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' },

  inputLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm, color: COLORS.textPrimary, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  counter: { color: COLORS.textMuted, fontSize: 11, textAlign: 'right', marginTop: 4 },

  postImg: { width: '100%', aspectRatio: 1, borderRadius: RADII.md, backgroundColor: COLORS.bgCard },
  postText: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 21, marginTop: SPACING.md },
  postMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: SPACING.sm },

  routeMap: { height: 220, borderRadius: RADII.md, overflow: 'hidden', backgroundColor: COLORS.bgCard },
  routePrivate: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: SPACING.lg },
});
