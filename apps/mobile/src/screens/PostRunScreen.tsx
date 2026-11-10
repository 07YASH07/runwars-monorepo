/**
 * PostRunScreen — Animated summary shown immediately after a run finishes.
 * Displays distance, duration, speed, territory, and an XP counter.
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  StatusBar,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { CHARACTER_EMOJI, GeoPoint } from '@runwars/shared';
import MapView, { Polygon, Polyline, PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

export type PostRunParams = {
  distanceMeters: number;
  elapsedSeconds: number;
  averageSpeedKmh: number;
  areaSquareMeters: number;
  color: string;
  routePoints: GeoPoint[];
  activityType?: 'run' | 'walk' | 'bike';
  /** 'synced' = confirmed by the server; 'queued' = stored offline, will upload later. */
  syncStatus?: 'synced' | 'queued';
  claimStatus?: 'claimed' | 'rejected' | 'lost' | null;
  claimReason?: string | null;
};

type PostRunRouteProp = RouteProp<{ PostRun: PostRunParams }, 'PostRun'>;

function AnimatedCounter({ target, duration = 1500, suffix = '' }: { target: number; duration?: number; suffix?: string }) {
  const animVal = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = React.useState('0');

  useEffect(() => {
    const anim = Animated.timing(animVal, {
      toValue: target,
      duration,
      useNativeDriver: false,
    });
    anim.start();
    const listener = animVal.addListener(({ value }) => {
      setDisplay(Math.round(value).toLocaleString() + suffix);
    });
    return () => {
      animVal.removeListener(listener);
      anim.stop();
    };
  }, [target]);

  return <Text style={counterStyles.text}>{display}</Text>;
}

const counterStyles = StyleSheet.create({
  text: { fontSize: 52, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1 },
});

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={rowStyles.container}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={rowStyles.value}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#29384F',
  },
  label: { color: '#64748B', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  value: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

import { apiFetch, errorMessage } from '@/config/api';
import { uploadPostImage } from '@/services/ImageUploadService';

export default function PostRunScreen() {
  const route = useRoute<PostRunRouteProp>();
  const navigation = useNavigation();
  const { user } = useAuth();

  const { distanceMeters, elapsedSeconds, averageSpeedKmh, areaSquareMeters, color, routePoints, activityType, syncStatus, claimStatus, claimReason } = route.params;

  const distanceKm = (distanceMeters / 1000).toFixed(2);
  const synced = syncStatus === 'synced';
  // Coins the server actually awards (see recordRun / processTerritoryClaim).
  const coinsEarned = synced ? (distanceMeters > 0 ? 50 : 0) + (claimStatus === 'claimed' ? 10 : 0) : 0;
  const statusLine = !synced
    ? 'Saved on this phone — will upload when online'
    : claimStatus === 'claimed'
    ? 'Activity saved · territory claimed'
    : claimStatus === 'lost'
    ? 'Activity saved · a stronger runner holds this ground'
    : claimStatus === 'rejected'
    ? 'Activity saved · territory not claimed'
    : 'Activity saved';

  // Fade + slide in animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;
  
  const viewShotRef = useRef<any>(null);

  const [composerVisible, setComposerVisible] = React.useState(false);
  const [postContent, setPostContent] = React.useState(
    claimStatus === 'claimed'
      ? `Just completed a ${distanceKm} km ${activityType === 'bike' ? 'ride' : activityType || 'run'} and claimed ${Math.round(areaSquareMeters).toLocaleString()} m² of territory in StrideClash!`
      : `Just completed a ${distanceKm} km ${activityType === 'bike' ? 'ride' : activityType || 'run'} in StrideClash!`
  );
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const [submittingPost, setSubmittingPost] = React.useState(false);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start(() => {
      // Only suggest sharing when the run is actually on the server.
      if (synced) setTimeout(() => setComposerVisible(true), 800);
    });
  }, []);

  const shareImage = async () => {
    try {
      if (viewShotRef.current && viewShotRef.current.capture) {
        const uri = await viewShotRef.current.capture();
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(uri, {
            dialogTitle: 'Share your Territory!',
            mimeType: 'image/jpeg',
          });
        }
      }
    } catch (err) {
      console.error('Failed to share screenshot:', err);
    }
  };

  const handlePost = async () => {
    if (!user) return;
    setSubmittingPost(true);
    try {
      let imageUrl: string | undefined;
      if (viewShotRef.current?.capture) {
        try {
          const uri = await viewShotRef.current.capture({ format: 'jpg', quality: 0.8, result: 'tmpfile' });
          setUploadProgress(0);
          const up = await uploadPostImage({ uri, mimeType: 'image/jpeg' }, { userId: user.uid, kind: 'post', onProgress: setUploadProgress });
          imageUrl = up.url;
        } catch (e: any) {
          // Photo upload unavailable → still allow a text post, but say so.
          const proceed = await new Promise<boolean>(resolve =>
            Alert.alert('Image not attached', (e?.message || 'The run card could not be uploaded.') + '\n\nPost without the image?', [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Post text', onPress: () => resolve(true) },
            ])
          );
          if (!proceed) return;
        } finally {
          setUploadProgress(null);
        }
      }
      const res = await apiFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: postContent, imageUrl }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Failed to publish post.'));
      setComposerVisible(false);
      Alert.alert('Posted', 'Your activity is now in the Community feed.');
    } catch (err: any) {
      Alert.alert('Could not post', err?.message || 'Failed to publish post.');
    } finally {
      setSubmittingPost(false);
    }
  };

  const emoji = user?.characterType ? CHARACTER_EMOJI[user.characterType] ?? '🏃' : '🏃';

  const activityText = activityType === 'bike' ? 'RIDE COMPLETE!' : activityType === 'walk' ? 'WALK COMPLETE!' : 'RUN COMPLETE!';

  // Calculate MapRegion based on route points
  const mapRegion = React.useMemo(() => {
    if (!routePoints || routePoints.length === 0) return undefined;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    routePoints.forEach(p => {
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    });
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: (maxLat - minLat) * 1.5 || 0.01,
      longitudeDelta: (maxLng - minLng) * 1.5 || 0.01,
    };
  }, [routePoints]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D1A" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 1.0 }}>
            <View style={{ backgroundColor: '#101B2D', borderRadius: 20, margin: 10, overflow: 'hidden', borderWidth: 2, borderColor: color }}>
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: color }]}>
                <Text style={styles.headerEmoji}>{emoji}</Text>
                <Text style={styles.headerTitle}>{activityText}</Text>
                <Text style={[styles.headerSub, { color }]}>{statusLine}</Text>
              </View>

              {/* Map Snapshot */}
              {mapRegion && (
                <View style={styles.mapContainer}>
                  <MapView
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    region={mapRegion}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                  >
                    <Polygon
                      coordinates={routePoints}
                      fillColor={`${color}80`}
                      strokeColor={color}
                      strokeWidth={2}
                    />
                    <Polyline
                      coordinates={routePoints}
                      strokeColor={color}
                      strokeWidth={4}
                    />
                    <Marker coordinate={{ latitude: mapRegion.latitude, longitude: mapRegion.longitude }}>
                      <View style={[styles.territoryLabel, { borderColor: color }]}>
                        <Text style={[styles.territoryLabelText, { color }]}>
                          {user?.displayName ? `${user.displayName.toUpperCase()}'S TERRITORY` : 'YOUR TERRITORY'}
                        </Text>
                      </View>
                    </Marker>
                  </MapView>
                  <View style={styles.watermark}>
                    <Text style={styles.watermarkText}>STRIDECLASH</Text>
                  </View>
                </View>
              )}

              {/* Main distance hero */}
              <View style={styles.distanceHero}>
                <AnimatedCounter target={Math.round(distanceMeters)} suffix="" duration={1200} />
                <Text style={styles.distanceLabel}>METRES CONQUERED</Text>
              </View>

              {/* Coins actually awarded by the server */}
              {coinsEarned > 0 && (
                <View style={[styles.xpBanner, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                  <Text style={styles.xpIcon}>🪙</Text>
                  <Text style={[styles.xpText, { color }]}>+</Text>
                  <AnimatedCounter target={coinsEarned} duration={1200} />
                  <Text style={[styles.xpText, { color }]}> coins</Text>
                </View>
              )}
              {!!claimReason && <Text style={styles.claimReason}>{claimReason}</Text>}

              {/* Stats breakdown */}
              <View style={styles.statsCard}>
                <StatRow label="⏱  DURATION" value={formatTime(elapsedSeconds)} />
                <StatRow label="⚡  AVG SPEED" value={`${averageSpeedKmh.toFixed(1)} km/h`} />
                <StatRow label="🗺️  TERRITORY" value={claimStatus === 'claimed' ? `${Math.round(areaSquareMeters).toLocaleString()} m²` : synced ? 'Not claimed' : 'Pending upload'} />
                <StatRow label="📏  DISTANCE" value={`${distanceKm} km`} />
              </View>
            </View>
          </ViewShot>

          {/* Motivational message */}
          <Text style={styles.motivation}>
            {distanceMeters > 5000
              ? '🔥 Incredible effort! You\'re dominating the map!'
              : distanceMeters > 2000
              ? '💪 Great run! Keep pushing for more territory!'
              : '🚀 Every run counts — the city is yours to claim!'}
          </Text>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#1D2B42' }]} onPress={shareImage} activeOpacity={0.85} testID="postrun-share">
              <Text style={styles.shareBtnText}>📤  Share image</Text>
            </TouchableOpacity>
            {synced && (
              <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#1D2B42' }]} onPress={() => setComposerVisible(true)} activeOpacity={0.85} testID="postrun-post">
                <Text style={styles.shareBtnText}>📣  Post to feed</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: color }]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.doneBtnText}>🗺️   BACK TO MAP</Text>
          </TouchableOpacity>

        </Animated.View>
      </ScrollView>

      {/* Auto-Post Composer Modal */}
      <Modal visible={composerVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.composerCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share Your Run</Text>
              <TouchableOpacity onPress={() => setComposerVisible(false)}>
                <Text style={styles.closeText}>Skip</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.composerInput}
              placeholder="What's on your mind?"
              placeholderTextColor="#4A4A6A"
              multiline
              maxLength={280}
              value={postContent}
              onChangeText={setPostContent}
            />

            <TouchableOpacity
              style={[styles.publishBtn, !postContent.trim() && styles.publishBtnDisabled]}
              disabled={!postContent.trim() || submittingPost}
              onPress={handlePost}
            >
              {submittingPost ? (
                uploadProgress !== null ? <Text style={styles.publishText}>Uploading {Math.round(uploadProgress * 100)}%</Text> : <ActivityIndicator color="#0B1220" />
              ) : (
                <Text style={styles.publishText}>Publish Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  scroll: { paddingBottom: 60 },

  header: {
    alignItems: 'center',
    paddingTop: 70,
    paddingBottom: 32,
    paddingHorizontal: 24,
    backgroundColor: '#162238',
    borderBottomWidth: 3,
    marginBottom: 0,
  },
  headerEmoji: { fontSize: 60, marginBottom: 12 },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 3,
  },
  headerSub: { fontSize: 13, marginTop: 6, fontWeight: '600' },

  distanceHero: {
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: '#162238',
    borderBottomWidth: 1,
    borderBottomColor: '#29384F',
  },
  distanceLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 3,
    marginTop: 8,
  },

  claimReason: { color: '#94A3B8', fontSize: 13, textAlign: 'center', marginHorizontal: 16, marginBottom: 8 },
  xpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  xpIcon: { fontSize: 22 },
  xpText: { fontSize: 28, fontWeight: '900' },

  statsCard: {
    marginHorizontal: 24,
    marginTop: 20,
    backgroundColor: '#162238',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 4,
  },

  motivation: {
    textAlign: 'center',
    color: '#64748B',
    fontSize: 14,
    marginHorizontal: 24,
    marginTop: 24,
    lineHeight: 22,
    fontStyle: 'italic',
  },

  mapContainer: {
    height: 200,
    marginHorizontal: 24,
    marginTop: 20,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: '#29384F',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  watermark: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  watermarkText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1,
  },
  territoryLabel: {
    backgroundColor: '#0B1220',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  territoryLabelText: {
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
  },

  actionRow: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 32,
    gap: 12,
  },
  shareBtn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  doneBtn: {
    marginHorizontal: 24,
    marginTop: 16,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  doneBtnText: {
    color: '#0B1220',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  modalOverlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center' },
  composerCard: { width: '90%', backgroundColor: '#162238', borderRadius: 16, borderWidth: 1.5, borderColor: '#00BFFF44', padding: 20, gap: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  closeText: { color: '#94A3B8', fontWeight: '700' },
  composerInput: { backgroundColor: '#0B1220', borderRadius: 8, color: '#FFFFFF', padding: 12, fontSize: 14, height: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: '#29384F' },
  publishBtn: { backgroundColor: '#38BDF8', paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  publishBtnDisabled: { backgroundColor: '#64748B', opacity: 0.5 },
  publishText: { color: '#0B1220', fontWeight: '900', fontSize: 14 },
});
