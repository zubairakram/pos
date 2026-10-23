import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, BookOpen, Boxes, ChevronRight, LayoutDashboard, LogOut, Menu,
  Package, ReceiptText, RotateCcw, ScanLine, Settings as SettingsIcon, ShoppingCart,
  Truck, UserCog, Users, Wallet, Warehouse, X,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth, useCompany } from '../auth.jsx';
import { useFormat } from '../format.js';

const NAV = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'manager', 'accountant', 'cashier', 'storekeeper'] },
    ],
  },
  {
    label: 'Selling',
    items: [
      { to: '/pos', label: 'Point of Sale', icon: ScanLine, roles: ['admin', 'manager', 'cashier'] },
      { to: '/sales', label: 'Sales', icon: ReceiptText, roles: ['admin', 'manager', 'accountant', 'cashier'] },
      { to: '/returns', label: 'Returns', icon: RotateCcw, roles: ['admin', 'manager', 'accountant', 'cashier'] },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/products', label: 'Products', icon: Package, roles: ['admin', 'manager', 'accountant', 'storekeeper'] },
      { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['admin', 'manager', 'accountant', 'storekeeper'] },
    ],
  },
  {
    label: 'Buying',
    items: [
      { to: '/purchases', label: 'Purchases', icon: ShoppingCart, roles: ['admin', 'manager', 'accountant', 'storekeeper'] },
      { to: '/suppliers', label: 'Suppliers', icon: Truck, roles: ['admin', 'manager', 'accountant', 'storekeeper'] },
    ],
  },
  {
    label: 'Relationships',
    items: [
      { to: '/customers', label: 'Customers', icon: Users, roles: ['admin', 'manager', 'accountant', 'cashier'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/cash', label: 'Cash & Drawers', icon: Wallet, roles: ['admin', 'manager', 'cashier'] },
      { to: '/accounting', label: 'Accounting', icon: BookOpen, roles: ['admin', 'manager', 'accountant'] },
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'manager', 'accountant'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users & Roles', icon: UserCog, roles: ['admin', 'manager', 'accountant'] },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['admin', 'manager'] },
    ],
  },
];

const TITLES = {
  '/': 'Dashboard',
  '/pos': 'Point of Sale',
  '/sales': 'Sales',
  '/returns': 'Returns',
  '/products': 'Products & Catalogue',
  '/inventory': 'Inventory',
  '/purchases': 'Purchases',
  '/suppliers': 'Suppliers',
  '/customers': 'Customers',
  '/cash': 'Cash & Drawers',
  '/accounting': 'Accounting',
  '/reports': 'Reports',
  '/users': 'Users & Roles',
  '/settings': 'Settings',
};

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const company = useCompany();
  const { money } = useFormat();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(null);

  const title = useMemo(() => {
    if (location.pathname.startsWith('/accounting')) return 'Accounting';
    return TITLES[location.pathname] || 'Ledger POS';
  }, [location.pathname]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!['admin', 'manager', 'cashier'].includes(user.role)) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const data = await api.get('/cash/sessions/current');
        if (alive) setSession(data.session);
      } catch {
        if (alive) setSession(null);
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [user.role, location.pathname]);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(user.role)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark"><Warehouse size={19} /></span>
          <div>
            <div className="brand-name">Ledger POS</div>
            <div className="brand-sub">Sales & Accounting</div>
          </div>
          <button className="icon-btn menu-toggle" style={{ marginLeft: 'auto', color: '#94a3b8' }} onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-scroll">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                  {item.to === '/cash' && session && <span className="nav-count">Open</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar">{initials(user.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="name truncate">{user.name}</div>
              <div className="role">{user.role}</div>
            </div>
            <button onClick={handleLogout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <span className="topbar-title">{title}</span>
          <ChevronRight size={13} className="muted" />
          <span className="topbar-crumb truncate">{company.name}</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-date">
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          {['admin', 'manager', 'cashier'].includes(user.role) && (
            <button
              className={`session-pill ${session ? 'open' : ''}`}
              onClick={() => navigate('/cash')}
              title={session ? `${session.register_name} — expected ${money(session.expected_cash)}` : 'No open cash drawer'}
            >
              <i className="dot" />
              {session ? `${session.register_name} · ${money(session.expected_cash)}` : 'Open drawer'}
            </button>
          )}
          <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>{user.role}</span>
        </div>
      </header>

      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
