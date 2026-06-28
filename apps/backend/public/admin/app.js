// RunWars Admin Panel JavaScript

let map;
let socket;
const playerMarkers = new Map(); // userId -> L.circleMarker
const territoryPolygons = new Map(); // id -> L.polygon
let serverUptimeSeconds = 0;
let uptimeInterval;

// DOM Elements
const authModal = document.getElementById('auth-modal');
const secretInput = document.getElementById('admin-secret-input');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authErrorMsg = document.getElementById('auth-error-msg');
const logoutBtn = document.getElementById('logout-btn');

const dbStatus = document.getElementById('db-status');
const uptimeStatus = document.getElementById('uptime-status');
const valSockets = document.getElementById('val-sockets');
const valUsers = document.getElementById('val-users');
const valTerritories = document.getElementById('val-territories');

const refreshStatsBtn = document.getElementById('refresh-stats-btn');
const resetGridBtn = document.getElementById('reset-grid-btn');
const clearLogsBtn = document.getElementById('clear-logs-btn');
const terminalLog = document.getElementById('terminal-log');

// Setup Leaflet Map
function initMap() {
  // Center on India by default
  map = L.map('map').setView([20.5937, 78.9629], 5);
  
  // Use CartoDB Dark Matter tile layer for premium dark aesthetics
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
}

// Log writer utility
function writeLog(text, type = 'system') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  line.innerText = `[${timestamp}] ${text}`;
  terminalLog.appendChild(line);
  terminalLog.scrollTop = terminalLog.scrollHeight;
}

// Get admin token from storage
function getAdminToken() {
  return localStorage.getItem('runwars-admin-token');
}

// Core stats fetching
async function fetchStats() {
  const token = getAdminToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'x-admin-token': token }
    });

    if (res.status === 401) {
      localStorage.removeItem('runwars-admin-token');
      return false;
    }

    if (!res.ok) throw new Error('Failed to fetch stats');

    const stats = await res.json();
    
    // Update stats UI
    valSockets.innerText = stats.activeSockets;
    valUsers.innerText = stats.usersCount;
    valTerritories.innerText = stats.territoriesCount;
    
    // DB indicator
    if (stats.dbConnected) {
      dbStatus.innerHTML = '<span class="indicator green"></span> DB: Connected';
    } else {
      dbStatus.innerHTML = '<span class="indicator red"></span> DB: Disconnected';
    }

    // Reset uptime counter
    serverUptimeSeconds = stats.uptime;
    startUptimeCounter();

    return true;
  } catch (err) {
    writeLog(`Error loading metrics: ${err.message}`, 'leave');
    return false;
  }
}

// Uptime helper
function startUptimeCounter() {
  clearInterval(uptimeInterval);
  uptimeInterval = setInterval(() => {
    serverUptimeSeconds++;
    const hours = Math.floor(serverUptimeSeconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((serverUptimeSeconds % 3600) / 60).toString().padStart(2, '0');
    const seconds = (serverUptimeSeconds % 60).toString().padStart(2, '0');
    uptimeStatus.innerText = `Uptime: ${hours}:${minutes}:${seconds}`;
  }, 1000);
}

// Socket communication
function initSockets() {
  if (socket) socket.disconnect();

  socket = io();

  socket.on('connect', () => {
    writeLog('Connected to WebSocket server.', 'system');
  });

  socket.on('disconnect', () => {
    writeLog('Disconnected from WebSocket server.', 'leave');
  });

  // Track live players
  socket.on('livePlayersUpdate', (players) => {
    // Remove markers of players no longer active
    const activeIds = new Set(players.map(p => p.userId));
    for (const [userId, marker] of playerMarkers.entries()) {
      if (!activeIds.has(userId)) {
        marker.remove();
        playerMarkers.delete(userId);
      }
    }

    // Add or update markers
    players.forEach(p => {
      if (p.currentPosition && p.currentPosition.latitude !== 0) {
        updatePlayerMarker(p);
      }
    });
  });

  socket.on('playerJoined', (player) => {
    writeLog(`Player joined: ${player.displayName} (${player.characterType})`, 'join');
    fetchStats();
  });

  socket.on('playerLeft', (data) => {
    writeLog(`Player left: User ID ${data.userId}`, 'leave');
    const marker = playerMarkers.get(data.userId);
    if (marker) {
      marker.remove();
      playerMarkers.delete(data.userId);
    }
    fetchStats();
  });

  // Update specific player location
  socket.on('locationUpdated', (data) => {
    const marker = playerMarkers.get(data.userId);
    const pos = [data.point.latitude, data.point.longitude];
    
    if (marker) {
      marker.setLatLng(pos);
      marker.getPopup().setContent(`<strong>${marker.options.displayName}</strong><br>Speed: ${data.speedKmh.toFixed(1)} km/h<br>Status: Moving`);
    } else {
      // Fetch stats to get full player data for marker creation
      fetchStats();
    }
  });

  // Territories handling
  socket.on('territoriesUpdate', (territories) => {
    // Clear old polygons
    for (const poly of territoryPolygons.values()) {
      poly.remove();
    }
    territoryPolygons.clear();

    // Draw new polygons
    territories.forEach(drawTerritory);
    valTerritories.innerText = territories.length;
  });

  socket.on('territoryClaimed', (t) => {
    writeLog(`New zone claimed by ${t.ownerName} (${t.areaSquareMeters.toFixed(0)} sqm)`, 'claim');
    drawTerritory(t);
    fetchStats();
  });

  socket.on('conflict:resolved', (battle) => {
    writeLog(`⚔️ BATTLE: Winner ${battle.winnerId} (${battle.winnerDistance.toFixed(0)}m) vs Loser ${battle.loserId} (${battle.loserDistance.toFixed(0)}m)`, 'battle');
    fetchStats();
  });
}

function updatePlayerMarker(p) {
  const pos = [p.currentPosition.latitude, p.currentPosition.longitude];
  const color = p.color || '#3b82f6';
  
  let marker = playerMarkers.get(p.userId);
  if (marker) {
    marker.setLatLng(pos);
  } else {
    marker = L.circleMarker(pos, {
      radius: 8,
      fillColor: color,
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8,
      displayName: p.displayName
    }).addTo(map);
    
    marker.bindPopup(`<strong>${p.displayName}</strong><br>Speed: ${p.currentSpeedKmh.toFixed(1)} km/h<br>Class: ${p.characterType}`);
    playerMarkers.set(p.userId, marker);
  }
}

function drawTerritory(t) {
  if (!t.polygonCoordinates || t.polygonCoordinates.length === 0) return;
  
  // Format coordinate array for Leaflet: [[lat, lng], [lat, lng], ...]
  const latLngs = t.polygonCoordinates.map(c => [c.latitude, c.longitude]);
  const color = t.color || '#34c759';

  const poly = L.polygon(latLngs, {
    color: color,
    fillColor: color,
    fillOpacity: 0.3,
    weight: 2
  }).addTo(map);

  poly.bindPopup(`
    <strong>Owner:</strong> ${t.ownerName}<br>
    <strong>Area:</strong> ${t.areaSquareMeters.toFixed(1)} sqm<br>
    <strong>Claimed:</strong> ${new Date(t.claimedAt).toLocaleString()}
  `);

  territoryPolygons.set(t.id, poly);
}

// Authenticate Admin
async function authenticate(secret) {
  localStorage.setItem('runwars-admin-token', secret);
  authSubmitBtn.disabled = true;
  authSubmitBtn.innerText = 'Verifying...';
  
  const success = await fetchStats();
  
  authSubmitBtn.disabled = false;
  authSubmitBtn.innerText = 'Verify Access';

  if (success) {
    authModal.style.display = 'none';
    authErrorMsg.innerText = '';
    initSockets();
    writeLog('Access verified successfully.', 'system');
  } else {
    localStorage.removeItem('runwars-admin-token');
    authErrorMsg.innerText = 'Invalid Admin Secret Key!';
  }
}

// Reset Map Grid Command
async function resetMapGrid() {
  const confirmed = confirm('⚠️ WARNING: This will permanently delete ALL claimed territories on the map. Are you sure you want to proceed?');
  if (!confirmed) return;

  const token = getAdminToken();
  try {
    const res = await fetch('/api/admin/reset-grid', {
      method: 'POST',
      headers: { 
        'x-admin-token': token,
        'Content-Type': 'application/json'
      }
    });

    if (res.ok) {
      writeLog('Grid successfully reset. All zones cleared.', 'battle');
      fetchStats();
    } else {
      const err = await res.json();
      alert(`Reset failed: ${err.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Error resetting map grid: ${err.message}`);
  }
}

// Event Listeners
authSubmitBtn.addEventListener('click', () => {
  authenticate(secretInput.value.trim());
});

secretInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    authenticate(secretInput.value.trim());
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('runwars-admin-token');
  clearInterval(uptimeInterval);
  if (socket) socket.disconnect();
  authModal.style.display = 'flex';
  secretInput.value = '';
  writeLog('Logged out / Panel Locked.', 'system');
});

refreshStatsBtn.addEventListener('click', fetchStats);
resetGridBtn.addEventListener('click', resetMapGrid);
clearLogsBtn.addEventListener('click', () => {
  terminalLog.innerHTML = '<div class="log-line system">[System] Logs cleared.</div>';
});

// App Startup
window.addEventListener('load', async () => {
  initMap();
  
  const token = getAdminToken();
  if (token) {
    const verified = await fetchStats();
    if (verified) {
      authModal.style.display = 'none';
      initSockets();
    } else {
      authModal.style.display = 'flex';
    }
  } else {
    authModal.style.display = 'flex';
  }
});
