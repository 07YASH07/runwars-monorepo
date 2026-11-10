# APK BUILD REPORT
**Date:** 2026-11-09

---

## Existing APK (Pre-Sprint)
- **Path:** `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- **Size:** 35,346,031 bytes (33.7 MB)
- **Built:** 2026-11-09 19:31
- **Status:** Usable on Android ≤ 13 (missing FOREGROUND_SERVICE_LOCATION)
- **Known bugs:** GPS accuracy never filtered, distance counter shows 1/10 value, resume distance jump

## APK Configuration
- **App name:** StrideClash
- **Package:** `com.runwars.v2`
- **Version:** 2.0.0
- **EAS project ID:** `d957dd92-6e79-494f-9173-b05d21ebe446`
- **Google Maps API Key:** Embedded in manifest meta-data
- **Backend URL candidates (at build time):**
  1. `EXPO_PUBLIC_BACKEND_URL` env var (if set)
  2. Cloudflare tunnel URL (session-specific, hardens during build)
  3. `http://192.168.29.185:3000`
  4. `https://runwars-v2.onrender.com`
  5. `http://10.0.2.2:3000`

## Manifest Permissions (Updated)
```xml
ACCESS_BACKGROUND_LOCATION ✅
ACCESS_COARSE_LOCATION      ✅
ACCESS_FINE_LOCATION        ✅
FOREGROUND_SERVICE          ✅
FOREGROUND_SERVICE_LOCATION ✅ (ADDED in this sprint)
INTERNET                    ✅
VIBRATE                     ✅
```

## New APK Build Attempt
- **Method:** `gradlew.bat assembleRelease` with bundled JDK 17 (Eclipse Adoptium)
- **First attempt:** Failed — `JAVA_HOME not set`
- **Second attempt:** Failed — stale CMake cache (`.cxx/RelWithDebInfo/1r731165`)
- **Third attempt:** Clean `.cxx` dir + `gradlew clean assembleRelease` — IN PROGRESS

### If Build Succeeds
- New APK will be at `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- Contains all 9 bug fixes from this sprint
- Fully functional on Android 14+

### If Build Fails
- **Use existing APK** (`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`)
- All JS-side fixes (distance counter, resume jumps, session persistence, duplicate prevention, apiFetch) are NOT in the existing APK
- Background GPS on Android 14 is unreliable (missing FOREGROUND_SERVICE_LOCATION)
- **Mitigations for existing APK:**
  - On Android 13 or lower: background GPS should work
  - Don't rely on the PostRunScreen distance counter (it shows 1/10 of actual)
  - Avoid rapidly double-tapping FINISH
  - Keep screen on during the run to avoid background tracking dependency

## EAS Build Alternative
If Gradle build fails locally, use EAS cloud build:
```bash
cd apps/mobile
npx eas build --platform android --profile preview --non-interactive
```
Requires: `eas.json` configured (already present), Expo account logged in (`expo login`), EAS CLI installed.

## APK Distribution
- Backend serves APK at `/download/strideclash.apk`
- Also accessible from `qrcode.html` and `eas_page.html`
