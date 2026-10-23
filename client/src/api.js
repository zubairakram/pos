const TOKEN_KEY = 'ledgerpos.token';
const USER_KEY = 'ledgerpos.user';
const SETTINGS_KEY = 'ledgerpos.settings';

export const storage = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  getSettings: () => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch { return null; }
  },
  save: (token, user, settings) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  },
  updateUser: (user) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  updateSettings: (settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  },
};

export class ApiClientError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  let url = `/api${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = storage.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiClientError('Cannot reach the server. Is the API running?', 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new CustomEvent('ledgerpos:unauthorized'));
    }
    throw new ApiClientError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

export const qs = (obj) => {
  const s = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, v);
  });
  return s.toString();
};
