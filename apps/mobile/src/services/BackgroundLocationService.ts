import * as TaskManager from 'expo-task-manager';
import { socketService } from './SocketService';
import { DeviceEventEmitter } from 'react-native';
import type { GeoPoint } from '@runwars/shared';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// Local temporary array to hold points collected during background session
let backgroundPoints: GeoPoint[] = [];

export function getBackgroundPoints(): GeoPoint[] {
  return backgroundPoints;
}

export function clearBackgroundPoints() {
  backgroundPoints = [];
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BackgroundLocation] Task error:', error.message);
    return;
  }
  if (data) {
    const { locations } = data as { locations: any[] };
    const newPoints: GeoPoint[] = locations.map((loc: any) => ({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      timestamp: loc.timestamp || Date.now(),
    }));

    const speedKmh = locations[0]?.coords?.speed && locations[0].coords.speed > 0
      ? locations[0].coords.speed * 3.6
      : 0;

    backgroundPoints.push(...newPoints);

    // Broadcast to active screen listeners
    DeviceEventEmitter.emit('backgroundLocationUpdate', {
      points: newPoints,
      speedKmh,
    });

    // Emit live to socket if connected
    const currentUserId = socketService.userId;
    if (currentUserId && socketService.socket?.connected && newPoints.length > 0) {
      const lastPt = newPoints[newPoints.length - 1];
      if (lastPt) {
        socketService.emitLocationUpdate({
          userId: currentUserId,
          point: lastPt,
          speedKmh,
        });
      }
    }
  }
});
