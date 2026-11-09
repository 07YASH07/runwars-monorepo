# StrideClash — Local JSON ↔ PostgreSQL Schema Mapping

**Source:** `data/local-db.json` (served by `apps/backend/src/localStore.ts`)
**Target:** PostgreSQL defined by `apps/backend/src/db/schema.sql` + `migrate-v2.sql` + `migrate-v3.sql` + `migrate-v4.sql` + `migrate-v5.sql`

This document enumerates **exactly** which source fields map to which destination columns, which entities are migrated, and which ones are intentionally dropped.

## Top-level JSON structure

```jsonc
{
  "users":        [LocalUser,       ...],   // 9 records in current snapshot
  "runs":         [LocalRun,        ...],   // 4 records
  "posts":        [LocalPost,       ...],   // 1 record  (an announcement)
  "territories":  [LocalTerritory,  ...],   // 0 records
  "followers":    [LocalFollower,   ...]    // 0 records
}
```

Entities **not** present in either source or destination (as of this migration):

- Battles, Arena Wallets, Coin Transactions — no dedicated tables; wallet balance is the single `users.coins` column.
- Leaderboards — derived from `runs`, not stored.
- Notifications — only `users.expo_push_token` is persisted; delivery log is in-memory.
- Territory ownership history — not modelled; current owner only.
- GPS points — stored as JSONB inside `runs.route_points`, not a separate table.

## Field-by-field mapping

### 1. `users` → `users` (identity preserved)

| JSON field | SQL column | Notes |
|---|---|---|
| `id` | `id` (VARCHAR(128) PK) | **Preserved verbatim.** `ON CONFLICT (id) DO NOTHING` protects any newer production copy. |
| `email` | `email` | passed through |
| `display_name` | `display_name` | |
| `character_type` | `character_type` | |
| `color` | `color` | |
| `password_hash` | `password_hash` | **Requires `migrate-v5.sql` — column not declared in earlier migrations.** Script refuses to run if the column is missing. |
| `coins` | `coins` | |
| `bio` | `bio` | |
| `avatar_url` | `avatar_url` | |
| `cover_image_url` | `cover_image_url` | |
| `expo_push_token` | `expo_push_token` | Written if present in source, otherwise NULL. |
| `created_at` | `created_at` | `COALESCE(source, NOW())` |
| _(absent)_ | `selected_avatar` | Uses DB default `'🏃'`. |
| _(absent)_ | `unlocked_avatars` | Uses DB default `{'⚔️','🥷','🧙','🏃'}`. |
| _(absent)_ | `unlocked_colors` | Uses DB default `{'#FF4D4D','#1E90FF'}`. |

### 2. `runs` → `runs` (new serial IDs assigned)

| JSON field | SQL column | Notes |
|---|---|---|
| `id` (INT, local counter) | _not inserted_ | SQL uses `SERIAL`; original source id is kept in `_migration_ledger` so re-runs don't duplicate. |
| `user_id` | `user_id` | FK-validated against `users` before insert. |
| `route_points` | `route_points` | Written as JSONB. Each point: `{latitude, longitude, timestamp}`. |
| `distance_meters` | `distance_meters` | passed through |
| `activity_type` | `activity_type` | default `'run'` if missing |
| `created_at` | `created_at` | `COALESCE(source, NOW())` |

### 3. `posts` → `announcements` **OR** `posts` (split by `post_type`)

The announcement in the current snapshot (`id: "ann_welcome"`, `post_type: "announcement"`, has `title`) is a better fit for `announcements` which has native `title`+`body`+`created_by` columns. User-authored posts (none in snapshot) go to `posts`.

**For announcements:**

| JSON field | SQL column (`announcements`) | Notes |
|---|---|---|
| `id` (STRING) | _not inserted_ | SQL id is SERIAL; original tracked in ledger. |
| `title` | `title` | |
| `content` | `body` | renamed |
| `user_id` | `created_by` | renamed |
| `created_at` | `created_at` | `COALESCE(source, NOW())` |
| `display_name`, `character_type`, `color` | _dropped_ | Denormalized snapshot. Joined from `users` at query time. |
| `image_url`, `post_type`, `related_id`, `likes_count`, `comments_count` | _dropped_ | `announcements` table has no equivalent columns. Count fields were denormalized caches with no corresponding rows anyway. |

**For user posts (if any):**

| JSON field | SQL column (`posts`) | Notes |
|---|---|---|
| `id` (STRING) | _not inserted_ | SQL id is SERIAL; original tracked in ledger. |
| `user_id` | `user_id` | FK-validated. |
| `content` | `content` | |
| `image_url` | `image_url` | |
| `post_type` | `post_type` | default `'user'` |
| `related_id` | `related_id` | |
| `created_at` | `created_at` | |
| `title`, `display_name`, `character_type`, `color`, `likes_count`, `comments_count` | _dropped_ | Not columns on `posts`. |

### 4. `territories` → `territories` (identity preserved)

Zero records in current snapshot. Mapping defined for future use:

| JSON field | SQL column | Notes |
|---|---|---|
| `id` | `id` | preserved |
| `userId` / `ownerId` | `owner_id` | FK-validated |
| `polygonCoordinates` | `polygon_coordinates` | JSONB |
| `areaSquareMeters` | `area_square_meters` | |
| `color` | `color` | |
| `runSessionId` | `run_session_id` | |
| `avgSpeedKmh` | `avg_speed_kmh` | |
| `activityType` | `activity_type` | default `'run'` |
| `claimedAt` | `claimed_at` | |

### 5. `followers` → `followers`

Zero records in current snapshot. Mapping:

| JSON field | SQL column | Notes |
|---|---|---|
| `follower_id` | `follower_id` | FK-validated |
| `following_id` | `following_id` | FK-validated |
| _(absent)_ | `created_at` | `DEFAULT NOW()` |

`UNIQUE(follower_id, following_id)` on the destination gives natural idempotency in addition to the ledger.

## Ledger table

Created automatically by the script:

```sql
CREATE TABLE IF NOT EXISTS _migration_ledger (
  source_type VARCHAR(64) NOT NULL,     -- 'local_json_user', 'local_json_run',
                                        -- 'local_json_announcement', 'local_json_post',
                                        -- 'local_json_territory', 'local_json_follower'
  source_id   VARCHAR(255) NOT NULL,    -- source record id, stringified
  dest_table  VARCHAR(64) NOT NULL,
  dest_id     VARCHAR(255) NOT NULL,    -- target row id (preserved or newly-assigned)
  source_hash VARCHAR(64),              -- SHA-256 of the source record (drift detection)
  migrated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (source_type, source_id)
);
```

Every re-run checks the ledger before every row and skips entries already recorded.
