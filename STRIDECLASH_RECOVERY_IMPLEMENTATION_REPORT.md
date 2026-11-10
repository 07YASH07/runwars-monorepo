# StrideClash — Recovery Plan Implementation Report

**Date:** 2026-11-10
**Scope:** All four priorities from `STRIDECLASH_PRODUCT_AUDIT.md` recovery plan + Instagram-style profile improvements + Run screen tab-bar clearance fix.
**Posture:** No production database writes, no Render changes, no migrations executed, no commits made. All changes live in the working tree.

---

## 1. Build artifact

| Item | Value |
|---|---|
| APK path (distribution copy) | `C:\Users\Dell\.gemini\antigravity\scratch\runwars\strideclash-recovery.apk` |
| APK path (Gradle output) | `C:\Users\Dell\.gemini\antigravity\scratch\runwars\apps\mobile\android\app\build\outputs\apk\release\app-release.apk` |
| Size | **35,424,335 bytes (33.78 MB)** |
| SHA-256 | `11a4e85830a3c6587dc0ff3d3d91a04c6182512f3c5f3070ae926a13fbe53c87` |
| Build timestamp | 2026-11-10 06:57 IST |
| Gradle result | `BUILD SUCCESSFUL in 1m 57s` (552 tasks: 21 executed, 531 up-to-date) |
| Build command | `.\gradlew.bat assembleRelease --no-daemon` |
| Build root | `C:\rw\apps\mobile\android` (Windows directory junction → project root, used to keep CMake paths under the 260-char limit) |
| JDK | Eclipse Adoptium 17 at `C:\Users\Dell\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2` |

Previous APKs are preserved untouched: `strideclash-startfix.apk`, `strideclash-session-fixes.apk`, `strideclash-backup-v2.apk`, `strideclash.apk`.

### Bundle verification

Extracted `assets/index.android.bundle` (2,435,384 bytes) and confirmed the recovery changes are compiled in:

| String | Found in bundle? |
|---|---|
| `CompeteHubScreen` | ✅ |
| `CommunityHubScreen` | ✅ |
| `FollowersListScreen` | ✅ |
| test IDs: `compete-tab-battles`, `compete-tab-rankings`, `community-tab-feed`, `community-tab-players` | ✅ |
| test IDs: `profile-stat-posts`, `profile-stat-followers`, `profile-stat-following` | ✅ |
| test IDs: `post-delete-`, `comment-delete-`, `followers-tab-following` | ✅ |
| Tab labels: `MAP`, `COMPETE`, `COMMUNITY`, `BATTLES`, `RANKINGS`, `POSTS`, `FOLLOWERS`, `FOLLOWING` | ✅ |
| Upload progress label (`Uploading `) | ✅ |
| Existing features still present (`RESUME PREVIOUS RUN`, `CONQUEST TROPHIES`) | ✅ (unregressed) |

Install over the previous build:
```
adb install -r C:\Users\Dell\.gemini\antigravity\scratch\runwars\strideclash-recovery.apk
```

---

## 2. Files changed (recovery plan only)

### New files
- `apps/mobile/src/screens/CompeteHubScreen.tsx` (81 lines) — Battles ↔ Rankings segmented container.
- `apps/mobile/src/screens/CommunityHubScreen.tsx` (81 lines) — Feed ↔ Players segmented container.
- `apps/mobile/src/screens/FollowersListScreen.tsx` (298 lines) — Modal list of followers / following with Follow / Unfollow toggle and loading / empty states.
- `apps/mobile/src/services/ImageUploadService.ts` (124 lines) — Firebase Storage upload helper. MIME whitelist, 5 MB cap, resumable upload with progress, user-scoped path, credential-free.

### Modified files
- `apps/mobile/App.tsx` (235-line diff) — 5-tab bottom navigator: **MAP · COMPETE · RUN · COMMUNITY · PROFILE**. RUN remains the elevated center hero. `FollowersList` added as a root modal route.
- `apps/mobile/src/navigation/types.ts` — `MainTabParamList` now matches the 5-tab IA; added `CompeteTopTabParamList`, `CommunityTopTabParamList` (reserved for a future upgrade to native top-tabs); added `FollowersList: FollowersListParams` to the root stack.
- `apps/mobile/src/screens/FeedScreen.tsx` (203-line diff) — Replaced base64 data-URL hack with real Firebase Storage upload via `uploadPostImage`, with live progress bar. Added delete affordance on own posts (`⋯` → confirm alert). Added delete affordance on own comments (`✕`). `CommentItem` type extended with `user_id` for self-detection.
- `apps/mobile/src/screens/CommunityScreen.tsx` (58-line diff) — `+ FOLLOW` ↔ `✓ FOLLOWING` toggle backed by a pre-flight fetch of my own `/api/followers/:userId`. Clicks call `follow` or `unfollow` appropriately and the local state updates without leaving the modal.
- `apps/mobile/src/screens/ProfileScreen.tsx` (wider diff) — Instagram-style stats row: tappable **POSTS / FOLLOWERS / FOLLOWING** counts hooked to local state and to the new `FollowersList` modal. New `POSTS` sub-tab renders the user's own posts (content, image, like/comment counts, date). Trophies tab now opens with a `PREVIEW — not server-awarded` banner; two trophies that required persisted data we don't track (`Night Ghost`, `Titan Shield`) are honestly locked instead of fake-awarded. All existing functionality preserved (class selection, avatar shop, color unlock, run history, route replay, run-share via `ViewShot`).
- `apps/mobile/src/screens/RunScreen.tsx` — Added `useBottomTabBarHeight` and applied it as the `bottom` offset for `bottomControlsArea`, so the START CONQUEST button always clears the (absolute, 74 dp on Android, 88 dp on iOS) tab bar. All earlier elevation + session-persistence fixes retained unchanged.

### Unchanged (deliberately)
- Backend `apps/backend/src/server.ts` — the audit was correct that all needed endpoints already exist; no duplicates were created.
- `apps/mobile/src/services/LocationService.ts`, `BackgroundLocationService.ts`, `SocketService.ts`, `AuthContext.tsx` — untouched, GPS and session recovery remain operational.
- `data/local-db.json` — untouched (SHA-256 still `0ce795d711378b967a21b44a23abecc7ada5a9ffdb3b8e014977a6a540f5ec2a`).

---

## 3. Recovery plan — phase-by-phase status

### Phase 1 & 2 — Five-tab navigation with Feed + Community restored

Implemented as **MAP · COMPETE · RUN · COMMUNITY · PROFILE**. Instead of pulling in `@react-navigation/material-top-tabs` (which requires the `react-native-pager-view` native module and a new build chain), the two hub tabs use lightweight `useState`-driven segmented containers:

- `CompeteHubScreen` → toggles between `BattlesScreen` and `LeaderboardScreen` (both reused as-is).
- `CommunityHubScreen` → toggles between `FeedScreen` and `CommunityScreen` (both reused as-is, no edits to shared screen logic).

Status: **code-complete; TypeScript + Gradle build verified**. The tabs will render and switch. Not yet exercised on a device.

### Phase 3 — Fix post image uploads

- Firebase config (`apps/mobile/src/config/firebase.ts`) was already exporting `storage`; I use that existing export — no new provider introduced.
- `ImageUploadService.uploadPostImage` reads the picker URI, builds a `Blob` via `fetch`, validates MIME against a whitelist (`image/jpeg|png|webp|heic|heif`), enforces a 5 MB cap, and does a **resumable** upload under `post-images/<userId>/<timestamp>.<ext>`. Progress is reported via a callback (`onProgress(0..1)`), which drives the progress bar in `FeedScreen`'s composer.
- Credentials are read from the already-configured `EXPO_PUBLIC_FIREBASE_*` env vars — nothing new is committed to Git. No service-account keys are embedded.

**Code status: complete.**

**Runtime status: NOT verified.** Specifically: the Firebase Storage **security rules on your project are unknown to me**. For this to actually work end-to-end on-device, your bucket must either (a) allow authenticated writes to `post-images/{userId}/*.*` (the path is designed so a rule like `request.auth != null && request.resource.contentType.matches('image/.*') && request.resource.size < 5*1024*1024` fits naturally), or (b) allow writes to any path for signed-in users. If rules deny the write, the catch block will show "Image upload failed — <reason>" to the user and the post will not be created. I have not sent a test payload or looked at your bucket.

Also NOT verified: that a downloaded `getDownloadURL()` link is viewable from a second device. That is the only true acceptance criterion and must be done with two installs or two test accounts.

### Phase 4 — Social relationship completion

Wired to existing backend endpoints with no server-side changes:

| Action | Mobile call site | Backend |
|---|---|---|
| Follow | `CommunityScreen`, `FollowersListScreen` | `POST /api/followers/follow` (existing) |
| Unfollow | `CommunityScreen`, `FollowersListScreen` | `POST /api/followers/unfollow` (existing) |
| Delete own post | `FeedScreen` (`⋯` on own posts) | `DELETE /api/posts/:id` (existing) |
| Delete own comment | `FeedScreen` comments drawer | `DELETE /api/comments/:id` (existing) |
| Get followers | `FollowersListScreen`, `ProfileScreen` | `GET /api/followers/:userId` (existing — returns `{followers, following}`) |
| Get following | same | same |

Profile counts (`posts.length`, `followers.length`, `following.length`) come from the enriched payload at `/api/profile/:userId` already. Tapping the Posts / Followers / Following cells in the profile header routes to either the local POSTS sub-tab or the FollowersList modal with the appropriate `tab` param.

Optimistic UI: follow / unfollow updates the local follower-id set immediately on success; on failure the alert surfaces the reason and the toggle rolls back.

**Code status: complete. TypeScript + build verified. Runtime round-trip (follow → refresh counts → list reflects change) NOT device-verified.**

### Phase 5 — Instagram-style profile

- Profile picture: already rendered via `PlayerAvatar` using `stats.avatar_url` or `selected_avatar`.
- Display name, bio, class: already present, unchanged.
- **New**: tappable `POSTS | FOLLOWERS | FOLLOWING` stat row (`igStatRow`) sitting below the existing miniStats (Runs / Distance / Turf). These counts come from the same `/api/profile/:userId` call and update on `fetchProfile()`.
- **New**: `POSTS` sub-tab renders the user's own posts list (content, image, like/comment counters, date).
- Existing `RUNS` sub-tab preserved; renamed display label to `ACTIVITY` while keeping `'runs'` as the internal key.
- Existing `TROPHIES` sub-tab preserved but the mock trophies now show an **"ⓘ PREVIEW"** banner clearly stating they are computed client-side and not yet server-awarded. The two trophies that depended on unmodeled data (`Night Ghost` for evening runs, `Titan Shield` for 24h defense) are locked with "(coming soon)" labels rather than fabricated as earned.
- **Not added**: "Battle wins" and "Territories captured, where supported." Battle wins have no persistence (audit §1e flagged this) — rendering a hardcoded zero would be dishonest. Territories captured is already surfaced as the TURF m² metric; I didn't add a separate counter to avoid duplication. If you want a distinct count-of-territories cell, say the word and I'll add it from `stats.total_zones`.

### Phase 6 — Run screen layout

- `bottomControlsArea` was at a fixed `bottom: 24`, which put the START CONQUEST button **inside** the 74 dp absolute bottom tab bar. Fixed by reading `useBottomTabBarHeight()` and offsetting by `tabBarHeight + 12`. Button is now guaranteed to clear the tab bar on both Android and iOS and across tablet form factors.
- All earlier elevation + session-persistence fixes retained: `elevation: 20` on `bottomControlsArea`/`topCockpit` and `elevation: 25` on `zoneIndicator` (so Android composites overlays above the native `MapView`), the `starting` / `startingRef` re-entrancy guard, and the `handleStart fired` Logcat diagnostic.
- No changes to GPS, background tracking, crash recovery, pause/resume/finish, route visualization, territory claim, or socket-based multiplayer wiring.

---

## 4. TypeScript + build verification

| Check | Result |
|---|---|
| Mobile `npx tsc --noEmit` | `EXIT:0` |
| Backend `npx tsc --noEmit` | `EXIT:0` |
| Gradle `assembleRelease` | `BUILD SUCCESSFUL in 1m 57s` (exit code 0) |
| APK present at output path | ✅ 34 MB |
| Bundle (`assets/index.android.bundle`) contains new screen code | ✅ (see §1 bundle verification) |
| Source JSON SHA-256 unchanged | ✅ |

This is **static verification only** — compile + link + bytecode. **No code was executed on a real Android device from this machine.** The remaining acceptance criteria are device-side.

---

## 5. Firebase image upload — honesty disclosure

As requested, calling this out explicitly:

| Claim | Status |
|---|---|
| Upload helper code is written and typed | ✅ complete |
| Helper uses the already-configured Firebase Storage client (no new provider) | ✅ |
| MIME type is validated | ✅ |
| Size cap (5 MB) is enforced | ✅ |
| Upload progress is reported to the UI | ✅ (callback + progress bar) |
| Error path surfaces a readable message | ✅ (`Alert.alert('Image upload failed', …)`) |
| Compiled into the release APK | ✅ (bundle contains the service) |
| Firebase Storage **security rules reviewed** | ❌ — I did not open your Firebase console |
| Actual upload performed from a device | ❌ — not done |
| Returned `getDownloadURL()` loads on a **second** device | ❌ — not done |
| Server-side validation to reject non-URL `imageUrl` values | ❌ — backend accepts any string; recommended as a follow-up |

If the upload fails on-device, the two most likely causes are:

1. **Bucket rules deny the write.** Open Firebase Console → Storage → Rules. Minimum workable rule that matches our upload path:
   ```
   service firebase.storage {
     match /b/{bucket}/o {
       match /post-images/{userId}/{file=**} {
         allow read: if true;
         allow write: if request.auth != null
                      && request.auth.uid == userId
                      && request.resource.contentType.matches('image/.*')
                      && request.resource.size < 5 * 1024 * 1024;
       }
     }
   }
   ```
   (Your app's `user.uid` currently comes from the StrideClash auth system — if Firebase Auth isn't used for sign-in, the `request.auth.uid` match won't hold and you'll need to adapt the rule. I didn't verify which auth is in effect for Storage; please check before concluding the service is broken.)

2. **Firebase env vars not populated in the EAS/release config.** `firebase.ts` warns in dev when keys are missing; in release the warning is silent. Inspect `eas.json` / `app.config.js` secrets if uploads fail with cryptic errors.

---

## 6. Acceptance test matrix (what you need to verify on-device)

I can only mark the "code" column. Everything in the "device" column is yours to run.

| # | Acceptance criterion | Code | Device |
|---|---|---|---|
| 1 | COMMUNITY tab opens | ✅ | ⬜ |
| 2 | FEED segment loads production posts | ✅ (endpoint wired) | ⬜ |
| 3 | PLAYERS segment loads active users | ✅ | ⬜ |
| 4 | Can create a new post without an image | ✅ | ⬜ |
| 5 | Uploaded image visible on another device | ✅ (code path) | ⬜ |
| 6 | Likes toggle persists | ✅ | ⬜ |
| 7 | Comments can be posted | ✅ | ⬜ |
| 8 | Unfollow works | ✅ | ⬜ |
| 9 | Own post deletion | ✅ | ⬜ |
| 10 | Own comment deletion | ✅ | ⬜ |
| 11 | Followers list loads | ✅ | ⬜ |
| 12 | Following list loads | ✅ | ⬜ |
| 13 | Counts refresh after follow / unfollow | ✅ (optimistic + refetch available via pull-to-refresh) | ⬜ |
| 14 | Opening another user's profile from feed / community still works | ✅ (unchanged modal flow) | ⬜ |
| 15 | COMPETE → BATTLES works | ✅ | ⬜ |
| 16 | COMPETE → RANKINGS works | ✅ | ⬜ |
| 17 | START CONQUEST is visible above the bottom tab bar | ✅ (tabBarHeight offset) | ⬜ |
| 18 | START CONQUEST is tappable | ✅ (elevation + re-entrancy guard) | ⬜ |
| 19 | GPS tracking still records points during a run | ✅ (unchanged) | ⬜ |
| 20 | Pause / Resume / Finish still work | ✅ (unchanged) | ⬜ |
| 21 | Crash recovery "RESUME PREVIOUS RUN?" still fires | ✅ (unchanged) | ⬜ |

---

## 7. Known limitations

1. **Image uploads are code-complete but not runtime-verified.** See §5. If your Storage rules block the write, the user sees "Image upload failed" and the post is skipped — the app does not degrade silently.
2. **Nested navigation uses segmented containers, not native top-tab navigator.** The visual affordance is a pill row at the top of each hub screen with a tap-to-switch. This is intentionally minimal (zero new native modules) and matches the pre-rebrand UX. If you prefer swipeable top-tabs we'd need to add `react-native-pager-view` + a native rebuild.
3. **Achievements remain preview-only.** The report is honest about this. A real awarding backend is Phase 5 of the recovery plan (ranks 5–8 in the roadmap) and was explicitly deferred by this task's "do not rebuild existing functionality" constraint.
4. **Opening another user's profile from `FollowersListScreen`** currently just dismisses the modal. Full other-user profile navigation from that list would require a stacked profile route, which isn't in this phase. The existing `openUserProfile` modal in `FeedScreen` / `CommunityScreen` still works for discovery.
5. **No commits were made.** Per the restriction. The working tree has the recovery changes; whenever you want them committed, I'll do it as a single `feat(mobile): …` commit (or split into logical milestones).
6. **No migration executed.** The local JSON → Postgres migration remains in `--dry-run` state with the approved merge map from the earlier session.
7. **No production configuration changed.** Render `DATABASE_URL`, Supabase project settings, and `.env` files are untouched.

---

## 8. What to do next

1. Install the APK (`strideclash-recovery.apk`), open the app, and work through the acceptance matrix in §6.
2. Report back any item that fails on-device. If image uploads fail, send me the error alert text or a Logcat line — I'll trace it to a rule or config issue.
3. Once device tests pass, approve the commit.

**No claim of production readiness is being made.** The code is build-verified; device acceptance is next.
