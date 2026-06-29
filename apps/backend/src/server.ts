import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import path from 'path';
import { Pool } from 'pg';
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
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

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

pool.connect().then(() => {
  console.log('✅ [Database] Connected to PostgreSQL successfully!');
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

async function saveRun(userId: string, routePoints: any[], distanceMeters: number) {
  try {
    const result = await pool.query(
      `INSERT INTO runs (user_id, route_points, distance_meters)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, JSON.stringify(routePoints), distanceMeters]
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
      `INSERT INTO territories (id, owner_id, polygon_coordinates, area_square_meters, color, run_session_id, claimed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         polygon_coordinates = EXCLUDED.polygon_coordinates,
         area_square_meters = EXCLUDED.area_square_meters`,
      [
        territory.id,
        territory.userId,
        JSON.stringify(territory.polygonCoordinates),
        territory.areaSquareMeters,
        territory.color,
        territory.runSessionId,
        territory.claimedAt,
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
      `SELECT t.id, t.owner_id, t.polygon_coordinates, t.area_square_meters, t.color, t.run_session_id, t.claimed_at,
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
    const promise = saveRun(payload.userId, payload.routePoints || [], payload.distanceMeters);
    ongoingDbWrites.set(payload.userId, promise);
    try {
      await promise;
    } finally {
      ongoingDbWrites.delete(payload.userId);
    }

    const player = livePlayers.get(payload.userId);
    if (player) {
      player.isRunning = false;
      player.currentSpeedKmh = 0;
      livePlayers.set(payload.userId, player);
      io.emit('livePlayersUpdate', Array.from(livePlayers.values()));
    }
  });

  socket.on('territoryClaim', async (payload: TerritoryClaimPayload & { polygonCoordinates: any[]; areaSquareMeters: number; color: string }) => {
    console.log(`[Socket.io] Territory claimed by user: ${payload.userId}, Area: ${payload.areaSquareMeters} sqm`);

    // Wait for any ongoing run saves to complete to prevent distance race conditions
    const pendingSave = ongoingDbWrites.get(payload.userId);
    if (pendingSave) {
      console.log(`[Socket.io] Delaying claim verification: Waiting for user ${payload.userId} run to save...`);
      await pendingSave;
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
      const loserPushToken = pushTokens.get(loser);
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

// REST: Get all territories
app.get('/territories', async (req, res) => {
  const territories = await loadAllTerritories();
  res.json(territories);
});

// REST: Get global leaderboard ranked by total territory claimed
app.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id,
        u.display_name,
        u.character_type,
        u.color,
        COALESCE(SUM(t.area_square_meters), 0)::float AS total_territory,
        COUNT(DISTINCT r.id)::int AS total_runs,
        COALESCE(SUM(r.distance_meters), 0)::float AS total_distance
      FROM users u
      LEFT JOIN territories t ON t.owner_id = u.id
      LEFT JOIN runs r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY total_territory DESC
      LIMIT 20
    `);
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
    const { userId, displayName, characterType, color, bio, avatarUrl } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    await pool.query(
      `INSERT INTO users (id, display_name, character_type, color, bio, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         character_type = COALESCE(EXCLUDED.character_type, users.character_type),
         color = COALESCE(EXCLUDED.color, users.color),
         bio = COALESCE(EXCLUDED.bio, users.bio),
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)`,
      [userId, displayName || null, characterType || null, color || null, bio || null, avatarUrl || null]
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
const adminAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers['x-admin-token'];
  const secret = process.env.ADMIN_SECRET_KEY || 'default_admin_secret_key_change_me';
  if (token === secret) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

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
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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

server.listen(PORT, () => {
  console.log(`🚀 [Backend] Server running on http://localhost:${PORT}`);
  console.log(`📡 [Socket.io] Listening for connections...`);
});
