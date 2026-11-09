# StrideClash — Local JSON → PostgreSQL Migration Guide

Operational guide for migrating `data/local-db.json` into a real PostgreSQL database (Supabase or equivalent) using `apps/backend/scripts/migrate-local-db.ts`.

**Hard rules enforced by the script:**

- The source file is **never modified**.
- Default mode is **dry-run**. Writing requires `--execute`.
- All DB writes happen inside **one transaction**, rolled back on any error.
- Re-runs are **idempotent** via the `_migration_ledger` table.
- Credentials in connection strings are **redacted** from all logs and the report.

## 0. Prerequisites

1. A reachable PostgreSQL destination. Set its connection string in `DATABASE_URL`:
   - For Supabase, copy the **Session pooler** URL from **Project Settings → Database → Connection string**.
   - Do **not** paste the username into the hostname slot (that was the bug behind the current production outage — see `STRIDECLASH_DATABASE_REPAIR_REPORT.md`).
2. The schema migrations must already be applied to the target DB:
   ```bash
   cd apps/backend
   npm run migrate                         # applies schema.sql (users/runs/territories)
   npx ts-node src/db/migrate-v2.ts        # posts, likes, comments, announcements
   npx ts-node src/db/migrate-v3.ts        # friends, cover_image_url, coins, unlocked_colors
   npx ts-node src/db/migrate-v4.ts        # selected_avatar, unlocked_avatars, followers, expo_push_token
   psql "$env:DATABASE_URL" -f src/db/migrate-v5.sql   # password_hash + users_email_idx
   ```
   The script itself will refuse to run if any required table or column is missing and will print the exact `ALTER TABLE` statement needed.

## 1. Always start with a dry-run

```powershell
cd apps\backend
$env:DATABASE_URL = "<your pooler URL>"
npm run migrate:local -- --dry-run
```

The dry-run:

- opens a transaction, runs the full migration plan, then rolls back
- **writes nothing** to the DB and nothing to the source file
- regenerates `LOCAL_DB_MIGRATION_REPORT.md` at the project root

Inspect the report carefully. Look for:

- `Preflight.db_reachable: ✅` — connection works
- `Tables MISSING: _none_`
- `Columns MISSING: _none_`
- `Plan` table — numbers of rows that will be inserted and already-migrated
- `Rejected records` — any entries flagged for missing FKs or malformed data

## 2. Actual execution

Only after a clean dry-run:

```powershell
npm run migrate:local -- --execute
```

The script will:

1. Re-plan under a fresh transaction.
2. If the plan has any writes to do, prompt: `type "MIGRATE" to proceed`.
3. On confirmation, write a timestamped backup to `data/backups/local-db.<ISO>.<sha>.json`.
4. BEGIN → INSERT (users → runs → territories → posts/announcements → followers, in that order) → ledger writes → COMMIT.
5. On any error at any point, ROLLBACK the entire transaction.
6. Fetch destination row counts and write them into the report.

To skip the interactive prompt in CI / automated runs:

```
npm run migrate:local -- --execute --yes
```

## 3. Flags

| Flag | Default | Effect |
|---|---|---|
| `--dry-run` | ✅ default | Plan only; no writes. |
| `--execute` | off | Required to write to the DB. |
| `--yes` | off | Skip the interactive `MIGRATE` confirmation. |
| `--source=<path>` | `data/local-db.json` | Override source JSON path. |
| `--db-url=<url>` | `$DATABASE_URL` | Override target DB. |
| `--batch-size=<n>` | 100 | Reserved for future large-dataset batching. |

## 4. Backup locations

- **Automatic**, written only on `--execute`:
  `data/backups/local-db.<ISO_timestamp>.<sha256-prefix>.json`
- **Source file at project root** (`data/local-db.json`) is never touched.
- The report (`LOCAL_DB_MIGRATION_REPORT.md`) is overwritten on every run.

## 5. Validation

After `--execute`, the report contains:

```
## Destination counts after migration
- users: <int>
- runs: <int>
- territories: <int>
- posts: <int>
- announcements: <int>
- followers: <int>
- _migration_ledger: <int>
```

Cross-check against the `## Source record counts` section earlier in the report. The invariant is:

```
destination.count(X)
  ≥ source.count(X) − planned.rejected(X) − any_existing_production_rows
```

(The inequality is non-strict because other data may already have existed in production.)

For a deeper check, query the ledger directly:

```sql
SELECT source_type, COUNT(*) AS migrated
FROM _migration_ledger
GROUP BY source_type
ORDER BY source_type;
```

## 6. Idempotency

Running `--execute` a second time should insert zero rows and skip everything via the ledger. The report's `Execution` table will show `inserted=0, skipped=N`.

## 7. Recovery

- **Transaction failure**: nothing was committed. Fix the underlying issue (missing FK user, DB connectivity, etc.) and re-run.
- **Crash between `BEGIN` and `COMMIT`**: Postgres will auto-roll back. Re-run.
- **Crash after `COMMIT`**: the ledger is up to date; the next run skips already-migrated rows.
- **Partial migration you want to undo** (rare, destructive): the ledger tells you exactly which `dest_id` values came from the migration. You can `DELETE FROM runs WHERE id IN (SELECT dest_id::int FROM _migration_ledger WHERE source_type='local_json_run')` etc. This is a manual operation — the script will never delete rows.

## 8. Testing against a throwaway DB

Recommended before running against production:

1. Create a disposable Supabase project OR a local Postgres (Docker: `docker run -e POSTGRES_PASSWORD=t -p 55432:5432 postgres:16`).
2. Apply all schema migrations to it (see Prerequisites).
3. Run `--dry-run` then `--execute` against it with `--db-url=...`.
4. Re-run `--execute` and confirm it inserts zero new rows (idempotency check).
5. Interrupt a run partway through (Ctrl-C). Reconnect, re-run, confirm no duplicates.

## 9. What is **not** migrated

- Denormalized counter columns on posts (`likes_count`, `comments_count`): these are derived from rows in `likes`/`comments` in SQL, not stored. They'll be `0` after migration until real likes/comments appear.
- Denormalized user snapshot on posts (`display_name`, `character_type`, `color`): dropped. SQL joins on `user_id` instead.
- Local-only test accounts' plain-text data beyond `password_hash`: there is no plain-text password in the JSON; only bcrypt hashes.

## 10. Security

- The script never prints or writes the `DATABASE_URL`, `password_hash` values, email addresses in full, or any secret.
- Error messages are passed through a redactor that strips `postgres://user:pass@` prefixes.
- The `.env` file at `apps/backend/.env` remains gitignored.
