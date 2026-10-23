import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, Landmark, ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Button, Field, Input } from '../components/ui.jsx';

const DEMO = [
  { role: 'Administrator', email: 'admin@ledgerpos.local', password: 'Admin@123' },
  { role: 'Manager', email: 'manager@ledgerpos.local', password: 'Manager@123' },
  { role: 'Accountant', email: 'accountant@ledgerpos.local', password: 'Account@123' },
  { role: 'Cashier', email: 'cashier@ledgerpos.local', password: 'Cashier@123' },
  { role: 'Storekeeper', email: 'store@ledgerpos.local', password: 'Store@123' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      const to = location.state?.from?.pathname || '/';
      navigate(to, { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  function useDemo(account) {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
  }

  return (
    <div className="login-screen">
      <section className="login-art">
        <div>
          <div className="login-logo">
            <span className="brand-mark"><Landmark size={22} /></span>
            <div>
              <div className="brand-name" style={{ fontSize: 18 }}>Ledger POS</div>
              <div className="brand-sub">Point of sale · Double-entry accounting</div>
            </div>
          </div>
          <h1>Every sale tells<br />a <em>balanced story.</em></h1>
          <p>
            A point of sale built on a real general ledger. Ring up customers at the counter
            and watch cash, inventory, tax and revenue stay in perfect balance — automatically.
          </p>
          <div className="login-features">
            <div className="login-feature">
              <BookOpenCheck size={17} />
              <div><b>Double-entry core</b><span>Every transaction posts a journal.</span></div>
            </div>
            <div className="login-feature">
              <Wallet size={17} />
              <div><b>Counter cash control</b><span>Open, count and reconcile drawers.</span></div>
            </div>
            <div className="login-feature">
              <ShieldCheck size={17} />
              <div><b>Role-based access</b><span>Five roles with scoped views.</span></div>
            </div>
            <div className="login-feature">
              <Landmark size={17} />
              <div><b>Live financials</b><span>P&amp;L, balance sheet and aging.</span></div>
            </div>
          </div>
        </div>
        <div className="login-art-foot">© {new Date().getFullYear()} Ledger POS · Built for independent retail</div>
      </section>

      <section className="login-form-side">
        <form className="login-form" onSubmit={submit}>
          <h2>Welcome back</h2>
          <p>Sign in to your counter or back-office workspace.</p>
          {error && <div className="login-error">{error}</div>}

          <Field label="Email address">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              required
              autoFocus
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" size="lg" loading={loading} iconRight={ArrowRight} style={{ width: '100%', marginTop: 4 }}>
            Sign in
          </Button>

          <div className="demo-box">
            <div className="label">Demo accounts — click to fill</div>
            {DEMO.map((account) => (
              <div className="demo-row" key={account.email} onClick={() => useDemo(account)}>
                <span>{account.role}</span>
                <span>{account.email}</span>
              </div>
            ))}
          </div>
        </form>
      </section>
    </div>
  );
}
