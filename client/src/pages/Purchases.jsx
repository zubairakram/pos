import { useMemo, useState } from 'react';
import {
  Banknote, Download, Eye, PackagePlus, Plus, Printer, Search, Trash2, Truck,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { downloadCSV, daysAgoInput, todayInput, useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, IconButton, Input, LoadingBlock, Modal,
  PageHeader, Pagination, Select, Spinner, StatusBadge, Textarea,
} from '../components/ui.jsx';

const PAGE_SIZE = 25;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function blankItem(products) {
  const first = products[0];
  return {
    product_id: first ? String(first.id) : '',
    quantity: '1',
    unit_cost: first ? String(first.cost_price ?? '') : '',
    discount: '',
    tax_rate: first ? String(first.tax_rate ?? '') : '',
  };
}

export default function Purchases() {
  const { user } = useAuth();
  const { money, date, dateTime, qty } = useFormat();
  const toast = useToast();

  const [from, setFrom] = useState(daysAgoInput(90));
  const [to, setTo] = useState(todayInput());
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const debouncedQ = useDebounced(q);

  const [selectedId, setSelectedId] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', method_id: '', reference: '', date: todayInput(), session_id: '', location_id: '' });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ supplier_id: '', location_id: '', bill_no: '', date: todayInput(), due_date: '', discount: '', notes: '' });
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  const suppliersApi = useApi('/suppliers');
  const locationsApi = useApi('/locations');
  const methodsApi = useApi('/payment-methods');
  const currentSessionApi = useApi('/cash/sessions/current');
  const list = useApi('/purchases', {
    from, to, supplier_id: supplierId || undefined, status: status || undefined,
    q: debouncedQ || undefined, limit: PAGE_SIZE, offset,
  }, { enabled: !!from && !!to });
  const detail = useApi(selectedId ? `/purchases/${selectedId}` : null);

  const createLocationId = form.location_id || (user.location_id ? String(user.location_id) : '');
  const productsApi = useApi('/products', { location_id: createLocationId || undefined }, { enabled: createOpen && !!createLocationId });

  const suppliers = (suppliersApi.data?.suppliers || []).filter((s) => s.is_active !== false);
  const locations = (locationsApi.data?.locations || []).filter((l) => l.is_active !== false);
  const methods = (methodsApi.data?.payment_methods || []).filter((m) => m.is_active !== false);
  const session = currentSessionApi.data?.session;
  const products = productsApi.data?.products || [];

  const rows = list.data?.purchases || [];
  const totals = list.data?.totals;
  const purchase = detail.data?.purchase;

  const canPay = ['admin', 'manager', 'accountant'].includes(user.role);
  const canCreate = ['admin', 'manager', 'storekeeper', 'accountant'].includes(user.role);

  const createTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const line of items) {
      const net = Math.max(0, Number(line.quantity || 0) * Number(line.unit_cost || 0) - Number(line.discount || 0));
      subtotal += net;
      tax += net * (Number(line.tax_rate || 0) / 100);
    }
    subtotal = r2(subtotal);
    tax = r2(tax);
    const orderDiscount = r2(form.discount || 0);
    return { subtotal, tax, discount: orderDiscount, total: r2(Math.max(0, subtotal + tax - orderDiscount)) };
  }, [items, form.discount]);

  function openCreate() {
    setForm({
      supplier_id: '', location_id: String(user.location_id || locations[0]?.id || ''),
      bill_no: '', date: todayInput(), due_date: '', discount: '', notes: '',
    });
    setItems([]);
    setCreateError('');
    setCreateOpen(true);
    productsApi.reload();
  }

  function addItem() {
    setItems((prev) => [...prev, blankItem(products)]);
  }

  function updateItem(index, patch) {
    setItems((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitPurchase(e) {
    e.preventDefault();
    setCreateError('');
    if (!form.supplier_id) return setCreateError('Choose a supplier.');
    if (!form.location_id) return setCreateError('Choose a receiving location.');
    if (!items.length) return setCreateError('Add at least one purchase line.');
    const payloadItems = items.filter((l) => l.product_id && Number(l.quantity) > 0).map((l) => ({
      product_id: Number(l.product_id),
      quantity: Number(l.quantity),
      unit_cost: Number(l.unit_cost || 0),
      discount: Number(l.discount || 0),
      tax_rate: Number(l.tax_rate || 0),
    }));
    if (!payloadItems.length) return setCreateError('Add at least one valid line.');
    setSaving(true);
    try {
      await api.post('/purchases', {
        supplier_id: Number(form.supplier_id),
        location_id: Number(form.location_id),
        bill_no: form.bill_no || undefined,
        date: form.date,
        due_date: form.due_date || undefined,
        discount: Number(form.discount || 0),
        notes: form.notes || undefined,
        items: payloadItems,
      });
      toast.success('Purchase received and inventory updated');
      setCreateOpen(false);
      list.reload();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openPay() {
    const cash = methods.find((m) => m.type === 'cash') || methods[0];
    setPay({
      amount: String(purchase?.due ?? ''),
      method_id: cash ? String(cash.id) : '',
      reference: '',
      date: todayInput(),
      session_id: session?.id ? String(session.id) : '',
      location_id: String(purchase?.location_id || user.location_id || ''),
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
      await api.post(`/purchases/${selectedId}/pay`, {
        amount,
        method_id: Number(pay.method_id),
        reference: pay.reference || undefined,
        date: pay.date,
        location_id: Number(pay.location_id || user.location_id),
        session_id: pay.session_id ? Number(pay.session_id) : undefined,
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

  function exportPurchases() {
    downloadCSV(`purchases-${from}-to-${to}.csv`, [
      { header: 'Bill no', key: 'bill_no' },
      { header: 'Date', value: (r) => new Date(r.created_at).toISOString() },
      { header: 'Supplier', key: 'supplier_name' },
      { header: 'Location', key: 'location_name' },
      { header: 'Subtotal', key: 'subtotal' },
      { header: 'Discount', key: 'discount' },
      { header: 'Tax', key: 'tax' },
      { header: 'Total', key: 'total' },
      { header: 'Paid', key: 'paid' },
      { header: 'Due', key: 'due' },
      { header: 'Status', key: 'status' },
    ], rows);
    toast.success('Purchases exported');
  }

  const payMethod = methods.find((m) => String(m.id) === String(pay.method_id));

  return (
    <div className="page">
      <PageHeader
        title="Purchases"
        subtitle="Receive supplier bills, update weighted-average cost and track payables."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportPurchases} disabled={!rows.length}>Export CSV</Button>
            {canCreate && <Button icon={PackagePlus} onClick={openCreate}>New purchase</Button>}
          </>
        )}
      />

      <Card>
        <div className="toolbar">
          <div className="toolbar-left">
            <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} /></Field>
            <Field label="Supplier">
              <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setOffset(0); }}>
                <option value="">All suppliers</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
                <option value="">All statuses</option>
                <option value="received">Received</option>
                <option value="voided">Voided</option>
              </Select>
            </Field>
          </div>
          <div className="toolbar-right">
            <div className="search-input">
              <Search size={16} />
              <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Bill or supplier…" />
            </div>
          </div>
        </div>
        {totals && (
          <div className="kpi-inline mt">
            <div className="item"><div className="label">Bills</div><div className="value">{totals.count}</div></div>
            <div className="item"><div className="label">Purchases</div><div className="value">{money(totals.total)}</div></div>
            <div className="item"><div className="label">Paid</div><div className="value">{money(totals.paid)}</div></div>
            <div className="item"><div className="label">Outstanding</div><div className="value">{money(totals.due)}</div></div>
          </div>
        )}
      </Card>

      <Card noPad>
        {list.loading && !list.data ? <LoadingBlock /> : (
          <>
            <DataTable
              rows={rows}
              onRowClick={(r) => setSelectedId(r.id)}
              empty="No purchases match these filters"
              columns={[
                { key: 'bill_no', header: 'Bill', render: (r) => <span className="mono bold">{r.bill_no}</span> },
                { key: 'created_at', header: 'Received', render: (r) => <div><div>{date(r.created_at)}</div><div className="tiny muted">{dateTime(r.created_at).split(', ')[1] || ''}</div></div> },
                { key: 'supplier_name', header: 'Supplier' },
                { key: 'location_name', header: 'Location', render: (r) => <span className="muted">{r.location_name}</span> },
                { key: 'total', header: 'Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
                { key: 'paid', header: 'Paid', align: 'right', render: (r) => money(r.paid) },
                { key: 'due', header: 'Due', align: 'right', render: (r) => <span className={Number(r.due) > 0 ? 'neg' : 'muted'}>{money(r.due)}</span> },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon={Eye} onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>View</Button> },
              ]}
            />
            <div style={{ padding: '0 14px 12px' }}>
              <Pagination limit={PAGE_SIZE} offset={offset} total={list.data?.total ?? totals?.count ?? 0} onChange={setOffset} />
            </div>
          </>
        )}
      </Card>

      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={purchase ? `Purchase ${purchase.bill_no}` : 'Purchase detail'}
        subtitle={purchase ? `${dateTime(purchase.created_at)} · ${purchase.supplier_name}` : ''}
        size="lg"
        footer={purchase ? (
          <>
            {canPay && purchase.status !== 'voided' && Number(purchase.due) > 0 && (
              <Button icon={Banknote} onClick={openPay}>Pay supplier</Button>
            )}
            <Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button>
            <Button variant="secondary" onClick={() => setSelectedId(null)}>Close</Button>
          </>
        ) : null}
      >
        {detail.loading && !purchase ? <Spinner /> : !purchase ? <div className="muted">Unable to load purchase.</div> : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Supplier</div><div className="value" style={{ fontSize: 13 }}>{purchase.supplier_name}</div></div>
              <div className="summary-box"><div className="label">Location</div><div className="value" style={{ fontSize: 13 }}>{purchase.location_name}</div></div>
              <div className="summary-box"><div className="label">Status</div><div className="value" style={{ fontSize: 13 }}><StatusBadge status={purchase.status} /></div></div>
            </div>

            <DataTable
              rows={purchase.items || []}
              dense
              columns={[
                { key: 'description', header: 'Item', render: (r) => <div><div>{r.description}</div><div className="tiny muted">{r.sku}</div></div> },
                { key: 'quantity', header: 'Qty', align: 'right', render: (r) => qty(r.quantity) },
                { key: 'unit_cost', header: 'Unit cost', align: 'right', render: (r) => money(r.unit_cost) },
                { key: 'discount', header: 'Discount', align: 'right', render: (r) => money(r.discount) },
                { key: 'tax_amount', header: 'Tax', align: 'right', render: (r) => money(r.tax_amount) },
                { key: 'line_total', header: 'Line total', align: 'right', render: (r) => money(r.line_total) },
              ]}
            />

            <div className="grid grid-2">
              <div className="stack-sm">
                <div className="sum-row"><span>Subtotal</span><span>{money(purchase.subtotal)}</span></div>
                <div className="sum-row"><span>Discount</span><span>−{money(purchase.discount)}</span></div>
                <div className="sum-row"><span>Tax</span><span>{money(purchase.tax)}</span></div>
                <div className="sum-row total" style={{ fontSize: 16 }}><span>Total</span><span>{money(purchase.total)}</span></div>
                <div className="sum-row"><span>Paid</span><span>{money(purchase.paid)}</span></div>
                <div className="sum-row"><span>Due</span><span className={Number(purchase.due) > 0 ? 'neg' : ''}>{money(purchase.due)}</span></div>
                {purchase.due_date && <div className="sum-row"><span>Due date</span><span>{date(purchase.due_date)}</span></div>}
              </div>
              <div className="stack-sm">
                <div className="section-title" style={{ marginBottom: 2 }}><h3>Payments</h3></div>
                {(purchase.payments || []).length === 0 && <span className="muted small">No payments recorded.</span>}
                {(purchase.payments || []).map((p) => (
                  <div className="sum-row" key={p.id}>
                    <span>{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <span>{money(p.amount)}</span>
                  </div>
                ))}
                {purchase.notes && (
                  <>
                    <div className="divider" />
                    <div className="small muted">{purchase.notes}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New purchase"
        subtitle="Receiving stock posts inventory, input tax and accounts payable."
        size="xl"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button icon={PackagePlus} onClick={submitPurchase} loading={saving}>Receive purchase</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitPurchase}>
          {createError && <div className="info-note danger">{createError}</div>}
          <div className="grid grid-3">
            <Field label="Supplier">
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Choose supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Receive into">
              <Select value={createLocationId} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Bill number" hint="Leave blank to auto-generate">
              <Input value={form.bill_no} onChange={(e) => setForm({ ...form, bill_no: e.target.value })} placeholder="Auto" />
            </Field>
            <Field label="Purchase date">
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Due date" hint="Defaults to payment terms">
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </Field>
            <Field label="Order discount">
              <Input value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} inputMode="decimal" placeholder="0.00" />
            </Field>
          </div>

          <div className="section-title"><h3>Items</h3><Button type="button" size="sm" variant="secondary" icon={Plus} onClick={addItem} disabled={!products.length}>Add line</Button></div>
          {items.length === 0 && <div className="muted small">No lines yet — add the products you received.</div>}
          <div className="transfer-items">
            {items.map((line, index) => {
              const product = products.find((p) => String(p.id) === String(line.product_id));
              const net = Math.max(0, Number(line.quantity || 0) * Number(line.unit_cost || 0) - Number(line.discount || 0));
              const lineTax = net * (Number(line.tax_rate || 0) / 100);
              return (
                <div className="transfer-line" key={index} style={{ gridTemplateColumns: '2fr 0.7fr 0.9fr 0.8fr 0.7fr auto auto' }}>
                  <Select value={line.product_id} onChange={(e) => {
                    const p = products.find((x) => String(x.id) === e.target.value);
                    updateItem(index, {
                      product_id: e.target.value,
                      unit_cost: p ? String(p.cost_price ?? '') : line.unit_cost,
                      tax_rate: p ? String(p.tax_rate ?? '') : line.tax_rate,
                    });
                  }}>
                    <option value="">Choose product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Input value={line.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} inputMode="decimal" placeholder="Qty" aria-label="Quantity" />
                  <Input value={line.unit_cost} onChange={(e) => updateItem(index, { unit_cost: e.target.value })} inputMode="decimal" placeholder="Cost" aria-label="Unit cost" />
                  <Input value={line.discount} onChange={(e) => updateItem(index, { discount: e.target.value })} inputMode="decimal" placeholder="Disc" aria-label="Line discount" />
                  <Input value={line.tax_rate} onChange={(e) => updateItem(index, { tax_rate: e.target.value })} inputMode="decimal" placeholder="Tax %" aria-label="Tax rate" />
                  <span className="small bold nowrap">{money(net + lineTax)}</span>
                  <IconButton icon={Trash2} label="Remove line" onClick={() => removeItem(index)} />
                </div>
              );
            })}
          </div>

          <div className="grid grid-2">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Reference, delivery note…" />
            </Field>
            <div className="stack-sm">
              <div className="sum-row"><span>Subtotal</span><span>{money(createTotals.subtotal)}</span></div>
              <div className="sum-row"><span>Order discount</span><span>−{money(createTotals.discount)}</span></div>
              <div className="sum-row"><span>Input tax</span><span>{money(createTotals.tax)}</span></div>
              <div className="sum-row total" style={{ fontSize: 16 }}><span>Total</span><span>{money(createTotals.total)}</span></div>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => !paySaving && setPayOpen(false)}
        title="Pay supplier"
        subtitle={purchase ? `${purchase.bill_no} · outstanding ${money(purchase.due)}` : ''}
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
          <Field label="Amount">
            <Input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Payment method">
            <Select value={pay.method_id} onChange={(e) => setPay({ ...pay, method_id: e.target.value })}>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.type}</option>)}
            </Select>
          </Field>
          {payMethod?.type === 'cash' && (
            <Field label="Cash drawer" hint={session ? `${session.register_name} · expected ${money(session.expected_cash)}` : 'No open drawer'}>
              <Select value={pay.session_id} onChange={(e) => setPay({ ...pay, session_id: e.target.value })}>
                <option value="">Choose drawer</option>
                {session && <option value={session.id}>{session.register_name} · {money(session.expected_cash)}</option>}
              </Select>
            </Field>
          )}
          <Field label="Reference">
            <Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Cheque / transfer reference" />
          </Field>
          <Field label="Date">
            <Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
