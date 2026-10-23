import { useMemo, useState } from 'react';
import {
  Banknote, Download, Edit3, Eye, Plus, Search, UserPlus, Users, Wallet,
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

const blankCustomer = {
  name: '', email: '', phone: '', address: '', tax_number: '', credit_limit: '', opening_balance: '', notes: '',
};

export default function Customers() {
  const { user } = useAuth();
  const { money, number, date, dateTime } = useFormat();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);

  const [selectedId, setSelectedId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blankCustomer);
  const [editId, setEditId] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', method_id: '', reference: '', sale_id: '', session_id: '', date: todayInput() });
  const [payError, setPayError] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  const list = useApi('/customers', { search: debounced || undefined });
  const detail = useApi(selectedId ? `/customers/${selectedId}` : null);
  const methodsApi = useApi('/payment-methods');
  const sessionApi = useApi('/cash/sessions/current');

  const customers = list.data?.customers || [];
  const methods = (methodsApi.data?.payment_methods || []).filter((m) => m.is_active !== false);
  const session = sessionApi.data?.session;
  const detailData = detail.data;
  const customer = detailData?.customer;

  const stats = useMemo(() => {
    const withBalance = customers.filter((c) => Number(c.balance) > 0.005);
    return {
      count: customers.length,
      receivables: customers.reduce((s, c) => s + Math.max(0, Number(c.balance || 0)), 0),
      withBalance: withBalance.length,
      creditCustomers: customers.filter((c) => Number(c.credit_limit) > 0).length,
    };
  }, [customers]);

  const canManage = ['admin', 'manager', 'cashier', 'accountant'].includes(user.role);

  function openCreate() {
    setEditId(null);
    setForm(blankCustomer);
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(c) {
    setEditId(c.id);
    setForm({
      name: c.name || '', email: c.email || '', phone: c.phone || '', address: c.address || '',
      tax_number: c.tax_number || '', credit_limit: c.credit_limit ?? '', opening_balance: '',
      notes: c.notes || '', is_active: c.is_active !== false,
    });
    setFormError('');
    setFormOpen(true);
  }

  async function submitCustomer(e) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) return setFormError('Customer name is required.');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        tax_number: form.tax_number || undefined,
        credit_limit: Number(form.credit_limit || 0),
        notes: form.notes || undefined,
      };
      if (editId) {
        payload.is_active = !!form.is_active;
        await api.put(`/customers/${editId}`, payload);
        toast.success('Customer updated');
      } else {
        payload.opening_balance = Number(form.opening_balance || 0);
        await api.post('/customers', payload);
        toast.success('Customer created');
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
      amount: customer ? String(Math.max(0, Number(customer.balance || 0))) : '',
      method_id: cash ? String(cash.id) : '',
      reference: '',
      sale_id: '',
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
    if (method.type === 'cash' && !pay.session_id) return setPayError('Open a cash drawer before taking cash.');
    setPaySaving(true);
    try {
      await api.post('/customer-payments', {
        customer_id: Number(selectedId),
        sale_id: pay.sale_id ? Number(pay.sale_id) : undefined,
        amount,
        method_id: Number(pay.method_id),
        reference: pay.reference || undefined,
        date: pay.date,
        session_id: pay.session_id ? Number(pay.session_id) : undefined,
        location_id: user.location_id || undefined,
      });
      toast.success('Receipt recorded and ledger updated');
      setPayOpen(false);
      detail.reload();
      list.reload();
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPaySaving(false);
    }
  }

  function exportCustomers() {
    downloadCSV('customers.csv', [
      { header: 'Code', key: 'code' },
      { header: 'Name', key: 'name' },
      { header: 'Phone', key: 'phone' },
      { header: 'Email', key: 'email' },
      { header: 'Credit limit', key: 'credit_limit' },
      { header: 'Balance', key: 'balance' },
      { header: 'Orders', key: 'order_count' },
      { header: 'Active', value: (r) => (r.is_active ? 'yes' : 'no') },
    ], customers);
    toast.success('Customers exported');
  }

  const payMethod = methods.find((m) => String(m.id) === String(pay.method_id));
  const openSales = customer ? (detailData?.sales || []).filter((s) => Number(s.due) > 0.005) : [];

  return (
    <div className="page">
      <PageHeader
        title="Customers"
        subtitle="Balances, credit terms, statements and receipts — all tied to the ledger."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportCustomers} disabled={!customers.length}>Export CSV</Button>
            {canManage && <Button icon={UserPlus} onClick={openCreate}>New customer</Button>}
          </>
        )}
      />

      <div className="stat-grid">
        <Stat label="Customers" value={number(stats.count)} sub="Active relationships" icon={Users} tone="brand" />
        <Stat label="Receivables" value={money(stats.receivables)} sub={`${number(stats.withBalance)} with a balance`} icon={Wallet} tone="info" />
        <Stat label="Credit accounts" value={number(stats.creditCustomers)} sub="With a credit limit set" icon={Banknote} tone="purple" />
      </div>

      <Card>
        <div className="toolbar">
          <div className="toolbar-left">
            <div className="search-input">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or code…" />
            </div>
          </div>
          <div className="toolbar-right">
            <Badge tone="neutral">{customers.length} customer(s)</Badge>
          </div>
        </div>
      </Card>

      <Card noPad>
        {list.loading && !list.data ? <LoadingBlock /> : customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Create a customer to start tracking credit sales and receipts."
            action={canManage ? <Button icon={UserPlus} onClick={openCreate}>New customer</Button> : null}
          />
        ) : (
          <DataTable
            rows={customers}
            onRowClick={(r) => setSelectedId(r.id)}
            columns={[
              { key: 'name', header: 'Customer', render: (r) => <div className="contact-cell"><span className="contact-avatar">{(r.name || '?').slice(0, 2).toUpperCase()}</span><div><b>{r.name}</b><span className="small muted">{r.code}{r.phone ? ` · ${r.phone}` : ''}</span></div></div> },
              { key: 'email', header: 'Email', render: (r) => r.email || <span className="muted">—</span> },
              { key: 'order_count', header: 'Orders', align: 'right' },
              { key: 'last_sale', header: 'Last sale', render: (r) => r.last_sale ? date(r.last_sale) : <span className="muted">Never</span> },
              { key: 'credit_limit', header: 'Credit limit', align: 'right', render: (r) => (Number(r.credit_limit) > 0 ? money(r.credit_limit) : <span className="muted">—</span>) },
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
        title={customer?.name || 'Customer'}
        subtitle={customer ? `${customer.code}${customer.phone ? ` · ${customer.phone}` : ''}` : ''}
        size="lg"
        footer={customer ? (
          <>
            {canManage && <Button variant="secondary" icon={Edit3} onClick={() => openEdit(customer)}>Edit</Button>}
            {canManage && Number(customer.balance) > 0.005 && <Button icon={Banknote} onClick={openPay}>Record receipt</Button>}
            <Button variant="secondary" onClick={() => setSelectedId(null)}>Close</Button>
          </>
        ) : null}
      >
        {detail.loading && !detailData ? <Spinner /> : !detailData ? <div className="muted">Unable to load customer.</div> : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Balance</div><div className={`value ${Number(customer.balance) > 0 ? 'neg' : ''}`}>{money(customer.balance)}</div></div>
              <div className="summary-box"><div className="label">Credit limit</div><div className="value" style={{ fontSize: 14 }}>{Number(customer.credit_limit) > 0 ? money(customer.credit_limit) : 'No limit'}</div></div>
              <div className="summary-box"><div className="label">Contact</div><div className="value" style={{ fontSize: 12 }}>{customer.email || customer.phone || '—'}</div></div>
            </div>

            <div>
              <div className="section-title"><h3>Statement</h3><span className="tiny muted">Closing {money(detailData.statement?.closing_balance)}</span></div>
              <DataTable
                rows={detailData.statement?.lines || []}
                dense
                empty="No statement activity"
                columns={[
                  { key: 'date', header: 'Date', render: (r) => date(r.date) },
                  { key: 'type', header: 'Type', render: (r) => <Badge tone={r.type === 'invoice' ? 'info' : r.type === 'return' ? 'warning' : 'success'}>{r.type}</Badge> },
                  { key: 'reference', header: 'Reference', render: (r) => <span className="mono">{r.reference}</span> },
                  { key: 'memo', header: 'Memo', render: (r) => r.memo || <span className="muted">—</span> },
                  { key: 'debit', header: 'Debit', align: 'right', render: (r) => (Number(r.debit) ? money(r.debit) : '') },
                  { key: 'credit', header: 'Credit', align: 'right', render: (r) => (Number(r.credit) ? money(r.credit) : '') },
                  { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b>{money(r.balance)}</b> },
                ]}
              />
            </div>

            <div>
              <div className="section-title"><h3>Recent sales</h3></div>
              <DataTable
                rows={detailData.sales || []}
                dense
                empty="No sales yet"
                columns={[
                  { key: 'invoice_no', header: 'Invoice', render: (r) => <span className="mono">{r.invoice_no}</span> },
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
        title={editId ? 'Edit customer' : 'New customer'}
        subtitle={editId ? 'Update contact and credit details.' : 'Opening balances post to accounts receivable and opening equity.'}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button icon={Plus} onClick={submitCustomer} loading={saving}>{editId ? 'Save changes' : 'Create customer'}</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitCustomer}>
          {formError && <div className="info-note danger">{formError}</div>}
          <div className="grid grid-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer or business name" autoFocus /></Field>
            <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></Field>
            <Field label="Tax number"><Input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} /></Field>
            <Field label="Credit limit"><Input value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} inputMode="decimal" placeholder="0.00" /></Field>
            {!editId && <Field label="Opening balance" hint="Positive = customer owes you"><Input value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} inputMode="decimal" placeholder="0.00" /></Field>}
          </div>
          <Field label="Address"><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
          {editId && (
            <label className="checkbox">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active customer
            </label>
          )}
        </form>
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => !paySaving && setPayOpen(false)}
        title="Record customer receipt"
        subtitle={customer ? `${customer.name} · balance ${money(customer.balance)}` : ''}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={paySaving}>Cancel</Button>
            <Button icon={Banknote} onClick={submitPayment} loading={paySaving}>Save receipt</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitPayment}>
          {payError && <div className="info-note danger">{payError}</div>}
          <Field label="Amount"><Input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Apply to invoice" hint="Leave blank to allocate oldest first">
            <Select value={pay.sale_id} onChange={(e) => setPay({ ...pay, sale_id: e.target.value })}>
              <option value="">Auto-allocate</option>
              {openSales.map((s) => <option key={s.id} value={s.id}>{s.invoice_no} · due {money(s.due)}</option>)}
            </Select>
          </Field>
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
          <Field label="Reference"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Cheque / transfer reference" /></Field>
          <Field label="Date"><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
        </form>
      </Modal>
    </div>
  );
}
