import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, Download, Eye, RotateCcw, Search, Undo2,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { downloadCSV, daysAgoInput, todayInput, useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, Input, LoadingBlock, Modal,
  PageHeader, Select, Spinner, StatusBadge, Textarea,
} from '../components/ui.jsx';

export default function Returns() {
  const { money, date, dateTime, qty } = useFormat();
  const toast = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const preselect = Number(searchParams.get('sale')) || null;

  const [from, setFrom] = useState(daysAgoInput(30));
  const [to, setTo] = useState(todayInput());
  const [open, setOpen] = useState(!!preselect);
  const [selectedReturn, setSelectedReturn] = useState(null);

  const list = useApi('/returns', { from, to });
  const detail = useApi(selectedReturn ? `/returns/${selectedReturn}` : null);
  const rows = list.data?.returns || [];

  function exportReturns() {
    downloadCSV(`returns-${from}-to-${to}.csv`, [
      { header: 'Return no', key: 'return_no' },
      { header: 'Date', value: (r) => new Date(r.created_at).toISOString() },
      { header: 'Invoice', key: 'invoice_no' },
      { header: 'Customer', value: (r) => r.customer_name || 'Walk-in' },
      { header: 'Method', key: 'method_name' },
      { header: 'Items', key: 'item_count' },
      { header: 'Total', key: 'total' },
      { header: 'Tax', key: 'tax' },
      { header: 'User', key: 'user_name' },
    ], rows);
    toast.success('Returns exported');
  }

  return (
    <div className="page">
      <PageHeader
        title="Returns"
        subtitle="Refund items, restore stock and reverse the ledger correctly."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportReturns} disabled={!rows.length}>Export CSV</Button>
            <Button icon={Undo2} onClick={() => setOpen(true)}>New return</Button>
          </>
        )}
      />

      <Card>
        <div className="toolbar">
          <div className="toolbar-left">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="toolbar-right">
            <Badge tone="neutral">{rows.length} return(s)</Badge>
          </div>
        </div>
      </Card>

      <Card noPad>
        {list.loading && !list.data ? <LoadingBlock /> : (
          <DataTable
            rows={rows}
            empty="No returns in this period"
            onRowClick={(r) => setSelectedReturn(r.id)}
            columns={[
              { key: 'return_no', header: 'Return', render: (r) => <span className="mono bold">{r.return_no}</span> },
              { key: 'created_at', header: 'Date', render: (r) => <div><div>{date(r.created_at)}</div><div className="tiny muted">{dateTime(r.created_at).split(', ')[1] || ''}</div></div> },
              { key: 'invoice_no', header: 'Original invoice', render: (r) => <span className="mono">{r.invoice_no}</span> },
              { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || <span className="muted">Walk-in</span> },
              { key: 'user_name', header: 'Processed by' },
              { key: 'method_name', header: 'Refund method', render: (r) => r.method_name || <span className="muted">Credit</span> },
              { key: 'item_count', header: 'Items', align: 'right' },
              { key: 'total', header: 'Refund', align: 'right', render: (r) => <b>{money(r.total)}</b> },
              { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon={Eye} onClick={(e) => { e.stopPropagation(); setSelectedReturn(r.id); }}>View</Button> },
            ]}
            footer={rows.length ? (
              <tr>
                <td colSpan={7}>Total refunded</td>
                <td className="align-right">{money(rows.reduce((s, r) => s + Number(r.total), 0))}</td>
                <td />
              </tr>
            ) : null}
          />
        )}
      </Card>

      <Modal
        open={!!selectedReturn}
        onClose={() => setSelectedReturn(null)}
        title={detail.data?.return?.return_no || 'Return detail'}
        subtitle={detail.data?.return ? `${dateTime(detail.data.return.created_at)} · invoice ${detail.data.return.invoice_no}` : ''}
        size="lg"
        footer={<Button onClick={() => setSelectedReturn(null)}>Close</Button>}
      >
        {detail.loading && !detail.data ? <Spinner /> : !detail.data?.return ? (
          <span className="muted">Unable to load return.</span>
        ) : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Customer</div><div className="value" style={{ fontSize: 13 }}>{detail.data.return.customer_name || 'Walk-in'}</div></div>
              <div className="summary-box"><div className="label">Refund method</div><div className="value" style={{ fontSize: 13 }}>{detail.data.return.method_name || 'Credit / AR'}</div></div>
              <div className="summary-box"><div className="label">Refund total</div><div className="value">{money(detail.data.return.total)}</div></div>
            </div>
            {detail.data.return.reason && (
              <div className="info-note"><RotateCcw size={16} /><div>{detail.data.return.reason}</div></div>
            )}
            <DataTable
              rows={detail.data.return.items || []}
              dense
              columns={[
                { key: 'product_name', header: 'Item', render: (r) => <div><div>{r.product_name}</div><div className="tiny muted">{r.sku}</div></div> },
                { key: 'quantity', header: 'Qty', align: 'right', render: (r) => qty(r.quantity) },
                { key: 'unit_price', header: 'Price', align: 'right', render: (r) => money(r.unit_price) },
                { key: 'tax_amount', header: 'Tax', align: 'right', render: (r) => money(r.tax_amount) },
                { key: 'line_total', header: 'Refund', align: 'right', render: (r) => money(r.line_total) },
              ]}
            />
          </div>
        )}
      </Modal>

      <ReturnModal
        open={open}
        preselect={preselect}
        onClose={() => { setOpen(false); if (preselect) setSearchParams({}); }}
        onCreated={() => {
          setOpen(false);
          if (preselect) setSearchParams({});
          list.reload();
        }}
        money={money}
        date={date}
        qty={qty}
        user={user}
      />
    </div>
  );
}

function ReturnModal({ open, preselect, onClose, onCreated, money, date, qty, user }) {
  const toast = useToast();
  const [saleId, setSaleId] = useState(preselect || null);
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [saleResults, setSaleResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [sale, setSale] = useState(null);
  const [loadingSale, setLoadingSale] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [methodId, setMethodId] = useState('');
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(todayInput());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const debounced = useDebounced(invoiceQuery);

  const methodsApi = useApi('/payment-methods');
  const registersApi = useApi('/cash/registers');
  const sessionsApi = useApi('/cash/sessions', { status: 'open' });
  const currentApi = useApi('/cash/sessions/current');
  const methods = (methodsApi.data?.payment_methods || []).filter((m) => m.is_active !== false);
  const registers = registersApi.data?.registers || [];
  const openSessions = (sessionsApi.data?.sessions || []).filter((s) => s.status === 'open');

  useEffect(() => {
    if (!open) return;
    setSaleId(preselect || null);
    setSale(null);
    setQuantities({});
    setReason('');
    setError('');
    setInvoiceQuery('');
    setSaleResults([]);
    setReturnDate(todayInput());
  }, [open, preselect]);

  useEffect(() => {
    if (!open || !saleId) return;
    let alive = true;
    setLoadingSale(true);
    setError('');
    api.get(`/sales/${saleId}`)
      .then((data) => {
        if (!alive) return;
        setSale(data.sale);
        const init = {};
        (data.sale.items || []).forEach((i) => { init[i.id] = 0; });
        setQuantities(init);
        const cash = methods.find((m) => m.type === 'cash');
        setMethodId(String(cash?.id || methods[0]?.id || ''));
      })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoadingSale(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleId, methods.length]);

  useEffect(() => {
    if (!open || saleId || debounced.trim().length < 2) { setSaleResults([]); return undefined; }
    let alive = true;
    setSearching(true);
    api.get('/sales', { q: debounced.trim(), limit: 8 })
      .then((data) => { if (alive) setSaleResults(data.sales || []); })
      .catch(() => { if (alive) setSaleResults([]); })
      .finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [open, saleId, debounced]);

  const selectedItems = useMemo(() => {
    if (!sale) return [];
    return (sale.items || [])
      .map((item) => ({ ...item, returnQty: Number(quantities[item.id] || 0) }))
      .filter((item) => item.returnQty > 0);
  }, [sale, quantities]);

  const refundPreview = selectedItems.reduce((sum, item) => {
    const ratio = Number(item.quantity) > 0 ? item.returnQty / Number(item.quantity) : 0;
    return sum + Number(item.line_total) * ratio;
  }, 0);

  const arReduction = sale ? Math.min(Number(sale.due || 0), refundPreview) : 0;
  const cashRefund = Math.max(0, refundPreview - arReduction);
  const selectedMethod = methods.find((m) => String(m.id) === String(methodId));

  const sessionForSale = useMemo(() => {
    if (!sale) return null;
    const ids = registers.filter((r) => r.location_id === sale.location_id && r.open_session_id).map((r) => r.id);
    return openSessions.find((s) => ids.includes(s.register_id)) || null;
  }, [sale, registers, openSessions]);

  const cashierSession = user.role === 'cashier' ? currentApi.data?.session : null;
  const drawerSession = cashierSession && sale && cashierSession.register_id && registers.find((r) => r.id === cashierSession.register_id)?.location_id === sale.location_id
    ? cashierSession : sessionForSale;

  async function selectSale(id) {
    setSaleId(id);
    setSaleResults([]);
  }

  function setQty(itemId, value) {
    const item = (sale?.items || []).find((i) => i.id === itemId);
    const max = item ? Number(item.quantity) - Number(item.returned_qty || 0) : 0;
    const n = Math.max(0, Math.min(max, Number(value) || 0));
    setQuantities((prev) => ({ ...prev, [itemId]: n }));
  }

  async function submit() {
    setError('');
    if (!sale) return;
    if (!selectedItems.length) { setError('Select at least one item to return.'); return; }
    if (selectedMethod?.type === 'cash' && cashRefund > 0 && !drawerSession) {
      setError('A cash refund needs an open drawer session at this location. Open one from Cash & Drawers, or refund to credit.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/sales/${sale.id}/returns`, {
        items: selectedItems.map((i) => ({ sale_item_id: i.id, quantity: i.returnQty })),
        method_id: methodId ? Number(methodId) : undefined,
        session_id: selectedMethod?.type === 'cash' && cashRefund > 0 ? drawerSession?.id : undefined,
        reason: reason || undefined,
        date: returnDate,
      });
      toast.success('Return processed and ledger updated');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title="New sales return"
      subtitle="Find the original sale, choose items and issue the refund."
      size="lg"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          {sale && (
            <Button variant="secondary" icon={ArrowLeftRight} onClick={() => { setSaleId(null); setSale(null); }} disabled={submitting}>
              Change sale
            </Button>
          )}
          <Button icon={Undo2} onClick={submit} loading={submitting} disabled={!sale || !selectedItems.length}>
            Process return
          </Button>
        </>
      )}
    >
      <div className="stack">
        {error && <div className="info-note danger"><AlertTriangle size={16} /><div>{error}</div></div>}

        {!sale ? (
          <>
            <Field label="Find the original invoice" hint="Search by invoice number or customer name.">
              <div className="input-group">
                <div className="search-input grow">
                  <Search size={16} />
                  <input
                    value={invoiceQuery}
                    onChange={(e) => setInvoiceQuery(e.target.value)}
                    placeholder="e.g. INV-000123 or Acme"
                    autoFocus
                  />
                </div>
              </div>
            </Field>
            {searching && <Spinner label="Searching sales…" />}
            {saleResults.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="align-right">Total</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {saleResults.map((s) => (
                      <tr key={s.id}>
                        <td className="mono">{s.invoice_no}</td>
                        <td>{date(s.created_at)}</td>
                        <td>{s.customer_name || 'Walk-in'}</td>
                        <td className="align-right">{money(s.total)}</td>
                        <td><StatusBadge status={s.status} /></td>
                        <td className="align-right"><Button size="sm" onClick={() => selectSale(s.id)}>Select</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {debounced.trim().length >= 2 && !searching && saleResults.length === 0 && (
              <div className="muted small">No matching sales. Check the invoice number.</div>
            )}
            {loadingSale && <Spinner label="Loading sale…" />}
          </>
        ) : (
          <>
            <div className="info-note">
              <RotateCcw size={16} />
              <div>
                <b>{sale.invoice_no}</b> · {sale.customer_name || 'Walk-in customer'} · {date(sale.created_at)} · {money(sale.total)}
                {Number(sale.due) > 0 && ` · ${money(sale.due)} still due`}
              </div>
            </div>

            <DataTable
              rows={sale.items || []}
              dense
              empty="No items on this sale"
              columns={[
                { key: 'product_name', header: 'Item', render: (r) => <div><div>{r.description || r.product_name}</div><div className="tiny muted">{r.sku}</div></div> },
                { key: 'quantity', header: 'Sold', align: 'right', render: (r) => qty(r.quantity) },
                { key: 'returned_qty', header: 'Returned', align: 'right', render: (r) => qty(r.returned_qty || 0) },
                { key: 'unit_price', header: 'Price', align: 'right', render: (r) => money(r.unit_price) },
                {
                  key: 'return_quantity',
                  header: 'Return qty',
                  align: 'right',
                  render: (r) => {
                    const max = Number(r.quantity) - Number(r.returned_qty || 0);
                    return (
                      <Input
                        type="number"
                        min="0"
                        max={max}
                        step="1"
                        value={quantities[r.id] ?? 0}
                        onChange={(e) => setQty(r.id, e.target.value)}
                        disabled={max <= 0}
                        style={{ width: 90, height: 30, textAlign: 'right', marginLeft: 'auto' }}
                      />
                    );
                  },
                },
                {
                  key: 'refund',
                  header: 'Refund',
                  align: 'right',
                  render: (r) => {
                    const ratio = Number(r.quantity) > 0 ? Number(quantities[r.id] || 0) / Number(r.quantity) : 0;
                    return money(Number(r.line_total) * ratio);
                  },
                },
              ]}
            />

            <div className="grid grid-3">
              <Field label="Refund method">
                <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="Return date">
                <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
              </Field>
              <div className="summary-box">
                <div className="label">Refund preview</div>
                <div className="value">{money(refundPreview)}</div>
                <div className="tiny muted">
                  {arReduction > 0 ? `${money(arReduction)} to account credit` : 'All to payment method'}
                  {cashRefund > 0 && ` · ${money(cashRefund)} cash/refund`}
                </div>
              </div>
            </div>

            <Field label="Reason (optional)">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged item, customer changed mind…" />
            </Field>

            {selectedMethod?.type === 'cash' && cashRefund > 0 && (
              drawerSession ? (
                <div className="info-note">Refund will be paid from drawer <b>{drawerSession.register_name}</b> ({money(drawerSession.computed_expected ?? drawerSession.expected_cash ?? 0)} expected).</div>
              ) : (
                <div className="info-note warning">
                  <AlertTriangle size={16} />
                  <div>No open drawer at this store. Open a drawer or choose a non-cash refund method. If the customer has an outstanding balance, the refund is applied to their account first.</div>
                </div>
              )
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
