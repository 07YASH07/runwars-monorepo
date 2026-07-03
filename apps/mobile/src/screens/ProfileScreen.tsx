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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'stats' | 'posts'>('stats');

  // Edit Mode state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCharacter, setEditCharacter] = useState('scout');
  const [editColor, setEditColor] = useState('#00BFFF');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');

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
        fetch(`${API_URL}/profile/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
        fetch(`${API_URL}/runs/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
        fetch(`${API_URL}/api/feed?userId=${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
      ]);
      const profileData = await profileRes.json();
      const runsData = await runsRes.json();
      const feedData = await feedRes.json();

      setStats(profileData);
      setRuns(runsData);
      
      // Filter feed for only posts created by logged-in user
      const userPosts = feedData
        .filter((item: any) => item.feed_type === 'post' && item.user_id === user.uid)
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
      setEditDisplayName(profileData.display_name || user.displayName || 'Runner');
      setEditBio(profileData.bio || '');
      setEditCharacter(profileData.character_type || user.characterType || 'scout');
      setEditColor(profileData.color || user.color || '#00BFFF');
      setEditAvatarUrl(profileData.avatar_url || '');
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

          {/* Double Tab Row */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'stats' && styles.tabButtonActive]}
              onPress={() => setActiveTab('stats')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'stats' && styles.tabButtonTextActive]}>
                📈 STATS & HISTORY
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'posts' && styles.tabButtonActive]}
              onPress={() => setActiveTab('posts')}
            >
              <Text style={[styles.tabButtonText, activeTab === 'posts' && styles.tabButtonTextActive]}>
                🖼️ MY POSTS ({myPosts.length})
              </Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'stats' ? (
            /* ===== STATS TAB CONTENT ===== */
            <View style={styles.tabContent}>
              {/* StatCards Row */}
              <View style={styles.statsGridRow}>
                <StatCard label="RUNS" value={String(stats?.total_runs || 0)} unit="sessions" />
                <StatCard label="DISTANCE" value={totalDistanceKm} unit="km" />
                <StatCard label="TERRITORY" value={totalTerritoryKm2} unit="km²" />
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
          ) : (
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
                {['#FF4D4D', '#FF8C00', '#FFD700', '#00FA9A', '#00CED1', '#1E90FF', '#7B68EE', '#DA70D6'].map((col) => (
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
                      <Text style={styles.detailCardTitle}>RUNWARS ARENA RUN</Text>
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
});
