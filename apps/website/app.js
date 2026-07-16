/* ============================================================
   StrideClash JavaScript - Interactive Client-Side App Logic
   ============================================================ */

const BACKEND_URL = 'https://runwars-v2.onrender.com';

// State Management
let currentActivity = 'all';
let currentMetric = 'territory';

document.addEventListener('DOMContentLoaded', () => {
  // Initial Leaderboard Fetch
  loadLeaderboard();

  // Bind Leaderboard Filter Buttons
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const parentGroup = e.target.parentElement;
      // Deactivate siblings in this specific group
      parentGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      // Activate clicked button
      e.target.classList.add('active');

      // Update state
      if (e.target.hasAttribute('data-activity')) {
        currentActivity = e.target.getAttribute('data-activity');
      } else if (e.target.hasAttribute('data-metric')) {
        currentMetric = e.target.getAttribute('data-metric');
      }

      // Re-fetch rankings
      loadLeaderboard();
    });
  });

  // Bind Form Submission
  const betaForm = document.getElementById('beta-form');
  const formSuccess = document.getElementById('form-success');
  const resetFormBtn = document.getElementById('reset-form-btn');

  if (betaForm) {
    betaForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const platform = document.getElementById('platform').value;
      const feedback = document.getElementById('feedback').value;

      // Create a submission payload
      const payload = {
        name,
        email,
        platform,
        feedback,
        submittedAt: new Date().toISOString()
      };

      console.log('[Beta Form] Submission payload:', payload);

      // Save submission details locally in browser DB for user session verification
      let submissions = JSON.parse(localStorage.getItem('strideclash_beta_submissions') || '[]');
      submissions.push(payload);
      localStorage.setItem('strideclash_beta_submissions', JSON.stringify(submissions));

      // Post to mock server endpoint or logs
      fetch(`${BACKEND_URL}/register-tester`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        console.log('[Beta Form] Backend confirmation received:', data);
      })
      .catch(err => {
        // Fallback gracefully since this endpoint is a client-signup request
        console.warn('[Beta Form] Backend route is offline. Submission saved locally:', err.message);
      });

      // Show success screen with transition
      betaForm.classList.add('hidden');
      betaForm.style.display = 'none';
      formSuccess.classList.remove('hidden');
      formSuccess.style.display = 'block';
    });
  }

  if (resetFormBtn) {
    resetFormBtn.addEventListener('click', () => {
      betaForm.reset();
      formSuccess.classList.add('hidden');
      formSuccess.style.display = 'none';
      betaForm.classList.remove('hidden');
      betaForm.style.display = 'block';
    });
  }

  // Initialize Live Conquest Map
  initializeMap();
});

// Fetch Rankings & Render Leaderboard Table
async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboard-rows');
  if (!tbody) return;

  // Show loading skeleton rows
  tbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="6">Fetching latest live results from StrideClash servers...</td>
    </tr>
  `;

  try {
    const response = await fetch(`${BACKEND_URL}/leaderboard?activity=${currentActivity}&metric=${currentMetric}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    renderLeaderboardRows(data);
  } catch (err) {
    console.error('[Leaderboard] Fetch failure:', err.message);
    tbody.innerHTML = `
      <tr class="loading-row">
        <td colspan="6" style="color: var(--accent-red);">
          ⚠️ Failed to sync with game servers. Showing offline demonstration data below:
        </td>
      </tr>
    `;
    // Load offline demo data
    renderLeaderboardRows(getOfflineDemoData());
  }
}

// Generate rows and inject into DOM
function renderLeaderboardRows(users) {
  const tbody = document.getElementById('leaderboard-rows');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr class="loading-row">
        <td colspan="6">No activity records found for this category yet. Start running to claim rank #1!</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';

  users.forEach((user, index) => {
    const rank = index + 1;
    let rankClass = '';
    if (rank <= 3) {
      rankClass = `rank-${rank}`;
    }

    const tr = document.createElement('tr');
    
    // Format numeric values
    const distanceKm = user.total_distance ? (user.total_distance / 1000).toFixed(2) : '0.00';
    const areaSqM = user.total_territory ? Math.round(user.total_territory).toLocaleString() : '0';
    const zones = user.total_zones || 0;
    const runs = user.total_runs || 0;
    const teamColor = user.color || '#00f2fe';
    const selectedAvatar = user.character_type || '🏃';

    tr.innerHTML = `
      <td><span class="rank-badge ${rankClass}">${rank}</span></td>
      <td>
        <div class="player-cell">
          <span class="color-dot" style="color: ${teamColor}; background-color: ${teamColor};"></span>
          <span class="player-avatar">${selectedAvatar}</span>
          <span class="player-name">${user.display_name || 'Anonymous User'}</span>
        </div>
      </td>
      <td>${areaSqM} m²</td>
      <td>${zones}</td>
      <td>${distanceKm} km</td>
      <td>${runs}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Demo data fallback in case backend is offline / sleeping
function getOfflineDemoData() {
  const mockData = [
    { display_name: 'Yash', character_type: '🥷', color: '#ff6a00', total_territory: 245000, total_zones: 48, total_distance: 145200, total_runs: 28 },
    { display_name: 'Alex_Run', character_type: '🏃', color: '#00f2fe', total_territory: 189000, total_zones: 37, total_distance: 98400, total_runs: 19 },
    { display_name: 'Cyborg_Fit', character_type: '🤖', color: '#9c27b0', total_territory: 154000, total_zones: 31, total_distance: 112500, total_runs: 24 },
    { display_name: 'Rivalconqueror', character_type: '🧙', color: '#ff3366', total_territory: 121000, total_zones: 25, total_distance: 74200, total_runs: 15 },
    { display_name: 'FitWarrior', character_type: '⚔️', color: '#4caf50', total_territory: 94000, total_zones: 18, total_distance: 54000, total_runs: 12 }
  ];

  // Sort local fallback mock data based on active metrics
  if (currentMetric === 'distance') {
    mockData.sort((a, b) => b.total_distance - a.total_distance);
  } else if (currentMetric === 'zones') {
    mockData.sort((a, b) => b.total_zones - a.total_zones);
  } else {
    mockData.sort((a, b) => b.total_territory - a.total_territory);
  }

  // Adjust distance depending on cycle / walk filters
  if (currentActivity === 'walk') {
    mockData.forEach(d => {
      d.total_distance = Math.round(d.total_distance * 0.4);
      d.total_runs = Math.round(d.total_runs * 0.8);
    });
  } else if (currentActivity === 'cycle') {
    mockData.forEach(d => {
      d.total_distance = Math.round(d.total_distance * 2.2);
    });
  }

  return mockData;
}

// ============================================================
// Leaflet Map Logic - Live Conquest Zones Display
// ============================================================
let mapObj;
let mapLayers = [];

function initializeMap() {
  if (!document.getElementById('conquest-map')) return;

  // New Delhi center Connaught Place coordinates
  const defaultCenter = [28.6304, 77.2177];
  
  // Initialize Leaflet map instance
  mapObj = L.map('conquest-map', {
    zoomControl: true,
    scrollWheelZoom: false
  }).setView(defaultCenter, 14);

  // Add CartoDB Dark Matter tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20
  }).addTo(mapObj);

  loadMapTerritories();
}

async function loadMapTerritories() {
  try {
    const response = await fetch(`${BACKEND_URL}/territories`);
    if (!response.ok) {
      throw new Error('Failed to fetch territories list');
    }
    const territories = await response.json();

    if (territories && territories.length > 0) {
      renderMapTerritories(territories);
    } else {
      console.warn('[Map] No active territories on server. Displaying offline demo sectors.');
      renderMapTerritories(getDemoMapTerritories());
    }
  } catch (err) {
    console.error('[Map] Fetch failure, loading offline demo data:', err.message);
    renderMapTerritories(getDemoMapTerritories());
  }
}

function renderMapTerritories(territories) {
  // Clear any existing polygons
  mapLayers.forEach(layer => mapObj.removeLayer(layer));
  mapLayers = [];

  const legendItems = document.getElementById('map-legend-items');
  if (legendItems) {
    legendItems.innerHTML = '';
  }

  const ownerStats = {};
  const bounds = [];

  territories.forEach(t => {
    // Resolve coordinates from model schema
    let coords = t.polygonCoordinates || t.polygon_coordinates;
    if (!coords || !Array.isArray(coords) || coords.length < 3) {
      return;
    }

    const color = t.color || '#00f2fe';
    const ownerName = t.ownerName || 'Runner';
    const speed = t.avgSpeedKmh || 0;
    const area = t.areaSquareMeters || t.area_square_meters || 0;
    const type = t.activityType || 'run';

    // Draw Leaflet polygon
    const polygon = L.polygon(coords, {
      color: color,
      fillColor: color,
      fillOpacity: 0.35,
      weight: 2
    }).addTo(mapObj);

    // Dynamic Leaflet Popup template
    const popupContent = `
      <div style="font-family: 'Outfit', sans-serif; color: #fff; padding: 4px; line-height: 1.4;">
        <h4 style="font-family: 'Rajdhani', sans-serif; margin-bottom: 6px; text-transform: uppercase; color: ${color}; font-size: 1.1rem; font-weight: 700; letter-spacing: 0.5px;">
          Sector #${t.id || 'Active'}
        </h4>
        <p style="margin: 2px 0; font-size: 0.9rem;"><b>Conquered by:</b> ${ownerName}</p>
        <p style="margin: 2px 0; font-size: 0.9rem;"><b>Avg Speed:</b> ${speed ? speed.toFixed(1) : '0.0'} km/h</p>
        <p style="margin: 2px 0; font-size: 0.9rem;"><b>Area:</b> ${Math.round(area).toLocaleString()} m²</p>
        <p style="margin: 2px 0; font-size: 0.9rem; text-transform: capitalize;"><b>Activity:</b> ${type}</p>
      </div>
    `;
    polygon.bindPopup(popupContent);
    mapLayers.push(polygon);

    // Collect coordinates bounds
    coords.forEach(pt => {
      bounds.push(L.latLng(pt[0], pt[1]));
    });

    // Update statistics
    if (!ownerStats[ownerName]) {
      ownerStats[ownerName] = { color: color, zones: 0 };
    }
    ownerStats[ownerName].zones += 1;
  });

  // Render list legend elements
  if (legendItems) {
    Object.keys(ownerStats).forEach(name => {
      const stats = ownerStats[name];
      const div = document.createElement('div');
      div.className = 'legend-item';
      div.innerHTML = `
        <span class="legend-color" style="background-color: ${stats.color}; box-shadow: 0 0 8px ${stats.color};"></span>
        <div class="legend-info">
          <span class="legend-name">${name}</span>
          <span class="legend-zones">${stats.zones} sector${stats.zones > 1 ? 's' : ''} claimed</span>
        </div>
      `;
      legendItems.appendChild(div);
    });
  }

  // Adjust zoom bounds automatically
  if (bounds.length > 0) {
    const latLngBounds = L.latLngBounds(bounds);
    mapObj.fitBounds(latLngBounds, { padding: [50, 50] });
  }
}

// Generate offline demo hexagons around Central Delhi center Connaught Place for display
function getDemoMapTerritories() {
  const centerLat = 28.6304;
  const centerLng = 77.2177;

  // Simple Hexagon coordinate generator helper
  const createHex = (cLat, cLng, size) => {
    const coords = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const latOffset = (size * Math.cos(angle)) / 111.32;
      const lngOffset = (size * Math.sin(angle)) / (111.32 * Math.cos(cLat * Math.PI / 180));
      coords.push([cLat + latOffset, cLng + lngOffset]);
    }
    return coords;
  };

  return [
    {
      id: 201,
      ownerName: 'Yash',
      color: '#ff6a00',
      avgSpeedKmh: 14.5,
      areaSquareMeters: 45000,
      activityType: 'run',
      polygonCoordinates: createHex(centerLat + 0.002, centerLng + 0.003, 0.4)
    },
    {
      id: 202,
      ownerName: 'Alex_Run',
      color: '#00f2fe',
      avgSpeedKmh: 11.2,
      areaSquareMeters: 45000,
      activityType: 'run',
      polygonCoordinates: createHex(centerLat - 0.003, centerLng - 0.002, 0.4)
    },
    {
      id: 203,
      ownerName: 'Cyborg_Fit',
      color: '#bd00ff',
      avgSpeedKmh: 22.4,
      areaSquareMeters: 45000,
      activityType: 'cycle',
      polygonCoordinates: createHex(centerLat + 0.004, centerLng - 0.004, 0.4)
    },
    {
      id: 204,
      ownerName: 'Rivalconqueror',
      color: '#ff3366',
      avgSpeedKmh: 6.8,
      areaSquareMeters: 45000,
      activityType: 'walk',
      polygonCoordinates: createHex(centerLat - 0.001, centerLng + 0.005, 0.4)
    }
  ];
}

