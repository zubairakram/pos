import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, Banknote, Boxes, CheckCircle2, Clock,
  CreditCard, Landmark, Package, ReceiptText, RefreshCw, ShoppingBag, TrendingUp,
  Users, Wallet,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useApi } from '../hooks.js';
import { useFormat } from '../format.js';
import { useAuth } from '../auth.jsx';
import {
  Badge, Button, Card, DataTable, EmptyState, LoadingBlock, PageHeader, Stat, StatusBadge,
} from '../components/ui.jsx';

const COLORS = ['#0e9384', '#2e90fa', '#7a5af8', '#f79009', '#f04438', '#12b76a', '#0ba5ec'];

function ChartTooltip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey}><b>{money(p.value)}</b> {p.name}</div>
      ))}
    </div>
  );
}

const VIEW_LABELS = {
  executive: 'Executive',
  operations: 'Operations',
  finance: 'Finance',
  cashier: 'My Counter',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { money, number, date, dateTime } = useFormat();
  const navigate = useNavigate();
  const [view, setView] = useState(null);
  const { data, loading, reload } = useApi('/dashboard', view ? { view } : undefined);

  const kpis = data?.kpis;
  const charts = data?.charts;
  const activeView = data?.view || view || 'executive';

  const statCards = useMemo(() => {
    if (!kpis) return [];
    if (activeView === 'finance') {
      return [
        { label: 'Cash position', value: money(kpis.cash_position), sub: 'Cash, bank & clearing accounts', icon: Landmark, tone: 'brand' },
        { label: 'Receivables', value: money(kpis.receivables), sub: 'Outstanding customer balance', icon: ReceiptText, tone: 'info' },
        { label: 'Payables', value: money(kpis.payables), sub: 'Outstanding supplier balance', icon: CreditCard, tone: 'warning' },
        { label: 'Inventory value', value: money(kpis.inventory_value), sub: 'At weighted average cost', icon: Boxes, tone: 'purple' },
      ];
    }
    if (activeView === 'operations') {
      return [
        { label: 'Open drawers', value: number(kpis.open_drawers), sub: 'Live counter sessions', icon: Wallet, tone: 'brand' },
        { label: 'Low stock items', value: number(kpis.low_stock_count), sub: 'At or below reorder level', icon: Package, tone: 'warning' },
        { label: 'Transactions today', value: number(kpis.today_transactions), sub: `${money(kpis.today_sales)} in sales`, icon: ShoppingBag, tone: 'info' },
        { label: 'Returns today', value: number(data?.operations?.returns_today || 0), sub: `${money(data?.today?.returns || 0)} refunded`, icon: Activity, tone: 'danger' },
      ];
    }
    if (activeView === 'cashier') {
      return [
        { label: 'My sales today', value: money(data?.cashier?.today?.sales || 0), sub: `${number(data?.cashier?.today?.transactions || 0)} transactions`, icon: ShoppingBag, tone: 'brand' },
        { label: 'Drawer expected', value: money(data?.cashier?.session?.expected_cash || 0), sub: data?.cashier?.session?.register_name || 'No drawer open', icon: Wallet, tone: data?.cashier?.session ? 'brand' : 'warning' },
        { label: 'Tax collected', value: money(data?.cashier?.today?.tax || 0), sub: 'On my sales today', icon: ReceiptText, tone: 'info' },
        { label: 'Discounts given', value: money(data?.cashier?.today?.discount || 0), sub: 'On my sales today', icon: CreditCard, tone: 'purple' },
      ];
    }
    return [
      { label: 'Sales today', value: money(kpis.today_sales), sub: `${number(kpis.today_transactions)} transactions · avg ${money(kpis.today_average_ticket)}`, icon: ShoppingBag, tone: 'brand' },
      { label: 'Revenue this month', value: money(data?.month?.revenue || 0), sub: `${money(kpis.month_sales)} gross · margin ${kpis.overall_margin}%`, icon: TrendingUp, tone: 'info' },
      { label: 'Net profit this month', value: money(kpis.month_net_profit), sub: `${money(kpis.month_expenses)} expenses`, icon: Banknote, tone: 'purple' },
      { label: 'Cash position', value: money(kpis.cash_position), sub: `${number(kpis.open_drawers)} open drawer(s)`, icon: Landmark, tone: 'warning' },
    ];
  }, [activeView, kpis, data, money, number]);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" subtitle="Live overview of sales, cash and financial position" />
        <LoadingBlock height={320} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Could not load the dashboard"
          description="Check that the API and database are running, then try again."
          action={<Button icon={RefreshCw} onClick={reload}>Retry</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${VIEW_LABELS[activeView]} view`}
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`}
        subtitle="Here is what is happening across the business right now."
        actions={(
          <>
            {data.allowed_views.length > 1 && (
              <div className="view-switch">
                {data.allowed_views.map((v) => (
                  <button key={v} className={activeView === v ? 'active' : ''} onClick={() => setView(v)}>
                    {VIEW_LABELS[v] || v}
                  </button>
                ))}
              </div>
            )}
            <Button variant="secondary" icon={RefreshCw} onClick={reload} loading={loading}>Refresh</Button>
          </>
        )}
      />

      <div className="dash-hero">
        <div>
          <h2>{activeView === 'cashier' ? 'Your counter at a glance' : 'Business pulse'}</h2>
          <p>
            {activeView === 'cashier'
              ? 'Open your drawer, take a sale and reconcile before you close.'
              : `Today's sales are ${money(kpis.today_sales)} across ${number(kpis.today_transactions)} transactions.`}
          </p>
          <div className="actions" style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {['admin', 'manager', 'cashier'].includes(user.role) && (
              <Button size="sm" variant="primary" icon={ReceiptText} onClick={() => navigate('/pos')}>Open point of sale</Button>
            )}
            {activeView === 'finance' && (
              <Button size="sm" variant="secondary" icon={Landmark} onClick={() => navigate('/accounting')}>View financials</Button>
            )}
            {activeView === 'operations' && (
              <Button size="sm" variant="secondary" icon={Boxes} onClick={() => navigate('/inventory')}>Manage stock</Button>
            )}
            {activeView === 'cashier' && (
              <Button size="sm" variant="secondary" icon={Wallet} onClick={() => navigate('/cash')}>Manage drawer</Button>
            )}
          </div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="value">{money(activeView === 'cashier' ? data.cashier?.today?.sales || 0 : kpis.today_sales, { compact: true })}</div>
            <div className="label">Today</div>
          </div>
          <div className="hero-stat">
            <div className="value">{money(kpis.month_net_profit, { compact: true })}</div>
            <div className="label">Net profit · MTD</div>
          </div>
          <div className="hero-stat">
            <div className="value">{number(kpis.open_drawers)}</div>
            <div className="label">Open drawers</div>
          </div>
        </div>
      </div>

      {data.alerts?.length > 0 && (
        <div className="alerts-list">
          {data.alerts.map((alert, i) => (
            <div key={`${alert.type}-${i}`} className={`alert-item ${alert.severity}`}>
              {alert.severity === 'critical' ? <AlertTriangle size={17} /> : alert.type === 'stock' ? <Package size={17} /> : alert.type === 'cash' ? <Wallet size={17} /> : alert.type === 'ar' ? <ReceiptText size={17} /> : <CreditCard size={17} />}
              <div>
                <div className="title">{alert.title}</div>
                <div className="detail">{alert.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stat-grid">
        {statCards.map((card) => <Stat key={card.label} {...card} />)}
      </div>

      {activeView === 'cashier' ? (
        <>
          {data.cashier?.session ? (
            <div className="cashier-session-card">
              <div className="between">
                <h3>{data.cashier.session.register_name} · open</h3>
                <Badge tone="brand" dot>Live</Badge>
              </div>
              <div className="amount">{money(data.cashier.session.expected_cash)}</div>
              <div className="meta">Expected cash in drawer · opened {dateTime(data.cashier.session.opened_at)}</div>
              <div className="actions">
                <Button size="sm" variant="primary" icon={ReceiptText} onClick={() => navigate('/pos')}>New sale</Button>
                <Button size="sm" variant="secondary" icon={Wallet} onClick={() => navigate('/cash')}>Count & close</Button>
              </div>
            </div>
          ) : (
            <div className="info-note warning">
              <AlertTriangle size={17} />
              <div>You do not have an open cash drawer. Open one from the Cash & Drawers page before taking cash payments.</div>
            </div>
          )}
          <Card title="My recent sales" subtitle="Your latest transactions">
            <DataTable
              rows={data.operations?.recent_sales || []}
              columns={[
                { key: 'invoice_no', header: 'Invoice', render: (r) => <span className="mono">{r.invoice_no}</span> },
                { key: 'customer_name', header: 'Customer' },
                { key: 'created_at', header: 'Time', render: (r) => dateTime(r.created_at) },
                { key: 'total', header: 'Total', align: 'right', render: (r) => money(r.total) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]}
              empty="No sales yet today"
            />
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-2">
            <Card title="Sales trend" subtitle="Last 14 days" className="chart-card">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={charts?.sales_trend || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0e9384" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0e9384" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => money(v, { compact: true })} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={58} />
                  <Tooltip content={<ChartTooltip money={money} />} />
                  <Area type="monotone" dataKey="total" name="sales" stroke="#0e9384" strokeWidth={2} fill="url(#salesFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Payment mix" subtitle="This month by method">
              <div className="grid grid-2" style={{ gap: 8, alignItems: 'center' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={charts?.payment_mix || []} dataKey="amount" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                      {(charts?.payment_mix || []).map((entry, i) => <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => money(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="stack-sm">
                  {(charts?.payment_mix || []).length === 0 && <span className="muted small">No payments yet this month.</span>}
                  {(charts?.payment_mix || []).map((p, i) => (
                    <div className="legend-item" key={p.name}>
                      <i className="legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span>{p.name}</span>
                      <span className="muted" style={{ marginLeft: 'auto' }}>{money(p.amount, { compact: true })}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-3">
            <Card title="Top products" subtitle="This month by revenue">
              <div>
                {(charts?.top_products || []).map((p, i) => (
                  <div className="list-row" key={p.id}>
                    <span className="rank-num">{i + 1}</span>
                    <div>
                      <div className="main-text">{p.name}</div>
                      <div className="sub-text">{number(p.quantity)} sold · {p.sku}</div>
                    </div>
                    <span className="amount">{money(p.revenue)}</span>
                  </div>
                ))}
                {(!charts?.top_products || charts.top_products.length === 0) && <EmptyState title="No product sales yet" description="Ring up a sale to see your best sellers." />}
              </div>
            </Card>

            <Card title="Category mix" subtitle="Revenue this month">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={charts?.category_mix || []} layout="vertical" margin={{ left: 4, right: 10 }}>
                  <CartesianGrid stroke="#eef2f6" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => money(v, { compact: true })} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="revenue" name="revenue" fill="#2e90fa" radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Hourly sales" subtitle="Today">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={charts?.hourly_today || []}>
                  <CartesianGrid stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="hour" tickFormatter={(v) => `${v}:00`} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tickFormatter={(v) => money(v, { compact: true })} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={54} />
                  <Tooltip formatter={(v) => money(v)} labelFormatter={(v) => `${v}:00`} />
                  <Bar dataKey="total" name="sales" fill="#7a5af8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <div className="grid grid-2">
            <Card
              title="Recent sales"
              subtitle="Latest transactions across the business"
              actions={<Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate('/sales')}>All sales</Button>}
              noPad
            >
              <DataTable
                rows={data.operations?.recent_sales || []}
                empty="No sales recorded yet"
                columns={[
                  { key: 'invoice_no', header: 'Invoice', render: (r) => <span className="mono">{r.invoice_no}</span> },
                  { key: 'customer_name', header: 'Customer', render: (r) => <div><div>{r.customer_name}</div><div className="tiny muted">{r.cashier_name}</div></div> },
                  { key: 'created_at', header: 'Time', render: (r) => dateTime(r.created_at) },
                  { key: 'total', header: 'Total', align: 'right', render: (r) => money(r.total) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            </Card>

            <Card
              title="Stock alerts"
              subtitle="Products at or below reorder level"
              actions={<Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate('/inventory')}>Inventory</Button>}
              noPad
            >
              <DataTable
                rows={data.operations?.low_stock || []}
                empty="All stock levels look healthy"
                columns={[
                  { key: 'name', header: 'Product', render: (r) => <div className="inventory-name"><b>{r.name}</b><span>{r.sku} · {r.location_name}</span></div> },
                  { key: 'quantity', header: 'On hand', align: 'right', render: (r) => <Badge tone={Number(r.quantity) <= 0 ? 'danger' : 'warning'}>{number(r.quantity)}</Badge> },
                  { key: 'reorder_level', header: 'Reorder at', align: 'right', render: (r) => number(r.reorder_level) },
                ]}
              />
            </Card>
          </div>

          {activeView === 'finance' && (
            <>
              <div className="grid grid-2">
                <Card title="Cash & bank accounts" subtitle="Live ledger balances">
                  <DataTable
                    rows={data.finance?.cash_accounts || []}
                    empty="No cash balances"
                    dense
                    columns={[
                      { key: 'code', header: 'Code', render: (r) => <span className="mono">{r.code}</span> },
                      { key: 'name', header: 'Account' },
                      { key: 'subtype', header: 'Type', render: (r) => <Badge tone="neutral">{r.subtype}</Badge> },
                      { key: 'balance', header: 'Balance', align: 'right', render: (r) => money(r.balance) },
                    ]}
                  />
                </Card>
                <Card title="Ledger health" subtitle="Trial balance across all entries">
                  <div className={`balance-pill ${data.finance?.ledger_balanced ? 'ok' : 'bad'}`}>
                    <span>{data.finance?.ledger_balanced ? 'Debits equal credits' : 'Ledger out of balance'}</span>
                    <span>{money(data.finance?.trial_debits)} / {money(data.finance?.trial_credits)}</span>
                  </div>
                  <div className="kpi-inline mt">
                    <div className="item"><div className="label">Receivables</div><div className="value">{money(kpis.receivables)}</div></div>
                    <div className="item"><div className="label">Overdue AR</div><div className="value">{money(data.finance?.overdue_receivables)}</div></div>
                    <div className="item"><div className="label">Payables</div><div className="value">{money(kpis.payables)}</div></div>
                    <div className="item"><div className="label">Tax payable</div><div className="value">{money(kpis.tax_payable)}</div></div>
                  </div>
                  <div className="divider mt" />
                  <div className="flex gap">
                    <Button size="sm" variant="secondary" icon={Landmark} onClick={() => navigate('/accounting')}>Financial reports</Button>
                    <Button size="sm" variant="ghost" icon={ReceiptText} onClick={() => navigate('/reports')}>Sales reports</Button>
                  </div>
                </Card>
              </div>

              <div className="grid grid-2">
                <AgingTable title="Receivables aging" rows={data.finance?.ar_aging || []} money={money} />
                <AgingTable title="Payables aging" rows={data.finance?.ap_aging || []} money={money} />
              </div>
            </>
          )}

          {activeView === 'operations' && (
            <div className="grid grid-2">
              <Card title="Open drawers" subtitle="Counter sessions in progress">
                {(data.operations?.open_sessions || []).length === 0 ? (
                  <EmptyState title="No open drawers" description="Open a drawer to start accepting cash payments." />
                ) : (
                  (data.operations.open_sessions || []).map((s) => (
                    <div className="list-row" key={s.id}>
                      <span className="stat-icon"><Wallet size={16} /></span>
                      <div>
                        <div className="main-text">{s.register_name} · {s.cashier_name}</div>
                        <div className="sub-text">{s.location_name} · opened {dateTime(s.opened_at)}</div>
                      </div>
                      <span className="amount">{money(s.expected_cash)}</span>
                    </div>
                  ))
                )}
              </Card>
              <Card title="Staff performance" subtitle="Sales by cashier today">
                {(data.operations?.staff_today || []).length === 0 ? (
                  <EmptyState title="No staff sales yet" description="Transactions will appear here as they happen." />
                ) : (
                  (data.operations.staff_today || []).map((s, i) => (
                    <div className="list-row" key={s.id}>
                      <span className="rank-num">{i + 1}</span>
                      <div>
                        <div className="main-text">{s.name}</div>
                        <div className="sub-text">{number(s.transactions)} transactions</div>
                      </div>
                      <span className="amount">{money(s.total)}</span>
                    </div>
                  ))
                )}
              </Card>
            </div>
          )}
        </>
      )}

      <div className="center tiny muted">
        Data generated {dateTime(data.generated_at)} · all amounts in {money(0).replace(/[\d.,\s]/g, '') || 'USD'}
      </div>
    </div>
  );
}

function AgingTable({ title, rows, money }) {
  const totals = rows.reduce((acc, r) => ({
    total: acc.total + Number(r.total || 0),
    current: acc.current + Number(r.current || 0),
    days_1_30: acc.days_1_30 + Number(r.days_1_30 || 0),
    days_31_60: acc.days_31_60 + Number(r.days_31_60 || 0),
    days_61_90: acc.days_61_90 + Number(r.days_61_90 || 0),
    days_90_plus: acc.days_90_plus + Number(r.days_90_plus || 0),
  }), { total: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 });
  return (
    <Card title={title} subtitle="Outstanding balances by age" noPad>
      <DataTable
        rows={rows}
        dense
        empty="Nothing outstanding"
        columns={[
          { key: 'name', header: 'Account' },
          { key: 'current', header: 'Current', align: 'right', render: (r) => money(r.current) },
          { key: 'days_1_30', header: '1–30', align: 'right', render: (r) => money(r.days_1_30) },
          { key: 'days_31_60', header: '31–60', align: 'right', render: (r) => money(r.days_31_60) },
          { key: 'days_61_90', header: '61–90', align: 'right', render: (r) => money(r.days_61_90) },
          { key: 'days_90_plus', header: '90+', align: 'right', render: (r) => <span className={Number(r.days_90_plus) > 0 ? 'neg' : ''}>{money(r.days_90_plus)}</span> },
          { key: 'total', header: 'Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
        ]}
        footer={rows.length > 0 ? (
          <tr>
            <td>Total</td>
            <td className="align-right">{money(totals.current)}</td>
            <td className="align-right">{money(totals.days_1_30)}</td>
            <td className="align-right">{money(totals.days_31_60)}</td>
            <td className="align-right">{money(totals.days_61_90)}</td>
            <td className="align-right">{money(totals.days_90_plus)}</td>
            <td className="align-right">{money(totals.total)}</td>
          </tr>
        ) : null}
      />
    </Card>
  );
}
