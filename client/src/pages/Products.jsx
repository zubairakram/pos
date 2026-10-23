import { useEffect, useState } from 'react';
import {
  Download, Edit3, Layers, MapPin, Package, Plus, Tag, Percent, CreditCard,
  Ruler, Search, ToggleLeft,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { downloadCSV, useFormat } from '../format.js';
import { useApi, useDebounced, useLookups } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, Input, LoadingBlock, Modal,
  PageHeader, SearchInput, Select, Tabs, Textarea,
} from '../components/ui.jsx';

const TYPES = ['cash', 'bank', 'card', 'wallet'];

export default function Products() {
  const { user } = useAuth();
  const { money, number } = useFormat();
  const toast = useToast();
  const lookups = useLookups();
  const [tab, setTab] = useState('products');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState(Number(user.location_id) || lookups.locations[0]?.id || '');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [lowStock, setLowStock] = useState(false);
  const [productModal, setProductModal] = useState(null);
  const [refModal, setRefModal] = useState(null);
  const debounced = useDebounced(search);

  const productsApi = useApi('/products', {
    search: debounced || undefined,
    category_id: categoryId || undefined,
    location_id: locationId || undefined,
    include_inactive: includeInactive || undefined,
    low_stock: lowStock || undefined,
  }, { enabled: tab === 'products' });
  const categoriesApi = useApi('/categories', undefined, { enabled: tab === 'categories' || tab === 'products' });
  const unitsApi = useApi('/units', undefined, { enabled: tab === 'units' });
  const taxesApi = useApi('/tax-rates', undefined, { enabled: tab === 'taxes' });
  const methodsApi = useApi('/payment-methods', undefined, { enabled: tab === 'methods' });
  const locationsApi = useApi('/locations', undefined, { enabled: tab === 'locations' || tab === 'products' });
  const accountsApi = useApi('/accounting/accounts', undefined, {
    enabled: tab === 'methods' && ['admin', 'manager', 'accountant'].includes(user.role),
  });

  const canProduct = ['admin', 'manager', 'storekeeper'].includes(user.role);
  const canRef = ['admin', 'manager'].includes(user.role);

  useEffect(() => {
    if (!locationId && lookups.locations[0]) setLocationId(lookups.locations[0].id);
  }, [locationId, lookups.locations]);

  const products = productsApi.data?.products || [];
  const categories = categoriesApi.data?.categories || [];
  const units = unitsApi.data?.units || [];
  const taxes = taxesApi.data?.tax_rates || [];
  const methods = methodsApi.data?.payment_methods || [];
  const locations = locationsApi.data?.locations || [];
  const accounts = accountsApi.data?.accounts || [];

  const tabs = [
    { value: 'products', label: 'Products', icon: Package, count: products.length },
    { value: 'categories', label: 'Categories', icon: Tag, count: categories.length },
    { value: 'units', label: 'Units', icon: Ruler },
    { value: 'taxes', label: 'Tax rates', icon: Percent },
    { value: 'methods', label: 'Payment methods', icon: CreditCard },
    { value: 'locations', label: 'Locations', icon: MapPin },
  ];

  function exportProducts() {
    downloadCSV('products.csv', [
      { header: 'SKU', key: 'sku' },
      { header: 'Barcode', key: 'barcode' },
      { header: 'Name', key: 'name' },
      { header: 'Category', key: 'category_name' },
      { header: 'Unit', key: 'unit_short' },
      { header: 'Cost', key: 'cost_price' },
      { header: 'Price', key: 'sale_price' },
      { header: 'Tax rate', key: 'tax_rate' },
      { header: 'On hand', key: 'quantity' },
      { header: 'Reorder at', key: 'reorder_level' },
      { header: 'Active', value: (r) => (r.is_active ? 'yes' : 'no') },
    ], products);
    toast.success('Products exported');
  }

  function refreshRefs() {
    lookups.reload();
    categoriesApi.reload();
    unitsApi.reload();
    taxesApi.reload();
    methodsApi.reload();
    locationsApi.reload();
  }

  return (
    <div className="page">
      <PageHeader
        title="Products & catalogue"
        subtitle="Your item master, pricing, tax treatment and reference data."
        actions={(
          <>
            {tab === 'products' && <Button variant="secondary" icon={Download} onClick={exportProducts} disabled={!products.length}>Export CSV</Button>}
            {tab === 'products' && canProduct && <Button icon={Plus} onClick={() => setProductModal({})}>New product</Button>}
            {tab === 'categories' && canRef && <Button icon={Plus} onClick={() => setRefModal({ type: 'category' })}>New category</Button>}
            {tab === 'units' && canRef && <Button icon={Plus} onClick={() => setRefModal({ type: 'unit' })}>New unit</Button>}
            {tab === 'taxes' && canRef && <Button icon={Plus} onClick={() => setRefModal({ type: 'tax' })}>New tax rate</Button>}
            {tab === 'methods' && canRef && <Button icon={Plus} onClick={() => setRefModal({ type: 'method' })}>New payment method</Button>}
            {tab === 'locations' && canRef && <Button icon={Plus} onClick={() => setRefModal({ type: 'location' })}>New location</Button>}
          </>
        )}
      />

      <Card noPad>
        <div style={{ padding: '0 14px' }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
        <div className="card-body">
          {tab === 'products' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <SearchInput value={search} onChange={setSearch} placeholder="Name, SKU or barcode…" />
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ width: 170 }}>
                    <option value="">All categories</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ width: 170 }}>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                  <label className="checkbox">
                    <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                    Include inactive
                  </label>
                  <label className="checkbox">
                    <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} />
                    Low stock only
                  </label>
                </div>
              </div>

              {productsApi.loading && !productsApi.data ? <LoadingBlock /> : (
                <DataTable
                  rows={products}
                  empty="No products match these filters"
                  columns={[
                    { key: 'name', header: 'Product', render: (r) => <div className="inventory-name"><b>{r.name}</b><span>{r.sku}{r.barcode ? ` · ${r.barcode}` : ''}</span></div> },
                    { key: 'category_name', header: 'Category', render: (r) => r.category_name || <span className="muted">—</span> },
                    { key: 'sale_price', header: 'Price', align: 'right', render: (r) => <b>{money(r.sale_price)}</b> },
                    { key: 'cost_price', header: 'Cost', align: 'right', render: (r) => money(r.cost_price) },
                    { key: 'tax_rate', header: 'Tax', align: 'right', render: (r) => (Number(r.tax_rate) > 0 ? `${r.tax_rate}%` : <span className="muted">—</span>) },
                    {
                      key: 'quantity', header: 'On hand', align: 'right',
                      render: (r) => (r.track_inventory ? (
                        <Badge tone={Number(r.quantity) <= 0 ? 'danger' : Number(r.quantity) <= Number(r.reorder_level) ? 'warning' : 'success'}>
                          {number(r.quantity)} {r.unit_short || ''}
                        </Badge>
                      ) : <Badge tone="info">Service</Badge>),
                    },
                    { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
                    {
                      key: 'actions', header: '', align: 'right',
                      render: (r) => canProduct ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setProductModal(r)}>Edit</Button> : null,
                    },
                  ]}
                />
              )}
            </div>
          )}

          {tab === 'categories' && (
            <DataTable
              rows={categories}
              empty="No categories yet"
              columns={[
                { key: 'name', header: 'Category', render: (r) => <div className="coa-type"><Tag size={14} /><b>{r.name}</b></div> },
                { key: 'product_count', header: 'Products', align: 'right' },
                { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
                { key: 'actions', header: '', align: 'right', render: (r) => canRef ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setRefModal({ type: 'category', item: r })}>Edit</Button> : null },
              ]}
            />
          )}

          {tab === 'units' && (
            <DataTable
              rows={units}
              empty="No units yet"
              columns={[
                { key: 'name', header: 'Unit', render: (r) => <div className="coa-type"><Ruler size={14} /><b>{r.name}</b></div> },
                { key: 'short_name', header: 'Abbreviation', render: (r) => <span className="mono">{r.short_name}</span> },
                { key: 'actions', header: '', align: 'right', render: (r) => canRef ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setRefModal({ type: 'unit', item: r })}>Edit</Button> : null },
              ]}
            />
          )}

          {tab === 'taxes' && (
            <DataTable
              rows={taxes}
              empty="No tax rates configured"
              columns={[
                { key: 'name', header: 'Tax rate', render: (r) => <div className="coa-type"><Percent size={14} /><b>{r.name}</b></div> },
                { key: 'rate', header: 'Rate', align: 'right', render: (r) => `${r.rate}%` },
                { key: 'is_inclusive', header: 'Pricing', render: (r) => <Badge tone={r.is_inclusive ? 'info' : 'neutral'}>{r.is_inclusive ? 'Tax inclusive' : 'Tax exclusive'}</Badge> },
                { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
                { key: 'actions', header: '', align: 'right', render: (r) => canRef ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setRefModal({ type: 'tax', item: r })}>Edit</Button> : null },
              ]}
            />
          )}

          {tab === 'methods' && (
            <DataTable
              rows={methods}
              empty="No payment methods configured"
              columns={[
                { key: 'name', header: 'Method', render: (r) => <div><div className="bold">{r.name}</div><div className="tiny muted mono">{r.code}</div></div> },
                { key: 'type', header: 'Type', render: (r) => <Badge tone="neutral" >{r.type}</Badge> },
                { key: 'account_name', header: 'Ledger account', render: (r) => <span><span className="mono muted">{r.account_code}</span> · {r.account_name}</span> },
                { key: 'requires_reference', header: 'Reference', render: (r) => <span className="muted small">{r.requires_reference ? 'Required' : 'Optional'}</span> },
                { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
                { key: 'actions', header: '', align: 'right', render: (r) => canRef ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setRefModal({ type: 'method', item: r })}>Edit</Button> : null },
              ]}
            />
          )}

          {tab === 'locations' && (
            <DataTable
              rows={locations}
              empty="No locations configured"
              columns={[
                { key: 'name', header: 'Location', render: (r) => <div className="coa-type"><MapPin size={14} /><div><b>{r.name}</b><div className="tiny muted mono">{r.code}</div></div></div> },
                { key: 'type', header: 'Type', render: (r) => <Badge tone={r.type === 'warehouse' ? 'purple' : 'brand'}>{r.type}</Badge> },
                { key: 'address', header: 'Address', render: (r) => r.address || <span className="muted">—</span> },
                { key: 'phone', header: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
                { key: 'is_active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'} dot>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
                { key: 'actions', header: '', align: 'right', render: (r) => canRef ? <Button size="sm" variant="ghost" icon={Edit3} onClick={() => setRefModal({ type: 'location', item: r })}>Edit</Button> : null },
              ]}
            />
          )}
        </div>
      </Card>

      <ProductModal
        open={!!productModal}
        item={productModal && productModal.id ? productModal : null}
        categories={categories}
        units={units}
        taxes={taxes}
        locations={locations}
        locationId={locationId}
        onClose={() => setProductModal(null)}
        onSaved={() => { setProductModal(null); productsApi.reload(); lookups.reload(); }}
      />

      <RefModal
        state={refModal}
        onClose={() => setRefModal(null)}
        categories={categories}
        accounts={accounts}
        onSaved={() => { setRefModal(null); refreshRefs(); }}
      />
    </div>
  );
}

function ProductModal({ open, item, categories, units, taxes, locations, locationId, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(item ? {
      name: item.name || '', sku: item.sku || '', barcode: item.barcode || '',
      description: item.description || '', category_id: item.category_id || '', unit_id: item.unit_id || '',
      cost_price: item.cost_price ?? '', sale_price: item.sale_price ?? '',
      tax_rate_id: item.tax_rate_id || '', reorder_level: item.reorder_level ?? 0,
      track_inventory: item.track_inventory !== false, is_active: item.is_active !== false,
      opening_stock: '', opening_date: '',
    } : {
      name: '', sku: '', barcode: '', description: '', category_id: '', unit_id: '',
      cost_price: '', sale_price: '', tax_rate_id: '', reorder_level: 0,
      track_inventory: true, is_active: true, opening_stock: '', opening_date: '',
    });
  }, [open, item]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setError('');
    if (!form.name?.trim()) { setError('Product name is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku || undefined,
        barcode: form.barcode || null,
        description: form.description || null,
        category_id: form.category_id ? Number(form.category_id) : null,
        unit_id: form.unit_id ? Number(form.unit_id) : null,
        cost_price: Number(form.cost_price || 0),
        sale_price: Number(form.sale_price || 0),
        tax_rate_id: form.tax_rate_id ? Number(form.tax_rate_id) : null,
        reorder_level: Number(form.reorder_level || 0),
        track_inventory: !!form.track_inventory,
        is_active: !!form.is_active,
      };
      if (!item) {
        payload.location_id = Number(locationId) || locations[0]?.id;
        payload.opening_stock = Number(form.opening_stock || 0);
        if (form.opening_date) payload.opening_date = form.opening_date;
      }
      if (item) await api.put(`/products/${item.id}`, payload);
      else await api.post('/products', payload);
      toast.success(item ? 'Product updated' : 'Product created');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={item ? 'Edit product' : 'New product'}
      subtitle="Price, tax and stock settings for this item."
      size="lg"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>{item ? 'Save changes' : 'Create product'}</Button>
        </>
      )}
    >
      <div className="stack">
        {error && <div className="info-note danger">{error}</div>}
        <div className="grid grid-2">
          <Field label="Product name"><Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Arabica Coffee 250g" /></Field>
          <Field label="SKU" hint="Leave blank to auto-generate"><Input value={form.sku || ''} onChange={(e) => set('sku', e.target.value)} placeholder="COF-250" /></Field>
          <Field label="Barcode"><Input value={form.barcode || ''} onChange={(e) => set('barcode', e.target.value)} placeholder="1000000000017" /></Field>
          <Field label="Category">
            <Select value={form.category_id || ''} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Unit">
            <Select value={form.unit_id || ''} onChange={(e) => set('unit_id', e.target.value)}>
              <option value="">No unit</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.short_name})</option>)}
            </Select>
          </Field>
          <Field label="Tax rate">
            <Select value={form.tax_rate_id || ''} onChange={(e) => set('tax_rate_id', e.target.value)}>
              <option value="">No tax</option>
              {taxes.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Cost price"><Input value={form.cost_price ?? ''} onChange={(e) => set('cost_price', e.target.value)} inputMode="decimal" /></Field>
          <Field label="Sale price"><Input value={form.sale_price ?? ''} onChange={(e) => set('sale_price', e.target.value)} inputMode="decimal" /></Field>
          <Field label="Reorder level"><Input value={form.reorder_level ?? 0} onChange={(e) => set('reorder_level', e.target.value)} inputMode="numeric" /></Field>
          {!item && (
            <Field label="Opening stock" hint="Posted to inventory and opening equity">
              <Input value={form.opening_stock || ''} onChange={(e) => set('opening_stock', e.target.value)} inputMode="decimal" placeholder="0" />
            </Field>
          )}
        </div>
        <Field label="Description"><Textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="flex gap wrap">
          <label className="checkbox">
            <input type="checkbox" checked={!!form.track_inventory} onChange={(e) => set('track_inventory', e.target.checked)} />
            Track inventory
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            Active / sellable
          </label>
        </div>
      </div>
    </Modal>
  );
}

function RefModal({ state, onClose, categories, accounts, onSaved }) {
  const toast = useToast();
  const type = state?.type;
  const item = state?.item || null;
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!state) return;
    setError('');
    const base = {
      category: { name: item?.name || '', parent_id: item?.parent_id || '', is_active: item?.is_active !== false },
      unit: { name: item?.name || '', short_name: item?.short_name || '' },
      tax: { name: item?.name || '', rate: item?.rate ?? '', is_inclusive: !!item?.is_inclusive, is_active: item?.is_active !== false },
      method: { code: item?.code || '', name: item?.name || '', type: item?.type || 'cash', account_id: item?.account_id || '', requires_reference: !!item?.requires_reference, is_active: item?.is_active !== false },
      location: { code: item?.code || '', name: item?.name || '', type: item?.type || 'store', address: item?.address || '', phone: item?.phone || '', is_active: item?.is_active !== false },
    };
    setForm(base[type] || {});
  }, [state, type, item]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setError('');
    setSaving(true);
    try {
      let path;
      let payload;
      if (type === 'category') {
        if (!form.name?.trim()) throw new Error('Category name is required');
        path = item ? `/categories/${item.id}` : '/categories';
        payload = { name: form.name.trim(), parent_id: form.parent_id ? Number(form.parent_id) : undefined, is_active: form.is_active !== false };
      } else if (type === 'unit') {
        if (!form.name?.trim() || !form.short_name?.trim()) throw new Error('Name and abbreviation are required');
        path = '/units';
        payload = { name: form.name.trim(), short_name: form.short_name.trim() };
        if (item) throw new Error('Units cannot be edited through this screen yet');
      } else if (type === 'tax') {
        if (!form.name?.trim() || form.rate === '') throw new Error('Name and rate are required');
        path = item ? `/tax-rates/${item.id}` : '/tax-rates';
        payload = { name: form.name.trim(), rate: Number(form.rate), is_inclusive: !!form.is_inclusive, is_active: form.is_active !== false };
      } else if (type === 'method') {
        if (!form.code?.trim() || !form.name?.trim() || !form.account_id) throw new Error('Code, name and ledger account are required');
        path = item ? `/payment-methods/${item.id}` : '/payment-methods';
        payload = {
          code: form.code.trim().toUpperCase(), name: form.name.trim(), type: form.type,
          account_id: Number(form.account_id), requires_reference: !!form.requires_reference, is_active: form.is_active !== false,
        };
      } else if (type === 'location') {
        if (!form.code?.trim() || !form.name?.trim()) throw new Error('Code and name are required');
        path = item ? `/locations/${item.id}` : '/locations';
        payload = {
          code: form.code.trim().toUpperCase(), name: form.name.trim(), type: form.type,
          address: form.address || null, phone: form.phone || null, is_active: form.is_active !== false,
        };
      }
      if (item && type === 'unit') throw new Error('Units cannot be edited through this screen yet');
      if (item) await api.put(path, payload);
      else await api.post(path, payload);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const titles = { category: 'category', unit: 'unit', tax: 'tax rate', method: 'payment method', location: 'location' };
  if (!state) return null;

  return (
    <Modal
      open={!!state}
      onClose={() => !saving && onClose()}
      title={`${item ? 'Edit' : 'New'} ${titles[type]}`}
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving}>{item ? 'Save changes' : 'Create'}</Button>
        </>
      )}
    >
      <div className="stack">
        {error && <div className="info-note danger">{error}</div>}

        {type === 'category' && (
          <>
            <Field label="Name"><Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Parent category">
              <Select value={form.parent_id || ''} onChange={(e) => set('parent_id', e.target.value)}>
                <option value="">None</option>
                {categories.filter((c) => c.id !== item?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <label className="checkbox"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} />Active</label>
          </>
        )}

        {type === 'unit' && (
          <div className="grid grid-2">
            <Field label="Name"><Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Pack" /></Field>
            <Field label="Abbreviation"><Input value={form.short_name || ''} onChange={(e) => set('short_name', e.target.value)} placeholder="pack" /></Field>
          </div>
        )}

        {type === 'tax' && (
          <>
            <div className="grid grid-2">
              <Field label="Name"><Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="GST 17%" /></Field>
              <Field label="Rate %"><Input value={form.rate ?? ''} onChange={(e) => set('rate', e.target.value)} inputMode="decimal" /></Field>
            </div>
            <label className="checkbox"><input type="checkbox" checked={!!form.is_inclusive} onChange={(e) => set('is_inclusive', e.target.checked)} />Prices include this tax</label>
            <label className="checkbox"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} />Active</label>
          </>
        )}

        {type === 'method' && (
          <>
            <div className="grid grid-2">
              <Field label="Code"><Input value={form.code || ''} onChange={(e) => set('code', e.target.value)} placeholder="CASH" /></Field>
              <Field label="Display name"><Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Cash" /></Field>
              <Field label="Type">
                <Select value={form.type || 'cash'} onChange={(e) => set('type', e.target.value)}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Ledger account">
                <Select value={form.account_id || ''} onChange={(e) => set('account_id', e.target.value)}>
                  <option value="">Choose account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </Select>
              </Field>
            </div>
            <label className="checkbox"><input type="checkbox" checked={!!form.requires_reference} onChange={(e) => set('requires_reference', e.target.checked)} />Require a reference</label>
            <label className="checkbox"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} />Active</label>
          </>
        )}

        {type === 'location' && (
          <>
            <div className="grid grid-2">
              <Field label="Code"><Input value={form.code || ''} onChange={(e) => set('code', e.target.value)} placeholder="MAIN" /></Field>
              <Field label="Name"><Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Main Store" /></Field>
              <Field label="Type">
                <Select value={form.type || 'store'} onChange={(e) => set('type', e.target.value)}>
                  <option value="store">Store</option>
                  <option value="warehouse">Warehouse</option>
                </Select>
              </Field>
              <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            </div>
            <Field label="Address"><Textarea value={form.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <label className="checkbox"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} />Active</label>
          </>
        )}
      </div>
    </Modal>
  );
}
