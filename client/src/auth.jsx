import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, storage } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(storage.getUser());
  const [settings, setSettings] = useState(storage.getSettings());
  const [booting, setBooting] = useState(!!storage.getToken());

  useEffect(() => {
    let alive = true;
    async function boot() {
      if (!storage.getToken()) return setBooting(false);
      try {
        const data = await api.get('/auth/me');
        if (!alive) return;
        setUser(data.user);
        setSettings(data.settings);
        storage.save(null, data.user, data.settings);
      } catch {
        storage.clear();
        if (alive) { setUser(null); setSettings(null); }
      } finally {
        if (alive) setBooting(false);
      }
    }
    boot();
    const onUnauthorized = () => {
      storage.clear();
      setUser(null);
      setSettings(null);
    };
    window.addEventListener('ledgerpos:unauthorized', onUnauthorized);
    return () => { alive = false; window.removeEventListener('ledgerpos:unauthorized', onUnauthorized); };
  }, []);

  async function login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    storage.save(data.token, data.user, data.settings);
    setUser(data.user);
    setSettings(data.settings);
    return data.user;
  }

  function logout() {
    storage.clear();
    setUser(null);
    setSettings(null);
  }

  async function refresh() {
    const data = await api.get('/auth/me');
    setUser(data.user);
    setSettings(data.settings);
    storage.save(null, data.user, data.settings);
    return data;
  }

  function updateSettings(next) {
    setSettings(next);
    storage.updateSettings(next);
  }

  const can = (...roles) => !!user && roles.includes(user.role);
  const isManager = !!user && ['admin', 'manager'].includes(user.role);

  const value = useMemo(() => ({
    user, settings, booting, login, logout, refresh, can, isManager, updateSettings,
  }), [user, settings, booting]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useCompany() {
  const { settings } = useAuth();
  return settings?.company || { name: 'Ledger POS', currency: 'USD', currency_symbol: '$', currency_decimals: 2 };
}
