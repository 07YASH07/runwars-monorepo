/**
 * ProfileScreen — Player stats, run history, and profile customization.
 * Redesigned in v2.0 with Dual Tab (Stats vs Posts), Trophies, and Dark Mode theme.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  FlatList,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';
import * as ImagePicker from 'expo-image-picker';
import MapView, { Polyline, PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import Svg, { Circle } from 'react-native-svg';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000';

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
}

interface UserPost {
  id: string;
  content: string;
  image_url?: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
}

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statCardValue}>{value}</Text>
      <Text style={styles.statCardUnit}>{unit}</Text>
      <Text style={styles.statCardLabel}>{label}</Text>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ProfileScreen() {
  const { user, setCharacterAndColor } = useAuth();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [myPosts, setMyPosts] = useState<UserPost[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'stats' | 'posts' | 'followers'>('stats');

  // Edit Mode state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCharacter, setEditCharacter] = useState('scout');
  const [editColor, setEditColor] = useState('#00BFFF');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editCoverImageUrl, setEditCoverImageUrl] = useState('');

  // Past Run Detail states
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const viewShotRef = React.useRef<any>(null);

  const handleViewRunDetails = async (runId: number) => {
    setLoadingDetail(true);
    setDetailModalVisible(true);
    setSelectedRun(null);
    try {
      const res = await fetch(`${API_URL}/runs/details/${runId}`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      if (!res.ok) throw new Error('Failed to fetch details');
      const data = await res.json();
      setSelectedRun(data);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to load run details.');
      setDetailModalVisible(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSharePastRun = async () => {
    try {
      if (viewShotRef.current && viewShotRef.current.capture) {
        const uri = await viewShotRef.current.capture();
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(uri, {
            dialogTitle: 'Share your Run!',
            mimeType: 'image/jpeg',
          });
        }
      }
    } catch (err) {
      console.error('Failed to share screenshot:', err);
    }
  };

  const runStats = useMemo(() => {
    if (!selectedRun || !selectedRun.route_points || selectedRun.route_points.length < 2) return null;
    const pts = selectedRun.route_points;
    const start = pts[0].timestamp;
    const end = pts[pts.length - 1].timestamp;
    const elapsedSeconds = Math.max(Math.floor((end - start) / 1000), 1);
    
    const distanceMeters = selectedRun.distance_meters;
    const distanceKm = (distanceMeters / 1000).toFixed(2);
    
    const speed = (distanceMeters / 1000) / (elapsedSeconds / 3600);
    const averageSpeedKmh = speed.toFixed(1);

    const totalMinutes = elapsedSeconds / 60;
    const km = distanceMeters / 1000;
    let paceStr = '00:00';
    if (km > 0) {
      const paceMinDecimal = totalMinutes / km;
      const mins = Math.floor(paceMinDecimal);
      const secs = Math.round((paceMinDecimal - mins) * 60);
      paceStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    const h = Math.floor(elapsedSeconds / 3600);
    const m = Math.floor((elapsedSeconds % 3600) / 60);
    const s = elapsedSeconds % 60;
    const durationStr = h > 0 
      ? `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
      : `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    pts.forEach((p: any) => {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    });
    const mapRegion = {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: (maxLat - minLat) * 1.5 || 0.01,
      longitudeDelta: (maxLng - minLng) * 1.5 || 0.01,
    };

    return {
      durationStr,
      averageSpeedKmh,
      paceStr,
      distanceKm,
      mapRegion,
      points: pts
    };
  }, [selectedRun]);

  const fetchProfile = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [profileRes, runsRes, feedRes] = await Promise.all([
        fetch(`${API_URL}/api/profile/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
        fetch(`${API_URL}/runs/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
        fetch(`${API_URL}/api/feed?userId=${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
      ]);
      const profileData = await profileRes.json();
      const runsData = await runsRes.json();
      const feedData = await feedRes.json();

      setStats({ ...profileData.user, ...profileData.stats });
      setRuns(runsData);
      setFollowers(profileData.followers || []);
      setFollowing(profileData.following || []);
      
      // Filter feed for only posts created by logged-in user
      const userPosts = feedData
        .filter((item: any) => item.post_type !== 'announcement' && item.user_id === user.uid)
        .map((p: any) => ({
          id: p.id,
          content: p.content,
          image_url: p.image_url,
          created_at: p.created_at,
          likes_count: p.likes_count,
          comments_count: p.comments_count,
        }));
      setMyPosts(userPosts);

      // Pre-fill edit inputs
      setEditDisplayName(profileData.user.display_name || user.displayName || 'Runner');
      setEditBio(profileData.user.bio || '');
      setEditCharacter(profileData.user.character_type || user.characterType || 'scout');
      setEditColor(profileData.user.color || user.color || '#00BFFF');
      setEditAvatarUrl(profileData.user.avatar_url || '');
      setEditCoverImageUrl(profileData.user.cover_image_url || '');
    } catch (err) {
      console.error('[Profile] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            const { socketService } = require('@/services/SocketService');
            socketService.disconnect();
            await signOut(auth);
          } catch (err) {
            Alert.alert('Error', 'Failed to log out. Please try again.');
          }
        },
      },
    ]);
  }, []);

  const weeklyData = useMemo(() => {
    const data = [
      { label: 'Sun', val: 0 },
      { label: 'Mon', val: 0 },
      { label: 'Tue', val: 0 },
      { label: 'Wed', val: 0 },
      { label: 'Thu', val: 0 },
      { label: 'Fri', val: 0 },
      { label: 'Sat', val: 0 },
    ];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dayIndex = d.getDay();
      const dateStr = d.toDateString();
      const dayRuns = runs.filter(r => new Date(r.created_at).toDateString() === dateStr);
      const dayDistanceKm = dayRuns.reduce((sum, r) => sum + (r.distance_meters || 0), 0) / 1000;
      data[dayIndex].val = parseFloat(dayDistanceKm.toFixed(2));
    }
    const dayOrder = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      dayOrder.push(data[d.getDay()]);
    }
    return dayOrder;
  }, [runs]);

  const totalCalories = useMemo(() => {
    const totalDistanceKm = (stats?.total_distance || 0) / 1000;
    return Math.round(totalDistanceKm * 70 * 0.8);
  }, [stats]);

  const shopColors = [
    { name: 'Neon Gold', hex: '#FFD700' },
    { name: 'Neon Green', hex: '#00FF00' },
    { name: 'Orchid Purple', hex: '#DA70D6' },
    { name: 'Crimson Red', hex: '#DC143C' },
    { name: 'Cyan Splash', hex: '#00FFFF' },
  ];

  const [unlockingColor, setUnlockingColor] = useState<string | null>(null);
  const [avatarShopVisible, setAvatarShopVisible] = useState(false);
  const [unlockingAvatar, setUnlockingAvatar] = useState<string | null>(null);
  const [settingAvatar, setSettingAvatar] = useState<string | null>(null);
  const [newlyUnlockedAvatars, setNewlyUnlockedAvatars] = useState<string[]>([]);

  // Milestone avatar definitions (mirror server)
  const milestoneAvatars = [
    { avatar: '🦊', name: 'Swift Fox',     requiredKm: 5   },
    { avatar: '🐺', name: 'Lone Wolf',     requiredKm: 10  },
    { avatar: '🦁', name: 'Lion King',     requiredKm: 25  },
    { avatar: '🦅', name: 'Soaring Eagle', requiredKm: 50  },
    { avatar: '🐉', name: 'Dragon',        requiredKm: 100 },
  ];
  const premiumAvatars = [
    { avatar: '🤖', name: 'Cyborg',    cost: 150 },
    { avatar: '🦄', name: 'Unicorn',   cost: 150 },
    { avatar: '👾', name: 'Ghost',     cost: 150 },
    { avatar: '⚡', name: 'Lightning', cost: 150 },
    { avatar: '🌟', name: 'Star',      cost: 150 },
  ];

  const handleUnlockColor = async (colorHex: string) => {
    if (!user?.uid) return;
    const userCoins = stats?.coins ?? 0;
    if (userCoins < 200) {
      Alert.alert('Insufficient Coins', 'Claim more zones or complete runs to earn Arena Coins!');
      return;
    }
    setUnlockingColor(colorHex);
    try {
      const res = await fetch(`${API_URL}/api/shop/unlock-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, color: colorHex })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Unlocked!', `Unlocked premium color ${colorHex}!`);
        fetchProfile();
      } else {
        Alert.alert('Error', data.error || 'Failed to unlock color.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Network request failed.');
    } finally {
      setUnlockingColor(null);
    }
  };

  const handleCheckMilestones = async () => {
    if (!user?.uid) return;
    try {
      const res = await fetch(`${API_URL}/api/shop/check-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      });
      const data = await res.json();
      if (res.ok && data.newlyUnlocked?.length > 0) {
        setNewlyUnlockedAvatars(data.newlyUnlocked);
        Alert.alert(
          '🎉 New Avatar Unlocked!',
          `You've earned: ${data.newlyUnlocked.join(' ')}
Check the Avatar Shop to equip it!`
        );
        fetchProfile();
      }
    } catch (err) {
      console.error('[Milestones] check failed:', err);
    }
  };

  const handleUnlockPremiumAvatar = async (avatar: string, cost: number) => {
    if (!user?.uid) return;
    const userCoins = stats?.coins ?? 0;
    if (userCoins < cost) {
      Alert.alert('Insufficient Coins', `Need ${cost} Arena Coins. You have ${userCoins}.`);
      return;
    }
    setUnlockingAvatar(avatar);
    try {
      const res = await fetch(`${API_URL}/api/shop/unlock-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, avatar }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Unlocked!', `${avatar} ${data.avatar} added to your collection!`);
        fetchProfile();
      } else {
        Alert.alert('Error', data.error || 'Failed to unlock avatar.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Network request failed.');
    } finally {
      setUnlockingAvatar(null);
    }
  };

  const handleSetAvatar = async (avatar: string) => {
    if (!user?.uid) return;
    setSettingAvatar(avatar);
    try {
      const res = await fetch(`${API_URL}/api/shop/set-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, avatar }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchProfile();
      } else {
        Alert.alert('Error', data.error || 'Failed to set avatar.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSettingAvatar(null);
    }
  };

  const handleUnfollow = async (followingId: string) => {
    if (!user?.uid) return;
    try {
      const res = await fetch(`${API_URL}/api/followers/unfollow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, followingId })
      });
      if (res.ok) {
        fetchProfile();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Camera roll access is needed to change your photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    if (!result.canceled && result.assets && result.assets[0]?.base64) {
      setEditAvatarUrl(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const pickCoverImage = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permissionResult.granted === false) {
      Alert.alert('Permission Required', 'Camera roll access is needed to change your cover photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.4,
      base64: true,
    });
    if (!result.canceled && result.assets && result.assets[0]?.base64) {
      setEditCoverImageUrl(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handleSaveProfile = async () => {
    if (!user?.uid) return;
    try {
      const response = await fetch(`${API_URL}/profile/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
        body: JSON.stringify({
          userId: user.uid,
          displayName: editDisplayName.trim(),
          bio: editBio.trim(),
          avatarUrl: editAvatarUrl,
          coverImageUrl: editCoverImageUrl,
          characterType: editCharacter,
          color: editColor,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setEditModalVisible(false);
        fetchProfile();
        await setCharacterAndColor(editCharacter as any, editColor);
      } else {
        Alert.alert('Error', 'Failed to update profile.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to connect to server.');
    }
  };

  const handleDeletePost = async (postId: string) => {
    Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await fetch(`${API_URL}/api/posts/${postId}`, {
              method: 'DELETE',
            });
            if (res.ok) {
              setMyPosts(prev => prev.filter(p => p.id !== postId));
              fetchProfile();
            } else {
              Alert.alert('Error', 'Failed to delete post.');
            }
          } catch (err) {
            Alert.alert('Error', 'Failed to connect to server.');
          }
        }
      }
    ]);
  };

  const characterType = stats?.character_type ?? user?.characterType ?? 'scout';
  const color = stats?.color ?? user?.color ?? '#00BFFF';
  const displayName = stats?.display_name ?? user?.displayName ?? 'Runner';
  const bioText = stats?.bio || 'Add a bio to your profile';
  const avatarUrl = stats?.avatar_url || '';
  const emoji = CHARACTER_EMOJI[characterType as CharacterType] ?? '🏃';

  const totalDistanceKm = ((stats?.total_distance ?? 0) / 1000).toFixed(1);
  const totalTerritoryKm2 = ((stats?.total_territory ?? 0) / 1_000_000).toFixed(4);

  // Unlocked Trophies list whitelisted:
  const trophies = useMemo(() => {
    const list = [];
    const runsCount = stats?.total_runs || 0;
    const distanceVal = (stats?.total_distance || 0) / 1000;
    const territoryVal = (stats?.total_territory || 0) / 1_000_000;

    if (runsCount >= 1) {
      list.push({ id: '1', emoji: '🟢', name: 'First Blood', desc: 'Completed your first run session in the Arena.' });
    }
    if (runsCount >= 10) {
      list.push({ id: '2', emoji: '🔥', name: 'Arena Regular', desc: 'Completed 10 runs in the Arena.' });
    }
    if (distanceVal >= 10) {
      list.push({ id: '3', emoji: '👟', name: 'Distance Elite', desc: 'Covered over 10 KM in total running distance.' });
    }
    if (territoryVal >= 0.05) {
      list.push({ id: '4', emoji: '👑', name: 'Zone Conqueror', desc: 'Conquered more than 0.05 km² of grids.' });
    }
    return list;
  }, [stats]);

  // Level Progression details
  const xp = Math.round((stats?.total_distance ?? 0) / 100) + Math.round((stats?.total_territory ?? 0) / 500);
  const level = Math.floor(xp / 100) + 1;
  const currentLevelXp = xp % 100;
  const xpProgress = currentLevelXp / 100;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={color} size="large" />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          
          {/* Background Cover Image Banner */}
          <View style={styles.coverContainer}>
            {stats?.cover_image_url ? (
              <Image source={{ uri: stats.cover_image_url }} style={styles.coverImage} resizeMode="cover" />
            ) : (
              <View style={[styles.coverPlaceholder, { backgroundColor: color + '22' }]} />
            )}
            <TouchableOpacity style={styles.changeCoverFloatingBtn} onPress={pickCoverImage}>
               <Text style={styles.changeCoverFloatingText}>📷 Change Cover</Text>
            </TouchableOpacity>
          </View>

          {/* Top Profile Header Section */}
          <View style={styles.profileHeaderContainer}>
            <View style={[styles.avatarBorder, { borderColor: color }]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.profileImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarEmoji}>{emoji}</Text>
                </View>
              )}
            </View>

            <Text style={styles.displayNameText}>{displayName.toUpperCase()}</Text>
            <Text style={styles.bioText}>{bioText}</Text>

            <TouchableOpacity style={styles.editProfileBtn} onPress={() => setEditModalVisible(true)}>
              <Text style={styles.editProfileBtnText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          {/* Level Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLevelText}>LEVEL {level}</Text>
              <Text style={[styles.progressXpText, { color }]}>{xp} XP</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { backgroundColor: color, width: `${xpProgress * 100}%` }]} />
            </View>
            <View style={styles.progressLabelRow}>
              <Text style={styles.progressSub}>{currentLevelXp} / 100 XP to next level</Text>
              <Text style={styles.progressPercent}>{Math.round(xpProgress * 100)}%</Text>
            </View>
          </View>

          {/* Triple Tab Row */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'stats' && styles.tabButtonActive]}
              onPress={() => setActiveTab('stats')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'stats' && styles.tabButtonTextActive]}>
                📈 STATS
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'posts' && styles.tabButtonActive]}
              onPress={() => setActiveTab('posts')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'posts' && styles.tabButtonTextActive]}>
                🖼️ POSTS ({myPosts.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'followers' && styles.tabButtonActive]}
              onPress={() => setActiveTab('followers')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'followers' && styles.tabButtonTextActive]}>
                👥 FOLLOWERS ({followers.length})
              </Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'stats' && (
            /* ===== STATS TAB CONTENT ===== */
            <View style={styles.tabContent}>
              {/* StatCards Row */}
              <View style={styles.statsGridRow}>
                <StatCard label="RUNS" value={String(stats?.total_runs || 0)} unit="sessions" />
                <StatCard label="DISTANCE" value={totalDistanceKm} unit="km" />
                <StatCard label="TERRITORY" value={totalTerritoryKm2} unit="km²" />
              </View>

              {/* Weekly Distance Bar Chart (Custom Flex-CSS cylinders) */}
              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>WEEKLY PROGRESS (KM)</Text>
                <View style={styles.chartBarRow}>
                  {weeklyData.map((d, index) => {
                    const maxDistance = Math.max(...weeklyData.map(day => day.val), 1);
                    const heightPercent = `${Math.max((d.val / maxDistance) * 100, 5)}%`;
                    return (
                      <View key={index} style={styles.chartCol}>
                        <Text style={styles.chartValText}>{d.val > 0 ? d.val.toFixed(1) : '0'}</Text>
                        <View style={styles.chartBarBg}>
                          <View style={[styles.chartBarFill, { height: heightPercent as any, backgroundColor: color }]} />
                        </View>
                        <Text style={styles.chartLabelText}>{d.label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Calories progress card (SVG Graphic Meter) */}
              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>CALORIES BURNED</Text>
                <View style={styles.calorieCardContent}>
                  <View style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}>
                    <Svg width="120" height="120" viewBox="0 0 100 100">
                      <Circle cx="50" cy="50" r="45" stroke={color + '33'} strokeWidth="10" fill="transparent" />
                      <Circle 
                        cx="50" 
                        cy="50" 
                        r="45" 
                        stroke={color} 
                        strokeWidth="10" 
                        fill="transparent" 
                        strokeDasharray={`${2 * Math.PI * 45}`} 
                        strokeDashoffset={`${2 * Math.PI * 45 * (1 - Math.min(totalCalories / 500, 1))}`} 
                        strokeLinecap="round" 
                        transform="rotate(-90 50 50)" 
                      />
                    </Svg>
                    <View style={{ position: 'absolute', alignItems: 'center' }}>
                      <Text style={[styles.calorieBigValue, { color }]}>{totalCalories}</Text>
                      <Text style={styles.calorieSubText}>kcal</Text>
                    </View>
                  </View>
                  
                  <View style={styles.calorieProgressInfo}>
                    <Text style={styles.calorieGoalText}>Daily Goal: 500 kcal</Text>
                    <View style={styles.calorieBarBg}>
                      <View style={[styles.calorieBarFill, { width: `${Math.min((totalCalories / 500) * 100, 100)}%`, backgroundColor: color }]} />
                    </View>
                    <Text style={styles.calorieEquivalentText}>
                      🍕 Equivalent to <Text style={{fontWeight: '900', color}}>{Math.max(totalCalories / 285, 0).toFixed(1)}</Text> slices of Pizza!
                    </Text>
                  </View>
                </View>
              </View>

              {/* Activity Distribution Chart */}
              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>ACTIVITY DISTRIBUTION</Text>
                <View style={styles.activityDistributionContainer}>
                  <View style={styles.stackedBar}>
                    <View style={[styles.stackedSegment, { flex: 0.6, backgroundColor: '#00BFFF' }]} />
                    <View style={[styles.stackedSegment, { flex: 0.3, backgroundColor: '#FF4D4D' }]} />
                    <View style={[styles.stackedSegment, { flex: 0.1, backgroundColor: '#32CD32' }]} />
                  </View>
                  <View style={styles.activityLegendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#00BFFF' }]} />
                      <Text style={styles.legendText}>Running (60%)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#FF4D4D' }]} />
                      <Text style={styles.legendText}>Walking (30%)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#32CD32' }]} />
                      <Text style={styles.legendText}>Cycling (10%)</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Character Class Card */}
              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>CHARACTER CLASS</Text>
                <View style={styles.characterRow}>
                  <Text style={styles.characterClassEmoji}>{emoji}</Text>
                  <View style={styles.characterInfo}>
                    <Text style={[styles.characterNameText, { color }]}>{characterType.toUpperCase()}</Text>
                    <Text style={styles.characterDescText}>
                      {characterType === 'scout' && '⚡ Scout: Especializes in speed claims and agile coordinate captures.'}
                      {characterType === 'warrior' && '🛡️ Warrior: Defends grids with strength claims and decay reductions.'}
                      {characterType === 'ninja' && '🥷 Ninja: Specializes in stealth captures and fast strikes.'}
                      {characterType === 'mage' && '🧙 Mage: Wizard claims with 15% larger territory radius scopes.'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Trophies Section */}
              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>UNLOCKED TROPHIES ({trophies.length})</Text>
                {trophies.length === 0 ? (
                  <Text style={styles.noTrophiesText}>Complete runs to unlock achievements!</Text>
                ) : (
                  <View style={styles.trophiesGrid}>
                    {trophies.map(t => (
                      <View key={t.id} style={styles.trophyItem}>
                        <Text style={styles.trophyEmoji}>{t.emoji}</Text>
                        <Text style={styles.trophyName}>{t.name}</Text>
                        <Text style={styles.trophyDesc} numberOfLines={2}>{t.desc}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Arena Customization Shop */}
              <View style={styles.panelCard}>
                <View style={styles.shopHeaderRow}>
                  <Text style={styles.panelTitle}>ARENA CUSTOMIZATION SHOP</Text>
                  <Text style={styles.coinsBalance}>🪙 {stats?.coins ?? 100} Coins</Text>
                </View>
                <Text style={styles.shopSubText}>Spend 200 Arena Coins to unlock premium neon territory colors</Text>
                <View style={styles.shopGrid}>
                  {shopColors.map(c => {
                    const isUnlocked = stats?.unlocked_colors?.includes(c.hex) || c.hex === '#FF4D4D' || c.hex === '#1E90FF';
                    return (
                      <View key={c.hex} style={styles.shopItem}>
                        <View style={[styles.shopColorIndicator, { backgroundColor: c.hex }]} />
                        <Text style={styles.shopColorName}>{c.name}</Text>
                        {isUnlocked ? (
                          <View style={styles.unlockedBadge}>
                            <Text style={styles.unlockedText}>✓ Unlocked</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.unlockBtn}
                            onPress={() => handleUnlockColor(c.hex)}
                            disabled={unlockingColor !== null}
                          >
                            <Text style={styles.unlockBtnText}>🪙 200</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Avatar Shop */}
              <View style={styles.panelCard}>
                <View style={styles.shopHeaderRow}>
                  <Text style={styles.panelTitle}>AVATAR SHOP</Text>
                  <TouchableOpacity
                    style={styles.checkMilestoneBtn}
                    onPress={handleCheckMilestones}
                  >
                    <Text style={styles.checkMilestoneBtnText}>🏆 Check Milestones</Text>
                  </TouchableOpacity>
                </View>

                {/* Currently selected avatar */}
                <View style={styles.activeAvatarRow}>
                  <Text style={styles.shopSubText}>Active Avatar:</Text>
                  <View style={[styles.activeAvatarBubble, { borderColor: color }]}>
                    <Text style={styles.activeAvatarEmoji}>
                      {stats?.selected_avatar || CHARACTER_EMOJI[stats?.character_type as CharacterType] || '🏃'}
                    </Text>
                  </View>
                </View>

                {/* Unlocked Avatars Collection */}
                {stats?.unlocked_avatars && stats.unlocked_avatars.length > 0 && (
                  <View style={styles.collectionBox}>
                    <Text style={styles.shopSubSection}>YOUR COLLECTION</Text>
                    <View style={styles.avatarRow}>
                      {stats.unlocked_avatars.map((av, idx) => {
                        const isActive = av === (stats?.selected_avatar || '🏃');
                        return (
                          <TouchableOpacity
                            key={av + idx}
                            style={[
                              styles.avatarSlot,
                              isActive && { borderColor: color, borderWidth: 2 },
                            ]}
                            onPress={() => handleSetAvatar(av)}
                            disabled={settingAvatar !== null}
                          >
                            <Text style={styles.avatarSlotEmoji}>{av}</Text>
                            {isActive && (
                              <View style={[styles.activeIndicatorDot, { backgroundColor: color }]} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Milestone Avatars */}
                <Text style={[styles.shopSubSection, { marginTop: 16 }]}>🏅 MILESTONE REWARDS</Text>
                <Text style={styles.shopSubText}>Run farther to unlock avatar companions</Text>
                <View style={styles.shopGrid}>
                  {milestoneAvatars.map(m => {
                    const totalKm = (stats?.total_distance || 0) / 1000;
                    const isUnlocked = stats?.unlocked_avatars?.includes(m.avatar);
                    const pct = Math.min((totalKm / m.requiredKm) * 100, 100);
                    return (
                      <View key={m.avatar} style={styles.shopItem}>
                        <View style={styles.avatarShopLeft}>
                          <Text style={styles.avatarShopEmoji}>{m.avatar}</Text>
                          <Text style={styles.avatarShopKm}>{m.requiredKm} km</Text>
                        </View>
                        <View style={styles.avatarShopCenter}>
                          <Text style={styles.shopColorName}>{m.name}</Text>
                          {isUnlocked ? (
                            <View style={styles.unlockedBadge}>
                              <Text style={styles.unlockedText}>✓ Unlocked</Text>
                            </View>
                          ) : (
                            <View style={styles.progressBarContainer}>
                              <View style={[styles.progressBarTrack]}>
                                <View style={[styles.milestoneBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                              </View>
                              <Text style={styles.progressBarLabel}>{totalKm.toFixed(1)} / {m.requiredKm} km</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Premium Avatars */}
                <Text style={[styles.shopSubSection, { marginTop: 20 }]}>💎 PREMIUM AVATARS</Text>
                <Text style={styles.shopSubText}>Spend 150 Arena Coins for exclusive avatars</Text>
                <View style={styles.shopGrid}>
                  {premiumAvatars.map(p => {
                    const isUnlocked = stats?.unlocked_avatars?.includes(p.avatar);
                    return (
                      <View key={p.avatar} style={styles.shopItem}>
                        <Text style={styles.avatarShopEmoji}>{p.avatar}</Text>
                        <Text style={[styles.shopColorName, { flex: 1, marginLeft: 4 }]}>{p.name}</Text>
                        {isUnlocked ? (
                          <View style={styles.unlockedBadge}>
                            <Text style={styles.unlockedText}>✓ Unlocked</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.unlockBtn}
                            onPress={() => handleUnlockPremiumAvatar(p.avatar, p.cost)}
                            disabled={unlockingAvatar !== null}
                          >
                            <Text style={styles.unlockBtnText}>🪙 150</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Run History list */}

              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>RUN LOGS</Text>
                {runs.length === 0 ? (
                  <Text style={styles.noTrophiesText}>No runs completed yet.</Text>
                ) : (
                  runs.map((run, i) => (
                    <TouchableOpacity
                      key={run.id}
                      style={styles.runRowItem}
                      onPress={() => handleViewRunDetails(run.id)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.runIndexBadge, { backgroundColor: color + '15' }]}>
                        <Text style={[styles.runIndexBadgeText, { color }]}>#{runs.length - i}</Text>
                      </View>
                      <View style={styles.runRowInfo}>
                        <Text style={styles.runRowDistance}>{(run.distance_meters / 1000).toFixed(2)} km</Text>
                        <Text style={styles.runRowDate}>{formatDate(run.created_at)}</Text>
                      </View>
                      <Text style={styles.runRowArrow}>→</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {/* Logout Button */}
              <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                <Text style={styles.logoutButtonText}>↩ LOG OUT</Text>
              </TouchableOpacity>
            </View>
          )}

          {activeTab === 'posts' && (
            /* ===== POSTS TAB CONTENT ===== */
            <View style={styles.tabContent}>
              {myPosts.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyEmojiText}>🖼️</Text>
                  <Text style={styles.emptyTitleText}>No posts yet.</Text>
                  <Text style={styles.emptySubtitleText}>Compose a post on the Social Feed page to see it here!</Text>
                </View>
              ) : (
                myPosts.map((post) => (
                  <View key={post.id} style={styles.myPostCard}>
                    <View style={styles.postCardHeader}>
                      <Text style={styles.postCardDate}>{formatDate(post.created_at)}</Text>
                      <TouchableOpacity onPress={() => handleDeletePost(post.id)}>
                        <Text style={styles.deletePostText}>🗑️ Delete</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.postCardContent}>{post.content}</Text>
                    {post.image_url ? (
                      <Image source={{ uri: post.image_url }} style={styles.postCardImage} />
                    ) : null}
                    <View style={styles.postCardFooter}>
                      <Text style={styles.postCardFootText}>❤️ {post.likes_count} likes</Text>
                      <Text style={styles.postCardFootText}>💬 {post.comments_count} comments</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

          {activeTab === 'followers' && (
            /* ===== FOLLOWERS TAB CONTENT ===== */
            <View style={styles.tabContent}>
              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>FOLLOWERS ({followers.length})</Text>
                {followers.length === 0 ? (
                  <Text style={styles.noTrophiesText}>You have no followers yet.</Text>
                ) : (
                  followers.map(f => (
                    <View key={f.id} style={styles.friendRow}>
                      <View style={[styles.friendAvatar, { borderColor: f.color || '#00BFFF' }]}>
                        <Text style={styles.friendAvatarEmoji}>
                          {CHARACTER_EMOJI[f.character_type as CharacterType] || '🏃'}
                        </Text>
                      </View>
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName}>{f.display_name}</Text>
                        <Text style={styles.friendClass}>{f.character_type?.toUpperCase()}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.panelCard}>
                <Text style={styles.panelTitle}>FOLLOWING ({following.length})</Text>
                {following.length === 0 ? (
                  <Text style={styles.noTrophiesText}>You are not following anyone.</Text>
                ) : (
                  following.map(f => (
                    <View key={f.id} style={styles.friendRow}>
                      <View style={[styles.friendAvatar, { borderColor: f.color || '#00BFFF' }]}>
                        <Text style={styles.friendAvatarEmoji}>
                          {CHARACTER_EMOJI[f.character_type as CharacterType] || '🏃'}
                        </Text>
                      </View>
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName}>{f.display_name}</Text>
                        <Text style={styles.friendClass}>{f.character_type?.toUpperCase()}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeFriendBtn}
                        onPress={() => handleUnfollow(f.id)}
                      >
                        <Text style={styles.removeFriendBtnText}>Unfollow</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Edit Profile Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>EDIT PROFILE</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <TouchableOpacity style={styles.modalAvatarContainer} onPress={pickImage}>
                {editAvatarUrl ? (
                  <Image source={{ uri: editAvatarUrl }} style={styles.modalAvatarImage} />
                ) : (
                  <View style={styles.modalAvatarPlaceholder}>
                    <Text style={styles.modalAvatarEmoji}>{CHARACTER_EMOJI[editCharacter as CharacterType] || '🏃'}</Text>
                    <Text style={styles.modalAvatarLabel}>TAP TO EDIT PHOTO</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Text style={styles.inputLabel}>COVER BACKGROUND</Text>
              {editCoverImageUrl ? (
                <View style={styles.coverSelector}>
                  <Image source={{ uri: editCoverImageUrl }} style={styles.coverSelectorPreview} />
                  <TouchableOpacity style={styles.changeCoverBtn} onPress={pickCoverImage}>
                    <Text style={styles.changeCoverText}>Change Cover Photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.coverSelectorPlaceholder} onPress={pickCoverImage}>
                  <Text style={styles.coverSelectorPlaceholderText}>🖼️ Choose Cover Background</Text>
                </TouchableOpacity>
              )}

              <Text style={styles.inputLabel}>DISPLAY NAME</Text>
              <TextInput
                style={styles.textInput}
                value={editDisplayName}
                onChangeText={setEditDisplayName}
                placeholder="Enter display name"
                placeholderTextColor="#4A4A6A"
              />

              <Text style={styles.inputLabel}>BIO</Text>
              <TextInput
                style={[styles.textInput, { height: 80, textAlignVertical: 'top', paddingTop: 10 }]}
                value={editBio}
                onChangeText={setEditBio}
                placeholder="Write a bio about yourself..."
                placeholderTextColor="#4A4A6A"
                multiline
                numberOfLines={3}
              />

              <Text style={styles.inputLabel}>CHARACTER CLASS</Text>
              <View style={styles.pickerRow}>
                {(['scout', 'warrior', 'ninja', 'mage'] as const).map((char) => (
                  <TouchableOpacity
                    key={char}
                    style={[styles.pickerBox, editCharacter === char && styles.pickerBoxActive]}
                    onPress={() => setEditCharacter(char)}
                  >
                    <Text style={styles.pickerEmoji}>{CHARACTER_EMOJI[char]}</Text>
                    <Text style={styles.pickerLabel}>{char.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>TERRITORY COLOR</Text>
              <View style={styles.colorRow}>
                {Array.from(new Set(['#FF4D4D', '#1E90FF', ...(stats?.unlocked_colors || [])])).map((col) => (
                  <TouchableOpacity
                    key={col}
                    style={[
                      styles.colorCircle,
                      { backgroundColor: col },
                      editColor === col && { borderColor: '#FFFFFF', borderWidth: 3 },
                    ]}
                    onPress={() => setEditColor(col)}
                  />
                ))}
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile}>
                <Text style={styles.saveBtnText}>SAVE CHANGES</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Past Run Detail Modal */}
      <Modal visible={detailModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>RUN DETAILS</Text>
              <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingDetail ? (
              <View style={styles.modalLoadingCenter}>
                <ActivityIndicator color={color} size="large" />
                <Text style={styles.modalLoadingText}>Loading run details...</Text>
              </View>
            ) : runStats ? (
              <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
                <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 0.9 }}>
                  <View style={styles.detailCardShot}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailCardTitle}>STRIDECLASH ARENA RUN</Text>
                      <Text style={styles.detailCardDate}>{formatDate(selectedRun.created_at)}</Text>
                    </View>

                    {runStats.mapRegion && (
                      <View style={styles.detailMapContainer}>
                        <MapView
                          provider={PROVIDER_GOOGLE}
                          style={styles.detailMap}
                          mapType="satellite"
                          region={runStats.mapRegion}
                          scrollEnabled={false}
                          zoomEnabled={false}
                          pitchEnabled={false}
                          rotateEnabled={false}
                        >
                          <Polyline
                            coordinates={runStats.points}
                            strokeColor={color}
                            strokeWidth={4}
                          />
                          {runStats.points.length > 0 && (
                            <Marker coordinate={runStats.points[0]} pinColor="#FFD700" title="START" />
                          )}
                          {runStats.points.length > 0 && (
                            <Marker coordinate={runStats.points[runStats.points.length - 1]} pinColor="#FF0000" title="END" />
                          )}
                        </MapView>
                      </View>
                    )}

                    <View style={styles.detailStatsGrid}>
                      <View style={styles.detailStatBox}>
                        <Text style={styles.detailStatVal}>{runStats.distanceKm}</Text>
                        <Text style={styles.detailStatLbl}>DISTANCE (KM)</Text>
                      </View>
                      <View style={styles.detailStatBox}>
                        <Text style={styles.detailStatVal}>{runStats.durationStr}</Text>
                        <Text style={styles.detailStatLbl}>DURATION</Text>
                      </View>
                    </View>

                    <View style={styles.detailStatsGrid}>
                      <View style={styles.detailStatBox}>
                        <Text style={styles.detailStatVal}>{runStats.paceStr}</Text>
                        <Text style={styles.detailStatLbl}>AVG PACE (MIN/KM)</Text>
                      </View>
                      <View style={styles.detailStatBox}>
                        <Text style={styles.detailStatVal}>{runStats.averageSpeedKmh}</Text>
                        <Text style={styles.detailStatLbl}>AVG SPEED (KM/H)</Text>
                      </View>
                    </View>
                  </View>
                </ViewShot>

                <View style={styles.modalShareRow}>
                  <TouchableOpacity
                    style={[styles.modalShareBtn, { backgroundColor: '#E1306C' }]}
                    onPress={handleSharePastRun}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalShareBtnText}>📸  INSTAGRAM</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalShareBtn, { backgroundColor: '#25D366' }]}
                    onPress={handleSharePastRun}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.modalShareBtnText}>💬  WHATSAPP</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.modalLoadingCenter}>
                <Text style={styles.modalLoadingText}>No coordinates captured for this run.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  loadingCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingBottom: 40 },

  // Profile header
  profileHeaderContainer: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    backgroundColor: '#111124',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E38',
  },
  avatarBorder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D1A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  profileImage: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  avatarPlaceholder: {
    width: 86,
    height: 86,
    borderRadius: 43,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16162A',
  },
  avatarEmoji: { fontSize: 44 },
  displayNameText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  bioText: {
    fontSize: 13,
    color: '#8A8AAB',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  editProfileBtn: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#00BFFF',
    backgroundColor: '#00BFFF11',
  },
  editProfileBtnText: {
    color: '#00BFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // Level progress
  progressContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#16162A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A44',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLevelText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  progressXpText: {
    fontSize: 13,
    fontWeight: '900',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#0D0D1A',
    borderRadius: 4,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  progressSub: {
    fontSize: 10,
    color: '#4A4A6A',
    fontWeight: '800',
  },
  progressPercent: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '900',
  },

  // Dual Tabs
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#111124',
    borderBottomWidth: 1.5,
    borderBottomColor: '#1E1E38',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderBottomWidth: 3,
    borderBottomColor: '#00BFFF',
  },
  tabButtonText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4A4A6A',
    letterSpacing: 0.5,
  },
  tabButtonTextActive: {
    color: '#00BFFF',
  },

  tabContent: { padding: 16 },

  // Stats Grid Card
  statsGridRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#16162A',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  statCardValue: { fontSize: 24, fontWeight: '900', color: '#FFFFFF' },
  statCardUnit: { fontSize: 9, color: '#4A4A6A', fontWeight: '800', marginTop: 1 },
  statCardLabel: { fontSize: 10, color: '#8A8AAB', fontWeight: '800', marginTop: 4, letterSpacing: 0.5 },

  // Panels
  panelCard: {
    backgroundColor: '#16162A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    padding: 16,
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#4A4A6A',
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  characterRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  characterClassEmoji: { fontSize: 44 },
  characterInfo: { flex: 1 },
  characterNameText: { fontSize: 16, fontWeight: '900' },
  characterDescText: { fontSize: 12, color: '#8A8AAB', lineHeight: 18, marginTop: 4 },

  // Trophies Grid
  activityDistributionContainer: { marginTop: 10 },
  stackedBar: { flexDirection: 'row', height: 24, borderRadius: 12, overflow: 'hidden', marginBottom: 15 },
  stackedSegment: { height: '100%' },
  activityLegendRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { color: '#CCC', fontSize: 12, fontWeight: 'bold' },
  noTrophiesText: { color: '#4A4A6A', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  trophiesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  trophyItem: {
    width: '48%',
    backgroundColor: '#0D0D1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    padding: 10,
    alignItems: 'center',
  },
  trophyEmoji: { fontSize: 32 },
  trophyName: { fontSize: 12, fontWeight: '900', color: '#FFFFFF', marginTop: 6 },
  trophyDesc: { fontSize: 9, color: '#4A4A6A', textAlign: 'center', marginTop: 2, lineHeight: 12 },

  // History Log Items
  runRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D0D1A',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  runIndexBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runIndexBadgeText: { fontSize: 12, fontWeight: '900' },
  runRowInfo: { flex: 1 },
  runRowDistance: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  runRowDate: { fontSize: 11, color: '#4A4A6A', marginTop: 2 },
  runRowArrow: { fontSize: 16, color: '#4A4A6A', fontWeight: 'bold' },

  // My Posts Tab
  myPostCard: {
    backgroundColor: '#16162A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A4A',
    padding: 16,
    marginBottom: 16,
  },
  postCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  postCardDate: { fontSize: 11, color: '#4A4A6A', fontWeight: '600' },
  deletePostText: { fontSize: 11, color: '#FF3B30', fontWeight: '700' },
  postCardContent: { fontSize: 14, color: '#CCCCCC', marginTop: 10, lineHeight: 20 },
  postCardImage: { width: '100%', height: 200, borderRadius: 8, marginTop: 10, backgroundColor: '#0D0D1A' },
  postCardFooter: { flexDirection: 'row', gap: 14, marginTop: 12, borderTopWidth: 1, borderTopColor: '#2A2A4A44', paddingTop: 10 },
  postCardFootText: { fontSize: 11, color: '#4A4A6A', fontWeight: '600' },

  emptyContainer: { alignItems: 'center', paddingVertical: 80 },
  emptyEmojiText: { fontSize: 64, marginBottom: 16 },
  emptyTitleText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  emptySubtitleText: { color: '#4A4A6A', fontSize: 12, marginTop: 6, textAlign: 'center', paddingHorizontal: 20 },

  logoutButton: {
    marginHorizontal: 4,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#FF3B3015',
    borderWidth: 1,
    borderColor: '#FF3B3044',
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#FF3B30',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1.5,
  },

  // Modals Overlay & Styling
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111124',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    paddingBottom: 40,
    borderWidth: 1.5,
    borderColor: '#2A2A4A',
    borderBottomWidth: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
  },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  closeBtn: { fontSize: 20, color: '#8A8AAB', fontWeight: 'bold' },
  modalScroll: { padding: 20 },

  modalAvatarContainer: {
    alignSelf: 'center',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#0D0D1A',
    borderWidth: 2,
    borderColor: '#2A2A4A',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 20,
  },
  modalAvatarImage: { width: '100%', height: '100%' },
  modalAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  modalAvatarEmoji: { fontSize: 40 },
  modalAvatarLabel: { fontSize: 8, color: '#4A4A6A', fontWeight: 'bold', marginTop: 4, textAlign: 'center' },
  inputLabel: { fontSize: 10, fontWeight: '900', color: '#4A4A6A', letterSpacing: 1, marginBottom: 8, marginTop: 12 },
  textInput: {
    backgroundColor: '#0D0D1A',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  pickerBox: {
    flex: 1,
    backgroundColor: '#0D0D1A',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  pickerBoxActive: {
    borderColor: '#00BFFF',
    borderWidth: 2,
    backgroundColor: '#00BFFF15',
  },
  pickerEmoji: { fontSize: 22 },
  pickerLabel: { fontSize: 8, fontWeight: 'bold', marginTop: 4, color: '#8A8AAB' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  saveBtn: {
    backgroundColor: '#00BFFF',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 32,
  },
  saveBtnText: { color: '#0D0D1A', fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },

  // Past Run Details Modal
  modalLoadingCenter: { paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },
  modalLoadingText: { fontSize: 14, color: '#00BFFF', fontWeight: '600', marginTop: 12 },
  detailCardShot: {
    backgroundColor: '#0D0D1A',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2A2A4A',
    padding: 16,
    marginBottom: 20,
  },
  detailCardHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
    paddingBottom: 12,
    marginBottom: 16,
  },
  detailCardTitle: { fontSize: 11, fontWeight: '900', color: '#4A4A6A', letterSpacing: 2 },
  detailCardDate: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', marginTop: 4 },
  detailMapContainer: { height: 180, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#2A2A4A', marginBottom: 16 },
  detailMap: { ...StyleSheet.absoluteFill },
  detailStatsGrid: { flexDirection: 'row', marginBottom: 12, gap: 12 },
  detailStatBox: { flex: 1, backgroundColor: '#16162A', borderWidth: 1, borderColor: '#2A2A4A', borderRadius: 8, padding: 12 },
  detailStatVal: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
  detailStatLbl: { fontSize: 8, fontWeight: '900', color: '#4A4A6A', letterSpacing: 1, marginTop: 4 },
  modalShareRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  modalShareBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', elevation: 4 },
  modalShareBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },

  // Cover Background Header Styles
  coverContainer: { width: '100%', height: 140, position: 'relative' },
  coverImage: { width: '100%', height: '100%' },
  coverPlaceholder: { width: '100%', height: '100%' },
  changeCoverFloatingBtn: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  changeCoverFloatingText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },

  // Weekly Distance Bar Graph Styles
  chartBarRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 150, paddingHorizontal: 10, marginTop: 12 },
  chartCol: { alignItems: 'center', flex: 1 },
  chartValText: { fontSize: 8, fontWeight: 'bold', color: '#8A8AAB', marginBottom: 4 },
  chartBarBg: { width: 14, height: 100, backgroundColor: '#16162A', borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
  chartBarFill: { width: '100%', borderRadius: 8 },
  chartLabelText: { fontSize: 9, fontWeight: 'bold', color: '#4A4A6A', marginTop: 6 },

  // Calories Progress Card Styles
  calorieCardContent: { flexDirection: 'row', gap: 16, alignItems: 'center', marginTop: 12 },
  calorieCircleContainer: { width: 70, height: 70, borderRadius: 35, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16162A' },
  calorieBigValue: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  calorieSubText: { fontSize: 8, fontWeight: '800', color: '#4A4A6A', marginTop: 1 },
  calorieProgressInfo: { flex: 1 },
  calorieGoalText: { fontSize: 11, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 4 },
  calorieBarBg: { width: '100%', height: 6, backgroundColor: '#16162A', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  calorieBarFill: { height: '100%', borderRadius: 3 },
  calorieEquivalentText: { fontSize: 11, color: '#8A8AAB', fontStyle: 'italic' },

  // Customization Arena Shop Styles
  shopHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  coinsBalance: { fontSize: 13, fontWeight: '900', color: '#FFD700' },
  shopSubText: { fontSize: 11, color: '#4A4A6A', marginTop: 2, marginBottom: 12 },
  shopGrid: { flexDirection: 'column', gap: 10 },
  shopItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16162A', borderWidth: 1, borderColor: '#2A2A4A', borderRadius: 8, padding: 10 },
  shopColorIndicator: { width: 16, height: 16, borderRadius: 8, marginRight: 10 },
  shopColorName: { flex: 1, fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  unlockedBadge: { backgroundColor: '#00FA9A22', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  unlockedText: { color: '#00FA9A', fontSize: 10, fontWeight: '900' },
  unlockBtn: { backgroundColor: '#FFD700', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  unlockBtnText: { color: '#0D0D1A', fontSize: 11, fontWeight: '900' },

  // Avatar Shop Styles
  checkMilestoneBtn: { backgroundColor: '#2A2A4A', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#FFD70044' },
  checkMilestoneBtnText: { color: '#FFD700', fontSize: 10, fontWeight: '900' },
  activeAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  activeAvatarBubble: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16162A' },
  activeAvatarEmoji: { fontSize: 28 },
  collectionBox: { backgroundColor: '#16162A', borderRadius: 10, borderWidth: 1, borderColor: '#2A2A4A', padding: 12, marginBottom: 12 },
  shopSubSection: { fontSize: 10, fontWeight: '900', color: '#4A4A6A', letterSpacing: 1.2, marginBottom: 8 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatarSlot: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D1A', borderWidth: 1, borderColor: '#2A2A4A', position: 'relative' },
  avatarSlotEmoji: { fontSize: 22 },
  activeIndicatorDot: { position: 'absolute', bottom: 1, right: 1, width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: '#0D0D1A' },
  progressBarContainer: { width: '100%', gap: 3 },
  milestoneBarFill: { height: 4, borderRadius: 2 },
  progressBarLabel: { fontSize: 9, color: '#8A8AAB', fontWeight: '700' },
  progressBarTrack: { width: '100%', height: 4, backgroundColor: '#2A2A4A', borderRadius: 2, overflow: 'hidden' },
  avatarShopLeft: { width: 52, alignItems: 'center', marginRight: 12 },
  avatarShopEmoji: { fontSize: 26 },
  avatarShopKm: { fontSize: 9, color: '#8A8AAB', fontWeight: '700', marginTop: 2 },
  avatarShopCenter: { flex: 1, gap: 6 },

  // Friends Tab Styles
  friendRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16162A', borderWidth: 1, borderColor: '#2A2A4A', borderRadius: 8, padding: 10, marginBottom: 10 },
  friendAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D1A', marginRight: 12 },
  friendAvatarEmoji: { fontSize: 18 },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  friendClass: { fontSize: 9, color: '#4A4A6A', fontWeight: '800', marginTop: 2 },
  removeFriendBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#FF3B3022', borderWidth: 1, borderColor: '#FF3B3044' },
  removeFriendBtnText: { color: '#FF3B30', fontSize: 11, fontWeight: '900' },

  // Cover Image Selectors Inside Edit Modal
  coverSelector: { width: '100%', height: 100, borderRadius: 8, overflow: 'hidden', position: 'relative', marginBottom: 16 },
  coverSelectorPreview: { width: '100%', height: '100%' },
  changeCoverBtn: { position: 'absolute', bottom: 8, right: 8, backgroundColor: '#0D0D1AEE', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#2A2A4A' },
  changeCoverText: { color: '#00BFFF', fontSize: 10, fontWeight: '900' },
  coverSelectorPlaceholder: { width: '100%', height: 80, borderRadius: 8, borderStyle: 'dashed', borderWidth: 1.5, borderColor: '#2A2A4A', backgroundColor: '#16162A', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  coverSelectorPlaceholderText: { color: '#8A8AAB', fontSize: 12, fontWeight: '800' },
});
