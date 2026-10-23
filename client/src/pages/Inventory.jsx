import { useMemo, useState } from 'react';
import {
  ArrowLeftRight, Boxes, Download, Plus, Search, SlidersHorizontal, Trash2,
  TrendingUp, Warehouse,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { downloadCSV, daysAgoInput, todayInput, useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, IconButton, Input, LoadingBlock, Modal,
  PageHeader, Select, Stat, Tabs, Textarea,
} from '../components/ui.jsx';

const MOVEMENT_TONES = {
  sale: 'info',
  return: 'warning',
  purchase: 'success',
  adjustment: 'purple',
  opening: 'brand',
  transfer_out: 'danger',
  transfer_in: 'success',
};

function movementLabel(type = '') {
  return type.replaceAll('_', ' ');
}

export default function Inventory() {
  const { user } = useAuth();
  const { money, number, qty, date, dateTime } = useFormat();
  const toast = useToast();
  const [tab, setTab] = useState('stock');

  const [locationId, setLocationId] = useState(user.location_id ? String(user.location_id) : '');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const debounced = useDebounced(search);

  const [movementProduct, setMovementProduct] = useState('');
  const [movementFrom, setMovementFrom] = useState(daysAgoInput(30));
  const [movementTo, setMovementTo] = useState(todayInput());

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState({ location_id: '', product_id: '', direction: 'in', quantity: '', unit_cost: '', reason: '' });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ from_location_id: '', to_location_id: '', notes: '', items: [] });
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState('');

  const locationsApi = useApi('/locations');
  const categoriesApi = useApi('/categories');
  const productsApi = useApi('/products', { location_id: locationId || undefined }, { enabled: !!locationId });
  const stockApi = useApi('/inventory', {
    location_id: locationId || undefined,
    category_id: categoryId || undefined,
    search: debounced || undefined,
    low_stock: lowStock || undefined,
  }, { enabled: tab === 'stock' });
  const movementsApi = useApi('/inventory/movements', {
    product_id: movementProduct || undefined,
    from: movementFrom || undefined,
    to: movementTo || undefined,
    limit: 300,
  }, { enabled: tab === 'movements' });
  const transfersApi = useApi('/inventory/transfers', undefined, { enabled: tab === 'transfers' });
  const transferProductsApi = useApi('/products', { location_id: transfer.from_location_id || undefined }, { enabled: transferOpen && !!transfer.from_location_id });
  const adjustProductsApi = useApi('/products', { location_id: adjust.location_id || undefined }, { enabled: adjustOpen && !!adjust.location_id });

  const locations = (locationsApi.data?.locations || []).filter((l) => l.is_active !== false);
  const categories = categoriesApi.data?.categories || [];
  const products = productsApi.data?.products || [];
  const stock = stockApi.data?.inventory || [];
  const movements = movementsApi.data?.movements || [];
  const transfers = transfersApi.data?.transfers || [];
  const transferProducts = transferProductsApi.data?.products || [];
  const adjustProducts = adjustProductsApi.data?.products || [];

  const canAdjust = ['admin', 'manager', 'storekeeper'].includes(user.role);

  const totals = useMemo(() => stock.reduce((acc, row) => ({
    cost: acc.cost + Number(row.cost_value || 0),
    retail: acc.retail + Number(row.retail_value || 0),
    low: acc.low + (row.low_stock ? 1 : 0),
    units: acc.units + Number(row.quantity || 0),
  }), { cost: 0, retail: 0, low: 0, units: 0 }), [stock]);

  function openAdjust(product) {
    setAdjust({
      location_id: String(product?.location_id || locationId || locations[0]?.id || ''),
      product_id: String(product?.product_id || ''),
      direction: 'in',
      quantity: '',
      unit_cost: product?.avg_cost || '',
      reason: '',
    });
    setAdjustError('');
    setAdjustOpen(true);
  }

  async function submitAdjust(e) {
    e.preventDefault();
    setAdjustError('');
    const quantity = Number(adjust.quantity);
    if (!adjust.product_id) return setAdjustError('Choose a product.');
    if (!adjust.location_id) return setAdjustError('Choose a location.');
    if (!quantity || quantity <= 0) return setAdjustError('Enter a quantity greater than zero.');
    if (!adjust.reason.trim()) return setAdjustError('A reason is required.');
    setAdjustSaving(true);
    try {
      await api.post('/inventory/adjust', {
        product_id: Number(adjust.product_id),
        location_id: Number(adjust.location_id),
        quantity_delta: adjust.direction === 'out' ? -quantity : quantity,
        unit_cost: adjust.direction === 'in' ? Number(adjust.unit_cost || 0) : undefined,
        reason: adjust.reason.trim(),
      });
      toast.success('Stock adjusted and journal posted');
      setAdjustOpen(false);
      stockApi.reload();
      productsApi.reload();
      adjustProductsApi.reload();
      movementsApi.reload();
    } catch (err) {
      setAdjustError(err.message);
    } finally {
      setAdjustSaving(false);
    }
  }

  function openTransfer() {
    const from = locationId || locations[0]?.id || '';
    const to = locations.find((l) => String(l.id) !== String(from))?.id || '';
    setTransfer({ from_location_id: String(from), to_location_id: String(to), notes: '', items: [] });
    setTransferError('');
    setTransferOpen(true);
  }

  function addTransferLine() {
    setTransfer((t) => ({ ...t, items: [...t.items, { product_id: '', quantity: '1' }] }));
  }

  function updateTransferLine(index, patch) {
    setTransfer((t) => ({ ...t, items: t.items.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  }

  function removeTransferLine(index) {
    setTransfer((t) => ({ ...t, items: t.items.filter((_, i) => i !== index) }));
  }

  const transferValue = useMemo(() => transfer.items.reduce((sum, line) => {
    const product = transferProducts.find((p) => String(p.id) === String(line.product_id));
    return sum + Number(line.quantity || 0) * Number(product?.avg_cost || 0);
  }, 0), [transfer.items, transferProducts]);

  async function submitTransfer(e) {
    e.preventDefault();
    setTransferError('');
    if (!transfer.from_location_id || !transfer.to_location_id) return setTransferError('Choose both locations.');
    if (transfer.from_location_id === transfer.to_location_id) return setTransferError('Choose two different locations.');
    const items = transfer.items.filter((l) => l.product_id && Number(l.quantity) > 0);
    if (!items.length) return setTransferError('Add at least one item with a quantity.');
    setTransferSaving(true);
    try {
      await api.post('/inventory/transfer', {
        from_location_id: Number(transfer.from_location_id),
        to_location_id: Number(transfer.to_location_id),
        notes: transfer.notes || undefined,
        items: items.map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })),
      });
      toast.success('Stock transfer completed');
      setTransferOpen(false);
      stockApi.reload();
      transfersApi.reload();
      productsApi.reload();
    } catch (err) {
      setTransferError(err.message);
    } finally {
      setTransferSaving(false);
    }
  }

  function exportStock() {
    downloadCSV(`inventory-${todayInput()}.csv`, [
      { header: 'SKU', key: 'sku' },
      { header: 'Product', key: 'name' },
      { header: 'Category', key: 'category_name' },
      { header: 'Location', key: 'location_name' },
      { header: 'On hand', key: 'quantity' },
      { header: 'Average cost', key: 'avg_cost' },
      { header: 'Cost value', key: 'cost_value' },
      { header: 'Retail value', key: 'retail_value' },
      { header: 'Low stock', value: (r) => (r.low_stock ? 'yes' : 'no') },
    ], stock);
    toast.success('Stock report exported');
  }

  const tabs = [
    { value: 'stock', label: 'Stock levels', icon: Boxes, count: stock.length },
    { value: 'movements', label: 'Movements', icon: SlidersHorizontal },
    { value: 'transfers', label: 'Transfers', icon: ArrowLeftRight, count: transfers.length },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        subtitle="Stock on hand, weighted-average cost and complete movement history."
        actions={(
          <>
            {tab === 'stock' && <Button variant="secondary" icon={Download} onClick={exportStock} disabled={!stock.length}>Export CSV</Button>}
            {canAdjust && <Button variant="secondary" icon={SlidersHorizontal} onClick={() => openAdjust()}>Adjust stock</Button>}
            {canAdjust && <Button icon={ArrowLeftRight} onClick={openTransfer}>Transfer stock</Button>}
          </>
        )}
      />

      <div className="stat-grid">
        <Stat label="Stock at cost" value={money(totals.cost)} sub={`${number(totals.units)} units on hand`} icon={Warehouse} tone="brand" />
        <Stat label="Retail value" value={money(totals.retail)} sub="At current selling prices" icon={TrendingUp} tone="info" />
        <Stat label="Potential margin" value={money(totals.retail - totals.cost)} sub={totals.retail > 0 ? `${((totals.retail - totals.cost) / totals.retail * 100).toFixed(1)}% of retail` : '—'} icon={Boxes} tone="purple" />
        <Stat label="Low stock lines" value={number(totals.low)} sub="At or below reorder level" icon={SlidersHorizontal} tone={totals.low ? 'warning' : 'default'} />
      </div>

      <Card noPad>
        <div style={{ padding: '0 14px' }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
        <div className="card-body">
          {tab === 'stock' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <div className="search-input">
                    <Search size={16} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product, SKU or barcode…" />
                  </div>
                  <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ width: 170 }}>
                    <option value="">All locations</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ width: 170 }}>
                    <option value="">All categories</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <label className="checkbox">
                    <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
                    Low stock only
                  </label>
                </div>
              </div>

              {stockApi.loading && !stockApi.data ? <LoadingBlock /> : (
                <DataTable
                  rows={stock}
                  empty="No stock records match these filters"
                  columns={[
                    { key: 'name', header: 'Product', render: (r) => <div className="inventory-name"><b>{r.name}</b><span>{r.sku}{r.barcode ? ` · ${r.barcode}` : ''}</span></div> },
                    { key: 'category_name', header: 'Category', render: (r) => r.category_name || <span className="muted">—</span> },
                    { key: 'location_name', header: 'Location' },
                    {
                      key: 'quantity', header: 'On hand', align: 'right',
                      render: (r) => (
                        <Badge tone={Number(r.quantity) <= 0 ? 'danger' : r.low_stock ? 'warning' : 'success'}>
                          {qty(r.quantity)}
                        </Badge>
                      ),
                    },
                    { key: 'avg_cost', header: 'Avg cost', align: 'right', render: (r) => money(r.avg_cost) },
                    { key: 'cost_value', header: 'Cost value', align: 'right', render: (r) => <b>{money(r.cost_value)}</b> },
                    { key: 'retail_value', header: 'Retail value', align: 'right', render: (r) => money(r.retail_value) },
                    { key: 'reorder_level', header: 'Reorder at', align: 'right', render: (r) => (r.track_inventory ? qty(r.reorder_level) : <span className="muted">Service</span>) },
                    ...(canAdjust ? [{
                      key: 'actions', header: '', align: 'right',
                      render: (r) => (r.track_inventory ? <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={() => openAdjust(r)}>Adjust</Button> : null),
                    }] : []),
                  ]}
                  footer={stock.length ? (
                    <tr>
                      <td colSpan={5}>Filtered total</td>
                      <td className="align-right">{money(totals.cost)}</td>
                      <td className="align-right">{money(totals.retail)}</td>
                      <td colSpan={canAdjust ? 2 : 1} />
                    </tr>
                  ) : null}
                />
              )}
            </div>
          )}

          {tab === 'movements' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <Field label="Product">
                    <Select value={movementProduct} onChange={(e) => setMovementProduct(e.target.value)} style={{ minWidth: 220 }}>
                      <option value="">All products</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="From"><Input type="date" value={movementFrom} onChange={(e) => setMovementFrom(e.target.value)} /></Field>
                  <Field label="To"><Input type="date" value={movementTo} onChange={(e) => setMovementTo(e.target.value)} /></Field>
                </div>
                <div className="toolbar-right">
                  <Badge tone="neutral">{movements.length} movement(s)</Badge>
                </div>
              </div>

              {movementsApi.loading && !movementsApi.data ? <LoadingBlock /> : (
                <DataTable
                  rows={movements}
                  empty="No stock movements in this period"
                  columns={[
                    { key: 'created_at', header: 'Date', render: (r) => <div><div>{date(r.created_at)}</div><div className="tiny muted">{dateTime(r.created_at).split(', ')[1] || ''}</div></div> },
                    { key: 'product_name', header: 'Product', render: (r) => <div className="inventory-name"><b>{r.product_name}</b><span>{r.sku}</span></div> },
                    { key: 'location_name', header: 'Location' },
                    { key: 'type', header: 'Type', render: (r) => <Badge tone={MOVEMENT_TONES[r.type] || 'neutral'}>{movementLabel(r.type)}</Badge> },
                    {
                      key: 'quantity', header: 'Qty', align: 'right',
                      render: (r) => <span className={Number(r.quantity) < 0 ? 'neg bold' : 'bold'}>{Number(r.quantity) > 0 ? '+' : ''}{qty(r.quantity)}</span>,
                    },
                    { key: 'unit_cost', header: 'Unit cost', align: 'right', render: (r) => money(r.unit_cost) },
                    { key: 'value', header: 'Value', align: 'right', render: (r) => money(r.value) },
                    { key: 'note', header: 'Reference', render: (r) => <span className="small muted">{r.note || (r.ref_type ? `${r.ref_type} #${r.ref_id}` : '—')}</span> },
                    { key: 'user_name', header: 'User', render: (r) => r.user_name || <span className="muted">System</span> },
                  ]}
                />
              )}
            </div>
          )}

          {tab === 'transfers' && (
            <>
              {transfersApi.loading && !transfersApi.data ? <LoadingBlock /> : (
                <DataTable
                  rows={transfers}
                  empty="No stock transfers yet"
                  columns={[
                    { key: 'transfer_no', header: 'Transfer', render: (r) => <span className="mono bold">{r.transfer_no}</span> },
                    { key: 'created_at', header: 'Date', render: (r) => <div><div>{date(r.created_at)}</div><div className="tiny muted">{dateTime(r.created_at).split(', ')[1] || ''}</div></div> },
                    { key: 'from_location', header: 'From', render: (r) => <Badge tone="neutral">{r.from_location}</Badge> },
                    { key: 'to_location', header: 'To', render: (r) => <Badge tone="brand">{r.to_location}</Badge> },
                    { key: 'item_count', header: 'Lines', align: 'right' },
                    { key: 'total_quantity', header: 'Units', align: 'right', render: (r) => qty(r.total_quantity) },
                    { key: 'user_name', header: 'Recorded by', render: (r) => r.user_name || <span className="muted">System</span> },
                    { key: 'notes', header: 'Notes', render: (r) => <span className="small muted">{r.notes || '—'}</span> },
                  ]}
                />
              )}
            </>
          )}
        </div>
      </Card>

      <Modal
        open={adjustOpen}
        onClose={() => !adjustSaving && setAdjustOpen(false)}
        title="Adjust stock"
        subtitle="Increases and decreases post to inventory and the adjustment account."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAdjustOpen(false)} disabled={adjustSaving}>Cancel</Button>
            <Button onClick={submitAdjust} loading={adjustSaving} icon={SlidersHorizontal}>Post adjustment</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitAdjust}>
          {adjustError && <div className="info-note danger">{adjustError}</div>}
          <div className="grid grid-2">
            <Field label="Location">
              <Select value={adjust.location_id} onChange={(e) => { setAdjust({ ...adjust, location_id: e.target.value, product_id: '' }); }}>
                <option value="">Choose location</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Product">
              <Select value={adjust.product_id} onChange={(e) => {
                const product = adjustProducts.find((p) => String(p.id) === e.target.value);
                setAdjust({ ...adjust, product_id: e.target.value, unit_cost: product?.avg_cost ?? '' });
              }}>
                <option value="">Choose product</option>
                {adjustProducts.filter((p) => p.track_inventory).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {qty(p.quantity)} on hand</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-3">
            <Field label="Direction">
              <Select value={adjust.direction} onChange={(e) => setAdjust({ ...adjust, direction: e.target.value })}>
                <option value="in">Increase stock</option>
                <option value="out">Decrease stock</option>
              </Select>
            </Field>
            <Field label="Quantity">
              <Input value={adjust.quantity} onChange={(e) => setAdjust({ ...adjust, quantity: e.target.value })} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Unit cost" hint={adjust.direction === 'out' ? 'Uses weighted average cost' : undefined}>
              <Input value={adjust.unit_cost} onChange={(e) => setAdjust({ ...adjust, unit_cost: e.target.value })} inputMode="decimal" placeholder="0.00" disabled={adjust.direction === 'out'} />
            </Field>
          </div>
          <Field label="Reason">
            <Textarea value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} rows={3} placeholder="Stock count correction, damage, shrinkage…" />
          </Field>
          <div className="info-note">
            <div>A balanced journal is created automatically: inventory is debited/credited against the inventory adjustment account.</div>
          </div>
        </form>
      </Modal>

      <Modal
        open={transferOpen}
        onClose={() => !transferSaving && setTransferOpen(false)}
        title="Transfer stock"
        subtitle="Move inventory between locations at weighted-average cost."
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setTransferOpen(false)} disabled={transferSaving}>Cancel</Button>
            <Button onClick={submitTransfer} loading={transferSaving} icon={ArrowLeftRight}>Complete transfer</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitTransfer}>
          {transferError && <div className="info-note danger">{transferError}</div>}
          <div className="grid grid-2">
            <Field label="From location">
              <Select value={transfer.from_location_id} onChange={(e) => setTransfer({ ...transfer, from_location_id: e.target.value, items: [] })}>
                <option value="">Choose origin</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="To location">
              <Select value={transfer.to_location_id} onChange={(e) => setTransfer({ ...transfer, to_location_id: e.target.value })}>
                <option value="">Choose destination</option>
                {locations.filter((l) => String(l.id) !== String(transfer.from_location_id)).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="section-title"><h3>Items</h3><Button type="button" size="sm" variant="secondary" icon={Plus} onClick={addTransferLine}>Add line</Button></div>
          {transfer.items.length === 0 && <div className="muted small">No lines yet — add at least one product.</div>}
          <div className="transfer-items">
            {transfer.items.map((line, index) => {
              const product = transferProducts.find((p) => String(p.id) === String(line.product_id));
              return (
                <div className="transfer-line" key={index}>
                  <Select value={line.product_id} onChange={(e) => updateTransferLine(index, { product_id: e.target.value })} disabled={!transfer.from_location_id}>
                    <option value="">Choose product</option>
                    {transferProducts.filter((p) => p.track_inventory).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {qty(p.quantity)} available</option>
                    ))}
                  </Select>
                  <Input value={line.quantity} onChange={(e) => updateTransferLine(index, { quantity: e.target.value })} inputMode="decimal" placeholder="Qty" aria-label="Quantity" />
                  <span className="small muted nowrap">{product ? money(product.avg_cost) : '—'}</span>
                  <IconButton icon={Trash2} label="Remove line" onClick={() => removeTransferLine(index)} />
                </div>
              );
            })}
          </div>
          {transfer.items.length > 0 && (
            <div className="sum-row"><span>Estimated transfer value</span><b>{money(transferValue)}</b></div>
          )}
          <Field label="Notes">
            <Textarea value={transfer.notes} onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })} rows={2} placeholder="Optional reference or reason" />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
