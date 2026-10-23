import { useEffect, useId, useRef } from 'react';
import { X, Loader2, Search, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';

/* --------------------------------- button -------------------------------- */

export function Button({
  children, variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight,
  className = '', loading = false, type = 'button', ...props
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      {children && <span>{children}</span>}
      {IconRight && <IconRight size={16} />}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className = '', ...props }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...props}>
      <Icon size={17} />
    </button>
  );
}

/* ---------------------------------- card --------------------------------- */

export function Card({ title, subtitle, actions, children, className = '', noPad = false, id }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={noPad ? 'card-body no-pad' : 'card-body'}>{children}</div>
    </section>
  );
}

/* --------------------------------- badges -------------------------------- */

export function Badge({ tone = 'neutral', children, dot = false }) {
  return <span className={`badge badge-${tone}`}>{dot && <i className="dot" />}{children}</span>;
}

export function StatusBadge({ status }) {
  const map = {
    completed: ['success', 'Completed'],
    open: ['success', 'Open'],
    closed: ['neutral', 'Closed'],
    voided: ['danger', 'Voided'],
    refunded: ['warning', 'Refunded'],
    partially_refunded: ['warning', 'Partially refunded'],
    received: ['success', 'Received'],
    active: ['success', 'Active'],
    inactive: ['neutral', 'Inactive'],
    manual: ['info', 'Manual'],
  };
  const [tone, label] = map[status] || ['neutral', status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/* --------------------------------- inputs -------------------------------- */

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }) {
  return <input className={`input ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return <select className={`input select ${className}`} {...props}>{children}</select>;
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`input textarea ${className}`} {...props} />;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '', ...props }) {
  return (
    <div className={`search-input ${className}`}>
      <Search size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} {...props} />
    </div>
  );
}

/* --------------------------------- modal --------------------------------- */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', className = '' }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal modal-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* --------------------------------- table --------------------------------- */

export function DataTable({ columns, rows, empty = 'No records found', keyField = 'id', onRowClick, footer = null, dense = false, maxHeight }) {
  return (
    <div className={`table-wrap ${maxHeight ? 'scroll-y' : ''}`} style={maxHeight ? { maxHeight } : undefined}>
      <table className={`table ${dense ? 'dense' : ''}`}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key || i} className={`${c.align ? `align-${c.align}` : ''} ${c.className || ''}`} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <div className="table-empty"><Inbox size={20} /><span>{empty}</span></div>
              </td>
            </tr>
          ) : rows.map((row, idx) => (
            <tr
              key={row[keyField] ?? idx}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'clickable' : ''}
            >
              {columns.map((c, i) => (
                <td key={c.key || i} className={`${c.align ? `align-${c.align}` : ''} ${c.className || ''}`}>
                  {c.render ? c.render(row, idx) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

/* --------------------------------- layout -------------------------------- */

export function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.icon && <t.icon size={15} />}
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone = 'default', onClick }) {
  return (
    <div className={`stat-card stat-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && <span className="stat-icon"><Icon size={18} /></span>}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', description, icon: Icon = Inbox, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={24} /></span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="spinner-block"><Loader2 className="spin" size={22} /><span>{label}</span></div>;
}

export function LoadingBlock({ height = 160 }) {
  return <div className="loading-block" style={{ height }}><Loader2 className="spin" size={22} /></div>;
}

export function Pagination({ limit, offset, total, onChange }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pagination">
      <span className="muted small">{total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '0 records'}</span>
      <div className="pagination-controls">
        <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))} />
        <span className="small">{page} / {pages}</span>
        <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => onChange(offset + limit)} />
      </div>
    </div>
  );
}

export function Money({ value, formatter, className = '', negativeRed = true }) {
  const n = Number(value || 0);
  return <span className={`${className} ${negativeRed && n < 0 ? 'neg' : ''}`}>{formatter(n)}</span>;
}

export function useFocus(ref, deps = []) {
  useEffect(() => {
    if (ref.current) ref.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function SectionTitle({ children, action }) {
  return <div className="section-title"><h3>{children}</h3>{action}</div>;
}

export function Confirm({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, loading = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      )}
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}
