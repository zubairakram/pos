import { useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, Calculator, ChevronRight, CircleDollarSign,
  Download, Printer, Wallet,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  daysAgoInput, downloadCSV, printElement, todayInput, useFormat,
} from '../format.js';
import { useApi } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, IconButton, Input, LoadingBlock, Modal,
  PageHeader, Select, Spinner, Stat, StatusBadge, Tabs, Textarea,
} from '../components/ui.jsx';

const DENOMINATIONS = [
  { value: 100, label: '$100' },
  { value: 50, label: '$50' },
  { value: 20, label: '$20' },
  { value: 10, label: '$10' },
  { value: 5, label: '$5' },
  { value: 1, label: '$1' },
  { value: 0.25, label: '25¢' },
  { value: 0.1, label: '10¢' },
  { value: 0.05, label: '5¢' },
  { value: 0.01, label: '1¢' },
];

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const MOVEMENT_LABELS = {
  sale: 'Sale payment',
  refund: 'Refund',
  receipt: 'Customer receipt',
  payment: 'Cash payment',
  cash_in: 'Cash in',
  cash_out: 'Cash out',
  float: 'Opening float',
};

export default function Cash() {
  const { user } = useAuth();
  const { money, number, date, dateTime, time } = useFormat();
  const toast = useToast();
  const [tab, setTab] = useState('registers');

  const [status, setStatus] = useState('open');
  const [registerFilter, setRegisterFilter] = useState('');
  const [from, setFrom] = useState(daysAgoInput(30));
  const [to, setTo] = useState(todayInput());

  const [sessionId, setSessionId] = useState(null);
  const [openDrawer, setOpenDrawer] = useState(false);
  const [openForm, setOpenForm] = useState({ register_id: '', opening_float: '300', note: '' });
  const [openSaving, setOpenSaving] = useState(false);
  const [openError, setOpenError] = useState('');

  const [movement, setMovement] = useState({ type: 'cash_in', amount: '', reason: '' });
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementError, setMovementError] = useState('');

  const [closeOpen, setCloseOpen] = useState(false);
  const [closeForm, setCloseForm] = useState({ counted_cash: '', note: '' });
  const [denoms, setDenoms] = useState({});
  const [closeSaving, setCloseSaving] = useState(false);
  const [closeError, setCloseError] = useState('');

  const registersApi = useApi('/cash/registers');
  const sessionsApi = useApi('/cash/sessions', {
    status: status || undefined,
    register_id: registerFilter || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const summaryApi = useApi(sessionId ? `/cash/sessions/${sessionId}/summary` : null);

  const registers = registersApi.data?.registers || [];
  const sessions = sessionsApi.data?.sessions || [];
  const summary = summaryApi.data?.session;

  const openRegisters = registers.filter((r) => r.open_session_id);
  const expectedTotal = openRegisters.reduce((s, r) => s + Number(r.expected_cash || 0), 0);
  const todaySessions = sessions.filter((s) => String(s.opened_at).slice(0, 10) === todayInput());
  const totalVariance = sessions.filter((s) => s.status === 'closed').reduce((s, r) => s + Number(r.variance || 0), 0);

  const denomTotal = useMemo(() => r2(DENOMINATIONS.reduce((s, d) => s + Number(denoms[d.value] || 0) * d.value, 0)), [denoms]);
  const hasDenoms = Object.values(denoms).some((v) => Number(v) > 0);

  const canOperate = ['admin', 'manager', 'cashier'].includes(user.role);
  const canCloseSession = (s) => !!s && s.status === 'open' && (user.role !== 'cashier' || s.user_id === user.id);

  function openRegister(r) {
    setOpenForm({
      register_id: String(r?.id || registers.find((x) => !x.open_session_id)?.id || ''),
      opening_float: '300',
      note: '',
    });
    setOpenError('');
    setOpenDrawer(true);
  }

  async function submitOpen(e) {
    e.preventDefault();
    setOpenError('');
    if (!openForm.register_id) return setOpenError('Choose a register.');
    setOpenSaving(true);
    try {
      const data = await api.post('/cash/sessions/open', {
        register_id: Number(openForm.register_id),
        opening_float: Number(openForm.opening_float || 0),
        note: openForm.note || undefined,
      });
      toast.success('Cash drawer opened');
      setOpenDrawer(false);
      await registersApi.reload();
      sessionsApi.reload();
      setTab('sessions');
      setSessionId(data.session.id);
    } catch (err) {
      setOpenError(err.message);
    } finally {
      setOpenSaving(false);
    }
  }

  function openMovement(type) {
    setMovement({ type, amount: '', reason: '' });
    setMovementError('');
    setMovementOpen(true);
  }

  async function submitMovement(e) {
    e.preventDefault();
    setMovementError('');
    const amount = Number(movement.amount);
    if (!amount || amount <= 0) return setMovementError('Enter an amount greater than zero.');
    if (!movement.reason.trim()) return setMovementError('Add a reason for the movement.');
    setMovementSaving(true);
    try {
      await api.post(`/cash/sessions/${sessionId}/movements`, {
        type: movement.type,
        amount,
        reason: movement.reason.trim(),
      });
      toast.success(movement.type === 'cash_in' ? 'Cash added to drawer' : 'Cash removed from drawer');
      setMovementOpen(false);
      summaryApi.reload();
      registersApi.reload();
    } catch (err) {
      setMovementError(err.message);
    } finally {
      setMovementSaving(false);
    }
  }

  function openClose() {
    setCloseForm({ counted_cash: summary ? String(summary.computed_expected ?? summary.expected_cash ?? 0) : '', note: '' });
    setDenoms({});
    setCloseError('');
    setCloseOpen(true);
  }

  async function submitClose(e) {
    e.preventDefault();
    setCloseError('');
    const counted = Number(closeForm.counted_cash);
    if (!Number.isFinite(counted) || counted < 0) return setCloseError('Enter a valid counted amount.');
    const denominations = hasDenoms
      ? Object.fromEntries(DENOMINATIONS.filter((d) => Number(denoms[d.value]) > 0).map((d) => [String(d.value), Number(denoms[d.value])]))
      : undefined;
    setCloseSaving(true);
    try {
      await api.post(`/cash/sessions/${sessionId}/close`, {
        counted_cash: counted,
        denominations,
        note: closeForm.note || undefined,
      });
      toast.success('Drawer closed and variance posted');
      setCloseOpen(false);
      summaryApi.reload();
      await registersApi.reload();
      sessionsApi.reload();
    } catch (err) {
      setCloseError(err.message);
    } finally {
      setCloseSaving(false);
    }
  }

  function exportSessions() {
    downloadCSV(`cash-sessions-${from}-to-${to}.csv`, [
      { header: 'Session', key: 'id' },
      { header: 'Register', key: 'register_name' },
      { header: 'Cashier', key: 'cashier_name' },
      { header: 'Opened', key: 'opened_at' },
      { header: 'Closed', key: 'closed_at' },
      { header: 'Opening float', key: 'opening_float' },
      { header: 'Expected', value: (r) => r.expected_cash ?? r.computed_expected },
      { header: 'Counted', key: 'counted_cash' },
      { header: 'Variance', key: 'variance' },
      { header: 'Transactions', key: 'transactions' },
      { header: 'Status', key: 'status' },
    ], sessions);
    toast.success('Cash sessions exported');
  }

  const tabs = [
    { value: 'registers', label: 'Drawers', icon: Wallet, count: registers.length },
    { value: 'sessions', label: 'Sessions', icon: CircleDollarSign, count: sessions.length },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Cash & drawers"
        subtitle="Open a till, record cash movements and reconcile every drawer to the ledger."
        actions={(
          <>
            {tab === 'sessions' && <Button variant="secondary" icon={Download} onClick={exportSessions} disabled={!sessions.length}>Export CSV</Button>}
            {canOperate && <Button icon={Wallet} onClick={() => openRegister()}>Open drawer</Button>}
          </>
        )}
      />

      <div className="stat-grid">
        <Stat label="Open drawers" value={number(openRegisters.length)} sub={`${registers.length} register(s) configured`} icon={Wallet} tone={openRegisters.length ? 'brand' : 'default'} />
        <Stat label="Expected cash" value={money(expectedTotal)} sub="Across all open drawers" icon={Banknote} tone="info" />
        <Stat label="Sessions today" value={number(todaySessions.length)} sub={`${number(todaySessions.filter((s) => s.status === 'open').length)} still open`} icon={Calculator} tone="purple" />
        <Stat label="Net variance" value={money(totalVariance)} sub="Closed sessions in this period" icon={CircleDollarSign} tone={Math.abs(totalVariance) > 0.005 ? 'warning' : 'default'} />
      </div>

      <Card noPad>
        <div style={{ padding: '0 14px' }}><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
        <div className="card-body">
          {tab === 'registers' && (
            <div className="grid grid-3">
              {registersApi.loading && !registersApi.data && <LoadingBlock />}
              {registers.map((r) => (
                <div className="card" key={r.id} style={{ margin: 0 }}>
                  <div className="between" style={{ marginBottom: 10 }}>
                    <div>
                      <div className="card-title">{r.name}</div>
                      <div className="tiny muted">{r.location_name} · {r.account_code} {r.account_name}</div>
                    </div>
                    <Badge tone={r.open_session_id ? 'success' : 'neutral'} dot>{r.open_session_id ? 'Open' : 'Closed'}</Badge>
                  </div>
                  {r.open_session_id ? (
                    <>
                      <div className="amount" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{money(r.expected_cash)}</div>
                      <div className="tiny muted">Expected cash · opened {dateTime(r.opened_at)}</div>
                      <div className="small mt-sm">Cashier: <b>{r.cashier_name}</b></div>
                      <div className="flex gap-sm mt">
                        <Button size="sm" variant="secondary" onClick={() => setSessionId(r.open_session_id)}>Manage</Button>
                        <Button size="sm" variant="ghost" icon={ChevronRight} onClick={() => { setTab('sessions'); setStatus('open'); setRegisterFilter(String(r.id)); }}>Sessions</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="amount" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>—</div>
                      <div className="tiny muted">Drawer is closed</div>
                      <div className="small mt-sm muted">Ledger account {r.account_code} · {r.account_name}</div>
                      {canOperate && <Button size="sm" className="mt" icon={Wallet} onClick={() => openRegister(r)}>Open drawer</Button>}
                    </>
                  )}
                </div>
              ))}
              {!registersApi.loading && registers.length === 0 && (
                <div className="muted">No registers configured. Ask an administrator to add one in the database seed or admin tools.</div>
              )}
            </div>
          )}

          {tab === 'sessions' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <Field label="Status">
                    <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">All</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </Select>
                  </Field>
                  <Field label="Register">
                    <Select value={registerFilter} onChange={(e) => setRegisterFilter(e.target.value)}>
                      <option value="">All registers</option>
                      {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                  <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                </div>
                <div className="toolbar-right"><Badge tone="neutral">{sessions.length} session(s)</Badge></div>
              </div>

              {sessionsApi.loading && !sessionsApi.data ? <LoadingBlock /> : (
                <DataTable
                  rows={sessions}
                  empty="No sessions match these filters"
                  onRowClick={(r) => setSessionId(r.id)}
                  columns={[
                    { key: 'opened_at', header: 'Opened', render: (r) => <div><div>{date(r.opened_at)}</div><div className="tiny muted">{time(r.opened_at)}</div></div> },
                    { key: 'register_name', header: 'Register', render: (r) => <div><b>{r.register_name}</b><div className="tiny muted">{r.location_name}</div></div> },
                    { key: 'cashier_name', header: 'Cashier' },
                    { key: 'opening_float', header: 'Float', align: 'right', render: (r) => money(r.opening_float) },
                    { key: 'computed_expected', header: 'Expected', align: 'right', render: (r) => <b>{money(r.expected_cash ?? r.computed_expected)}</b> },
                    { key: 'counted_cash', header: 'Counted', align: 'right', render: (r) => (r.counted_cash === null ? <span className="muted">—</span> : money(r.counted_cash)) },
                    { key: 'variance', header: 'Variance', align: 'right', render: (r) => (r.variance === null ? <span className="muted">—</span> : <span className={Number(r.variance) < 0 ? 'neg bold' : Number(r.variance) > 0 ? 'bold' : ''}>{money(r.variance)}</span>) },
                    { key: 'transactions', header: 'Sales', align: 'right' },
                    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  ]}
                />
              )}
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={!!sessionId}
        onClose={() => setSessionId(null)}
        title={summary ? `${summary.register_name} drawer` : 'Drawer session'}
        subtitle={summary ? `${summary.cashier_name} · opened ${dateTime(summary.opened_at)}` : ''}
        size="lg"
        footer={summary ? (
          <>
            {summary.status === 'open' && canCloseSession(summary) && (
              <>
                <Button variant="secondary" icon={ArrowDownLeft} onClick={() => openMovement('cash_in')}>Cash in</Button>
                <Button variant="secondary" icon={ArrowUpRight} onClick={() => openMovement('cash_out')}>Cash out</Button>
                <Button icon={Calculator} onClick={openClose}>Count & close</Button>
              </>
            )}
            <Button variant="secondary" icon={Printer} onClick={() => printElement('z-report-print')} disabled={summary.status !== 'closed'}>Print Z report</Button>
            <Button variant="ghost" onClick={() => setSessionId(null)}>Close</Button>
          </>
        ) : null}
      >
        {summaryApi.loading && !summary ? <Spinner /> : !summary ? <div className="muted">Unable to load drawer.</div> : (
          <div className="stack">
            <div className="session-summary-grid">
              <div className="summary-box"><div className="label">Opening float</div><div className="value">{money(summary.opening_float)}</div></div>
              <div className="summary-box"><div className="label">Expected cash</div><div className="value">{money(summary.expected_cash)}</div></div>
              <div className="summary-box"><div className="label">Counted cash</div><div className="value">{summary.counted_cash === null ? '—' : money(summary.counted_cash)}</div></div>
              <div className="summary-box"><div className="label">Variance</div><div className={`value ${Number(summary.difference) < 0 ? 'neg' : ''}`}>{summary.difference === null ? '—' : money(summary.difference)}</div></div>
            </div>

            <div className="grid grid-2">
              <div>
                <div className="section-title"><h3>Sales through this drawer</h3></div>
                <div className="stack-sm">
                  <div className="sum-row"><span>Transactions</span><span>{number(summary.sales?.transactions)}</span></div>
                  <div className="sum-row"><span>Gross sales</span><span>{money(summary.sales?.gross_sales)}</span></div>
                  <div className="sum-row"><span>Collected</span><span>{money(summary.sales?.collected)}</span></div>
                  <div className="sum-row"><span>Tax</span><span>{money(summary.sales?.tax)}</span></div>
                  <div className="sum-row"><span>Discounts</span><span>−{money(summary.sales?.discounts)}</span></div>
                  <div className="sum-row"><span>Returns ({number(summary.returns?.returns)})</span><span>−{money(summary.returns?.refunds)}</span></div>
                </div>
              </div>
              <div>
                <div className="section-title"><h3>Payment mix</h3></div>
                <div className="stack-sm">
                  {(summary.payment_totals || []).length === 0 && <span className="muted small">No payments recorded.</span>}
                  {(summary.payment_totals || []).map((p) => (
                    <div className="sum-row" key={`${p.code}-${p.name}`}><span>{p.name} <span className="tiny muted">({p.type})</span></span><span>{money(p.amount)}</span></div>
                  ))}
                  <div className="divider" />
                  {(summary.movement_totals && Object.entries(summary.movement_totals).length > 0) ? Object.entries(summary.movement_totals).map(([type, amount]) => (
                    <div className="sum-row" key={type}><span>{MOVEMENT_LABELS[type] || type}</span><span className={Number(amount) < 0 ? 'neg' : ''}>{money(amount)}</span></div>
                  )) : <span className="muted small">No cash movements.</span>}
                </div>
              </div>
            </div>

            <div>
              <div className="section-title"><h3>Cash movements</h3><span className="tiny muted">{summary.movements?.length || 0} entries</span></div>
              <DataTable
                rows={summary.movements || []}
                dense
                empty="No movements recorded"
                columns={[
                  { key: 'created_at', header: 'Time', render: (r) => dateTime(r.created_at) },
                  { key: 'type', header: 'Type', render: (r) => <Badge tone={Number(r.amount) < 0 ? 'danger' : 'success'}>{MOVEMENT_LABELS[r.type] || r.type}</Badge> },
                  { key: 'reason', header: 'Reason', render: (r) => r.reason || <span className="muted">—</span> },
                  { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className={Number(r.amount) < 0 ? 'neg bold' : 'bold'}>{money(r.amount)}</span> },
                ]}
              />

              {summary.status === 'closed' && (
                <div className="receipt receipt-print" id="z-report-print" style={{ marginTop: 18 }}>
                  <div className="receipt-center">
                    <h3>Z Report</h3>
                    <div className="muted">{summary.register_name} · {summary.cashier_name}</div>
                  </div>
                  <hr />
                  <table className="receipt-table">
                    <tbody>
                      <tr><td className="muted">Opened</td><td className="right">{dateTime(summary.opened_at)}</td></tr>
                      <tr><td className="muted">Closed</td><td className="right">{dateTime(summary.closed_at)}</td></tr>
                      <tr><td className="muted">Opening float</td><td className="right">{money(summary.opening_float)}</td></tr>
                      <tr><td className="muted">Transactions</td><td className="right">{number(summary.sales?.transactions)}</td></tr>
                      <tr><td className="muted">Gross sales</td><td className="right">{money(summary.sales?.gross_sales)}</td></tr>
                      <tr><td className="muted">Tax</td><td className="right">{money(summary.sales?.tax)}</td></tr>
                      <tr><td className="muted">Returns</td><td className="right">−{money(summary.returns?.refunds)}</td></tr>
                      {(summary.payment_totals || []).map((p) => (
                        <tr key={p.name}><td className="muted">{p.name}</td><td className="right">{money(p.amount)}</td></tr>
                      ))}
                      <tr><td className="muted">Expected cash</td><td className="right">{money(summary.expected_cash)}</td></tr>
                      <tr><td className="muted">Counted cash</td><td className="right">{money(summary.counted_cash)}</td></tr>
                      <tr className="receipt-total"><td>Variance</td><td className="right">{money(summary.difference)}</td></tr>
                    </tbody>
                  </table>
                  <hr />
                  <div className="receipt-center muted">End of drawer session</div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={openDrawer}
        onClose={() => !openSaving && setOpenDrawer(false)}
        title="Open cash drawer"
        subtitle="Record the opening float before taking sales."
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpenDrawer(false)} disabled={openSaving}>Cancel</Button>
            <Button icon={Wallet} onClick={submitOpen} loading={openSaving}>Open drawer</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitOpen}>
          {openError && <div className="info-note danger">{openError}</div>}
          <Field label="Register">
            <Select value={openForm.register_id} onChange={(e) => setOpenForm({ ...openForm, register_id: e.target.value })}>
              <option value="">Choose register</option>
              {registers.filter((r) => !r.open_session_id).map((r) => (
                <option key={r.id} value={r.id}>{r.name} · {r.location_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Opening float">
            <Input value={openForm.opening_float} onChange={(e) => setOpenForm({ ...openForm, opening_float: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Note"><Textarea value={openForm.note} onChange={(e) => setOpenForm({ ...openForm, note: e.target.value })} rows={2} placeholder="Optional shift note" /></Field>
          {registers.filter((r) => !r.open_session_id).length === 0 && (
            <div className="info-note">All registers are currently open. Close one before opening another.</div>
          )}
        </form>
      </Modal>

      <Modal
        open={movementOpen}
        onClose={() => !movementSaving && setMovementOpen(false)}
        title={movement.type === 'cash_in' ? 'Cash in' : 'Cash out'}
        subtitle="Cash movements post to owner capital / drawings in the ledger."
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setMovementOpen(false)} disabled={movementSaving}>Cancel</Button>
            <Button icon={movement.type === 'cash_in' ? ArrowDownLeft : ArrowUpRight} onClick={submitMovement} loading={movementSaving}>Post movement</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitMovement}>
          {movementError && <div className="info-note danger">{movementError}</div>}
          <Field label="Amount"><Input value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} inputMode="decimal" placeholder="0.00" autoFocus /></Field>
          <Field label="Reason"><Textarea value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} rows={3} placeholder="Float top-up, petty cash, bank deposit…" /></Field>
        </form>
      </Modal>

      <Modal
        open={closeOpen}
        onClose={() => !closeSaving && setCloseOpen(false)}
        title="Count & close drawer"
        subtitle={summary ? `Expected ${money(summary.computed_expected ?? summary.expected_cash)} in ${summary.register_name}` : ''}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={closeSaving}>Cancel</Button>
            <Button icon={Calculator} onClick={submitClose} loading={closeSaving}>Close drawer</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitClose}>
          {closeError && <div className="info-note danger">{closeError}</div>}
          <div className="grid grid-2">
            <Field label="Counted cash" hint="Actual physical cash in the drawer">
              <Input value={closeForm.counted_cash} onChange={(e) => setCloseForm({ ...closeForm, counted_cash: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Counted from denominations" hint="Optional bill/coin count">
              <div className="flex gap-sm">
                <Input value={denomTotal.toFixed(2)} readOnly />
                <Button type="button" variant="secondary" onClick={() => setCloseForm({ ...closeForm, counted_cash: denomTotal.toFixed(2) })} disabled={!hasDenoms}>Use</Button>
              </div>
            </Field>
          </div>

          <div className="denomination-grid">
            {DENOMINATIONS.map((d) => (
              <label className="denomination-row" key={d.value}>
                <span>{d.label}</span>
                <Input
                  value={denoms[d.value] ?? ''}
                  onChange={(e) => setDenoms({ ...denoms, [d.value]: e.target.value })}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={`${d.label} count`}
                />
                <span className="small muted nowrap">{money(Number(denoms[d.value] || 0) * d.value)}</span>
              </label>
            ))}
          </div>

          {summary && (
            <div className="drawer-variance">
              <div><span>Expected</span><b>{money(summary.computed_expected ?? summary.expected_cash)}</b></div>
              <div><span>Counted</span><b>{money(closeForm.counted_cash)}</b></div>
              <div><span>Variance</span><b className={Number(closeForm.counted_cash || 0) - Number(summary.computed_expected ?? summary.expected_cash) < 0 ? 'neg' : ''}>{money(Number(closeForm.counted_cash || 0) - Number(summary.computed_expected ?? summary.expected_cash))}</b></div>
            </div>
          )}

          <Field label="Closing note"><Textarea value={closeForm.note} onChange={(e) => setCloseForm({ ...closeForm, note: e.target.value })} rows={2} placeholder="Optional note about the count" /></Field>
          <div className="info-note">Any variance is posted to the cash over/short account automatically.</div>
        </form>
      </Modal>
    </div>
  );
}
