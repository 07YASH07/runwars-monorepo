# RUN SESSION ENGINE — TEST REPORT
**Date:** 2026-11-09

---

## State Machine: STOPPED → RUNNING → PAUSED → RUNNING → FINISHED

### STOPPED state
- **Initial state:** `isRunning: false`, `isPaused: false`, `routePoints: []`, all zeroed.  
- **UI:** Shows activity selector (Run/Walk/Bike) and "START CONQUEST" button.  
- **Result:** ✅ Correct.

### START_RUN action
- Generates unique `sessionId` = `'session_' + Date.now()` stored in `sessionIdRef`.  
- Resets all metrics to zero.  
- Sets `startTime: Date.now()`.  
- Clears `lastPointRef` and `backgroundPoints`.  
- Requests location permissions.  
- Starts foreground and background GPS tracking.  
- Starts 1 s `setInterval` for TICK.  
- Emits `runStart` to socket.  
- **Result:** ✅ Correct.

### RUNNING state
- **Elapsed time:** `TICK` action fires every 1 s, computes `accumulatedSeconds + floor((Date.now() - startTime) / 1000)`.  
- **Distance:** Updated on every accepted GPS point via `calculateDistance(routePoints)` (cumulative Haversine).  
- **Current speed:** Native `location.coords.speed` (m/s × 3.6) if available, else `calculateSpeed(prev, curr)` from two consecutive points.  
- **Pace:** `formatPace(currentSpeedKmh)` → `M:SS /km` string.  
- **GPS accuracy HUD:** Updated on each point from `accuracyMeters`.  
- **Route polyline:** `state.routePoints` passed to `<Polyline>`.  
- **Map follows runner:** `mapRef.animateToRegion` called on each point.  
- **Territory check:** `isPointInPolygon` runs on each update to detect rival zone entry.  
- **Socket:** Location emitted to server on each update.  
- **Result:** ✅ All checked.

### PAUSE_RUN action
- **Timing:** `accumulatedSeconds = state.elapsedSeconds`. `startTime = null`. TICK interval cleared.  
- **Tracking:** `stopTracking()` stops foreground GPS. Background tracking continues (service stays alive).  
- **Distance:** `ADD_POINT` action is guarded — `if (state.isPaused) return state`.  
- **Result:** ✅ Paused time does not inflate distance or pace.

### RESUME_RUN action (FIXED)
- **Distance jump fix:** `lastPointRef.current = null` before `startTracking()`. First post-resume GPS fix becomes the new baseline.  
- **Timing:** `startTime = Date.now()`. New TICK interval started.  
- **Previous data preserved:** `routePoints`, `distanceMeters`, `accumulatedSeconds` all retained.  
- **Result:** ✅ Correct after fix.

### STOP_RUN / FINISH
1. Foreground + background tracking stopped.
2. TICK interval cleared.
3. `persistIntervalRef` cleared.
4. `finishedSessionId` captured from `sessionIdRef`, then `sessionIdRef.current = null` (prevents double-submit).
5. Background points merged with foreground points by timestamp deduplication.
6. Sorted by timestamp.
7. `calculateDistance(mergedPoints)` for final distance.
8. `emitRunStop` → server saves run + awards 50 coins.
9. `emitTerritoryClaim` → server validates speed, checks overlap, saves territory.
10. Navigates to `PostRunScreen` with final stats.
11. AsyncStorage session cleared.
- **Result:** ✅ Correct after fixes.

---

## Stat Calculations

| Stat | Formula | Status |
|---|---|---|
| Distance | Cumulative Haversine over `routePoints` | ✅ |
| Elapsed time | `accumulatedSeconds + (Date.now()-startTime)/1000` | ✅ |
| Current pace | `60 / speedKmh` → `M:SS /km` | ✅ |
| Avg speed | `(km / elapsedSeconds) × 3600` | ✅ |
| Calories | `km × 62` (MET-based estimate) | ✅ approx |
| Territory area | `finalDistance × 2` (approximation) | ⚠️ crude |

---

## Duplicate Submission Prevention
- Session ID generated once at START, cleared to `null` at STOP.
- If Alert is somehow triggered twice, second `onPress` finds `sessionIdRef.current === null`.
- **Result:** ✅ Duplicate territory claim prevented.

---

## Offline Crash Recovery
- Route points persisted to `AsyncStorage['@runwars:activeSession']` on every new GPS point.
- Stored: `{ sessionId, routePoints, elapsedSeconds, startTime, activityType }`.
- Cleared on normal run end.
- **Missing:** No "restore unfinished run" prompt on next app launch. Data is recoverable manually but no UI.
- **Impact for tomorrow:** Low. If the app crashes, the user will need to start a new run. Historical GPS data is preserved in AsyncStorage for manual recovery.

---

## Tests That CANNOT Be Automated Without Device

- Actual foreground service notification on lock screen
- Background GPS fidelity over 20+ minutes
- Resume behavior after real screen lock/unlock
- Bluetooth headphone disconnect during run
- Phone call interruption handling
