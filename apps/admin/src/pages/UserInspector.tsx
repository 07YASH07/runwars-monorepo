import React, { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { Search, Trash2, Edit } from 'lucide-react';

const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export default function UserInspector() {
  const { token } = useAdminAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { 'x-admin-token': token! }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [token]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this user?')) return;
    try {
      const res = await fetch(`${baseUrl}/api/admin/user/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': token! }
      });
      if (res.ok) {
        setUsers(users.filter(u => u.id !== id));
      } else {
        alert('Failed to delete user.');
      }
    } catch (err) {
      alert('Error deleting user.');
    }
  };

  const filteredUsers = users.filter(u => 
    u.display_name?.toLowerCase().includes(search.toLowerCase()) || 
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '28px', color: 'var(--text-primary)' }}>User Inspector</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Manage players, view stats, and enforce moderation</p>
        </div>
        <button onClick={fetchUsers} className="btn btn-secondary">Refresh List</button>
      </div>

      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: '16px', top: '13px', color: 'var(--text-secondary)' }} />
            <input 
              type="text" 
              className="input-field" 
              placeholder="Search by name or email..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: '44px' }}
            />
          </div>
          <button className="btn btn-primary">Export CSV</button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '16px 12px', fontWeight: 600 }}>User</th>
                <th style={{ padding: '16px 12px', fontWeight: 600 }}>Email</th>
                <th style={{ padding: '16px 12px', fontWeight: 600 }}>Class</th>
                <th style={{ padding: '16px 12px', fontWeight: 600 }}>Coins</th>
                <th style={{ padding: '16px 12px', fontWeight: 600 }}>Distance (km)</th>
                <th style={{ padding: '16px 12px', fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' }}>Loading users...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' }}>No users found.</td></tr>
              ) : (
                filteredUsers.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{u.display_name}</td>
                    <td style={{ padding: '16px 12px', color: 'var(--text-secondary)' }}>{u.email}</td>
                    <td style={{ padding: '16px 12px' }}>
                      <span style={{ 
                        padding: '4px 8px', 
                        borderRadius: '4px', 
                        fontSize: '12px', 
                        fontWeight: 'bold',
                        backgroundColor: `${u.color}22`,
                        color: u.color 
                      }}>
                        {u.character_type?.toUpperCase() || 'SCOUT'}
                      </span>
                    </td>
                    <td style={{ padding: '16px 12px', color: '#FFD700', fontWeight: 'bold' }}>{u.coins || 0}</td>
                    <td style={{ padding: '16px 12px', color: 'var(--text-primary)' }}>{((u.total_distance || 0) / 1000).toFixed(1)}</td>
                    <td style={{ padding: '16px 12px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-secondary" style={{ padding: '8px' }}><Edit size={16} /></button>
                        <button className="btn btn-danger" style={{ padding: '8px' }} onClick={() => handleDelete(u.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
