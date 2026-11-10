/**
 * MapDashboardScreen — Core Home Gaming Dashboard for StrideClash.
 *
 * Primary visual focus: Live Interactive Conquest Map with real-time HUD.
 * Features:
 * - Live Google Map in Cyberpunk dark mode with claimed turf polygons
 * - Real-time rival markers & live GPS current location
 * - Player Level & XP bar, Arena Coins pill
 * - Conquered territory count & Total conquered area
 * - Active territory dispute banner with one-tap challenge
 * - Daily Conquest Missions card
 * - Quick "START CONQUEST" floating action button deep-linking to Run
 * - Tactical map controls (Recenter, radar scan)
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
  StatusBar,
  ScrollView,
  Alert,
} from 'react-native';
import MapView, { Polygon, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useAuth } from '@/context/AuthContext';
import { useMultiplayer } from '@/hooks/useMultiplayer';
import { useNavigation } from '@react-navigation/native';
import { CHARACTER_EMOJI, CharacterType } from '@runwars/shared';
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
  DisputeBanner,
} from '@/components/ui';
import { apiFetch } from '@/config/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Parse GeoJSON Turf polygon features to react-native-maps coordinates
function parsePolygonCoords(feature: any) {
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

export default function MapDashboardScreen() {
  const { user } = useAuth();
  const { territories, livePlayers, socketService } = useMultiplayer();
  const navigation = useNavigation<any>();
  const mapRef = useRef<MapView | null>(null);

  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [profileStats, setProfileStats] = useState<{
    total_territory: number;
    total_distance: number;
    total_runs: number;
    coins: number;
    total_zones: number;
  }>({
    total_territory: 0,
    total_distance: 0,
    total_runs: 0,
    coins: 100,
    total_zones: 0,
  });

  const [activeDispute, setActiveDispute] = useState<{
    rivalName: string;
    rivalColor: string;
    areaSqm: number;
  } | null>(null);

  // Fetch player stats
  const fetchStats = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const res = await apiFetch(`/api/profile/${user.uid}`);
      if (res.ok) {
        const data = await res.json();
        setProfileStats({
          total_territory: data.stats?.total_territory || 0,
          total_distance: data.stats?.total_distance || 0,
          total_runs: data.stats?.total_runs || 0,
          coins: data.user?.coins ?? 100,
          total_zones: data.stats?.total_zones || 0,
        });
      }
    } catch (e) {
      console.log('[MapDashboard] stats fetch error', e);
    }
  }, [user?.uid]);

  // Request location & initial center
  useEffect(() => {
    fetchStats();

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setCurrentLocation(coords);

          mapRef.current?.animateToRegion(
            {
              ...coords,
              latitudeDelta: 0.015,
              longitudeDelta: 0.015,
            },
            800
          );
        }
      } catch (err) {
        console.log('[MapDashboard] GPS init error', err);
      }
    })();

    // Listen for territory dispute events from socket
    const onStolen = (data: { byPlayerName: string; byPlayerColor: string; area?: number }) => {
      setActiveDispute({
        rivalName: data.byPlayerName || 'Rival Runner',
        rivalColor: data.byPlayerColor || COLORS.crimson,
        areaSqm: data.area || 850,
      });
    };

    socketService.onEvent('territory:stolen', onStolen);
    return () => {
      socketService.offEvent('territory:stolen', onStolen);
    };
  }, [fetchStats, user?.uid, socketService]);

  // Calculate Level and XP based on distance & territory
  const levelData = useMemo(() => {
    const totalKm = (profileStats.total_distance || 0) / 1000;
    const level = Math.floor(totalKm / 5) + 1;
    const currentLevelProgressKm = totalKm % 5;
    const progressPercent = currentLevelProgressKm / 5;
    return {
      level,
      currentKm: currentLevelProgressKm.toFixed(1),
      nextLevelKm: '5.0',
      progressPercent,
    };
  }, [profileStats.total_distance]);

  // Conquered territory formatted
  const territoryDisplay = useMemo(() => {
    const area = profileStats.total_territory || 0;
    if (area >= 1000000) {
      return { val: (area / 1000000).toFixed(2), unit: 'KM²' };
    }
    return { val: Math.round(area).toLocaleString(), unit: 'M²' };
  }, [profileStats.total_territory]);

  const handleRecenter = () => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          ...currentLocation,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        },
        500
      );
    }
  };

  const handleStartConquest = () => {
    navigation.navigate('RUN');
  };

  const handleViewBattles = () => {
    navigation.navigate('COMPETE');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Main Map Visual Focus ── */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={CYBER_DARK_MAP_STYLE}
        initialRegion={{
          latitude: currentLocation?.latitude || 28.6139,
          longitude: currentLocation?.longitude || 77.209,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {/* Render Claimed Territories */}
        {territories.map((t) => {
          let coords: any[] = [];
          if (t.polygonCoordinates && t.polygonCoordinates.length > 2) {
            coords = t.polygonCoordinates;
          } else {
            coords = parsePolygonCoords(t);
          }
          if (coords.length < 3) return null;

          const isMine = t.userId === user?.uid;
          const strokeColor = isMine ? (user?.color || COLORS.neonGreen) : (t.color || COLORS.crimson);
          const fillColor = isMine ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.22)';

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

        {/* Live Multiplayer Rival Markers */}
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
              description={p.isRunning ? `Running (${p.currentSpeedKmh.toFixed(1)} km/h)` : 'Active'}
            >
              <View style={[styles.playerMarker, { borderColor: p.color || COLORS.electricBlue }]}>
                <Text style={styles.playerMarkerEmoji}>
                  {(CHARACTER_EMOJI as any)[p.characterType || 'scout']}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* ── Floating Gaming Top HUD ── */}
      <View style={styles.topHudContainer}>
        {/* Header Bar */}
        <View style={styles.headerRow}>
          <View style={styles.brandingCol}>
            <Text style={styles.brandTitle}>STRIDECLASH</Text>
            <Text style={styles.brandSub}>CONQUEST RADAR</Text>
          </View>

          {/* Arena Coins Pill */}
          <TouchableOpacity
            style={styles.coinPill}
            onPress={() => navigation.navigate('PROFILE')}
            activeOpacity={0.8}
          >
            <Text style={styles.coinIcon}>🪙</Text>
            <Text style={styles.coinText}>{profileStats.coins}</Text>
          </TouchableOpacity>

          {/* Profile Avatar Quick Link */}
          <TouchableOpacity
            onPress={() => navigation.navigate('PROFILE')}
            activeOpacity={0.8}
          >
            <PlayerAvatar
              selectedAvatar={user?.selectedAvatar}
              characterType={user?.characterType}
              color={user?.color}
              level={levelData.level}
              size="sm"
            />
          </TouchableOpacity>
        </View>

        {/* Level & XP Progress Card */}
        <GlassCard style={styles.levelCard}>
          <ProgressBar
            progress={levelData.progressPercent}
            label={`LEVEL ${levelData.level} VANGUARD`}
            valueText={`${levelData.currentKm} / ${levelData.nextLevelKm} KM`}
            color={user?.color || COLORS.neonGreen}
            height={6}
          />
        </GlassCard>

        {/* Glanceable Territory Statistics Panel */}
        <View style={styles.statsRow}>
          <StatBadge
            label="MY ZONES"
            value={profileStats.total_zones || territories.filter(t => t.userId === user?.uid).length}
            icon="🚩"
            accentColor={COLORS.neonGreen}
            style={styles.statChip}
          />
          <StatBadge
            label="TURF AREA"
            value={territoryDisplay.val}
            unit={territoryDisplay.unit}
            icon="🌐"
            accentColor={COLORS.electricBlue}
            style={styles.statChip}
          />
          <StatBadge
            label="ACTIVE RIVALS"
            value={livePlayers.length > 0 ? livePlayers.length : 1}
            icon="👥"
            accentColor={COLORS.gold}
            style={styles.statChip}
          />
        </View>
      </View>

      {/* ── Mid-Screen Tactical Overlays ── */}
      <View style={styles.midOverlayContainer}>
        {/* Active Dispute Banner (if invasion ongoing) */}
        {activeDispute && (
          <DisputeBanner
            rivalName={activeDispute.rivalName}
            rivalColor={activeDispute.rivalColor}
            areaSqm={activeDispute.areaSqm}
            onPressAction={handleViewBattles}
            actionTitle="ENGAGE"
            style={styles.disputeItem}
          />
        )}
      </View>

      {/* ── Bottom Controls & Conquest Launcher ── */}
      <View style={styles.bottomLauncherContainer}>
        {/* Recenter & Map Controls Row */}
        <View style={styles.mapActionsRow}>
          <TouchableOpacity
            style={styles.mapCircleBtn}
            onPress={handleRecenter}
            activeOpacity={0.8}
          >
            <Text style={styles.mapCircleBtnIcon}>🎯</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.radarCard}
            onPress={handleViewBattles}
            activeOpacity={0.85}
          >
            <Text style={styles.radarIcon}>⚔️</Text>
            <View>
              <Text style={styles.radarTitle}>TERRITORY DISPUTES</Text>
              <Text style={styles.radarSub}>
                {territories.length} contested sectors nearby
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Massive Start Conquest Action Button */}
        <GameButton
          title="START CONQUEST   →"
          onPress={handleStartConquest}
          variant="primary"
          size="lg"
          icon="⚡"
          style={styles.startBtn}
          testID="dashboard-start-conquest"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgCanvas,
  },
  topHudContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'ios' ? 52 : 44,
    paddingHorizontal: SPACING.md,
    zIndex: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  brandingCol: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1.2,
  },
  brandSub: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.neonGreen,
    letterSpacing: 1.5,
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    borderWidth: 1.2,
    borderColor: COLORS.gold,
    borderRadius: RADII.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 10,
    ...SHADOWS.goldGlow,
  },
  coinIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  coinText: {
    color: COLORS.gold,
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  levelCard: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: SPACING.sm,
    backgroundColor: 'rgba(16, 27, 45, 0.90)',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  statChip: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  midOverlayContainer: {
    position: 'absolute',
    top: 230,
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 15,
  },
  disputeItem: {
    marginBottom: 8,
  },
  bottomLauncherContainer: {
    position: 'absolute',
    bottom: 24,
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 20,
  },
  mapActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  mapCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(16, 27, 45, 0.92)',
    borderWidth: 1.5,
    borderColor: COLORS.borderMedium,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.surface,
  },
  mapCircleBtnIcon: {
    fontSize: 20,
  },
  radarCard: {
    flex: 1,
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 27, 45, 0.92)',
    borderWidth: 1.2,
    borderColor: 'rgba(157, 0, 255, 0.4)',
    borderRadius: RADII.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    ...SHADOWS.purpleGlow,
  },
  radarIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  radarTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  radarSub: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  startBtn: {
    width: '100%',
    shadowColor: COLORS.neonGreen,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
  },
  playerMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#162238',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 6,
  },
  playerMarkerEmoji: {
    fontSize: 20,
  },
});
