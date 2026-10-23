import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import Sales from './pages/Sales.jsx';
import Returns from './pages/Returns.jsx';
import Products from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import Purchases from './pages/Purchases.jsx';
import Customers from './pages/Customers.jsx';
import Suppliers from './pages/Suppliers.jsx';
import Cash from './pages/Cash.jsx';
import Accounting from './pages/Accounting.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

const ALL = ['admin', 'manager', 'accountant', 'cashier', 'storekeeper'];

function Protected({ children }) {
  const { user, booting } = useAuth();
  if (booting) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="spinner-block"><Loader2 className="spin" size={24} /><span>Loading workspace…</span></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Allowed({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/*"
        element={(
          <Protected>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/pos" element={<Allowed roles={['admin', 'manager', 'cashier']}><POS /></Allowed>} />
                <Route path="/sales" element={<Allowed roles={['admin', 'manager', 'accountant', 'cashier']}><Sales /></Allowed>} />
                <Route path="/returns" element={<Allowed roles={['admin', 'manager', 'accountant', 'cashier']}><Returns /></Allowed>} />
                <Route path="/products" element={<Allowed roles={['admin', 'manager', 'accountant', 'storekeeper']}><Products /></Allowed>} />
                <Route path="/inventory" element={<Allowed roles={['admin', 'manager', 'accountant', 'storekeeper']}><Inventory /></Allowed>} />
                <Route path="/purchases" element={<Allowed roles={['admin', 'manager', 'accountant', 'storekeeper']}><Purchases /></Allowed>} />
                <Route path="/customers" element={<Allowed roles={['admin', 'manager', 'accountant', 'cashier']}><Customers /></Allowed>} />
                <Route path="/suppliers" element={<Allowed roles={['admin', 'manager', 'accountant', 'storekeeper']}><Suppliers /></Allowed>} />
                <Route path="/cash" element={<Allowed roles={['admin', 'manager', 'cashier']}><Cash /></Allowed>} />
                <Route path="/accounting" element={<Allowed roles={['admin', 'manager', 'accountant']}><Accounting /></Allowed>} />
                <Route path="/reports" element={<Allowed roles={['admin', 'manager', 'accountant']}><Reports /></Allowed>} />
                <Route path="/users" element={<Allowed roles={['admin', 'manager', 'accountant']}><Users /></Allowed>} />
                <Route path="/settings" element={<Allowed roles={['admin', 'manager']}><Settings /></Allowed>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </Protected>
        )}
      />
    </Routes>
  );
}
