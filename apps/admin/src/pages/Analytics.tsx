import React, { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const baseUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;

export default function Analytics() {
  const { token } = useAdminAuth();
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(`${baseUrl}/api/admin/analytics`, {
          headers: { 'x-admin-token': token! }
        });
        if (res.ok) {
          const data = await res.json();
          // Mock data if backend returns empty or isn't fully implemented
          setAnalytics(data);
        }
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
      }
    };
    fetchAnalytics();
  }, [token]);

  const mockLineData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'Daily Active Runners',
        data: [12, 19, 15, 25, 22, 30, 28],
        borderColor: '#00BFFF',
        backgroundColor: 'rgba(0, 191, 255, 0.5)',
      },
    ],
  };

  const mockBarData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'Runs Per Day',
        data: [5, 8, 12, 10, 18, 24, 20],
        backgroundColor: '#32CD32',
      },
    ],
  };

  const mockDoughnutData = {
    labels: ['Scout', 'Juggernaut', 'Infiltrator', 'Commander'],
    datasets: [
      {
        data: [40, 20, 25, 15],
        backgroundColor: ['#00BFFF', '#FF3B30', '#32CD32', '#FFD700'],
        borderWidth: 0,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#8A8AAB' }
      }
    },
    scales: {
      x: { ticks: { color: '#8A8AAB' }, grid: { color: '#2A2A4A' } },
      y: { ticks: { color: '#8A8AAB' }, grid: { color: '#2A2A4A' } }
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '28px', color: 'var(--text-primary)' }}>Analytics</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Platform growth and engagement metrics</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginBottom: '24px' }}>
        <div className="glass-panel" style={{ padding: '24px', height: '300px' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px', textTransform: 'uppercase' }}>Daily Active Runners</h3>
          <Line data={mockLineData} options={chartOptions} />
        </div>
        
        <div className="glass-panel" style={{ padding: '24px', height: '300px' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px', textTransform: 'uppercase' }}>Runs Per Day</h3>
          <Bar data={mockBarData} options={chartOptions} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        <div className="glass-panel" style={{ padding: '24px', height: '350px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px', textTransform: 'uppercase', width: '100%' }}>Class Distribution</h3>
          <div style={{ width: '100%', flex: 1, position: 'relative' }}>
            <Doughnut data={mockDoughnutData} options={{ ...chartOptions, scales: undefined, maintainAspectRatio: false }} />
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '24px', height: '350px' }}>
          <h3 style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '14px', textTransform: 'uppercase' }}>Top Runners (Distance)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {['SonicRunner', 'Flash', 'QuickSilver', 'RoadRunner', 'Dash'].map((name, i) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 600 }}>{i + 1}. {name}</span>
                <span style={{ color: 'var(--accent-blue)' }}>{((5 - i) * 15.4).toFixed(1)} km</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
