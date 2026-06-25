# 🏃 RunWars

> **Real-time territory-based running game** — Think Strava meets Pokémon GO. Claim territory on a live map by running through areas. Battle other players for zones in real time.

---

## 📸 Screenshots

> _Add screenshots here after first build_

---

## 🏗️ Architecture

```
runwars/
├── apps/
│   └── mobile/          # Expo React Native app (TypeScript)
├── packages/
│   └── shared/          # Shared TypeScript interfaces
├── backend/             # Node.js + Express + Socket.io server
└── package.json         # npm workspaces root
```

**Stack:**
| Layer | Technology |
|---|---|
| Mobile | React Native + Expo (managed workflow) |
| Maps | react-native-maps (Google Maps SDK) |
| Backend | Node.js + Express + Socket.io |
| Database | PostgreSQL + PostGIS |
| Cache / Pub-Sub | Redis |
| Auth | Firebase Authentication |
| Storage | Firebase Storage |
| Hosting | Railway.app or Render.com |
| Language | TypeScript (strict) throughout |

---

## ✅ Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 18.0.0 | https://nodejs.org |
| npm | ≥ 9.0.0 | bundled with Node |
| Expo CLI | latest | `npm install -g expo-cli` |
| PostgreSQL | ≥ 14 + PostGIS | https://postgis.net |
| Redis | ≥ 7 | https://redis.io |
| Expo Go app | latest | iOS App Store / Google Play |

---

## 🔑 Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable these APIs:
   - **Maps SDK for Android**
   - **Maps SDK for iOS**
4. Go to **Credentials → Create Credentials → API Key**
5. Restrict the key to your app's package name / bundle ID
6. Copy the key into `apps/mobile/.env` as `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
7. Also add it to `apps/mobile/app.json`:
   ```json
   {
     "android": { "config": { "googleMaps": { "apiKey": "YOUR_KEY" } } },
     "ios": { "config": { "googleMapsApiKey": "YOUR_KEY" } }
   }
   ```

---

## 🔥 Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project named **runwars**
3. **Authentication:**
   - Enable **Email/Password** provider
   - Enable **Google** provider
4. **Storage:**
   - Create default Storage bucket
5. **Web App config (for mobile):**
   - Add a Web app → copy the config object
   - Paste values into `apps/mobile/.env`
6. **Service Account (for backend):**
   - Go to Project Settings → Service Accounts
   - Click **Generate new private key**
   - Save the JSON file as `backend/firebase-service-account.json`
   - Set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` in `backend/.env`

---

## 🚀 Local Setup

### 1. Clone and install

```bash
git clone https://github.com/yourname/runwars.git
cd runwars
npm install
```

### 2. Configure environment files

```bash
# Mobile app
cp apps/mobile/.env.example apps/mobile/.env
# Edit apps/mobile/.env with your Firebase + Google Maps keys

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your PostgreSQL, Redis, and Firebase paths
```

### 3. Start PostgreSQL + PostGIS

```bash
# macOS (Homebrew)
brew services start postgresql
psql -U postgres -c "CREATE DATABASE runwars;"
psql -U postgres -d runwars -c "CREATE EXTENSION postgis;"

# Windows (via psql)
psql -U postgres
CREATE DATABASE runwars;
\c runwars
CREATE EXTENSION postgis;
```

### 4. Start Redis

```bash
# macOS
brew services start redis

# Windows (WSL or Docker)
docker run -d -p 6379:6379 redis:7-alpine
```

### 5. Run database migrations

```bash
cd backend
npm run migrate
```

### 6. Start the backend

```bash
# From repo root
npm run backend

# Or directly
cd backend
npm run dev
```

Backend will be available at: `http://localhost:3000`  
Health check: `http://localhost:3000/health`

### 7. Start the mobile app

```bash
# From repo root
npm run mobile

# Or directly
cd apps/mobile
npx expo start
```

Scan the QR code with **Expo Go** on your phone, or press `a` for Android emulator / `i` for iOS simulator.

### 8. Run everything at once (dev mode)

```bash
npm run dev
```

---

## 🎮 Game Mechanics

- **Claim Territory:** Run through an area to claim it. A 15m buffer polygon is generated around your route.
- **Territory Battles:** When your path overlaps another player's zone, the runner with more total run distance wins the dispute.
- **Live Map:** All players appear in real time on the map as character markers.
- **Characters:**
  - ⚔️ **Warrior** — Bold red, aggressive territory claims
  - 🥷 **Ninja** — Dark purple, stealth runner
  - 🧙 **Mage** — Electric blue, mystical presence
  - 🏃 **Scout** — Forest green, fast explorer

---

## 🔌 Socket.io Events Reference

| Event | Direction | Payload |
|---|---|---|
| `player:join` | Client → Server | `{ userId, displayName, characterType, color }` |
| `location:update` | Client → Server | `{ userId, point: GeoPoint, speedKmh }` |
| `run:start` | Client → Server | `{ userId }` |
| `run:stop` | Client → Server | `{ userId, routePoints, distanceMeters }` |
| `territory:claim` | Client → Server | triggers server-side generation |
| `players:state` | Server → All | `LivePlayerState[]` every 2s |
| `territory:update` | Server → All | new/updated Territory |
| `conflict:resolved` | Server → All | TerritoryConflict |
| `run:stats` | Server → Runner | session stats |

---

## 📦 Deployment

### Backend (Railway.app)

1. Connect your GitHub repo to Railway
2. Set environment variables from `backend/.env`
3. Railway auto-detects Node.js and runs `npm start`
4. Provision a **PostgreSQL** and **Redis** plugin in Railway dashboard

### Mobile (Expo EAS Build)

```bash
npm install -g eas-cli
eas login
eas build --platform android
eas build --platform ios
```

---

## 📄 License

MIT © 2024 RunWars Team
