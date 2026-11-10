/**
 * StrideClash backend integration tests.
 *
 * Starts the compiled backend (dist/server.js) against an ISOLATED database and
 * exercises auth, authorization, social, runs and Socket.IO end to end.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/strideclash_test \
 *     node --test apps/backend/tests/integration.test.mjs
 *
 * Safety: refuses to run unless the database host is localhost/127.0.0.1, and
 * uses a throwaway LOCAL_DB_DIR so the repo's data/local-db.json is untouched.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_URL = process.env.TEST_DATABASE_URL || '';
if (!/^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//.test(DB_URL)) {
  throw new Error('TEST_DATABASE_URL must point at a localhost database. Refusing to run against anything else.');
}

const PORT = 3999 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'integration-test-secret-' + 'x'.repeat(32);
const ADMIN_KEY = 'integration-admin-key-0123456789';
const BUCKET = 'runwars-355df.firebasestorage.app';
const tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'strideclash-test-'));
let server;
let serverLog = '';

async function api(method, url, { token, body, headers } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

const uniq = () => Math.random().toString(36).slice(2, 8);
const storageUrl = (kind, uid, file = 'a.jpg') =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`${kind}-images/${uid}/${file}`)}?alt=media&token=t`;

// Random arena per test run so leftover territories from earlier runs never overlap.
const BASE_LAT = -60 + Math.random() * 120;
const BASE_LNG = -170 + Math.random() * 340;
function route(n = 12, startTs = Date.now() - 600000, stepSec = 10) {
  // ~25 m per step around a small loop at running pace.
  return Array.from({ length: n }, (_, i) => ({
    latitude: BASE_LAT + Math.sin(i / n * 2 * Math.PI) * 0.0005,
    longitude: BASE_LNG + Math.cos(i / n * 2 * Math.PI) * 0.0005,
    timestamp: startTs + i * stepSec * 1000,
  }));
}

before(async () => {
  const entry = path.join(here, '..', 'dist', 'server.js');
  assert.ok(fs.existsSync(entry), 'Build the backend first (npm run build:backend).');
  server = spawn(process.execPath, [entry], {
    cwd: tmpStore, // no .env here, so dotenv loads nothing from the repo
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      PORT: String(PORT), DATABASE_URL: DB_URL, JWT_SECRET, ADMIN_SECRET_KEY: ADMIN_KEY,
      LOCAL_DB_DIR: tmpStore, FIREBASE_STORAGE_BUCKET: BUCKET,
    },
  });
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.status === 200) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Backend did not become healthy:\n' + serverLog.slice(-2000));
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise(r => server.once('exit', r));
    server.kill();
    await exited;
  }
  // Windows may hold the directory briefly after exit; retry, then give up quietly.
  try { fs.rmSync(tmpStore, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
});

// ─── Auth lifecycle ───────────────────────────────────────────────────────────

const alice = { email: `alice_${uniq()}@test.local`, password: 'pass1234', displayName: 'Alice Test' };
const bob = { email: `bob_${uniq()}@test.local`, password: 'pass5678', displayName: 'Bob Test' };
let A, B; // { token, id }

test('signup creates accounts and returns a token', async () => {
  for (const [who, creds] of [['A', alice], ['B', bob]]) {
    const r = await api('POST', '/api/auth/register', { body: creds });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.token && r.body.user.id);
    if (who === 'A') A = { token: r.body.token, id: r.body.user.id }; else B = { token: r.body.token, id: r.body.user.id };
  }
});

test('duplicate signup is rejected', async () => {
  const r = await api('POST', '/api/auth/register', { body: alice });
  assert.equal(r.status, 409);
});

test('signup validates input', async () => {
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'nope', password: 'pass1234', displayName: 'X Y' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { body: { email: `s_${uniq()}@t.local`, password: '123', displayName: 'Short Pw' } })).status, 400);
});

test('login works with correct password, fails otherwise', async () => {
  const ok = await api('POST', '/api/auth/login', { body: { email: alice.email.toUpperCase(), password: alice.password } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.id, A.id);
  const bad = await api('POST', '/api/auth/login', { body: { email: alice.email, password: 'wrong' } });
  assert.equal(bad.status, 401);
});

test('login never auto-creates accounts for unknown emails', async () => {
  const r = await api('POST', '/api/auth/login', { body: { email: `ghost_${uniq()}@test.local`, password: 'whatever1' } });
  assert.equal(r.status, 401);
});

test('/api/auth/me validates the session token', async () => {
  assert.equal((await api('GET', '/api/auth/me', { token: A.token })).body.user.id, A.id);
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
});

// ─── Token security ───────────────────────────────────────────────────────────

test('missing, garbage, forged and expired tokens are rejected (401)', async () => {
  const body = { content: 'hello' };
  const missing = await api('POST', '/api/posts', { body });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, 'TOKEN_MISSING');

  assert.equal((await api('POST', '/api/posts', { body, token: 'garbage.token.value' })).body.code, 'TOKEN_INVALID');

  const forged = jwt.sign({ sub: A.id }, 'super_secret_runwars_key_123', { expiresIn: '1h' }); // old public default
  assert.equal((await api('POST', '/api/posts', { body, token: forged })).status, 401);

  const none = jwt.sign({ sub: A.id }, '', { algorithm: 'none' });
  assert.equal((await api('POST', '/api/posts', { body, token: none })).status, 401);

  const expired = jwt.sign({ sub: A.id, exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET);
  const e = await api('POST', '/api/posts', { body, token: expired });
  assert.equal(e.status, 401);
  assert.equal(e.body.code, 'TOKEN_EXPIRED');
});

test('impersonation via body userId is refused (403)', async () => {
  const r = await api('POST', '/api/posts', { token: A.token, body: { userId: B.id, content: 'I am Bob' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'IDENTITY_MISMATCH');
});

test('every protected write endpoint rejects anonymous requests', async () => {
  const writes = [
    ['POST', '/api/posts'], ['DELETE', '/api/posts/1'], ['POST', '/api/posts/1/like'],
    ['POST', '/api/posts/1/comments'], ['DELETE', '/api/comments/1'],
    ['POST', '/api/followers/follow'], ['POST', '/api/followers/unfollow'],
    ['POST', '/api/profile/update'], ['POST', '/profile/update'], ['POST', '/api/users/push-token'],
    ['POST', '/api/shop/unlock-color'], ['POST', '/api/shop/check-milestones'],
    ['POST', '/api/shop/unlock-avatar'], ['POST', '/api/shop/set-avatar'],
    ['POST', '/api/territory/boost'], ['POST', '/api/runs'], ['POST', '/api/auth/firebase-token'],
  ];
  for (const [m, u] of writes) {
    const r = await api(m, u, { body: { userId: A.id } });
    assert.equal(r.status, 401, `${m} ${u} returned ${r.status}`);
  }
});

test('admin API rejects the public default key and accepts the configured one', async () => {
  assert.equal((await api('GET', '/api/admin/stats', { headers: { 'x-admin-token': 'default_admin_secret_key_change_me' } })).status, 401);
  assert.equal((await api('GET', '/api/admin/stats')).status, 401);
  assert.equal((await api('GET', '/api/admin/stats', { headers: { 'x-admin-token': ADMIN_KEY } })).status, 200);
});

// ─── Social ───────────────────────────────────────────────────────────────────

let postId, commentId;

test('profile edit + own image URLs accepted, foreign/external URLs rejected', async () => {
  const ok = await api('POST', '/api/profile/update', { token: A.token, body: {
    displayName: 'Alice Runner', bio: 'Loves hills', avatarUrl: storageUrl('avatar', A.id), coverImageUrl: storageUrl('cover', A.id) } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const p = await api('GET', `/api/profile/${A.id}`);
  assert.equal(p.body.user.display_name, 'Alice Runner');
  assert.equal(p.body.user.bio, 'Loves hills');
  assert.equal(p.body.user.avatar_url, storageUrl('avatar', A.id));
  assert.equal(p.body.user.cover_image_url, storageUrl('cover', A.id));

  assert.equal((await api('POST', '/api/profile/update', { token: A.token, body: { avatarUrl: storageUrl('avatar', B.id) } })).status, 400);
  assert.equal((await api('POST', '/api/profile/update', { token: A.token, body: { avatarUrl: 'https://evil.example/x.jpg' } })).status, 400);

  // Clearing works.
  assert.equal((await api('POST', '/api/profile/update', { token: A.token, body: { coverImageUrl: '' } })).status, 200);
  assert.equal((await api('GET', `/api/profile/${A.id}`)).body.user.cover_image_url, '');
});

test('create post (text + own image), reject foreign image', async () => {
  const r = await api('POST', '/api/posts', { token: A.token, body: { content: 'First post!', imageUrl: storageUrl('post', A.id) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  postId = r.body.id;
  assert.equal(r.body.user_id, A.id);
  assert.equal((await api('POST', '/api/posts', { token: A.token, body: { content: 'x', imageUrl: storageUrl('post', B.id) } })).status, 400);
  assert.equal((await api('POST', '/api/posts', { token: A.token, body: { content: '' } })).status, 400);
});

test('feed shows the post with like state per viewer', async () => {
  const feed = await api('GET', '/api/feed', { token: B.token });
  const post = feed.body.find(p => String(p.id) === String(postId));
  assert.ok(post, 'post in feed');
  assert.equal(post.is_liked, false);
});

test('like / unlike toggles and counts', async () => {
  const l1 = await api('POST', `/api/posts/${postId}/like`, { token: B.token });
  assert.deepEqual([l1.status, l1.body.liked, l1.body.likesCount], [200, true, 1]);
  const feed = await api('GET', '/api/feed', { token: B.token });
  assert.equal(feed.body.find(p => String(p.id) === String(postId)).is_liked, true);
  const l2 = await api('POST', `/api/posts/${postId}/like`, { token: B.token });
  assert.deepEqual([l2.body.liked, l2.body.likesCount], [false, 0]);
  assert.equal((await api('POST', '/api/posts/999999/like', { token: B.token })).status, 404);
});

test('comment, and only author or post owner may delete it', async () => {
  const c = await api('POST', `/api/posts/${postId}/comments`, { token: B.token, body: { content: 'Nice one' } });
  assert.equal(c.status, 201);
  commentId = c.body.id;
  const list = await api('GET', `/api/posts/${postId}/comments`);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].user_id, B.id);

  // A third user cannot delete it.
  const C = await api('POST', '/api/auth/register', { body: { email: `c_${uniq()}@test.local`, password: 'pass9999', displayName: 'Carol Test' } });
  assert.equal((await api('DELETE', `/api/comments/${commentId}`, { token: C.body.token })).status, 403);
  // Post owner can.
  assert.equal((await api('DELETE', `/api/comments/${commentId}`, { token: A.token })).status, 200);
  assert.equal((await api('GET', `/api/posts/${postId}/comments`)).body.length, 0);
});

test('follow / unfollow and lists', async () => {
  assert.equal((await api('POST', '/api/followers/follow', { token: B.token, body: { followingId: A.id } })).status, 200);
  assert.equal((await api('POST', '/api/followers/follow', { token: B.token, body: { followingId: B.id } })).status, 400);
  assert.equal((await api('POST', '/api/followers/follow', { token: B.token, body: { followingId: 'nobody' } })).status, 404);
  let lists = await api('GET', `/api/followers/${A.id}`);
  assert.deepEqual(lists.body.followers.map(u => u.id), [B.id]);
  lists = await api('GET', `/api/followers/${B.id}`);
  assert.deepEqual(lists.body.following.map(u => u.id), [A.id]);
  const prof = await api('GET', `/api/profile/${A.id}`);
  assert.equal(prof.body.followers.length, 1);
  assert.equal((await api('POST', '/api/followers/unfollow', { token: B.token, body: { followingId: A.id } })).status, 200);
  assert.equal((await api('GET', `/api/followers/${A.id}`)).body.followers.length, 0);
});

test('user search finds by display name', async () => {
  const r = await api('GET', '/api/users/search?q=Alice%20Run');
  assert.ok(r.body.some(u => u.id === A.id));
});

test('only the owner can delete a post; delete removes likes/comments', async () => {
  await api('POST', `/api/posts/${postId}/like`, { token: B.token });
  await api('POST', `/api/posts/${postId}/comments`, { token: B.token, body: { content: 'again' } });
  assert.equal((await api('DELETE', `/api/posts/${postId}`, { token: B.token })).status, 403);
  assert.equal((await api('DELETE', `/api/posts/${postId}`, { token: A.token })).status, 200);
  assert.equal((await api('DELETE', `/api/posts/${postId}`, { token: A.token })).status, 404);
});

// ─── Runs, territory, achievements ────────────────────────────────────────────

test('run submit: server recomputes distance, is idempotent, claims territory', async () => {
  const pts = route(12);
  const r1 = await api('POST', '/api/runs', { token: A.token, body: { routePoints: pts, distanceMeters: 999999, activityType: 'run', claim: { color: '#22C55E' } } });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.ok(r1.body.distanceMeters > 100 && r1.body.distanceMeters < 500, 'server-computed distance, not client value');
  assert.equal(r1.body.claim, 'claimed');
  assert.ok(r1.body.claimArea > 0, 'server computes the claimed area');
  assert.equal(r1.body.durationSeconds, 110);
  const r2 = await api('POST', '/api/runs', { token: A.token, body: { routePoints: pts, activityType: 'run', claim: {} } });
  assert.equal(r2.body.duplicate, true);
  assert.equal(r2.body.runId, r1.body.runId);

  const runs = await api('GET', `/runs/${A.id}`);
  assert.equal(runs.body.length, 1);
  assert.equal(runs.body[0].duration_seconds, 110);
  assert.ok(runs.body[0].pace_seconds_per_km > 0);
  assert.equal(runs.body[0].route_points, undefined, 'history never includes GPS routes');
});

test('speed cheat is rejected for walk', async () => {
  const fast = route(12, Date.now() - 100000, 1); // ~9 m/s = 32 km/h walking
  const r = await api('POST', '/api/runs', { token: A.token, body: { routePoints: fast, activityType: 'walk', claim: {} } });
  assert.equal(r.status, 201);
  assert.equal(r.body.claim, 'rejected');
});

test('run route is private to its owner', async () => {
  const runs = await api('GET', `/runs/${A.id}`);
  const id = runs.body[0].id;
  const own = await api('GET', `/runs/details/${id}`, { token: A.token });
  assert.ok(own.body.route_points.length > 0);
  const other = await api('GET', `/runs/details/${id}`, { token: B.token });
  assert.equal(other.body.route_points.length, 0);
  const anon = await api('GET', `/runs/details/${id}`);
  assert.equal(anon.body.route_points.length, 0);
});

test('achievements come from persisted data', async () => {
  const r = await api('GET', `/api/profile/${A.id}/achievements`);
  const byId = Object.fromEntries(r.body.map(a => [a.id, a]));
  assert.equal(byId.first_run.earned, true);
  assert.equal(byId.first_zone.earned, true);
  assert.equal(byId.km_100.earned, false);
  const rb = await api('GET', `/api/profile/${B.id}/achievements`);
  assert.equal(rb.body.find(a => a.id === 'first_run').earned, false);
});

test('territory shows on map and leaderboard', async () => {
  const t = await api('GET', '/territories');
  assert.ok(t.body.some(x => x.userId === A.id));
  const lb = await api('GET', '/leaderboard');
  assert.equal(lb.status, 200);
});

test('friends leaderboard: requires login, returns self + followed runners only', async () => {
  assert.equal((await api('GET', '/leaderboard?scope=friends')).status, 401);
  await api('POST', '/api/followers/follow', { token: B.token, body: { followingId: A.id } });
  const r = await api('GET', '/leaderboard?scope=friends&metric=distance', { token: B.token });
  assert.equal(r.status, 200);
  const ids = r.body.map(x => x.id).sort();
  assert.deepEqual(ids, [A.id, B.id].sort());
  await api('POST', '/api/followers/unfollow', { token: B.token, body: { followingId: A.id } });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(BASE, { transports: ['websocket'], auth: token ? { token } : undefined, reconnection: false, timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

test('socket: spectators cannot write; authenticated identity cannot be spoofed', async () => {
  const anon = await connect();
  const authErr = new Promise(r => anon.once('auth:error', r));
  anon.emit('playerJoin', { userId: A.id, displayName: 'spoof', characterType: 'scout', color: '#fff' });
  assert.equal((await authErr).code, 'TOKEN_MISSING');
  anon.close();

  const sb = await connect(B.token);
  const update = new Promise(r => sb.on('livePlayersUpdate', list => { if (list.length) r(list); }));
  sb.emit('playerJoin', { userId: A.id, displayName: 'Bob pretending', characterType: 'scout', color: '#123456' });
  const list = await update;
  assert.ok(list.some(p => p.userId === B.id), 'joined as the token identity');
  assert.ok(!list.some(p => p.userId === A.id), 'could not join as Alice');
  sb.close();
});

test('firebase-token reports missing server credentials clearly', async () => {
  const r = await api('POST', '/api/auth/firebase-token', { token: A.token });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'FIREBASE_ADMIN_NOT_CONFIGURED');
});

test('google exchange rejects an invalid Firebase ID token', async () => {
  const r = await api('POST', '/api/auth/google', { body: { idToken: 'not-a-real-token' } });
  assert.equal(r.status, 401);
});
