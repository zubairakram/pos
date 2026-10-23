import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Info, Landmark, Lock, Save, Store, Undo2,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, Field, Input, LoadingBlock, PageHeader, Select, Tabs, Textarea,
} from '../components/ui.jsx';

const TABS = [
  { value: 'company', label: 'Company', icon: Building2 },
  { value: 'pos', label: 'Point of sale', icon: Store },
  { value: 'accounting', label: 'Accounting', icon: Landmark },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'AED', 'SAR', 'INR', 'PKR', 'NGN', 'ZAR', 'KES'];

const MAPPING_LABELS = {
  ar: 'Accounts receivable',
  ap: 'Accounts payable',
  inventory: 'Inventory',
  tax_payable: 'Sales tax payable',
  tax_receivable: 'Tax receivable',
  sales: 'Sales revenue',
  sales_returns: 'Sales returns',
  cogs: 'Cost of goods sold',
  inventory_adjustment: 'Inventory adjustments',
  cash_over_short: 'Cash over / short',
  opening_balance_equity: 'Opening balance equity',
  owner_capital: "Owner's capital",
  owner_drawings: "Owner's drawings",
  retained_earnings: 'Retained earnings',
  bank: 'Bank account',
};

function blankForm() {
  return {
    company: {
      name: '', legal_name: '', tax_number: '', phone: '', email: '', address: '',
      currency: 'USD', currency_symbol: '$', currency_decimals: 2,
    },
    pos: {
      invoice_prefix: 'INV', purchase_prefix: 'PUR', return_prefix: 'RET',
      receipt_footer: '', allow_negative_stock: false, default_due_days: 30,
    },
    accounting: { fiscal_year_start: '01-01', lock_date: '' },
  };
}

function normalise(settings) {
  const base = blankForm();
  const src = settings || {};
  return {
    company: { ...base.company, ...(src.company || {}), currency_decimals: Number(src.company?.currency_decimals ?? 2) },
    pos: {
      ...base.pos,
      ...(src.pos || {}),
      allow_negative_stock: !!src.pos?.allow_negative_stock,
      default_due_days: Number(src.pos?.default_due_days ?? 30),
    },
    accounting: {
      ...base.accounting,
      ...(src.accounting || {}),
      lock_date: src.accounting?.lock_date ? String(src.accounting.lock_date).slice(0, 10) : '',
    },
  };
}

export default function Settings() {
  const { user, updateSettings } = useAuth();
  const toast = useToast();
  const settingsApi = useApi('/settings');
  const [tab, setTab] = useState('company');
  const [form, setForm] = useState(blankForm);
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const mappedAccounts = settingsApi.data?.mapped_accounts || [];
  const canEdit = ['admin', 'manager'].includes(user.role);

  useEffect(() => {
    if (!settingsApi.data?.settings) return;
    const next = normalise(settingsApi.data.settings);
    setForm(next);
    setBaseline(JSON.stringify(next));
  }, [settingsApi.data]);

  const dirty = useMemo(() => JSON.stringify(form) !== baseline, [form, baseline]);

  function setSection(section, key, value) {
    setForm((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
  }

  function resetForm() {
    if (!settingsApi.data?.settings) return;
    const next = normalise(settingsApi.data.settings);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setError('');
  }

  async function submit(e) {
    e?.preventDefault?.();
    setError('');

    if (!form.company.name.trim()) { setTab('company'); return setError('Company name is required.'); }
    if (!form.company.currency.trim() || form.company.currency.trim().length !== 3) {
      setTab('company'); return setError('Currency must be a 3-letter ISO code (for example USD).');
    }
    if (!form.company.currency_symbol.trim()) { setTab('company'); return setError('Currency symbol is required.'); }
    if (!form.pos.invoice_prefix.trim() || !form.pos.purchase_prefix.trim() || !form.pos.return_prefix.trim()) {
      setTab('pos'); return setError('Invoice, purchase and return prefixes are required.');
    }
    if (!/^\d{2}-\d{2}$/.test(String(form.accounting.fiscal_year_start))) {
      setTab('accounting'); return setError('Fiscal year start must use the MM-DD format.');
    }

    const payload = {
      company: {
        ...form.company,
        name: form.company.name.trim(),
        currency: form.company.currency.trim().toUpperCase(),
        currency_decimals: Number(form.company.currency_decimals),
      },
      pos: {
        ...form.pos,
        invoice_prefix: form.pos.invoice_prefix.trim().toUpperCase(),
        purchase_prefix: form.pos.purchase_prefix.trim().toUpperCase(),
        return_prefix: form.pos.return_prefix.trim().toUpperCase(),
        default_due_days: Number(form.pos.default_due_days) || 0,
      },
      accounting: {
        ...form.accounting,
        lock_date: form.accounting.lock_date || null,
      },
    };

    setSaving(true);
    try {
      const data = await api.put('/settings', payload);
      const next = normalise(data.settings);
      setForm(next);
      setBaseline(JSON.stringify(next));
      updateSettings(data.settings);
      toast.success('Settings saved');
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (settingsApi.loading && !settingsApi.data) return <div className="page"><LoadingBlock height={320} /></div>;
  if (settingsApi.error) return <div className="page"><div className="info-note danger">{settingsApi.error.message}</div></div>;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        subtitle="Company profile, POS defaults and accounting controls used across the workspace."
        actions={(
          <>
            {dirty && <Badge tone="warning" dot>Unsaved changes</Badge>}
            <Button variant="ghost" icon={Undo2} onClick={resetForm} disabled={!dirty || saving}>Discard</Button>
            <Button icon={Save} onClick={submit} loading={saving} disabled={!canEdit || !dirty}>Save settings</Button>
          </>
        )}
      />

      {!canEdit && <div className="info-note warning"><Info size={15} /><span>Your role can view settings but not change them.</span></div>}

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <form className="stack" onSubmit={submit}>
        {error && <div className="info-note danger">{error}</div>}

        {tab === 'company' && (
          <div className="grid grid-2">
            <Card title="Business identity" subtitle="Shown on receipts, reports and statements">
              <div className="stack">
                <Field label="Trading name">
                  <Input value={form.company.name} onChange={(e) => setSection('company', 'name', e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Legal name" hint="Registered entity name, if different">
                  <Input value={form.company.legal_name} onChange={(e) => setSection('company', 'legal_name', e.target.value)} disabled={!canEdit} />
                </Field>
                <div className="grid grid-2">
                  <Field label="Tax / VAT number">
                    <Input value={form.company.tax_number} onChange={(e) => setSection('company', 'tax_number', e.target.value)} disabled={!canEdit} />
                  </Field>
                  <Field label="Phone">
                    <Input value={form.company.phone} onChange={(e) => setSection('company', 'phone', e.target.value)} disabled={!canEdit} />
                  </Field>
                </div>
                <Field label="Email">
                  <Input type="email" value={form.company.email} onChange={(e) => setSection('company', 'email', e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Address">
                  <Textarea value={form.company.address} onChange={(e) => setSection('company', 'address', e.target.value)} disabled={!canEdit} rows={3} />
                </Field>
              </div>
            </Card>

            <Card title="Currency & display" subtitle="Applied to every amount in the app and on printed documents">
              <div className="stack">
                <div className="grid grid-2">
                  <Field label="Currency code" hint="ISO 4217, 3 letters">
                    <Input
                      list="currency-codes"
                      maxLength={3}
                      value={form.company.currency}
                      onChange={(e) => setSection('company', 'currency', e.target.value.toUpperCase())}
                      disabled={!canEdit}
                      className="mono"
                    />
                    <datalist id="currency-codes">
                      {CURRENCIES.map((code) => <option key={code} value={code} />)}
                    </datalist>
                  </Field>
                  <Field label="Symbol">
                    <Input maxLength={4} value={form.company.currency_symbol} onChange={(e) => setSection('company', 'currency_symbol', e.target.value)} disabled={!canEdit} />
                  </Field>
                </div>
                <Field label="Decimal places" hint="0 for whole units, 2 for cents, 3 for fractional pricing">
                  <Select value={form.company.currency_decimals} onChange={(e) => setSection('company', 'currency_decimals', Number(e.target.value))} disabled={!canEdit}>
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </Field>
                <div className="info-note">
                  <Info size={15} />
                  <span>Changing the currency changes how values are displayed. Existing ledger amounts are not converted.</span>
                </div>
                <div className="list-row">
                  <span className="small muted">Preview</span>
                  <span className="amount mono">
                    {form.company.currency_symbol}
                    {Number(1234.5).toFixed(Number(form.company.currency_decimals)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === 'pos' && (
          <div className="grid grid-2">
            <Card title="Document numbering" subtitle="Prefixes used on generated documents">
              <div className="stack">
                <div className="grid grid-3">
                  <Field label="Sales prefix">
                    <Input maxLength={8} value={form.pos.invoice_prefix} onChange={(e) => setSection('pos', 'invoice_prefix', e.target.value.toUpperCase())} disabled={!canEdit} className="mono" />
                  </Field>
                  <Field label="Purchase prefix">
                    <Input maxLength={8} value={form.pos.purchase_prefix} onChange={(e) => setSection('pos', 'purchase_prefix', e.target.value.toUpperCase())} disabled={!canEdit} className="mono" />
                  </Field>
                  <Field label="Return prefix">
                    <Input maxLength={8} value={form.pos.return_prefix} onChange={(e) => setSection('pos', 'return_prefix', e.target.value.toUpperCase())} disabled={!canEdit} className="mono" />
                  </Field>
                </div>
                <Field label="Default payment terms" hint="Days until a credit sale or purchase falls due">
                  <Input type="number" min="0" max="365" value={form.pos.default_due_days} onChange={(e) => setSection('pos', 'default_due_days', e.target.value)} disabled={!canEdit} />
                </Field>
                <div className="info-note">
                  <Info size={15} />
                  <span>Prefixes apply to new documents only. Existing numbers keep the prefix they were issued with.</span>
                </div>
              </div>
            </Card>

            <Card title="Receipt & stock rules" subtitle="Behaviour at the counter">
              <div className="stack">
                <Field label="Receipt footer" hint="Printed at the bottom of customer receipts">
                  <Textarea value={form.pos.receipt_footer} onChange={(e) => setSection('pos', 'receipt_footer', e.target.value)} disabled={!canEdit} rows={4} />
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.pos.allow_negative_stock}
                    onChange={(e) => setSection('pos', 'allow_negative_stock', e.target.checked)}
                    disabled={!canEdit}
                  />
                  Allow selling products below zero stock
                </label>
                <div className="info-note warning">
                  <Lock size={15} />
                  <span>When disabled, the register blocks a sale if any line exceeds the stock available at the selling location.</span>
                </div>
              </div>
            </Card>
          </div>
        )}

        {tab === 'accounting' && (
          <>
            <div className="grid grid-2">
              <Card title="Period controls" subtitle="Fiscal calendar and posting lock">
                <div className="stack">
                  <div className="grid grid-2">
                    <Field label="Fiscal year start" hint="MM-DD">
                      <Input
                        value={form.accounting.fiscal_year_start}
                        onChange={(e) => setSection('accounting', 'fiscal_year_start', e.target.value)}
                        disabled={!canEdit}
                        placeholder="01-01"
                        className="mono"
                      />
                    </Field>
                    <Field label="Lock postings before" hint="Leave blank for no lock">
                      <Input
                        type="date"
                        value={form.accounting.lock_date || ''}
                        onChange={(e) => setSection('accounting', 'lock_date', e.target.value)}
                        disabled={!canEdit}
                      />
                    </Field>
                  </div>
                  <div className="info-note warning">
                    <Lock size={15} />
                    <span>A lock date prevents transactions dated on or before that day from being posted. Close the relevant drawers and reconcile first.</span>
                  </div>
                </div>
              </Card>

              <Card title="Ledger integrity" subtitle="How this workspace keeps the books honest">
                <div className="stack">
                  <div className="list-row">
                    <Badge tone="success" dot>Double entry</Badge>
                    <span className="small muted">Every sale, return, purchase, payment, expense and cash movement posts a balanced journal.</span>
                  </div>
                  <div className="list-row">
                    <Badge tone="info" dot>Immutable</Badge>
                    <span className="small muted">Posted entries are never edited; corrections are made with reversing entries.</span>
                  </div>
                  <div className="list-row">
                    <Badge tone="purple" dot>Audited</Badge>
                    <span className="small muted">Changes to settings, users and mappings are recorded in the audit log.</span>
                  </div>
                  <div className="list-row">
                    <Badge tone="neutral" dot>Weighted average</Badge>
                    <span className="small muted">Inventory is valued per location using a moving weighted-average cost.</span>
                  </div>
                </div>
              </Card>
            </div>

            <Card
              title="Account mappings"
              subtitle="Where each accounting event posts"
              actions={<Badge tone="neutral">{mappedAccounts.length} mapped</Badge>}
            >
              <div className="info-note" style={{ marginBottom: 14 }}>
                <Info size={15} />
                <span>
                  {user.role === 'admin'
                    ? 'Admins can change these mappings from Accounting → Mappings. Changes apply to future postings only.'
                    : 'Only administrators can change account mappings. Ask an admin if a mapping needs to move.'}
                </span>
              </div>
              <div className="grid grid-2">
                {mappedAccounts.length === 0
                  ? <span className="small muted">No mappings found.</span>
                  : mappedAccounts.map((m) => (
                    <div className="list-row" key={m.id}>
                      <div>
                        <div className="main-text">{MAPPING_LABELS[m.key] || m.key}</div>
                        <div className="sub-text mono">{m.code} · {m.name}</div>
                      </div>
                      <Badge tone="neutral" className="amount">{m.type}</Badge>
                    </div>
                  ))}
              </div>
            </Card>
          </>
        )}

        <div className="flex between wrap gap" style={{ paddingBottom: 8 }}>
          <span className="small muted">
            Signed in as {user.name} · {user.role}
          </span>
          <div className="flex gap-sm">
            <Button type="button" variant="ghost" onClick={resetForm} disabled={!dirty || saving}>Discard changes</Button>
            <Button type="submit" icon={Save} loading={saving} disabled={!canEdit || !dirty}>Save settings</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
