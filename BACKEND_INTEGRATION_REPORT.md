# BACKEND INTEGRATION REPORT
**Date:** 2026-11-09  
**Status:** Code-inspection verified. Physical network tests required.

---

## Server Configuration
- **Port:** `process.env.PORT || 3000`  
- **Render.com deployment:** `https://runwars-v2.onrender.com`  
- **Local:** `http://192.168.29.185:3000`  
- **TypeScript build:** ✅ 0 errors  
- **DB:** PostgreSQL (Render) + local JSON fallback via `localStore.ts`

---

## Mobile API Fallback Chain
`api.ts` tries URLs in this order:
1. `process.env.EXPO_PUBLIC_BACKEND_URL` (Cloudflare tunnel, session-specific)  
2. `http://192.168.29.185:3000` (local WiFi)  
3. `https://runwars-v2.onrender.com` (Render deployment)  
4. `http://10.0.2.2:3000` (Android emulator loopback)

Each URL gets an 8-second timeout. If all fail, the last error is thrown.

**Risk for tomorrow:** If Cloudflare tunnel is not running and Render is cold-starting, the first request may take 15–30 seconds. The 8 s timeout will fail the first URL, then Render gets its own 8 s window. Cold-start latency on Render free tier is ~30 s.

**Recommendation:** Start the Cloudflare tunnel before the run, or keep the Render backend warm with a `curl https://runwars-v2.onrender.com/health` ping.

---

## Endpoint Verification (Code Inspection)

### Auth
| Endpoint | Status | Notes |
|---|---|---|
| `POST /api/auth/register` | ✅ Exists | bcrypt hash + JWT |
| `POST /api/auth/login` | ✅ Exists | bcrypt verify + JWT, local fallback |

### Run Session (via WebSocket)
| Event | Status | Notes |
|---|---|---|
| `runStart` (emit) | ✅ Handler exists | Sets `player.isRunning = true` |
| `runStop` (emit) | ✅ Handler exists | Saves run to DB + local store, awards 50 coins |
| `territoryClaim` (emit) | ✅ Handler exists | Speed validation, overlap detection, saves territory |

### Territory
| Endpoint | Status | Notes |
|---|---|---|
| `GET /territories` | ✅ Exists | Returns all territories from DB or cache |
| `POST /api/territory/boost` | ✅ Exists | Deducts 50 coins, DB + local fallback |

### Profile & Stats
| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/profile/:userId` | ✅ Exists | Returns user + stats + posts, local fallback |
| `GET /leaderboard` | ✅ Exists | Returns ranked list |

### Social
| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/feed` | ✅ Exists | Paginated feed, local fallback |
| `POST /api/posts` | ✅ Exists | Create post |
| `POST /api/posts/:id/like` | ✅ Exists | Toggle like |

### Admin
| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/admin/stats` | ✅ Exists | Requires `X-Admin-Token` header |
| `GET /api/admin/health-detail` | ✅ Exists | Detailed health check |
| `GET /health` | ✅ Exists | Public health check |

### Push Notifications
| Endpoint | Status | Notes |
|---|---|---|
| `POST /api/users/push-token` | ✅ Exists | Registers Expo push token |

---

## Socket.IO Events
| Event | Direction | Status |
|---|---|---|
| `playerJoin` | Client → Server | ✅ |
| `locationUpdate` | Client → Server | ✅ |
| `runStart` | Client → Server | ✅ |
| `runStop` | Client → Server | ✅ |
| `territoryClaim` | Client → Server | ✅ |
| `livePlayersUpdate` | Server → Client | ✅ |
| `territoriesUpdate` | Server → Client | ✅ |
| `territoryClaimed` | Server → Client | ✅ |
| `territory:stolen` | Server → Client | ✅ |
| `pvp:warning` | Server → Client | ✅ |
| `claim:rejected` | Server → Client | ✅ |
| `conflict:resolved` | Server → Client | ✅ |

---

## LocalStore Fallback (No DB)
When PostgreSQL is unavailable, `localStore.ts` provides:
- In-memory + JSON file persistence (`data/local-db.json`)
- Seeded with `admin@strideclash.com` (password: `admin123`) and `demo@strideclash.com`
- Runs, territories, posts, followers all persisted locally

**Risk:** If two Render instances are running (auto-scaled), the in-memory territory cache is split across instances. For tomorrow's private single-instance test, this is not a concern.

---

## Critical Checks Before Tomorrow's Run

- [ ] Run `curl https://runwars-v2.onrender.com/health` and confirm `{"status":"ok"}`
- [ ] Or start the Cloudflare tunnel: `node start-cloudflare-tunnel.js`
- [ ] Update `EXPO_PUBLIC_BACKEND_URL` in a `.env` file if using tunnel
- [ ] Verify `data/local-db.json` exists (for offline fallback)
- [ ] Test login with both test accounts before going outdoors

---

## NOT VERIFIED (requires live environment)
- Render.com PostgreSQL database schema (tables may need migration)
- Actual network latency to Render from device
- Two-device multiplayer territory conflict resolution
- Push notification delivery to real device
