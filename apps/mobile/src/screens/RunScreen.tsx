/**
 * RunScreen — High-Glanceability Live Running Cockpit for StrideClash.
 *
 * Designed for runner safety, glanceability, and tactical gameplay in motion.
 * Features:
 * - Ultra-large bold tabular typography (Distance, Time, Pace)
 * - Three-state flow: STOPPED → RUNNING (Pause | Finish) ↔ PAUSED (Resume | Finish)
 * - GPS Signal Accuracy Badge (🟢 High / 🟡 Fair / 🔴 Searching)
 * - Class Emblem & Active Territory Dispute Warning HUD
 * - One-tap 2x Arena Boost trigger upon invading opponent sectors
 * - Activity Mode Switcher (Run 🏃 / Walk 🚶 / Bike 🚴)
 * - Full route visualization polyline & claimed territory overlays
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
  Dimensions,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import ConflictToast from '@/components/ConflictToast';
import { registerForPushNotificationsAsync } from '@/services/NotificationService';
import {
  COLORS,
  CLASS_THEMES,
  SPACING,
  RADII,
  SHADOWS,
} from '@/theme/tokens';
import { CYBER_DARK_MAP_STYLE } from '@/theme/mapStyle';
import { GameButton, GlassCard, StatBadge } from '@/components/ui';
import { apiFetch } from '@/config/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

function isPointInPolygon(point: { latitude: number; longitude: number }, polygon: { latitude: number; longitude: number }[]) {
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude, yi = polygon[i].latitude;
    const xj = polygon[j].longitude, yj = polygon[j].latitude;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── State Machine ────────────────────────────────────────────────────────────

interface RunState {
  isRunning: boolean;
  isPaused: boolean;
  routePoints: GeoPoint[];
  distanceMeters: number;
  currentSpeedKmh: number;
  elapsedSeconds: number;
  accumulatedSeconds: number;
  startTime: number | null;
  gpsAccuracy: 'high' | 'fair' | 'low';
}

type RunAction =
  | { type: 'START_RUN' }
  | { type: 'PAUSE_RUN' }
  | { type: 'RESUME_RUN' }
  | { type: 'STOP_RUN' }
  | { type: 'ADD_POINT'; point: GeoPoint; speedKmh: number }
  | { type: 'SET_ACCURACY'; accuracy: 'high' | 'fair' | 'low' }
  | { type: 'TICK' }
  | { type: 'RESET' }
  | { type: 'RESTORE_SESSION'; payload: { routePoints: GeoPoint[]; elapsedSeconds: number } };

const initialState: RunState = {
  isRunning: false,
  isPaused: false,
  routePoints: [],
  distanceMeters: 0,
  currentSpeedKmh: 0,
  elapsedSeconds: 0,
  accumulatedSeconds: 0,
  startTime: null,
  gpsAccuracy: 'high',
};

function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'START_RUN':
      return {
        ...initialState,
        isRunning: true,
        isPaused: false,
        startTime: Date.now(),
        accumulatedSeconds: 0,
        elapsedSeconds: 0,
      };

    case 'PAUSE_RUN':
      return {
        ...state,
        isPaused: true,
        accumulatedSeconds: state.elapsedSeconds,
        startTime: null,
      };

    case 'RESUME_RUN':
      return {
        ...state,
        isPaused: false,
        startTime: Date.now(),
      };

    case 'STOP_RUN':
      return { ...state, isRunning: false, isPaused: false };

    case 'SET_ACCURACY':
      return { ...state, gpsAccuracy: action.accuracy };

    case 'ADD_POINT': {
      if (state.isPaused) return state;
      const newPoints = [...state.routePoints, action.point];
      return {
        ...state,
        routePoints: newPoints,
        distanceMeters: calculateDistance(newPoints),
        currentSpeedKmh: action.speedKmh,
      };
    }

    case 'TICK':
      if (state.isRunning && !state.isPaused && state.startTime !== null) {
        const incremental = Math.floor((Date.now() - state.startTime) / 1000);
        return {
          ...state,
          elapsedSeconds: state.accumulatedSeconds + incremental,
        };
      }
      return state;

    case 'RESTORE_SESSION': {
      const restored = action.payload;
      return {
        ...initialState,
        isRunning: true,
        isPaused: false,
        routePoints: restored.routePoints,
        distanceMeters: calculateDistance(restored.routePoints),
        elapsedSeconds: restored.elapsedSeconds,
        accumulatedSeconds: restored.elapsedSeconds,
        startTime: Date.now(),
        gpsAccuracy: 'low',
      };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const SESSION_KEY = '@runwars:activeSession';

interface StoredSession {
  sessionId: string;
  routePoints: GeoPoint[];
  elapsedSeconds: number;
  accumulatedSeconds: number;
  startTime: number | null;
  activityType: 'run' | 'walk' | 'bike';
  savedAt?: number;
}

export default function RunScreen() {
  const [state, dispatch] = useReducer(runReducer, initialState);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPointRef = useRef<GeoPoint | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const persistIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef(state);
  const activityTypeRef = useRef<'run' | 'walk' | 'bike'>('run');
  const hasStartedRunRef = useRef(false);
  const submittingRef = useRef(false);

  const { user } = useAuth();
  const { livePlayers, territories, socketService } = useMultiplayer();
  const navigation = useNavigation<any>();
  // Bottom tab bar is `position:absolute`, so screen content underlaps it.
  // Pull its real height so the START button always clears it.
  const tabBarHeight = useBottomTabBarHeight();

  const [pendingRecovery, setPendingRecovery] = useState<StoredSession | null>(null);
  const [conflictVisible, setConflictVisible] = useState(false);
  const [conflictDetails, setConflictDetails] = useState({ name: '', color: '' });
  const [activityType, setActivityType] = useState<'run' | 'walk' | 'bike'>('run');

  // Pulse animation for active run beacon
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const startPulse = useCallback(() => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.35,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 650,
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
            found = { name: t.ownerName || 'Rival Runner', color: t.color || COLORS.crimson };
            break;
          }
        }
      }
    }
    setActiveZoneOwner(found);
  }, [territories, user?.uid]);

  // GPS update handler
  const handleLocationUpdate = useCallback((point: GeoPoint, nativeSpeedKmh?: number, accuracyMeters?: number) => {
    // Reflect GPS accuracy in HUD; skip adding low-accuracy points to route
    if ((point as any).isLowAccuracy) {
      dispatch({ type: 'SET_ACCURACY', accuracy: 'low' });
      return;
    }
    if (accuracyMeters !== undefined) {
      dispatch({
        type: 'SET_ACCURACY',
        accuracy: accuracyMeters <= 10 ? 'high' : accuracyMeters <= 30 ? 'fair' : 'low',
      });
    }

    const prev = lastPointRef.current;
    const speedKmh = nativeSpeedKmh ?? (prev ? calculateSpeed(prev, point) : 0);

    lastPointRef.current = point;
    dispatch({ type: 'ADD_POINT', point, speedKmh });

    // Animate map to follow runner position
    mapRef.current?.animateToRegion({
      latitude: point.latitude,
      longitude: point.longitude,
      latitudeDelta: 0.008,
      longitudeDelta: 0.008,
    }, 400);

    checkTerritoryEntry(point);

    if (user) {
      socketService.emitLocationUpdate({
        userId: user.uid,
        point,
        speedKmh,
      });
    }
  }, [user, socketService, checkTerritoryEntry]);

  // Session Setup Effect
  useEffect(() => {
    let pushToken: string | undefined;

    const setup = async () => {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        Alert.alert('Location Required', 'Location permissions are needed to track running telemetry.');
        return;
      }
      await Location.requestBackgroundPermissionsAsync().catch(() => {});

      pushToken = await registerForPushNotificationsAsync().catch(() => undefined);
      if (pushToken && user?.uid) {
        socketService.socket?.emit('registerPushToken', {
          userId: user.uid,
          token: pushToken,
        });
      }

      socketService.socket?.on('territory:stolen', (data: { byPlayerName: string; byPlayerColor: string }) => {
        setConflictDetails({ name: data.byPlayerName, color: data.byPlayerColor });
        setConflictVisible(true);
        setTimeout(() => setConflictVisible(false), 4500);
      });

      socketService.socket?.on('pvp:warning', (data: { message: string }) => {
        Alert.alert(
          '⚔️ ENEMY SECTOR ALERT',
          data.message || 'You entered rival turf! Speed up or activate Arena Boost to contest it!',
          [{ text: 'FIGHT ON', style: 'cancel' }],
          { cancelable: true }
        );
      });
    };

    const bgSub = DeviceEventEmitter.addListener('backgroundLocationUpdate', ({ points, speedKmh }) => {
      points.forEach((pt: any) => {
        dispatch({ type: 'ADD_POINT', point: pt, speedKmh });
      });
    });

    setup();

    return () => {
      socketService.socket?.off('territory:stolen');
      socketService.socket?.off('pvp:warning');
      bgSub.remove();
    };
  }, [user?.uid, socketService]);

  // Keep stateRef current so interval callbacks always see the latest state
  useEffect(() => { stateRef.current = state; });
  useEffect(() => { activityTypeRef.current = activityType; }, [activityType]);

  // Crash recovery — read saved session on mount once
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as StoredSession;
        if (saved?.sessionId && Array.isArray(saved?.routePoints) && saved.routePoints.length > 0) {
          setPendingRecovery(saved);
        }
      } catch {}
    }).catch(() => {});
  }, []);

  // Show recovery prompt whenever pendingRecovery is set
  useEffect(() => {
    if (!pendingRecovery) return;
    const distKm = (calculateDistance(pendingRecovery.routePoints) / 1000).toFixed(2);
    Alert.alert(
      'RESUME PREVIOUS RUN?',
      `Unfinished run detected: ${distKm} km, ${formatElapsedTime(pendingRecovery.elapsedSeconds || 0)}`,
      [
        {
          text: 'DISCARD',
          style: 'destructive',
          onPress: () => {
            AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
            setPendingRecovery(null);
          },
        },
        {
          text: 'RESUME',
          onPress: () => {
            const session = pendingRecovery;
            setPendingRecovery(null);
            handleRecoverSession(session);
          },
        },
      ]
    );
  }, [pendingRecovery]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecoverSession = useCallback(async (saved: StoredSession) => {
    sessionIdRef.current = saved.sessionId;
    lastPointRef.current = null;
    hasStartedRunRef.current = true;
    if (saved.activityType) setActivityType(saved.activityType);
    dispatch({ type: 'RESTORE_SESSION', payload: { routePoints: saved.routePoints, elapsedSeconds: saved.elapsedSeconds || 0 } });
    try {
      await startTracking(handleLocationUpdate);
      await startBackgroundTracking();
      startPulse();
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = setInterval(() => dispatch({ type: 'TICK' }), 1000);
      if (persistIntervalRef.current) clearInterval(persistIntervalRef.current);
      persistIntervalRef.current = setInterval(async () => {
        const s = stateRef.current;
        if (s.isRunning && sessionIdRef.current) {
          AsyncStorage.setItem(SESSION_KEY, JSON.stringify({
            sessionId: sessionIdRef.current,
            routePoints: s.routePoints,
            elapsedSeconds: s.elapsedSeconds,
            accumulatedSeconds: s.accumulatedSeconds,
            startTime: s.startTime,
            activityType: activityTypeRef.current,
            savedAt: Date.now(),
          } as StoredSession)).catch(() => {});
        }
      }, 10000);
    } catch (e) {
      Alert.alert('GPS Error', e instanceof Error ? e.message : 'Could not resume GPS.');
      dispatch({ type: 'RESET' });
      sessionIdRef.current = null;
    }
  }, [handleLocationUpdate, startPulse]);

  // Start run — guarded against double-tap and logs entry so tap-drop bugs
  // show up in logcat.
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const handleStart = useCallback(async () => {
    if (startingRef.current || state.isRunning) {
      console.log('[RunScreen] handleStart ignored — already starting or running');
      return;
    }
    startingRef.current = true;
    setStarting(true);
    console.log('[RunScreen] handleStart fired');
    try {
      const permission = await requestLocationPermissions();
      if (permission === 'denied' || permission === 'unavailable') {
        Alert.alert('GPS Required', 'Please enable location permissions in Android settings to track your run.');
        return;
      }

      const newSessionId = 'session_' + Date.now();
      sessionIdRef.current = newSessionId;
      hasStartedRunRef.current = true;

      dispatch({ type: 'START_RUN' });
      lastPointRef.current = null;
      clearBackgroundPoints();

      // Persist immediately on start so crash recovery can find the session
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify({
        sessionId: newSessionId,
        routePoints: [],
        elapsedSeconds: 0,
        accumulatedSeconds: 0,
        startTime: Date.now(),
        activityType,
        savedAt: Date.now(),
      } as StoredSession)).catch(() => {});

      await startTracking(handleLocationUpdate);
      await startBackgroundTracking();
      startPulse();

      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = setInterval(() => {
        dispatch({ type: 'TICK' });
      }, 1000);

      // Periodic persistence every 10 s — always uses the latest state via stateRef
      if (persistIntervalRef.current) clearInterval(persistIntervalRef.current);
      persistIntervalRef.current = setInterval(async () => {
        const s = stateRef.current;
        if (s.isRunning && sessionIdRef.current) {
          AsyncStorage.setItem(SESSION_KEY, JSON.stringify({
            sessionId: sessionIdRef.current,
            routePoints: s.routePoints,
            elapsedSeconds: s.elapsedSeconds,
            accumulatedSeconds: s.accumulatedSeconds,
            startTime: s.startTime,
            activityType: activityTypeRef.current,
            savedAt: Date.now(),
          } as StoredSession)).catch(() => {});
        }
      }, 10000);

      if (user) {
        socketService.emitRunStart({
          userId: user.uid,
          activityType: activityType === 'bike' ? 'cycle' : activityType,
        });
      }
    } catch (error) {
      console.error('[RunScreen] handleStart failed:', error);
      Alert.alert('GPS Error', error instanceof Error ? error.message : 'Could not initialize GPS.');
      dispatch({ type: 'RESET' });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [handleLocationUpdate, startPulse, user, activityType, state.isRunning]);

  // Pause run
  const handlePause = useCallback(() => {
    stopTracking();
    stopPulse();
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    dispatch({ type: 'PAUSE_RUN' });
    // Persist elapsed time immediately on pause so crash recovery restores it correctly
    if (sessionIdRef.current) {
      const s = stateRef.current;
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify({
        sessionId: sessionIdRef.current,
        routePoints: s.routePoints,
        elapsedSeconds: s.elapsedSeconds,
        accumulatedSeconds: s.elapsedSeconds,
        startTime: null,
        activityType: activityTypeRef.current,
        savedAt: Date.now(),
      } as StoredSession)).catch(() => {});
    }
  }, [stopPulse]);

  // Resume run
  const handleResume = useCallback(async () => {
    lastPointRef.current = null; // prevent distance jump from pre-pause position
    await startTracking(handleLocationUpdate);
    startPulse();
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    tickIntervalRef.current = setInterval(() => {
      dispatch({ type: 'TICK' });
    }, 1000);
    dispatch({ type: 'RESUME_RUN' });
  }, [handleLocationUpdate, startPulse]);

  // Stop & Claim Territory
  const handleStop = useCallback(() => {
    Alert.alert(
      'CONQUEST FINISH',
      'Lock in this run and claim all conquered territory?',
      [
        { text: 'KEEP RUNNING', style: 'cancel' },
        {
          text: 'CLAIM & FINISH',
          style: 'destructive',
          onPress: async () => {
            if (submittingRef.current) return;
            submittingRef.current = true;
            stopTracking();
            await stopBackgroundTracking();
            stopPulse();
            if (tickIntervalRef.current) {
              clearInterval(tickIntervalRef.current);
              tickIntervalRef.current = null;
            }
            if (persistIntervalRef.current) {
              clearInterval(persistIntervalRef.current);
              persistIntervalRef.current = null;
            }
            const finishedSessionId = sessionIdRef.current;
            sessionIdRef.current = null; // prevent double-submit
            dispatch({ type: 'STOP_RUN' });

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

            const mappedActivity = activityType === 'bike' ? 'cycle' : activityType;

            if (user) {
              socketService.emitRunStop({
                userId: user.uid,
                routePoints: mergedPoints,
                distanceMeters: finalDistance,
                activityType: mappedActivity,
              });
            }

            if (user?.uid && mergedPoints.length >= 2) {
              const areaSquareMeters = finalDistance * 2;
              const avgSpeed = state.elapsedSeconds > 0
                ? (finalDistance / 1000) / (state.elapsedSeconds / 3600)
                : 0;

              socketService.emitTerritoryClaim({
                userId: user.uid,
                runSessionId: finishedSessionId || ('session_' + Date.now()),
                polygonCoordinates: mergedPoints,
                areaSquareMeters,
                color: user.color || COLORS.neonGreen,
                activityType: mappedActivity,
              });

              // Clear persisted session only after successful submission
              await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
              submittingRef.current = false;

              navigation.navigate('PostRun', {
                distanceMeters: finalDistance,
                elapsedSeconds: state.elapsedSeconds,
                averageSpeedKmh: parseFloat(avgSpeed.toFixed(1)),
                areaSquareMeters,
                color: user.color || COLORS.neonGreen,
                routePoints: mergedPoints,
                activityType,
              });
            } else {
              await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
              submittingRef.current = false;
              Alert.alert('Short Run', 'Run logged. Run further to generate territory polygons on the map!');
            }
          },
        },
      ]
    );
  }, [state.routePoints, state.elapsedSeconds, stopPulse, user, activityType, navigation]);

  // Persist GPS route on every new point AND on pause (keeps elapsed time accurate)
  useEffect(() => {
    if (state.isRunning && sessionIdRef.current) {
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify({
        sessionId: sessionIdRef.current,
        routePoints: state.routePoints,
        elapsedSeconds: state.elapsedSeconds,
        accumulatedSeconds: state.accumulatedSeconds,
        startTime: state.startTime,
        activityType,
        savedAt: Date.now(),
      } as StoredSession)).catch(() => {});
    }
  }, [state.routePoints.length, state.isPaused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      stopTracking();
      stopPulse();
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      if (persistIntervalRef.current) clearInterval(persistIntervalRef.current);
    };
  }, [stopPulse]);

  // Display telemetry calculations
  const displayValues = useMemo(() => {
    const km = state.distanceMeters / 1000;
    const distance = km.toFixed(2);
    const pace = formatPace(state.currentSpeedKmh);
    const elapsed = formatElapsedTime(state.elapsedSeconds);
    const calories = Math.round(km * 62);
    const avgSpeed = state.elapsedSeconds > 0
      ? ((km / (state.elapsedSeconds / 3600))).toFixed(1)
      : '0.0';

    return { distance, pace, elapsed, calories, avgSpeed };
  }, [state.distanceMeters, state.currentSpeedKmh, state.elapsedSeconds]);

  const playerClass = (user?.characterType || 'scout') as keyof typeof CLASS_THEMES;
  const classMeta = CLASS_THEMES[playerClass] || CLASS_THEMES.scout;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Background Map Canvas ──
          Note: the map is a native view at absoluteFill. All overlay Views in
          this screen use `elevation` (not just zIndex) so Android composites
          and routes touches above the map correctly. */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={CYBER_DARK_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {/* Opponent & User Territories */}
        {territories.map((t) => {
          let coords: any[] = [];
          if (t.polygonCoordinates && t.polygonCoordinates.length > 2) {
            coords = t.polygonCoordinates;
          } else {
            coords = parsePolygonCoordinates(t);
          }
          if (coords.length < 3) return null;

          const isMine = t.userId === user?.uid;
          const strokeColor = isMine ? (user?.color || COLORS.neonGreen) : (t.color || COLORS.crimson);
          const fillColor = isMine ? 'rgba(0, 255, 136, 0.28)' : 'rgba(255, 42, 85, 0.22)';

          return (
            <Polygon
              key={t.id}
              coordinates={coords}
              fillColor={fillColor}
              strokeColor={strokeColor}
              strokeWidth={2}
            />
          );
        })}

        {/* Live Route Polyline */}
        {state.routePoints.length > 1 && (
          <Polyline
            coordinates={state.routePoints}
            strokeColor={user?.color || COLORS.neonGreen}
            strokeWidth={5}
            lineJoin="round"
          />
        )}
      </MapView>

      {/* ── Top Glanceable Cockpit Overlay ── */}
      <View style={styles.topCockpit}>
        {/* Status Bar Header: Class Badge + Live Status + GPS Signal */}
        <View style={styles.hudStatusBar}>
          <View style={styles.classBadge}>
            <Text style={styles.classEmoji}>{classMeta.emoji}</Text>
            <Text style={styles.classTitle}>{classMeta.name.toUpperCase()}</Text>
          </View>

          <View style={styles.statusIndicatorRow}>
            {state.isRunning && !state.isPaused ? (
              <Animated.View
                style={[
                  styles.pulseBeacon,
                  { backgroundColor: COLORS.neonGreen, transform: [{ scale: pulseAnim }] },
                ]}
              />
            ) : state.isPaused ? (
              <View style={[styles.pulseBeacon, { backgroundColor: COLORS.warningAmber }]} />
            ) : (
              <View style={[styles.pulseBeacon, { backgroundColor: COLORS.textMuted }]} />
            )}
            <Text style={styles.statusText}>
              {!state.isRunning ? 'READY' : state.isPaused ? 'PAUSED' : 'CONQUERING'}
            </Text>
          </View>

          <View style={styles.gpsBadge}>
            <View
              style={[
                styles.gpsDot,
                {
                  backgroundColor:
                    state.gpsAccuracy === 'high'
                      ? COLORS.neonGreen
                      : state.gpsAccuracy === 'fair'
                      ? COLORS.warningAmber
                      : COLORS.crimson,
                },
              ]}
            />
            <Text style={styles.gpsText}>GPS LOCK</Text>
          </View>
        </View>

        {/* Live Running Duration Display (Glanceable) */}
        <View style={styles.durationBlock}>
          <Text style={styles.durationNumbers}>{displayValues.elapsed}</Text>
          <Text style={styles.durationCaption}>SESSION TIME</Text>
        </View>

        {/* Telemetry Grid (Glanceable Tabular Figures) */}
        <View style={styles.telemetryGrid}>
          {/* Distance */}
          <GlassCard style={styles.telemetryCard} variant="neonBorder">
            <Text style={styles.metricBigNum}>{displayValues.distance}</Text>
            <Text style={styles.metricCaption}>DISTANCE (KM)</Text>
          </GlassCard>

          {/* Current Pace */}
          <GlassCard style={styles.telemetryCard} variant="blueBorder">
            <Text style={styles.metricBigNum}>{displayValues.pace}</Text>
            <Text style={styles.metricCaption}>PACE (MIN/KM)</Text>
          </GlassCard>

          {/* Calories / Avg Speed */}
          <GlassCard style={styles.telemetryCard}>
            <Text style={[styles.metricBigNum, { color: COLORS.gold }]}>{displayValues.calories}</Text>
            <Text style={styles.metricCaption}>KCAL BURNED</Text>
          </GlassCard>
        </View>
      </View>

      {/* ── Mid-Screen Territory Dispute Alert ── */}
      {activeZoneOwner && (
        <View style={[styles.zoneIndicator, { borderColor: activeZoneOwner.color }]}>
          <View style={styles.zoneIndicatorLeft}>
            <Text style={styles.zoneIndicatorTitle}>⚔️ ENTERED RIVAL SECTOR</Text>
            <Text style={[styles.zoneIndicatorSub, { color: activeZoneOwner.color }]}>
              {activeZoneOwner.name.toUpperCase()}'S TURF
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.battleBoostBtn, { backgroundColor: activeZoneOwner.color }]}
            onPress={async () => {
              try {
                const res = await apiFetch('/api/territory/boost', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: user?.uid }),
                });
                const data = await res.json();
                if (res.ok) {
                  Alert.alert('⚡ 2X CAPTURE BOOST!', `Boost activated! Remaining Arena Coins: ${data.remainingCoins}`);
                } else {
                  Alert.alert('Boost Failed', data.error || 'Insufficient Arena Coins.');
                }
              } catch (e) {
                Alert.alert('Network Error', 'Could not activate boost.');
              }
            }}
          >
            <Text style={styles.battleBoostText}>BOOST ⚡</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Toast Alert */}
      <ConflictToast
        visible={conflictVisible}
        playerName={conflictDetails.name}
        playerColor={conflictDetails.color}
      />

      {/* ── Bottom Runner Cockpit Controls ──
          bottom = tabBarHeight + 12 so the START button is always visible
          above the absolutely-positioned bottom tab bar on every device. */}
      <View style={[styles.bottomControlsArea, { bottom: tabBarHeight + 12 }]}>
        {/* Activity Selector (Only enabled before run starts) */}
        {!state.isRunning && (
          <View style={styles.activitySelectorRow}>
            <TouchableOpacity
              style={[
                styles.activityPill,
                activityType === 'run' && styles.activityPillActive,
              ]}
              onPress={() => setActivityType('run')}
            >
              <Text style={styles.activityIcon}>🏃</Text>
              <Text
                style={[
                  styles.activityLabel,
                  activityType === 'run' && styles.activityLabelActive,
                ]}
              >
                RUN
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.activityPill,
                activityType === 'walk' && styles.activityPillActive,
              ]}
              onPress={() => setActivityType('walk')}
            >
              <Text style={styles.activityIcon}>🚶</Text>
              <Text
                style={[
                  styles.activityLabel,
                  activityType === 'walk' && styles.activityLabelActive,
                ]}
              >
                WALK
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.activityPill,
                activityType === 'bike' && styles.activityPillActive,
              ]}
              onPress={() => setActivityType('bike')}
            >
              <Text style={styles.activityIcon}>🚴</Text>
              <Text
                style={[
                  styles.activityLabel,
                  activityType === 'bike' && styles.activityLabelActive,
                ]}
              >
                BIKE
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Action Controls: Stopped vs Running vs Paused */}
        {!state.isRunning ? (
          <GameButton
            title={starting ? 'INITIALIZING GPS…' : 'START CONQUEST   →'}
            onPress={handleStart}
            variant="primary"
            size="lg"
            icon={starting ? undefined : '⚡'}
            isLoading={starting}
            style={styles.massiveActionBtn}
            testID="run-start-btn"
          />
        ) : (
          <View style={styles.runningActionsRow}>
            {/* Pause / Resume Button */}
            {!state.isPaused ? (
              <GameButton
                title="PAUSE"
                onPress={handlePause}
                variant="warning"
                size="lg"
                icon="⏸"
                style={styles.halfActionBtn}
                testID="run-pause-btn"
              />
            ) : (
              <GameButton
                title="RESUME"
                onPress={handleResume}
                variant="primary"
                size="lg"
                icon="▶"
                style={styles.halfActionBtn}
                testID="run-resume-btn"
              />
            )}

            {/* Finish & Claim Button */}
            <GameButton
              title="FINISH"
              onPress={handleStop}
              variant="danger"
              size="lg"
              icon="🏁"
              style={styles.halfActionBtn}
              testID="run-stop-btn"
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
  },
  topCockpit: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'ios' ? 52 : 44,
    paddingHorizontal: SPACING.md,
    zIndex: 20,
    // Android: zIndex alone is ignored for compositing over native MapView.
    // elevation raises this overlay above the map AND keeps touches from
    // leaking through to the map's native gesture handler.
    elevation: 20,
  },
  hudStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(16, 16, 32, 0.90)',
    borderRadius: RADII.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: SPACING.sm,
  },
  classBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  classEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  classTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  statusIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pulseBeacon: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  gpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gpsDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 5,
  },
  gpsText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textSecondary,
    letterSpacing: 0.8,
  },
  durationBlock: {
    alignItems: 'center',
    marginVertical: 4,
  },
  durationNumbers: {
    fontSize: 44,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  durationCaption: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
  },
  telemetryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
  },
  telemetryCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  metricBigNum: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  metricCaption: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  zoneIndicator: {
    position: 'absolute',
    top: 248,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: 'rgba(25, 12, 24, 0.94)',
    borderWidth: 1.5,
    borderRadius: RADII.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 25,
    ...SHADOWS.crimsonGlow,
    // Must beat bottomControlsArea/topCockpit elevation (20) on Android.
    elevation: 25,
  },
  zoneIndicatorLeft: {
    flex: 1,
  },
  zoneIndicatorTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.crimson,
    letterSpacing: 1,
  },
  zoneIndicatorSub: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  battleBoostBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADII.sm,
  },
  battleBoostText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  bottomControlsArea: {
    position: 'absolute',
    // `bottom` is set dynamically at render time to clear the bottom
    // tab bar (see useBottomTabBarHeight in the component).
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 20,
    // Android: without elevation, this overlay — and the START CONQUEST
    // button inside it — sits under the MapView's native gesture layer,
    // which eats the touch. elevation forces the correct Z order.
    elevation: 20,
  },
  activitySelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(16, 16, 32, 0.92)',
    borderRadius: RADII.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: SPACING.md,
  },
  activityPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: RADII.pill,
  },
  activityPillActive: {
    backgroundColor: 'rgba(0, 255, 136, 0.18)',
    borderWidth: 1,
    borderColor: COLORS.neonGreen,
  },
  activityIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  activityLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
  },
  activityLabelActive: {
    color: COLORS.neonGreen,
    fontWeight: '900',
  },
  massiveActionBtn: {
    width: '100%',
  },
  runningActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  halfActionBtn: {
    flex: 1,
  },
});
