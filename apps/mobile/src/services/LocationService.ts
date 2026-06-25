/**
 * LocationService — GPS tracking for RunWars.
 *
 * Handles:
 * - Requesting foreground + background location permissions
 * - Starting/stopping GPS watchPosition with 2s updates, 5m filter
 * - Haversine distance calculation
 * - Speed calculation in km/h
 *
 * All functions are async with try/catch and meaningful errors.
 */
import * as Location from 'expo-location';
import type { GeoPoint } from '@runwars/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

type LocationUpdateCallback = (point: GeoPoint, speedKmh: number) => void;
type PermissionStatus = 'granted' | 'denied' | 'unavailable';

// ─── Module State ─────────────────────────────────────────────────────────────
// Using module-level state instead of a class to keep it functional.

let watchSubscription: Location.LocationSubscription | null = null;

// ─── Permission Request ───────────────────────────────────────────────────────

/**
 * Request foreground AND background location permissions.
 * Returns 'granted' only if both are granted.
 * Background permission is required for tracking when app is minimized.
 */
export async function requestLocationPermissions(): Promise<PermissionStatus> {
  try {
    const { status: foregroundStatus } =
      await Location.requestForegroundPermissionsAsync();

    if (foregroundStatus !== 'granted') {
      console.warn('[LocationService] Foreground permission denied');
      return 'denied';
    }

    const { status: backgroundStatus } =
      await Location.requestBackgroundPermissionsAsync();

    if (backgroundStatus !== 'granted') {
      console.warn(
        '[LocationService] Background permission denied — run tracking will pause when app is minimized'
      );
      // Still allow foreground-only tracking
      return 'granted';
    }

    return 'granted';
  } catch (error) {
    console.error('[LocationService] Permission request failed:', error);
    return 'unavailable';
  }
}

// ─── Start Tracking ───────────────────────────────────────────────────────────

/**
 * Start GPS tracking. Calls onUpdate every ~2 seconds (or 5m movement).
 * Must call requestLocationPermissions() before this.
 *
 * @param onUpdate - callback receiving each new GeoPoint
 * @throws if location services are unavailable or already tracking
 */
export async function startTracking(
  onUpdate: LocationUpdateCallback
): Promise<void> {
  if (watchSubscription) {
    console.warn('[LocationService] Already tracking — stop first');
    return;
  }

  try {
    // Verify we actually have permission before starting
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error(
        'Location permission not granted. Please enable location access in device settings.'
      );
    }

    watchSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,       // minimum ms between updates
        distanceInterval: 5,      // minimum meters between updates
      },
      (location) => {
        const point: GeoPoint = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
        };
        const speedKmh = (location.coords.speed && location.coords.speed > 0)
          ? location.coords.speed * 3.6
          : 0;
        onUpdate(point, speedKmh);
      }
    );

    console.log('[LocationService] Tracking started');
  } catch (error) {
    watchSubscription = null;
    throw new Error(
      `Failed to start GPS tracking: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// ─── Stop Tracking ────────────────────────────────────────────────────────────

/**
 * Stop GPS tracking and clean up the subscription.
 */
export function stopTracking(): void {
  if (watchSubscription) {
    watchSubscription.remove();
    watchSubscription = null;
    console.log('[LocationService] Tracking stopped');
  }
}

/**
 * Returns true if currently tracking.
 */
export function isTracking(): boolean {
  return watchSubscription !== null;
}

const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

/**
 * Start background location tracking with foreground service notification.
 */
export async function startBackgroundTracking(): Promise<void> {
  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      console.warn('[LocationService] Background tracking already started');
      return;
    }

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 2000,
      distanceInterval: 5,
      foregroundService: {
        notificationTitle: 'RunWars Tracking Active',
        notificationBody: 'Conquering territory in the background...',
        notificationColor: '#FF4D4D',
      },
      pausesUpdatesAutomatically: false,
    });
    console.log('[LocationService] Background tracking started');
  } catch (error) {
    console.error('[LocationService] Failed to start background tracking:', error);
  }
}

/**
 * Stop background location tracking.
 */
export async function stopBackgroundTracking(): Promise<void> {
  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      console.log('[LocationService] Background tracking stopped');
    }
  } catch (error) {
    console.error('[LocationService] Failed to stop background tracking:', error);
  }
}

// ─── Distance Calculation ─────────────────────────────────────────────────────

/**
 * Haversine formula — calculates the great-circle distance between two points.
 * @returns distance in meters
 */
function haversineDistance(p1: GeoPoint, p2: GeoPoint): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(p2.latitude - p1.latitude);
  const dLon = toRad(p2.longitude - p1.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.latitude)) *
      Math.cos(toRad(p2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate total distance from an array of GPS points.
 * Sums Haversine distance between each consecutive pair of points.
 *
 * @param points - array of GeoPoints (must have >= 2 for non-zero distance)
 * @returns total distance in meters
 */
export function calculateDistance(points: GeoPoint[]): number {
  if (points.length < 2) return 0;

  let totalMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev && curr) {
      totalMeters += haversineDistance(prev, curr);
    }
  }
  return totalMeters;
}

// ─── Speed Calculation ────────────────────────────────────────────────────────

/**
 * Calculate speed between two GPS points.
 *
 * @param p1 - starting point (earlier timestamp)
 * @param p2 - ending point (later timestamp)
 * @returns speed in km/h (0 if timestamps are equal or reversed)
 */
export function calculateSpeed(p1: GeoPoint, p2: GeoPoint): number {
  const timeDiffMs = p2.timestamp - p1.timestamp;
  if (timeDiffMs <= 0) return 0;

  const distanceMeters = haversineDistance(p1, p2);
  const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

  return distanceMeters / 1000 / timeDiffHours; // km/h
}

/**
 * Format speed as a pace string "M:SS /km"
 * Returns "–:– /km" if speed is 0 or negligible.
 */
export function formatPace(speedKmh: number): string {
  if (speedKmh < 0.5) return '–:– /km';

  const paceMinutesPerKm = 60 / speedKmh;
  let minutes = Math.floor(paceMinutesPerKm);
  let seconds = Math.round((paceMinutesPerKm - minutes) * 60);
  
  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }
  
  const paddedSeconds = seconds.toString().padStart(2, '0');
  return `${minutes}:${paddedSeconds} /km`;
}

/**
 * Format elapsed seconds into HH:MM:SS stopwatch string.
 */
export function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((v) => v.toString().padStart(2, '0'))
    .join(':');
}
