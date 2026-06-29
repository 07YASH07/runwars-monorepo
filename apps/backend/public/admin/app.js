// RunWars Admin Panel JavaScript

let map;
let socket;
const playerMarkers = new Map(); // userId -> L.circleMarker
const territoryPolygons = new Map(); // id -> L.polygon
let heatmapLayer = null;
let serverUptimeSeconds = 0;
let uptimeInterval;
let allUsersData = [];

// Chart.js instances
let chartDau = null;
let chartRuns = null;
let chartZones = null;
let chartClasses = null;
let analyticsLoaded = false;


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

// Tabs DOM
const tabBtns = document.querySelectorAll('.tab-btn');
const tabViews = document.querySelectorAll('.tab-view');

// Heatmap DOM
const heatmapToggle = document.getElementById('heatmap-toggle');

// Users DOM
const refreshUsersBtn = document.getElementById('refresh-users-btn');
const userTableBody = document.getElementById('user-table-body');

// Edit User Modal DOM
const editUserModal = document.getElementById('edit-user-modal');
const editUserId = document.getElementById('edit-user-id');
const editUserName = document.getElementById('edit-user-name');
const editUserCharacter = document.getElementById('edit-user-character');
const editUserColor = document.getElementById('edit-user-color');
const editUserBio = document.getElementById('edit-user-bio');
const saveUserBtn = document.getElementById('save-user-btn');
const deleteUserBtn = document.getElementById('delete-user-btn');
const cancelUserBtn = document.getElementById('cancel-user-btn');

// Push DOM
const pushTitle = document.getElementById('push-title');
const pushBody = document.getElementById('push-body');
const sendPushBtn = document.getElementById('send-push-btn');

// =============================================
// ANALYTICS — Chart.js + Leaderboards
// =============================================

function buildChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0f1628',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#f1f5f9',
        bodyColor: '#64748b'
      }
    },
    scales: {
      x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#64748b', font: { size: 11 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.04)' }, beginAtZero: true }
    }
  };
}

function fillMissingDays(data) {
  const result = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split('T')[0];
    const found = data.find(r => r.day && r.day.startsWith(dayStr));
    result.push({ day: dayStr, count: found ? found.count : 0 });
  }
  return result;
}

function shortDay(dayStr) {
  const d = new Date(dayStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
}

function createLineChart(canvasId, data, color, label) {
  const filled = fillMissingDays(data);
  const labels = filled.map(r => shortDay(r.day));
  const values = filled.map(r => r.count);
  const ctx = document.getElementById(canvasId).getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, color + '40');
  gradient.addColorStop(1, color + '00');
  return new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label, data: values, borderColor: color, backgroundColor: gradient, borderWidth: 2, pointBackgroundColor: color, pointRadius: 4, tension: 0.4, fill: true }] },
    options: buildChartDefaults()
  });
}

function createBarChart(canvasId, data, color, label) {
  const filled = fillMissingDays(data);
  const labels = filled.map(r => shortDay(r.day));
  const values = filled.map(r => r.count);
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label, data: values, backgroundColor: color + '80', borderColor: color, borderWidth: 1.5, borderRadius: 6 }] },
    options: buildChartDefaults()
  });
}

function createDoughnutChart(canvasId, rows) {
  const classColors = { Runner: '#3b82f6', Knight: '#f59e0b', Ninja: '#8b5cf6', Cyber: '#10b981' };
  const labels = rows.map(r => r.character_type || 'Unknown');
  const values = rows.map(r => r.count);
  const colors = labels.map(l => classColors[l] || '#64748b');
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors.map(c => c + 'bb'), borderColor: colors, borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 12, boxWidth: 12 } },
        tooltip: { backgroundColor: '#0f1628', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, titleColor: '#f1f5f9', bodyColor: '#64748b' }
      }
    }
  });
}

const rankSymbols = ['🥇', '🥈', '🥉', '4', '5'];
const rankClasses = ['gold', 'silver', 'bronze', '', ''];

function renderLeaderboard(listId, items, valueKey, formatFn) {
  const el = document.getElementById(listId);
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = '<li style="color:var(--muted);font-size:13px;padding:12px 0">No data yet.</li>';
    return;
  }
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'lb-item';
    li.innerHTML = `
      <span class="lb-rank ${rankClasses[i]}">${rankSymbols[i]}</span>
      <span class="lb-color-dot" style="background:${item.color || '#3b82f6'}"></span>
      <div class="lb-info">
        <div class="lb-name">${item.display_name || 'Runner'}</div>
        <div class="lb-sub">${item.character_type || 'Runner'} &bull; ${item.total_runs || 0} runs</div>
      </div>
      <span class="lb-value">${formatFn(item[valueKey])}</span>
    `;
    el.appendChild(li);
  });
}

async function fetchAnalytics() {
  const token = getAdminToken();
  if (!token) return;
  try {
    const res = await fetch('/api/admin/analytics', { headers: { 'x-admin-token': token } });
    if (!res.ok) throw new Error('Failed to load analytics');
    const data = await res.json();

    if (chartDau)     { chartDau.destroy();     chartDau = null; }
    if (chartRuns)    { chartRuns.destroy();    chartRuns = null; }
    if (chartZones)   { chartZones.destroy();   chartZones = null; }
    if (chartClasses) { chartClasses.destroy(); chartClasses = null; }

    chartDau     = createLineChart('chart-dau',   data.dau,         '#00e5ff', 'Active Runners');
    chartRuns    = createBarChart( 'chart-runs',   data.runsPerDay,  '#3b82f6', 'Runs');
    chartZones   = createBarChart( 'chart-zones',  data.zonesPerDay, '#10b981', 'Zones');
    chartClasses = createDoughnutChart('chart-classes', data.classDistribution);

    renderLeaderboard('lb-distance',  data.topByDistance,  'total_distance',  v => (v/1000).toFixed(2) + ' km');
    renderLeaderboard('lb-territory', data.topByTerritory, 'total_territory', v => v.toFixed(0) + ' sqm');

    analyticsLoaded = true;
    writeLog('Analytics charts refreshed.', 'system');
  } catch (err) {
    writeLog(`Analytics error: ${err.message}`, 'leave');
  }
}

// Setup Leaflet Map

function initMap() {
  map = L.map('map').setView([20.5937, 78.9629], 5);
  
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

// Get admin token
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
    
    valSockets.innerText = stats.activeSockets;
    valUsers.innerText = stats.usersCount;
    valTerritories.innerText = stats.territoriesCount;
    
    if (stats.dbConnected) {
      dbStatus.innerHTML = '<span class="indicator green"></span> DB: Connected';
    } else {
      dbStatus.innerHTML = '<span class="indicator red"></span> DB: Disconnected';
    }

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

// Fetch Users Directory
let currentSort = { col: null, dir: 'asc' };

async function fetchUsers() {
  const token = getAdminToken();
  if (!token) return;

  userTableBody.innerHTML = '<tr><td colspan="8" class="text-center">Loading users directory...</td></tr>';

  try {
    const res = await fetch('/api/admin/users', { headers: { 'x-admin-token': token } });
    if (!res.ok) throw new Error('Failed to load users');
    allUsersData = await res.json();
    renderUserTable();
  } catch (err) {
    userTableBody.innerHTML = `<tr><td colspan="8" class="text-center error-msg">Error: ${err.message}</td></tr>`;
  }
}

function renderUserTable() {
  const searchVal   = (document.getElementById('user-search')?.value || '').toLowerCase();
  const classFilter = document.getElementById('user-class-filter')?.value || '';

  let filtered = allUsersData.filter(u => {
    const nameMatch  = (u.display_name || '').toLowerCase().includes(searchVal);
    const emailMatch = (u.email || '').toLowerCase().includes(searchVal);
    const classMatch = !classFilter || (u.character_type || '') === classFilter;
    return (nameMatch || emailMatch) && classMatch;
  });

  if (currentSort.col) {
    filtered.sort((a, b) => {
      let va = a[currentSort.col];
      let vb = b[currentSort.col];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return currentSort.dir === 'asc' ? -1 : 1;
      if (va > vb) return currentSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  if (filtered.length === 0) {
    userTableBody.innerHTML = '<tr><td colspan="8" class="text-center">No users match your filter.</td></tr>';
    return;
  }

  userTableBody.innerHTML = '';
  filtered.forEach(u => {
    const tr = document.createElement('tr');
    const distKm = (u.total_distance / 1000).toFixed(2);
    const color = u.color || '#3b82f6';
    const cls = (u.character_type || 'Runner').toLowerCase();
    const hasToken = !!u.push_token;

    tr.innerHTML = `
      <td><strong>${u.display_name || 'Runner'}</strong><br><small style="color:var(--muted)">ID: ${u.id.substring(0, 8)}...</small></td>
      <td>${u.email || 'No email'}</td>
      <td><span class="badge ${cls}">${u.character_type || 'Runner'}</span></td>
      <td><div class="color-preview"><span class="color-dot" style="background:${color}"></span>${color}</div></td>
      <td>${u.total_runs}</td>
      <td>${distKm} km</td>
      <td>${u.total_territory.toFixed(0)} sqm</td>
      <td style="display:flex;gap:6px;align-items:center;">
        <button class="btn-secondary btn-sm edit-user-trigger" data-id="${u.id}">Edit</button>
        <button class="btn-primary btn-sm dm-user-trigger" data-id="${u.id}" ${!hasToken ? 'disabled title="No push token registered"' : ''} style="opacity:${hasToken ? 1 : 0.4}">📨</button>
      </td>
    `;
    userTableBody.appendChild(tr);
  });

  document.querySelectorAll('.edit-user-trigger').forEach(btn => {
    btn.addEventListener('click', e => openEditUserModal(e.target.getAttribute('data-id')));
  });
  document.querySelectorAll('.dm-user-trigger').forEach(btn => {
    btn.addEventListener('click', e => openDmModal(e.target.getAttribute('data-id')));
  });
}

// Sort column click handler
document.addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const col = th.getAttribute('data-col');
  if (currentSort.col === col) {
    currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.col = col;
    currentSort.dir = 'desc';
  }
  document.querySelectorAll('th.sortable').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  renderUserTable();
});

// CSV Export
function exportUsersCSV() {
  if (!allUsersData.length) return;
  const headers = ['Name','Email','Class','Color','Runs','Distance_km','Territory_sqm'];
  const rows = allUsersData.map(u => [
    `"${u.display_name || ''}"`,
    `"${u.email || ''}"`,
    u.character_type || '',
    u.color || '',
    u.total_runs,
    (u.total_distance / 1000).toFixed(2),
    u.total_territory.toFixed(0)
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `runwars_users_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  writeLog('User data exported as CSV.', 'system');
}

// DM Single User Modal
const dmUserModal  = document.getElementById('dm-user-modal');
const dmUserLabel  = document.getElementById('dm-user-label');
const dmUserToken  = document.getElementById('dm-user-token');
const dmPushTitle  = document.getElementById('dm-push-title');
const dmPushBody   = document.getElementById('dm-push-body');
const dmSendBtn    = document.getElementById('dm-send-btn');
const dmCancelBtn  = document.getElementById('dm-cancel-btn');

function openDmModal(userId) {
  const user = allUsersData.find(u => u.id === userId);
  if (!user || !user.push_token) return;
  dmUserLabel.innerText = `To: ${user.display_name || user.email}`;
  dmUserToken.value = user.push_token;
  dmPushTitle.value = '';
  dmPushBody.value = '';
  dmUserModal.style.display = 'flex';
}

async function sendDmPush() {
  const token = getAdminToken();
  const payload = {
    token: dmUserToken.value,
    title: dmPushTitle.value.trim(),
    body:  dmPushBody.value.trim()
  };
  if (!payload.title || !payload.body) {
    alert('Please fill out the title and message body.');
    return;
  }
  dmSendBtn.disabled = true;
  dmSendBtn.innerText = 'Sending...';
  try {
    const res = await fetch('/api/admin/push-single', {
      method: 'POST',
      headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      writeLog(`Direct push sent: "${payload.title}" to ${dmUserLabel.innerText}`, 'system');
      dmUserModal.style.display = 'none';
    } else {
      const err = await res.json();
      alert(`Failed: ${err.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    dmSendBtn.disabled = false;
    dmSendBtn.innerText = 'Send Notification';
  }
}

dmSendBtn.addEventListener('click', sendDmPush);
dmCancelBtn.addEventListener('click', () => { dmUserModal.style.display = 'none'; });



// User Modal Operations
function openEditUserModal(userId) {
  const user = allUsersData.find(u => u.id === userId);
  if (!user) return;

  editUserId.value = user.id;
  editUserName.value = user.display_name || '';
  editUserCharacter.value = user.character_type || 'Runner';
  editUserColor.value = user.color || '#3b82f6';
  editUserBio.value = user.bio || '';

  editUserModal.style.display = 'flex';
}

async function saveUserDetails() {
  const token = getAdminToken();
  const payload = {
    userId: editUserId.value,
    displayName: editUserName.value.trim(),
    characterType: editUserCharacter.value,
    color: editUserColor.value.trim(),
    bio: editUserBio.value.trim()
  };

  try {
    const res = await fetch('/api/admin/user/update', {
      method: 'POST',
      headers: {
        'x-admin-token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      writeLog(`User profile updated: ${payload.displayName}`, 'system');
      editUserModal.style.display = 'none';
      fetchUsers();
      fetchStats();
      // Restart sockets to grab updated user markers
      initSockets();
    } else {
      const err = await res.json();
      alert(`Failed to save: ${err.error}`);
    }
  } catch (err) {
    alert(`Save error: ${err.message}`);
  }
}

async function deleteUser() {
  const uid = editUserId.value;
  const user = allUsersData.find(u => u.id === uid);
  const name = user ? user.display_name : 'this user';
  
  const confirmed = confirm(`⚠️ DANGER: Are you sure you want to permanently delete user "${name}"?\nThis will wipe all their stats, runs, and map territories!`);
  if (!confirmed) return;

  const token = getAdminToken();
  try {
    const res = await fetch(`/api/admin/user/${uid}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': token }
    });

    if (res.ok) {
      writeLog(`User deleted: ${name}`, 'leave');
      editUserModal.style.display = 'none';
      fetchUsers();
      fetchStats();
    } else {
      const err = await res.json();
      alert(`Delete failed: ${err.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Push Notifications Broadcaster
async function sendPushBroadcast() {
  const token = getAdminToken();
  const payload = {
    title: pushTitle.value.trim(),
    body: pushBody.value.trim()
  };

  if (!payload.title || !payload.body) {
    alert('Please fill out both notification title and body.');
    return;
  }

  sendPushBtn.disabled = true;
  sendPushBtn.innerText = 'Sending Broadcast...';

  try {
    const res = await fetch('/api/admin/broadcast-push', {
      method: 'POST',
      headers: {
        'x-admin-token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      writeLog(`Push Broadcast Sent: "${payload.title}" to ${data.sentCount} devices.`, 'system');
      pushTitle.value = '';
      pushBody.value = '';
    } else {
      const err = await res.json();
      alert(`Broadcast failed: ${err.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    sendPushBtn.disabled = false;
    sendPushBtn.innerText = 'Send Broadcast Message';
  }
}

// Heatmap overlays
async function toggleHeatmap(show) {
  const token = getAdminToken();
  
  if (!show) {
    if (heatmapLayer) {
      map.removeLayer(heatmapLayer);
      heatmapLayer = null;
    }
    // Restore polygons
    for (const poly of territoryPolygons.values()) {
      poly.addTo(map);
    }
    return;
  }

  // Remove active polygons from map view temporarily
  for (const poly of territoryPolygons.values()) {
    map.removeLayer(poly);
  }

  try {
    const res = await fetch('/api/admin/heatmap', {
      headers: { 'x-admin-token': token }
    });

    if (!res.ok) throw new Error('Failed to fetch heatmap data');

    const points = await res.json();
    const heatPoints = points.map(pt => [pt.latitude, pt.longitude, 0.6]); // format: [lat, lng, intensity]

    if (heatmapLayer) map.removeLayer(heatmapLayer);

    heatmapLayer = L.heatLayer(heatPoints, {
      radius: 20,
      blur: 15,
      maxZoom: 16,
      gradient: {0.4: 'blue', 0.6: 'cyan', 0.8: 'yellow', 1.0: 'red'}
    }).addTo(map);

    writeLog(`Loaded heatmap coordinates: ${heatPoints.length} points plotted.`, 'system');

  } catch (err) {
    writeLog(`Heatmap error: ${err.message}`, 'leave');
    heatmapToggle.checked = false;
    toggleHeatmap(false);
  }
}

// Socket communication setup
function initSockets() {
  if (socket) socket.disconnect();

  socket = io();

  socket.on('connect', () => {
    writeLog('Connected to WebSocket server.', 'system');
  });

  socket.on('disconnect', () => {
    writeLog('Disconnected from WebSocket server.', 'leave');
  });

  socket.on('livePlayersUpdate', (players) => {
    const activeIds = new Set(players.map(p => p.userId));
    for (const [userId, marker] of playerMarkers.entries()) {
      if (!activeIds.has(userId)) {
        marker.remove();
        playerMarkers.delete(userId);
      }
    }
    players.forEach(p => {
      if (p.currentPosition && p.currentPosition.latitude !== 0) {
        updatePlayerMarker(p);
      }
    });
  });

  socket.on('playerJoined', (player) => {
    writeLog(`Player joined: ${player.displayName} (${player.characterType})`, 'join');
    fetchStats();
    if (document.getElementById('tab-view-users').classList.contains('active-view')) {
      fetchUsers();
    }
  });

  socket.on('playerLeft', (data) => {
    writeLog(`Player left: User ID ${data.userId}`, 'leave');
    const marker = playerMarkers.get(data.userId);
    if (marker) {
      marker.remove();
      playerMarkers.delete(data.userId);
    }
    fetchStats();
    if (document.getElementById('tab-view-users').classList.contains('active-view')) {
      fetchUsers();
    }
  });

  socket.on('locationUpdated', (data) => {
    const marker = playerMarkers.get(data.userId);
    const pos = [data.point.latitude, data.point.longitude];
    
    if (marker) {
      marker.setLatLng(pos);
      marker.getPopup().setContent(`<strong>${marker.options.displayName}</strong><br>Speed: ${data.speedKmh.toFixed(1)} km/h<br>Status: Moving`);
    } else {
      fetchStats();
    }
  });

  socket.on('territoriesUpdate', (territories) => {
    for (const poly of territoryPolygons.values()) {
      poly.remove();
    }
    territoryPolygons.clear();

    // Draw only if heatmap is not active
    if (!heatmapToggle.checked) {
      territories.forEach(drawTerritory);
    } else {
      // Just save references
      territories.forEach(t => {
        const latLngs = t.polygonCoordinates.map(c => [c.latitude, c.longitude]);
        const color = t.color || '#34c759';
        const poly = L.polygon(latLngs, {
          color: color,
          fillColor: color,
          fillOpacity: 0.3,
          weight: 2
        });
        poly.bindPopup(`<strong>Owner:</strong> ${t.ownerName}<br><strong>Area:</strong> ${t.areaSquareMeters.toFixed(1)} sqm`);
        territoryPolygons.set(t.id, poly);
      });
    }
    valTerritories.innerText = territories.length;
  });

  socket.on('territoryClaimed', (t) => {
    writeLog(`New zone claimed by ${t.ownerName} (${t.areaSquareMeters.toFixed(0)} sqm)`, 'claim');
    
    // Draw polygon
    const latLngs = t.polygonCoordinates.map(c => [c.latitude, c.longitude]);
    const color = t.color || '#34c759';
    const poly = L.polygon(latLngs, {
      color: color,
      fillColor: color,
      fillOpacity: 0.3,
      weight: 2
    });
    poly.bindPopup(`<strong>Owner:</strong> ${t.ownerName}<br><strong>Area:</strong> ${t.areaSquareMeters.toFixed(1)} sqm`);
    
    territoryPolygons.set(t.id, poly);
    if (!heatmapToggle.checked) {
      poly.addTo(map);
    }
    
    fetchStats();
    if (document.getElementById('tab-view-users').classList.contains('active-view')) {
      fetchUsers();
    }
  });

  socket.on('conflict:resolved', (battle) => {
    writeLog(`⚔️ BATTLE: Winner ${battle.winnerId} (${battle.winnerDistance.toFixed(0)}m) vs Loser ${battle.loserId} (${battle.loserDistance.toFixed(0)}m)`, 'battle');
    fetchStats();
    if (document.getElementById('tab-view-users').classList.contains('active-view')) {
      fetchUsers();
    }
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
    setTimeout(() => map.invalidateSize(), 150);
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
      if (document.getElementById('tab-view-users').classList.contains('active-view')) {
        fetchUsers();
      }
    } else {
      const err = await res.json();
      alert(`Reset failed: ${err.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Error resetting map grid: ${err.message}`);
  }
}

// Tab navigation handler
function setupTabs() {
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabViews.forEach(v => v.classList.remove('active-view'));

      btn.classList.add('active');
      const tabName = btn.getAttribute('data-tab');
      document.getElementById(`tab-view-${tabName}`).classList.add('active-view');

      if (tabName === 'users') {
        fetchUsers();
      } else if (tabName === 'analytics') {
        fetchAnalytics();
      } else if (tabName === 'dashboard') {
        setTimeout(() => map.invalidateSize(), 80);
      }
    });
  });
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

// Heatmap Toggle
heatmapToggle.addEventListener('change', (e) => {
  toggleHeatmap(e.target.checked);
});

// User table actions
refreshUsersBtn.addEventListener('click', fetchUsers);
cancelUserBtn.addEventListener('click', () => { editUserModal.style.display = 'none'; });
saveUserBtn.addEventListener('click', saveUserDetails);
deleteUserBtn.addEventListener('click', deleteUser);

// Phase 2: Search / Filter / Export
document.getElementById('user-search').addEventListener('input', renderUserTable);
document.getElementById('user-class-filter').addEventListener('change', renderUserTable);
document.getElementById('export-csv-btn').addEventListener('click', exportUsersCSV);

// Push Broadcaster action
sendPushBtn.addEventListener('click', sendPushBroadcast);

// App Startup
window.addEventListener('load', async () => {
  initMap();
  setupTabs();
  
  const token = getAdminToken();
  if (token) {
    const verified = await fetchStats();
    if (verified) {
      authModal.style.display = 'none';
      initSockets();
      setTimeout(() => map.invalidateSize(), 150);
    } else {
      authModal.style.display = 'flex';
    }
  } else {
    authModal.style.display = 'flex';
  }
});
