# StrideClash — Local JSON → PostgreSQL Migration Report

**Generated:** 2026-11-10
**Mode:** `--dry-run` (merge plan, no writes to DB or source JSON)
**Overall result:** ✅ dry-run passes — **0 rejected, 0 duplicate-email conflicts**, merge plan loaded. One new production-side issue surfaced during this re-run (§9) — read before you run `--execute`.

---

## 1. Database connection result

| Check | Result |
|---|---|
| `.env` present + gitignored | ✓ |
| `DATABASE_URL` value exposed anywhere in logs / report | **No** (redacted by `redactUrl()` throughout) |
| Shape | Supabase Session Pooler on `aws-1-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.<ref>`, db `postgres` |
| Project reference | `eoeiohzjbnpbkfnkcywq` (last-4 = `cywq`) |
| `SELECT 1` | OK |
| Server version | PostgreSQL 17.6 |

## 2. Existing PostgreSQL record counts (observed at start of this dry-run)

| Table | Count |
|---|---:|
| users | **27** |
| runs | **84** |
| territories | **31** |
| posts | **67** |
| likes | **19** |
| comments | **10** |
| announcements | **1** |
| followers | **6** |
| `_migration_ledger` | **0** |

> **Counts moved since the previous dry-run** (26 → 27 users, 83 → 84 runs, 66 → 67 posts). The `_migration_ledger` is still 0, so this dry-run did not write. The deltas came from **live Render backend activity** (an end-user signup + test run + test post) during the interval between the two dry-runs. See §9 for the relevant finding.

## 3. Local JSON record counts

| Entity | Count |
|---|---:|
| users | 9 |
| runs | 4 |
| posts | 1 (announcement) |
| territories | 0 |
| followers | 0 |

Source SHA-256: `0ce795d7…ca10a` — **unchanged** throughout.

## 4. Merge plan (user account consolidation)

Stored at `apps/backend/scripts/user-merge-map.json` and loaded by the migration script:

| Source id (local JSON) | → | Target id (production) | Rationale |
|---|---|---|---|
| `usr_mvnt7e93` | → | `usr_mr6hmsgj` | Same real person (both tied to `y***@gmail.com`). Local bcrypt discarded; production hash is authoritative. |

Effect enforced by the script:

- `usr_mvnt7e93` is **not inserted** as a users row.
- All FK references to `usr_mvnt7e93` in the source JSON are redirected onto `usr_mr6hmsgj` at insert time.
- The ledger records `(source_type='local_json_user', source_id='usr_mvnt7e93', dest_id='usr_mr6hmsgj')` so re-runs are idempotent (`PRIMARY KEY (source_type, source_id)`).

### FK redirects detected by the dry-run

| Entity | Source user | → | Target user | Rows redirected |
|---|---|---|---|---:|
| runs | `usr_mvnt7e93` | → | `usr_mr6hmsgj` | **4** (run ids 1, 2, 3, 4 — all route points + timestamps preserved) |
| posts | — | — | — | 0 |
| territories | — | — | — | 0 |
| followers | — | — | — | 0 |

The merge map also had **validation checks** run before planning:

- ✓ Source `usr_mvnt7e93` is in local JSON users.
- ✓ Target `usr_mr6hmsgj` is in production users.
- ✓ No chained mapping (target is not also a source).

## 5. Records eligible for migration (with merge applied)

| Entity | To insert | Remapped | Already migrated | Rejected |
|---|---:|---:|---:|---:|
| **users** | **8** | **1** | 0 | **0** |
| **runs** | **4** (all attached to `usr_mr6hmsgj`) | 0 | 0 | **0** |
| **announcements** | **1** (attached to `usr_admin`, newly inserted) | 0 | 0 | **0** |
| posts | 0 | 0 | 0 | 0 |
| territories | 0 | 0 | 0 | 0 |
| followers | 0 | 0 | 0 | 0 |

**Total actual inserts in `--execute`: 13** (= 8 users + 4 runs + 1 announcement). The 9th source user is remapped, not inserted.

## 6. Records rejected and reasons

**Zero.** Every source record has a valid FK path with the merge applied.

## 7. Duplicate / conflict scan (result)

| Check | Result |
|---|---|
| Duplicate emails inside production users | **none** |
| Local source IDs overlapping production IDs | `usr_mvnt7e93` (see §9) — handled by merge map; it is remapped, not inserted. All 8 others are new. |
| Source email colliding with a different production user id | `usr_mvnt7e93` (local) ↔ `usr_mr6hmsgj` (prod) — **resolved by merge map**. No other email collisions. |
| `users_email_idx` uniqueness | `btree`, not UNIQUE — this migration does not add a UNIQUE constraint. Recommended follow-up in §9. |

## 8. Preserved data (confirmation)

| Property | Confirmation |
|---|---|
| Source JSON untouched | ✓ SHA-256 unchanged |
| Database untouched by dry-run | ✓ `_migration_ledger` still 0 |
| All 4 run records migrated (ids 1-4), route_points, timestamps, activity_type preserved | ✓ (planned) |
| Announcement `ann_welcome` → `announcements` table with its title, body, created_at, `created_by = usr_admin` | ✓ (planned, usr_admin is one of the 8 users inserted first in the same transaction) |
| 8 remaining new users inserted with their IDs, emails, display_names, bcrypt hashes, bios, coins, avatars, created_at | ✓ (planned) |
| Transactional atomicity + rollback on error | ✓ enforced by `BEGIN`/`COMMIT`/`ROLLBACK` block in `main()` |
| Idempotency | ✓ `_migration_ledger` with PK `(source_type, source_id)` + `ON CONFLICT DO NOTHING` on inserts |

## 9. Remaining blockers / production-side findings

**9.1 New production duplicate of the same real person — out of scope for this migration**

Between the previous dry-run and this one, a live user registered via the Render backend and created the following rows:

- `users.usr_mvnt7e93` — `display_name: yashverma2162826`, `email: NULL`, `created_at: 2026-11-09T19:13:16Z`
- `runs.id=84` — `user_id: usr_mvnt7e93`, 21m, created today

This is the **same real person** as `usr_mr6hmsgj` (same gmail address, known from the merge map rationale), who now has **three potential identities** across the system — one in the local JSON, one old production row (`usr_mr6hmsgj`), and one brand-new production row (`usr_mvnt7e93`).

**Why this does not break our migration:**
- The merge map still redirects local-JSON `usr_mvnt7e93` → `usr_mr6hmsgj`. The script's `isMigrated` check only sees the ledger, not whether the user coincidentally exists in production under the same id. Since the ledger is empty, the merge-map remap path still fires for this entry. The 4 local runs still end up correctly attached to `usr_mr6hmsgj`.
- The newly-created production `usr_mvnt7e93` row is **not touched** by our script.

**What you'll still have after `--execute`:** `usr_mvnt7e93` and `usr_mr6hmsgj` continue to coexist as two rows in production (with run #84 owned by the former, the four migrated runs + the pre-existing 12 runs owned by the latter). Consolidating them is a separate, dashboard/SQL operation (not a bulk migration) — flag if you want help planning that; it would need to be done AFTER this migration completes.

**9.2 Database password exposure (still flagged, per earlier instruction)**

Unrotated. Rotate in Supabase Dashboard → *Project Settings → Database → Reset database password*, then update `apps/backend/.env` and Render's `DATABASE_URL`. Not automated.

**9.3 Minor: `users_email_idx` is not UNIQUE**

Current: `CREATE INDEX users_email_idx ON public.users USING btree (email)`. Structurally does not prevent duplicate emails. Candidate follow-up (requires zero existing duplicates to apply): `CREATE UNIQUE INDEX CONCURRENTLY users_email_uidx ON public.users (LOWER(email)) WHERE email IS NOT NULL;`. Out of scope for this task.

**9.4 Minor: `friends` table from `migrate-v3.sql` is still missing**

Unrelated to the local-JSON migration (the migration script never touches `friends`). Re-run `migrate-v3.sql` when convenient — it is idempotent.

## 10. Exact command required for actual migration

**Awaiting your approval. Not yet executed.**

From either the monorepo root or `apps/backend/`:

```powershell
npm run migrate:local -- --execute
```

The script will:
1. Reload the source JSON and re-compute SHA-256.
2. Reload `scripts/user-merge-map.json` and re-validate the merge entries.
3. Reconnect to the same `DATABASE_URL`.
4. Re-run preflight + plan (expected: `users 8 insert + 1 remap, runs 4, announcements 1, rejected 0`).
5. Prompt: `type "MIGRATE" to proceed:` *(skip with `--yes`)*.
6. Copy source to `data/backups/local-db.<ISO>.<sha-prefix>.json`.
7. `BEGIN` → users (8 inserted + 1 remapped-via-ledger) → runs (4 re-parented to `usr_mr6hmsgj`) → territories → posts/announcements (1) → followers → `COMMIT`.
8. Write the executed-mode report here with destination counts after migration.

**Still a hard stop** until you approve §9.1 (the awareness that the live production duplicate exists and will persist unless separately consolidated).
