# CRITICAL BUGS FIXED — StrideClash Run-Ready Sprint
**Date:** 2026-11-09  
**Sprint:** Emergency Run-Readiness Sprint for November 10

---

## BUG 1 — FOREGROUND_SERVICE_LOCATION missing (Android 14+)
**Severity:** Critical — background GPS silently fails on Android 14 devices  
**File:** `apps/mobile/android/app/src/main/AndroidManifest.xml`  
**Root cause:** Android 14 (API 34) added `FOREGROUND_SERVICE_LOCATION` as a mandatory permission for any foreground service that accesses location. Without it, `Location.startLocationUpdatesAsync()` raises a SecurityException on Android 14+ when attempting to start the background foreground service.  
**Fix:** Added `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>` to the manifest.  
**Also fixed:** `apps/mobile/app.config.js` permissions array now includes `FOREGROUND_SERVICE_LOCATION` for future EAS builds.

---

## BUG 2 — GPS accuracy never filtered (phantom distance spikes)
**Severity:** Critical — an accuracy reading of 500 m creates a 500 m route spike every GPS update  
**File:** `apps/mobile/src/services/LocationService.ts`  
**Root cause:** `watchPositionAsync` callback accepted every GPS fix regardless of `location.coords.accuracy`. In urban canyons, indoor areas, and immediately after GPS cold start, accuracy can be 100–500 m, causing massive distance inflation.  
**Fix:**
- Points with `accuracy > 50 m` are silently dropped (location state still updated for HUD, but coordinate is NOT added to route).
- Passes `accuracyMeters` to the callback for HUD display.

---

## BUG 3 — GPS jump filter missing (teleport events)
**Severity:** High — multi-hundred-meter GPS teleports (common on Android) add false distance  
**File:** `apps/mobile/src/services/LocationService.ts`  
**Root cause:** No guard against GPS coordinates jumping > 200 m between consecutive updates.  
**Fix:** Added Haversine check; updates > 200 m from the last accepted point are rejected with a console warning.

---

## BUG 4 — GPS accuracy HUD always shows "HIGH" (never updated)
**Severity:** Medium — runner has no warning that GPS signal is poor  
**File:** `apps/mobile/src/screens/RunScreen.tsx`  
**Root cause:** `state.gpsAccuracy` defaulted to `'high'` and was only updated by the `SET_ACCURACY` action, but the `handleLocationUpdate` callback never dispatched that action.  
**Fix:** `handleLocationUpdate` now dispatches `SET_ACCURACY`:
- `accuracy ≤ 10 m` → 🟢 HIGH  
- `accuracy 10–30 m` → 🟡 FAIR  
- `accuracy > 30 m` → 🔴 LOW (also shows for rejected low-accuracy fixes)

---

## BUG 5 — Distance jump after PAUSE → RESUME
**Severity:** High — if user moves 100 m while paused, that entire distance is added on first post-resume GPS fix  
**File:** `apps/mobile/src/screens/RunScreen.tsx` (`handleResume`)  
**Root cause:** `lastPointRef.current` was not cleared on resume. The first new GPS point after resume would compute distance from the last point before pause (a different location).  
**Fix:** Added `lastPointRef.current = null` at the start of `handleResume`. The first post-resume point becomes the new baseline; no phantom distance is added.

---

## BUG 6 — PostRunScreen distance counter shows 1/10 of actual value
**Severity:** High — runner sees "250 METRES CONQUERED" for a 2.5 km run  
**File:** `apps/mobile/src/screens/PostRunScreen.tsx`  
**Root cause:** `AnimatedCounter target={parseFloat(distanceKm) * 100}` where `distanceKm = distanceMeters / 1000`. So `target = distanceMeters / 10` (e.g. 2500 m → 250 counter).  
**Fix:** Changed target to `Math.round(distanceMeters)`.

---

## BUG 7 — PostRunScreen used hardcoded API_URL (resilience failure)
**Severity:** Medium — if primary backend URL is unavailable, sharing a run post fails with no retry  
**File:** `apps/mobile/src/screens/PostRunScreen.tsx`  
**Root cause:** Used `fetch(\`${API_URL}/api/posts\`, ...)` where `API_URL` is the first candidate URL (the Cloudflare tunnel) and cannot fall back.  
**Fix:** Replaced with `apiFetch('/api/posts', ...)` which tries all 4 candidate URLs in sequence.

---

## BUG 8 — Duplicate territory claim on double-tap FINISH
**Severity:** Medium — race condition allows two territory claims with the same GPS route  
**File:** `apps/mobile/src/screens/RunScreen.tsx` (`handleStop`)  
**Root cause:** Session ID was generated as `'session_' + Date.now()` at the moment of the Stop alert confirmation — not at run start. Two rapid confirmations generate two different IDs and both submit.  
**Fix:**
- Session ID is now generated at `START_RUN` and stored in `sessionIdRef`.
- After `handleStop` captures it, `sessionIdRef.current` is immediately set to `null`.
- Any second invocation finds `null` and cannot create a duplicate claim.

---

## BUG 9 — No crash recovery for active GPS session
**Severity:** Medium — app crash during run loses all GPS data  
**File:** `apps/mobile/src/screens/RunScreen.tsx`  
**Root cause:** Route points, elapsed time, and session ID were only in React state (in-memory). An OOM kill or crash wiped them completely.  
**Fix:** Added `useEffect` that persists `{ sessionId, routePoints, elapsedSeconds, startTime, activityType }` to `AsyncStorage` under `@runwars:activeSession` on every new GPS point. Session is cleared from AsyncStorage when the run ends normally.  
*Note: Crash recovery UI (restoring the session on next launch) is NOT yet implemented — recovery data exists but requires a future "Resume unfinished run?" prompt.*

---

## NON-CRITICAL ISSUES (not fixed in this sprint)

- `ProfileScreen`, `FeedScreen`, `CommunityScreen` still use `fetch(${API_URL}/...)` instead of `apiFetch`. These screens work when the primary URL is reachable; fallback is not needed for the run itself.
- Territory area calculation (`finalDistance * 2`) is an approximation; accurate polygon area requires a Shoelace formula implementation — deferred.
- PostRunScreen auto-opens the sharing modal 800 ms after navigation; this is intentional but could be annoying. Left unchanged.

---

**TypeScript status after all fixes:** `npx tsc --noEmit` → 0 errors
