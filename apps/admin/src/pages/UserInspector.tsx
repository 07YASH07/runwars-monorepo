import React, { useEffect, useState } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import { Search, Trash2, Edit } from 'lucide-react';

const baseUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;

export default function UserInspector() {
  const { token } = useAdminAuth();
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    characterType: 'scout',
    color: '#00BFFF',
    bio: ''
  });
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

  const startEdit = (user: any) => {
    setEditingUser(user);
    setEditForm({
      displayName: user.display_name || '',
      characterType: user.character_type?.toLowerCase() || 'scout',
      color: user.color || '#00BFFF',
      bio: user.bio || ''
    });
  };

  const handleUpdate = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/admin/user/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token! },
        body: JSON.stringify({
          userId: editingUser.id,
          displayName: editForm.displayName,
          characterType: editForm.characterType,
          color: editForm.color,
          bio: editForm.bio
        })
      });
      if (res.ok) {
        setEditingUser(null);
        fetchUsers();
      } else {
        alert('Failed to update user.');
      }
    } catch (err) {
      alert('Error updating user.');
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
                        <button className="btn btn-secondary" style={{ padding: '8px' }} onClick={() => startEdit(u)}><Edit size={16} /></button>
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

      {/* Edit User Modal */}
      {editingUser && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-panel animate-fade-in" style={{ padding: '32px', maxWidth: '450px', width: '90%', border: '1px solid var(--border)' }}>
            <h2 style={{ marginBottom: '24px', fontSize: '20px', color: 'var(--text-primary)', fontWeight: 800 }}>Edit User Details</h2>
            
            <div className="input-group">
              <label className="input-label">Display Name</label>
              <input 
                type="text" 
                className="input-field" 
                value={editForm.displayName} 
                onChange={e => setEditForm({ ...editForm, displayName: e.target.value })} 
              />
            </div>

            <div className="input-group">
              <label className="input-label">Character Class</label>
              <select 
                className="input-field" 
                value={editForm.characterType} 
                onChange={e => setEditForm({ ...editForm, characterType: e.target.value })}
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              >
                <option value="scout">Scout</option>
                <option value="juggernaut">Juggernaut</option>
                <option value="infiltrator">Infiltrator</option>
                <option value="commander">Commander</option>
              </select>
            </div>

            <div className="input-group">
              <label className="input-label">Theme Color (HEX)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="color" 
                  value={editForm.color} 
                  onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                  style={{ width: '40px', height: '40px', border: 'none', background: 'none', cursor: 'pointer' }}
                />
                <input 
                  type="text" 
                  className="input-field" 
                  value={editForm.color} 
                  onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            <div className="input-group" style={{ marginBottom: '24px' }}>
              <label className="input-label">Bio</label>
              <textarea 
                className="input-field" 
                rows={3} 
                value={editForm.bio} 
                onChange={e => setEditForm({ ...editForm, bio: e.target.value })} 
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpdate}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
