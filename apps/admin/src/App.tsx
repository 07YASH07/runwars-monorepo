import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext';
import AuthModal from './components/AuthModal';
import { LayoutDashboard, LineChart, Users, Send, ShieldAlert, LogOut } from 'lucide-react';

// Placeholder Pages
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import UserInspector from './pages/UserInspector';
import PushBroadcaster from './pages/PushBroadcaster';

const Sidebar = () => {
  const { logout } = useAdminAuth();
  
  return (
    <div className="sidebar">
      <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border)' }}>
        <ShieldAlert color="var(--accent-blue)" />
        <h2 style={{ fontSize: '18px', margin: 0, letterSpacing: '1px' }}>StrideClash <span style={{ color: 'var(--accent-blue)' }}>Ops</span></h2>
      </div>
      
      <nav style={{ padding: '24px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <NavLink 
          to="/" 
          style={({isActive}) => ({
            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '8px',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(0, 191, 255, 0.1)' : 'transparent',
            textDecoration: 'none', fontWeight: 600
          })}
        >
          <LayoutDashboard size={20} /> Dashboard
        </NavLink>
        <NavLink 
          to="/analytics" 
          style={({isActive}) => ({
            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '8px',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(0, 191, 255, 0.1)' : 'transparent',
            textDecoration: 'none', fontWeight: 600
          })}
        >
          <LineChart size={20} /> Analytics
        </NavLink>
        <NavLink 
          to="/users" 
          style={({isActive}) => ({
            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '8px',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(0, 191, 255, 0.1)' : 'transparent',
            textDecoration: 'none', fontWeight: 600
          })}
        >
          <Users size={20} /> User Inspector
        </NavLink>
        <NavLink 
          to="/push" 
          style={({isActive}) => ({
            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '8px',
            color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(0, 191, 255, 0.1)' : 'transparent',
            textDecoration: 'none', fontWeight: 600
          })}
        >
          <Send size={20} /> Push Broadcaster
        </NavLink>
      </nav>
      
      <div style={{ padding: '24px' }}>
        <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={logout}>
          <LogOut size={16} /> Lock Panel
        </button>
      </div>
    </div>
  );
};

const AdminLayout = () => {
  const { token } = useAdminAuth();

  if (!token) {
    return <AuthModal />;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/users" element={<UserInspector />} />
          <Route path="/push" element={<PushBroadcaster />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AdminAuthProvider>
      <Router basename="/admin">
        <AdminLayout />
      </Router>
    </AdminAuthProvider>
  );
}
