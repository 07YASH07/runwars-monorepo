import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Expo } from 'expo-server-sdk';
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/admin', express.static(path.join(__dirname, '../../admin/dist')));
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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/runwars',
});

pool.connect().then(async () => {
  console.log('✅ [Database] Connected to PostgreSQL successfully!');
  try {
    const res = await pool.query('SELECT id, expo_push_token FROM users WHERE expo_push_token IS NOT NULL');
    for (const row of res.rows) {
      pushTokens.set(row.id, row.expo_push_token);
    }
    console.log(`📡 [Push] Loaded ${pushTokens.size} push tokens from database.`);
  } catch (err: any) {
    console.error('❌ [Push] Failed to load push tokens on startup:', err.message);
  }
}).catch((err) => {
  console.error('❌ [Database] Failed to connect to PostgreSQL:', err.message);
  console.log('⚠️  [Server] Running in memory-only mode (territories will not persist).');
});

// --- In-Memory Live State (real-time only, not persisted) ---
const livePlayers = new Map<string, LivePlayerState>();
const socketToUser = new Map<string, string>();
const userToSocket = new Map<string, string>(); // userId -> socketId for targeted events
const pushTokens = new Map<string, string>();   // userId -> Expo push token
const ongoingDbWrites = new Map<string, Promise<any>>();
const lastAlerts = new Map<string, number>();   // spam prevention for invasion alerts

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

// Get total distance run by a player from DB
async function getPlayerTotalDistance(userId: string): Promise<number> {
  try {
    const res = await pool.query(
      `SELECT COALESCE(SUM(distance_meters), 0)::float AS total FROM runs WHERE user_id = $1`,
      [userId]
    );
    return res.rows[0]?.total ?? 0;
  } catch { return 0; }
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

// --- DB Helper Functions ---

async function upsertUser(userId: string, data: Partial<{ email: string; display_name: string; character_type: string; color: string }>) {
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
  try {
    const result = await pool.query(
      `INSERT INTO runs (user_id, route_points, distance_meters, activity_type)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, JSON.stringify(routePoints), distanceMeters, activityType || 'run']
    );
    return result.rows[0]?.id;
  } catch (err: any) {
    console.error('[DB] saveRun error:', err.message);
    return null;
  }
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

// --- Socket.io Events ---

io.on('connection', async (socket: Socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Send current live state to newly connected client
  socket.emit('livePlayersUpdate', Array.from(livePlayers.values()));
  socket.emit('territoriesUpdate', Array.from(territoriesCache.values()));

  socket.on('playerJoin', async (payload: PlayerJoinPayload) => {
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
    if (payload.userId && payload.token) {
      pushTokens.set(payload.userId, payload.token);
      console.log(`[Push] Token registered for user ${payload.userId}`);
    }
  });

  socket.on('locationUpdate', (payload: LocationUpdatePayload) => {
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
            const ownerPushToken = pushTokens.get(t.userId);
            if (ownerPushToken) {
              const spamKey = `${t.id}_${payload.userId}`;
              const lastAlert = lastAlerts.get(spamKey);
              const now = Date.now();
              if (!lastAlert || (now - lastAlert > 300000)) { // 5-minute cooldown
                lastAlerts.set(spamKey, now);
                sendPushNotification(
                  ownerPushToken,
                  '⚠️ Territory Alert!',
                  `Runner ${player.displayName || 'someone'} has entered your territory (Zone ${t.id.substring(0, 6)})!`
                ).catch(console.error);

                // Send in-app PvP warning alert to the invader
                socket.emit('pvp:warning', {
                  message: `⚠️ Warning: You have entered territory owned by another runner!`
                });
              }
            }
          }
        }
      }
    }
  });

  socket.on('runStart', (payload: RunStartPayload) => {
    console.log(`[Socket.io] Run started by user: ${payload.userId}`);
    const player = livePlayers.get(payload.userId);
    if (player) {
      player.isRunning = true;
      livePlayers.set(payload.userId, player);
      io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
    }
  });

  socket.on('runStop', async (payload: RunStopPayload) => {
    console.log(`[Socket.io] Run stopped by user: ${payload.userId}, Distance: ${payload.distanceMeters}m`);

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
  });

  socket.on('territoryClaim', async (payload: TerritoryClaimPayload & { polygonCoordinates: any[]; areaSquareMeters: number; color: string; activityType?: string }) => {
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
      socket.emit('claim:rejected', {
        reason: `Your average speed (${avgSpeedKmh.toFixed(1)} km/h) exceeds the maximum allowed speed for ${activityType} (${limit} km/h).`
      });
      return;
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
        return;
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

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    playersCount: livePlayers.size,
    territoriesCount: territoriesCache.size,
    db: pool.totalCount > 0 ? 'connected' : 'disconnected',
  });
});

// --- Admin Monitoring Middleware ---
const adminAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers['x-admin-token'];
  const secret = process.env.ADMIN_SECRET_KEY || 'default_admin_secret_key_change_me';
  if (token === secret) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// --- Phase 2: Social REST Routes ---

// Get merged, paginated social feed
app.get('/api/feed', async (req, res) => {
  try {
    const userId = (req.query.userId as string) || '';
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
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create user post
app.post('/api/posts', async (req, res) => {
  const { userId, content, imageUrl, postType, relatedId } = req.body;
  if (!userId || !content) {
    return res.status(400).json({ error: 'Missing userId or content' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO posts (user_id, content, image_url, post_type, related_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, content, image_url, post_type, related_id, created_at`,
      [userId, content, imageUrl || null, postType || 'user', relatedId || null]
    );
    io.emit('feed:updated');
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete own post
app.delete('/api/posts/:id', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  try {
    const result = await pool.query(
      'DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING id',
      [postId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Post not found or unauthorized' });
    }
    io.emit('feed:updated');
    res.json({ message: 'Post deleted successfully', id: postId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle post like
app.post('/api/posts/:id/like', async (req, res) => {
  const postId = req.params.id;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  try {
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
app.post('/api/posts/:id/comments', async (req, res) => {
  const postId = req.params.id;
  const { userId, content } = req.body;
  if (!userId || !content) {
    return res.status(400).json({ error: 'Missing userId or content' });
  }
  try {
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
app.delete('/api/comments/:id', async (req, res) => {
  const commentId = req.params.id;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  try {
    const result = await pool.query(
      'DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id',
      [commentId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found or unauthorized' });
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
      `SELECT id, display_name, avatar_url, character_type, color, bio, cover_image_url, coins, unlocked_colors FROM users WHERE id = $1`,
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
      `SELECT COUNT(*)::int AS total_zones FROM territories WHERE owner_id = $1`,
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
        unlocked_colors: userRes.rows[0].unlocked_colors || []
      },
      stats: {
        total_distance: statsRes.rows[0]?.total_distance || 0,
        total_runs: statsRes.rows[0]?.total_runs || 0,
        total_zones: zonesRes.rows[0]?.total_zones || 0
      },
      posts: postsRes.rows,
      followers: followersRes.rows,
      following: followingRes.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Followers API: Follow User
app.post('/api/followers/follow', async (req, res) => {
  const { userId, followingId } = req.body;
  if (!userId || !followingId) return res.status(400).json({ error: 'Missing userId or followingId' });
  if (userId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });
  
  try {
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
app.post('/api/followers/unfollow', async (req, res) => {
  const { userId, followingId } = req.body;
  if (!userId || !followingId) return res.status(400).json({ error: 'Missing userId or followingId' });
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
app.post('/api/shop/unlock-color', async (req, res) => {
  const { userId, color } = req.body;
  if (!userId || !color) {
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
app.get('/leaderboard', async (req, res) => {
  try {
    const allowedActivities = ['all', 'run', 'walk', 'cycle'];
    const allowedMetrics = ['distance', 'territory', 'zones'];

    const activity = allowedActivities.includes(req.query.activity as string)
      ? (req.query.activity as string)
      : 'all';
    const metric = allowedMetrics.includes(req.query.metric as string)
      ? (req.query.metric as string)
      : 'territory';

    // Build filters safely based on whitelisted strings
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
      ORDER BY ${orderByColumn} DESC
      LIMIT 20
    `;

    const result = await pool.query(queryText);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[API] /leaderboard error:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// REST: Get a single player profile stats
app.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
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
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[API] /profile error:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// REST: Update user profile
app.post('/profile/update', async (req, res) => {
  try {
    const { userId, displayName, characterType, color, bio, avatarUrl, coverImageUrl } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
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
    res.json({ success: true });
  } catch (err: any) {
    console.error('[API] /profile/update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// REST: Get run history for a player
app.get('/runs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT id, distance_meters, created_at
      FROM runs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[API] /runs error:', err.message);
    res.status(500).json({ error: 'Failed to load runs' });
  }
});

// REST: Get a single run's full details (including coordinates)
app.get('/runs/details/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    const result = await pool.query(`
      SELECT id, user_id, route_points, distance_meters, created_at
      FROM runs
      WHERE id = $1
    `, [runId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[API] /runs/details error:', err.message);
    res.status(500).json({ error: 'Failed to load run details' });
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
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_runwars_key_123';

// Auth: Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName, characterType, color } = req.body;
    if (!email || !password || !displayName) return res.status(400).json({ error: 'Missing fields' });
    
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) return res.status(400).json({ error: 'Email in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const id = 'usr_' + Date.now().toString(36);
    
    await pool.query(
      `INSERT INTO users (id, email, display_name, character_type, color, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, email, displayName, characterType || 'scout', color || '#00BFFF', passwordHash]
    );

    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user: { id, display_name: displayName, character_type: characterType, color }, token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Auth: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1 OR id = $1', [email]);
    if (!userRes.rowCount || userRes.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    
    const user = userRes.rows[0];
    const isValid = user.password_hash ? await bcrypt.compare(password, user.password_hash) : true; // Fallback for old mock users
    if (!isValid) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ 
      user: { id: user.id, display_name: user.display_name, character_type: user.character_type, color: user.color }, 
      token 
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Register Push Token
app.post('/api/users/push-token', async (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'Missing userId or token' });
  try {
    await pool.query('UPDATE users SET expo_push_token = $1 WHERE id = $2', [token, userId]);
    pushTokens.set(userId, token);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Follow User
app.post('/api/followers/follow', async (req, res) => {
  const { userId, followingId } = req.body;
  if (!userId || !followingId) return res.status(400).json({ error: 'Missing userId or followingId' });
  if (userId === followingId) return res.status(400).json({ error: 'Cannot follow yourself' });
  
  try {
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

// Arena Coin Boost
app.post('/api/territory/boost', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const userRes = await pool.query('SELECT coins FROM users WHERE id = $1', [userId]);
    const coins = userRes.rows[0]?.coins || 0;
    if (coins < 50) {
      return res.status(400).json({ error: 'Not enough Arena Coins. You need 50.' });
    }
    
    await pool.query('UPDATE users SET coins = coins - 50 WHERE id = $1', [userId]);
    res.json({ success: true, remainingCoins: coins - 50 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 [Backend] Server running on http://localhost:${PORT}`);
  console.log(`📡 [Socket.io] Listening for connections...`);
});
