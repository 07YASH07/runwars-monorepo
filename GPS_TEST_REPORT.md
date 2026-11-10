# GPS TRACKING — TEST REPORT
**Date:** 2026-11-09  
**Status:** Code-inspection verified (physical device testing required)

---

## Foreground Location Permission
- **Code:** `Location.requestForegroundPermissionsAsync()` called in RunScreen setup effect and in `requestLocationPermissions()` before each start.  
- **Result (code):** ✅ Correct. User is prompted on first run.  
- **Physical test required:** Confirm Android permission dialog appears.

## Background Location Permission
- **Code:** `Location.requestBackgroundPermissionsAsync()` called in both RunScreen setup and `requestLocationPermissions()`. Failure is non-fatal (foreground-only fallback).  
- **Result (code):** ✅ Correct. App continues with foreground tracking if background denied.  
- **Physical test required:** Verify "Allow all the time" appears as separate Android 10+ permission step.

## Background GPS Tracking (Foreground Service)
- **Code:** `Location.startLocationUpdatesAsync('BACKGROUND_LOCATION_TASK', { foregroundService: {...} })` in `startBackgroundTracking()`.  
- **Manifest (FIXED):** `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` now both present.  
- **Task registration:** `TaskManager.defineTask('BACKGROUND_LOCATION_TASK', ...)` runs at module load in `BackgroundLocationService.ts`, which is imported by `RunScreen.tsx` (via `getBackgroundPoints`/`clearBackgroundPoints`).  
- **Result (code):** ✅ Should work on Android 14+. Was broken before this sprint.  
- **Physical test required:** Lock screen during active run. Verify foreground service notification appears. Verify GPS points continue in logcat.

## GPS Accuracy Filtering (NEW)
- **Code:** Fixes accuracy > 50 m points are discarded; `isLowAccuracy` flag prevents route addition.  
- **Result (code):** ✅ Distance will not inflate from poor GPS fixes.  
- **Physical test required:** Observe HUD accuracy badge transitions when moving indoors/outdoors.

## GPS Jump Filter (NEW)
- **Code:** Consecutive points > 200 m apart are rejected.  
- **Result (code):** ✅ Single GPS teleport events will not add phantom distance.  
- **Physical test required:** Cannot simulate without physical device.

## GPS Cold Start
- **Code:** `BestForNavigation` accuracy requested. No specific cold-start warm-up period.  
- **Potential issue:** First 20–30 seconds after app launch, GPS accuracy may be 50–200 m. The accuracy filter will reject these points until GPS locks.  
- **Recommendation:** Wait for HUD to show 🟢 HIGH before tapping START CONQUEST.

## Distance Calculation
- **Code:** Haversine formula in `LocationService.calculateDistance()`. Tested against: 1 km point pair = 1000 m (manual check).  
- **Result:** ✅ Mathematically correct.

## Coordinate Timestamping
- **Code:** `location.timestamp` from expo-location (Unix ms). Used for speed calculation and duplicate detection in background merge.  
- **Result:** ✅ Correct.

## Background Point Deduplication (on run finish)
- **Code:** `mergedPoints.some(pt => pt.timestamp === bgPt.timestamp)` before adding background points.  
- **Result:** ✅ Duplicate timestamps are ignored.

## Screen Lock Behavior
- **Expected:** Foreground service notification keeps process alive. `DeviceEventEmitter` events from `BackgroundLocationService` accumulate in `backgroundPoints[]` and are flushed to route on run finish.  
- **Known limitation:** While screen is locked, `backgroundPoints` may grow large for long runs. All points are merged correctly on FINISH.  
- **Physical test required.**

## GPS Signal Loss Recovery
- **Code:** No explicit reconnection logic. `watchPositionAsync` will resume delivering points automatically when signal returns.  
- **Accuracy filter** prevents junk points on reconnection.  
- **Physical test required:** Walk into a tunnel or building, confirm timer keeps running (time-based), confirm no distance spike on return.

## Sampling Interval
- `timeInterval: 2000` ms, `distanceInterval: 5` m.
- **Assessment:** ✅ Reasonable for running. Gives ~30 points/min at typical 5+ m/s pace.

## Battery Impact Assessment
- `BestForNavigation` accuracy at 2 s intervals: HIGH battery draw.
- **Recommendation for >60 min runs:** Consider switching to `Location.Accuracy.High` with `timeInterval: 3000` after the route is established (future optimization).
- **For tomorrow's test session:** Acceptable.

---

## Summary

| Check | Status |
|---|---|
| Foreground permission request | ✅ Code verified |
| Background permission request | ✅ Code verified |
| Foreground service (Android 14) | ✅ Fixed — manifest updated |
| Accuracy filtering (> 50 m rejected) | ✅ Fixed — new |
| GPS jump rejection (> 200 m) | ✅ Fixed — new |
| Haversine distance calculation | ✅ Correct |
| Background point accumulation | ✅ Code verified |
| Deduplication on FINISH | ✅ Code verified |
| Actual outdoor GPS lock | ⏳ Physical device required |
| Screen-lock background tracking | ⏳ Physical device required |
| Signal loss recovery | ⏳ Physical device required |
