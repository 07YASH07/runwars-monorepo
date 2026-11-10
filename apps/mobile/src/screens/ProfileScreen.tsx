/**
 * ProfileScreen — RPG Character & Arena Shop for StrideClash.
 *
 * Combines:
 * - Cyberpunk Hero Character Card (Level, XP, Class Archetype, Arena Coins)
 * - Class Archetype Selector (Scout ⚡, Warrior ⚔️, Titan 🛡️, Ghost 👻) with ability descriptions
 * - RPG Arena Shop (Milestone avatars, Premium avatars, Neon territory colors)
 * - Run History with interactive Route Preview modal & Social Sharing
 * - Profile Customization (Bio, Display Name, Territory Color)
 * - Account Logout
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  Image,
  TextInput,
  Platform,
  FlatList,
  Dimensions,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import {
  COLORS,
  CLASS_THEMES,
  SPACING,
  RADII,
  SHADOWS,
} from '@/theme/tokens';
import { CYBER_DARK_MAP_STYLE } from '@/theme/mapStyle';
import {
  GameButton,
  GlassCard,
  StatBadge,
  PlayerAvatar,
  ProgressBar,
  ModalContainer,
} from '@/components/ui';
import { apiFetch } from '@/config/api';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { uploadPostImage } from '@/services/ImageUploadService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ProfileStats {
  total_runs: number;
  total_distance: number;
  total_territory: number;
  display_name: string;
  character_type: string;
  color: string;
  bio: string;
  avatar_url: string;
  cover_image_url?: string;
  coins?: number;
  unlocked_colors?: string[];
  selected_avatar?: string;
  unlocked_avatars?: string[];
}

interface RunEntry {
  id: number;
  distance_meters: number;
  created_at: string;
  activity_type?: string;
}

const MILESTONE_AVATARS = [
  { avatar: '🦊', name: 'Swift Fox', requiredKm: 5 },
  { avatar: '🐺', name: 'Lone Wolf', requiredKm: 10 },
  { avatar: '🦁', name: 'Apex Lion', requiredKm: 25 },
  { avatar: '🦅', name: 'Sky Eagle', requiredKm: 50 },
  { avatar: '🐉', name: 'Void Dragon', requiredKm: 100 },
];

const PREMIUM_AVATARS = [
  { avatar: '🤖', name: 'Cyborg V1', cost: 150 },
  { avatar: '🦄', name: 'Prism Horn', cost: 150 },
  { avatar: '👾', name: 'Pixel Ghost', cost: 150 },
  { avatar: '⚡', name: 'Volt Walker', cost: 150 },
  { avatar: '🌟', name: 'Supernova', cost: 150 },
];

const SHOP_COLORS = [
  { name: 'Neon Green', hex: '#00FF88' },
  { name: 'Sky Blue', hex: '#00BFFF' },
  { name: 'Cyber Purple', hex: '#9D00FF' },
  { name: 'Arena Gold', hex: '#FFD700' },
  { name: 'Crimson Red', hex: '#FF2A55' },
  { name: 'Cyan Splash', hex: '#00FFFF' },
];

export default function ProfileScreen() {
  const { user, setCharacterAndColor, logout } = useAuth();
  const navigation = useNavigation<any>();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'rpgShop' | 'runs' | 'achievements' | 'posts'>('rpgShop');
  // Instagram-style social counts + content for the current user.
  const [posts, setPosts] = useState<any[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // Edit Profile State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Run Details & Route Map State
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const viewShotRef = useRef<any>(null);

  // Fetch Profile Data
  const fetchProfile = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [profileRes, runsRes] = await Promise.all([
        apiFetch(`/api/profile/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
        apiFetch(`/runs/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
      ]);
      const profileData = await profileRes.json();
      const runsData = await runsRes.json();

      setStats({ ...profileData.user, ...profileData.stats });
      setRuns(runsData || []);
      setPosts(Array.isArray(profileData.posts) ? profileData.posts : []);
      setFollowersCount(Array.isArray(profileData.followers) ? profileData.followers.length : 0);
      setFollowingCount(Array.isArray(profileData.following) ? profileData.following.length : 0);

      setEditDisplayName(profileData.user?.display_name || user.displayName || 'Runner');
      setEditBio(profileData.user?.bio || '');
    } catch (err) {
      console.error('[Profile] Fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Level & XP Calculation
  const levelData = useMemo(() => {
    const totalKm = (stats?.total_distance || 0) / 1000;
    const level = Math.floor(totalKm / 5) + 1;
    const currentLevelProgressKm = totalKm % 5;
    const progressPercent = currentLevelProgressKm / 5;
    return {
      level,
      currentKm: currentLevelProgressKm.toFixed(1),
      nextLevelKm: '5.0',
      totalKm: totalKm.toFixed(1),
      progressPercent,
    };
  }, [stats?.total_distance]);

  // Handle Class Switch
  const handleSelectClass = async (classKey: CharacterType) => {
    if (!user?.uid) return;
    const theme = CLASS_THEMES[classKey as keyof typeof CLASS_THEMES];
    try {
      const res = await apiFetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          characterType: classKey,
          color: theme ? theme.color : user.color,
        }),
      });
      if (res.ok) {
        if (setCharacterAndColor) {
          setCharacterAndColor(classKey, (theme ? theme.color : user.color) || COLORS.neonGreen);
        }
        Alert.alert('Class Activated!', `Switched to ${theme.name}! Perk: ${theme.bonus}`);
        fetchProfile();
      }
    } catch (e) {
      Alert.alert('Error', 'Could not update class archetype.');
    }
  };

  // Handle Equip Avatar
  const handleEquipAvatar = async (avatar: string) => {
    if (!user?.uid) return;
    try {
      const res = await apiFetch('/api/shop/set-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, avatar }),
      });
      if (res.ok) {
        Alert.alert('Equipped!', `${avatar} is now your active companion avatar!`);
        fetchProfile();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to equip avatar.');
    }
  };

  // Handle Unlock Premium Avatar
  const handleUnlockAvatar = async (avatar: string, cost: number) => {
    if (!user?.uid) return;
    const coins = stats?.coins ?? 0;
    if (coins < cost) {
      Alert.alert('Need More Coins', `This companion costs ${cost} Arena Coins. You have ${coins}.`);
      return;
    }
    try {
      const res = await apiFetch('/api/shop/unlock-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, avatar }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('🎉 Avatar Unlocked!', `${avatar} companion acquired!`);
        fetchProfile();
      } else {
        Alert.alert('Error', data.error || 'Failed to unlock.');
      }
    } catch (e) {
      Alert.alert('Network Error', 'Could not connect to Arena Shop.');
    }
  };

  // Handle Unlock Color
  const handleUnlockColor = async (colorHex: string) => {
    if (!user?.uid) return;
    const coins = stats?.coins ?? 0;
    if (coins < 200) {
      Alert.alert('Need More Coins', 'Unlocking premium territory color costs 200 Arena Coins.');
      return;
    }
    try {
      const res = await apiFetch('/api/shop/unlock-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, color: colorHex }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Unlocked!', `Unlocked color ${colorHex}!`);
        fetchProfile();
      } else {
        Alert.alert('Error', data.error || 'Failed to unlock color.');
      }
    } catch (e) {
      Alert.alert('Network Error', 'Failed to purchase color.');
    }
  };

  // View Past Run Route Details
  const handleViewRun = async (runId: number) => {
    setLoadingDetail(true);
    setDetailModalVisible(true);
    setSelectedRun(null);
    try {
      const res = await apiFetch(`/runs/details/${runId}`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedRun(data);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to load route preview.');
      setDetailModalVisible(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleShareRun = async () => {
    try {
      if (viewShotRef.current && viewShotRef.current.capture) {
        const uri = await viewShotRef.current.capture();
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(uri, {
            dialogTitle: 'Share StrideClash Run',
            mimeType: 'image/jpeg',
          });
        }
      }
    } catch (err) {
      console.error('Sharing failed:', err);
    }
  };

  // Profile image uploads — reuse ImageUploadService (Firebase Storage) and
  // the existing /api/profile/update endpoint, which already accepts
  // `avatarUrl` and `coverImageUrl`. The server writes to users.avatar_url
  // and users.cover_image_url (both columns already in schema).
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const pickAndUploadProfileImage = async (kind: 'avatar' | 'cover') => {
    if (!user?.uid) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Access to your photos is needed to pick an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [16, 9],
      quality: 0.8,
    });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    const a = result.assets[0];

    const setBusy = kind === 'avatar' ? setUploadingAvatar : setUploadingCover;
    setBusy(true);
    try {
      const uploaded = await uploadPostImage(
        { uri: a.uri, mimeType: (a as any).mimeType, fileSize: (a as any).fileSize },
        { userId: user.uid, kind: kind === 'avatar' ? 'avatar' : 'cover' }
      );
      const patch = kind === 'avatar' ? { avatarUrl: uploaded.url } : { coverImageUrl: uploaded.url };
      const res = await apiFetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, ...patch }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Server rejected the profile update');
      }
      await fetchProfile();
      Alert.alert('Saved', kind === 'avatar' ? 'Profile picture updated.' : 'Cover photo updated.');
    } catch (e: any) {
      console.error('[Profile] image upload failed:', e);
      Alert.alert('Upload failed', e?.message || 'Could not upload the image. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeProfileImage = async (kind: 'avatar' | 'cover') => {
    if (!user?.uid) return;
    Alert.alert(
      kind === 'avatar' ? 'Remove profile picture?' : 'Remove cover photo?',
      'The default design will be shown instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const setBusy = kind === 'avatar' ? setUploadingAvatar : setUploadingCover;
            setBusy(true);
            try {
              const patch = kind === 'avatar' ? { avatarUrl: '' } : { coverImageUrl: '' };
              const res = await apiFetch('/api/profile/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.uid, ...patch }),
              });
              if (!res.ok) throw new Error('Server rejected the update');
              await fetchProfile();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not remove the image.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  // Save Profile Details
  const handleSaveProfile = async () => {
    if (!user?.uid) return;
    setSavingProfile(true);
    try {
      const res = await apiFetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          displayName: editDisplayName,
          bio: editBio,
        }),
      });
      if (res.ok) {
        Alert.alert('Saved', 'Profile updated successfully!');
        setEditModalVisible(false);
        fetchProfile();
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out of StrideClash?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          // ROOT CAUSE FIX (2026-11-10): previously called
          //   signOut(auth)  ← Firebase Auth
          // which never touched the actual session (JWT in SecureStore +
          // user object in AsyncStorage + AuthContext.user state). The
          // Alert closed, Firebase cleared a session we weren't using,
          // and the user remained logged in. Fix: call the real
          // AuthContext.logout() which clears every store and resets state.
          try {
            try {
              const { socketService } = require('@/services/SocketService');
              socketService.disconnect();
            } catch { /* socket may already be disconnected — non-fatal */ }
            // Also sign out of Firebase Auth defensively, in case a user
            // used Google sign-in; swallow errors because most logins
            // never touched Firebase Auth at all.
            try { await signOut(auth); } catch { /* not-signed-in is fine */ }
            await logout();
          } catch (e: any) {
            console.error('[ProfileScreen] logout failed:', e);
            Alert.alert('Error', 'Failed to log out. Please try again.');
          }
        },
      },
    ]);
  };

  const playerClass = (stats?.character_type || user?.characterType || 'scout') as keyof typeof CLASS_THEMES;
  const currentClassMeta = CLASS_THEMES[playerClass] || CLASS_THEMES.scout;
  const activeColor = stats?.color || user?.color || COLORS.neonGreen;
  const unlockedAvatars = stats?.unlocked_avatars || ['🏃', '⚡'];
  const unlockedColors = stats?.unlocked_colors || [activeColor];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Screen Header ── */}
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>VANGUARD PROFILE</Text>
          <Text style={styles.screenSub}>RPG PROGRESSION & SHOP</Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => setEditModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.settingsBtnText}>✏️ EDIT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Text style={styles.logoutBtnText}>LOGOUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── Cover photo banner (Instagram-style) ── */}
        <View style={styles.coverWrap}>
          {stats?.cover_image_url ? (
            <Image
              source={{ uri: stats.cover_image_url }}
              style={styles.coverImage}
              resizeMode="cover"
              testID="profile-cover-image"
            />
          ) : (
            <View style={[styles.coverImage, styles.coverFallback, { backgroundColor: activeColor + '22', borderColor: activeColor + '44' }]}>
              <Text style={styles.coverFallbackText}>Tap ✎ to add a cover photo</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.coverEditBtn}
            onPress={() => pickAndUploadProfileImage('cover')}
            disabled={uploadingCover}
            testID="profile-cover-edit"
          >
            {uploadingCover
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Text style={styles.coverEditBtnText}>✎  COVER</Text>}
          </TouchableOpacity>
          {!!stats?.cover_image_url && !uploadingCover && (
            <TouchableOpacity
              style={styles.coverRemoveBtn}
              onPress={() => removeProfileImage('cover')}
              testID="profile-cover-remove"
            >
              <Text style={styles.coverRemoveBtnText}>REMOVE</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Hero Character Card ── */}
        <GlassCard style={styles.heroCard} variant="neonBorder" glow>
          <View style={styles.heroTopRow}>
            <View style={styles.avatarWithEdit}>
              <PlayerAvatar
                avatarUrl={stats?.avatar_url}
                selectedAvatar={stats?.selected_avatar || user?.selectedAvatar}
                characterType={playerClass}
                color={activeColor}
                level={levelData.level}
                size="lg"
              />
              <TouchableOpacity
                style={[styles.avatarEditBtn, { backgroundColor: activeColor }]}
                onPress={() => pickAndUploadProfileImage('avatar')}
                disabled={uploadingAvatar}
                testID="profile-avatar-edit"
              >
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color="#080811" />
                  : <Text style={styles.avatarEditBtnText}>📷</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.heroInfoCol}>
              <View style={styles.nameRow}>
                <Text style={styles.heroDisplayName}>
                  {stats?.display_name || user?.displayName || 'Vanguard Runner'}
                </Text>
              </View>

              <View style={[styles.classPill, { borderColor: currentClassMeta.color }]}>
                <Text style={styles.classEmoji}>{currentClassMeta.emoji}</Text>
                <Text style={[styles.classTitle, { color: currentClassMeta.color }]}>
                  {currentClassMeta.name.toUpperCase()} · {currentClassMeta.subtitle.toUpperCase()}
                </Text>
              </View>

              <Text style={styles.heroBio} numberOfLines={2}>
                {stats?.bio || 'Conquering sectors across the city with real-world stamina.'}
              </Text>
            </View>

            {/* Arena Coins Pill */}
            <View style={styles.coinBadge}>
              <Text style={styles.coinIcon}>🪙</Text>
              <Text style={styles.coinAmount}>{stats?.coins ?? 100}</Text>
              <Text style={styles.coinLabel}>COINS</Text>
            </View>
          </View>

          {/* Level & XP Progression */}
          <View style={styles.heroProgressArea}>
            <ProgressBar
              progress={levelData.progressPercent}
              label={`LEVEL ${levelData.level} PROGRESSION`}
              valueText={`${levelData.currentKm} / ${levelData.nextLevelKm} KM (${levelData.totalKm} KM TOTAL)`}
              color={activeColor}
              height={8}
            />
          </View>

          {/* Quick Metrics Grid */}
          <View style={styles.heroStatsGrid}>
            <View style={styles.miniStat}>
              <Text style={styles.miniStatVal}>{stats?.total_runs || 0}</Text>
              <Text style={styles.miniStatLbl}>RUNS</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.miniStatVal}>{levelData.totalKm} KM</Text>
              <Text style={styles.miniStatLbl}>DISTANCE</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.miniStatVal}>
                {Math.round((stats?.total_territory || 0)).toLocaleString()} M²
              </Text>
              <Text style={styles.miniStatLbl}>TURF</Text>
            </View>
          </View>

          {/* Instagram-style social counts — tappable */}
          <View style={styles.igStatRow}>
            <TouchableOpacity
              style={styles.igStatCell}
              onPress={() => setActiveTab('posts')}
              testID="profile-stat-posts"
            >
              <Text style={styles.igStatVal}>{posts.length}</Text>
              <Text style={styles.igStatLbl}>POSTS</Text>
            </TouchableOpacity>
            <View style={styles.igStatDivider} />
            <TouchableOpacity
              style={styles.igStatCell}
              testID="profile-stat-followers"
              onPress={() => {
                if (!user?.uid) return;
                navigation.navigate('FollowersList', { userId: user.uid, tab: 'followers', displayName: stats?.display_name });
              }}
            >
              <Text style={styles.igStatVal}>{followersCount}</Text>
              <Text style={styles.igStatLbl}>FOLLOWERS</Text>
            </TouchableOpacity>
            <View style={styles.igStatDivider} />
            <TouchableOpacity
              style={styles.igStatCell}
              testID="profile-stat-following"
              onPress={() => {
                if (!user?.uid) return;
                navigation.navigate('FollowersList', { userId: user.uid, tab: 'following', displayName: stats?.display_name });
              }}
            >
              <Text style={styles.igStatVal}>{followingCount}</Text>
              <Text style={styles.igStatLbl}>FOLLOWING</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>

        {/* ── Segmented Navigation Sub-Tabs ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subTabsScroll}
        >
          <View style={styles.subTabsRow}>
            <TouchableOpacity
              style={[styles.subTabBtn, activeTab === 'posts' && styles.subTabBtnActive]}
              onPress={() => setActiveTab('posts')}
            >
              <Text style={[styles.subTabText, activeTab === 'posts' && styles.subTabTextActive]}>
                POSTS 📰
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.subTabBtn, activeTab === 'rpgShop' && styles.subTabBtnActive]}
              onPress={() => setActiveTab('rpgShop')}
            >
              <Text style={[styles.subTabText, activeTab === 'rpgShop' && styles.subTabTextActive]}>
                RPG & SHOP ⚔️
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.subTabBtn, activeTab === 'runs' && styles.subTabBtnActive]}
              onPress={() => setActiveTab('runs')}
            >
              <Text style={[styles.subTabText, activeTab === 'runs' && styles.subTabTextActive]}>
                ACTIVITY 🏃
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.subTabBtn, activeTab === 'achievements' && styles.subTabBtnActive]}
              onPress={() => setActiveTab('achievements')}
            >
              <Text style={[styles.subTabText, activeTab === 'achievements' && styles.subTabTextActive]}>
                TROPHIES 🏆
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* ── SUB-TAB 0: POSTS (user's own posts, Instagram-style) ── */}
        {activeTab === 'posts' && (
          <View>
            <Text style={styles.sectionHeader}>MY POSTS</Text>
            {posts.length === 0 ? (
              <GlassCard style={{ padding: SPACING.lg, alignItems: 'center' }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 13, textAlign: 'center' }}>
                  No posts yet. Open COMMUNITY → FEED and tap the + button to share your first post.
                </Text>
              </GlassCard>
            ) : (
              <View style={{ gap: 10 }}>
                {posts.map((p) => (
                  <GlassCard key={p.id} style={styles.postPreviewCard}>
                    {p.image_url ? (
                      <Image source={{ uri: p.image_url }} style={styles.postPreviewImage} />
                    ) : null}
                    <Text style={styles.postPreviewContent} numberOfLines={3}>
                      {p.content}
                    </Text>
                    <View style={styles.postPreviewFooter}>
                      <Text style={styles.postPreviewFooterText}>❤️ {p.likes_count ?? 0}  ·  💬 {p.comments_count ?? 0}</Text>
                      <Text style={styles.postPreviewFooterText}>
                        {new Date(p.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </GlassCard>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── SUB-TAB 1: RPG & ARENA SHOP ── */}
        {activeTab === 'rpgShop' && (
          <View>
            {/* Class Archetypes Section */}
            <Text style={styles.sectionHeader}>SELECT CLASS ARCHETYPE</Text>
            <View style={styles.archetypeGrid}>
              {(['scout', 'warrior', 'titan', 'ghost'] as CharacterType[]).map((cKey) => {
                const meta = CLASS_THEMES[cKey as keyof typeof CLASS_THEMES];
                const isSelected = playerClass === cKey;

                return (
                  <TouchableOpacity
                    key={cKey}
                    style={[
                      styles.archetypeCard,
                      isSelected && { borderColor: meta.color, borderWidth: 2, ...SHADOWS.surface },
                    ]}
                    onPress={() => handleSelectClass(cKey)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.archetypeTop}>
                      <Text style={styles.archetypeEmoji}>{meta.emoji}</Text>
                      {isSelected ? (
                        <View style={[styles.equippedChip, { backgroundColor: meta.color }]}>
                          <Text style={styles.equippedChipText}>EQUIPPED</Text>
                        </View>
                      ) : null}
                    </View>

                    <Text style={[styles.archetypeName, { color: meta.color }]}>
                      {meta.name.toUpperCase()}
                    </Text>
                    <Text style={styles.archetypeBonus}>{meta.bonus}</Text>
                    <Text style={styles.archetypeDesc} numberOfLines={2}>
                      {meta.description}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Milestone Avatars Section */}
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>MILESTONE COMPANIONS (EARNED VIA KM)</Text>
            <View style={styles.shopItemGrid}>
              {MILESTONE_AVATARS.map((m) => {
                const isEarned = (stats?.total_distance || 0) / 1000 >= m.requiredKm;
                const isEquipped = (stats?.selected_avatar || user?.selectedAvatar) === m.avatar;

                return (
                  <GlassCard key={m.name} style={styles.shopCard}>
                    <Text style={styles.shopEmoji}>{m.avatar}</Text>
                    <Text style={styles.shopTitle}>{m.name}</Text>
                    <Text style={styles.shopReq}>REQUIRES {m.requiredKm} KM</Text>

                    {isEquipped ? (
                      <View style={[styles.shopStatusBadge, { backgroundColor: COLORS.neonGreen }]}>
                        <Text style={styles.shopStatusText}>ACTIVE</Text>
                      </View>
                    ) : isEarned ? (
                      <GameButton
                        title="EQUIP"
                        onPress={() => handleEquipAvatar(m.avatar)}
                        variant="secondary"
                        size="sm"
                        style={{ marginTop: 8 }}
                      />
                    ) : (
                      <View style={styles.lockedBadge}>
                        <Text style={styles.lockedText}>🔒 LOCKED</Text>
                      </View>
                    )}
                  </GlassCard>
                );
              })}
            </View>

            {/* Premium Arena Avatars Section */}
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>PREMIUM COMPANIONS (ARENA COINS)</Text>
            <View style={styles.shopItemGrid}>
              {PREMIUM_AVATARS.map((p) => {
                const isUnlocked = unlockedAvatars.includes(p.avatar);
                const isEquipped = (stats?.selected_avatar || user?.selectedAvatar) === p.avatar;

                return (
                  <GlassCard key={p.name} style={styles.shopCard}>
                    <Text style={styles.shopEmoji}>{p.avatar}</Text>
                    <Text style={styles.shopTitle}>{p.name}</Text>
                    <Text style={styles.shopReq}>🪙 {p.cost} COINS</Text>

                    {isEquipped ? (
                      <View style={[styles.shopStatusBadge, { backgroundColor: COLORS.gold }]}>
                        <Text style={[styles.shopStatusText, { color: '#080811' }]}>ACTIVE</Text>
                      </View>
                    ) : isUnlocked ? (
                      <GameButton
                        title="EQUIP"
                        onPress={() => handleEquipAvatar(p.avatar)}
                        variant="secondary"
                        size="sm"
                        style={{ marginTop: 8 }}
                      />
                    ) : (
                      <GameButton
                        title={`BUY ${p.cost} 🪙`}
                        onPress={() => handleUnlockAvatar(p.avatar, p.cost)}
                        variant="primary"
                        size="sm"
                        style={{ marginTop: 8 }}
                      />
                    )}
                  </GlassCard>
                );
              })}
            </View>

            {/* Neon Territory Color Swatches */}
            <Text style={[styles.sectionHeader, { marginTop: 24 }]}>TURF CONQUEST COLORS (200 COINS)</Text>
            <View style={styles.colorSwatchesRow}>
              {SHOP_COLORS.map((c) => {
                const isUnlocked = unlockedColors.includes(c.hex);
                const isActive = activeColor.toLowerCase() === c.hex.toLowerCase();

                return (
                  <TouchableOpacity
                    key={c.name}
                    style={[
                      styles.colorSwatchBtn,
                      { backgroundColor: c.hex },
                      isActive && styles.colorSwatchActive,
                    ]}
                    onPress={() => {
                      if (isUnlocked) {
                        handleSelectClass(playerClass); // persists color
                      } else {
                        handleUnlockColor(c.hex);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    {isActive ? (
                      <Text style={styles.swatchCheck}>✓</Text>
                    ) : !isUnlocked ? (
                      <Text style={styles.swatchLock}>🔒</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── SUB-TAB 2: RUN HISTORY ── */}
        {activeTab === 'runs' && (
          <View>
            <Text style={styles.sectionHeader}>LOGGED RUNS ({runs.length})</Text>
            {runs.length === 0 ? (
              <View style={styles.emptyRuns}>
                <Text style={styles.emptyRunsIcon}>🏃</Text>
                <Text style={styles.emptyRunsTitle}>NO RECORDED SESSIONS</Text>
                <Text style={styles.emptyRunsSub}>Hit Start Conquest on the map to log your first run!</Text>
              </View>
            ) : (
              runs.map((r) => {
                const km = ((r.distance_meters || 0) / 1000).toFixed(2);
                const dateStr = new Date(r.created_at).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <GlassCard key={r.id} style={styles.runCard}>
                    <View style={styles.runCardRow}>
                      <View style={styles.runCardIcon}>
                        <Text style={{ fontSize: 20 }}>🏃</Text>
                      </View>

                      <View style={styles.runCardDetails}>
                        <Text style={styles.runCardDistance}>{km} KM</Text>
                        <Text style={styles.runCardDate}>{dateStr}</Text>
                      </View>

                      <GameButton
                        title="ROUTE MAP 🗺️"
                        onPress={() => handleViewRun(r.id)}
                        variant="secondary"
                        size="sm"
                      />
                    </View>
                  </GlassCard>
                );
              })
            )}
          </View>
        )}

        {/* ── SUB-TAB 3: ACHIEVEMENTS ──
            NOTE: These trophies are a local preview computed on the client
            from the user's own stats. They are NOT persisted to the server
            and NOT awarded centrally (the audit confirmed there is no
            backing table yet). The "PREVIEW" banner below makes this
            explicit so we don't fabricate progress to the user. */}
        {activeTab === 'achievements' && (
          <View>
            <Text style={styles.sectionHeader}>CONQUEST TROPHIES</Text>
            <View style={styles.previewBanner}>
              <Text style={styles.previewBannerText}>
                ⓘ  PREVIEW — trophies are computed locally from your own stats and are not yet verified or awarded by the server.
              </Text>
            </View>
            <View style={styles.trophyGrid}>
              {[
                { title: 'First Blood', desc: 'Conquer your first sector', icon: '⚔️', earned: runs.length > 0 },
                { title: '5K Pathfinder', desc: 'Cover 5 km in distance', icon: '⚡', earned: ((stats?.total_distance || 0) / 1000) >= 5 },
                { title: 'Turf Warlord', desc: 'Claim over 10,000 m² of turf', icon: '🌐', earned: (stats?.total_territory || 0) >= 10000 },
                // "Night Ghost" required a persisted check we don't do; lock it until server-side awarding exists.
                { title: 'Night Ghost', desc: 'Complete a stealth evening run (coming soon)', icon: '👻', earned: false },
                // "Titan Shield" required a persisted defence counter we don't track; lock until persisted.
                { title: 'Titan Shield', desc: 'Defend a sector for 24 hours (coming soon)', icon: '🛡️', earned: false },
                { title: 'Arena Tycoon', desc: 'Earn 300+ Arena Coins', icon: '🪙', earned: (stats?.coins || 0) >= 300 },
              ].map((t) => (
                <GlassCard
                  key={t.title}
                  style={[styles.trophyCard, !t.earned && { opacity: 0.45 }]}
                  variant={t.earned ? 'neonBorder' : 'default'}
                >
                  <Text style={styles.trophyIcon}>{t.icon}</Text>
                  <Text style={styles.trophyTitle}>{t.title}</Text>
                  <Text style={styles.trophyDesc}>{t.desc}</Text>
                  <View style={[styles.trophyBadge, { backgroundColor: t.earned ? COLORS.neonGreen : COLORS.borderSubtle }]}>
                    <Text style={[styles.trophyBadgeText, { color: t.earned ? '#080811' : COLORS.textMuted }]}>
                      {t.earned ? 'COMPLETED' : 'LOCKED'}
                    </Text>
                  </View>
                </GlassCard>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Route Preview Modal ── */}
      <ModalContainer
        visible={detailModalVisible}
        onClose={() => setDetailModalVisible(false)}
        title="CONQUEST ROUTE PREVIEW"
        subtitle="GPS Telemetry & Territory Map"
      >
        {loadingDetail ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.neonGreen} size="large" />
          </View>
        ) : selectedRun && selectedRun.route_points?.length > 1 ? (
          <View>
            <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 0.9 }}>
              <View style={styles.routeMapContainer}>
                <MapView
                  provider={PROVIDER_GOOGLE}
                  style={styles.routeMapView}
                  customMapStyle={CYBER_DARK_MAP_STYLE}
                  initialRegion={{
                    latitude: selectedRun.route_points[0].latitude,
                    longitude: selectedRun.route_points[0].longitude,
                    latitudeDelta: 0.015,
                    longitudeDelta: 0.015,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                >
                  <Polyline
                    coordinates={selectedRun.route_points}
                    strokeColor={COLORS.neonGreen}
                    strokeWidth={5}
                  />
                </MapView>
              </View>

              <View style={styles.routeMetricsRow}>
                <View style={styles.routeMetricItem}>
                  <Text style={styles.routeMetricVal}>
                    {((selectedRun.distance_meters || 0) / 1000).toFixed(2)} KM
                  </Text>
                  <Text style={styles.routeMetricLbl}>DISTANCE</Text>
                </View>
                <View style={styles.routeMetricItem}>
                  <Text style={styles.routeMetricVal}>
                    {Math.round(selectedRun.distance_meters * 2).toLocaleString()} M²
                  </Text>
                  <Text style={styles.routeMetricLbl}>TURF CONQUERED</Text>
                </View>
              </View>
            </ViewShot>

            <GameButton
              title="SHARE CONQUEST CARD 📲"
              onPress={handleShareRun}
              variant="primary"
              size="md"
              style={{ marginTop: 16 }}
            />
          </View>
        ) : (
          <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginVertical: 24 }}>
            GPS route data unavailable for this run.
          </Text>
        )}
      </ModalContainer>

      {/* ── Edit Profile Modal ── */}
      <ModalContainer
        visible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        title="EDIT RUNNER PROFILE"
        subtitle="Display Name & Bio"
      >
        <View style={styles.editForm}>
          <Text style={styles.inputLabel}>CALLSIGN / DISPLAY NAME</Text>
          <TextInput
            style={styles.textInput}
            value={editDisplayName}
            onChangeText={setEditDisplayName}
            placeholder="Runner Callsign"
            placeholderTextColor={COLORS.textMuted}
          />

          <Text style={[styles.inputLabel, { marginTop: 14 }]}>RUNNER BIO</Text>
          <TextInput
            style={[styles.textInput, { height: 72 }]}
            value={editBio}
            onChangeText={setEditBio}
            placeholder="Your fitness & gaming mission"
            placeholderTextColor={COLORS.textMuted}
            multiline
          />

          <GameButton
            title="SAVE CHANGES"
            onPress={handleSaveProfile}
            variant="primary"
            size="md"
            isLoading={savingProfile}
            style={{ marginTop: 20 }}
          />
        </View>
      </ModalContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
    paddingTop: Platform.OS === 'ios' ? 52 : 44,
  },
  screenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  settingsBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  logoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 42, 85, 0.15)',
    borderWidth: 1,
    borderColor: COLORS.crimson,
  },
  logoutBtnText: {
    color: COLORS.crimson,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: 40,
  },
  heroCard: {
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroInfoCol: {
    flex: 1,
    marginLeft: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroDisplayName: {
    fontSize: 17,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  classPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADII.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginVertical: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  classEmoji: {
    fontSize: 11,
    marginRight: 4,
  },
  classTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  heroBio: {
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 15,
  },
  coinBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderWidth: 1.2,
    borderColor: COLORS.gold,
    borderRadius: RADII.md,
    paddingVertical: 6,
    paddingHorizontal: 10,
    ...SHADOWS.goldGlow,
  },
  coinIcon: {
    fontSize: 16,
  },
  coinAmount: {
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.gold,
    fontVariant: ['tabular-nums'],
  },
  coinLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: COLORS.gold,
    letterSpacing: 0.6,
  },
  heroProgressArea: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  miniStat: {
    alignItems: 'center',
  },
  miniStatVal: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  miniStatLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  igStatRow: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  igStatCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  igStatDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 6,
  },
  igStatVal: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  igStatLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  subTabsScroll: {
    paddingBottom: 4,
  },
  subTabsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16, 16, 32, 0.92)',
    borderRadius: RADII.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: SPACING.md,
  },
  subTabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderRadius: RADII.pill,
  },
  postPreviewCard: {
    padding: SPACING.sm,
    gap: 8,
  },
  postPreviewImage: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    backgroundColor: '#0D0D1A',
  },
  postPreviewContent: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 19,
  },
  postPreviewFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  postPreviewFooterText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  previewBanner: {
    backgroundColor: 'rgba(255,140,0,0.1)',
    borderColor: 'rgba(255,140,0,0.45)',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  previewBannerText: {
    color: '#FF8C00',
    fontSize: 11,
    fontWeight: '700',
  },
  coverWrap: {
    position: 'relative',
    height: 140,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: 'rgba(16,16,32,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  coverFallbackText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  coverEditBtn: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    minWidth: 76,
    alignItems: 'center',
  },
  coverEditBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  coverRemoveBtn: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,59,48,0.75)',
  },
  coverRemoveBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  avatarWithEdit: {
    position: 'relative',
  },
  avatarEditBtn: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0A0A14',
    elevation: 6,
  },
  avatarEditBtnText: {
    fontSize: 14,
  },
  subTabBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: COLORS.borderMedium,
  },
  subTabText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
  },
  subTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '900',
    color: COLORS.textSecondary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  archetypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  archetypeCard: {
    width: (SCREEN_WIDTH - 42) / 2,
    backgroundColor: 'rgba(22, 22, 45, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: RADII.md,
    padding: 12,
  },
  archetypeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  archetypeEmoji: {
    fontSize: 22,
  },
  equippedChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  equippedChipText: {
    color: '#080811',
    fontSize: 8,
    fontWeight: '900',
  },
  archetypeName: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  archetypeBonus: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.gold,
    marginTop: 2,
  },
  archetypeDesc: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 4,
    lineHeight: 14,
  },
  shopItemGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  shopCard: {
    width: (SCREEN_WIDTH - 42) / 2,
    alignItems: 'center',
    padding: 12,
  },
  shopEmoji: {
    fontSize: 32,
    marginBottom: 6,
  },
  shopTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  shopReq: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.gold,
    marginTop: 2,
  },
  shopStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.sm,
    marginTop: 8,
  },
  shopStatusText: {
    color: '#080811',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  lockedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginTop: 8,
  },
  lockedText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  colorSwatchesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  colorSwatchBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  colorSwatchActive: {
    borderColor: '#FFFFFF',
    borderWidth: 3,
    transform: [{ scale: 1.15 }],
  },
  swatchCheck: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  swatchLock: {
    fontSize: 12,
  },
  emptyRuns: {
    alignItems: 'center',
    paddingVertical: 36,
  },
  emptyRunsIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyRunsTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  emptyRunsSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  runCard: {
    marginBottom: 10,
    padding: 12,
  },
  runCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  runCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 255, 136, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  runCardDetails: {
    flex: 1,
  },
  runCardDistance: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  runCardDate: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  trophyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  trophyCard: {
    width: (SCREEN_WIDTH - 42) / 2,
    alignItems: 'center',
    padding: 12,
  },
  trophyIcon: {
    fontSize: 28,
    marginBottom: 6,
  },
  trophyTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  trophyDesc: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 14,
  },
  trophyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 8,
  },
  trophyBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  routeMapContainer: {
    height: 200,
    borderRadius: RADII.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 12,
  },
  routeMapView: {
    ...StyleSheet.absoluteFill,
  },
  routeMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: RADII.sm,
    paddingVertical: 10,
  },
  routeMetricItem: {
    alignItems: 'center',
  },
  routeMetricVal: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.neonGreen,
    fontVariant: ['tabular-nums'],
  },
  routeMetricLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  editForm: {
    paddingBottom: 16,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: RADII.sm,
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
});
