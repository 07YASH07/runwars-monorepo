/**
 * migrate-local-db.ts — StrideClash local JSON → PostgreSQL migration.
 *
 * Safety contract:
 *   - Dry-run by default; --execute required to write anything.
 *   - Source JSON file is never modified. A timestamped backup is written
 *     to data/backups/ before any execution.
 *   - Idempotent via a dedicated `_migration_ledger` table that records
 *     (source_type, source_id) → (dest_table, dest_id). Re-running skips
 *     rows already migrated.
 *   - All DB writes happen inside a single transaction with ROLLBACK on
 *     any error.
 *   - Credentials are redacted from all log output.
 *
 * Usage:
 *   npm run migrate:local -- --dry-run         (default; no writes)
 *   npm run migrate:local -- --execute         (actually migrate)
 *   npm run migrate:local -- --execute --yes   (skip interactive confirmation)
 *   npm run migrate:local -- --source=path.json --db-url=postgres://...
 *
 * The script exits non-zero on any failure, missing schema, or blocked
 * preflight check.
 */

import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import dotenv from 'dotenv';

// Load .env from apps/backend/.env regardless of invocation cwd
dotenv.config({ path: path.join(__dirname, '../.env') });

// ──────────────────────────────────────────────────────────────────────
// CLI parsing
// ──────────────────────────────────────────────────────────────────────

function parseFlags(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else flags[arg.slice(2)] = true;
    }
  }
  return flags;
}

const flags = parseFlags(process.argv);
const EXECUTE = flags.execute === true;
const DRY_RUN = !EXECUTE; // default is dry-run
const AUTO_YES = flags.yes === true;
const BATCH_SIZE = typeof flags['batch-size'] === 'string' ? parseInt(flags['batch-size'] as string, 10) : 100;

const DEFAULT_SOURCE = path.join(__dirname, '../../../data/local-db.json');
const SOURCE = typeof flags.source === 'string' ? (flags.source as string) : DEFAULT_SOURCE;

const DATABASE_URL = (typeof flags['db-url'] === 'string' ? (flags['db-url'] as string) : process.env.DATABASE_URL) || '';

const REPORT_PATH = path.resolve(__dirname, '../../../LOCAL_DB_MIGRATION_REPORT.md');
const BACKUP_DIR = path.join(path.dirname(SOURCE), 'backups');
const MERGE_MAP_PATH = typeof flags['user-merge'] === 'string'
  ? (flags['user-merge'] as string)
  : path.join(__dirname, 'user-merge-map.json');

// ──────────────────────────────────────────────────────────────────────
// Logging + secret redaction
// ──────────────────────────────────────────────────────────────────────

function redact(msg: string): string {
  return String(msg).replace(/postgres(ql)?:\/\/[^@\s]+@/gi, 'postgres://***@');
}

function log(msg: string) {
  console.log(redact(msg));
}

function err(msg: string) {
  console.error(redact(msg));
}

// ──────────────────────────────────────────────────────────────────────
// Report builder
// ──────────────────────────────────────────────────────────────────────

interface ReportState {
  startedAt: string;
  finishedAt: string | null;
  mode: 'dry-run' | 'execute';
  source: string;
  sourceSha256: string;
  backupPath: string | null;
  preflight: {
    db_reachable: boolean;
    db_error: string | null;
    tables_found: string[];
    tables_missing: string[];
    columns_missing: { table: string; column: string }[];
  };
  sourceCounts: Record<string, number>;
  planned: Record<string, { toInsert: number; alreadyMigrated: number; rejected: number; remapped?: number }>;
  executed: Record<string, { inserted: number; skipped: number; rejected: number; remapped?: number }>;
  merge: { mapSize: number; entries: { source: string; target: string }[]; fkRedirects: Record<string, { source: string; target: string; count: number }[]> };
  rejectedRecords: { kind: string; sourceId: string; reason: string }[];
  destinationCountsAfter: Record<string, number> | null;
  success: boolean;
  errorMessage: string | null;
}

interface PlanStats { toInsert: number; alreadyMigrated: number; rejected: number; remapped?: number; }

const report: ReportState = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  mode: EXECUTE ? 'execute' : 'dry-run',
  source: SOURCE,
  sourceSha256: '',
  backupPath: null,
  preflight: { db_reachable: false, db_error: null, tables_found: [], tables_missing: [], columns_missing: [] },
  sourceCounts: {},
  planned: {},
  executed: {},
  rejectedRecords: [],
  destinationCountsAfter: null,
  success: false,
  errorMessage: null,
  merge: { mapSize: 0, entries: [], fkRedirects: {} },
};

function writeReport() {
  report.finishedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push('# StrideClash — Local JSON → PostgreSQL Migration Report');
  lines.push('');
  lines.push(`- Mode: **${report.mode}**`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Source: \`${report.source}\``);
  lines.push(`- Source SHA-256: \`${report.sourceSha256}\``);
  lines.push(`- Backup: ${report.backupPath ? '`' + report.backupPath + '`' : '_(none — dry-run)_'}`);
  lines.push(`- Result: ${report.success ? '✅ success' : '❌ failed'}`);
  if (report.errorMessage) lines.push(`- Error: \`${report.errorMessage}\``);
  lines.push('');

  lines.push('## Preflight');
  lines.push(`- DB reachable: ${report.preflight.db_reachable ? '✅' : '❌'}`);
  if (report.preflight.db_error) lines.push(`- DB error: \`${report.preflight.db_error}\``);
  lines.push(`- Tables found: ${report.preflight.tables_found.join(', ') || '_none_'}`);
  if (report.preflight.tables_missing.length) {
    lines.push(`- **Tables MISSING**: ${report.preflight.tables_missing.join(', ')}`);
  }
  if (report.preflight.columns_missing.length) {
    lines.push('- **Columns MISSING**:');
    for (const c of report.preflight.columns_missing) {
      lines.push(`  - \`${c.table}.${c.column}\``);
    }
  }
  lines.push('');

  lines.push('## Source record counts');
  for (const [k, v] of Object.entries(report.sourceCounts)) {
    lines.push(`- \`${k}\`: ${v}`);
  }
  lines.push('');

  if (report.merge.entries.length) {
    lines.push('## Merge plan (user account consolidation)');
    lines.push('| Source id (local JSON) | → | Target id (production) |');
    lines.push('|---|---|---|');
    for (const e of report.merge.entries) lines.push(`| \`${e.source}\` | → | \`${e.target}\` |`);
    lines.push('');
    if (Object.keys(report.merge.fkRedirects).length) {
      lines.push('### FK references redirected');
      lines.push('| Entity | Source user | → | Target user | Rows affected |');
      lines.push('|---|---|---|---|---:|');
      for (const [entity, rows] of Object.entries(report.merge.fkRedirects)) {
        for (const r of rows) lines.push(`| ${entity} | \`${r.source}\` | → | \`${r.target}\` | ${r.count} |`);
      }
      lines.push('');
    }
    lines.push('Source users listed above are **not inserted** as separate rows. Their FK references are redirected above; the ledger records the mapping so re-runs are idempotent.');
    lines.push('');
  }

  if (Object.keys(report.planned).length) {
    lines.push('## Plan');
    lines.push('| Entity | To insert | Remapped | Already migrated | Rejected |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const [k, v] of Object.entries(report.planned)) {
      lines.push(`| ${k} | ${v.toInsert} | ${v.remapped ?? 0} | ${v.alreadyMigrated} | ${v.rejected} |`);
    }
    lines.push('');
  }

  if (Object.keys(report.executed).length) {
    lines.push('## Execution');
    lines.push('| Entity | Inserted | Remapped | Skipped (ledger) | Rejected |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const [k, v] of Object.entries(report.executed)) {
      lines.push(`| ${k} | ${v.inserted} | ${v.remapped ?? 0} | ${v.skipped} | ${v.rejected} |`);
    }
    lines.push('');
  }

  if (report.destinationCountsAfter) {
    lines.push('## Destination counts after migration');
    for (const [k, v] of Object.entries(report.destinationCountsAfter)) {
      lines.push(`- \`${k}\`: ${v}`);
    }
    lines.push('');
  }

  if (report.rejectedRecords.length) {
    lines.push('## Rejected records');
    for (const r of report.rejectedRecords) {
      lines.push(`- \`${r.kind}/${r.sourceId}\`: ${r.reason}`);
    }
    lines.push('');
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  log(`[report] written to ${REPORT_PATH}`);
}

// ──────────────────────────────────────────────────────────────────────
// Source loading + backup
// ──────────────────────────────────────────────────────────────────────

interface LocalUser {
  id: string;
  email?: string;
  display_name?: string;
  character_type?: string;
  color?: string;
  password_hash?: string;
  coins?: number;
  bio?: string;
  avatar_url?: string;
  cover_image_url?: string;
  expo_push_token?: string;
  created_at?: string;
}

interface LocalRun {
  id: number;
  user_id: string;
  route_points: unknown[];
  distance_meters: number;
  activity_type?: string;
  created_at?: string;
}

interface LocalPost {
  id: string;
  user_id: string;
  title?: string;
  content: string;
  image_url?: string | null;
  post_type?: string;
  related_id?: string | null;
  created_at?: string;
}

interface LocalTerritory {
  id: string;
  userId?: string;
  ownerId?: string;
  polygonCoordinates?: unknown[];
  areaSquareMeters?: number;
  color?: string;
  runSessionId?: string;
  avgSpeedKmh?: number;
  activityType?: string;
  claimedAt?: string;
}

interface LocalFollower {
  follower_id: string;
  following_id: string;
}

interface LocalDb {
  users?: LocalUser[];
  runs?: LocalRun[];
  posts?: LocalPost[];
  territories?: LocalTerritory[];
  followers?: LocalFollower[];
}

function loadSource(): { raw: Buffer; parsed: LocalDb; sha256: string } {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`source file not found: ${SOURCE}`);
  }
  const raw = fs.readFileSync(SOURCE);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  let parsed: LocalDb;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (e: any) {
    throw new Error(`source JSON is malformed: ${e.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('source JSON must be an object');
  }
  return { raw, parsed, sha256 };
}

function backupSource(raw: Buffer, sha256: string): string {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `local-db.${stamp}.${sha256.slice(0, 12)}.json`);
  fs.writeFileSync(target, raw);
  return target;
}

// ──────────────────────────────────────────────────────────────────────
// DB preflight
// ──────────────────────────────────────────────────────────────────────

const REQUIRED_TABLES = [
  'users',
  'runs',
  'territories',
  'posts',
  'likes',
  'comments',
  'announcements',
  'followers',
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  users: ['id', 'email', 'display_name', 'character_type', 'color', 'password_hash', 'coins', 'bio', 'created_at'],
  runs: ['id', 'user_id', 'route_points', 'distance_meters', 'activity_type', 'created_at'],
  announcements: ['id', 'title', 'body', 'created_by', 'created_at'],
};

async function preflight(client: PoolClient): Promise<void> {
  const tableRows = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
  );
  const tablesFound = tableRows.rows.map((r: { table_name: string }) => r.table_name);
  report.preflight.tables_found = tablesFound.sort();

  const missing = REQUIRED_TABLES.filter((t) => !tablesFound.includes(t));
  report.preflight.tables_missing = missing;

  if (missing.length) {
    throw new Error(
      `missing required tables: ${missing.join(', ')}. ` +
        `Run the schema migrations first: npm run migrate && apply migrate-v2.sql..migrate-v5.sql`
    );
  }

  for (const [tbl, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const colRows = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [tbl]
    );
    const colsFound = colRows.rows.map((r: { column_name: string }) => r.column_name);
    for (const c of cols) {
      if (!colsFound.includes(c)) report.preflight.columns_missing.push({ table: tbl, column: c });
    }
  }

  if (report.preflight.columns_missing.length) {
    const alters = report.preflight.columns_missing
      .map((c) => `  ALTER TABLE ${c.table} ADD COLUMN IF NOT EXISTS ${c.column} <TYPE>;`)
      .join('\n');
    throw new Error(
      `destination schema is missing required columns:\n${alters}\n` +
        `For password_hash specifically, apply apps/backend/src/db/migrate-v5.sql.`
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// Ledger
// ──────────────────────────────────────────────────────────────────────

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS _migration_ledger (
  source_type VARCHAR(64) NOT NULL,
  source_id   VARCHAR(255) NOT NULL,
  dest_table  VARCHAR(64) NOT NULL,
  dest_id     VARCHAR(255) NOT NULL,
  source_hash VARCHAR(64),
  migrated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (source_type, source_id)
);
`;

async function ensureLedger(client: PoolClient) {
  await client.query(LEDGER_DDL);
}

async function isMigrated(client: PoolClient, sourceType: string, sourceId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM _migration_ledger WHERE source_type=$1 AND source_id=$2`,
    [sourceType, sourceId]
  );
  return r.rowCount != null && r.rowCount > 0;
}

// Set of user IDs considered "known" for FK validation: everything already in
// the destination `users` table PLUS every valid user in the source JSON.
// Populated once in main() after preflight. Checking this set instead of
// running SELECT per row makes dry-run match --execute behaviour (in --execute
// the users are inserted inside the same transaction, so a per-row DB check
// would also succeed — but in dry-run that insert is rolled back, which is
// why the raw SELECT previously produced false FK rejections).
const knownUserIds = new Set<string>();

// User account consolidation. Source id -> target production id.
// Loaded from scripts/user-merge-map.json (or --user-merge=<path>).
// A source user listed here is NOT inserted; its FK references (runs, posts,
// territories, followers) are redirected onto the target id. The ledger still
// records the mapping so re-runs are idempotent.
let userMergeMap: Record<string, string> = {};
function resolveUserId(id: string | null | undefined): string | null | undefined {
  if (id && userMergeMap[id]) return userMergeMap[id];
  return id;
}

async function recordLedger(
  client: PoolClient,
  sourceType: string,
  sourceId: string,
  destTable: string,
  destId: string,
  record: unknown
) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(record))
    .digest('hex');
  await client.query(
    `INSERT INTO _migration_ledger (source_type, source_id, dest_table, dest_id, source_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_type, source_id) DO NOTHING`,
    [sourceType, sourceId, destTable, destId, hash]
  );
}

// ──────────────────────────────────────────────────────────────────────
// Entity migration
// ──────────────────────────────────────────────────────────────────────

function recordRejected(kind: string, sourceId: string, reason: string) {
  report.rejectedRecords.push({ kind, sourceId, reason });
}

async function migrateUsers(client: PoolClient, users: LocalUser[], planOnly: boolean) {
  const stats: PlanStats = { toInsert: 0, alreadyMigrated: 0, rejected: 0, remapped: 0 };
  let inserted = 0;
  let skipped = 0;
  let remappedExecuted = 0;

  for (const u of users) {
    if (!u.id) {
      stats.rejected++;
      recordRejected('user', '(no id)', 'missing id');
      continue;
    }
    if (await isMigrated(client, 'local_json_user', u.id)) {
      stats.alreadyMigrated++;
      skipped++;
      continue;
    }

    const mergeTarget = userMergeMap[u.id];
    if (mergeTarget) {
      // Consolidation path: do not insert this user. Only record a ledger
      // entry so re-runs are idempotent. FK references to u.id elsewhere in
      // the source are rewritten to mergeTarget at their own insert sites.
      stats.remapped = (stats.remapped || 0) + 1;
      if (planOnly) continue;
      await recordLedger(client, 'local_json_user', u.id, 'users', mergeTarget, { ...u, _remappedTo: mergeTarget });
      remappedExecuted++;
      continue;
    }

    stats.toInsert++;
    if (planOnly) continue;

    // INSERT ... ON CONFLICT (id) DO NOTHING so if a user with the same id
    // already exists in production (via some other path), we preserve the
    // production copy and only record the ledger entry.
    const res = await client.query(
      `INSERT INTO users
         (id, email, display_name, character_type, color, password_hash, coins, bio,
          avatar_url, cover_image_url, expo_push_token, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, NOW()))
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        u.id,
        u.email ?? null,
        u.display_name ?? null,
        u.character_type ?? null,
        u.color ?? null,
        u.password_hash ?? null,
        u.coins ?? null,
        u.bio ?? null,
        u.avatar_url ?? null,
        u.cover_image_url ?? null,
        u.expo_push_token ?? null,
        u.created_at ?? null,
      ]
    );
    inserted += res.rowCount || 0;
    await recordLedger(client, 'local_json_user', u.id, 'users', u.id, u);
  }

  const key = 'users';
  report.planned[key] = stats;
  if (!planOnly) report.executed[key] = { inserted, skipped, rejected: stats.rejected, remapped: remappedExecuted };
}

function trackRedirect(entity: string, sourceUserId: string, targetUserId: string) {
  if (sourceUserId === targetUserId) return;
  if (!report.merge.fkRedirects[entity]) report.merge.fkRedirects[entity] = [];
  const existing = report.merge.fkRedirects[entity].find((r) => r.source === sourceUserId && r.target === targetUserId);
  if (existing) existing.count++;
  else report.merge.fkRedirects[entity].push({ source: sourceUserId, target: targetUserId, count: 1 });
}

async function migrateRuns(client: PoolClient, runs: LocalRun[], planOnly: boolean) {
  const stats = { toInsert: 0, alreadyMigrated: 0, rejected: 0 };
  let inserted = 0;
  let skipped = 0;

  for (const r of runs) {
    if (r.id == null || !r.user_id) {
      stats.rejected++;
      recordRejected('run', String(r.id ?? '(no id)'), 'missing id or user_id');
      continue;
    }
    const sid = String(r.id);
    if (await isMigrated(client, 'local_json_run', sid)) {
      stats.alreadyMigrated++;
      skipped++;
      continue;
    }

    // FK validation against the pre-computed known-user set (DB-existing +
    // source-planned). See definition of knownUserIds above.
    if (!knownUserIds.has(r.user_id)) {
      stats.rejected++;
      recordRejected('run', sid, `foreign key violation: user_id ${r.user_id} not in users`);
      continue;
    }

    // Apply user-merge map before insert so this row is re-parented onto the
    // canonical production user.
    const resolvedUserId = resolveUserId(r.user_id) as string;
    trackRedirect('runs', r.user_id, resolvedUserId);

    stats.toInsert++;
    if (planOnly) continue;

    const res = await client.query(
      `INSERT INTO runs (user_id, route_points, distance_meters, activity_type, created_at)
       VALUES ($1, $2::jsonb, $3, $4, COALESCE($5, NOW()))
       RETURNING id`,
      [
        resolvedUserId,
        JSON.stringify(r.route_points ?? []),
        r.distance_meters ?? 0,
        r.activity_type ?? 'run',
        r.created_at ?? null,
      ]
    );
    const newId = String(res.rows[0]?.id);
    inserted++;
    await recordLedger(client, 'local_json_run', sid, 'runs', newId, r);
  }

  const key = 'runs';
  report.planned[key] = stats;
  if (!planOnly) report.executed[key] = { inserted, skipped, rejected: stats.rejected };
}

async function migrateTerritories(client: PoolClient, territories: LocalTerritory[], planOnly: boolean) {
  const stats = { toInsert: 0, alreadyMigrated: 0, rejected: 0 };
  let inserted = 0;
  let skipped = 0;

  for (const t of territories) {
    if (!t.id) {
      stats.rejected++;
      recordRejected('territory', '(no id)', 'missing id');
      continue;
    }
    const ownerId = t.ownerId ?? t.userId ?? null;
    if (!ownerId) {
      stats.rejected++;
      recordRejected('territory', t.id, 'missing ownerId/userId');
      continue;
    }
    if (await isMigrated(client, 'local_json_territory', t.id)) {
      stats.alreadyMigrated++;
      skipped++;
      continue;
    }
    if (!knownUserIds.has(ownerId)) {
      stats.rejected++;
      recordRejected('territory', t.id, `foreign key violation: owner_id ${ownerId} not in users`);
      continue;
    }

    const resolvedOwnerId = resolveUserId(ownerId) as string;
    trackRedirect('territories', ownerId, resolvedOwnerId);

    stats.toInsert++;
    if (planOnly) continue;

    await client.query(
      `INSERT INTO territories
         (id, owner_id, polygon_coordinates, area_square_meters, color, run_session_id,
          avg_speed_kmh, activity_type, claimed_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, COALESCE($9, NOW()))
       ON CONFLICT (id) DO NOTHING`,
      [
        t.id,
        resolvedOwnerId,
        JSON.stringify(t.polygonCoordinates ?? []),
        t.areaSquareMeters ?? 0,
        t.color ?? null,
        t.runSessionId ?? null,
        t.avgSpeedKmh ?? 0,
        t.activityType ?? 'run',
        t.claimedAt ?? null,
      ]
    );
    inserted++;
    await recordLedger(client, 'local_json_territory', t.id, 'territories', t.id, t);
  }

  const key = 'territories';
  report.planned[key] = stats;
  if (!planOnly) report.executed[key] = { inserted, skipped, rejected: stats.rejected };
}

async function migratePosts(client: PoolClient, posts: LocalPost[], planOnly: boolean) {
  // Announcements (post_type='announcement' with title) go to the
  // `announcements` table since it has native `title`+`body`+`created_by`.
  // User-authored posts go to the `posts` table, which uses SERIAL ids —
  // the source string id is tracked in the ledger so re-runs don't duplicate.
  const annStats = { toInsert: 0, alreadyMigrated: 0, rejected: 0 };
  const postStats = { toInsert: 0, alreadyMigrated: 0, rejected: 0 };
  let annInserted = 0;
  let postInserted = 0;
  let annSkipped = 0;
  let postSkipped = 0;

  for (const p of posts) {
    if (!p.id || !p.user_id || !p.content) {
      (p.post_type === 'announcement' ? annStats : postStats).rejected++;
      recordRejected('post', p.id ?? '(no id)', 'missing id/user_id/content');
      continue;
    }

    const isAnnouncement = (p.post_type || '') === 'announcement' && !!p.title;
    const sourceType = isAnnouncement ? 'local_json_announcement' : 'local_json_post';
    const stats = isAnnouncement ? annStats : postStats;

    if (await isMigrated(client, sourceType, p.id)) {
      stats.alreadyMigrated++;
      if (isAnnouncement) annSkipped++;
      else postSkipped++;
      continue;
    }

    // FK check: created_by/user_id must exist (DB or source) — uses knownUserIds.
    if (!knownUserIds.has(p.user_id)) {
      stats.rejected++;
      recordRejected(isAnnouncement ? 'announcement' : 'post', p.id, `FK violation: user_id ${p.user_id} not in users`);
      continue;
    }

    const resolvedPostUserId = resolveUserId(p.user_id) as string;
    trackRedirect(isAnnouncement ? 'announcements' : 'posts', p.user_id, resolvedPostUserId);

    stats.toInsert++;
    if (planOnly) continue;

    if (isAnnouncement) {
      const res = await client.query(
        `INSERT INTO announcements (title, body, created_by, created_at)
         VALUES ($1, $2, $3, COALESCE($4, NOW()))
         RETURNING id`,
        [p.title, p.content, resolvedPostUserId, p.created_at ?? null]
      );
      annInserted++;
      await recordLedger(client, sourceType, p.id, 'announcements', String(res.rows[0].id), p);
    } else {
      const res = await client.query(
        `INSERT INTO posts (user_id, content, image_url, post_type, related_id, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
         RETURNING id`,
        [resolvedPostUserId, p.content, p.image_url ?? null, p.post_type ?? 'user', p.related_id ?? null, p.created_at ?? null]
      );
      postInserted++;
      await recordLedger(client, sourceType, p.id, 'posts', String(res.rows[0].id), p);
    }
  }

  report.planned['posts'] = postStats;
  report.planned['announcements'] = annStats;
  if (!planOnly) {
    report.executed['posts'] = { inserted: postInserted, skipped: postSkipped, rejected: postStats.rejected };
    report.executed['announcements'] = { inserted: annInserted, skipped: annSkipped, rejected: annStats.rejected };
  }
}

async function migrateFollowers(client: PoolClient, followers: LocalFollower[], planOnly: boolean) {
  const stats = { toInsert: 0, alreadyMigrated: 0, rejected: 0 };
  let inserted = 0;
  let skipped = 0;

  for (const f of followers) {
    if (!f.follower_id || !f.following_id) {
      stats.rejected++;
      recordRejected('follower', `${f.follower_id}->${f.following_id}`, 'missing side');
      continue;
    }
    const key = `${f.follower_id}->${f.following_id}`;
    if (await isMigrated(client, 'local_json_follower', key)) {
      stats.alreadyMigrated++;
      skipped++;
      continue;
    }
    if (!knownUserIds.has(f.follower_id) || !knownUserIds.has(f.following_id)) {
      stats.rejected++;
      recordRejected('follower', key, 'FK violation on follower or following');
      continue;
    }

    const rFollower = resolveUserId(f.follower_id) as string;
    const rFollowing = resolveUserId(f.following_id) as string;
    if (rFollower === rFollowing) {
      stats.rejected++;
      recordRejected('follower', key, `merge collapsed self-follow after remap (${f.follower_id}->${f.following_id} both map to ${rFollower})`);
      continue;
    }
    trackRedirect('followers', f.follower_id, rFollower);
    trackRedirect('followers', f.following_id, rFollowing);

    stats.toInsert++;
    if (planOnly) continue;

    await client.query(
      `INSERT INTO followers (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING`,
      [rFollower, rFollowing]
    );
    inserted++;
    await recordLedger(client, 'local_json_follower', key, 'followers', key, f);
  }
  report.planned['followers'] = stats;
  if (!planOnly) report.executed['followers'] = { inserted, skipped, rejected: stats.rejected };
}

async function countDestination(client: PoolClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ['users', 'runs', 'territories', 'posts', 'announcements', 'followers', '_migration_ledger']) {
    try {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      out[t] = r.rows[0].n;
    } catch {
      out[t] = -1; // table may not exist
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Confirmation prompt
// ──────────────────────────────────────────────────────────────────────

async function confirm(prompt: string): Promise<boolean> {
  if (AUTO_YES) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt + ' (type "MIGRATE" to proceed): ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'MIGRATE');
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  log(`[migrate-local-db] mode=${report.mode} source=${SOURCE}`);

  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Pass --db-url=... or put it in apps/backend/.env');
  }

  // Load + hash source
  const { raw, parsed, sha256 } = loadSource();
  report.sourceSha256 = sha256;
  log(`[source] sha256=${sha256}`);
  report.sourceCounts = {
    users: parsed.users?.length ?? 0,
    runs: parsed.runs?.length ?? 0,
    posts: parsed.posts?.length ?? 0,
    territories: parsed.territories?.length ?? 0,
    followers: parsed.followers?.length ?? 0,
  };
  log(`[source] counts: ${JSON.stringify(report.sourceCounts)}`);

  // Load optional user-merge map
  if (fs.existsSync(MERGE_MAP_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(MERGE_MAP_PATH, 'utf8'));
      // Allow either a flat {src: dst} object or a wrapper {map: {src: dst}, ...}
      userMergeMap = (raw && typeof raw === 'object' && raw.map && typeof raw.map === 'object') ? raw.map : raw;
      // Strip metadata keys
      for (const k of Object.keys(userMergeMap)) {
        if (k.startsWith('_') || typeof userMergeMap[k] !== 'string') delete userMergeMap[k];
      }
      log(`[merge] loaded ${Object.keys(userMergeMap).length} user-merge entries from ${MERGE_MAP_PATH}`);
    } catch (e: any) {
      throw new Error(`failed to parse user-merge map at ${MERGE_MAP_PATH}: ${e.message}`);
    }
  } else {
    log(`[merge] no user-merge map at ${MERGE_MAP_PATH} — treating as empty`);
  }
  report.merge.mapSize = Object.keys(userMergeMap).length;
  report.merge.entries = Object.entries(userMergeMap).map(([source, target]) => ({ source, target }));

  // DB connect
  const requiresSsl = !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (e) => err(`[pg] idle error: ${e.message}`));

  let client: PoolClient;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    report.preflight.db_reachable = true;
  } catch (e: any) {
    report.preflight.db_error = redact(e.message || String(e));
    throw new Error(`cannot connect to DATABASE_URL: ${report.preflight.db_error}`);
  }

  try {
    await preflight(client);
    await ensureLedger(client);

    // Pre-compute the set of valid user IDs for FK validation: every id
    // currently in public.users PLUS every id in the source JSON's users
    // array. In --execute, inserts happen within the transaction so a
    // per-row DB SELECT would also work; in --dry-run the rollback means
    // source-planned users don't exist in the DB, so this set is what
    // keeps dry-run and execute reports in agreement.
    const dbUsers = await client.query<{ id: string }>('SELECT id FROM users');
    const dbIds = new Set<string>(dbUsers.rows.map((r) => r.id));
    dbIds.forEach((id) => knownUserIds.add(id));
    (parsed.users ?? []).forEach((u) => { if (u.id) knownUserIds.add(u.id); });
    log(`[preflight] knownUserIds size = ${knownUserIds.size} (${dbUsers.rowCount} in db + ${parsed.users?.length ?? 0} in source JSON, dedup'd)`);

    // Validate the user-merge map: every source must be in the local JSON,
    // every target must already exist in production users. Fail loudly.
    const srcIds = new Set<string>((parsed.users ?? []).map((u) => u.id).filter((id): id is string => Boolean(id)));
    for (const [src, dst] of Object.entries(userMergeMap)) {
      if (!srcIds.has(src)) throw new Error(`user-merge map: source '${src}' not found in local JSON users`);
      if (!dbIds.has(dst)) throw new Error(`user-merge map: target '${dst}' not found in production users`);
      if (userMergeMap[dst]) throw new Error(`user-merge map: chained mapping detected — target '${dst}' is also a source`);
    }
    if (Object.keys(userMergeMap).length) log(`[merge] validated ${Object.keys(userMergeMap).length} user-merge entries`);

    // Dry run first — always — to populate `report.planned`.
    await client.query('BEGIN');
    try {
      await migrateUsers(client, parsed.users ?? [], true);
      await migrateRuns(client, parsed.runs ?? [], true);
      await migrateTerritories(client, parsed.territories ?? [], true);
      await migratePosts(client, parsed.posts ?? [], true);
      await migrateFollowers(client, parsed.followers ?? [], true);
    } finally {
      // Nothing was written in plan mode, but roll back anyway to release locks.
      await client.query('ROLLBACK');
    }

    log('[plan] ' + JSON.stringify(report.planned));

    if (DRY_RUN) {
      log('[dry-run] no writes performed. Re-run with --execute to apply.');
      report.success = true;
      return;
    }

    // Final guard before writing to a real DB.
    const totalToInsert = Object.values(report.planned).reduce((s, v) => s + v.toInsert, 0);
    if (totalToInsert === 0) {
      log('[execute] nothing to insert (all already migrated). Done.');
      report.success = true;
      return;
    }

    const ok = await confirm(
      `About to insert ${totalToInsert} record(s) into the target DB. ` +
        `This is NOT a dry-run.`
    );
    if (!ok) {
      log('[execute] aborted by user');
      report.success = false;
      report.errorMessage = 'aborted by user confirmation';
      return;
    }

    // Backup source immediately before writing anything.
    report.backupPath = backupSource(raw, sha256);
    log(`[backup] source copied to ${report.backupPath}`);

    await client.query('BEGIN');
    try {
      await migrateUsers(client, parsed.users ?? [], false);
      await migrateRuns(client, parsed.runs ?? [], false);
      await migrateTerritories(client, parsed.territories ?? [], false);
      await migratePosts(client, parsed.posts ?? [], false);
      await migrateFollowers(client, parsed.followers ?? [], false);
      await client.query('COMMIT');
      log('[execute] committed');
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw new Error(`transaction rolled back: ${e.message}`);
    }

    report.destinationCountsAfter = await countDestination(client);
    log(`[verify] destination counts: ${JSON.stringify(report.destinationCountsAfter)}`);

    report.success = true;
  } finally {
    try { client!.release(); } catch {}
    await pool.end();
  }
}

main()
  .catch((e: any) => {
    err(`[migrate-local-db] FAILED: ${e.message}`);
    report.success = false;
    report.errorMessage = redact(e.message || String(e));
    process.exitCode = 1;
  })
  .finally(() => {
    writeReport();
  });
