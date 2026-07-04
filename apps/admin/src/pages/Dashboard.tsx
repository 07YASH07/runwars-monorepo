import React, { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { io, Socket } from 'socket.io-client';
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export default function Dashboard() {
  const { token } = useAdminAuth();
  const [metrics, setMetrics] = useState({ sockets: 0, users: 0, territories: 0 });
  const [livePlayers, setLivePlayers] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    // Fetch initial health/metrics
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${baseUrl}/health`);
        const data = await res.json();
        setMetrics(m => ({ ...m, users: data.playersCount, territories: data.territoriesCount }));
      } catch (err) {
        console.error(err);
      }
    };
    fetchHealth();

    // Connect Socket
    const newSocket = io(baseUrl, { auth: { token } });
    
    newSocket.on('connect', () => {
      setLogs(l => [...l, `[System] Socket connected: ${newSocket.id}`].slice(-50));
    });

    newSocket.on('livePlayersUpdate', (players) => {
      setLivePlayers(players);
      setMetrics(m => ({ ...m, sockets: players.length }));
    });

    newSocket.on('territoriesUpdate', (terrs) => {
      setTerritories(terrs);
      setMetrics(m => ({ ...m, territories: terrs.length }));
    });

    newSocket.on('territoryClaimed', (t) => {
      setLogs(l => [...l, `[Map] Territory ${t.id} claimed by ${t.userId}`].slice(-50));
    });

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '28px', color: 'var(--text-primary)' }}>Live Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Real-time overview of the Arena</p>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-blue)' }}>{metrics.sockets}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>Live Connections</div>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-green)' }}>{livePlayers.length}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>Active Runners</div>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--accent-yellow)' }}>{metrics.territories}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>Claimed Zones</div>
        </div>
      </div>

      {/* Main Row: Map and Logs */}
      <div style={{ display: 'flex', gap: '24px', height: '500px' }}>
        <div className="glass-panel" style={{ flex: 2, padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px', textTransform: 'uppercase' }}>Live Map</h3>
          <div style={{ flex: 1, borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <MapContainer center={[37.7749, -122.4194]} zoom={12} style={{ height: '100%', width: '100%', background: '#0a0a14' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              {territories.map(t => (
                <Polygon
                  key={t.id}
                  positions={t.polygonCoordinates.map((c: any) => [c.latitude, c.longitude])}
                  pathOptions={{ color: t.color || '#00BFFF', fillColor: t.color || '#00BFFF', fillOpacity: 0.3, weight: 2 }}
                >
                  <Tooltip>{t.ownerName || t.userId}</Tooltip>
                </Polygon>
              ))}
              {livePlayers.map(p => {
                if (!p.currentPosition?.latitude) return null;
                return (
                  <CircleMarker
                    key={p.userId}
                    center={[p.currentPosition.latitude, p.currentPosition.longitude]}
                    pathOptions={{ color: p.color || '#32CD32', fillColor: p.color || '#32CD32', fillOpacity: 0.8 }}
                    radius={6}
                  >
                    <Tooltip permanent direction="top" opacity={0.9}>{p.displayName}</Tooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </div>

        <div className="glass-panel" style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px', textTransform: 'uppercase' }}>System Stream</h3>
          <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '8px', padding: '12px', overflowY: 'auto', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: '12px', color: '#a0a0a0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {logs.length === 0 ? <div>No activity yet...</div> : logs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
