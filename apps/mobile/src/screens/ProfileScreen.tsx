/**
 * ProfileScreen — Player stats, run history, and profile customization.
 * Revamped to match the premium, clean Adidas Running aesthetic.
 */
import React, { useEffect, useState, useCallback } from 'react';
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

function StatCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={statStyles.card}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.unit}>{unit}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    marginHorizontal: 4,
  },
  value: { fontSize: 24, fontWeight: '900', color: '#000000' },
  unit: { fontSize: 10, color: '#8A8A8A', fontWeight: '700', marginTop: 2 },
  label: { fontSize: 9, color: '#8A8A8A', letterSpacing: 1, marginTop: 4, fontWeight: '700' },
});

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ProfileScreen() {
  const { user, setCharacterAndColor } = useAuth();
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'all' | 'month' | 'week'>('all');

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

  const runStats = React.useMemo(() => {
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
      const [profileRes, runsRes] = await Promise.all([
        fetch(`${API_URL}/profile/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
        fetch(`${API_URL}/runs/${user.uid}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }),
      ]);
      const profileData = await profileRes.json();
      const runsData = await runsRes.json();
      setStats(profileData);
      setRuns(runsData);

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
  }, [user?.uid]);

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
        // Update local auth context
        await setCharacterAndColor(editCharacter as any, editColor);
      } else {
        Alert.alert('Error', 'Failed to update profile.');
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to connect to server.');
    }
  };

  const characterType = stats?.character_type ?? user?.characterType ?? 'scout';
  const color = stats?.color ?? user?.color ?? '#00BFFF';
  const displayName = stats?.display_name ?? user?.displayName ?? 'Runner';
  const bioText = stats?.bio || 'Add a bio to your profile';
  const avatarUrl = stats?.avatar_url || '';
  const emoji = CHARACTER_EMOJI[characterType as CharacterType] ?? '🏃';

  // Interactive filtering of runs
  const filteredRuns = React.useMemo(() => {
    const now = new Date();
    return runs.filter(run => {
      const runDate = new Date(run.created_at);
      if (timeframe === 'week') {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return runDate >= oneWeekAgo;
      }
      if (timeframe === 'month') {
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return runDate >= oneMonthAgo;
      }
      return true;
    });
  }, [runs, timeframe]);

  const displayRunsCount = timeframe === 'all' ? (stats?.total_runs ?? 0) : filteredRuns.length;
  const displayDistanceKm = timeframe === 'all'
    ? ((stats?.total_distance ?? 0) / 1000).toFixed(1)
    : (filteredRuns.reduce((sum, r) => sum + r.distance_meters, 0) / 1000).toFixed(1);
  const totalTerritoryKm2 = ((stats?.total_territory ?? 0) / 1_000_000).toFixed(4);

  // Calculate XP (club points) and Level based on All-Time stats
  const xp = Math.round((stats?.total_distance ?? 0) / 100) + Math.round((stats?.total_territory ?? 0) / 500);
  const level = Math.floor(xp / 100) + 1;
  const currentLevelXp = xp % 100;
  const xpProgress = currentLevelXp / 100;
  
  let rankTitle = 'Recruit Runner';
  if (level >= 13) rankTitle = 'Arena Overlord';
  else if (level >= 8) rankTitle = 'Territory Raider';
  else if (level >= 4) rankTitle = 'Pace Elite';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={color} size="large" />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* ── Adidas Header Banner ── */}
          <View style={styles.bannerContainer}>
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1448375240586-882707db888b?q=80&w=600&auto=format&fit=crop' }}
              style={styles.bannerImage as any}
            />
            {/* White overlay ring around circular photo */}
            <View style={[styles.avatarContainer, { borderColor: color, borderWidth: 2.5 }]}>
              <TouchableOpacity
                onPress={() => setEditModalVisible(true)}
                activeOpacity={0.9}
                style={styles.avatarTouchable}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarPhoto as any} resizeMode="cover" />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarEmoji}>{emoji}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Pencil edit icon on banner */}
            <TouchableOpacity
              style={styles.editPencil}
              onPress={() => setEditModalVisible(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.editPencilText}>✏️</Text>
            </TouchableOpacity>
          </View>

          {/* ── User Details Block ── */}
          <View style={styles.detailsBlock}>
            <Text style={styles.displayName}>{displayName.toUpperCase()}</Text>
            
            <View style={styles.countryRow}>
              <Text style={styles.flagEmoji}>🇮🇳</Text>
              <Text style={styles.countryName}>India</Text>
            </View>

            <Text style={[styles.bioText, !stats?.bio && { color: '#8A8A8A', fontStyle: 'italic' }]}>
              {bioText}
            </Text>

            <View style={styles.followersRow}>
              <Text style={styles.followersText}>0 FOLLOWERS</Text>
              <Text style={styles.divider}>|</Text>
              <Text style={styles.followersText}>0 FOLLOWING</Text>
            </View>

            <TouchableOpacity
              style={styles.viewFullProfileBtn}
              onPress={() => setEditModalVisible(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.viewFullProfileText}>EDIT PROFILE   →</Text>
            </TouchableOpacity>
          </View>

          {/* ── Timeframe Switcher ── */}
          <View style={styles.timeframeRow}>
            {(['all', 'month', 'week'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.timeframeBtn,
                  timeframe === t && [styles.timeframeBtnActive, { backgroundColor: color, borderColor: color }],
                ]}
                onPress={() => setTimeframe(t)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.timeframeBtnText,
                    timeframe === t && styles.timeframeBtnTextActive,
                  ]}
                >
                  {t === 'all' ? 'ALL TIME' : t === 'month' ? 'LAST 30 DAYS' : 'THIS WEEK'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Stats Summary cards ── */}
          <View style={styles.statsRow}>
            <StatCard label="RUNS" value={String(displayRunsCount)} unit="sessions" />
            <StatCard label="DISTANCE" value={displayDistanceKm} unit="km total" />
            <StatCard label="TERRITORY" value={totalTerritoryKm2} unit="km²" />
          </View>

          {/* ── Arena Rank & Progression Card ── */}
          <View style={styles.arenaCard}>
            <Text style={styles.arenaCardTitle}>RUNWARS CHAMPIONSHIP RANK</Text>
            <View style={styles.arenaBox}>
              <View style={styles.arenaHeader}>
                <View>
                  <Text style={[styles.arenaLevel, { color }]}>LEVEL {level}</Text>
                  <Text style={styles.arenaTitle}>{rankTitle.toUpperCase()}</Text>
                </View>
                <View style={[styles.arenaPointsBox, { backgroundColor: color + '15' }]}>
                  <Text style={[styles.arenaPointsText, { color }]}>{xp} XP</Text>
                </View>
              </View>
              
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { backgroundColor: color, width: `${xpProgress * 100}%` }]} />
              </View>
              
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressSub}>{currentLevelXp} / 100 XP TO LEVEL {level + 1}</Text>
                <Text style={styles.progressPercent}>{Math.round(xpProgress * 100)}%</Text>
              </View>
            </View>
          </View>

          {/* ── Character Class Showcase Card ── */}
          <View style={styles.classCard}>
            <Text style={styles.classCardTitle}>ACTIVE CHARACTER CLASS</Text>
            <View style={[styles.classBox, { borderColor: color + '30', backgroundColor: color + '08' }]}>
              <Text style={styles.classEmoji}>{emoji}</Text>
              <View style={styles.classInfo}>
                <Text style={[styles.className, { color }]}>{characterType.toUpperCase()}</Text>
                <Text style={styles.classDesc}>
                  {characterType === 'scout' && '⚡ Scout: Specializes in speed. Gains 10% faster GPS coordinates and agile territory capture rates.'}
                  {characterType === 'warrior' && '🛡️ Warrior: Defends territory with high strength. Reduces decay rate and strengthens defensive claim zones.'}
                  {characterType === 'ninja' && '🥷 Ninja: Stealth and quick strikes. Undetected when passing borders, allowing sneak attacks.'}
                  {characterType === 'mage' && '🧙 Mage: Wizard zone expansions. Uses special mana claims to increase territory range by 15%.'}
                </Text>
              </View>
            </View>
          </View>



          {/* ── Run History ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RUN HISTORY</Text>
            {runs.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Text style={styles.emptyHistoryText}>No runs yet — get out there! 🏃</Text>
              </View>
            ) : (
              runs.map((run, i) => (
                <TouchableOpacity
                  key={run.id}
                  style={styles.runRow}
                  onPress={() => handleViewRunDetails(run.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.runIndex, { backgroundColor: color + '15' }]}>
                    <Text style={[styles.runIndexText, { color }]}>#{runs.length - i}</Text>
                  </View>
                  <View style={styles.runInfo}>
                    <Text style={styles.runDist}>{(run.distance_meters / 1000).toFixed(2)} km</Text>
                    <Text style={styles.runDate}>{formatDate(run.created_at)}</Text>
                  </View>
                  <Text style={styles.historyArrow}>→</Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* ── Logout ── */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={styles.logoutText}>↩   LOG OUT</Text>
          </TouchableOpacity>

          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>EDIT PROFILE</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              {/* Avatar Selection */}
              <TouchableOpacity style={styles.modalAvatarContainer} onPress={pickImage}>
                {editAvatarUrl ? (
                  <Image source={{ uri: editAvatarUrl }} style={styles.modalAvatarImage as any} resizeMode="cover" />
                ) : (
                  <View style={styles.modalAvatarPlaceholder}>
                    <Text style={styles.modalAvatarEmoji}>{CHARACTER_EMOJI[editCharacter as CharacterType] || '🏃'}</Text>
                    <Text style={styles.modalAvatarLabel}>TAP TO CHOOSE PHOTO</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Display Name Input */}
              <Text style={styles.inputLabel}>DISPLAY NAME</Text>
              <TextInput
                style={styles.textInput}
                value={editDisplayName}
                onChangeText={setEditDisplayName}
                placeholder="Enter display name"
                placeholderTextColor="#A0A0A0"
              />

              {/* Bio Input */}
              <Text style={styles.inputLabel}>BIO</Text>
              <TextInput
                style={[styles.textInput, { height: 80, textAlignVertical: 'top', paddingTop: 10 }]}
                value={editBio}
                onChangeText={setEditBio}
                placeholder="Write a bio about yourself..."
                placeholderTextColor="#A0A0A0"
                multiline={true}
                numberOfLines={3}
              />

              {/* Character Type Picker */}
              <Text style={styles.inputLabel}>CHARACTER CLASS</Text>
              <View style={styles.pickerRow}>
                {(['scout', 'warrior', 'ninja', 'mage'] as const).map((char) => (
                  <TouchableOpacity
                    key={char}
                    style={[
                      styles.pickerBox,
                      editCharacter === char && styles.pickerBoxActive,
                    ]}
                    onPress={() => setEditCharacter(char)}
                  >
                    <Text style={styles.pickerEmoji}>{CHARACTER_EMOJI[char]}</Text>
                    <Text style={styles.pickerLabel}>{char.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Color Selector */}
              <Text style={styles.inputLabel}>TERRITORY COLOR</Text>
              <View style={styles.colorRow}>
                {['#FF4D4D', '#FF8C00', '#FFD700', '#00FA9A', '#00CED1', '#1E90FF', '#7B68EE', '#DA70D6'].map((col) => (
                  <TouchableOpacity
                    key={col}
                    style={[
                      styles.colorCircle,
                      { backgroundColor: col },
                      editColor === col && { borderColor: '#000000', borderWidth: 3 },
                    ]}
                    onPress={() => setEditColor(col)}
                  />
                ))}
              </View>

              {/* Action Buttons */}
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveProfile}
                activeOpacity={0.85}
              >
                <Text style={styles.saveBtnText}>SAVE CHANGES</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Past Run Detail Modal ── */}
      <Modal
        visible={detailModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDetailModalVisible(false)}
      >
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
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  loadingCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Adidas Banner
  bannerContainer: {
    height: 180,
    backgroundColor: '#E0E0E0',
    position: 'relative',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  avatarContainer: {
    position: 'absolute',
    bottom: -50,
    left: 20,
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  avatarPhoto: {
    width: 94,
    height: 94,
    borderRadius: 47,
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 47,
    borderWidth: 3,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 50 },
  editPencil: {
    position: 'absolute',
    top: 15,
    right: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editPencilText: { fontSize: 18 },

  // Profile Details Block
  detailsBlock: {
    paddingTop: 64,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  displayName: {
    fontSize: 26,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 0.5,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  flagEmoji: { fontSize: 16 },
  countryName: { fontSize: 14, color: '#6A6A6A', marginLeft: 6, fontWeight: '500' },
  bioText: {
    fontSize: 14,
    color: '#4A4A4A',
    marginTop: 12,
    lineHeight: 20,
  },
  followersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  followersText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: 0.5,
    borderBottomWidth: 1.5,
    borderBottomColor: '#000000',
    paddingBottom: 2,
  },
  divider: { color: '#8A8A8A', fontSize: 12 },
  viewFullProfileBtn: {
    marginTop: 20,
    backgroundColor: '#000000',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 4,
  },
  viewFullProfileText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1.5,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },

  avatarTouchable: {
    width: 94,
    height: 94,
    borderRadius: 47,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Timeframe Switcher
  timeframeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 18,
    gap: 8,
  },
  timeframeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeframeBtnActive: {
    borderWidth: 1.5,
  },
  timeframeBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 0.5,
  },
  timeframeBtnTextActive: {
    color: '#FFFFFF',
  },

  // Arena Rank Card
  arenaCard: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  arenaCardTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  arenaBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 16,
  },
  arenaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  arenaLevel: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  arenaTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    marginTop: 2,
    letterSpacing: 1,
  },
  arenaPointsBox: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  arenaPointsText: {
    fontSize: 13,
    fontWeight: '900',
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#EBEBEB',
    borderRadius: 4,
    marginTop: 16,
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
    fontSize: 9,
    color: '#8A8A8A',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  progressPercent: {
    fontSize: 10,
    color: '#000000',
    fontWeight: '900',
  },

  // Class Card
  classCard: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  classCardTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  classBox: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    gap: 16,
  },
  classEmoji: {
    fontSize: 44,
  },
  classInfo: {
    flex: 1,
  },
  className: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  classDesc: {
    fontSize: 12,
    color: '#4A4A4A',
    lineHeight: 18,
    marginTop: 4,
    fontWeight: '500',
  },

  // Section History
  section: { paddingHorizontal: 20, marginTop: 10 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  emptyHistory: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
  },
  emptyHistoryText: { color: '#8A8A8A', fontSize: 13 },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    gap: 14,
  },
  runIndex: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runIndexText: { fontSize: 13, fontWeight: '900' },
  runInfo: { flex: 1 },
  runDist: { fontSize: 18, fontWeight: '900', color: '#000000' },
  runDate: { fontSize: 12, color: '#8A8A8A', marginTop: 2, fontWeight: '500' },
  historyArrow: { fontSize: 18, color: '#8A8A8A', fontWeight: 'bold' },

  logoutBtn: {
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 4,
    backgroundColor: '#FFEBEE',
    borderWidth: 1.5,
    borderColor: '#FFCDD2',
    alignItems: 'center',
  },
  logoutText: {
    color: '#C62828',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.5,
  },

  // Modal Editing style
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
  },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#000000', letterSpacing: 1 },
  closeBtn: { fontSize: 20, color: '#8A8A8A', fontWeight: 'bold' },
  modalScroll: { padding: 20 },
  modalAvatarContainer: {
    alignSelf: 'center',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F5F5F7',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
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
  modalAvatarLabel: { fontSize: 8, color: '#8A8A8A', fontWeight: 'bold', marginTop: 4, textAlign: 'center' },
  inputLabel: { fontSize: 10, fontWeight: '900', color: '#8A8A8A', letterSpacing: 1, marginBottom: 8, marginTop: 12 },
  textInput: {
    backgroundColor: '#F5F5F7',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 4,
    padding: 12,
    fontSize: 14,
    color: '#000000',
    fontWeight: '500',
  },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  pickerBox: {
    flex: 1,
    backgroundColor: '#F5F5F7',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 4,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  pickerBoxActive: {
    borderColor: '#000000',
    borderWidth: 2,
    backgroundColor: '#EAEAEA',
  },
  pickerEmoji: { fontSize: 22 },
  pickerLabel: { fontSize: 8, fontWeight: 'bold', marginTop: 4 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  saveBtn: {
    backgroundColor: '#000000',
    borderRadius: 4,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 32,
  },
  saveBtnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14, letterSpacing: 1.5 },

  // Past Run Detail styles
  modalLoadingCenter: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalLoadingText: {
    fontSize: 14,
    color: '#8A8A8A',
    fontWeight: '600',
    marginTop: 12,
  },
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
  detailCardTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 2,
  },
  detailCardDate: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  detailMapContainer: {
    height: 180,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    marginBottom: 16,
  },
  detailMap: {
    ...StyleSheet.absoluteFill,
  },
  detailStatsGrid: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 12,
  },
  detailStatBox: {
    flex: 1,
    backgroundColor: '#16162A',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    borderRadius: 8,
    padding: 12,
  },
  detailStatVal: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  detailStatLbl: {
    fontSize: 8,
    fontWeight: '900',
    color: '#8A8A8A',
    letterSpacing: 1,
    marginTop: 4,
  },
  modalShareRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  modalShareBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  modalShareBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
