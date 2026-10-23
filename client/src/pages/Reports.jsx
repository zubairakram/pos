import { useMemo, useState } from 'react';
import {
  Banknote, BarChart3, Boxes, CreditCard, Download, Landmark, PieChart as PieIcon,
  Receipt, TrendingUp, Truck, Users, Wallet,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { downloadCSV, daysAgoInput, todayInput, useFormat } from '../format.js';
import { useApi } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, Input, LoadingBlock, PageHeader, Select,
  Stat, Tabs,
} from '../components/ui.jsx';

const COLORS = ['#0e9384', '#2e90fa', '#7a5af8', '#f79009', '#f04438', '#12b76a', '#0ba5ec', '#667085'];

function ChartTooltip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="label">{label}</div>
      {payload.map((p) => <div key={p.dataKey}><b>{money(p.value)}</b> {p.name}</div>)}
    </div>
  );
}

const pct = (part, whole) => (Number(whole) > 0 ? `${((Number(part) / Number(whole)) * 100).toFixed(1)}%` : '—');

export default function Reports() {
  const { money, number, percent, date } = useFormat();
  const toast = useToast();
  const [tab, setTab] = useState('sales');
  const [from, setFrom] = useState(daysAgoInput(30));
  const [to, setTo] = useState(todayInput());
  const [group, setGroup] = useState('day');
  const [valuationLocation, setValuationLocation] = useState('');

  const salesApi = useApi('/reports/sales-summary', { from, to, group }, { enabled: tab === 'sales' });
  const productsApi = useApi('/reports/sales-by-product', { from, to, limit: 100 }, { enabled: tab === 'profitability' });
  const categoriesApi = useApi('/reports/sales-by-category', { from, to }, { enabled: tab === 'profitability' });
  const cashiersApi = useApi('/reports/sales-by-cashier', { from, to }, { enabled: tab === 'sales' });
  const locationsApi = useApi('/reports/sales-by-location', { from, to }, { enabled: tab === 'sales' });
  const hourlyApi = useApi('/reports/hourly', { from, to }, { enabled: tab === 'sales' });
  const methodsApi = useApi('/reports/payment-methods', { from, to }, { enabled: tab === 'payments' });
  const taxApi = useApi('/reports/tax', { from, to }, { enabled: tab === 'payments' });
  const arApi = useApi('/reports/ar-aging', undefined, { enabled: tab === 'receivables' });
  const customersApi = useApi('/reports/customer-balances', undefined, { enabled: tab === 'receivables' });
  const apApi = useApi('/reports/ap-aging', undefined, { enabled: tab === 'payables' });
  const suppliersApi = useApi('/reports/supplier-balances', undefined, { enabled: tab === 'payables' });
  const valuationApi = useApi('/reports/inventory-valuation', { location_id: valuationLocation || undefined }, { enabled: tab === 'inventory' });
  const cashFlowApi = useApi('/reports/cash-flow', { from, to }, { enabled: tab === 'cash' });
  const locationsLookup = useApi('/locations', undefined, { enabled: tab === 'inventory' });

  const sales = salesApi.data;
  const products = productsApi.data?.products || [];
  const categories = categoriesApi.data?.categories || [];
  const cashiers = cashiersApi.data?.cashiers || [];
  const locations = locationsApi.data?.locations || [];
  const hours = hourlyApi.data?.hours || [];
  const methods = methodsApi.data?.methods || [];
  const tax = taxApi.data;
  const ar = arApi.data?.aging || [];
  const customers = customersApi.data?.customers || [];
  const ap = apApi.data?.aging || [];
  const suppliers = suppliersApi.data?.suppliers || [];
  const valuation = valuationApi.data;
  const flow = cashFlowApi.data;
  const locationOptions = locationsLookup.data?.locations || [];

  const chartData = useMemo(() => {
    if (!sales) return [];
    const byPeriod = new Map();
    for (const row of sales.series || []) byPeriod.set(row.period, { ...row, total: Number(row.total || 0), refunded: 0 });
    for (const row of sales.returns_series || []) {
      const existing = byPeriod.get(row.period) || { period: row.period, total: 0, transactions: 0 };
      byPeriod.set(row.period, { ...existing, refunded: Number(row.refunded || 0) });
    }
    return [...byPeriod.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }, [sales]);

  const tabs = [
    { value: 'sales', label: 'Sales', icon: TrendingUp },
    { value: 'profitability', label: 'Profitability', icon: BarChart3 },
    { value: 'payments', label: 'Payments & tax', icon: CreditCard },
    { value: 'receivables', label: 'Receivables', icon: Users },
    { value: 'payables', label: 'Payables', icon: Truck },
    { value: 'inventory', label: 'Inventory', icon: Boxes },
    { value: 'cash', label: 'Cash flow', icon: Wallet },
  ];

  const taxRows = tax?.rows || [];

  const arTotals = useMemo(() => ar.reduce((acc, r) => ({
    total: acc.total + Number(r.total || 0), current: acc.current + Number(r.current || 0),
    days_1_30: acc.days_1_30 + Number(r.days_1_30 || 0), days_31_60: acc.days_31_60 + Number(r.days_31_60 || 0),
    days_61_90: acc.days_61_90 + Number(r.days_61_90 || 0), days_90_plus: acc.days_90_plus + Number(r.days_90_plus || 0),
  }), { total: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 }), [ar]);

  const apTotals = useMemo(() => ap.reduce((acc, r) => ({
    total: acc.total + Number(r.total || 0), current: acc.current + Number(r.current || 0),
    days_1_30: acc.days_1_30 + Number(r.days_1_30 || 0), days_31_60: acc.days_31_60 + Number(r.days_31_60 || 0),
    days_61_90: acc.days_61_90 + Number(r.days_61_90 || 0), days_90_plus: acc.days_90_plus + Number(r.days_90_plus || 0),
  }), { total: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 }), [ap]);

  function exportCurrent() {
    if (tab === 'sales') {
      downloadCSV(`sales-summary-${from}-to-${to}.csv`, [
        { header: 'Period', key: 'period' },
        { header: 'Transactions', key: 'transactions' },
        { header: 'Subtotal', key: 'subtotal' },
        { header: 'Discount', key: 'discount' },
        { header: 'Tax', key: 'tax' },
        { header: 'Total', key: 'total' },
        { header: 'Paid', key: 'paid' },
        { header: 'Due', key: 'due' },
      ], sales?.series || []);
    } else if (tab === 'profitability') {
      downloadCSV(`sales-by-product-${from}-to-${to}.csv`, [
        { header: 'SKU', key: 'sku' },
        { header: 'Product', key: 'name' },
        { header: 'Category', key: 'category' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Revenue', key: 'revenue' },
        { header: 'Cost', key: 'cost' },
        { header: 'Profit', key: 'profit' },
      ], products);
    } else if (tab === 'payments') {
      downloadCSV(`tax-report-${from}-to-${to}.csv`, [
        { header: 'Rate', key: 'rate' },
        { header: 'Net sales', key: 'net_sales' },
        { header: 'Output tax', key: 'output_tax' },
        { header: 'Tax reversed', key: 'tax_reversed' },
        { header: 'Net tax', key: 'net_tax' },
      ], taxRows);
    } else if (tab === 'inventory') {
      downloadCSV(`inventory-valuation-${todayInput()}.csv`, [
        { header: 'SKU', key: 'sku' },
        { header: 'Product', key: 'name' },
        { header: 'Location', key: 'location' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Average cost', key: 'avg_cost' },
        { header: 'Cost value', key: 'cost_value' },
        { header: 'Retail value', key: 'retail_value' },
      ], valuation?.rows || []);
    } else {
      toast.info('Use the tables below to review this report.');
      return;
    }
    toast.success('Report exported');
  }

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="Sales performance, profitability, tax, aging and cash — all built from the ledger."
        actions={(
          <>
            {['sales', 'profitability', 'payments', 'inventory'].includes(tab) && (
              <Button variant="secondary" icon={Download} onClick={exportCurrent}>Export CSV</Button>
            )}
          </>
        )}
      />

      <Card noPad>
        <div style={{ padding: '0 14px' }}><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
        <div className="card-body">
          {['sales', 'profitability', 'payments', 'cash'].includes(tab) && (
            <div className="toolbar" style={{ marginBottom: 14 }}>
              <div className="toolbar-left">
                <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                {tab === 'sales' && (
                  <Field label="Group by">
                    <Select value={group} onChange={(e) => setGroup(e.target.value)}>
                      <option value="day">Day</option>
                      <option value="month">Month</option>
                      <option value="hour">Hour</option>
                    </Select>
                  </Field>
                )}
              </div>
            </div>
          )}

          {tab === 'sales' && (
            salesApi.loading && !sales ? <LoadingBlock /> : !sales ? <div className="muted">Unable to load sales report.</div> : (
              <div className="stack">
                <div className="stat-grid">
                  <Stat label="Net sales" value={money(sales.totals?.net_sales)} sub={`${number(sales.totals?.transactions)} transactions`} icon={Receipt} tone="brand" />
                  <Stat label="Revenue" value={money(sales.totals?.revenue)} sub={`Discounts ${money(sales.totals?.discount)}`} icon={TrendingUp} tone="info" />
                  <Stat label="Gross profit" value={money(sales.totals?.gross_profit)} sub={`Margin ${percent(sales.totals?.gross_margin)}`} icon={BarChart3} tone="purple" />
                  <Stat label="Average ticket" value={money(sales.totals?.average_ticket)} sub={`Returns ${money(sales.totals?.returns)}`} icon={Banknote} tone="warning" />
                </div>

                <Card title="Sales trend" subtitle="Net sales and refunds by period" className="chart-card">
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0e9384" stopOpacity={0.34} />
                            <stop offset="100%" stopColor="#0e9384" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                        <YAxis tickFormatter={(v) => money(v, { compact: true })} tick={{ fontSize: 11 }} stroke="var(--muted)" width={64} />
                        <Tooltip content={<ChartTooltip money={money} />} />
                        <Area type="monotone" dataKey="total" name="Sales" stroke="#0e9384" strokeWidth={2} fill="url(#salesFill)" />
                        <Area type="monotone" dataKey="refunded" name="Refunds" stroke="#f04438" strokeWidth={1.5} fillOpacity={0} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <div className="grid grid-2">
                  <div>
                    <div className="section-title"><h3>By location</h3></div>
                    <DataTable
                      rows={locations}
                      dense
                      empty="No sales by location"
                      columns={[
                        { key: 'name', header: 'Location' },
                        { key: 'transactions', header: 'Txns', align: 'right' },
                        { key: 'total', header: 'Sales', align: 'right', render: (r) => <b>{money(r.total)}</b> },
                        { key: 'tax', header: 'Tax', align: 'right', render: (r) => money(r.tax) },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="section-title"><h3>By cashier</h3></div>
                    <DataTable
                      rows={cashiers}
                      dense
                      empty="No sales by cashier"
                      columns={[
                        { key: 'name', header: 'Cashier' },
                        { key: 'transactions', header: 'Txns', align: 'right' },
                        { key: 'total', header: 'Sales', align: 'right', render: (r) => <b>{money(r.total)}</b> },
                        { key: 'average_ticket', header: 'Avg', align: 'right', render: (r) => money(r.average_ticket) },
                      ]}
                    />
                  </div>
                </div>

                <Card title="Hourly pattern" subtitle="Sales value by hour of day">
                  <div style={{ width: '100%', height: 200 }}>
                    <ResponsiveContainer>
                      <BarChart data={Array.from({ length: 24 }, (_, h) => {
                        const row = hours.find((x) => x.hour === h);
                        return { hour: h, total: Number(row?.total || 0), transactions: Number(row?.transactions || 0) };
                      })}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fontSize: 10 }} stroke="var(--muted)" interval={2} />
                        <YAxis tickFormatter={(v) => money(v, { compact: true })} tick={{ fontSize: 11 }} stroke="var(--muted)" width={60} />
                        <Tooltip content={<ChartTooltip money={money} />} />
                        <Bar dataKey="total" name="Sales" fill="#2e90fa" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            )
          )}

          {tab === 'profitability' && (
            <div className="stack">
              {productsApi.loading && !productsApi.data ? <LoadingBlock /> : (
                <>
                  <div className="grid grid-2">
                    <Card title="Revenue by category" subtitle="Net of returns">
                      <div style={{ width: '100%', height: 250 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie data={categories.filter((c) => Number(c.revenue) > 0)} dataKey="revenue" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                              {categories.filter((c) => Number(c.revenue) > 0).map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={(v) => money(v)} />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                    <Card title="Category performance" subtitle="Revenue, cost and margin">
                      <DataTable
                        rows={categories}
                        dense
                        empty="No category sales"
                        columns={[
                          { key: 'name', header: 'Category' },
                          { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => <b>{money(r.revenue)}</b> },
                          { key: 'cost', header: 'Cost', align: 'right', render: (r) => money(r.cost) },
                          { key: 'margin', header: 'Margin', align: 'right', render: (r) => pct(Number(r.revenue) - Number(r.cost), r.revenue) },
                        ]}
                      />
                    </Card>
                  </div>

                  <div>
                    <div className="section-title"><h3>Product profitability</h3><span className="tiny muted">Top {products.length} by revenue</span></div>
                    <DataTable
                      rows={products}
                      empty="No product sales in this period"
                      columns={[
                        { key: 'name', header: 'Product', render: (r) => <div className="inventory-name"><b>{r.name}</b><span>{r.sku}{r.category ? ` · ${r.category}` : ''}</span></div> },
                        { key: 'quantity', header: 'Qty sold', align: 'right', render: (r) => number(r.quantity, 2) },
                        { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => <b>{money(r.revenue)}</b> },
                        { key: 'cost', header: 'Cost', align: 'right', render: (r) => money(r.cost) },
                        { key: 'profit', header: 'Profit', align: 'right', render: (r) => <span className={Number(r.profit) < 0 ? 'neg bold' : 'bold'}>{money(r.profit)}</span> },
                        { key: 'margin', header: 'Margin', align: 'right', render: (r) => pct(r.profit, r.revenue) },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'payments' && (
            <div className="stack">
              {taxApi.loading && !tax ? <LoadingBlock /> : tax && (
                <div className="stat-grid">
                  <Stat label="Output tax" value={money(tax.output_tax)} sub="Collected on sales" icon={Receipt} tone="brand" />
                  <Stat label="Input tax" value={money(tax.input_tax)} sub="Paid on purchases" icon={Banknote} tone="info" />
                  <Stat label="Net tax due" value={money(tax.net_due)} sub="Output less input" icon={Landmark} tone={tax.net_due > 0 ? 'warning' : 'success'} />
                </div>
              )}
              <div className="grid grid-2">
                <div>
                  <div className="section-title"><h3>Tax by rate</h3></div>
                  <DataTable
                    rows={taxRows}
                    dense
                    empty="No tax activity"
                    columns={[
                      { key: 'rate', header: 'Rate', render: (r) => `${r.rate}%` },
                      { key: 'net_sales', header: 'Net sales', align: 'right', render: (r) => money(r.net_sales) },
                      { key: 'output_tax', header: 'Output', align: 'right', render: (r) => money(r.output_tax) },
                      { key: 'tax_reversed', header: 'Reversed', align: 'right', render: (r) => money(r.tax_reversed) },
                      { key: 'net_tax', header: 'Net tax', align: 'right', render: (r) => <b>{money(r.net_tax)}</b> },
                    ]}
                  />
                </div>
                <div>
                  <div className="section-title"><h3>Payment methods</h3></div>
                  <DataTable
                    rows={methods}
                    dense
                    empty="No payments"
                    columns={[
                      { key: 'name', header: 'Method', render: (r) => <div><b>{r.name}</b><div className="tiny muted">{r.type}</div></div> },
                      { key: 'payments', header: 'Count', align: 'right' },
                      { key: 'collected', header: 'Collected', align: 'right', render: (r) => <b>{money(r.collected)}</b> },
                      { key: 'refunded', header: 'Refunded', align: 'right', render: (r) => <span className="neg">{money(r.refunded)}</span> },
                    ]}
                  />
                </div>
              </div>
            </div>
          )}

          {tab === 'receivables' && (
            <div className="stack">
              <div className="stat-grid">
                <Stat label="Total receivable" value={money(arTotals.total)} sub={`${ar.length} customer(s) with a balance`} icon={Users} tone="brand" />
                <Stat label="Current" value={money(arTotals.current)} sub="Not yet due" icon={Receipt} tone="success" />
                <Stat label="1–30 days" value={money(arTotals.days_1_30)} sub="Overdue" icon={Wallet} tone="warning" />
                <Stat label="60+ days" value={money(arTotals.days_61_90 + arTotals.days_90_plus)} sub="Escalate collections" icon={CreditCard} tone="danger" />
              </div>
              <div>
                <div className="section-title"><h3>AR aging</h3></div>
                <DataTable
                  rows={ar}
                  empty="No outstanding receivables"
                  columns={[
                    { key: 'name', header: 'Customer', render: (r) => <div><b>{r.name}</b><div className="tiny muted">{r.code}{r.phone ? ` · ${r.phone}` : ''}</div></div> },
                    { key: 'total', header: 'Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
                    { key: 'current', header: 'Current', align: 'right', render: (r) => money(r.current) },
                    { key: 'days_1_30', header: '1–30', align: 'right', render: (r) => money(r.days_1_30) },
                    { key: 'days_31_60', header: '31–60', align: 'right', render: (r) => money(r.days_31_60) },
                    { key: 'days_61_90', header: '61–90', align: 'right', render: (r) => money(r.days_61_90) },
                    { key: 'days_90_plus', header: '90+', align: 'right', render: (r) => <span className="neg">{money(r.days_90_plus)}</span> },
                  ]}
                  footer={(
                    <tr>
                      <td><b>Total</b></td>
                      <td className="align-right"><b>{money(arTotals.total)}</b></td>
                      <td className="align-right">{money(arTotals.current)}</td>
                      <td className="align-right">{money(arTotals.days_1_30)}</td>
                      <td className="align-right">{money(arTotals.days_31_60)}</td>
                      <td className="align-right">{money(arTotals.days_61_90)}</td>
                      <td className="align-right">{money(arTotals.days_90_plus)}</td>
                    </tr>
                  )}
                />
              </div>
              <div>
                <div className="section-title"><h3>Customer balances</h3></div>
                <DataTable
                  rows={customers}
                  dense
                  empty="No customer balances"
                  columns={[
                    { key: 'name', header: 'Customer', render: (r) => <div><b>{r.name}</b><div className="tiny muted">{r.code}</div></div> },
                    { key: 'phone', header: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
                    { key: 'credit_limit', header: 'Credit limit', align: 'right', render: (r) => (Number(r.credit_limit) > 0 ? money(r.credit_limit) : '—') },
                    { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b className={Number(r.balance) > 0 ? 'neg' : ''}>{money(r.balance)}</b> },
                  ]}
                />
              </div>
            </div>
          )}

          {tab === 'payables' && (
            <div className="stack">
              <div className="stat-grid">
                <Stat label="Total payable" value={money(apTotals.total)} sub={`${ap.length} supplier(s) with a balance`} icon={Truck} tone="brand" />
                <Stat label="Current" value={money(apTotals.current)} sub="Not yet due" icon={Receipt} tone="success" />
                <Stat label="1–30 days" value={money(apTotals.days_1_30)} sub="Overdue" icon={Wallet} tone="warning" />
                <Stat label="60+ days" value={money(apTotals.days_61_90 + apTotals.days_90_plus)} sub="Prioritise payment" icon={CreditCard} tone="danger" />
              </div>
              <div>
                <div className="section-title"><h3>AP aging</h3></div>
                <DataTable
                  rows={ap}
                  empty="No outstanding payables"
                  columns={[
                    { key: 'name', header: 'Supplier', render: (r) => <div><b>{r.name}</b><div className="tiny muted">{r.code}{r.phone ? ` · ${r.phone}` : ''}</div></div> },
                    { key: 'total', header: 'Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
                    { key: 'current', header: 'Current', align: 'right', render: (r) => money(r.current) },
                    { key: 'days_1_30', header: '1–30', align: 'right', render: (r) => money(r.days_1_30) },
                    { key: 'days_31_60', header: '31–60', align: 'right', render: (r) => money(r.days_31_60) },
                    { key: 'days_61_90', header: '61–90', align: 'right', render: (r) => money(r.days_61_90) },
                    { key: 'days_90_plus', header: '90+', align: 'right', render: (r) => <span className="neg">{money(r.days_90_plus)}</span> },
                  ]}
                  footer={(
                    <tr>
                      <td><b>Total</b></td>
                      <td className="align-right"><b>{money(apTotals.total)}</b></td>
                      <td className="align-right">{money(apTotals.current)}</td>
                      <td className="align-right">{money(apTotals.days_1_30)}</td>
                      <td className="align-right">{money(apTotals.days_31_60)}</td>
                      <td className="align-right">{money(apTotals.days_61_90)}</td>
                      <td className="align-right">{money(apTotals.days_90_plus)}</td>
                    </tr>
                  )}
                />
              </div>
              <div>
                <div className="section-title"><h3>Supplier balances</h3></div>
                <DataTable
                  rows={suppliers}
                  dense
                  empty="No supplier balances"
                  columns={[
                    { key: 'name', header: 'Supplier', render: (r) => <div><b>{r.name}</b><div className="tiny muted">{r.code}</div></div> },
                    { key: 'phone', header: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
                    { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b className={Number(r.balance) > 0 ? 'neg' : ''}>{money(r.balance)}</b> },
                  ]}
                />
              </div>
            </div>
          )}

          {tab === 'inventory' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <Field label="Location">
                    <Select value={valuationLocation} onChange={(e) => setValuationLocation(e.target.value)}>
                      <option value="">All locations</option>
                      {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </Field>
                </div>
              </div>
              {valuationApi.loading && !valuation ? <LoadingBlock /> : !valuation ? <div className="muted">Unable to load valuation.</div> : (
                <>
                  <div className="stat-grid">
                    <Stat label="Inventory at cost" value={money(valuation.totals?.cost_value)} sub={`${number(valuation.totals?.quantity, 2)} units`} icon={Boxes} tone="brand" />
                    <Stat label="Retail value" value={money(valuation.totals?.retail_value)} sub="At current selling prices" icon={TrendingUp} tone="info" />
                    <Stat label="Potential margin" value={money(Number(valuation.totals?.retail_value) - Number(valuation.totals?.cost_value))} sub={pct(Number(valuation.totals?.retail_value) - Number(valuation.totals?.cost_value), valuation.totals?.retail_value)} icon={BarChart3} tone="purple" />
                    <Stat label="Low stock lines" value={number(valuation.totals?.low_stock)} sub="At or below reorder level" icon={PieIcon} tone={valuation.totals?.low_stock ? 'warning' : 'default'} />
                  </div>
                  <DataTable
                    rows={valuation.rows}
                    empty="No inventory"
                    columns={[
                      { key: 'name', header: 'Product', render: (r) => <div className="inventory-name"><b>{r.name}</b><span>{r.sku}{r.category ? ` · ${r.category}` : ''}</span></div> },
                      { key: 'location', header: 'Location' },
                      { key: 'quantity', header: 'Qty', align: 'right', render: (r) => <span className={r.low_stock ? 'neg' : ''}>{number(r.quantity, 2)}</span> },
                      { key: 'avg_cost', header: 'Avg cost', align: 'right', render: (r) => money(r.avg_cost) },
                      { key: 'cost_value', header: 'Cost value', align: 'right', render: (r) => <b>{money(r.cost_value)}</b> },
                      { key: 'retail_value', header: 'Retail value', align: 'right', render: (r) => money(r.retail_value) },
                      { key: 'reorder_level', header: 'Reorder at', align: 'right', render: (r) => number(r.reorder_level, 2) },
                    ]}
                  />
                </>
              )}
            </div>
          )}

          {tab === 'cash' && (
            cashFlowApi.loading && !flow ? <LoadingBlock /> : !flow ? <div className="muted">Unable to load cash flow.</div> : (
              <div className="stack">
                <div className="stat-grid">
                  <Stat label="Opening cash" value={money(flow.opening_cash)} sub={`As of ${date(flow.from)}`} icon={Wallet} tone="brand" />
                  <Stat label="Net change" value={money(flow.net_change)} sub="Across all activities" icon={TrendingUp} tone={flow.net_change >= 0 ? 'success' : 'danger'} />
                  <Stat label="Closing cash" value={money(flow.closing_cash)} sub={`As of ${date(flow.to)}`} icon={Landmark} tone="info" />
                </div>
                {[
                  ['Operating activities', 'operating', flow.operating, flow.operating_total],
                  ['Investing activities', 'investing', flow.investing, flow.investing_total],
                  ['Financing activities', 'financing', flow.financing, flow.financing_total],
                ].map(([label, key, rows, total]) => (
                  <div key={key}>
                    <div className="section-title"><h3>{label}</h3><span className="tiny muted">{money(total)}</span></div>
                    <DataTable
                      rows={rows}
                      dense
                      empty={`No ${key} cash activity`}
                      columns={[
                        { key: 'date', header: 'Date', render: (r) => date(r.date) },
                        { key: 'entry_no', header: 'Entry', render: (r) => <span className="mono">{r.entry_no}</span> },
                        { key: 'memo', header: 'Memo' },
                        { key: 'source_type', header: 'Source', render: (r) => <Badge tone="neutral">{r.source_type?.replaceAll('_', ' ')}</Badge> },
                        { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className={Number(r.amount) < 0 ? 'neg bold' : 'bold'}>{money(r.amount)}</span> },
                      ]}
                      footer={<tr><td colSpan={4}><b>Net {key}</b></td><td className="align-right"><b>{money(total)}</b></td></tr>}
                    />
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </Card>
    </div>
  );
}
