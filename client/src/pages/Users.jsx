import { useMemo, useState } from 'react';
import {
  Edit3, KeyRound, Plus, Search, ShieldCheck, UserCog, UserRoundPlus, Users as UsersIcon,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, Input, LoadingBlock, Modal, PageHeader,
  Select, Stat,
} from '../components/ui.jsx';

const ROLE_TONE = {
  admin: 'danger',
  manager: 'purple',
  accountant: 'info',
  cashier: 'brand',
  storekeeper: 'warning',
};

const ROLE_DESCRIPTIONS = {
  admin: 'Full access: users, settings, accounts, mappings, voids.',
  manager: 'Store operations, reports, catalogue, inventory, settings.',
  accountant: 'Ledger, reports, purchasing and customer balances. No POS.',
  cashier: 'Point of sale, own sales, returns and own cash drawer.',
  storekeeper: 'Catalogue, inventory, purchasing and suppliers. No POS.',
};

const blankUser = { name: '', email: '', password: '', role: 'cashier', phone: '', location_id: '', is_active: true };

export default function Users() {
  const { user: me } = useAuth();
  const { dateTime, date } = useFormat();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(blankUser);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const usersApi = useApi('/users');
  const locationsApi = useApi('/locations');
  const users = usersApi.data?.users || [];
  const roles = usersApi.data?.roles || ['admin', 'manager', 'accountant', 'cashier', 'storekeeper'];
  const locations = (locationsApi.data?.locations || []).filter((l) => l.is_active !== false);

  const filtered = useMemo(() => {
    const term = debounced.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => [u.name, u.email, u.role, u.location_name].some((v) => String(v || '').toLowerCase().includes(term)));
  }, [users, debounced]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.is_active).length,
    admins: users.filter((u) => u.role === 'admin').length,
    cashiers: users.filter((u) => u.role === 'cashier').length,
  }), [users]);

  const canManage = me.role === 'admin';

  function openCreate() {
    setEditId(null);
    setForm({ ...blankUser, location_id: String(me.location_id || locations[0]?.id || '') });
    setError('');
    setModalOpen(true);
  }

  function openEdit(u) {
    setEditId(u.id);
    setForm({
      name: u.name || '', email: u.email || '', password: '', role: u.role,
      phone: u.phone || '', location_id: u.location_id || '', is_active: u.is_active !== false,
    });
    setError('');
    setModalOpen(true);
  }

  async function submitUser(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Name is required.');
    if (!form.email.trim()) return setError('Email is required.');
    if (!editId && String(form.password).length < 6) return setError('Password must be at least 6 characters.');
    if (editId && form.password && String(form.password).length < 6) return setError('Password must be at least 6 characters.');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        phone: form.phone || undefined,
        location_id: form.location_id ? Number(form.location_id) : null,
      };
      if (form.password) payload.password = form.password;
      if (editId) {
        payload.is_active = form.is_active;
        await api.put(`/users/${editId}`, payload);
        toast.success('User updated');
      } else {
        await api.post('/users', payload);
        toast.success('User created');
      }
      setModalOpen(false);
      usersApi.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Users & roles"
        subtitle="Control who can sell, post entries and administer the system."
        actions={canManage ? <Button icon={UserRoundPlus} onClick={openCreate}>New user</Button> : null}
      />

      <div className="stat-grid">
        <Stat label="Team members" value={stats.total} sub={`${stats.active} active`} icon={UsersIcon} tone="brand" />
        <Stat label="Cashiers" value={stats.cashiers} sub="Counter operators" icon={UserCog} tone="info" />
        <Stat label="Administrators" value={stats.admins} sub="Full system access" icon={ShieldCheck} tone="purple" />
      </div>

      <Card>
        <div className="toolbar">
          <div className="toolbar-left">
            <div className="search-input">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or role…" />
            </div>
          </div>
          <div className="toolbar-right"><Badge tone="neutral">{filtered.length} user(s)</Badge></div>
        </div>
      </Card>

      <Card noPad>
        {usersApi.loading && !usersApi.data ? <LoadingBlock /> : (
          <DataTable
            rows={filtered}
            empty="No users match this search"
            columns={[
              {
                key: 'name', header: 'User',
                render: (r) => (
                  <div className="contact-cell">
                    <span className="contact-avatar">{(r.name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}</span>
                    <div><b>{r.name}{r.id === me.id ? ' (you)' : ''}</b><span className="small muted">{r.email}</span></div>
                  </div>
                ),
              },
              { key: 'role', header: 'Role', render: (r) => <Badge tone={ROLE_TONE[r.role] || 'neutral'}>{r.role}</Badge> },
              { key: 'location_name', header: 'Location', render: (r) => r.location_name || <span className="muted">Unassigned</span> },
              { key: 'phone', header: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
              { key: 'last_login_at', header: 'Last login', render: (r) => (r.last_login_at ? dateTime(r.last_login_at) : <span className="muted">Never</span>) },
              { key: 'created_at', header: 'Joined', render: (r) => date(r.created_at) },
              { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Disabled'}</Badge> },
              { key: 'actions', header: '', align: 'right', render: (r) => (canManage ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => openEdit(r)}>Edit</Button> : null) },
            ]}
          />
        )}
      </Card>

      {canManage && (
        <Card title="Role permissions" subtitle="What each role can reach in the workspace">
          <div className="grid grid-2">
            {roles.map((role) => (
              <div className="list-row" key={role}>
                <Badge tone={ROLE_TONE[role] || 'neutral'}>{role}</Badge>
                <span className="small muted">{ROLE_DESCRIPTIONS[role]}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editId ? 'Edit user' : 'New user'}
        subtitle={editId ? 'Update profile, role or reset the password.' : 'Create a login and assign the right role.'}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button icon={editId ? KeyRound : Plus} onClick={submitUser} loading={saving}>{editId ? 'Save changes' : 'Create user'}</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitUser}>
          {error && <div className="info-note danger">{error}</div>}
          <div className="grid grid-2">
            <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Location">
              <Select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                <option value="">Unassigned</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={editId ? 'New password' : 'Password'} hint={editId ? 'Leave blank to keep current password' : 'At least 6 characters'}>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editId ? '••••••' : 'Password'} autoComplete="new-password" />
            </Field>
          </div>
          {editId && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.is_active}
                disabled={editId === me.id}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active — can sign in
              {editId === me.id && <span className="tiny muted"> (you cannot disable your own account)</span>}
            </label>
          )}
          <div className="info-note">
            <div>{ROLE_DESCRIPTIONS[form.role]}</div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
