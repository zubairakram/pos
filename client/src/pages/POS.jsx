import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Banknote, CreditCard, Minus, Plus, Printer, ReceiptText,
  ScanBarcode, Search, ShoppingCart, Trash2, UserRound, Wallet, X,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useFormat } from '../format.js';
import { useApi, useDebounced } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Field, IconButton, Input, LoadingBlock, Modal, Select,
} from '../components/ui.jsx';
import { ReceiptView, printReceipt } from '../components/Receipt.jsx';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function computeTotals(cart, discount) {
  let subtotal = 0;
  let tax = 0;
  for (const line of cart) {
    const price = Number(line.product.sale_price || 0);
    const qty = Number(line.quantity || 0);
    const rate = Number(line.product.tax_rate || 0);
    const gross = price * qty;
    let lineTax = 0;
    if (rate > 0) {
      lineTax = line.product.is_inclusive ? gross - gross / (1 + rate / 100) : gross * (rate / 100);
    }
    subtotal += gross - lineTax;
    tax += lineTax;
  }
  subtotal = r2(subtotal);
  tax = r2(tax);
  const beforeDiscount = r2(subtotal + tax);
  const total = r2(Math.max(0, beforeDiscount - Number(discount || 0)));
  return { subtotal, tax, beforeDiscount, total };
}

export default function POS() {
  const { user } = useAuth();
  const { money, qty: fmtQty } = useFormat();
  const toast = useToast();
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const [locationId, setLocationId] = useState(Number(user.location_id) || 0);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState('');
  const [mobileCart, setMobileCart] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payments, setPayments] = useState([]);
  const [payError, setPayError] = useState('');
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [openRegisterId, setOpenRegisterId] = useState('');
  const [openingFloat, setOpeningFloat] = useState('300');
  const [openingNote, setOpeningNote] = useState('');
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const debouncedSearch = useDebounced(search, 200);

  const productsApi = useApi('/products', { location_id: locationId }, { enabled: !!locationId });
  const categoriesApi = useApi('/categories');
  const customersApi = useApi('/customers');
  const methodsApi = useApi('/payment-methods');
  const locationsApi = useApi('/locations');
  const registersApi = useApi('/cash/registers');
  const sessionsApi = useApi('/cash/sessions', { status: 'open' });
  const currentApi = useApi('/cash/sessions/current');

  const products = productsApi.data?.products || [];
  const categories = categoriesApi.data?.categories || [];
  const customers = customersApi.data?.customers || [];
  const methods = (methodsApi.data?.payment_methods || []).filter((m) => m.is_active !== false);
  const locations = (locationsApi.data?.locations || []).filter((l) => l.is_active !== false);
  const registers = registersApi.data?.registers || [];

  const locationRegisters = registers.filter((r) => r.location_id === locationId);
  const openSessions = (sessionsApi.data?.sessions || []).filter((s) => s.status === 'open');
  const availableSessions = useMemo(() => {
    if (user.role === 'cashier') return currentApi.data?.session ? [currentApi.data.session] : [];
    return openSessions.filter((s) => locationRegisters.some((r) => r.id === s.register_id));
  }, [user.role, currentApi.data, openSessions, locationRegisters]);

  const activeSession = availableSessions.find((s) => String(s.id) === String(selectedSessionId)) || availableSessions[0] || null;
  const sessionLocations = locationRegisters;
  const openableRegisters = sessionLocations.filter((r) => !r.open_session_id);

  useEffect(() => {
    if (!locationId && user.location_id) setLocationId(Number(user.location_id));
  }, [locationId, user.location_id]);

  useEffect(() => {
    if (activeSession?.id && String(selectedSessionId) !== String(activeSession.id)) {
      setSelectedSessionId(String(activeSession.id));
    }
  }, [activeSession, selectedSessionId]);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const filteredProducts = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId && String(p.category_id) !== String(categoryId)) return false;
      if (!term) return true;
      return [p.name, p.sku, p.barcode].some((v) => String(v || '').toLowerCase().includes(term));
    });
  }, [products, categoryId, debouncedSearch]);

  const totals = useMemo(() => computeTotals(cart, discount), [cart, discount]);
  const itemCount = cart.reduce((s, l) => s + Number(l.quantity), 0);
  const customer = customers.find((c) => String(c.id) === String(customerId));

  function addProduct(product, quantity = 1) {
    if (product.track_inventory && Number(product.quantity) <= 0) {
      toast.warning(`${product.name} is out of stock at this location.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: r2(l.quantity + quantity) } : l));
      }
      return [...prev, { product, quantity }];
    });
    setMobileCart(true);
  }

  function changeQuantity(id, delta) {
    setCart((prev) => prev.map((l) => {
      if (l.product.id !== id) return l;
      const next = r2(l.quantity + delta);
      return next <= 0 ? null : { ...l, quantity: next };
    }).filter(Boolean));
  }

  function setQuantity(id, value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, quantity: n } : l)));
  }

  function removeLine(id) {
    setCart((prev) => prev.filter((l) => l.product.id !== id));
  }

  async function submitSearch(e) {
    if (e.key !== 'Enter') return;
    const term = search.trim();
    if (!term) return;
    const exact = products.find((p) => p.barcode === term || p.sku.toLowerCase() === term.toLowerCase());
    if (exact) {
      addProduct(exact);
      setSearch('');
      return;
    }
    try {
      const data = await api.get(`/products/barcode/${encodeURIComponent(term)}`, { location_id: locationId });
      addProduct(data.product);
      setSearch('');
    } catch (err) {
      toast.error(err.message);
    }
  }

  function openPayment() {
    if (!cart.length) return;
    const cash = methods.find((m) => m.type === 'cash') || methods[0];
    setPayments([{ method_id: cash?.id || '', amount: totals.total.toFixed(2), reference: '' }]);
    setPayError('');
    setPayOpen(true);
  }

  function updatePayment(index, patch) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  const paidTotal = r2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const balance = r2(totals.total - paidTotal);
  const change = balance < 0 ? r2(-balance) : 0;

  async function completeSale() {
    setPayError('');
    if (!cart.length) return;
    if (balance > 0.005 && !customerId) {
      setPayError('A credit sale needs a customer. Choose a customer or collect the full amount.');
      return;
    }
    const usedMethods = payments.map((p) => methods.find((m) => String(m.id) === String(p.method_id))).filter(Boolean);
    const hasCash = usedMethods.some((m) => m.type === 'cash');
    if (hasCash && !activeSession) {
      setPayError('Cash payments need an open drawer session. Open a drawer first.');
      return;
    }
    const missingRef = payments.find((p) => {
      const method = methods.find((m) => String(m.id) === String(p.method_id));
      return method?.requires_reference && !p.reference;
    });
    if (missingRef) {
      setPayError('One of the selected payment methods requires a reference.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        location_id: locationId,
        customer_id: customerId ? Number(customerId) : undefined,
        session_id: activeSession?.id || undefined,
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          unit_price: Number(l.product.sale_price),
        })),
        discount: Number(discount || 0),
        payments: payments
          .filter((p) => Number(p.amount) > 0)
          .map((p) => ({
            method_id: Number(p.method_id),
            amount: Number(p.amount),
            reference: p.reference || undefined,
          })),
      };
      const data = await api.post('/sales', payload);
      setReceipt(data.sale);
      setPayOpen(false);
      setCart([]);
      setDiscount('');
      setCustomerId('');
      setMobileCart(false);
      productsApi.reload();
      sessionsApi.reload();
      currentApi.reload();
      toast.success(`Sale ${data.sale.invoice_no} completed`);
    } catch (err) {
      setPayError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function openDrawerSubmit() {
    const registerId = Number(openRegisterId || openableRegisters[0]?.id);
    if (!registerId) {
      toast.error('No register available to open.');
      return;
    }
    setDrawerSaving(true);
    try {
      const data = await api.post('/cash/sessions/open', {
        register_id: registerId,
        opening_float: Number(openingFloat || 0),
        note: openingNote || undefined,
      });
      toast.success('Cash drawer opened');
      setOpenDrawer(false);
      setOpeningNote('');
      setSelectedSessionId(String(data.session.id));
      await Promise.all([registersApi.reload(), sessionsApi.reload(), currentApi.reload()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDrawerSaving(false);
    }
  }

  const defaultOpenRegister = openableRegisters[0]?.id || '';

  if (productsApi.loading && !productsApi.data) {
    return <div className="page"><LoadingBlock height={400} /></div>;
  }

  return (
    <div className="page pos-page">
      <div className="pos-toolbar">
        <div className="search-input pos-search">
          <ScanBarcode size={18} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={submitSearch}
            placeholder="Scan barcode or search products…"
            aria-label="Search products"
          />
          {search && <IconButton icon={X} label="Clear search" onClick={() => setSearch('')} />}
        </div>

        {locations.length > 1 && user.role !== 'cashier' && (
          <Select
            value={locationId}
            onChange={(e) => { setLocationId(Number(e.target.value)); setSelectedSessionId(''); }}
            style={{ width: 170 }}
            aria-label="Selling location"
          >
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}

        {user.role !== 'cashier' && availableSessions.length > 1 && (
          <Select
            value={activeSession?.id || ''}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            style={{ width: 190 }}
            aria-label="Cash drawer"
          >
            {availableSessions.map((s) => (
              <option key={s.id} value={s.id}>{s.register_name} · {s.cashier_name}</option>
            ))}
          </Select>
        )}

        <div className={`pos-session-badge ${activeSession ? '' : 'closed'}`}>
          <i className="dot" />
          <span>{activeSession ? `${activeSession.register_name} · ${money(activeSession.expected_cash ?? activeSession.computed_expected ?? 0)}` : 'No drawer open'}</span>
          {!activeSession && ['admin', 'manager', 'cashier'].includes(user.role) && (
            <button
              className="btn btn-sm btn-secondary"
              style={{ height: 26, marginLeft: 4 }}
              onClick={() => { setOpenRegisterId(defaultOpenRegister); setOpenDrawer(true); }}
            >
              Open
            </button>
          )}
        </div>

        <Button variant="secondary" icon={Wallet} onClick={() => navigate('/cash')} size="sm">
          Drawers
        </Button>
      </div>

      <div className="pos-layout">
        <div className="pos-products">
          <div className="pos-cats">
            <button className={`pos-cat ${!categoryId ? 'active' : ''}`} onClick={() => setCategoryId('')}>All products</button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={`pos-cat ${String(categoryId) === String(c.id) ? 'active' : ''}`}
                onClick={() => setCategoryId(String(c.id))}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="pos-grid">
            {filteredProducts.map((p) => {
              const out = p.track_inventory && Number(p.quantity) <= 0;
              const low = p.track_inventory && !out && Number(p.quantity) <= Number(p.reorder_level);
              return (
                <button
                  type="button"
                  className="pos-product"
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={out}
                  title={out ? 'Out of stock' : `Add ${p.name}`}
                >
                  <span className={`stock ${low ? 'low' : ''}`}>
                    {p.track_inventory ? `${fmtQty(p.quantity)} ${p.unit_short || ''}` : 'Service'}
                  </span>
                  <div className="name">{p.name}</div>
                  <div className="meta">{p.sku}{p.category_name ? ` · ${p.category_name}` : ''}</div>
                  <div className="price">{money(p.sale_price)}</div>
                </button>
              );
            })}
            {filteredProducts.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <span className="empty-icon"><Search size={22} /></span>
                <h3>No products match</h3>
                <p>Try a different search or category.</p>
              </div>
            )}
          </div>
        </div>

        <aside className={`pos-cart ${mobileCart ? 'mobile-open' : ''}`}>
          <div className="cart-head">
            <h2><ShoppingCart size={16} style={{ verticalAlign: -2 }} /> Current sale</h2>
            <div className="flex gap-sm">
              <Badge tone="brand">{itemCount} item{itemCount === 1 ? '' : 's'}</Badge>
              <IconButton icon={X} label="Close cart" className="pos-mobile-cart-close" onClick={() => setMobileCart(false)} />
            </div>
          </div>

          <div className="cart-customer">
            <Field label="Customer">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{Number(c.balance) > 0 ? ` · ${money(c.balance)} due` : ''}</option>
                ))}
              </Select>
            </Field>
            {customer && Number(customer.credit_limit) > 0 && (
              <div className="tiny muted mt-sm">Credit limit {money(customer.credit_limit)} · current balance {money(customer.balance)}</div>
            )}
          </div>

          <div className="cart-items">
            {cart.length === 0 ? (
              <div className="cart-empty">
                <ShoppingCart size={34} />
                <div><b>Cart is empty</b></div>
                <div className="small">Scan a barcode or tap a product to begin.</div>
              </div>
            ) : cart.map((line) => (
              <div className="cart-line" key={line.product.id}>
                <span className="thumb">{(line.product.name || '?').slice(0, 2).toUpperCase()}</span>
                <div className="info">
                  <div className="name">{line.product.name}</div>
                  <div className="unit">{money(line.product.sale_price)} each{line.product.tax_rate ? ` · ${line.product.tax_rate}% tax` : ''}</div>
                  <div className="qty-control">
                    <button onClick={() => changeQuantity(line.product.id, -1)} aria-label="Decrease"><Minus size={13} /></button>
                    <span>
                      <input
                        value={line.quantity}
                        onChange={(e) => setQuantity(line.product.id, e.target.value)}
                        inputMode="decimal"
                        style={{ width: 34, border: 0, textAlign: 'center', background: 'transparent', fontSize: 11.5, fontWeight: 600 }}
                      />
                    </span>
                    <button onClick={() => changeQuantity(line.product.id, 1)} aria-label="Increase"><Plus size={13} /></button>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="line-total">{money(Number(line.product.sale_price) * line.quantity)}</div>
                  <IconButton icon={Trash2} label="Remove item" onClick={() => removeLine(line.product.id)} style={{ width: 26, height: 26, marginTop: 4 }} />
                </div>
              </div>
            ))}
          </div>

          <div className="cart-summary">
            <div className="sum-row"><span>Subtotal</span><span className="value">{money(totals.subtotal)}</span></div>
            <div className="sum-row"><span>Tax</span><span className="value">{money(totals.tax)}</span></div>
            <div className="discount-row">
              <span className="small muted grow">Order discount</span>
              <Input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Order discount"
              />
            </div>
            <div className="sum-row total"><span>Total</span><span className="value">{money(totals.total)}</span></div>
          </div>

          <div className="cart-actions">
            <Button size="lg" icon={CreditCard} onClick={openPayment} disabled={!cart.length}>
              Charge {money(totals.total)}
            </Button>
            <div className="flex gap-sm">
              <Button variant="ghost" size="sm" className="grow" onClick={() => { setCart([]); setDiscount(''); setCustomerId(''); }} disabled={!cart.length}>
                Clear sale
              </Button>
              <Button variant="ghost" size="sm" onClick={() => searchRef.current?.focus()}>Add more</Button>
            </div>
          </div>
        </aside>
      </div>

      <Button
        className="pos-mobile-cart"
        icon={ShoppingCart}
        onClick={() => setMobileCart((v) => !v)}
      >
        {mobileCart ? 'Hide cart' : `Cart · ${itemCount} · ${money(totals.total)}`}
      </Button>

      <Modal
        open={payOpen}
        onClose={() => !saving && setPayOpen(false)}
        title="Take payment"
        subtitle={`${itemCount} item(s) · total ${money(totals.total)}`}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={saving}>Cancel</Button>
            <Button icon={Banknote} onClick={completeSale} loading={saving}>Complete sale</Button>
          </>
        )}
      >
        <div className="stack">
          {payError && <div className="info-note danger"><AlertTriangle size={16} /><div>{payError}</div></div>}

          <div className="pay-summary">
            <span>Amount due</span>
            <b style={{ fontSize: 20 }}>{money(totals.total)}</b>
          </div>

          <div className="payment-lines">
            {payments.map((p, index) => {
              const method = methods.find((m) => String(m.id) === String(p.method_id));
              return (
                <div key={index} className="stack-sm">
                  <div className="payment-line">
                    <Select
                      value={p.method_id}
                      onChange={(e) => updatePayment(index, { method_id: e.target.value })}
                      aria-label="Payment method"
                    >
                      {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                    <Input
                      value={p.amount}
                      onChange={(e) => updatePayment(index, { amount: e.target.value })}
                      inputMode="decimal"
                      aria-label="Payment amount"
                    />
                    {payments.length > 1 ? (
                      <IconButton icon={Trash2} label="Remove payment" onClick={() => setPayments((prev) => prev.filter((_, i) => i !== index))} />
                    ) : <span />}
                  </div>
                  {method?.requires_reference && (
                    <Input
                      value={p.reference || ''}
                      onChange={(e) => updatePayment(index, { reference: e.target.value })}
                      placeholder={`${method.name} reference`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-sm wrap">
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => {
                const due = Math.max(0, balance);
                setPayments((prev) => [...prev, { method_id: methods[0]?.id || '', amount: due.toFixed(2), reference: '' }]);
              }}
            >
              Split payment
            </Button>
            {payments.length && methods.find((m) => String(m.id) === String(payments[0].method_id))?.type === 'cash' && (
              <div className="quick-cash">
                {[totals.total, Math.ceil(totals.total / 5) * 5, Math.ceil(totals.total / 10) * 10, Math.ceil(totals.total / 20) * 20, Math.ceil(totals.total / 50) * 50]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .slice(0, 5)
                  .map((v) => (
                    <button key={v} onClick={() => updatePayment(0, { amount: v.toFixed(2) })}>{money(v)}</button>
                  ))}
              </div>
            )}
          </div>

          <div className="sum-row"><span>Paid</span><span>{money(paidTotal)}</span></div>
          <div className={`sum-row ${balance > 0.005 ? 'neg' : ''}`}><span>Balance</span><span>{money(Math.max(0, balance))}</span></div>
          {change > 0 && <div className="sum-row"><span>Change</span><span>{money(change)}</span></div>}

          {balance > 0.005 && (
            <div className="info-note warning">
              <AlertTriangle size={16} />
              <div>
                {customerId
                  ? 'The remaining balance will be posted to accounts receivable.'
                  : 'The remaining balance requires a customer for a credit sale.'}
              </div>
            </div>
          )}

          {!activeSession && payments.some((p) => methods.find((m) => String(m.id) === String(p.method_id))?.type === 'cash') && (
            <div className="info-note warning">
              <Wallet size={16} />
              <div className="grow">Cash payments need an open drawer. <button type="button" className="btn-link" style={{ border: 0, background: 'none', padding: 0, color: 'inherit', textDecoration: 'underline' }} onClick={() => { setPayOpen(false); setOpenRegisterId(defaultOpenRegister); setOpenDrawer(true); }}>Open a drawer</button></div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="Sale complete"
        subtitle={receipt ? `${receipt.invoice_no} · ${money(receipt.total)}` : ''}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" icon={Printer} onClick={printReceipt}>Print receipt</Button>
            <Button onClick={() => setReceipt(null)}>New sale</Button>
          </>
        )}
      >
        <ReceiptView sale={receipt} />
      </Modal>

      <Modal
        open={openDrawer}
        onClose={() => !drawerSaving && setOpenDrawer(false)}
        title="Open cash drawer"
        subtitle="Count the opening float before taking cash."
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpenDrawer(false)} disabled={drawerSaving}>Cancel</Button>
            <Button icon={Wallet} onClick={openDrawerSubmit} loading={drawerSaving}>Open drawer</Button>
          </>
        )}
      >
        {openableRegisters.length === 0 ? (
          <div className="info-note warning">
            <AlertTriangle size={16} />
            <div>All registers at this location are already open. Manage them from the Cash & Drawers page.</div>
          </div>
        ) : (
          <div className="stack">
            <Field label="Register">
              <Select value={openRegisterId || defaultOpenRegister} onChange={(e) => setOpenRegisterId(e.target.value)}>
                {openableRegisters.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.location_name}</option>)}
              </Select>
            </Field>
            <Field label="Opening float" hint="Cash already in the drawer at the start of the shift.">
              <Input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Note (optional)">
              <Input value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} placeholder="Morning shift" />
            </Field>
            <div className="info-note">
              <Wallet size={16} />
              <div>Opening a drawer starts a session tied to you and this register. Count and close it from Cash & Drawers.</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
