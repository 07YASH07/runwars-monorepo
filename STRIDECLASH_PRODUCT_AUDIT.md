# StrideClash — Product Feature Audit

**Date:** 2026-11-10
**Scope:** Full repository, Git history, mobile screens + navigation, backend routes, Socket.IO surface, production Supabase schema, and recent DB counts.
**Posture:** Read-only. No files deleted, no database writes.

---

## Executive summary

StrideClash has **substantially more product than is currently visible in the mobile UI**. The 2026 rebrand (commit `d40edb5`) rewrote the navigation from a social-first 5-tab layout (**Feed / Community / Activity / Progress / Profile**) to a gaming-first 5-tab layout (**Map / Battles / Run / Rankings / Profile**). Two entire screens — `FeedScreen.tsx` (767 lines, fully wired) and `CommunityScreen.tsx` (577 lines, fully wired) — were kept as files but **removed from the tab navigator** with no replacement entry point. They are the single biggest cluster of hidden feature work.

A second cluster is **backend endpoints the UI never calls**: unfollow, delete post, delete comment, followers list, milestone check, shop avatar catalog — all shipped in the backend during Phase 2-7 but not wired to UI buttons.

Nothing in the audit requires building from scratch for Feed, Community, or the social-graph delete flows. All of that **already exists** and is recoverable by re-wiring navigation and adding a handful of handlers.

---

## 1. Feature-by-feature status matrix

Legend: ✅ working · 🟡 partial · 🔒 hidden (code exists, UI unreachable) · 🧪 mock · ❌ never implemented · 💥 broken

### 1a. Core gameplay

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| Register / login (email + bcrypt) | `/api/auth/register`, `/api/auth/login` | `AuthScreen` | ✅ | `password_hash` column verified in prod (added by migrate-v5). 27 users live. |
| GPS run tracking (foreground) | n/a | `RunScreen`, `LocationService` | ✅ | 2 s interval, 5 m filter, 50 m accuracy gate, 200 m jump reject. |
| Background GPS | n/a | `BackgroundLocationService` + Android foreground service | ✅ | Manifest has `FOREGROUND_SERVICE_LOCATION`. |
| Run session state machine (start/pause/resume/finish) | socket `emitRunStart`/`emitRunStop` | `RunScreen` useReducer | ✅ | Hardened this week. |
| Crash recovery / session persistence | n/a | `AsyncStorage` + 10 s interval | ✅ | Fixed in prior session. |
| Route visualization (polyline) | `runs.route_points JSONB` | `RunScreen` + `ProfileScreen` route modal | ✅ | |
| Territory claim (polygon + speed audit) | socket `emitTerritoryClaim` → `territories` table | `RunScreen` onStop | ✅ | 31 territories in prod. Anti-cheat `avg_speed_kmh` ships from Phase 1. |
| Live multiplayer map (player markers, other territories) | socket `livePlayersUpdate`, `territoriesUpdate`, `territoryClaimed` | `MapDashboardScreen`, `useMultiplayer` | ✅ | |
| Territory invasion alert | socket `territory:stolen`, `pvp:warning` | `ConflictToast`, inline Alert | ✅ | |
| Arena Coin Boost on invasion | `POST /api/territory/boost` | `RunScreen` boost button | ✅ | |
| Share run as image | — | `PostRunScreen`, `ProfileScreen` via `ViewShot` + `expo-sharing` | ✅ | |

### 1b. Social / community (the big gap)

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| Social feed (posts + announcements merged) | `GET /api/feed` | `FeedScreen.tsx` 767 lines | 🔒 **hidden** | Not in tab nav. Everything else wired. |
| Create post | `POST /api/posts` | `FeedScreen` modal composer | 🔒 hidden |  |
| Post with image | `POST /api/posts` body has `imageUrl` | `FeedScreen` via `ImagePicker` | 💥 **broken** | Image is **not uploaded**; a local `file://` URI from `expo-image-picker` is sent to the backend. Only the posting device can see it. `firebase/storage` is imported in `config/firebase.ts` but never used. |
| Like / unlike (toggle) | `POST /api/posts/:id/like` | `FeedScreen` heart button | 🔒 hidden |  |
| View comments | `GET /api/posts/:id/comments` | `FeedScreen` drawer | 🔒 hidden |  |
| Add comment | `POST /api/posts/:id/comments` | `FeedScreen` drawer | 🔒 hidden |  |
| Delete own comment | `DELETE /api/comments/:id` | — | 🟡 backend only |  |
| Delete own post | `DELETE /api/posts/:id` | — | 🟡 backend only |  |
| Admin announcements in feed | `/api/admin/announcements`, feed merges `feed_type:'announcement'` | `FeedScreen` renders | 🔒 hidden |  |
| Live feed refresh on new post | socket `feed:updated` | `FeedScreen` listener | 🔒 hidden |  |
| Community: live players list + search | socket live players, `/api/community/nearby` | `CommunityScreen.tsx` 577 lines | 🔒 **hidden** | Not in tab nav. |
| Open another user's profile from feed/community | `/api/profile/:userId` | `FeedScreen` + `CommunityScreen` modals | 🔒 hidden |  |
| Follow another user | `POST /api/followers/follow` (double-declared at lines 1113 and 2068 — see §3.2) | `FeedScreen` / `CommunityScreen` follow button | 🔒 hidden |  |
| Unfollow | `POST /api/followers/unfollow` | — | 🟡 backend only | Mobile never calls it. |
| View followers / following list | `GET /api/followers/:userId` | — | 🟡 backend only | `ProfileScreen` shows counts from profile payload but not a tappable list. |
| Private accounts / follow requests / approvals | — | — | ❌ never implemented | No `is_private`, no `follow_requests` table. |
| Comment editing | — | — | ❌ never implemented | Create + delete only. |
| Report / block user | — | — | ❌ never implemented |  |

### 1c. Profile & RPG

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| View own profile (stats, class, color, coins) | `GET /api/profile/:userId` | `ProfileScreen` | ✅ |  |
| Edit display name + bio | `POST /api/profile/update` | `ProfileScreen` edit modal | ✅ |  |
| Change character class (Scout/Warrior/Titan/Ghost) | `POST /api/profile/update` with `characterType` | `ProfileScreen` class grid | ✅ |  |
| Change territory color | `POST /api/profile/update` with `color` | `ProfileScreen` color palette | ✅ |  |
| Milestone avatars (unlock by km) | hardcoded in mobile (`MILESTONE_AVATARS`) | `ProfileScreen` | 🟡 | Backend has `GET /api/shop/avatars` + `POST /api/shop/check-milestones`, neither called. Mobile uses a static client-side list, so milestones are shown but never automatically awarded. |
| Premium avatars (buy with coins) | `POST /api/shop/unlock-avatar` | `ProfileScreen` | ✅ |  |
| Equip avatar | `POST /api/shop/set-avatar` | `ProfileScreen` | ✅ |  |
| Unlock territory color (coins) | `POST /api/shop/unlock-color` | `ProfileScreen` | ✅ |  |
| Run history | `GET /runs/:userId` | `ProfileScreen` runs sub-tab | ✅ |  |
| Run detail + route replay | `GET /runs/details/:runId` | `ProfileScreen` modal + `ViewShot` share | ✅ |  |
| Achievements / trophies | — | `ProfileScreen` achievements sub-tab | 🧪 **mock** | 6 trophies rendered. Criteria are **hardcoded client-side**. One trophy (`Night Ghost`) is `earned: true` unconditionally. No DB table, no persistence, no awarding event, no notifications. |

### 1d. Rankings

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| Leaderboard (weekly / all-time, run / walk / bike) | `GET /leaderboard?activityType=&range=` | `LeaderboardScreen` | ✅ | Phase 4 overhaul with podium + sticky stats. |
| Top-3 podium | derived from leaderboard query | `LeaderboardScreen` | ✅ |  |

### 1e. Battles / PvP

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| Contested sectors view | derived from `territories` + overlap logic | `BattlesScreen` | ✅ | 634 lines, functional. |
| "My Sectors" tab | `/api/profile/:userId` → user territories | `BattlesScreen` tab | ✅ |  |
| Battle history (per-conflict audit) | socket `conflict:resolved` is emitted but **not persisted** to any table | `BattlesScreen` history tab | 🟡 | History tab exists but has no persistent data source. Lives in memory only. |
| Real-time PvP warnings | socket `pvp:warning` | `RunScreen` Alert | ✅ |  |

### 1f. Notifications

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| Expo push token registration | `POST /api/users/push-token`, loaded on startup | `NotificationService.registerForPushNotificationsAsync`, emitted on run | ✅ |  |
| Push on territory invasion | `sendPushNotification` (via Expo) | — | ✅ |  |
| Admin broadcast push | `POST /api/admin/broadcast-push` | — (admin dashboard) | ✅ |  |
| **In-app notification history / inbox** | — | — | ❌ never implemented | No screen, no list, no badge. Users only see the OS-level push. |
| Deep-linking from push (jump to battle) | — | — | ❌ never implemented |  |

### 1g. Friends (vs Followers)

| Feature | Backend | Mobile | Status | Notes |
|---|---|---|---|---|
| Legacy `friends` table | DDL in `migrate-v3.sql`; **not applied to production DB** | — | ❌ | The current prod Supabase has no `friends` table. All social edges use the newer `followers` table. Commit history shows `friends` was replaced by `followers` during Phase 4-5. Server code has **no `FROM friends` SQL** anywhere — that model was abandoned. |
| Followers (directional edges) | `followers` table — 6 rows live | `FeedScreen` / `CommunityScreen` (hidden) | 🔒 | See §1b. |

### 1h. Admin

| Feature | Backend | Admin app | Status |
|---|---|---|---|
| Stats / analytics / heatmap / users CRUD / push broadcasts / reset-grid | 15+ `/api/admin/*` routes | `apps/admin/` (Vite React) | ✅ |

---

## 2. Database ↔ API ↔ UI mapping

### 2.1 Tables in production (from recent audit)

| Table | Row count | Primary role | UI reachable via |
|---|---:|---|---|
| `users` | 27 | identity, profile, wallet | Auth, Profile, hidden Community, hidden Feed |
| `runs` | 84 | run sessions + route points | Run, PostRun, Profile runs sub-tab |
| `territories` | 31 | claimed polygons | Map, Battles |
| `posts` | 67 | feed posts | **hidden Feed** |
| `likes` | 19 | post likes | **hidden Feed** |
| `comments` | 10 | post comments | **hidden Feed** |
| `announcements` | 1 | admin broadcasts | **hidden Feed** |
| `followers` | 6 | social graph | **hidden Feed / Community**; profile counters |
| `friends` | — (not present) | — | — (abandoned model) |
| `_migration_ledger` | 0 | our internal migration ledger | n/a |
| PostGIS views | — | — | not used (we store JSONB, not geometry) |

### 2.2 Backend endpoints not called from mobile

| Endpoint | Intent | Why not used |
|---|---|---|
| `/api/followers/unfollow` | undo a follow | No unfollow button anywhere in mobile. |
| `/api/followers/:userId` | followers / following list | Mobile shows counts from `/api/profile/:userId` but no tappable list screen exists. |
| `DELETE /api/posts/:id` | delete own post | FeedScreen has a composer but no row-level delete action. |
| `DELETE /api/comments/:id` | delete own comment | Same — no row-level delete. |
| `/api/shop/avatars` GET | server-side avatar catalog | Client uses hardcoded `MILESTONE_AVATARS` + `PREMIUM_AVATARS` arrays. Cannot update catalog without an app release. |
| `/api/shop/check-milestones` | server-side milestone evaluation + grant | Never triggered from mobile; milestone unlocks only happen if backend logic runs them on its own. |
| `/api/announcements` GET | announcements standalone | Covered by `/api/feed` merge; dead code or legacy. |
| `/profile/:userId`, `/profile/update`, `/runs/:userId` | pre-`/api` aliases | Legacy prefix; `/api/*` variants are what the mobile calls. Safe to retire. |
| `POST /api/followers/follow` is **declared twice** (lines 1113 & 2068) | — | Route duplication. Express will dispatch to the first; second is dead code. Flag for cleanup but not urgent. |

### 2.3 Socket.IO events

| Event | Emitted by | Consumed by | Status |
|---|---|---|---|
| `livePlayersUpdate` | backend | `useMultiplayer` hook | ✅ |
| `territoriesUpdate` | backend | `useMultiplayer`, `MapDashboardScreen` | ✅ |
| `territoryClaimed` | backend | `useMultiplayer` | ✅ |
| `territory:stolen` | backend → targeted | `RunScreen` ConflictToast | ✅ |
| `pvp:warning` | backend → targeted | `RunScreen` Alert | ✅ |
| `claim:rejected` | backend → claimant | not wired to any specific handler I could find | 🟡 |
| `feed:updated` | backend after new post | `FeedScreen` (hidden) | 🔒 |
| `conflict:resolved` | backend | `BattlesScreen` history tab | 🟡 (not persisted — see §1e) |

---

## 3. Features hidden during the 2026 rebrand

Reconstructed from `git show c41b09b:apps/mobile/App.tsx` (pre-rebrand `App.tsx`):

| Tab in `c41b09b` (pre) | Current equivalent | Fate |
|---|---|---|
| FEED | — | **removed from nav; screen kept** |
| COMMUNITY | — | **removed from nav; screen kept** |
| ACTIVITY | RUN | renamed; still central |
| PROGRESS | RANKINGS | renamed |
| PROFILE | PROFILE | unchanged |
| — | MAP (new) | added as default tab |
| — | BATTLES (new) | added |

**Why this happened**: the rebrand reframed the product as a gaming/territory app rather than a social run-sharing app. Feed and Community were deprioritized in the IA but the engineering wasn't deleted — likely because (a) features were valuable and (b) the social-graph tables (posts/likes/comments/followers) kept accruing live production data via deep-linked access or the old build. Production currently has 67 posts, 19 likes, 10 comments, 6 followers — users produced this content via older builds and it's now unreachable in the current build.

---

## 4. Likely-cause breakdown of missing features

| Feature | Most likely reason |
|---|---|
| Feed + Community tabs | Deliberate IA simplification in rebrand; file deletion was never done, probably intentional to allow reviving. |
| Image uploads broken | Firebase Storage was imported but a working upload helper was never finished (common Expo pitfall — ImagePicker gives a `file://` URI, and the client has to upload it somewhere; the backend expected a URL, not a file). |
| Achievements are mocked | Shipped as scaffolding for Phase 7 ("profile screen overhaul with dual tabs, trophies grid") — the UI landed but the awarding backend never followed. |
| Unfollow / delete-post / delete-comment | Backend was overbuilt in Phase 2 for completeness; the UI shipped only the happy-path (create + like + follow). Common "ship one direction, add the reverse later" pattern. |
| Follower list view | Same — profile counters were enough for v1. |
| In-app notification inbox | Expo push is enough for alerts; nobody built the inbox. |
| Battle history persistence | `conflict:resolved` was designed for real-time only, not analytics. A `battle_history` table was never created. |
| Private accounts | Out of scope for beta; never planned. |
| Comment edit / report / block | Out of scope for beta; never planned. |

---

## 5. Recommended recovery plan

### 5.1 Fast wins (reuse existing code, ~1 day each)

**R1 — Re-mount FEED and COMMUNITY tabs.** Pure navigation surgery.
- Edit `apps/mobile/App.tsx` MainTab to add `<MainTab.Screen name="FEED" component={FeedScreen} />` and `<MainTab.Screen name="COMMUNITY" component={CommunityScreen} />` with icons and labels that fit the cyberpunk theme (e.g., 📡 FEED, 👥 COMMUNITY).
- Update `MainTabParamList` in `apps/mobile/src/navigation/types.ts` so the strict typing matches.
- Choose: 7-tab bottom bar (cramped) OR move one of {BATTLES, RANKINGS} into a secondary location and keep 5 tabs. 7 tabs is fine on modern phones but dense; recommend 6 + ProfileScreen gaining a "social" sub-tab, or an overflow icon.
- **No code to write for the screens themselves** — they're wired.

**R2 — Wire the missing delete/unfollow buttons.** Backend already there.
- FeedScreen: add a long-press / overflow menu on own posts calling `DELETE /api/posts/:id`; on own comments calling `DELETE /api/comments/:id`.
- ProfileScreen or CommunityScreen: show current follow state; toggle calls `/api/followers/follow` or `/api/followers/unfollow`.

**R3 — Followers / Following list.** Already a backend endpoint.
- Tap the followers/following count on a profile → open a list screen or modal rendering rows from `GET /api/followers/:userId`.

### 5.2 Fix broken (~1 day)

**R4 — Fix image upload.**
Two serviceable options; pick one:
- **Option A — Supabase Storage** (recommended since Supabase is already in use): create a `post-images` bucket, use the Supabase JS client in the mobile app to upload the file picked by `ImagePicker`, then send the returned public URL in `imageUrl`. Cheap, zero infra.
- **Option B — Cloudinary** (unsigned uploads): simplest from client, no account linking.
- Add server-side validation: reject `imageUrl` values that start with `file://` or `content://` so broken posts stop being created.

### 5.3 Fill the gaps (2-3 days each)

**R5 — Achievement awarding.**
- New table `user_achievements(user_id, achievement_id, earned_at)`.
- Move trophy catalog to backend (`GET /api/achievements`).
- Backend evaluates on run-stop / territory-claim; emits a socket event; mobile shows a reward toast + persists to DB.

**R6 — Milestone check on login/run-stop.**
- Call `POST /api/shop/check-milestones` from RunScreen's onStop and from the Profile mount.

**R7 — In-app notifications inbox.**
- Minimal: a `notifications(id, user_id, type, body, created_at, read_at)` table + list screen.

### 5.4 Deliberate not-doing

Out of scope for recovery unless requested:
- Private accounts / follow requests
- Comment editing, report, block
- Battle history persistence (unless analytics is actually wanted)
- `friends` table revival (dead model; migrate-v3's DDL can be dropped from the migration path)

---

## 6. Prioritized implementation roadmap

Ranked by (user-visible impact) × (reuses existing code) / (effort).

| Rank | Change | Est. | Impact | Risk |
|---|---|---|---|---|
| **1** | **R1 — Re-mount FEED + COMMUNITY tabs** | ~2 h | Unlocks 67 posts / 19 likes / 10 comments / 6 followers of real production data | Low — cosmetic nav change |
| **2** | **R4 — Fix image uploads (Supabase Storage)** | ~4-6 h | Posts with photos finally work for all users | Medium — adds storage bucket, needs auth policy |
| **3** | **R2 — Add unfollow + delete post/comment buttons** | ~2-3 h total | Removes trapped-content frustration | Low — backend already live |
| **4** | **R3 — Followers/Following list view** | ~3 h | Standard social expectation | Low |
| **5** | R5 — Real achievements (DB-backed) | ~1 day | Replaces mock trophies with earned ones | Medium — new table + awarding logic |
| **6** | R6 — Auto-trigger milestone check | ~1 h | Milestone avatars actually unlock | Low |
| **7** | R7 — In-app notifications inbox | ~1 day | Users can revisit missed alerts | Medium |
| **8** | Clean up: remove duplicate `/api/followers/follow` definition, retire `/profile/*` aliases, drop `friends` DDL | ~1 h | Hygiene | None |
| N/A | Private accounts, comment editing, battle history, friends revival | — | Deferred per §5.4 | — |

**Total to restore the "missing" product**: ranks 1-4 ≈ 1.5 engineering days. This will reveal that StrideClash is already ~85% feature-complete; the social-first value has just been hidden since the rebrand.

---

## 7. Appendix — audit evidence inventory

- Mobile screen files: 9 in `apps/mobile/src/screens/`, 6674 total lines. None are stubs (all > 350 lines, substantive implementations).
- Backend routes: 45 distinct paths in `apps/backend/src/server.ts`.
- Socket events: 10 (4 broadcast, 3 targeted, 3 "to self").
- Git branches / commits consulted: `v2-dev` (current branch; 60 most recent commits reviewed). No deleted screen files in `git log --diff-filter=D`.
- Production counts pulled read-only from Supabase (no writes, no migration executed, `_migration_ledger` still 0): 27 / 84 / 31 / 67 / 19 / 10 / 1 / 6 for users / runs / territories / posts / likes / comments / announcements / followers.
- Pre-rebrand `App.tsx` reconstructed from `git show c41b09b:apps/mobile/App.tsx`.

**Nothing was modified by this audit.** No DB queries wrote data. No files were deleted, renamed, or edited. No migrations executed. The pending JSON migration remains in dry-run state. The pending password rotation is still your call.
