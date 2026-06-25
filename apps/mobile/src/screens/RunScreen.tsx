/**
 * RunScreen — Active run tracking HUD for RunWars.
 *
 * Features:
 * - Live speed, pace, distance, elapsed time (updates every second)
 * - START / STOP button with pulsing green indicator when running
 * - useReducer for run state management
 * - GPS points collected via LocationService
 * - Emits location updates to socket server (wired in Phase 3)
 *
 * Design: Dark HUD overlay that sits on top of the GameMap.
 * In Phase 2, this will be rendered as an overlay over the map.
 * For Phase 1, it renders standalone for testing.
 */
import React, {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  StatusBar,
  Platform,
  DeviceEventEmitter,
} from 'react-native';
import {
  startTracking,
  stopTracking,
  startBackgroundTracking,
  stopBackgroundTracking,
  calculateDistance,
  calculateSpeed,
  formatPace,
  formatElapsedTime,
  requestLocationPermissions,
} from '@/services/LocationService';
import { getBackgroundPoints, clearBackgroundPoints } from '@/services/BackgroundLocationService';
import type { GeoPoint } from '@runwars/shared';
import { CHARACTER_EMOJI } from '@runwars/shared';
import * as Location from 'expo-location';
import MapView, { Polyline, Polygon, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useAuth } from '@/context/AuthContext';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useNavigation } from '@react-navigation/native';
import ConflictToast from '@/components/ConflictToast';
import { registerForPushNotificationsAsync } from '@/services/NotificationService';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.0.2.2:3000'; // Android emulator localhost

// Helper to parse Turf polygon features to react-native-maps coordinates
function parsePolygonCoordinates(feature: any) {
  if (!feature || !feature.geometry) return [];
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates[0].map((coord: any) => ({
      longitude: coord[0],
      latitude: coord[1],
    }));
  }
  if (feature.geometry.type === 'MultiPolygon') {
    return feature.geometry.coordinates[0][0].map((coord: any) => ({
      longitude: coord[0],
      latitude: coord[1],
    }));
  }
  return [];
}

function getCentroid(coords: any[]) {
  if (!coords || coords.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const c of coords) {
    lat += c.latitude;
    lng += c.longitude;
  }
  return {
    latitude: lat / coords.length,
    longitude: lng / coords.length,
  };
}

function isPointInPolygon(point: { latitude: number; longitude: number }, polygon: { latitude: number; longitude: number }[]) {
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude, yi = polygon[i].latitude;
    const xj = polygon[j].longitude, yj = polygon[j].latitude;
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── State Machine ────────────────────────────────────────────────────────────

interface RunState {
  isRunning: boolean;
  routePoints: GeoPoint[];
  distanceMeters: number;
  currentSpeedKmh: number;
  elapsedSeconds: number;
  startTime: number | null;
}

type RunAction =
  | { type: 'START_RUN' }
  | { type: 'STOP_RUN' }
  | { type: 'ADD_POINT'; point: GeoPoint; speedKmh: number }
  | { type: 'TICK' }
  | { type: 'RESET' };

const initialState: RunState = {
  isRunning: false,
  routePoints: [],
  distanceMeters: 0,
  currentSpeedKmh: 0,
  elapsedSeconds: 0,
  startTime: null,
};

function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'START_RUN':
      return {
        ...initialState,
        isRunning: true,
        startTime: Date.now(),
      };

    case 'STOP_RUN':
      return { ...state, isRunning: false };

    case 'ADD_POINT': {
      const newPoints = [...state.routePoints, action.point];
      return {
        ...state,
        routePoints: newPoints,
        distanceMeters: calculateDistance(newPoints),
        currentSpeedKmh: action.speedKmh,
      };
    }

    case 'TICK':
      return state.isRunning && state.startTime !== null
        ? {
            ...state,
            elapsedSeconds: Math.floor((Date.now() - state.startTime) / 1000),
          }
        : state;

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RunScreen() {
  const [state, dispatch] = useReducer(runReducer, initialState);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointRef = useRef<GeoPoint | null>(null);

  const { user } = useAuth();
  const { livePlayers, territories, socketService } = useMultiplayer();
  const navigation = useNavigation<any>();

  const [conflictVisible, setConflictVisible] = useState(false);
  const [conflictDetails, setConflictDetails] = useState({ name: '', color: '' });
  const [activityType, setActivityType] = useState<'run' | 'walk' | 'bike'>('run');

  // Pulse animation for the "running" indicator dot
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // ── Pulse animation control ──────────────────────────────────────────────
  const startPulse = useCallback(() => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const [activeZoneOwner, setActiveZoneOwner] = useState<{ name: string; color: string } | null>(null);

  const checkTerritoryEntry = useCallback((point: GeoPoint) => {
    let found: { name: string; color: string } | null = null;
    for (const t of territories) {
      if (t.userId !== user?.uid) {
        if (t.polygonCoordinates && t.polygonCoordinates.length > 2) {
          if (isPointInPolygon(point, t.polygonCoordinates)) {
            found = { name: t.ownerName || 'Runner', color: t.color };
            break;
          }
        }
      }
    }
    setActiveZoneOwner(found);
  }, [territories, user?.uid]);

  // ── GPS update handler ────────────────────────────────────────────────────
  const handleLocationUpdate = useCallback((point: GeoPoint, nativeSpeedKmh?: number) => {
    const prev = lastPointRef.current;
    
    // Use the native OS speed if available, otherwise fallback to haversine calculation
    const speedKmh = nativeSpeedKmh ?? (prev ? calculateSpeed(prev, point) : 0);
    
    lastPointRef.current = point;
    dispatch({ type: 'ADD_POINT', point, speedKmh });

    // Check if player entered an opponent's territory zone
    checkTerritoryEntry(point);

    if (user) {
      socketService.emitLocationUpdate({
        userId: user.uid,
        point,
        speedKmh,
      });
    }

    console.log('[RunScreen] GPS:', point.latitude.toFixed(5), point.longitude.toFixed(5), `${speedKmh.toFixed(1)} km/h`);
  }, [user, socketService, checkTerritoryEntry]);

  // ── Session Setup Effect ──────────────────────────────────────────────────
  useEffect(() => {
    let pushToken: string | undefined;

    const setup = async () => {
      // 1. Request Location Permissions
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('Permission denied', 'Location is required to track runs.');
        return;
      }
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        Alert.alert('Permission denied', 'Background location recommended for tracking.');
      }

      // 2. Setup Push Notifications
      pushToken = await registerForPushNotificationsAsync();
      if (pushToken && user?.uid) {
        socketService.socket?.emit('registerPushToken', {
          userId: user.uid,
          token: pushToken,
        });
      }

      // 3. Listen for territory stolen events
      socketService.socket?.on('territory:stolen', (data: { byPlayerName: string; byPlayerColor: string }) => {
        setConflictDetails({ name: data.byPlayerName, color: data.byPlayerColor });
        setConflictVisible(true);
        setTimeout(() => setConflictVisible(false), 4000);
      });
    };

    // 4. Listen for background location updates
    const bgSub = DeviceEventEmitter.addListener('backgroundLocationUpdate', ({ points, speedKmh }) => {
      points.forEach((pt: any) => {
        dispatch({ type: 'ADD_POINT', point: pt, speedKmh });
      });
    });

    setup();

    return () => {
      socketService.socket?.off('territory:stolen');
      bgSub.remove();
    };
  }, [user?.uid]);

  // ── Start run ─────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    try {
      const permission = await requestLocationPermissions();
      if (permission === 'denied') {
        Alert.alert(
          'Location Required',
          'RunWars needs location access to track your run. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
      if (permission === 'unavailable') {
        Alert.alert(
          'Location Unavailable',
          'Location services are not available on this device.'
        );
        return;
      }

      dispatch({ type: 'START_RUN' });
      lastPointRef.current = null;
      clearBackgroundPoints();

      await startTracking(handleLocationUpdate);
      await startBackgroundTracking();
      startPulse();

      // Start 1-second tick for elapsed time display
      tickIntervalRef.current = setInterval(() => {
        dispatch({ type: 'TICK' });
      }, 1000);

      if (user) {
        socketService.emitRunStart({ userId: user.uid });
      }
    } catch (error) {
      Alert.alert(
        'Failed to Start',
        error instanceof Error ? error.message : 'Could not start GPS tracking.'
      );
      dispatch({ type: 'RESET' });
    }
  }, [handleLocationUpdate, startPulse]);

  // ── Stop run ──────────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    Alert.alert('End Run?', 'Are you sure you want to stop this run?', [
      { text: 'Keep Running', style: 'cancel' },
      {
        text: 'Stop & Claim Territory',
        style: 'destructive',
        onPress: async () => {
          stopTracking();
          await stopBackgroundTracking();
          stopPulse();
          if (tickIntervalRef.current) {
            clearInterval(tickIntervalRef.current);
            tickIntervalRef.current = null;
          }
          dispatch({ type: 'STOP_RUN' });

          // Merge background-collected points to avoid missing data from locked screen
          const currentPoints = [...state.routePoints];
          const bgPoints = getBackgroundPoints();
          const mergedPoints = [...currentPoints];
          for (const bgPt of bgPoints) {
            if (!mergedPoints.some(pt => pt.timestamp === bgPt.timestamp)) {
              mergedPoints.push(bgPt);
            }
          }
          mergedPoints.sort((a, b) => a.timestamp - b.timestamp);
          const finalDistance = calculateDistance(mergedPoints);
          clearBackgroundPoints();

          if (user) {
            socketService.emitRunStop({
              userId: user.uid,
              routePoints: mergedPoints,
              distanceMeters: finalDistance,
            });
          }

          console.log('[RunScreen] Run complete. Points:', mergedPoints.length, 'Distance:', finalDistance.toFixed(0), 'm');
          
          if (user?.uid && mergedPoints.length >= 2) {
            const areaSquareMeters = finalDistance * 2;
            const avgSpeed = state.elapsedSeconds > 0
              ? (finalDistance / 1000) / (state.elapsedSeconds / 3600)
              : 0;

            socketService.emitTerritoryClaim({
              userId: user.uid,
              runSessionId: 'session_' + Date.now(),
              polygonCoordinates: mergedPoints,
              areaSquareMeters,
              color: user.color || '#32CD32'
            });

            // Navigate to post-run summary
            navigation.navigate('PostRun', {
              distanceMeters: finalDistance,
              elapsedSeconds: state.elapsedSeconds,
              averageSpeedKmh: parseFloat(avgSpeed.toFixed(1)),
              areaSquareMeters,
              color: user.color || '#32CD32',
              routePoints: mergedPoints,
              activityType,
            });
          }
        },
      },
    ]);
  }, [state.routePoints, state.distanceMeters, stopPulse]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopTracking();
      stopPulse();
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    };
  }, [stopPulse]);

  // ── Derived display values ────────────────────────────────────────────────
  const displayValues = useMemo(() => ({
    speed: state.currentSpeedKmh.toFixed(1),
    pace: formatPace(state.currentSpeedKmh),
    distance: (state.distanceMeters / 1000).toFixed(2),
    elapsed: formatElapsedTime(state.elapsedSeconds),
    calories: Math.round(state.distanceMeters * 0.065),
  }), [state.currentSpeedKmh, state.distanceMeters, state.elapsedSeconds]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />

      {/* ── Game Map (Full Screen) ── */}
      <MapView
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        mapType="satellite"
        showsUserLocation={true}
        followsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {territories.map(t => {
          const coords = t.polygonCoordinates;
          const centroid = getCentroid(coords);
          const isCurrentActive = activeZoneOwner && activeZoneOwner.name === t.ownerName;
          return (
            <React.Fragment key={t.id}>
              <Polygon
                coordinates={coords}
                fillColor={isCurrentActive ? `${t.color}95` : `${t.color}50`}
                strokeColor={t.color}
                strokeWidth={isCurrentActive ? 4.5 : 2.5}
              />
              {centroid && (
                <Marker
                  coordinate={centroid}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                >
                  <View style={[styles.ownerBadge, { backgroundColor: t.color }]}>
                    <Text style={styles.ownerBadgeText}>
                      {t.ownerName ? `${t.ownerName.toUpperCase()}'S ZONE` : 'ZONE'}
                    </Text>
                  </View>
                </Marker>
              )}
            </React.Fragment>
          );
        })}

        {/* Other players' current positions */}
        {livePlayers.map((p) => {
          if (p.userId === user?.uid) return null;
          return (
            <Marker
              key={p.userId}
              coordinate={{
                latitude: p.currentPosition.latitude,
                longitude: p.currentPosition.longitude,
              }}
              title={p.displayName}
              description={p.isRunning ? `Running (${p.currentSpeedKmh.toFixed(1)} km/h)` : 'Online'}
            >
              <View style={[styles.playerMarker, { borderColor: p.color || '#00BFFF' }]}>
                <Text style={styles.playerMarkerEmoji}>
                  {CHARACTER_EMOJI[p.characterType || 'runner']}
                </Text>
              </View>
            </Marker>
          );
        })}

        {state.routePoints.length > 1 && (
          <Polyline
            coordinates={state.routePoints}
            strokeColor={user?.color || "#32CD32"}
            strokeWidth={4}
            lineJoin="round"
          />
        )}
      </MapView>

      {/* ── HUD Top Bar (Floating Transparent Overlay) ── */}
      <View style={styles.hudBar}>
        {/* RunWars Logo & GPS Indicator Row */}
        <View style={styles.hudHeaderRow}>
          <View style={styles.logoContainer}>
            <View style={styles.logoStripeRow}>
              <View style={[styles.logoStripe, styles.logoStripe1, { backgroundColor: user?.color || '#FFFFFF' }]} />
              <View style={[styles.logoStripe, styles.logoStripe2, { backgroundColor: user?.color || '#FFFFFF' }]} />
              <View style={[styles.logoStripe, styles.logoStripe3, { backgroundColor: user?.color || '#FFFFFF' }]} />
            </View>
            <Text style={[styles.logoText, { color: '#FFFFFF' }]}>RUNWARS</Text>
          </View>
          <Text style={styles.gpsIndicatorText}>GPS 📶</Text>
        </View>

        {/* Large stopwatch duration */}
        <View style={styles.durationContainer}>
          <Text style={styles.durationValue}>{displayValues.elapsed}</Text>
          <Text style={styles.durationLabel}>DURATION</Text>
        </View>

        {/* 3-stat grid */}
        <View style={styles.statsGrid}>
          {/* Distance */}
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{displayValues.distance}</Text>
            <Text style={styles.statLabel}>DISTANCE (KM)</Text>
          </View>

          {/* Calories */}
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{displayValues.calories}</Text>
            <Text style={styles.statLabel}>CALORIES (CAL)</Text>
          </View>

          {/* Avg Pace */}
          <View style={styles.statBox}>
            <Text style={styles.statValueSmall}>{displayValues.pace}</Text>
            <Text style={styles.statLabel}>AVG. PACE (MIN/KM)</Text>
          </View>
        </View>
      </View>

      {/* Territory Entry Warning Overlay */}
      {activeZoneOwner && (
        <View style={[styles.zoneIndicator, { borderColor: activeZoneOwner.color }]}>
          <View style={styles.zoneIndicatorLeft}>
            <Text style={styles.zoneIndicatorTitle}>⚔️ ENTERED ZONE</Text>
            <Text style={[styles.zoneIndicatorSub, { color: activeZoneOwner.color }]}>
              {activeZoneOwner.name.toUpperCase()}'S TERRITORY
            </Text>
          </View>
          <View style={[styles.zoneIndicatorBadge, { backgroundColor: activeZoneOwner.color }]}>
            <Text style={styles.zoneIndicatorBadgeText}>BATTLE</Text>
          </View>
        </View>
      )}

      {/* Territory Conflict Toast */}
      <ConflictToast
        visible={conflictVisible}
        playerName={conflictDetails.name}
        playerColor={conflictDetails.color}
      />

      {/* ── Bottom Floating Controls Wrapper ── */}
      <View style={styles.bottomControlsContainer}>
        {/* ── Activity Selector Row ── */}
        <View style={styles.activityContainer}>
          <TouchableOpacity
            style={[styles.activityBox, activityType === 'run' && styles.activityBoxActive]}
            onPress={() => setActivityType('run')}
          >
            <Text style={[styles.activityIcon, activityType === 'run' && styles.activityIconActive]}>🏃</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.activityBox, activityType === 'walk' && styles.activityBoxActive]}
            onPress={() => setActivityType('walk')}
          >
            <Text style={[styles.activityIcon, activityType === 'walk' && styles.activityIconActive]}>🚶</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.activityBox, activityType === 'bike' && styles.activityBoxActive]}
            onPress={() => setActivityType('bike')}
          >
            <Text style={[styles.activityIcon, activityType === 'bike' && styles.activityIconActive]}>🚴</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.activityBox}>
            <Text style={styles.activityIcon}>•••</Text>
          </TouchableOpacity>
        </View>

        {/* ── START / STOP Button ── */}
        <View style={styles.controlBar}>
          <TouchableOpacity
            style={styles.sideButton}
            onPress={() => Alert.alert('Music', 'Music library integration coming in next phase!')}
          >
            <Text style={styles.sideButtonText}>🎵</Text>
          </TouchableOpacity>

          {!state.isRunning ? (
            <TouchableOpacity
              id="run-start-btn"
              style={styles.adidasStartBtn}
              onPress={handleStart}
              activeOpacity={0.9}
            >
              <Text style={styles.adidasStartBtnText}>START RUNNING   →</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              id="run-stop-btn"
              style={styles.adidasStopBtn}
              onPress={handleStop}
              activeOpacity={0.9}
            >
              <Text style={styles.adidasStopBtnText}>STOP & CLAIM   ■</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.sideButton}
            onPress={() => Alert.alert('Settings', 'Configure audio cues, auto-pause & run goals.')}
          >
            <Text style={styles.sideButtonText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },

  // HUD Top
  hudBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    paddingTop: 54,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 99,
  },
  hudHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
    backgroundColor: 'rgba(13, 13, 26, 0.65)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoStripeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 18,
    marginRight: 6,
  },
  logoStripe: {
    width: 3,
    marginHorizontal: 1.5,
    transform: [{ skewX: '-30deg' }],
  },
  logoStripe1: { height: 7 },
  logoStripe2: { height: 12 },
  logoStripe3: { height: 17 },
  logoText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  gpsIndicatorText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFB800',
    letterSpacing: 0.5,
  },
  durationContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 13, 26, 0.65)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignSelf: 'center',
    marginBottom: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  durationValue: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : 'sans-serif-condensed',
    letterSpacing: -1,
  },
  durationLabel: {
    fontSize: 8,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: 'rgba(13, 13, 26, 0.65)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 12,
    paddingHorizontal: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  statValueSmall: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 24,
  },
  statLabel: {
    fontSize: 8,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 3,
    textAlign: 'center',
  },

  map: {
    flex: 1,
  },

  // Floating Bottom Container
  bottomControlsContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    zIndex: 99,
  },

  // Activity Selector
  activityContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13, 13, 26, 0.82)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'space-between',
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  activityBox: {
    width: 60,
    height: 48,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  activityBoxActive: {
    borderColor: '#FFFFFF',
    borderWidth: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  activityIcon: {
    fontSize: 22,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  activityIconActive: {
    color: '#FFFFFF',
  },

  // Controls
  controlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(13, 13, 26, 0.82)',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  sideButton: {
    width: 54,
    height: 54,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  sideButtonText: {
    fontSize: 22,
  },
  adidasStartBtn: {
    flex: 1,
    backgroundColor: '#000000',
    height: 54,
    marginHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  adidasStartBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  adidasStopBtn: {
    flex: 1,
    backgroundColor: '#D32F2F',
    height: 54,
    marginHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  adidasStopBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },

  // Territory labels
  ownerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 1,
    elevation: 3,
  },
  ownerBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  playerMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
  },
  playerMarkerEmoji: {
    fontSize: 20,
  },

  // Floating Zone Warning Indicator
  zoneIndicator: {
    position: 'absolute',
    top: 200,
    left: 16,
    right: 16,
    backgroundColor: '#16162A',
    borderWidth: 2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 99,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  zoneIndicatorLeft: {
    flex: 1,
  },
  zoneIndicatorTitle: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FF4D4D',
    letterSpacing: 1.5,
  },
  zoneIndicatorSub: {
    fontSize: 13,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  zoneIndicatorBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  zoneIndicatorBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
});

