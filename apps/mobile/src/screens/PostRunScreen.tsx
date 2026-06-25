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
    borderBottomColor: '#2A2A4A',
  },
  label: { color: '#4A4A6A', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
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

export default function PostRunScreen() {
  const route = useRoute<PostRunRouteProp>();
  const navigation = useNavigation();
  const { user } = useAuth();

  const { distanceMeters, elapsedSeconds, averageSpeedKmh, areaSquareMeters, color, routePoints, activityType } = route.params;

  const xp = Math.round((distanceMeters / 100) + (areaSquareMeters / 500));
  const distanceKm = (distanceMeters / 1000).toFixed(2);

  // Fade + slide in animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;
  
  const viewShotRef = useRef<any>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
    ]).start();
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
            <View style={{ backgroundColor: '#1A1A2E', borderRadius: 20, margin: 10, overflow: 'hidden', borderWidth: 2, borderColor: color }}>
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: color }]}>
                <Text style={styles.headerEmoji}>{emoji}</Text>
                <Text style={styles.headerTitle}>{activityText}</Text>
                <Text style={[styles.headerSub, { color }]}>Territory claimed & saved 🗺️</Text>
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
                    <Text style={styles.watermarkText}>RUNWARS</Text>
                  </View>
                </View>
              )}

              {/* Main distance hero */}
              <View style={styles.distanceHero}>
                <AnimatedCounter target={parseFloat(distanceKm) * 100} suffix="" duration={1200} />
                <Text style={styles.distanceLabel}>METRES CONQUERED</Text>
              </View>

              {/* XP gained */}
              <View style={[styles.xpBanner, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                <Text style={styles.xpIcon}>⚡</Text>
                <Text style={[styles.xpText, { color }]}>+</Text>
                <AnimatedCounter target={xp} duration={2000} />
                <Text style={[styles.xpText, { color }]}> XP</Text>
              </View>

              {/* Stats breakdown */}
              <View style={styles.statsCard}>
                <StatRow label="⏱  DURATION" value={formatTime(elapsedSeconds)} />
                <StatRow label="⚡  AVG SPEED" value={`${averageSpeedKmh.toFixed(1)} km/h`} />
                <StatRow label="🗺️  TERRITORY" value={`${areaSquareMeters.toFixed(0)} m²`} />
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
            <TouchableOpacity
              style={[styles.shareBtn, { backgroundColor: '#E1306C' }]}
              onPress={shareImage}
              activeOpacity={0.85}
            >
              <Text style={styles.shareBtnText}>📸  INSTAGRAM</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.shareBtn, { backgroundColor: '#25D366' }]}
              onPress={shareImage}
              activeOpacity={0.85}
            >
              <Text style={styles.shareBtnText}>💬  WHATSAPP</Text>
            </TouchableOpacity>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D1A' },
  scroll: { paddingBottom: 60 },

  header: {
    alignItems: 'center',
    paddingTop: 70,
    paddingBottom: 32,
    paddingHorizontal: 24,
    backgroundColor: '#16162A',
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
    backgroundColor: '#16162A',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A4A',
  },
  distanceLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#4A4A6A',
    letterSpacing: 3,
    marginTop: 8,
  },

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
    backgroundColor: '#16162A',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 4,
  },

  motivation: {
    textAlign: 'center',
    color: '#4A4A6A',
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
    borderColor: '#2A2A4A',
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
    backgroundColor: '#0D0D1A',
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
    color: '#0D0D1A',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
});
