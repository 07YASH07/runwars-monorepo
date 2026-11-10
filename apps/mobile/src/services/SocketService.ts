import { io, Socket } from 'socket.io-client';
import {
  PlayerJoinPayload,
  LocationUpdatePayload,
  RunStartPayload,
  RunStopPayload,
  TerritoryClaimPayload,
} from '@runwars/shared';
import { CANDIDATE_API_URLS } from '@/config/api';

class SocketService {
  public socket: Socket | null = null;
  public userId: string | null = null;
  private currentUrlIndex = 0;
  private lastJoinPayload: PlayerJoinPayload | null = null;

  connect(userId: string, displayName: string, characterType: string, color: string) {
    this.userId = userId;
    this.lastJoinPayload = {
      userId,
      displayName,
      characterType: characterType as any,
      color,
    };
    if (this.socket?.connected) return;

    this.attemptConnect();
  }

  private attemptConnect() {
    if (this.socket) {
      try { this.socket.disconnect(); } catch (e) {}
    }

    const targetUrl = CANDIDATE_API_URLS[this.currentUrlIndex % CANDIDATE_API_URLS.length];
    console.log(`[Socket] Connecting to ${targetUrl}...`);

    this.socket = io(targetUrl, {
      transports: ['websocket'],
      timeout: 6000,
      extraHeaders: {
        'Bypass-Tunnel-Reminder': 'true'
      }
    });

    this.socket.on('connect', () => {
      console.log(`[Socket] Connected to backend at ${targetUrl}`);
      if (this.lastJoinPayload) {
        this.socket?.emit('playerJoin', this.lastJoinPayload);
      }
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from backend');
    });

    this.socket.on('connect_error', (err) => {
      console.warn(`[Socket] Error on ${targetUrl}:`, err.message);
      // Try next candidate url after 3 seconds
      if (CANDIDATE_API_URLS.length > 1) {
        this.currentUrlIndex++;
        setTimeout(() => {
          if (!this.socket?.connected) {
            this.attemptConnect();
          }
        }, 3000);
      }
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
