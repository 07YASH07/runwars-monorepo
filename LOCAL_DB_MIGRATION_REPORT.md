# StrideClash — Local JSON → PostgreSQL Migration Report

_This file is **overwritten automatically** by `apps/backend/scripts/migrate-local-db.ts` on every run (`--dry-run` or `--execute`). The content below is the template placeholder; it will be replaced the first time you run the script._

---

- Mode: _(dry-run | execute)_
- Started: _ISO timestamp_
- Finished: _ISO timestamp_
- Source: `data/local-db.json`
- Source SHA-256: _computed from file contents_
- Backup: `data/backups/local-db.<timestamp>.<sha-prefix>.json` _(only on --execute)_
- Result: ✅ success / ❌ failed

## Preflight

- DB reachable: _true/false_
- DB error: _redacted error message if any_
- Tables found: _list from information_schema.tables_
- Tables MISSING: _list_
- Columns MISSING: _list of (table, column)_

## Source record counts

- `users`: 9
- `runs`: 4
- `posts`: 1
- `territories`: 0
- `followers`: 0

_(Current snapshot as of 2026-11-09. Will update to the actual count the first time the script runs.)_

## Plan

| Entity | To insert | Already migrated | Rejected |
|---|---:|---:|---:|
| _(populated by script)_ | | | |

## Execution _(only on --execute)_

| Entity | Inserted | Skipped (ledger) | Rejected |
|---|---:|---:|---:|
| _(populated by script)_ | | | |

## Destination counts after migration _(only on --execute)_

- `users`: _(populated)_
- `runs`: _(populated)_
- `territories`: _(populated)_
- `posts`: _(populated)_
- `announcements`: _(populated)_
- `followers`: _(populated)_
- `_migration_ledger`: _(populated)_

## Rejected records

_(empty if none)_

---

**How to use:** see `LOCAL_DB_MIGRATION_GUIDE.md`. **What maps where:** see `LOCAL_DB_SCHEMA_MAPPING.md`.
