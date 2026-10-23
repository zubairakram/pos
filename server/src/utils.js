export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
export const num = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) throw new ApiError(400, `Missing required field(s): ${missing.join(', ')}`);
}

export function assert(cond, status, message, details) {
  if (!cond) throw new ApiError(status, message, details);
}

export function toInt(value, name = 'value') {
  const n = Number(value);
  assert(Number.isInteger(n), 400, `${name} must be an integer`);
  return n;
}

export function toPositive(value, name = 'value') {
  const n = Number(value);
  assert(Number.isFinite(n) && n > 0, 400, `${name} must be greater than zero`);
  return n;
}

export function toNonNegative(value, name = 'value') {
  const n = Number(value);
  assert(Number.isFinite(n) && n >= 0, 400, `${name} must be zero or greater`);
  return n;
}

export function cleanDate(value, name = 'date') {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(s), 400, `${name} must be YYYY-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  assert(!Number.isNaN(d.getTime()), 400, `Invalid ${name}`);
  return s;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function firstOfMonthISO(base = todayISO()) {
  return `${base.slice(0, 7)}-01`;
}

export function rangeFromQuery(q, defaultDays = 30) {
  const to = cleanDate(q.to) || todayISO();
  let from = cleanDate(q.from);
  if (!from) {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (defaultDays - 1));
    from = d.toISOString().slice(0, 10);
  }
  assert(from <= to, 400, 'from date must be before or equal to to date');
  return { from, to };
}

export function pagination(q, defaultLimit = 50, maxLimit = 500) {
  const limit = Math.min(Math.max(Number(q.limit) || defaultLimit, 1), maxLimit);
  const offset = Math.max(Number(q.offset) || 0, 0);
  return { limit, offset };
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function audit(client, req, action, entity, entityId, details) {
  try {
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user?.id || null, action, entity || null, entityId ? String(entityId) : null, details ? JSON.stringify(details) : null, req.ip]
    );
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}
