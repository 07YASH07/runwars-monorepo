# StrideClash — Database Repair Report

**Date:** 2026-11-09
**Scope:** PostgreSQL production connection restoration for `https://runwars-v2.onrender.com`

---

## 1. Root Cause

**The Supabase project `eoeiohzjbnpbkfnkcywq` (region `ap-southeast-1`) no longer exists** — it was either deleted or the reference is stale. This cannot be fixed from code alone.

Evidence:

| Check | Result | Meaning |
|---|---|---|
| DNS: `aws-1-ap-southeast-1.pooler.supabase.com` | Resolves to `13.213.241.248` | Supabase's shared pooler is reachable |
| DNS: `db.eoeiohzjbnpbkfnkcywq.supabase.co` | **NXDOMAIN** | Direct DB hostname does not exist |
| Pooler login as `postgres.eoeiohzjbnpbkfnkcywq` | **`XX000 tenant/user ... not found`** | Pooler tenant registry has no record of this project |
| Error reported by Render | `ENOTFOUND postgres.eoeiohzjbnpbkfnkcywq` | Render tried to connect to a hostname that doesn't exist |

A paused project typically returns a different Supavisor error (`project paused`) and keeps the direct hostname resolvable. A missing direct hostname + "tenant not found" on the pooler is the signature of a **deleted or non-existent** project.

### Secondary configuration issue identified

The error hostname `postgres.eoeiohzjbnpbkfnkcywq` is the **Supabase pooler USERNAME**, not a hostname. Even if the project existed, that string would never be a valid hostname — this confirms the Render `DATABASE_URL` was constructed incorrectly at some point (the username was pasted into the host position). The local `.env` has the correct pooler URL format; Render's does not.

---

## 2. Incorrect Configuration Identified

### 2a. `apps/backend/src/server.ts` (previous Pool creation — fixed)

```ts
// BEFORE
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/runwars',
});
```

Problems:
- No `ssl` — Supabase pooler enforces TLS; the `pg` driver will warn/fail
- No `connectionTimeoutMillis` — a slow DNS failure hangs forever
- No periodic re-probe — a one-time `pool.connect()` sets a flag once, never updates it
- `isDbConnected` was set at startup only; if the DB came back online, the server never knew

### 2b. `apps/backend/src/db/index.ts` (fixed)

```ts
// BEFORE
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);  // ← kills the process on any idle-client error
});
```

Any transient network blip on an idle pooled client would crash the Node process.

### 2c. `/health` endpoint (fixed)

```ts
// BEFORE
db: pool.totalCount > 0 ? 'connected' : 'disconnected',
```

`pool.totalCount` is the number of clients the pool has ever created — not whether any are alive. This can report "connected" during an outage.

### 2d. Local JSON fallback behavior

The server previously printed `"Running in resilient local mode"` to its own log, but:
- `/health` could still return `status: "ok"`
- Clients had no way to know their data wasn't being persisted to the authoritative DB

---

## 3. Corrected Connection Method (code applied)

File: `apps/backend/src/server.ts` — the Pool is now:

```ts
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/runwars';
const requiresSsl = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});
```

Live state replaces the one-shot flag:

```ts
let isDbConnected = false;      // kept as `let`, updated by probeDb
let dbLastError: string | null = null;
let dbLastCheckedAt = 0;
```

A `probeDb()` helper runs `SELECT 1` with a 5 s race-against-timeout, a bounded exponential backoff on startup (`2s → 4s → 8s → 16s → 30s → 30s`), and a 60 s periodic re-probe so the server **recovers automatically when the DB comes back**.

Error output is redacted — the `redactUrl()` helper strips `postgres://user:pass@` prefixes from all logged messages.

Pool error handler no longer calls `process.exit`:

```ts
pool.on('error', (err) => {
  isDbConnected = false;
  dbLastError = redactUrl(err.message);
  console.error('[Database] pool error:', dbLastError);
});
```

Same hardening applied to `apps/backend/src/db/index.ts` and `apps/backend/src/db/migrate-db.ts` so `npm run migrate` works against Supabase.

### Honest `/health`

```ts
app.get('/health', async (req, res) => {
  if (Date.now() - dbLastCheckedAt > 15000) await probeDb(3000).catch(() => {});
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
```

HTTP 503 when degraded. The `persistence` field tells clients explicitly whether they're hitting the authoritative DB or the local fallback.

---

## 4. Database Connection Test Results

Tested against the local `.env` (correct pooler URL format):

```
CONNECT FAILED: XX000 - (ENOTFOUND) tenant/user postgres.eoeiohzjbnpbkfnkcywq not found
```

**Tables could not be verified against the production DB — the Supabase project is not reachable because it does not exist.**

Expected schema (from `apps/backend/src/db/schema.sql` + migrate-v2/v3/v4):

| Required table | Source migration |
|---|---|
| `users` | `schema.sql` |
| `runs` | `schema.sql` |
| `territories` | `schema.sql` |
| `posts` | `migrate-v2.sql` |
| `comments` | `migrate-v2.sql` |
| `likes` | `migrate-v2.sql` |
| `followers` | `migrate-v2.sql` / `v3.sql` |
| `arena_wallets` / coin columns | `migrate-v3.sql` |
| `push_log` / Phase-4 tables | `migrate-v4.sql` |

These must be re-created on a new Supabase project via `npm run migrate` (see Step 7).

---

## 5. Endpoint Verification (live production)

Tested against `https://runwars-v2.onrender.com`:

| Endpoint | HTTP | Result |
|---|---|---|
| `GET /health` | 200 (**before fix**) | `{"status":"ok","db":"disconnected"}` — dishonestly reports OK |
| `GET /territories` | 200 | `[]` (local fallback) |
| `GET /leaderboard` | 200 | `{"error":"Failed to load leaderboard"}` |
| `GET /api/community/nearby` | **500** | DB required, no fallback |
| `GET /api/feed` | **500** | DB required, no fallback |
| `GET /api/profile/:id` | **500** | DB required, no fallback |
| `GET /runs/:id` | **500** | DB required, no fallback |
| `POST /api/auth/login` | 200 (error payload) | `(ENOTFOUND) tenant/user postgres.eoeiohzjbnpbkfnkcywq not found` |
| `POST /api/auth/register` | **500** | DB required, no fallback |

**After deploying the fixed backend**, `/health` will correctly return HTTP 503 and `db:"disconnected"` until a valid `DATABASE_URL` is set on Render. Local verification of the fixed code with a deliberately-bad URL:

```
curl http://127.0.0.1:3099/health
HTTP 503
{
  "status": "degraded",
  "db": "disconnected",
  "persistence": "local_json_fallback",
  "dbError": "getaddrinfo ENOTFOUND nosuchhost.invalid",
  "checkedAt": "..."
}
```

---

## 6. Render Deployment Result

**Not deployed.** Deployment requires Render dashboard access that I do not have. The repository changes are committed in the local working tree only; see "Remaining blockers" for the manual steps.

---

## 7. Data Integrity Verification

- **No destructive migrations run.** `schema.sql` already uses `CREATE TABLE IF NOT EXISTS` — safe to re-apply.
- **Local JSON fallback contains real user data** at `data/local-db.json`: **9 users, 4 runs, 1 post** (loaded at server startup). This is the only surviving copy of recent activity.
- When the new Supabase project is created, this data should be migrated with a separate one-off script that reads `data/local-db.json` and inserts rows via the standard API. Do **not** restore it by dropping and recreating tables.

---

## 8. Remaining Blockers (manual steps required)

### Step A — Verify or recreate the Supabase project

1. Open <https://supabase.com/dashboard>.
2. Search projects for the reference `eoeiohzjbnpbkfnkcywq`:
   - If it appears **paused**: click → Resume. Re-test with `psql` or the probe below.
   - If it is **deleted or missing**: create a new project. Note the new **project reference** and **region** (recommend `ap-southeast-1` to match current routing, or whichever is closest to your Render region).
3. In the new project → **Project Settings → Database → Connection string → "Session pooler"** (IPv4-compatible for Render). Copy that string — it will look like:
   ```
   postgresql://postgres.<NEW_REF>:<PASSWORD>@aws-1-<REGION>.pooler.supabase.com:5432/postgres
   ```
   The **hostname** is `aws-1-<region>.pooler.supabase.com`. The **username** is `postgres.<project_ref>`. These are two different fields — do not paste the username into the host slot (that was the original bug).

### Step B — Run migrations against the new DB

Locally, on your machine:

```powershell
# Set only in this shell session, not committed
$env:DATABASE_URL = "<paste the full pooler URL here>"
cd C:\Users\Dell\.gemini\antigravity\scratch\runwars\apps\backend
npm run build
npm run migrate
# then apply the v2/v3/v4 patches:
npx ts-node src/db/migrate-v2.ts
npx ts-node src/db/migrate-v3.ts
npx ts-node src/db/migrate-v4.ts
```

The migrate scripts now use TLS (fix applied). Watch for `🎉 Database migrations completed successfully`.

### Step C — Update Render's environment variable

1. Open <https://dashboard.render.com> → the `runwars-v2` service → **Environment**.
2. Edit `DATABASE_URL` to the **session-pooler connection string** from Step A.
3. Click **Save, Rebuild & Deploy**.
4. Do **not** commit the new URL to Git. Confirm no `.env` with a real password is tracked:
   ```
   git status apps/backend/.env
   ```
   should show it as untracked or ignored.

### Step D — Verify deployment

After Render reports a successful deploy and the service is live:

```bash
curl -s https://runwars-v2.onrender.com/health
```

Expected (healthy):
```json
{
  "status": "ok",
  "db": "connected",
  "persistence": "authoritative_postgres",
  ...
}
```

Then exercise the endpoints:

```bash
BASE=https://runwars-v2.onrender.com
# Register a disposable test account (use a throwaway email)
curl -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"dbcheck+<timestamp>@strideclash.test","password":"TestOnlyChangeMe!","displayName":"DBCheck"}'
# Login
curl -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"dbcheck+<timestamp>@strideclash.test","password":"TestOnlyChangeMe!"}'
# Fetch public endpoints
curl "$BASE/territories"
curl "$BASE/leaderboard?activityType=run&range=week"
```

### Step E — Restart & persist check

Trigger one more deploy (or "Restart Service" on Render) after creating the test user. Re-fetch `/api/profile/<user_id>` — a row returned from the DB confirms writes were persisted across process restarts.

### Step F — Optional: migrate the 9 local-JSON users

If you want to preserve the 9 users and 4 runs sitting in `data/local-db.json`, write a one-off script that:
1. Reads `data/local-db.json`
2. For each user, inserts into `users` via `INSERT ... ON CONFLICT (id) DO NOTHING`
3. For each run, inserts into `runs`

I can prepare that script on request — flagged separately so it doesn't ship with the server.

---

## Final acceptance criteria — status

| Criterion | Status |
|---|---|
| Backend code uses SSL and proper Pool config | ✅ Done |
| Health endpoint tells the truth | ✅ Done (503 + `persistence: local_json_fallback` when DB is down) |
| Retry with bounded exponential backoff | ✅ Done |
| No `process.exit` on idle DB errors | ✅ Done |
| Secrets redacted from logs | ✅ Done |
| Local backend verified in degraded mode | ✅ Done |
| Supabase project connects | ❌ **Blocked** — project does not exist, needs manual recreation |
| Render `DATABASE_URL` corrected | ❌ **Blocked** — requires Render dashboard access |
| Production `/health` shows `db: connected` | ❌ **Blocked by the above two** |
| Restart-persists test | ❌ **Blocked by the above two** |

**No deployment success is being claimed.** The code is production-ready the moment a valid `DATABASE_URL` is provided and the service is redeployed.
