import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Expo } from 'expo-server-sdk';
import {
  requireAuth,
  optionalAuth,
  requireAdmin,
  signUserToken,
  socketUserId,
  verifyFirebaseIdToken,
  createFirebaseCustomToken,
  firebaseCustomTokensEnabled,
} from './auth';
import { localStore, LocalUser } from './localStore';
import {
  LivePlayerState,
  Territory,
  PlayerJoinPayload,
  LocationUpdatePayload,
  RunStartPayload,
  RunStopPayload,
  TerritoryClaimPayload,
} from '@runwars/shared';

dotenv.config();

const app = express();
app.use(cors());
app.use(morgan('dev'));
// Images go to Firebase Storage, never through the API, so JSON bodies stay small.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use('/admin', express.static(path.join(__dirname, '../../admin/dist')));

// Direct APK download route for mobile devices
app.get(['/download/strideclash.apk', '/strideclash.apk', '/download/apk', '/apk'], (req, res) => {
  const possiblePaths = [
    'C:/Users/Dell/.gemini/antigravity/scratch/runwars/strideclash.apk',
    path.join(__dirname, '../../../apps/mobile/android/app/build/outputs/apk/release/app-release.apk'),
    path.join(__dirname, '../../../apps/mobile/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk'),
    'C:/Users/Dell/.gemini/antigravity/scratch/runwars/apps/mobile/android/app/build/outputs/apk/release/app-release.apk',
    'R:/apps/mobile/android/app/build/outputs/apk/release/app-release.apk'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return res.download(p, 'strideclash.apk');
    }
  }

  const dir = path.join(__dirname, '../../../apps/mobile/android/app/build/outputs/apk/release');
  if (fs.existsSync(dir)) {
    const apks = fs.readdirSync(dir).filter(f => f.endsWith('.apk'));
    if (apks.length > 0) {
      return res.download(path.join(dir, apks[0]), 'strideclash.apk');
    }
  }

  res.status(503).send(`
    <html>
      <head><meta http-equiv="refresh" content="10"><title>Building StrideClash APK</title></head>
      <body style="background:#0A0A14;color:#00BFFF;font-family:sans-serif;text-align:center;padding:50px;">
        <h2>⚙️ StrideClash APK compilation is in progress...</h2>
        <p style="color:#8A8AAB;">Gradle is currently packaging the release binary on the server.</p>
        <p style="color:#fff;">This page will automatically refresh every 10 seconds and start downloading when ready!</p>
      </body>
    </html>
  `);
});

app.get('/admin/*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../../admin/dist/index.html'));
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// --- PostgreSQL Connection ---
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/runwars';
// Managed Postgres (Supabase, Render, AWS RDS, Neon) requires TLS. Disable
// only for a bare localhost dev DB.
const requiresSsl = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Live, continuously-updated DB state (not a one-shot flag).
let isDbConnected = false;
let dbLastError: string | null = null;
let dbLastCheckedAt = 0;

function redactUrl(msg: string): string {
  // Strip any accidental credentials from error output.
  return msg.replace(/postgres(ql)?:\/\/[^@\s]+@/gi, 'postgres://***@');
}

pool.on('error', (err: any) => {
  isDbConnected = false;
  dbLastError = redactUrl(err?.message || String(err));
  console.error('[Database] pool error:', dbLastError);
  // Never process.exit — bounce the flag and let the next probe recover.
});

async function probeDb(timeoutMs = 5000): Promise<boolean> {
  dbLastCheckedAt = Date.now();
  try {
    const client = await pool.connect();
    try {
      await Promise.race([
        client.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), timeoutMs)),
      ]);
      if (!isDbConnected) console.log('[Database] connection healthy');
      isDbConnected = true;
      dbLastError = null;
      return true;
    } finally {
      client.release();
    }
  } catch (e: any) {
    if (isDbConnected) console.error('[Database] probe failed:', redactUrl(e.message));
    isDbConnected = false;
    dbLastError = redactUrl(e?.message || String(e));
    return false;
  }
}

// --- In-Memory Live State (real-time only, not persisted) ---
const livePlayers = new Map<string, LivePlayerState>();
const socketToUser = new Map<string, string>();
const userToSocket = new Map<string, string>(); // userId -> socketId for targeted events
const pushTokens = new Map<string, string>();   // userId -> Expo push token
const ongoingDbWrites = new Map<string, Promise<any>>();
const lastAlerts = new Map<string, number>();   // spam prevention for invasion alerts

// Bounded exponential backoff on startup — never blocks the HTTP server from
// starting; the fallback store answers requests while we retry in the background.
(async () => {
  console.log('[Database] connecting…');
  let delay = 2000;
  for (let i = 1; i <= 6; i++) {
    if (await probeDb()) {
      try {
        const res = await pool.query('SELECT id, expo_push_token FROM users WHERE expo_push_token IS NOT NULL');
        for (const row of res.rows) {
          pushTokens.set(row.id, row.expo_push_token);
          localStore.upsertUser(row.id, { expo_push_token: row.expo_push_token });
        }
        console.log(`[Push] Loaded ${pushTokens.size} push tokens from database.`);
      } catch (err: any) {
        console.error('[Push] Failed to load push tokens:', redactUrl(err.message));
      }
      return;
    }
    console.error(`[Database] connect attempt ${i} failed (${dbLastError}); retry in ${delay}ms`);
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30000);
  }
  console.error('[Database] gave up after 6 attempts — degraded mode (local JSON fallback) active. Will keep re-probing every 60s.');
})();

// Periodic re-probe so we recover automatically when the DB comes back.
setInterval(() => { probeDb().catch(() => {}); }, 60000);

// In-memory push notification log (Phase 4)
interface PushLogEntry { title: string; body: string; sentCount: number; timestamp: string; }
const pushLog: PushLogEntry[] = [];


// --- Bounding Box Overlap Detection (no PostGIS needed) ---
interface BBox { minLat: number; maxLat: number; minLng: number; maxLng: number; }

function getBBox(coords: { latitude: number; longitude: number }[]): BBox {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  return !(a.maxLat < b.minLat || a.minLat > b.maxLat ||
           a.maxLng < b.minLng || a.minLng > b.maxLng);
}

// Ray-casting Point-in-Polygon check
function isPointInPolygon(point: { latitude: number; longitude: number }, polygon: { latitude: number; longitude: number }[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Get total distance run by a player from DB or local store
async function getPlayerTotalDistance(userId: string): Promise<number> {
  const localDist = localStore.getUserStats(userId).total_distance;
  if (localDist > 0) return localDist;
  if (isDbConnected) {
    try {
      const res = await pool.query(
        `SELECT COALESCE(SUM(distance_meters), 0)::float AS total FROM runs WHERE user_id = $1`,
        [userId]
      );
      return res.rows[0]?.total ?? 0;
    } catch { return 0; }
  }
  return 0;
}

// Delete territory from DB
async function deleteTerritory(id: string) {
  try {
    await pool.query(`DELETE FROM territories WHERE id = $1`, [id]);
  } catch (err: any) {
    console.error('[DB] deleteTerritory error:', err.message);
  }
}

// Send Expo push notification
async function sendPushNotification(pushToken: string, title: string, body: string) {
  try {
    if (!pushToken.startsWith('ExponentPushToken')) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title, body, sound: 'default' }),
    });
    console.log(`[Push] Notification sent to ${pushToken.slice(0, 30)}...`);
  } catch (err: any) {
    console.error('[Push] Failed to send push notification:', err.message);
  }
}

// --- Image URL validation ---
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET?.trim() || 'runwars-355df.firebasestorage.app';

/** True only for a Firebase Storage download URL inside the caller's own folder. */
function isOwnStorageImageUrl(raw: unknown, userId: string): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return false;
  const m = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(u.pathname);
  if (!m || m[1] !== STORAGE_BUCKET) return false;
  let objectPath: string;
  try { objectPath = decodeURIComponent(m[2]); } catch { return false; }
  const parts = objectPath.split('/');
  return parts.length === 3 && /^(post|avatar|cover)-images$/.test(parts[0]) && parts[1] === userId && /^[\w.-]+$/.test(parts[2]);
}

// --- DB Helper Functions ---

async function upsertUser(userId: string, data: Partial<{ email: string; display_name: string; character_type: string; color: string }>) {
  localStore.upsertUser(userId, data);
  if (isDbConnected) {
    try {
      await pool.query(
        `INSERT INTO users (id, email, display_name, character_type, color)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           character_type = EXCLUDED.character_type,
           color = EXCLUDED.color`,
        [userId, data.email || null, data.display_name || null, data.character_type || null, data.color || null]
      );
    } catch (err: any) {
      console.error('[DB] upsertUser error:', err.message);
    }
  }
}

function haversineDistance(p1: any, p2: any): number {
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

function calculateDistance(points: any[]): number {
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

async function saveRun(userId: string, routePoints: any[], distanceMeters: number, activityType?: string) {
  localStore.addRun({
    user_id: userId,
    route_points: routePoints,
    distance_meters: distanceMeters,
    activity_type: activityType || 'run',
    created_at: new Date().toISOString()
  });
  if (isDbConnected) {
    try {
      const result = await pool.query(
        `INSERT INTO runs (user_id, route_points, distance_meters, activity_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, JSON.stringify(routePoints), distanceMeters, activityType || 'run']
      );
      return result.rows[0]?.id;
    } catch (err: any) {
      console.error('[DB] saveRun error:', err.message);
    }
  }
  return Date.now();
}

async function saveTerritory(territory: Territory) {
  try {
    await pool.query(
      `INSERT INTO territories (id, owner_id, polygon_coordinates, area_square_meters, color, run_session_id, claimed_at, avg_speed_kmh, activity_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         polygon_coordinates = EXCLUDED.polygon_coordinates,
         area_square_meters = EXCLUDED.area_square_meters,
         avg_speed_kmh = EXCLUDED.avg_speed_kmh,
         activity_type = EXCLUDED.activity_type`,
      [
        territory.id,
        territory.userId,
        JSON.stringify(territory.polygonCoordinates),
        territory.areaSquareMeters,
        territory.color,
        territory.runSessionId,
        territory.claimedAt,
        territory.avgSpeedKmh || 0,
        territory.activityType || 'run',
      ]
    );
    console.log(`[DB] Territory ${territory.id} saved successfully.`);
  } catch (err: any) {
    console.error('[DB] saveTerritory error:', err.message);
  }
}

async function loadAllTerritories(): Promise<Territory[]> {
  try {
    const result = await pool.query(
      `SELECT t.id, t.owner_id, t.polygon_coordinates, t.area_square_meters, t.color, t.run_session_id, t.claimed_at, t.avg_speed_kmh, t.activity_type,
              u.display_name AS owner_name, u.avatar_url AS owner_avatar
       FROM territories t
       LEFT JOIN users u ON u.id = t.owner_id`
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.owner_id,
      polygonCoordinates: row.polygon_coordinates,
      areaSquareMeters: row.area_square_meters,
      color: row.color,
      runSessionId: row.run_session_id,
      claimedAt: row.claimed_at?.toISOString() || new Date().toISOString(),
      ownerName: row.owner_name || 'Runner',
      ownerAvatar: row.owner_avatar || '',
      avgSpeedKmh: row.avg_speed_kmh || 0,
      activityType: row.activity_type || 'run',
    }));
  } catch (err: any) {
    console.error('[DB] loadAllTerritories error:', err.message);
    return [];
  }
}

// In-memory territories cache (loaded from DB on startup)
let territoriesCache = new Map<string, Territory>();

// Load territories from DB on startup
loadAllTerritories().then((territories) => {
  territories.forEach((t) => territoriesCache.set(t.id, t));
  console.log(`✅ [Database] Loaded ${territories.length} existing territories from DB.`);
});

// ─── Run + territory processing (shared by Socket.IO and REST /api/runs) ─────

type ClaimPayload = TerritoryClaimPayload & { polygonCoordinates: any[]; areaSquareMeters: number; color: string; activityType?: string };
type ClaimReply = (event: string, data: any) => void;

const ALLOWED_ACTIVITIES = new Set(['run', 'walk', 'cycle']);
const MAX_ROUTE_POINTS = 20000;

/** Keeps only well-formed GPS points, sorted by time. */
function sanitizeRoute(points: any): { latitude: number; longitude: number; timestamp: number }[] {
  if (!Array.isArray(points)) return [];
  return points
    .slice(0, MAX_ROUTE_POINTS)
    .filter((p: any) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
      Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && Number.isFinite(p.timestamp))
    .map((p: any) => ({ latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp, ...(Number.isFinite(p.accuracy) ? { accuracy: p.accuracy } : {}) }))
    .sort((a: any, b: any) => a.timestamp - b.timestamp);
}

/** Polygon area (m²) via equirectangular projection + shoelace. */
function polygonAreaSqm(points: { latitude: number; longitude: number }[]): number {
  if (points.length < 3) return 0;
  const lat0 = (points.reduce((s, p) => s + p.latitude, 0) / points.length) * Math.PI / 180;
  const R = 6371000;
  const xy = points.map(p => [R * (p.longitude * Math.PI / 180) * Math.cos(lat0), R * (p.latitude * Math.PI / 180)]);
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Server-authoritative claim area: enclosed area, or a 2 m corridor along the route. */
function serverClaimArea(points: { latitude: number; longitude: number }[]): number {
  return Math.max(polygonAreaSqm(points), calculateDistance(points) * 2);
}

async function recordRun(payload: RunStopPayload): Promise<any> {
  // Never trust client-computed numbers: recompute from the GPS route.
  payload.routePoints = sanitizeRoute(payload.routePoints) as any;
  payload.distanceMeters = calculateDistance(payload.routePoints);
  payload.activityType = (ALLOWED_ACTIVITIES.has(String(payload.activityType)) ? payload.activityType : 'run') as any;
  console.log(`[Runs] Run recorded for user: ${payload.userId}, Distance: ${payload.distanceMeters.toFixed(0)}m`);

  // Persist run to DB and track the promise to avoid race conditions
  const promise = saveRun(payload.userId, payload.routePoints || [], payload.distanceMeters, payload.activityType);
  ongoingDbWrites.set(payload.userId, promise);
  let runId = null;
  try {
    runId = await promise;
  } finally {
    ongoingDbWrites.delete(payload.userId);
  }

  // Auto-create a feed post for this run
  if (runId && payload.distanceMeters > 0) {
    try {
      const km = (payload.distanceMeters / 1000).toFixed(2);
      const act = payload.activityType || 'run';
      await pool.query(
        `INSERT INTO posts (user_id, content, post_type, related_id)
         VALUES ($1, $2, $3, $4)`,
        [
          payload.userId,
          `Completed a new ${act} session covering ${km} km!`,
          'run',
          runId
        ]
      );
      // Award 50 Arena Coins
      await pool.query('UPDATE users SET coins = coins + 50 WHERE id = $1', [payload.userId]);
      io.emit('feed:updated');
    } catch (err: any) {
      console.error('[DB] Failed to auto-generate run feed post:', err.message);
    }
  }

  const player = livePlayers.get(payload.userId);
  if (player) {
    player.isRunning = false;
    player.currentSpeedKmh = 0;
    livePlayers.set(payload.userId, player);
    io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
  }
  return runId;
}

async function processTerritoryClaim(payload: ClaimPayload, reply: ClaimReply): Promise<'claimed' | 'rejected' | 'lost'> {
  payload.polygonCoordinates = sanitizeRoute(payload.polygonCoordinates);
  if (payload.polygonCoordinates.length < 3) {
    reply('claim:rejected', { reason: 'Not enough GPS points to form a territory.' });
    return 'rejected';
  }
  payload.areaSquareMeters = serverClaimArea(payload.polygonCoordinates);
  if (!(payload.areaSquareMeters > 0)) {
    reply('claim:rejected', { reason: 'Invalid territory shape.' });
    return 'rejected';
  }
  payload.activityType = ALLOWED_ACTIVITIES.has(String(payload.activityType)) ? payload.activityType : 'run';
  if (typeof payload.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(payload.color)) payload.color = '#00BFFF';
  payload.runSessionId = String(payload.runSessionId || `session_${Date.now()}`).slice(0, 64);
  console.log(`[Socket.io] Territory claimed by user: ${payload.userId}, Area: ${payload.areaSquareMeters} sqm`);

  // Wait for any ongoing run saves to complete to prevent distance race conditions
  const pendingSave = ongoingDbWrites.get(payload.userId);
  if (pendingSave) {
    console.log(`[Socket.io] Delaying claim verification: Waiting for user ${payload.userId} run to save...`);
    await pendingSave;
  }

  // 🏃 Cheating Prevention: Calculate average speed
  let avgSpeedKmh = 0;
  const coords = payload.polygonCoordinates || [];
  const activityType = payload.activityType || 'run';

  if (coords.length >= 2) {
    const distanceMeters = calculateDistance(coords);
    const firstPoint = coords[0];
    const lastPoint = coords[coords.length - 1];
    const timeDiffMs = lastPoint.timestamp - firstPoint.timestamp;

    if (timeDiffMs > 0) {
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
      avgSpeedKmh = (distanceMeters / 1000) / timeDiffHours;
    }
  }

  const SPEED_LIMITS: Record<string, number> = {
    run: 40,
    walk: 10,
    cycle: 70
  };
  const limit = SPEED_LIMITS[activityType] || 40;

  if (avgSpeedKmh > limit) {
    console.log(`[CLAIM REJECTED] Speed too high: ${avgSpeedKmh.toFixed(1)} km/h for activity type: ${activityType} (Limit: ${limit} km/h, User: ${payload.userId})`);
    reply('claim:rejected', {
      reason: `Your average speed (${avgSpeedKmh.toFixed(1)} km/h) exceeds the maximum allowed speed for ${activityType} (${limit} km/h).`
    });
    return 'rejected';
  }

  let ownerName = 'Runner';
  let ownerAvatar = '';
  try {
    const userRes = await pool.query('SELECT display_name, avatar_url FROM users WHERE id = $1', [payload.userId]);
    if (userRes.rows[0]) {
      ownerName = userRes.rows[0].display_name || 'Runner';
      ownerAvatar = userRes.rows[0].avatar_url || '';
    }
  } catch (err) {
    console.error('[DB] Failed to fetch owner info for territory:', err);
  }

  const newTerritory: Territory = {
    id: `terr_${Date.now()}_${payload.userId}`,
    userId: payload.userId,
    runSessionId: payload.runSessionId,
    polygonCoordinates: payload.polygonCoordinates,
    areaSquareMeters: payload.areaSquareMeters,
    claimedAt: new Date().toISOString(),
    color: payload.color,
    ownerName,
    ownerAvatar,
    avgSpeedKmh,
    activityType
  };

  // ⚔️ Territory Battle Engine — check for overlaps with other players' territories
  const newBBox = getBBox(newTerritory.polygonCoordinates);
  const attackerDistance = await getPlayerTotalDistance(payload.userId);

  for (const existing of Array.from(territoriesCache.values())) {
    // Skip own territories
    if (existing.userId === payload.userId) continue;

    const existingBBox = getBBox(existing.polygonCoordinates);
    if (!bboxOverlaps(newBBox, existingBBox)) continue;

    // ⚔️ Conflict detected!
    const defenderDistance = await getPlayerTotalDistance(existing.userId);
    const attackerWins = attackerDistance >= defenderDistance;

    const winner = attackerWins ? payload.userId : existing.userId;
    const loser  = attackerWins ? existing.userId : payload.userId;
    const stolenTerritoryId = attackerWins ? existing.id : newTerritory.id;

    console.log(`[Battle] ⚔️ Conflict! Attacker ${payload.userId} (${attackerDistance}m) vs Defender ${existing.userId} (${defenderDistance}m) → Winner: ${winner}`);

    if (attackerWins) {
      // Delete loser's territory
      await deleteTerritory(existing.id);
      territoriesCache.delete(existing.id);
    }

    // Broadcast conflict result to all clients
    const conflictPayload = {
      winnerId: winner,
      loserId: loser,
      stolenTerritoryId,
      winnerDistance: attackerWins ? attackerDistance : defenderDistance,
      loserDistance: attackerWins ? defenderDistance : attackerDistance,
    };
    io.emit('conflict:resolved', conflictPayload);

    // Send targeted 'territory:stolen' to loser's socket
    const loserSocketId = userToSocket.get(loser);
    if (loserSocketId) {
      const loserPlayer = livePlayers.get(winner);
      io.to(loserSocketId).emit('territory:stolen', {
        byPlayerName: loserPlayer?.displayName ?? 'Another runner',
        byPlayerColor: loserPlayer?.color ?? '#FF4D4D',
      });
    }

    // Send push notification to loser
    const loserTokenRes = await pool.query('SELECT expo_push_token FROM users WHERE id = $1', [loser]);
    const loserPushToken = loserTokenRes.rows[0]?.expo_push_token;
    const winnerPlayer = livePlayers.get(winner);
    if (loserPushToken) {
      await sendPushNotification(
        loserPushToken,
        '⚔️ Territory Captured!',
        `${winnerPlayer?.displayName ?? 'A runner'} just captured your territory! Strike back!`
      );
    }

    // If attacker loses, don't save the new territory
    if (!attackerWins) {
      io.emit('territoriesUpdate', Array.from(territoriesCache.values()));
      reply('claim:lost', { reason: 'A stronger runner already holds this ground.' });
      return 'lost';
    }
  }

  // Save to DB
  await saveTerritory(newTerritory);

  // Auto-create a feed post for this claim
  try {
    await pool.query(
      `INSERT INTO posts (user_id, content, post_type, related_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        payload.userId,
        `Claimed a new territory of ${payload.areaSquareMeters.toFixed(0)} sqm!`,
        'territory',
        newTerritory.id,
        newTerritory.claimedAt
      ]
    );
    // Award 10 Arena Coins
    await pool.query('UPDATE users SET coins = coins + 10 WHERE id = $1', [payload.userId]);
    io.emit('feed:updated');
  } catch (err: any) {
    console.error('[DB] Failed to auto-generate territory post:', err.message);
  }

  // Update in-memory cache
  territoriesCache.set(newTerritory.id, newTerritory);

  // Broadcast to all clients
  io.emit('territoryClaimed', newTerritory);
  io.emit('territoriesUpdate', Array.from(territoriesCache.values()));
  return 'claimed';
}

// --- Socket.io Events ---

io.on('connection', async (socket: Socket) => {
  // Identity comes ONLY from the verified handshake token. Unauthenticated
  // sockets may watch live state but cannot write anything.
  const authedUserId = socketUserId(socket.handshake.auth);
  console.log(`[Socket.io] Client connected: ${socket.id} (${authedUserId ? 'authenticated' : 'spectator'})`);

  const requireSocketUser = (event: string, payload: any): boolean => {
    if (!authedUserId) {
      socket.emit('auth:error', { event, error: 'Authentication required.', code: 'TOKEN_MISSING' });
      return false;
    }
    if (payload && typeof payload === 'object') payload.userId = authedUserId;
    return true;
  };

  // Send current live state to newly connected client
  socket.emit('livePlayersUpdate', Array.from(livePlayers.values()));
  socket.emit('territoriesUpdate', Array.from(territoriesCache.values()));

  socket.on('playerJoin', async (payload: PlayerJoinPayload) => {
    if (!requireSocketUser('playerJoin', payload)) return;
    console.log(`[Socket.io] Player joined: ${payload.displayName} (${payload.userId})`);

    // Persist user to DB
    await upsertUser(payload.userId, {
      display_name: payload.displayName,
      character_type: payload.characterType,
      color: payload.color,
    });

    const existing = livePlayers.get(payload.userId);
    const newState: LivePlayerState = {
      userId: payload.userId,
      displayName: payload.displayName,
      characterType: payload.characterType,
      color: payload.color,
      currentPosition: existing?.currentPosition ?? { latitude: 0, longitude: 0, timestamp: Date.now() },
      currentSpeedKmh: existing?.currentSpeedKmh ?? 0,
      isRunning: existing?.isRunning ?? false,
    };

    livePlayers.set(payload.userId, newState);
    socketToUser.set(socket.id, payload.userId);
    userToSocket.set(payload.userId, socket.id);

    socket.broadcast.emit('playerJoined', newState);
    io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
  });

  // Register push token
  socket.on('registerPushToken', (payload: { userId: string; token: string }) => {
    if (!requireSocketUser('registerPushToken', payload)) return;
    if (payload.userId && payload.token) {
      pushTokens.set(payload.userId, payload.token);
      console.log(`[Push] Token registered for user ${payload.userId}`);
    }
  });

  socket.on('locationUpdate', async (payload: LocationUpdatePayload) => {
    if (!requireSocketUser('locationUpdate', payload)) return;
    const player = livePlayers.get(payload.userId);
    if (player) {
      player.currentPosition = payload.point;
      player.currentSpeedKmh = payload.speedKmh;
      livePlayers.set(payload.userId, player);
      socket.broadcast.emit('locationUpdated', payload);
      io.emit('livePlayersUpdate', Array.from(livePlayers.values()));

      // Real-time boundary invasion checks
      for (const t of Array.from(territoriesCache.values())) {
        if (t.userId !== payload.userId) {
          const inTerritory = isPointInPolygon(payload.point, t.polygonCoordinates);
          if (inTerritory) {
            const spamKey = `${t.id}_${payload.userId}`;
            const lastAlert = lastAlerts.get(spamKey);
            const now = Date.now();

            if (!lastAlert || (now - lastAlert > 300000)) { // 5-minute cooldown
              lastAlerts.set(spamKey, now);

              // Get push token: prefer in-memory (online user), fall back to DB (offline user)
              let ownerPushToken = pushTokens.get(t.userId);
              if (!ownerPushToken) {
                try {
                  const tokenRes = await pool.query(
                    'SELECT expo_push_token FROM users WHERE id = $1',
                    [t.userId]
                  );
                  ownerPushToken = tokenRes.rows[0]?.expo_push_token;
                  if (ownerPushToken) {
                    // Cache it for future lookups
                    pushTokens.set(t.userId, ownerPushToken);
                  }
                } catch (dbErr: any) {
                  console.error('[Push] Failed to fetch owner push token from DB:', dbErr.message);
                }
              }

              if (ownerPushToken) {
                sendPushNotification(
                  ownerPushToken,
                  '⚠️ Territory Alert!',
                  `${player.displayName || 'A runner'} has entered your zone! Get back out there!`
                ).catch(console.error);
              }

              // Also send in-app PvP warning alert to the invader (only if they're online)
              socket.emit('pvp:warning', {
                message: `⚠️ Warning: You have entered a zone owned by ${t.ownerName || 'another runner'}! Outrun them to capture it!`
              });
            }
          }
        }
      }
    }
  });

  socket.on('runStart', (payload: RunStartPayload) => {
    if (!requireSocketUser('runStart', payload)) return;
    console.log(`[Socket.io] Run started by user: ${payload.userId}`);
    const player = livePlayers.get(payload.userId);
    if (player) {
      player.isRunning = true;
      livePlayers.set(payload.userId, player);
      io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
    }
  });

  socket.on('runStop', async (payload: RunStopPayload) => {
    if (!requireSocketUser('runStop', payload)) return;
    await recordRun(payload);
  });

  socket.on('territoryClaim', async (payload: ClaimPayload) => {
    if (!requireSocketUser('territoryClaim', payload)) return;
    await processTerritoryClaim(payload, (event, data) => socket.emit(event, data));
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    const userId = socketToUser.get(socket.id);
    if (userId) {
      livePlayers.delete(userId);
      socketToUser.delete(socket.id);
      userToSocket.delete(userId);
      socket.broadcast.emit('playerLeft', { userId });
      io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
    }
  });
});

// Health check — reports the actual DB state, never claims cloud persistence
// when the authoritative Postgres is unreachable.
app.get('/health', async (req, res) => {
  // Lightweight re-check if stale (avoid probing on every health call).
  if (Date.now() - dbLastCheckedAt > 15000) {
    await probeDb(3000).catch(() => {});
  }
  const healthy = isDbConnected;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    playersCount: livePlayers.size,
    territoriesCount: territoriesCache.size,
    db: healthy ? 'connected' : 'disconnected',
    persistence: healthy ? 'authoritative_postgres' : 'local_json_fallback',
    dbError: healthy ? null : dbLastError,
    checkedAt: new Date(dbLastCheckedAt).toISOString(),
  });
});

// --- Admin Monitoring Middleware ---
// Refuses the public default key from source control (see auth.ts).
const adminAuthMiddleware = requireAdmin;

// --- Phase 2: Social REST Routes ---

// Get merged, paginated social feed
app.get('/api/feed', optionalAuth, async (req, res) => {
  try {
    const userId = req.userId || '';
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const queryText = `
      SELECT * FROM (
        (
          SELECT
            p.id::text AS id,
            p.user_id AS user_id,
            u.display_name AS display_name,
            u.character_type AS character_type,
            u.color AS color,
            NULL AS title,
            p.content AS content,
            p.image_url AS image_url,
            p.post_type AS post_type,
            p.related_id AS related_id,
            p.created_at AS created_at,
            COALESCE(likes_calc.count, 0)::int AS likes_count,
            COALESCE(comments_calc.count, 0)::int AS comments_count,
            EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) AS is_liked,
            t.area_square_meters::float AS territory_area,
            t.polygon_coordinates AS territory_coordinates
          FROM posts p
          LEFT JOIN users u ON u.id = p.user_id
          LEFT JOIN territories t ON t.id = p.related_id AND p.post_type = 'territory'
          LEFT JOIN (
            SELECT post_id, COUNT(*) AS count FROM likes GROUP BY post_id
          ) likes_calc ON likes_calc.post_id = p.id
          LEFT JOIN (
            SELECT post_id, COUNT(*) AS count FROM comments GROUP BY post_id
          ) comments_calc ON comments_calc.post_id = p.id
        )
        UNION ALL
        (
          SELECT
            'ann_' || a.id AS id,
            'admin' AS user_id,
            'Admin' AS display_name,
            'warrior' AS character_type,
            '#FFD700' AS color,
            a.title AS title,
            a.body AS content,
            NULL AS image_url,
            'announcement' AS post_type,
            NULL AS related_id,
            a.created_at AS created_at,
            0 AS likes_count,
            0 AS comments_count,
            FALSE AS is_liked,
            NULL AS territory_area,
            NULL AS territory_coordinates
          FROM announcements a
        )
      ) combined
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(queryText, [userId, limit, offset]);
    if (result.rows && result.rows.length > 0) return res.json(result.rows);
    return res.json(localStore.getFeed(userId));
  } catch (err: any) {
    console.warn('[Feed] DB warning, returning local feed:', err.message);
    return res.json(localStore.getFeed((req.query.userId as string) || ''));
  }
});

// Create user post
app.post('/api/posts', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const imageUrl = req.body.imageUrl;
  if (!content && !imageUrl) {
    return res.status(400).json({ error: 'Write something or attach a photo.' });
  }
  if (content.length > 2000) {
    return res.status(400).json({ error: 'Post is too long (max 2000 characters).' });
  }
  if (imageUrl && !isOwnStorageImageUrl(imageUrl, userId)) {
    return res.status(400).json({ error: 'Invalid image URL.' });
  }
  try {
    // Users may only create plain posts; run/territory posts are server-generated.
    const result = await pool.query(
      `INSERT INTO posts (user_id, content, image_url, post_type, related_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, content, image_url, post_type, related_id, created_at`,
      [userId, content, imageUrl || null, 'user', null]
    );
    io.emit('feed:updated');
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete own post
app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId!;
  if (!/^\d+$/.test(postId)) return res.status(404).json({ error: 'Post not found' });
  try {
    const owner = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Post not found' });
    if (owner.rows[0].user_id !== userId) return res.status(403).json({ error: 'You can only delete your own posts.' });
    // Remove dependent rows first so the delete succeeds without FK cascades.
    await pool.query('DELETE FROM likes WHERE post_id = $1', [postId]);
    await pool.query('DELETE FROM comments WHERE post_id = $1', [postId]);
    const result = await pool.query(
      'DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING id',
      [postId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    io.emit('feed:updated');
    res.json({ message: 'Post deleted successfully', id: postId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle post like
app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId!;
  if (!/^\d+$/.test(postId)) return res.status(404).json({ error: 'Post not found' });
  try {
    const exists = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Post not found' });
    const checkLike = await pool.query(
      'SELECT id FROM likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    let liked = false;
    if (checkLike.rowCount && checkLike.rowCount > 0) {
      await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    } else {
      await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
      liked = true;

      // Send push notification to post owner
      try {
        const postRes = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
        if (postRes.rows[0] && postRes.rows[0].user_id !== userId) {
          const ownerId = postRes.rows[0].user_id;
          const ownerToken = pushTokens.get(ownerId);
          if (ownerToken) {
            const userRes = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
            const likerName = userRes.rows[0]?.display_name || 'A runner';
            await sendPushNotification(ownerToken, '❤️ Post Liked', `${likerName} liked your post!`);
          }
        }
      } catch (err) {
        console.error('[Push] Like notification failed:', err);
      }
    }

    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM likes WHERE post_id = $1', [postId]);
    res.json({ liked, likesCount: countRes.rows[0].count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch comments for a post
app.get('/api/posts/:id/comments', async (req, res) => {
  const postId = req.params.id;
  try {
    const result = await pool.query(
      `SELECT c.id, c.user_id, u.display_name AS user_name, u.avatar_url AS user_avatar, c.content, c.created_at
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add comment to a post
app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
  const postId = req.params.id;
  const userId = req.userId!;
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty.' });
  if (content.length > 1000) return res.status(400).json({ error: 'Comment is too long (max 1000 characters).' });
  if (!/^\d+$/.test(postId)) return res.status(404).json({ error: 'Post not found' });
  try {
    const exists = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    if (!exists.rowCount) return res.status(404).json({ error: 'Post not found' });
    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, post_id, user_id, content, created_at`,
      [postId, userId, content]
    );
    
    const userRes = await pool.query('SELECT display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const comment = {
      ...result.rows[0],
      user_name: userRes.rows[0]?.display_name || 'Runner',
      user_avatar: userRes.rows[0]?.avatar_url || ''
    };

    // Send push notification to post owner
    try {
      const postRes = await pool.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
      if (postRes.rows[0] && postRes.rows[0].user_id !== userId) {
        const ownerId = postRes.rows[0].user_id;
        const ownerToken = pushTokens.get(ownerId);
        if (ownerToken) {
          const commenterName = userRes.rows[0]?.display_name || 'A runner';
          await sendPushNotification(
            ownerToken,
            '💬 New Comment',
            `${commenterName} commented on your post: "${content.substring(0, 40)}${content.length > 40 ? '...' : ''}"`
          );
        }
      }
    } catch (err) {
      console.error('[Push] Comment notification failed:', err);
    }

    res.status(201).json(comment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete own comment
app.delete('/api/comments/:id', requireAuth, async (req, res) => {
  const commentId = req.params.id;
  const userId = req.userId!;
  if (!/^\d+$/.test(commentId)) return res.status(404).json({ error: 'Comment not found' });
  try {
    // Comment author OR the owner of the post may delete a comment.
    const found = await pool.query(
      'SELECT c.user_id AS author, p.user_id AS post_owner FROM comments c LEFT JOIN posts p ON p.id = c.post_id WHERE c.id = $1',
      [commentId]
    );
    if (!found.rowCount) return res.status(404).json({ error: 'Comment not found' });
    const { author, post_owner } = found.rows[0];
    if (author !== userId && post_owner !== userId) {
      return res.status(403).json({ error: 'You can only delete your own comments.' });
    }
    const result = await pool.query('DELETE FROM comments WHERE id = $1 RETURNING id', [commentId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    res.json({ message: 'Comment deleted successfully', id: commentId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch user profile stats + user posts gallery
app.get('/api/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const userRes = await pool.query(
      `SELECT id, display_name, avatar_url, character_type, color, bio, cover_image_url, coins, unlocked_colors, selected_avatar, unlocked_avatars FROM users WHERE id = $1`,
      [userId]
    );
    if (!userRes.rowCount || userRes.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const statsRes = await pool.query(
      `SELECT 
         COALESCE(SUM(distance_meters), 0)::float AS total_distance,
         COUNT(DISTINCT id)::int AS total_runs
       FROM runs WHERE user_id = $1`,
      [userId]
    );

    const zonesRes = await pool.query(
      `SELECT COUNT(*)::int AS total_zones, COALESCE(SUM(area_square_meters),0)::float AS total_territory FROM territories WHERE owner_id = $1`,
      [userId]
    );

    const postsRes = await pool.query(
      `SELECT p.id, p.content, p.image_url, p.post_type, p.related_id, p.created_at,
              COALESCE(likes_calc.count, 0)::int AS likes_count,
              COALESCE(comments_calc.count, 0)::int AS comments_count
       FROM posts p
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS count FROM likes GROUP BY post_id
       ) likes_calc ON likes_calc.post_id = p.id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS count FROM comments GROUP BY post_id
       ) comments_calc ON comments_calc.post_id = p.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [userId]
    );

    const followersRes = await pool.query(
      `SELECT u.id, u.display_name, u.avatar_url, u.character_type, u.color, u.bio
       FROM followers f JOIN users u ON u.id = f.follower_id WHERE f.following_id = $1`, [userId]
    );

    const followingRes = await pool.query(
      `SELECT u.id, u.display_name, u.avatar_url, u.character_type, u.color, u.bio
       FROM followers f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $1`, [userId]
    );

    res.json({
      user: {
        id: userRes.rows[0].id,
        display_name: userRes.rows[0].display_name || 'Runner',
        character_type: userRes.rows[0].character_type || 'scout',
        color: userRes.rows[0].color || '#00BFFF',
        bio: userRes.rows[0].bio || '',
        avatar_url: userRes.rows[0].avatar_url || '',
        cover_image_url: userRes.rows[0].cover_image_url || '',
        coins: userRes.rows[0].coins || 0,
        unlocked_colors: userRes.rows[0].unlocked_colors || [],
        selected_avatar: userRes.rows[0].selected_avatar || null,
        unlocked_avatars: userRes.rows[0].unlocked_avatars || []
      },
      stats: {
        total_distance: statsRes.rows[0]?.total_distance || 0,
        total_runs: statsRes.rows[0]?.total_runs || 0,
        total_zones: zonesRes.rows[0]?.total_zones || 0,
        total_territory: zonesRes.rows[0]?.total_territory || 0
      },
      posts: postsRes.rows,
      followers: followersRes.rows,
      following: followingRes.rows
    });
  } catch (err: any) {
    console.warn('[Profile] DB query warning, falling back to local store:', err.message);
    const u = localStore.getUserById(userId) || localStore.upsertUser(userId, { display_name: 'Runner', character_type: 'scout', color: '#00BFFF' });
    const userZones = Array.from(territoriesCache.values()).filter(t => t.userId === userId).length;
    const stats = localStore.getUserStats(userId, userZones);
    res.json({
      user: {
        id: u.id,
        display_name: u.display_name || 'Runner',
        character_type: u.character_type || 'scout',
        color: u.color || '#00BFFF',
        bio: u.bio || '',
        avatar_url: u.avatar_url || '',
        cover_image_url: u.cover_image_url || '',
        coins: u.coins || 100,
        unlocked_colors: u.unlocked_colors || [],
        selected_avatar: u.selected_avatar || 'scout',
        unlocked_avatars: u.unlocked_avatars || ['scout']
      },
      stats,
      posts: localStore.getUserPosts(userId),
      followers: localStore.getFollowers(userId),
      following: localStore.getFollowing(userId)
    });
  }
});

// Followers API: Follow User
app.post('/api/followers/follow', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const followingId = typeof req.body.followingId === 'string' ? req.body.followingId : '';
  if (!followingId) return res.status(400).json({ error: 'Missing followingId' });
  if (userId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });

  try {
    const target = await pool.query('SELECT 1 FROM users WHERE id = $1', [followingId]);
    if (!target.rowCount) return res.status(404).json({ error: 'User not found' });
    await pool.query(
      `INSERT INTO followers (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, followingId]
    );

    try {
      const userRes = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
      const targetTokenRes = await pool.query('SELECT expo_push_token FROM users WHERE id = $1', [followingId]);
      
      const pushToken = targetTokenRes.rows[0]?.expo_push_token;
      if (pushToken && Expo.isExpoPushToken(pushToken)) {
        const adderName = userRes.rows[0]?.display_name || 'A runner';
        await expo.sendPushNotificationsAsync([{
          to: pushToken,
          sound: 'default',
          title: '🤝 New Follower!',
          body: `${adderName} started following you!`,
        }]);
      }
    } catch (pushErr) {
      console.error('[Push] Follow notification failed:', pushErr);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Followers API: Unfollow User
app.post('/api/followers/unfollow', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const followingId = typeof req.body.followingId === 'string' ? req.body.followingId : '';
  if (!followingId) return res.status(400).json({ error: 'Missing followingId' });
  try {
    await pool.query(`DELETE FROM followers WHERE follower_id = $1 AND following_id = $2`, [userId, followingId]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Followers API: Get Followers & Following
app.get('/api/followers/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const followersRes = await pool.query(
      `SELECT u.id, u.display_name, u.avatar_url, u.character_type, u.color, u.bio
       FROM followers f JOIN users u ON u.id = f.follower_id WHERE f.following_id = $1`, [userId]
    );
    const followingRes = await pool.query(
      `SELECT u.id, u.display_name, u.avatar_url, u.character_type, u.color, u.bio
       FROM followers f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $1`, [userId]
    );
    res.json({ followers: followersRes.rows, following: followingRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Shop API: Unlock custom zone colors
app.post('/api/shop/unlock-color', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const { color } = req.body;
  if (!color || typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return res.status(400).json({ error: 'Missing userId or color' });
  }
  try {
    const userRes = await pool.query('SELECT coins, unlocked_colors FROM users WHERE id = $1', [userId]);
    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { coins, unlocked_colors } = userRes.rows[0];
    const cost = 200;
    if ((coins || 0) < cost) {
      return res.status(400).json({ error: 'Insufficient Arena Coins' });
    }
    const currentColors = unlocked_colors || [];
    if (currentColors.includes(color)) {
      return res.status(400).json({ error: 'Color already unlocked' });
    }
    const newColors = [...currentColors, color];
    await pool.query(
      'UPDATE users SET coins = coins - $1, unlocked_colors = $2 WHERE id = $3',
      [cost, newColors, userId]
    );
    res.json({ success: true, coins: coins - cost, unlockedColors: newColors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Avatar Shop API ──────────────────────────────────────────────────────────

// Define milestone avatars (unlocked by running distance)
const MILESTONE_AVATARS: { avatar: string; name: string; requiredKm: number }[] = [
  { avatar: '🦊', name: 'Swift Fox',    requiredKm: 5   },
  { avatar: '🐺', name: 'Lone Wolf',    requiredKm: 10  },
  { avatar: '🦁', name: 'Lion King',    requiredKm: 25  },
  { avatar: '🦅', name: 'Soaring Eagle',requiredKm: 50  },
  { avatar: '🐉', name: 'Dragon',       requiredKm: 100 },
];

// Define premium avatars (unlocked by coins)
const PREMIUM_AVATARS: { avatar: string; name: string; cost: number }[] = [
  { avatar: '🤖', name: 'Cyborg',    cost: 150 },
  { avatar: '🦄', name: 'Unicorn',   cost: 150 },
  { avatar: '👾', name: 'Ghost',     cost: 150 },
  { avatar: '⚡', name: 'Lightning', cost: 150 },
  { avatar: '🌟', name: 'Star',      cost: 150 },
];

// Check and grant milestone avatars automatically
app.post('/api/shop/check-milestones', requireAuth, async (req, res) => {
  const userId = req.userId!;
  try {
    const userRes = await pool.query(
      'SELECT unlocked_avatars FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rowCount) return res.status(404).json({ error: 'User not found' });

    const statsRes = await pool.query(
      'SELECT COALESCE(SUM(distance_meters), 0)::float AS total_distance FROM runs WHERE user_id = $1',
      [userId]
    );
    const totalKm = (statsRes.rows[0]?.total_distance || 0) / 1000;
    const currentUnlocked: string[] = userRes.rows[0]?.unlocked_avatars || [];
    const newlyUnlocked: string[] = [];

    for (const milestone of MILESTONE_AVATARS) {
      if (totalKm >= milestone.requiredKm && !currentUnlocked.includes(milestone.avatar)) {
        currentUnlocked.push(milestone.avatar);
        newlyUnlocked.push(milestone.avatar);
      }
    }

    if (newlyUnlocked.length > 0) {
      await pool.query(
        'UPDATE users SET unlocked_avatars = $1 WHERE id = $2',
        [currentUnlocked, userId]
      );
    }

    res.json({ newlyUnlocked, unlockedAvatars: currentUnlocked, totalKm });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Unlock a premium avatar with coins
app.post('/api/shop/unlock-avatar', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'Missing avatar' });

  const premiumAvatar = PREMIUM_AVATARS.find(a => a.avatar === avatar);
  if (!premiumAvatar) return res.status(400).json({ error: 'Invalid premium avatar' });

  try {
    const userRes = await pool.query(
      'SELECT coins, unlocked_avatars FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rowCount) return res.status(404).json({ error: 'User not found' });

    const { coins, unlocked_avatars } = userRes.rows[0];
    const currentUnlocked: string[] = unlocked_avatars || [];

    if (currentUnlocked.includes(avatar)) {
      return res.status(400).json({ error: 'Avatar already unlocked' });
    }
    if ((coins || 0) < premiumAvatar.cost) {
      return res.status(400).json({ error: `Insufficient Arena Coins. Need ${premiumAvatar.cost} coins.` });
    }

    const newUnlocked = [...currentUnlocked, avatar];
    await pool.query(
      'UPDATE users SET coins = coins - $1, unlocked_avatars = $2 WHERE id = $3',
      [premiumAvatar.cost, newUnlocked, userId]
    );
    res.json({ success: true, avatar, remainingCoins: (coins || 0) - premiumAvatar.cost, unlockedAvatars: newUnlocked });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Set the user's active/selected avatar
app.post('/api/shop/set-avatar', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'Missing avatar' });

  try {
    const userRes = await pool.query(
      'SELECT unlocked_avatars FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rowCount) return res.status(404).json({ error: 'User not found' });

    const currentUnlocked: string[] = userRes.rows[0]?.unlocked_avatars || [];
    if (!currentUnlocked.includes(avatar)) {
      return res.status(403).json({ error: 'Avatar not unlocked yet' });
    }

    await pool.query('UPDATE users SET selected_avatar = $1 WHERE id = $2', [avatar, userId]);
    res.json({ success: true, selectedAvatar: avatar });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all avatar definitions (milestone + premium) for the shop
app.get('/api/shop/avatars', (req, res) => {
  res.json({
    milestones: MILESTONE_AVATARS,
    premium: PREMIUM_AVATARS,
  });
});

// Fetch nearby runners recommendation
app.get('/api/community/nearby', async (req, res) => {

  const { userId, lat, lng } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId query parameter' });
  }

  try {
    const activeRunners = Array.from(livePlayers.values());
    
    // Helper function to calculate Haversine distance in km
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // radius of Earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    let recommended = [];
    const clientLat = parseFloat(lat as string);
    const clientLng = parseFloat(lng as string);

    if (!isNaN(clientLat) && !isNaN(clientLng)) {
      recommended = activeRunners
        .filter(p => p.userId !== userId && p.currentPosition)
        .map(p => {
          const dist = getDistance(
            clientLat,
            clientLng,
            p.currentPosition!.latitude,
            p.currentPosition!.longitude
          );
          return { ...p, distanceKm: parseFloat(dist.toFixed(2)) };
        })
        .filter(p => p.distanceKm <= 50.0)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    if (recommended.length === 0) {
      const topRunners = await pool.query(
        `SELECT id AS "userId", display_name AS "displayName", avatar_url AS "avatarUrl", character_type AS "characterType", color, bio
         FROM users
         WHERE id != $1
         LIMIT 5`,
        [userId]
      );
      recommended = topRunners.rows.map(row => ({
        ...row,
        avatarUrl: row.avatarUrl || '',
        characterType: row.characterType || 'scout',
        color: row.color || '#00BFFF',
        distanceKm: null
      }));
    }

    res.json(recommended);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch announcements list
app.get('/api/announcements', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create announcement (admin only)
app.post('/api/admin/announcements', adminAuthMiddleware, async (req, res) => {
  const { title, body, createdBy } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'Missing title or body' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO announcements (title, body, created_by) VALUES ($1, $2, $3) RETURNING *',
      [title, body, createdBy || 'admin']
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// REST: Get all territories
app.get('/territories', async (req, res) => {
  const territories = await loadAllTerritories();
  res.json(territories);
});

// REST: Get global leaderboard ranked by selected activity type and metric
app.get('/leaderboard', optionalAuth, async (req, res) => {
  const friendsOnly = req.query.scope === 'friends';
  if (friendsOnly && !req.userId) return res.status(401).json({ error: 'Log in to see your friends leaderboard.', code: 'TOKEN_MISSING' });
  try {
    if (isDbConnected) {
      const allowedActivities = ['all', 'run', 'walk', 'cycle'];
      const allowedMetrics = ['distance', 'territory', 'zones'];

      const activity = allowedActivities.includes(req.query.activity as string)
        ? (req.query.activity as string)
        : 'all';
      const metric = allowedMetrics.includes(req.query.metric as string)
        ? (req.query.metric as string)
        : 'territory';

      const territoryFilter = activity !== 'all' ? `AND activity_type = '${activity}'` : '';
      const runFilter = activity !== 'all' ? `AND activity_type = '${activity}'` : '';

      let orderByColumn = 'total_territory';
      if (metric === 'distance') orderByColumn = 'total_distance';
      else if (metric === 'zones') orderByColumn = 'total_zones';

      const queryText = `
        SELECT
          u.id,
          u.display_name,
          u.character_type,
          u.color,
          COALESCE(t_calc.total_territory, 0)::float AS total_territory,
          COALESCE(t_calc.total_zones, 0)::int AS total_zones,
          COALESCE(r_calc.total_runs, 0)::int AS total_runs,
          COALESCE(r_calc.total_distance, 0)::float AS total_distance
        FROM users u
        LEFT JOIN (
          SELECT
            owner_id AS user_id,
            SUM(area_square_meters) AS total_territory,
            COUNT(*) AS total_zones
          FROM territories
          WHERE 1=1 ${territoryFilter}
          GROUP BY owner_id
        ) t_calc ON t_calc.user_id = u.id
        LEFT JOIN (
          SELECT
            user_id,
            COUNT(*) AS total_runs,
            SUM(distance_meters) AS total_distance
          FROM runs
          WHERE 1=1 ${runFilter}
          GROUP BY user_id
        ) r_calc ON r_calc.user_id = u.id
        ${friendsOnly ? 'WHERE u.id = $1 OR u.id IN (SELECT following_id FROM followers WHERE follower_id = $1)' : ''}
        ORDER BY ${orderByColumn} DESC
        LIMIT ${friendsOnly ? 100 : 20}
      `;

      const result = await pool.query(queryText, friendsOnly ? [req.userId] : []);
      if (friendsOnly) return res.json(result.rows);
      if (result.rows && result.rows.length > 0) {
        return res.json(result.rows);
      }
    }
  } catch (err: any) {
    console.warn('[Leaderboard] DB query warning:', err.message);
  }

  // Resilient fallback to localStore + territoriesCache
  const users = localStore.getAllUsers();
  const territories = Array.from(territoriesCache.values());
  const rows = users.map(u => {
    const userTerritories = territories.filter(t => t.userId === u.id);
    const stats = localStore.getUserStats(u.id, userTerritories.length);
    const totalArea = userTerritories.reduce((sum, t) => sum + (t.areaSquareMeters || 0), 0);
    return {
      id: u.id,
      display_name: u.display_name || 'Runner',
      character_type: u.character_type || 'scout',
      color: u.color || '#00BFFF',
      total_territory: totalArea,
      total_zones: userTerritories.length,
      total_runs: stats.total_runs,
      total_distance: stats.total_distance
    };
  });

  const metric = (req.query.metric as string) || 'territory';
  rows.sort((a, b) => {
    if (metric === 'distance') return b.total_distance - a.total_distance;
    if (metric === 'zones') return b.total_zones - a.total_zones;
    return b.total_territory - a.total_territory;
  });

  res.json(rows.slice(0, 20));
});

// REST: Get a single player profile stats
app.get('/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    if (isDbConnected) {
      const result = await pool.query(`
        SELECT
          u.id,
          u.display_name,
          u.character_type,
          u.color,
          u.bio,
          u.avatar_url,
          COALESCE(SUM(t.area_square_meters), 0)::float AS total_territory,
          COUNT(DISTINCT r.id)::int AS total_runs,
          COALESCE(SUM(r.distance_meters), 0)::float AS total_distance
        FROM users u
        LEFT JOIN territories t ON t.owner_id = u.id
        LEFT JOIN runs r ON r.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id
      `, [userId]);
      if (result.rows.length > 0) {
        return res.json(result.rows[0]);
      }
    }
  } catch (err: any) {
    console.warn('[API] /profile error, using local store:', err.message);
  }

  const u = localStore.getUserById(userId) || localStore.upsertUser(userId, { display_name: 'Runner' });
  const userZones = Array.from(territoriesCache.values()).filter(t => t.userId === userId);
  const totalTerritory = userZones.reduce((sum, t) => sum + (t.areaSquareMeters || 0), 0);
  const stats = localStore.getUserStats(userId, userZones.length);

  res.json({
    id: u.id,
    display_name: u.display_name || 'Runner',
    character_type: u.character_type || 'scout',
    color: u.color || '#00BFFF',
    bio: u.bio || '',
    avatar_url: u.avatar_url || '',
    total_territory: totalTerritory,
    total_runs: stats.total_runs,
    total_distance: stats.total_distance
  });
});

// REST: Update user profile (supports both /profile/update and /api/profile/update)
app.post(['/profile/update', '/api/profile/update'], requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const { characterType, color } = req.body;
    let { displayName, bio, avatarUrl, coverImageUrl } = req.body;
    if (displayName !== undefined) {
      displayName = String(displayName).trim();
      if (displayName.length < 2 || displayName.length > 40) return res.status(400).json({ error: 'Display name must be 2–40 characters.' });
    }
    if (bio !== undefined) {
      bio = String(bio).trim();
      if (bio.length > 160) return res.status(400).json({ error: 'Bio must be 160 characters or fewer.' });
    }
    if (color !== undefined && !/^#[0-9a-fA-F]{3,8}$/.test(String(color))) return res.status(400).json({ error: 'Invalid color.' });
    if (characterType !== undefined && !/^[a-z_]{2,20}$/i.test(String(characterType))) return res.status(400).json({ error: 'Invalid class.' });
    // Image fields: '' clears, otherwise must be the caller's own Storage object.
    for (const [key, val] of [['avatarUrl', avatarUrl], ['coverImageUrl', coverImageUrl]] as const) {
      if (val !== undefined && val !== '' && !isOwnStorageImageUrl(val, userId)) {
        return res.status(400).json({ error: `Invalid ${key}.` });
      }
    }
    const clearAvatar = avatarUrl === '';
    const clearCover = coverImageUrl === '';
    if (clearAvatar || clearCover) {
      if (isDbConnected) {
        await pool.query(
          `UPDATE users SET avatar_url = CASE WHEN $2 THEN NULL ELSE avatar_url END,
                            cover_image_url = CASE WHEN $3 THEN NULL ELSE cover_image_url END WHERE id = $1`,
          [userId, clearAvatar, clearCover]
        );
      }
      localStore.upsertUser(userId, { ...(clearAvatar ? { avatar_url: '' } : {}), ...(clearCover ? { cover_image_url: '' } : {}) });
      if (clearAvatar) avatarUrl = undefined;
      if (clearCover) coverImageUrl = undefined;
    }
    localStore.upsertUser(userId, {
      display_name: displayName,
      character_type: characterType,
      color,
      bio,
      avatar_url: avatarUrl,
      cover_image_url: coverImageUrl
    });
    if (isDbConnected) {
      try {
        await pool.query(
          `INSERT INTO users (id, display_name, character_type, color, bio, avatar_url, cover_image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             display_name = COALESCE(EXCLUDED.display_name, users.display_name),
             character_type = COALESCE(EXCLUDED.character_type, users.character_type),
             color = COALESCE(EXCLUDED.color, users.color),
             bio = COALESCE(EXCLUDED.bio, users.bio),
             avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
             cover_image_url = COALESCE(EXCLUDED.cover_image_url, users.cover_image_url)`,
          [userId, displayName || null, characterType || null, color || null, bio || null, avatarUrl || null, coverImageUrl || null]
        );
      } catch (dbErr: any) {
        console.warn('[Profile] DB update warning:', dbErr.message);
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[API] /profile/update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─── Runs ─────────────────────────────────────────────────────────────────────

function summarizeRoute(points: any[]): { durationSeconds: number; startedAt: number | null } {
  if (!Array.isArray(points) || points.length < 2) return { durationSeconds: 0, startedAt: null };
  const ts = points.map((p: any) => Number(p?.timestamp)).filter(Number.isFinite);
  if (ts.length < 2) return { durationSeconds: 0, startedAt: null };
  return { durationSeconds: Math.max(0, Math.round((Math.max(...ts) - Math.min(...ts)) / 1000)), startedAt: Math.min(...ts) };
}

function runSummaryRow(row: any) {
  const { durationSeconds } = summarizeRoute(row.route_points || []);
  const km = (row.distance_meters || 0) / 1000;
  return {
    id: row.id,
    distance_meters: row.distance_meters || 0,
    activity_type: row.activity_type || 'run',
    created_at: row.created_at,
    duration_seconds: durationSeconds,
    pace_seconds_per_km: km > 0.01 && durationSeconds > 0 ? Math.round(durationSeconds / km) : null,
    avg_speed_kmh: durationSeconds > 0 ? +(km / (durationSeconds / 3600)).toFixed(1) : null,
  };
}

// Submit a finished run (+ optional territory claim). Idempotent: retrying the
// same run (same first GPS timestamp + point count) returns the original result.
const recentRunKeys = new Map<string, { runId: any; claim: string | null; at: number }>();
app.post('/api/runs', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const route = sanitizeRoute(req.body?.routePoints);
  if (route.length < 2) return res.status(400).json({ error: 'A run needs at least 2 GPS points.' });
  const activityType = ALLOWED_ACTIVITIES.has(String(req.body?.activityType)) ? req.body.activityType : 'run';
  const key = `${userId}:${route[0].timestamp}:${route.length}`;

  const cached = recentRunKeys.get(key);
  if (cached) return res.json({ runId: cached.runId, claim: cached.claim, duplicate: true });

  try {
    if (isDbConnected) {
      // Durable de-duplication across restarts (no schema change needed).
      const dup = await pool.query(
        `SELECT id FROM runs WHERE user_id = $1 AND (route_points->0->>'timestamp')::bigint = $2
           AND jsonb_array_length(route_points) = $3 LIMIT 1`,
        [userId, route[0].timestamp, route.length]
      );
      if (dup.rowCount) {
        recentRunKeys.set(key, { runId: dup.rows[0].id, claim: null, at: Date.now() });
        return res.json({ runId: dup.rows[0].id, claim: null, duplicate: true });
      }
    }

    const runId = await recordRun({ userId, routePoints: route as any, distanceMeters: 0, activityType });
    let claim: string | null = null;
    let claimReason: string | null = null;
    let claimArea = 0;
    if (req.body?.claim && route.length >= 3) {
      const claimPayload: any = {
          userId,
          runSessionId: String(req.body.claim.runSessionId || `session_${route[0].timestamp}`),
          polygonCoordinates: route,
          areaSquareMeters: 0,
          color: req.body.claim.color,
          activityType,
        };
      claim = await processTerritoryClaim(
        claimPayload,
        (event, data) => {
          if (event === 'claim:rejected' || event === 'claim:lost') claimReason = data?.reason || null;
          const sid = userToSocket.get(userId);
          if (sid) io.to(sid).emit(event, data);
        }
      );
      if (claim === 'claimed') claimArea = Math.round(claimPayload.areaSquareMeters || 0);
    }
    recentRunKeys.set(key, { runId, claim, at: Date.now() });
    if (recentRunKeys.size > 5000) {
      for (const [k, v] of recentRunKeys) if (Date.now() - v.at > 24 * 3600 * 1000) recentRunKeys.delete(k);
    }
    const distanceMeters = calculateDistance(route);
    res.status(201).json({ runId, claim, claimReason, claimArea, distanceMeters, ...summarizeRoute(route) });
  } catch (err: any) {
    console.error('[Runs] submit error:', err.message);
    res.status(500).json({ error: 'Could not save the run. It will be retried.' });
  }
});

// REST: Get run history for a player (summaries only — no GPS routes)
app.get('/runs/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    if (isDbConnected) {
      const result = await pool.query(`
        SELECT id, distance_meters, activity_type, created_at, route_points
        FROM runs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `, [userId]);
      return res.json(result.rows.map(runSummaryRow));
    }
  } catch (err: any) {
    console.warn('[Runs] DB query warning:', err.message);
  }
  const localRuns = localStore.getUserRuns(userId);
  res.json(localRuns.slice(0, 50).map(runSummaryRow));
});

// REST: Get a single run's details. The GPS route is private to its owner
// (it can reveal home/work locations); others get the summary only.
app.get('/runs/details/:runId', optionalAuth, async (req, res) => {
  try {
    const { runId } = req.params;
    if (!/^\d+$/.test(runId)) return res.status(404).json({ error: 'Run not found' });
    const result = await pool.query(`
      SELECT id, user_id, route_points, distance_meters, activity_type, created_at
      FROM runs
      WHERE id = $1
    `, [runId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const row = result.rows[0];
    const isOwner = !!req.userId && req.userId === row.user_id;
    res.json({ ...runSummaryRow(row), user_id: row.user_id, route_points: isOwner ? row.route_points : [], route_visible: isOwner });
  } catch (err: any) {
    console.error('[API] /runs/details error:', err.message);
    res.status(500).json({ error: 'Failed to load run details' });
  }
});

// Achievements computed from persisted data only (runs, territories, posts,
// followers). Nothing here is client-side or fabricated.
app.get('/api/profile/:userId/achievements', async (req, res) => {
  const { userId } = req.params;
  try {
    const [runs, zones, posts, followers, maxRun] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(distance_meters),0)::float AS d FROM runs WHERE user_id = $1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(area_square_meters),0)::float AS a FROM territories WHERE owner_id = $1`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM posts WHERE user_id = $1 AND post_type = 'user'`, [userId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM followers WHERE following_id = $1`, [userId]),
      pool.query(`SELECT COALESCE(MAX(distance_meters),0)::float AS m FROM runs WHERE user_id = $1`, [userId]),
    ]);
    const totalKm = runs.rows[0].d / 1000;
    const defs = [
      { id: 'first_run', icon: '👟', title: 'First Steps', description: 'Complete your first activity', progress: runs.rows[0].n, target: 1 },
      { id: 'runs_10', icon: '🔟', title: 'Regular', description: 'Complete 10 activities', progress: runs.rows[0].n, target: 10 },
      { id: 'km_10', icon: '🛣️', title: '10K Club', description: 'Cover 10 km in total', progress: +totalKm.toFixed(2), target: 10 },
      { id: 'km_100', icon: '🏔️', title: 'Centurion', description: 'Cover 100 km in total', progress: +totalKm.toFixed(2), target: 100 },
      { id: 'long_5k', icon: '🔥', title: 'Long Haul', description: 'Cover 5 km in a single activity', progress: +(maxRun.rows[0].m / 1000).toFixed(2), target: 5 },
      { id: 'first_zone', icon: '🚩', title: 'Flag Planter', description: 'Hold your first territory', progress: zones.rows[0].n, target: 1 },
      { id: 'zones_10', icon: '🏰', title: 'Warlord', description: 'Hold 10 territories at once', progress: zones.rows[0].n, target: 10 },
      { id: 'first_post', icon: '📣', title: 'Voice of the Arena', description: 'Publish your first post', progress: posts.rows[0].n, target: 1 },
      { id: 'followers_10', icon: '⭐', title: 'Rising Star', description: 'Reach 10 followers', progress: followers.rows[0].n, target: 10 },
    ];
    res.json(defs.map(d => ({ ...d, earned: d.progress >= d.target })));
  } catch (err: any) {
    console.error('[Achievements] error:', err.message);
    res.status(500).json({ error: 'Could not load achievements' });
  }
});

// Search users by display name (public profile fields only).
app.get('/api/users/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT id, display_name, avatar_url, character_type, color, bio FROM users
       WHERE display_name ILIKE $1 ORDER BY display_name LIMIT 20`,
      ['%' + q.replace(/[%_\\]/g, '\\$&') + '%']
    );
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// --- Admin Monitoring Panel Endpoints ---

app.get('/api/admin/stats', adminAuthMiddleware, async (req, res) => {
  try {
    const usersRes = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const runsRes = await pool.query('SELECT COUNT(*)::int AS count FROM runs');
    const territoriesRes = await pool.query('SELECT COUNT(*)::int AS count FROM territories');
    res.json({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      activeSockets: io.sockets.sockets.size,
      usersCount: usersRes.rows[0].count,
      runsCount: runsRes.rows[0].count,
      territoriesCount: territoriesRes.rows[0].count,
      dbConnected: pool.totalCount > 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/territory/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM territories WHERE id = $1', [id]);
    territoriesCache.delete(id);
    io.emit('territoriesUpdate', Array.from(territoriesCache.values()));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset-grid', adminAuthMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM territories');
    territoriesCache.clear();
    io.emit('territoriesUpdate', []);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/broadcast-push', adminAuthMiddleware, async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }
    let sentCount = 0;
    for (const [userId, token] of pushTokens.entries()) {
      await sendPushNotification(token, title, body);
      sentCount++;
    }
    // Record in push log
    pushLog.unshift({ title, body, sentCount, timestamp: new Date().toISOString() });
    if (pushLog.length > 50) pushLog.pop(); // keep max 50 entries
    res.json({ success: true, sentCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/push-single', adminAuthMiddleware, async (req, res) => {
  try {
    const { token, title, body } = req.body;
    if (!token || !title || !body) {
      return res.status(400).json({ error: 'token, title, and body are required' });
    }
    await sendPushNotification(token, title, body);
    pushLog.unshift({ title, body, sentCount: 1, timestamp: new Date().toISOString() });
    if (pushLog.length > 50) pushLog.pop();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Phase 4: Push log history
app.get('/api/admin/push-logs', adminAuthMiddleware, (req, res) => {
  res.json(pushLog);
});

// Phase 4: Detailed health endpoint
app.get('/api/admin/health-detail', adminAuthMiddleware, async (req, res) => {
  const mem = process.memoryUsage();
  const uptimeSec = Math.floor(process.uptime());

  // Measure DB latency
  let dbLatencyMs = -1;
  let dbOk = false;
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch (_) {}

  res.json({
    uptime: uptimeSec,
    nodeVersion: process.version,
    memHeapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
    memHeapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
    memRssMB: (mem.rss / 1024 / 1024).toFixed(1),
    dbLatencyMs,
    dbOk,
    activeSockets: livePlayers.size,
    pushTokenCount: pushTokens.size,
    pushLogCount: pushLog.length
  });
});

app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.email, u.display_name, u.character_type, u.color, u.bio, u.avatar_url,
        COALESCE(SUM(t.area_square_meters), 0)::float AS total_territory,
        COUNT(DISTINCT r.id)::int AS total_runs,
        COALESCE(SUM(r.distance_meters), 0)::float AS total_distance
      FROM users u
      LEFT JOIN territories t ON t.owner_id = u.id
      LEFT JOIN runs r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    const rows = result.rows.map(row => ({
      ...row,
      push_token: pushTokens.get(row.id) || null
    }));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/user/update', adminAuthMiddleware, async (req, res) => {
  try {
    const { userId, displayName, characterType, color, bio } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    await pool.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         character_type = COALESCE($3, character_type),
         color = COALESCE($4, color),
         bio = COALESCE($5, bio)
       WHERE id = $1`,
      [userId, displayName || null, characterType || null, color || null, bio || null]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/user/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    livePlayers.delete(id);
    for (const [tId, t] of territoriesCache.entries()) {
      if (t.userId === id) {
        territoriesCache.delete(tId);
      }
    }
    io.emit('territoriesUpdate', Array.from(territoriesCache.values()));
    io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/territory/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM territories WHERE id = $1', [id]);
    territoriesCache.delete(id);
    io.emit('territoriesUpdate', Array.from(territoriesCache.values()));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/heatmap', adminAuthMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT route_points FROM runs');
    const points: { latitude: number; longitude: number }[] = [];
    result.rows.forEach(row => {
      try {
        const pathData = row.route_points;
        if (Array.isArray(pathData)) {
          pathData.forEach((pt: any) => {
            if (pt && typeof pt.latitude === 'number' && typeof pt.longitude === 'number') {
              points.push({ latitude: pt.latitude, longitude: pt.longitude });
            }
          });
        }
      } catch (e) {}
    });
    res.json(points);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/analytics', adminAuthMiddleware, async (req, res) => {
  try {
    // Last 7 days — daily active users (distinct users who had a run)
    const dauResult = await pool.query(`
      SELECT DATE(created_at) as day, COUNT(DISTINCT user_id)::int as count
      FROM runs
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY day ORDER BY day ASC
    `);

    // Last 7 days — runs per day
    const runsResult = await pool.query(`
      SELECT DATE(created_at) as day, COUNT(*)::int as count
      FROM runs
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY day ORDER BY day ASC
    `);

    // Last 7 days — territories claimed per day
    const zonesResult = await pool.query(`
      SELECT DATE(claimed_at) as day, COUNT(*)::int as count
      FROM territories
      WHERE claimed_at >= NOW() - INTERVAL '7 days'
      GROUP BY day ORDER BY day ASC
    `);

    // Character class distribution
    const classResult = await pool.query(`
      SELECT character_type, COUNT(*)::int as count
      FROM users
      GROUP BY character_type
    `);

    // Top 5 players by total distance
    const topDistResult = await pool.query(`
      SELECT u.display_name, u.character_type, u.color,
             COALESCE(SUM(r.distance_meters), 0)::float AS total_distance,
             COUNT(r.id)::int AS total_runs
      FROM users u
      LEFT JOIN runs r ON r.user_id = u.id
      GROUP BY u.id ORDER BY total_distance DESC LIMIT 5
    `);

    // Top 5 players by territory
    const topTerritoryResult = await pool.query(`
      SELECT u.display_name, u.character_type, u.color,
             COALESCE(SUM(t.area_square_meters), 0)::float AS total_territory
      FROM users u
      LEFT JOIN territories t ON t.owner_id = u.id
      GROUP BY u.id ORDER BY total_territory DESC LIMIT 5
    `);

    res.json({
      dau: dauResult.rows,
      runsPerDay: runsResult.rows,
      zonesPerDay: zonesResult.rows,
      classDistribution: classResult.rows,
      topByDistance: topDistResult.rows,
      topByTerritory: topTerritoryResult.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


const PORT = process.env.PORT || 3000;

const expo = new Expo();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newUserId(): string {
  return 'usr_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function publicUser(u: any) {
  return {
    id: u.id,
    email: u.email || null,
    display_name: u.display_name || 'Runner',
    character_type: u.character_type || 'scout',
    color: u.color || '#00BFFF',
    avatar_url: u.avatar_url || '',
  };
}

async function findUserByEmail(cleanEmail: string): Promise<any | null> {
  if (isDbConnected) {
    try {
      const r = await pool.query('SELECT * FROM users WHERE lower(email) = $1 LIMIT 1', [cleanEmail]);
      if (r.rowCount) return r.rows[0];
      return null;
    } catch (e: any) {
      console.warn('[Auth] DB lookup warning:', e.message);
    }
  }
  return localStore.getUserByEmail(cleanEmail) || null;
}

async function findUserById(id: string): Promise<any | null> {
  if (isDbConnected) {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return r.rowCount ? r.rows[0] : null;
    } catch (e: any) {
      console.warn('[Auth] DB lookup warning:', e.message);
    }
  }
  return localStore.getUserById(id) || null;
}

// Simple in-memory brute-force throttle for credential endpoints.
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function authRateLimited(key: string, max = 10, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > max;
}

// Auth: Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName, characterType, color } = req.body || {};
    if (!email || !password || !displayName) return res.status(400).json({ error: 'Email, password and display name are required.' });
    const cleanEmail = String(email).trim().toLowerCase();
    const name = String(displayName).trim();
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Display name must be 2–40 characters.' });
    if (authRateLimited(`register:${req.ip}`, 20)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    if (await findUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const id = newUserId();
    const newUser: LocalUser = {
      id,
      email: cleanEmail,
      display_name: name,
      character_type: characterType || 'scout',
      color: /^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : '#00BFFF',
      password_hash: passwordHash,
      coins: 100,
      created_at: new Date().toISOString()
    };

    if (isDbConnected) {
      await pool.query(
        `INSERT INTO users (id, email, display_name, character_type, color, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, cleanEmail, name, newUser.character_type, newUser.color, passwordHash]
      );
    }
    localStore.saveUser(newUser);

    console.log(`✅ [Auth] User registered [ID: ${id}]`);
    res.status(201).json({ user: publicUser(newUser), token: signUserToken(id) });
  } catch (err: any) {
    console.error('[Register] Error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Auth: Login (email + password only; never auto-creates accounts)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const cleanEmail = String(email).trim().toLowerCase();
    if (authRateLimited(`login:${cleanEmail}`) || authRateLimited(`login-ip:${req.ip}`, 50)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }

    const user = await findUserByEmail(cleanEmail);
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google".' });
    }
    const isValid = await bcrypt.compare(String(password), user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Incorrect email or password.' });

    localStore.upsertUser(user.id, {
      email: user.email, display_name: user.display_name, character_type: user.character_type,
      color: user.color, password_hash: user.password_hash,
    });
    console.log(`✅ [Auth] User logged in [ID: ${user.id}]`);
    res.json({ user: publicUser(user), token: signUserToken(user.id) });
  } catch (err: any) {
    console.error('[Login] Error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Auth: Google — exchange a verified Firebase ID token for a backend session.
app.post('/api/auth/google', async (req, res) => {
  const idToken = req.body?.idToken;
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'Missing idToken' });
  let decoded: any;
  try {
    decoded = await verifyFirebaseIdToken(idToken);
  } catch (e: any) {
    console.warn('[Auth] Google token rejected:', e?.code || e?.message);
    return res.status(401).json({ error: 'Google sign-in could not be verified.', code: 'TOKEN_INVALID' });
  }
  try {
    const uid: string = decoded.uid;
    const email: string | null = decoded.email ? String(decoded.email).toLowerCase() : null;
    // 1) Existing Google user keyed by Firebase uid.
    let user = await findUserById(uid);
    // 2) Existing account with the same VERIFIED email → same person.
    if (!user && email && decoded.email_verified) user = await findUserByEmail(email);
    // 3) New account keyed by Firebase uid (so Storage rules match auth.uid).
    if (!user) {
      user = {
        id: uid,
        email,
        display_name: String(decoded.name || (email ? email.split('@')[0] : 'Runner')).slice(0, 40),
        character_type: 'scout',
        color: '#00BFFF',
      };
      if (isDbConnected) {
        await pool.query(
          `INSERT INTO users (id, email, display_name, character_type, color) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.email, user.display_name, user.character_type, user.color]
        );
      }
      localStore.upsertUser(user.id, user);
      console.log(`✅ [Auth] Google user created [ID: ${user.id}]`);
    }
    res.json({ user: publicUser(user), token: signUserToken(user.id) });
  } catch (err: any) {
    console.error('[Auth] Google sign-in error:', err.message);
    res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// Auth: current session (used by the app to validate a stored token).
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.userId!);
  if (!user) return res.status(401).json({ error: 'Account not found.', code: 'TOKEN_INVALID' });
  res.json({ user: publicUser(user) });
});

// Auth: Firebase custom token so every signed-in user (incl. email/password)
// gets a Firebase Auth session whose uid === backend user id.
app.post('/api/auth/firebase-token', requireAuth, async (req, res) => {
  try {
    const firebaseToken = await createFirebaseCustomToken(req.userId!);
    res.json({ firebaseToken });
  } catch (e: any) {
    if (e?.code === 'FIREBASE_ADMIN_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Photo uploads are not configured on the server yet.', code: e.code });
    }
    console.error('[Auth] firebase-token error:', e?.message);
    res.status(500).json({ error: 'Could not start an upload session.' });
  }
});

app.get('/api/auth/capabilities', (_req, res) => {
  res.json({ firebaseUploads: firebaseCustomTokensEnabled() });
});

// Register Push Token
app.post('/api/users/push-token', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const { token } = req.body;
  if (!token || typeof token !== 'string' || !Expo.isExpoPushToken(token)) return res.status(400).json({ error: 'Invalid push token' });
  try {
    await pool.query('UPDATE users SET expo_push_token = $1 WHERE id = $2', [token, userId]);
    pushTokens.set(userId, token);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Arena Coin Boost
app.post('/api/territory/boost', requireAuth, async (req, res) => {
  const userId = req.userId!;
  try {
    if (isDbConnected) {
      const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [userId]);
      const coins = userRes.rows[0]?.coins || 0;
      if (coins < 50) {
        return res.status(400).json({ error: 'Not enough Arena Coins. You need 50.' });
      }
      await pool.query('UPDATE users SET coins = coins - 50 WHERE id = $1', [userId]);
      return res.json({ success: true, remainingCoins: coins - 50 });
    }
    // Local fallback
    const localUser = localStore.getUserById(userId);
    if (!localUser) return res.status(404).json({ error: 'User not found' });
    const coins = localUser.coins || 0;
    if (coins < 50) {
      return res.status(400).json({ error: 'Not enough Arena Coins. You need 50.' });
    }
    localStore.upsertUser(userId, { coins: coins - 50 });
    res.json({ success: true, remainingCoins: coins - 50 });
  } catch (err: any) {
    // Final fallback to local store
    try {
      const localUser = localStore.getUserById(userId);
      if (!localUser) return res.status(404).json({ error: 'User not found' });
      const coins = localUser.coins || 0;
      if (coins < 50) return res.status(400).json({ error: 'Not enough Arena Coins. You need 50.' });
      localStore.upsertUser(userId, { coins: coins - 50 });
      return res.json({ success: true, remainingCoins: coins - 50 });
    } catch {
      res.status(500).json({ error: err.message });
    }
  }
});

server.listen(PORT, () => {
  console.log(`🚀 [Backend] Server running on http://localhost:${PORT}`);
  console.log(`📡 [Socket.io] Listening for connections...`);
});
