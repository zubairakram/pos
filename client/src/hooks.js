import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Small data-fetching helper. Re-runs whenever the serialised params change.
 * Returns { data, loading, error, reload }.
 */
export function useApi(path, params, { enabled = true } = {}) {
  const key = path ? `${path}?${JSON.stringify(params || {})}` : null;
  const [state, setState] = useState({ data: null, loading: !!enabled && !!path, error: null });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !path) {
      setState({ data: null, loading: false, error: null });
      return null;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path, params);
      if (mounted.current) setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      if (mounted.current) setState({ data: null, loading: false, error });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

export function useDebounced(value, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Loads the common reference data used across screens. */
export function useLookups() {
  const [lookups, setLookups] = useState({
    locations: [], categories: [], units: [], taxes: [], methods: [], accounts: [],
  });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.get('/locations'), api.get('/categories'), api.get('/units'),
      api.get('/tax-rates'), api.get('/payment-methods'),
    ]);
    const pick = (i, key) => (results[i].status === 'fulfilled' ? results[i].value[key] || [] : []);
    setLookups({
      locations: pick(0, 'locations'),
      categories: pick(1, 'categories'),
      units: pick(2, 'units'),
      taxes: pick(3, 'tax_rates'),
      methods: pick(4, 'payment_methods'),
      accounts: [],
    });
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { ...lookups, loading, reload };
}

export function errorMessage(error) {
  return error?.message || 'Something went wrong';
}
