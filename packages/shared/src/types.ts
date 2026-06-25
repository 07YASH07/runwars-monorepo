/**
 * RunWars — Shared TypeScript Types
 * Used by both the mobile app and the backend server.
 * All types are strict — no `any`.
 */

// ─── Core User ────────────────────────────────────────────────────────────────

export type CharacterType = 'warrior' | 'ninja' | 'mage' | 'scout';

export interface User {
  id: string;
  displayName: string;
  avatarUrl: string;
  characterType: CharacterType;
  totalDistanceMeters: number;
  totalTerritoryClaimed: number;
  color: string; // hex, e.g. "#FF4D4D"
}

// ─── Geo & Location ───────────────────────────────────────────────────────────

export interface GeoPoint {
  latitude: number;
  longitude: number;
  timestamp: number; // Unix ms
}

// ─── Run Session ──────────────────────────────────────────────────────────────

export interface RunSession {
  id: string;
  userId: string;
  startedAt: string; // ISO 8601
  endedAt?: string;
  routePoints: GeoPoint[];
  distanceMeters: number;
  averageSpeedKmh: number;
  currentSpeedKmh: number;
  isActive: boolean;
}

// ─── Territory ────────────────────────────────────────────────────────────────

export interface Territory {
  id: string;
  userId: string;
  runSessionId: string;
  polygonCoordinates: GeoPoint[];
  areaSquareMeters: number;
  claimedAt: string; // ISO 8601
  color: string; // hex
  ownerName?: string;
  ownerAvatar?: string;
}

// ─── Conflict ─────────────────────────────────────────────────────────────────

export interface TerritoryConflict {
  conflictId: string;
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  overlappingAreaSqMeters: number;
  resolvedAt: string; // ISO 8601
}

// ─── Live Multiplayer ─────────────────────────────────────────────────────────

export interface LivePlayerState {
  userId: string;
  displayName: string;
  characterType: CharacterType;
  currentPosition: GeoPoint;
  currentSpeedKmh: number;
  isRunning: boolean;
  color: string; // hex
}

// ─── Socket.io Event Payloads ────────────────────────────────────────────────
// Strongly-typed payloads for every socket event.
// Prevents any accidental `any` in event handlers.

export interface PlayerJoinPayload {
  userId: string;
  displayName: string;
  characterType: CharacterType;
  color: string;
}

export interface LocationUpdatePayload {
  userId: string;
  point: GeoPoint;
  speedKmh: number;
}

export interface RunStartPayload {
  userId: string;
}

export interface RunStopPayload {
  userId: string;
  routePoints: GeoPoint[];
  distanceMeters: number;
}

export interface TerritoryClaimPayload {
  userId: string;
  runSessionId: string;
}

// ─── API Response Shapes ─────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string;
  characterType: CharacterType;
  color: string;
  totalTerritorySqm: number;
  totalDistanceMeters: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ─── Character Meta ───────────────────────────────────────────────────────────

export const CHARACTER_EMOJI: Record<CharacterType, string> = {
  warrior: '⚔️',
  ninja: '🥷',
  mage: '🧙',
  scout: '🏃',
};

export const CHARACTER_DESCRIPTIONS: Record<CharacterType, string> = {
  warrior: 'Bold and aggressive. Claims wide territory with brute force.',
  ninja: 'Swift and silent. Masters of stealth running at night.',
  mage: 'Arcane and mysterious. Leaves glowing trails on the map.',
  scout: 'Fast and agile. Explores new zones faster than anyone.',
};

// ─── Color Palette ────────────────────────────────────────────────────────────
// 20 vivid, distinct territory colors assigned randomly on registration.

export const TERRITORY_COLORS: readonly string[] = [
  '#FF4D4D', // Crimson Red
  '#FF8C00', // Dark Orange
  '#FFD700', // Gold
  '#ADFF2F', // Green Yellow
  '#00FA9A', // Medium Spring Green
  '#00CED1', // Dark Turquoise
  '#1E90FF', // Dodger Blue
  '#7B68EE', // Medium Slate Blue
  '#DA70D6', // Orchid
  '#FF69B4', // Hot Pink
  '#FF6347', // Tomato
  '#40E0D0', // Turquoise
  '#9ACD32', // Yellow Green
  '#6495ED', // Cornflower Blue
  '#DC143C', // Crimson
  '#00BFFF', // Deep Sky Blue
  '#32CD32', // Lime Green
  '#FF1493', // Deep Pink
  '#8A2BE2', // Blue Violet
  '#20B2AA', // Light Sea Green
] as const;

export function getRandomTerritoryColor(): string {
  return TERRITORY_COLORS[Math.floor(Math.random() * TERRITORY_COLORS.length)] ?? '#FF4D4D';
}
