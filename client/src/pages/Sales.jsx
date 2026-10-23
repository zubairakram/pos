import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ban, Download, Eye, Printer, ReceiptText, RotateCcw, Search, ShoppingBag,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { downloadCSV, daysAgoInput, todayInput, useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import { ReceiptView, printReceipt } from '../components/Receipt.jsx';
import {
  Badge, Button, Card, Confirm, DataTable, Field, Input, LoadingBlock, Modal,
  PageHeader, Pagination, Select, Spinner, StatusBadge,
} from '../components/ui.jsx';

const PAGE_SIZE = 25;

export default function Sales() {
  const { user } = useAuth();
  const { money, date, dateTime, qty } = useFormat();
  const toast = useToast();
  const navigate = useNavigate();

  const [from, setFrom] = useState(daysAgoInput(30));
  const [to, setTo] = useState(todayInput());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [locationId, setLocationId] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const debouncedQ = useDebounced(q);

  const locationsApi = useApi('/locations');
  const locations = (locationsApi.data?.locations || []).filter((l) => l.is_active !== false);

  const list = useApi('/sales', {
    from, to, status: status || undefined, q: debouncedQ || undefined,
    location_id: locationId || undefined, limit: PAGE_SIZE, offset,
  }, { enabled: !!from && !!to });

  const detail = useApi(selectedId ? `/sales/${selectedId}` : null);
  const sale = detail.data?.sale;

  const rows = list.data?.sales || [];
  const totals = list.data?.totals;

  const canVoid = ['admin', 'manager'].includes(user.role);
  const canReturn = ['admin', 'manager', 'cashier'].includes(user.role);

  function exportSales() {
    downloadCSV(`sales-${from}-to-${to}.csv`, [
      { header: 'Invoice', key: 'invoice_no' },
      { header: 'Date', value: (r) => new Date(r.created_at).toISOString() },
      { header: 'Customer', value: (r) => r.customer_name || 'Walk-in' },
      { header: 'Cashier', key: 'cashier_name' },
      { header: 'Location', key: 'location_name' },
      { header: 'Items', key: 'item_count' },
      { header: 'Subtotal', key: 'subtotal' },
      { header: 'Discount', key: 'discount' },
      { header: 'Tax', key: 'tax' },
      { header: 'Total', key: 'total' },
      { header: 'Paid', key: 'paid' },
      { header: 'Due', key: 'due' },
      { header: 'Status', key: 'status' },
    ], rows);
    toast.success('Sales exported');
  }

  async function voidSale() {
    setVoiding(true);
    try {
      await api.post(`/sales/${selectedId}/void`);
      toast.success('Sale voided and ledger reversed');
      setConfirmVoid(false);
      setSelectedId(null);
      list.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setVoiding(false);
    }
  }

  const openSale = (row) => setSelectedId(row.id);

  return (
    <div className="page">
      <PageHeader
        title="Sales"
        subtitle="Every sale, receipt and credit invoice with its ledger trail."
        actions={(
          <>
            <Button variant="secondary" icon={Download} onClick={exportSales} disabled={!rows.length}>Export CSV</Button>
            {['admin', 'manager', 'cashier'].includes(user.role) && (
              <Button icon={ShoppingBag} onClick={() => navigate('/pos')}>New sale</Button>
            )}
          </>
        )}
      />

      <Card>
        <div className="toolbar">
          <div className="toolbar-left">
            <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} /></Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
                <option value="">All statuses</option>
                <option value="completed">Completed</option>
                <option value="partially_refunded">Partially refunded</option>
                <option value="refunded">Refunded</option>
                <option value="voided">Voided</option>
              </Select>
            </Field>
            {locations.length > 1 && (
              <Field label="Location">
                <Select value={locationId} onChange={(e) => { setLocationId(e.target.value); setOffset(0); }}>
                  <option value="">All locations</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <div className="toolbar-right">
            <div className="search-input">
              <Search size={16} />
              <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Invoice or customer…" />
            </div>
          </div>
        </div>

        {totals && (
          <div className="kpi-inline mt">
            <div className="item"><div className="label">Transactions</div><div className="value">{totals.count}</div></div>
            <div className="item"><div className="label">Gross sales</div><div className="value">{money(totals.total)}</div></div>
            <div className="item"><div className="label">Collected</div><div className="value">{money(totals.paid)}</div></div>
            <div className="item"><div className="label">Outstanding</div><div className="value">{money(totals.due)}</div></div>
          </div>
        )}
      </Card>

      <Card noPad>
        {list.loading && !list.data ? <LoadingBlock /> : (
          <>
            <DataTable
              rows={rows}
              onRowClick={openSale}
              empty="No sales match these filters"
              columns={[
                { key: 'invoice_no', header: 'Invoice', render: (r) => <div><div className="mono bold">{r.invoice_no}</div><div className="tiny muted">{r.item_count} item(s)</div></div> },
                { key: 'created_at', header: 'Date', render: (r) => <div><div>{date(r.created_at)}</div><div className="tiny muted">{dateTime(r.created_at).split(', ')[1] || ''}</div></div> },
                { key: 'customer_name', header: 'Customer', render: (r) => r.customer_name || <span className="muted">Walk-in</span> },
                { key: 'cashier_name', header: 'Cashier' },
                { key: 'location_name', header: 'Location', render: (r) => <span className="muted">{r.location_name}</span> },
                { key: 'total', header: 'Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
                { key: 'paid', header: 'Paid', align: 'right', render: (r) => money(r.paid) },
                { key: 'due', header: 'Due', align: 'right', render: (r) => <span className={Number(r.due) > 0 ? 'neg' : 'muted'}>{money(r.due)}</span> },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon={Eye} onClick={(e) => { e.stopPropagation(); openSale(r); }}>View</Button> },
              ]}
              footer={rows.length ? (
                <tr>
                  <td colSpan={5}>Page total</td>
                  <td className="align-right">{money(rows.reduce((s, r) => s + Number(r.total), 0))}</td>
                  <td className="align-right">{money(rows.reduce((s, r) => s + Number(r.paid), 0))}</td>
                  <td className="align-right">{money(rows.reduce((s, r) => s + Number(r.due), 0))}</td>
                  <td colSpan={2} />
                </tr>
              ) : null}
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
        title={sale?.invoice_no ? `Sale ${sale.invoice_no}` : 'Sale detail'}
        subtitle={sale ? `${dateTime(sale.created_at)} · ${sale.location_name}` : ''}
        size="lg"
        footer={sale ? (
          <>
            {canReturn && !['voided', 'refunded'].includes(sale.status) && (
              <Button variant="secondary" icon={RotateCcw} onClick={() => navigate(`/returns?sale=${sale.id}`)}>Return items</Button>
            )}
            {canVoid && sale.status !== 'voided' && (
              <Button variant="danger-soft" icon={Ban} onClick={() => setConfirmVoid(true)}>Void sale</Button>
            )}
            <Button variant="secondary" icon={Printer} onClick={() => printReceipt()}>Print</Button>
            <Button onClick={() => setSelectedId(null)}>Close</Button>
          </>
        ) : null}
      >
        {detail.loading && !sale ? <Spinner /> : !sale ? (
          <div className="muted">Unable to load sale.</div>
        ) : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Customer</div><div className="value" style={{ fontSize: 13 }}>{sale.customer_name || 'Walk-in'}</div></div>
              <div className="summary-box"><div className="label">Cashier</div><div className="value" style={{ fontSize: 13 }}>{sale.cashier_name}</div></div>
              <div className="summary-box"><div className="label">Status</div><div className="value" style={{ fontSize: 13 }}><StatusBadge status={sale.status} /></div></div>
            </div>

            <DataTable
              rows={sale.items || []}
              dense
              columns={[
                { key: 'product_name', header: 'Item', render: (r) => <div><div>{r.description || r.product_name}</div><div className="tiny muted">{r.sku}</div></div> },
                { key: 'quantity', header: 'Qty', align: 'right', render: (r) => `${qty(r.quantity)}${Number(r.returned_qty) > 0 ? ` (${qty(r.returned_qty)} returned)` : ''}` },
                { key: 'unit_price', header: 'Price', align: 'right', render: (r) => money(r.unit_price) },
                { key: 'tax_amount', header: 'Tax', align: 'right', render: (r) => money(r.tax_amount) },
                { key: 'line_total', header: 'Line total', align: 'right', render: (r) => money(r.line_total) },
              ]}
            />

            <div className="grid grid-2">
              <div className="stack-sm">
                <div className="sum-row"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
                <div className="sum-row"><span>Discount</span><span>−{money(sale.discount)}</span></div>
                <div className="sum-row"><span>Tax</span><span>{money(sale.tax)}</span></div>
                <div className="sum-row total" style={{ fontSize: 16 }}><span>Total</span><span>{money(sale.total)}</span></div>
                <div className="sum-row"><span>Paid</span><span>{money(sale.paid)}</span></div>
                <div className="sum-row"><span>Due</span><span className={Number(sale.due) > 0 ? 'neg' : ''}>{money(sale.due)}</span></div>
                {Number(sale.change_due) > 0 && <div className="sum-row"><span>Change given</span><span>{money(sale.change_due)}</span></div>}
              </div>
              <div className="stack-sm">
                <div className="section-title" style={{ marginBottom: 2 }}><h3>Payments</h3></div>
                {(sale.payments || []).length === 0 && <span className="muted small">No payments recorded.</span>}
                {(sale.payments || []).map((p) => (
                  <div className="sum-row" key={p.id}>
                    <span>{p.method_name}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <span>{money(p.amount)}</span>
                  </div>
                ))}
                {(sale.returns || []).length > 0 && (
                  <>
                    <div className="divider" />
                    <div className="section-title" style={{ marginBottom: 2 }}><h3>Returns</h3></div>
                    {sale.returns.map((r) => (
                      <div className="sum-row" key={r.id}>
                        <span className="mono">{r.return_no}</span>
                        <span>{money(r.total)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {(sale.journal || []).length > 0 && (
              <div>
                <div className="section-title"><h3>Ledger postings</h3><span className="tiny muted">Balanced double-entry</span></div>
                <DataTable
                  rows={sale.journal}
                  dense
                  columns={[
                    { key: 'entry_no', header: 'Entry', render: (r) => <span className="mono">{r.entry_no}</span> },
                    { key: 'entry_date', header: 'Date', render: (r) => date(r.entry_date) },
                    { key: 'memo', header: 'Memo' },
                    { key: 'source_type', header: 'Source', render: (r) => <Badge tone="neutral">{r.source_type}</Badge> },
                    { key: 'total_debit', header: 'Debit', align: 'right', render: (r) => money(r.total_debit) },
                    { key: 'total_credit', header: 'Credit', align: 'right', render: (r) => money(r.total_credit) },
                  ]}
                />
              </div>
            )}

            <div className="section-title"><h3>Receipt preview</h3></div>
            <div style={{ border: '1px dashed var(--border-strong)', borderRadius: 10, padding: 16 }}>
              <ReceiptView sale={sale} />
            </div>
          </div>
        )}
      </Modal>

      <Confirm
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        onConfirm={voidSale}
        loading={voiding}
        danger
        title="Void this sale?"
        confirmLabel="Void sale"
        message="The sale will be marked voided, stock will be returned and the journal will be reversed. This cannot be undone."
      />
    </div>
  );
}
