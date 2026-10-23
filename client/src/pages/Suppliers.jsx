import { useMemo, useState } from 'react';
import {
  Banknote, Download, Edit3, Eye, Plus, Search, Truck, Users, Wallet,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { downloadCSV, todayInput, useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, Select, Spinner, Stat, StatusBadge, Textarea,
} from '../components/ui.jsx';

const blankSupplier = {
  name: '', email: '', phone: '', address: '', tax_number: '', opening_balance: '', notes: '',
};

export default function Suppliers() {
  const { user } = useAuth();
  const { money, number, date, dateTime } = useFormat();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);

  const [selectedId, setSelectedId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blankSupplier);
  const [editId, setEditId] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', method_id: '', reference: '', session_id: '', date: todayInput() });
  const [payError, setPayError] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  const list = useApi('/suppliers', { search: debounced || undefined });
  const detail = useApi(selectedId ? `/suppliers/${selectedId}` : null);
  const methodsApi = useApi('/payment-methods');
  const sessionApi = useApi('/cash/sessions/current');

  const suppliers = list.data?.suppliers || [];
  const methods = (methodsApi.data?.payment_methods || []).filter((m) => m.is_active !== false);
  const session = sessionApi.data?.session;
  const detailData = detail.data;
  const supplier = detailData?.supplier;

  const stats = useMemo(() => ({
    count: suppliers.length,
    payables: suppliers.reduce((s, r) => s + Math.max(0, Number(r.balance || 0)), 0),
    withBalance: suppliers.filter((s) => Number(s.balance) > 0.005).length,
  }), [suppliers]);

  const canManage = ['admin', 'manager', 'storekeeper', 'accountant'].includes(user.role);
  const canPay = ['admin', 'manager', 'accountant'].includes(user.role);

  function openCreate() {
    setEditId(null);
    setForm(blankSupplier);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(s) {
    setEditId(s.id);
    setForm({
      name: s.name || '', email: s.email || '', phone: s.phone || '', address: s.address || '',
      tax_number: s.tax_number || '', opening_balance: '', notes: s.notes || '', is_active: s.is_active !== false,
    });
    setFormError('');
    setFormOpen(true);
  }

  async function submitSupplier(e) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return setFormError('Supplier name is required.');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        tax_number: form.tax_number || undefined,
        notes: form.notes || undefined,
      };
      if (editId) {
        payload.is_active = !!form.is_active;
        await api.put(`/suppliers/${editId}`, payload);
        toast.success('Supplier updated');
      } else {
        payload.opening_balance = Number(form.opening_balance || 0);
        await api.post('/suppliers', payload);
        toast.success('Supplier created');
      }
      setFormOpen(false);
      list.reload();
      if (selectedId) detail.reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openPay() {
    const cash = methods.find((m) => m.type === 'cash') || methods[0];
    setPay({
      amount: supplier ? String(Math.max(0, Number(supplier.balance || 0))) : '',
      method_id: cash ? String(cash.id) : '',
      reference: '',
      session_id: session?.id ? String(session.id) : '',
      date: todayInput(),
    });
    setPayError('');
    setPayOpen(true);
  }

  async function submitPayment(e) {
    e.preventDefault();
    setPayError('');
    const amount = Number(pay.amount);
    if (!amount || amount <= 0) return setPayError('Enter an amount greater than zero.');
    const method = methods.find((m) => String(m.id) === String(pay.method_id));
    if (!method) return setPayError('Choose a payment method.');
    if (method.type === 'cash' && !pay.session_id) return setPayError('Open a cash drawer before paying cash.');
    setPaySaving(true);
    try {
      await api.post('/supplier-payments', {
        supplier_id: Number(selectedId),
        amount,
        method_id: Number(pay.method_id),
        reference: pay.reference || undefined,
        date: pay.date,
        session_id: pay.session_id ? Number(pay.session_id) : undefined,
        location_id: user.location_id || undefined,
      });
      toast.success('Supplier payment recorded');
      setPayOpen(false);
      detail.reload();
      list.reload();
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPaySaving(false);
    }
  }

  function exportSuppliers() {
    downloadCSV('suppliers.csv', [
      { header: 'Code', key: 'code' },
      { header: 'Name', key: 'name' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Balance', key: 'balance' },
      { header: 'Purchases', key: 'purchase_count' },
      { header: 'Active', value: (r) => (r.is_active ? 'yes' : 'no') },
    ], suppliers);
    toast.success('Suppliers exported');
  }

  const payMethod = methods.find((m) => String(m.id) === String(pay.method_id));

  return (
    <div className="page">
      <PageHeader
        title="Suppliers"
        subtitle="Supplier balances, bills, statements and payments."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportSuppliers} disabled={!suppliers.length}>Export CSV</Button>
            {canManage && <Button icon={Plus} onClick={openCreate}>New supplier</Button>}
          </>
        )}
      />

      <div className="stat-grid">
        <Stat label="Suppliers" value={number(stats.count)} sub="Active vendor relationships" icon={Truck} tone="brand" />
        <Stat label="Payables" value={money(stats.payables)} sub={`${number(stats.withBalance)} with a balance`} icon={Wallet} tone="warning" />
      </div>

      <Card>
        <div className="toolbar">
          <div className="toolbar-left">
            <div className="search-input">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or code…" />
            </div>
          </div>
          <div className="toolbar-right"><Badge tone="neutral">{suppliers.length} supplier(s)</Badge></div>
        </div>
      </Card>

      <Card noPad>
        {list.loading && !list.data ? <LoadingBlock /> : suppliers.length === 0 ? (
          <EmptyState
            title="No suppliers yet"
            description="Add a supplier to start recording purchase bills and payments."
            action={canManage ? <Button icon={Plus} onClick={openCreate}>New supplier</Button> : null}
          />
        ) : (
          <DataTable
            rows={suppliers}
            onRowClick={(r) => setSelectedId(r.id)}
            columns={[
              { key: 'name', header: 'Supplier', render: (r) => <div className="contact-cell"><span className="contact-avatar">{(r.name || '?').slice(0, 2).toUpperCase()}</span><div><b>{r.name}</b><span className="small muted">{r.code}{r.phone ? ` · ${r.phone}` : ''}</span></div></div> },
              { key: 'email', header: 'Email', render: (r) => r.email || <span className="muted">—</span> },
              { key: 'purchase_count', header: 'Bills', align: 'right' },
              { key: 'last_purchase', header: 'Last purchase', render: (r) => (r.last_purchase ? date(r.last_purchase) : <span className="muted">Never</span>) },
              { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b className={Number(r.balance) > 0.005 ? 'neg' : ''}>{money(r.balance)}</b> },
              { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
              { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon={Eye} onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>View</Button> },
            ]}
          />
        )}
      </Card>

      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={supplier?.name || 'Supplier'}
        subtitle={supplier ? `${supplier.code}${supplier.phone ? ` · ${supplier.phone}` : ''}` : ''}
        size="lg"
        footer={supplier ? (
          <>
            {canManage && <Button variant="secondary" icon={Edit3} onClick={() => openEdit(supplier)}>Edit</Button>}
            {canPay && Number(supplier.balance) > 0.005 && <Button icon={Banknote} onClick={openPay}>Pay supplier</Button>}
            <Button variant="secondary" onClick={() => setSelectedId(null)}>Close</Button>
          </>
        ) : null}
      >
        {detail.loading && !detailData ? <Spinner /> : !detailData ? <div className="muted">Unable to load supplier.</div> : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Balance owed</div><div className={`value ${Number(supplier.balance) > 0 ? 'neg' : ''}`}>{money(supplier.balance)}</div></div>
              <div className="summary-box"><div className="label">Opening balance</div><div className="value" style={{ fontSize: 14 }}>{money(detailData.statement?.opening_balance)}</div></div>
              <div className="summary-box"><div className="label">Contact</div><div className="value" style={{ fontSize: 12 }}>{supplier.email || supplier.phone || '—'}</div></div>
            </div>

            <div>
              <div className="section-title"><h3>Statement</h3><span className="tiny muted">Closing {money(detailData.statement?.closing_balance)}</span></div>
              <DataTable
                rows={detailData.statement?.lines || []}
                dense
                empty="No statement activity"
                columns={[
                  { key: 'date', header: 'Date', render: (r) => date(r.date) },
                  { key: 'type', header: 'Type', render: (r) => <Badge tone={r.type === 'bill' ? 'info' : 'success'}>{r.type}</Badge> },
                  { key: 'reference', header: 'Reference', render: (r) => <span className="mono">{r.reference}</span> },
                  { key: 'memo', header: 'Memo', render: (r) => r.memo || <span className="muted">—</span> },
                  { key: 'debit', header: 'Paid', align: 'right', render: (r) => (Number(r.debit) ? money(r.debit) : '') },
                  { key: 'credit', header: 'Billed', align: 'right', render: (r) => (Number(r.credit) ? money(r.credit) : '') },
                  { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b>{money(r.balance)}</b> },
                ]}
              />
            </div>

            <div>
              <div className="section-title"><h3>Recent purchases</h3></div>
              <DataTable
                rows={detailData.purchases || []}
                dense
                empty="No purchases yet"
                columns={[
                  { key: 'bill_no', header: 'Bill', render: (r) => <span className="mono">{r.bill_no}</span> },
                  { key: 'created_at', header: 'Date', render: (r) => dateTime(r.created_at) },
                  { key: 'total', header: 'Total', align: 'right', render: (r) => money(r.total) },
                  { key: 'paid', header: 'Paid', align: 'right', render: (r) => money(r.paid) },
                  { key: 'due', header: 'Due', align: 'right', render: (r) => <span className={Number(r.due) > 0 ? 'neg' : 'muted'}>{money(r.due)}</span> },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        title={editId ? 'Edit supplier' : 'New supplier'}
        subtitle={editId ? 'Update contact and profile details.' : 'Opening balances post to accounts payable and opening equity.'}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button icon={Plus} onClick={submitSupplier} loading={saving}>{editId ? 'Save changes' : 'Create supplier'}</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitSupplier}>
          {formError && <div className="info-note danger">{formError}</div>}
          <div className="grid grid-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supplier or business name" autoFocus /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Tax number"><Input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} /></Field>
            {!editId && <Field label="Opening balance" hint="Positive = you owe the supplier"><Input value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} inputMode="decimal" placeholder="0.00" /></Field>}
          </div>
          <Field label="Address"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
          {editId && (
            <label className="checkbox">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active supplier
            </label>
          )}
        </form>
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => !paySaving && setPayOpen(false)}
        title="Pay supplier"
        subtitle={supplier ? `${supplier.name} · balance ${money(supplier.balance)}` : ''}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={paySaving}>Cancel</Button>
            <Button icon={Banknote} onClick={submitPayment} loading={paySaving}>Record payment</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitPayment}>
          {payError && <div className="info-note danger">{payError}</div>}
          <Field label="Amount"><Input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Payment method">
            <Select value={pay.method_id} onChange={(e) => setPay({ ...pay, method_id: e.target.value })}>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.type}</option>)}
            </Select>
          </Field>
          {payMethod?.type === 'cash' && (
            <Field label="Cash drawer" hint={session ? `${session.register_name} · ${money(session.expected_cash)}` : 'No drawer open for your user'}>
              <Select value={pay.session_id} onChange={(e) => setPay({ ...pay, session_id: e.target.value })}>
                <option value="">Choose drawer</option>
                {session && <option value={session.id}>{session.register_name}</option>}
              </Select>
            </Field>
          )}
          <Field label="Reference"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
        </form>
      </Modal>
    </div>
  );
}
