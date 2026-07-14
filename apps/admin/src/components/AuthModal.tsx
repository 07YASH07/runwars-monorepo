import React, { useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { ShieldAlert } from 'lucide-react';

export default function AuthModal() {
  const { login } = useAdminAuth();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    // Simple ping to backend to verify the token
    try {
      // In production, the backend might be on the same host, but in dev it might be localhost:3000
      const baseUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
      const res = await fetch(`${baseUrl}/api/admin/health-detail`, {
        headers: { 'x-admin-token': secret }
      });
      
      if (res.ok) {
        login(secret);
      } else {
        setError('Invalid Admin Secret Key');
      }
    } catch (err) {
      setError('Network error. Is the backend running?');
    }
  };

  return (
    <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="glass-panel" style={{ padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: 'rgba(0, 191, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00BFFF' }}>
            <ShieldAlert size={32} />
          </div>
        </div>
        
        <h2 style={{ marginBottom: '8px' }}>Admin Access Verification</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '14px' }}>
          Enter your StrideClash administration secret key to proceed.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input 
              type="password" 
              className="input-field" 
              placeholder="Enter Secret Key..." 
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setError(''); }}
              style={{ textAlign: 'center' }}
            />
          </div>
          
          {error && <div style={{ color: '#FF3B30', fontSize: '12px', marginBottom: '16px' }}>{error}</div>}
          
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Verify Access
          </button>
        </form>
      </div>
    </div>
  );
}
