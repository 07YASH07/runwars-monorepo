# TOMORROW'S RUN CHECKLIST
**Date of Run:** 2026-11-10  
**Purpose:** First real-world outdoor test of StrideClash

---

## ✅ PRE-RUN (Do these the night before or morning of)

### Backend
- [ ] Wake Render backend: `curl https://runwars-v2.onrender.com/health` → should return `{"status":"ok"}`
- [ ] OR start the local tunnel: `node start-cloudflare-tunnel.js`
- [ ] If using tunnel: note the new URL and update `EXPO_PUBLIC_BACKEND_URL` before APK build
- [ ] Confirm `data/local-db.json` exists (offline fallback)

### Device Prep
- [ ] Install the new APK (from `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`)
- [ ] Enable "Install from unknown sources" if needed
- [ ] Charge phone to 100%
- [ ] Turn on Battery Saver off (GPS is affected by battery saver)
- [ ] Enable High Accuracy GPS in Android Location Settings

### App Setup
- [ ] Launch StrideClash
- [ ] Log in with your account (or demo@strideclash.com / admin123)
- [ ] Navigate to MAP tab — territories should load
- [ ] Navigate to RANKINGS tab — leaderboard should load
- [ ] Check profile stats are showing real values

---

## 🏃 STARTING THE RUN

1. Tap the **RUN** tab (⚡ center button)
2. When permission dialog appears: tap **"While using the app"** first, then **"Allow all the time"** when prompted for background
3. Select activity type (Run/Walk/Bike)
4. Wait for GPS indicator in HUD to show 🟢 **HIGH** accuracy (may take 30–60 s outdoors)
5. Tap **START CONQUEST →**
6. Verify:
   - Timer starts counting
   - Distance shows 0.00 and starts increasing after ~5 m of movement
   - Map shows your position
   - Foreground notification: "RunWars Tracking Active" in notification shade

---

## 📱 DURING THE RUN

| Action | Expected behavior |
|---|---|
| Running | Distance increases, pace shows M:SS /km |
| Check phone | Timer continues from background |
| Lock screen | Timer and GPS continue (foreground service active) |
| Walk into building | GPS dot turns 🟡 or 🔴, distance stops inflating |
| Return outside | GPS dot returns to 🟢, tracking resumes |
| Enter rival territory | ⚔️ RIVAL SECTOR banner appears |
| Tap PAUSE | Timer stops, GPS stops |
| Tap RESUME | Timer resumes from exact paused time, no distance jump |
| Phone call | Pause run first if possible |

---

## 🏁 FINISHING THE RUN

1. Tap **FINISH** (red)
2. Read the confirmation alert: "CONQUEST FINISH"
3. Tap **CLAIM & FINISH**
4. Wait for PostRunScreen to appear (2–3 seconds)
5. Verify:
   - Distance shown matches your actual run (should be within ~5%)
   - Territory map shows your route polygon
   - XP counter animates
6. Tap "Skip" on the Share modal (or share if you want)
7. Tap "BACK TO MAP"
8. Confirm your territory appears on the map

---

## 🔴 KNOWN LIMITATIONS FOR THIS TEST

1. **Territory area** is computed as `distance × 2` m² — not a true polygon area. The territory shape on the map will be approximate.
2. **Crash recovery UI** not implemented — if app crashes during run, data is in AsyncStorage but requires manual recovery.
3. **Render cold start** — first API call after Render idles (~15 min) takes 20–30 s. Login may feel slow.
4. **Background tracking on Android 15** — FOREGROUND_SERVICE_LOCATION added but not tested on physical Android 15 device.

---

## 🚨 TROUBLESHOOTING

| Symptom | Fix |
|---|---|
| "GPS Required" alert | Go to Android Settings > Apps > StrideClash > Permissions > Location > Allow all the time |
| Distance doesn't increase | Check GPS dot — if 🔴, wait outdoors for GPS lock |
| App crashes on start | Reinstall APK. If persists, clear app data |
| Login fails | Check backend is running. Try: `curl https://runwars-v2.onrender.com/health` |
| Territory not appearing on map after run | Backend validation may have rejected claim (speed too high). Check logcat for `[CLAIM REJECTED]` |
| Distance much larger than actual | GPS was low-accuracy during run. Post-run distance should be within 5% |

---

## 📊 DATA TO RECORD DURING TEST

After the run, note:
- Actual distance (measure with phone Maps or watch)
- StrideClash recorded distance
- Any GPS drop events (HUD going 🔴)
- Background tracking behavior (did it survive screen lock?)
- Time from FINISH to PostRunScreen appearance
- Any crashes or unexpected alerts
