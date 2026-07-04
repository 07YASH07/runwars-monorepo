import React, { useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { Rocket, Megaphone } from 'lucide-react';

const baseUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;

export default function PushBroadcaster() {
  const { token } = useAdminAuth();
  
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');

  const sendPush = async () => {
    if (!pushTitle || !pushBody) return alert('Fill all fields');
    try {
      const res = await fetch(`${baseUrl}/api/admin/broadcast-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token! },
        body: JSON.stringify({ title: pushTitle, body: pushBody })
      });
      if (res.ok) {
        alert('Push Broadcast Sent!');
        setPushTitle(''); setPushBody('');
      } else {
        alert('Failed to send push.');
      }
    } catch (err) {
      alert('Network Error');
    }
  };

  const sendAnnouncement = async () => {
    if (!annTitle || !annBody) return alert('Fill all fields');
    try {
      const res = await fetch(`${baseUrl}/api/admin/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token! },
        body: JSON.stringify({ title: annTitle, body: annBody })
      });
      if (res.ok) {
        alert('Announcement Published to Feed!');
        setAnnTitle(''); setAnnBody('');
      } else {
        alert('Failed to publish announcement.');
      }
    } catch (err) {
      alert('Network Error');
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '28px', color: 'var(--text-primary)' }}>Push Broadcaster</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Send live notifications and announcements</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
        
        {/* Push Notification Card */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '10px', background: 'rgba(0, 191, 255, 0.1)', borderRadius: '8px', color: 'var(--accent-blue)' }}>
              <Rocket size={24} />
            </div>
            <h2 style={{ fontSize: '20px' }}>Global Push Alert</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            Send an instant Expo Push Notification to all active registered devices. Appears on the lock screen.
          </p>
          
          <div className="input-group">
            <label className="input-label">Notification Title</label>
            <input className="input-field" placeholder="e.g. ⚔️ Weekend Conquest is LIVE!" value={pushTitle} onChange={e => setPushTitle(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: '24px' }}>
            <label className="input-label">Message Body</label>
            <textarea className="input-field" rows={4} placeholder="e.g. Double Area Coins for the next 48 hours. Get running!" value={pushBody} onChange={e => setPushBody(e.target.value)} />
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', padding: '14px' }} onClick={sendPush}>
            Broadcast to All Users
          </button>
        </div>

        {/* Announcement Card */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '10px', background: 'rgba(50, 205, 50, 0.1)', borderRadius: '8px', color: 'var(--accent-green)' }}>
              <Megaphone size={24} />
            </div>
            <h2 style={{ fontSize: '20px' }}>Feed Announcement</h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
            Publish a persistent announcement to the global Social Feed inside the mobile app.
          </p>
          
          <div className="input-group">
            <label className="input-label">Announcement Title</label>
            <input className="input-field" placeholder="e.g. 🏆 Season 1 Winners" value={annTitle} onChange={e => setAnnTitle(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: '24px' }}>
            <label className="input-label">Announcement Body</label>
            <textarea className="input-field" rows={4} placeholder="e.g. Congratulations to our top runners this month..." value={annBody} onChange={e => setAnnBody(e.target.value)} />
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', padding: '14px', background: 'var(--accent-green)' }} onClick={sendAnnouncement}>
            Publish to Social Feed
          </button>
        </div>

      </div>
    </div>
  );
}
