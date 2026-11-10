/**
 * SocketService — one authenticated Socket.IO connection to the remote backend.
 *
 * - Uses socket.io's built-in reconnection, so the Socket object (and every
 *   listener registered on it) survives network drops.
 * - Sends the backend JWT in the handshake; the server derives identity from
 *   it (client-sent userIds are ignored).
 * - Listeners registered through onEvent() are kept in a registry and
 *   re-attached if the socket is ever recreated (e.g. after logout/login).
 */
import { io, Socket } from 'socket.io-client';
import {
  PlayerJoinPayload,
  LocationUpdatePayload,
  RunStartPayload,
} from '@runwars/shared';
import { SOCKET_URL, getAuthToken } from '@/config/api';

type Listener = (...args: any[]) => void;

class SocketService {
  public socket: Socket | null = null;
  public userId: string | null = null;
  private lastJoinPayload: PlayerJoinPayload | null = null;
  private listeners = new Map<string, Set<Listener>>();

  connect(userId: string, displayName: string, characterType: string, color: string) {
    this.userId = userId;
    this.lastJoinPayload = { userId, displayName, characterType: characterType as any, color };

    if (this.socket) {
      // Already created: (re)join with fresh profile data if connected.
      if (this.socket.connected) this.socket.emit('playerJoin', this.lastJoinPayload);
      else this.socket.connect();
      return;
    }

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      timeout: 20000,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
      // Evaluated on every (re)connect so a refreshed token is always used.
      auth: (cb) => cb({ token: getAuthToken() }),
    });

    socket.on('connect', () => {
      console.log('[Socket] connected');
      if (this.lastJoinPayload) socket.emit('playerJoin', this.lastJoinPayload);
    });
    socket.on('disconnect', (reason) => console.log('[Socket] disconnected:', reason));
    socket.on('connect_error', (err) => console.warn('[Socket] connect error:', err.message));
    socket.on('auth:error', (e) => console.warn('[Socket] auth error:', e?.event, e?.code));

    for (const [event, set] of this.listeners) for (const cb of set) socket.on(event, cb);
    this.socket = socket;
  }

  /** Full teardown (logout): drops identity and the connection. */
  disconnect() {
    this.lastJoinPayload = null;
    this.userId = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  get connected(): boolean {
    return !!this.socket?.connected;
  }

  emitLocationUpdate(payload: LocationUpdatePayload) {
    this.socket?.emit('locationUpdate', payload);
  }

  emitRunStart(payload: RunStartPayload) {
    this.socket?.emit('runStart', payload);
  }

  onEvent(event: string, callback: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    this.socket?.on(event, callback);
  }

  offEvent(event: string, callback?: Listener) {
    if (callback) {
      this.listeners.get(event)?.delete(callback);
      this.socket?.off(event, callback);
    } else {
      this.listeners.delete(event);
      this.socket?.off(event);
    }
  }
}

export const socketService = new SocketService();
