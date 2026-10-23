import { useAuth } from './auth.jsx';

export function useFormat() {
  const { settings } = useAuth();
  const company = settings?.company || {};
  const symbol = company.currency_symbol || '$';
  const currency = company.currency || 'USD';
  const decimals = Number(company.currency_decimals ?? 2);

  const money = (value, opts = {}) => {
    const n = Number(value || 0);
    if (opts.compact && Math.abs(n) >= 1000) {
      const formatted = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
      return `${symbol}${formatted}`;
    }
    let out;
    try {
      out = new Intl.NumberFormat('en-US', {
        style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
        currencyDisplay: 'narrowSymbol',
      }).format(n);
    } catch {
      out = `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
    }
    return out;
  };

  const number = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });

  const qty = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

  const date = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const dateTime = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const time = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const percent = (value, digits = 1) => `${Number(value || 0).toFixed(digits)}%`;

  return { money, number, qty, date, dateTime, time, percent, symbol, currency };
}

export function todayInput(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function monthStartInput() {
  const d = new Date();
  return `${d.toISOString().slice(0, 7)}-01`;
}

export function daysAgoInput(days) {
  return todayInput(-(days - 1));
}

export function downloadCSV(filename, columns, rows) {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function printElement(elementId = 'receipt-print') {
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1500);
}
