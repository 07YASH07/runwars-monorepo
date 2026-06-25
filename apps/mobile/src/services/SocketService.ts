import { io, Socket } from 'socket.io-client';
import {
  PlayerJoinPayload,
  LocationUpdatePayload,
  RunStartPayload,
  RunStopPayload,
  TerritoryClaimPayload,
} from '@runwars/shared';

// Uses local network IP from env, or falls back to localhost (for emulator)
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://10.0.2.2:3000';

class SocketService {
  public socket: Socket | null = null;
  public userId: string | null = null;
  private connectionPromise: Promise<void> | null = null;

  connect(userId: string, displayName: string, characterType: string, color: string) {
    this.userId = userId;
    if (this.socket?.connected) return;

    this.socket = io(SOCKET_URL, {
      transports: ['websocket'],
      extraHeaders: {
        'Bypass-Tunnel-Reminder': 'true'
      }
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected to backend');
      
      // Emit player join
      const payload: PlayerJoinPayload = {
        userId,
        displayName,
        characterType: characterType as any,
        color,
      };
      this.socket?.emit('playerJoin', payload);
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from backend');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  emitLocationUpdate(payload: LocationUpdatePayload) {
    this.socket?.emit('locationUpdate', payload);
  }

  emitRunStart(payload: RunStartPayload) {
    this.socket?.emit('runStart', payload);
  }

  emitRunStop(payload: RunStopPayload) {
    this.socket?.emit('runStop', payload);
  }

  emitTerritoryClaim(payload: TerritoryClaimPayload & { polygonCoordinates: any[], areaSquareMeters: number, color: string }) {
    this.socket?.emit('territoryClaim', payload);
  }

  // Generic subscriber
  onEvent(event: string, callback: (...args: any[]) => void) {
    this.socket?.on(event, callback);
  }

  offEvent(event: string, callback?: (...args: any[]) => void) {
    this.socket?.off(event, callback);
  }
}

export const socketService = new SocketService();
