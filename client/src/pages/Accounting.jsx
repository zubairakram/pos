import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, Banknote, BookOpen, Calculator, ChevronRight, Download, Edit3,
  FileBarChart, Landmark, Layers, ListTree, Plus, Receipt, Scale, Settings2,
  Sparkles, Trash2, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  daysAgoInput, downloadCSV, monthStartInput, todayInput, useFormat,
} from '../format.js';
import { useApi } from '../hooks.js';
import { useToast } from '../toast.jsx';
import {
  Badge, Button, Card, DataTable, Field, IconButton, Input, LoadingBlock, Modal,
  PageHeader, Pagination, Select, Spinner, Stat, Tabs, Textarea,
} from '../components/ui.jsx';

const PAGE_SIZE = 50;

const MAPPING_LABELS = {
  ar: 'Accounts receivable',
  ap: 'Accounts payable',
  inventory: 'Inventory',
  tax_payable: 'Sales tax payable',
  tax_receivable: 'Tax receivable (input)',
  sales: 'Sales revenue',
  sales_returns: 'Sales returns',
  cogs: 'Cost of goods sold',
  inventory_adjustment: 'Inventory adjustments',
  cash_over_short: 'Cash over / short',
  opening_balance_equity: 'Opening balance equity',
  owner_capital: 'Owner capital',
  owner_drawings: 'Owner drawings',
  retained_earnings: 'Retained earnings',
  bank: 'Bank account',
};

const SOURCE_TYPES = [
  'sale', 'sale_return', 'sale_void', 'purchase', 'customer_receipt', 'supplier_payment',
  'expense', 'stock_adjustment', 'cash_variance', 'cash_in', 'cash_out', 'manual',
  'opening_balance', 'opening_stock',
];

const blankLine = () => ({ account_id: '', debit: '', credit: '', description: '' });

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function Accounting() {
  const { user } = useAuth();
  const { money, date, dateTime, number } = useFormat();
  const toast = useToast();
  const [tab, setTab] = useState('journal');
  const [from, setFrom] = useState(monthStartInput());
  const [to, setTo] = useState(todayInput());
  const [asOf, setAsOf] = useState(todayInput());

  const [q, setQ] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [offset, setOffset] = useState(0);

  const [journalId, setJournalId] = useState(null);
  const [ledgerAccount, setLedgerAccount] = useState(null);

  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: '', name: '', type: 'expense', subtype: '', parent_id: '', description: '', is_active: true });
  const [accountEditId, setAccountEditId] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [accountSaving, setAccountSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ date: todayInput(), memo: '', location_id: '', lines: [blankLine(), blankLine()] });
  const [manualError, setManualError] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expense, setExpense] = useState({ account_id: '', amount: '', method_id: '', date: todayInput(), reference: '', notes: '', session_id: '', location_id: '' });
  const [expenseError, setExpenseError] = useState('');
  const [expenseSaving, setExpenseSaving] = useState(false);

  const [mappingValues, setMappingValues] = useState({});
  const [mappingSaving, setMappingSaving] = useState(false);

  const journalApi = useApi('/accounting/journal', {
    from, to, q: q || undefined, source_type: sourceType || undefined, limit: PAGE_SIZE, offset,
  }, { enabled: tab === 'journal' });
  const journalDetail = useApi(journalId ? `/accounting/journal/${journalId}` : null);
  const accountsApi = useApi('/accounting/accounts', { balances: true }, { enabled: ['accounts', 'trial-balance', 'expenses', 'mappings', 'journal', 'pnl', 'balance-sheet', 'cash-flow', 'manual'].includes(tab) });
  const trialApi = useApi('/accounting/trial-balance', { from, to }, { enabled: tab === 'trial-balance' });
  const pnlApi = useApi('/accounting/pnl', { from, to }, { enabled: tab === 'pnl' });
  const sheetApi = useApi('/accounting/balance-sheet', { as_of: asOf }, { enabled: tab === 'balance-sheet' });
  const cashFlowApi = useApi('/accounting/cash-flow', { from, to }, { enabled: tab === 'cash-flow' });
  const expensesApi = useApi('/accounting/expenses', { from, to }, { enabled: tab === 'expenses' });
  const mappingsApi = useApi('/accounting/mappings', undefined, { enabled: tab === 'mappings' });
  const ledgerApi = useApi(ledgerAccount ? `/accounting/ledger/${ledgerAccount}` : null, { from, to }, { enabled: !!ledgerAccount });
  const methodsApi = useApi('/payment-methods', undefined, { enabled: tab === 'expenses' });
  const locationsApi = useApi('/locations', undefined, { enabled: tab === 'expenses' || tab === 'manual' });
  const openSessionsApi = useApi('/cash/sessions', { status: 'open' }, { enabled: tab === 'expenses' });

  const accounts = accountsApi.data?.accounts || [];
  const expenseAccounts = accounts.filter((a) => a.type === 'expense' && a.is_active !== false);
  const methods = (methodsApi.data?.payment_methods || []).filter((m) => m.is_active !== false);
  const locations = (locationsApi.data?.locations || []).filter((l) => l.is_active !== false);
  const openSessions = openSessionsApi.data?.sessions || [];
  const entries = journalApi.data?.entries || [];
  const journal = journalDetail.data?.entry;
  const trial = trialApi.data;
  const pnl = pnlApi.data;
  const sheet = sheetApi.data;
  const flow = cashFlowApi.data;
  const expenses = expensesApi.data?.expenses || [];
  const mappings = mappingsApi.data?.mappings || [];

  const canEditAccounts = ['admin', 'accountant'].includes(user.role);
  const canMapping = user.role === 'admin';
  const canManual = ['admin', 'accountant'].includes(user.role);
  const canExpense = ['admin', 'manager', 'accountant'].includes(user.role);

  useEffect(() => {
    if (mappings.length) {
      setMappingValues(Object.fromEntries(mappings.map((m) => [m.key, String(m.account_id)])));
    }
  }, [mappingsApi.data]);

  function openAccount(account) {
    setAccountEditId(account?.id || null);
    setAccountForm(account ? {
      code: account.code, name: account.name, type: account.type, subtype: account.subtype || '',
      parent_id: account.parent_id || '', description: account.description || '', is_active: account.is_active !== false,
    } : { code: '', name: '', type: 'expense', subtype: '', parent_id: '', description: '', is_active: true });
    setAccountError('');
    setAccountsOpen(true);
  }

  async function submitAccount(e) {
    e.preventDefault();
    setAccountError('');
    if (!accountForm.code || !accountForm.name) return setAccountError('Code and name are required.');
    setAccountSaving(true);
    try {
      const payload = {
        code: accountForm.code, name: accountForm.name, type: accountForm.type,
        subtype: accountForm.subtype || null, parent_id: accountForm.parent_id ? Number(accountForm.parent_id) : null,
        description: accountForm.description || null, is_active: accountForm.is_active,
      };
      if (accountEditId) await api.put(`/accounting/accounts/${accountEditId}`, payload);
      else await api.post('/accounting/accounts', payload);
      toast.success(accountEditId ? 'Account updated' : 'Account created');
      setAccountsOpen(false);
      accountsApi.reload();
    } catch (err) {
      setAccountError(err.message);
    } finally {
      setAccountSaving(false);
    }
  }

  function openManual() {
    setManual({ date: todayInput(), memo: '', location_id: String(user.location_id || ''), lines: [blankLine(), blankLine()] });
    setManualError('');
    setManualOpen(true);
  }

  function updateManualLine(index, patch) {
    setManual((m) => ({ ...m, lines: m.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }

  const manualDebit = useMemo(() => r2(manual.lines.reduce((s, l) => s + Number(l.debit || 0), 0)), [manual.lines]);
  const manualCredit = useMemo(() => r2(manual.lines.reduce((s, l) => s + Number(l.credit || 0), 0)), [manual.lines]);

  async function submitManual(e) {
    e.preventDefault();
    setManualError('');
    if (!manual.memo.trim()) return setManualError('Add a memo for the entry.');
    const lines = manual.lines.filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (lines.length < 2) return setManualError('Add at least two lines with an account and amount.');
    if (Math.abs(manualDebit - manualCredit) > 0.005) return setManualError('Total debits must equal total credits.');
    setManualSaving(true);
    try {
      await api.post('/accounting/journal', {
        date: manual.date,
        memo: manual.memo.trim(),
        location_id: manual.location_id ? Number(manual.location_id) : undefined,
        lines: lines.map((l) => ({
          account_id: Number(l.account_id),
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description || manual.memo.trim(),
        })),
      });
      toast.success('Journal entry posted');
      setManualOpen(false);
      journalApi.reload();
      accountsApi.reload();
      trialApi.reload();
    } catch (err) {
      setManualError(err.message);
    } finally {
      setManualSaving(false);
    }
  }

  function openExpense() {
    const expenseAccount = expenseAccounts.find((a) => a.subtype === 'operating') || expenseAccounts[0];
    const cash = methods.find((m) => m.type === 'cash') || methods[0];
    setExpense({
      account_id: expenseAccount ? String(expenseAccount.id) : '',
      amount: '',
      method_id: cash ? String(cash.id) : '',
      date: todayInput(),
      reference: '',
      notes: '',
      session_id: openSessions[0]?.id ? String(openSessions[0].id) : '',
      location_id: String(user.location_id || ''),
    });
    setExpenseError('');
    setExpenseOpen(true);
  }

  async function submitExpense(e) {
    e.preventDefault();
    setExpenseError('');
    const amount = Number(expense.amount);
    if (!expense.account_id) return setExpenseError('Choose an expense account.');
    if (!amount || amount <= 0) return setExpenseError('Enter an amount greater than zero.');
    const method = methods.find((m) => String(m.id) === String(expense.method_id));
    if (!method) return setExpenseError('Choose a payment method.');
    if (method.type === 'cash' && !expense.session_id) return setExpenseError('Choose an open cash drawer.');
    setExpenseSaving(true);
    try {
      await api.post('/accounting/expenses', {
        account_id: Number(expense.account_id),
        amount,
        method_id: Number(expense.method_id),
        date: expense.date,
        reference: expense.reference || undefined,
        notes: expense.notes || undefined,
        session_id: method.type === 'cash' ? Number(expense.session_id) : undefined,
        location_id: expense.location_id ? Number(expense.location_id) : undefined,
      });
      toast.success('Expense recorded and posted');
      setExpenseOpen(false);
      expensesApi.reload();
      accountsApi.reload();
      journalApi.reload();
    } catch (err) {
      setExpenseError(err.message);
    } finally {
      setExpenseSaving(false);
    }
  }

  async function saveMappings() {
    setMappingSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(mappingValues).map(([k, v]) => [k, Number(v)]));
      await api.put('/accounting/mappings', { mappings: payload });
      toast.success('Account mappings saved');
      mappingsApi.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMappingSaving(false);
    }
  }

  function exportJournal() {
    downloadCSV(`journal-${from}-to-${to}.csv`, [
      { header: 'Entry', key: 'entry_no' },
      { header: 'Date', key: 'entry_date' },
      { header: 'Memo', key: 'memo' },
      { header: 'Source', key: 'source_type' },
      { header: 'Debit', key: 'total_debit' },
      { header: 'Credit', key: 'total_credit' },
      { header: 'User', key: 'user_name' },
    ], entries);
    toast.success('Journal exported');
  }

  function exportTrial() {
    downloadCSV(`trial-balance-${from}-to-${to}.csv`, [
      { header: 'Code', key: 'code' },
      { header: 'Account', key: 'name' },
      { header: 'Type', key: 'type' },
      { header: 'Debit', key: 'debit' },
      { header: 'Credit', key: 'credit' },
      { header: 'Balance', key: 'balance' },
    ], trial?.rows || []);
    toast.success('Trial balance exported');
  }

  function exportExpenses() {
    downloadCSV(`expenses-${from}-to-${to}.csv`, [
      { header: 'Date', key: 'entry_date' },
      { header: 'Account', key: 'account_name' },
      { header: 'Method', key: 'method_name' },
      { header: 'Reference', key: 'reference' },
      { header: 'Notes', key: 'notes' },
      { header: 'Amount', key: 'amount' },
      { header: 'Entry', key: 'entry_no' },
    ], expenses);
    toast.success('Expenses exported');
  }

  const tabs = [
    { value: 'journal', label: 'Journal', icon: BookOpen },
    { value: 'accounts', label: 'Chart of accounts', icon: ListTree, count: accounts.length },
    { value: 'trial-balance', label: 'Trial balance', icon: Scale },
    { value: 'pnl', label: 'Profit & loss', icon: TrendingUp },
    { value: 'balance-sheet', label: 'Balance sheet', icon: FileBarChart },
    { value: 'cash-flow', label: 'Cash flow', icon: Banknote },
    { value: 'expenses', label: 'Expenses', icon: Receipt },
    { value: 'mappings', label: 'Mappings', icon: Settings2 },
  ];

  const trialRows = trial?.rows || [];
  const method = methods.find((m) => String(m.id) === String(expense.method_id));

  return (
    <div className="page">
      <PageHeader
        title="Accounting"
        subtitle="The general ledger behind every sale, purchase, payment and adjustment."
        actions={(
          <>
            {tab === 'journal' && <Button variant="secondary" icon={Download} onClick={exportJournal} disabled={!entries.length}>Export CSV</Button>}
            {tab === 'trial-balance' && <Button variant="secondary" icon={Download} onClick={exportTrial} disabled={!trialRows.length}>Export CSV</Button>}
            {tab === 'expenses' && <Button variant="secondary" icon={Download} onClick={exportExpenses} disabled={!expenses.length}>Export CSV</Button>}
            {tab === 'journal' && canManual && <Button icon={Plus} onClick={openManual}>Manual journal</Button>}
            {tab === 'accounts' && canEditAccounts && <Button icon={Plus} onClick={() => openAccount()}>New account</Button>}
            {tab === 'expenses' && canExpense && <Button icon={Plus} onClick={openExpense}>Record expense</Button>}
          </>
        )}
      />

      <Card noPad>
        <div style={{ padding: '0 14px' }}>
          <Tabs tabs={tabs} value={tab} onChange={(v) => { setTab(v); setOffset(0); }} />
        </div>
        <div className="card-body">
          {tab === 'journal' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} /></Field>
                  <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} /></Field>
                  <Field label="Source">
                    <Select value={sourceType} onChange={(e) => { setSourceType(e.target.value); setOffset(0); }}>
                      <option value="">All sources</option>
                      {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="toolbar-right">
                  <div className="search-input">
                    <Input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Entry no or memo…" style={{ border: 0 }} />
                  </div>
                </div>
              </div>

              {journalApi.loading && !journalApi.data ? <LoadingBlock /> : (
                <>
                  <DataTable
                    rows={entries}
                    empty="No journal entries in this period"
                    onRowClick={(r) => setJournalId(r.id)}
                    columns={[
                      { key: 'entry_no', header: 'Entry', render: (r) => <span className="mono bold">{r.entry_no}</span> },
                      { key: 'entry_date', header: 'Date', render: (r) => date(r.entry_date) },
                      { key: 'memo', header: 'Memo', render: (r) => <div><div>{r.memo}</div><div className="tiny muted">{r.location_name || '—'}{r.user_name ? ` · ${r.user_name}` : ''}</div></div> },
                      { key: 'source_type', header: 'Source', render: (r) => <Badge tone="neutral">{r.source_type?.replaceAll('_', ' ')}</Badge> },
                      { key: 'line_count', header: 'Lines', align: 'right' },
                      { key: 'total_debit', header: 'Debit', align: 'right', render: (r) => money(r.total_debit) },
                      { key: 'total_credit', header: 'Credit', align: 'right', render: (r) => money(r.total_credit) },
                      { key: 'actions', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon={ChevronRight} onClick={(e) => { e.stopPropagation(); setJournalId(r.id); }}>Open</Button> },
                    ]}
                  />
                  <Pagination limit={PAGE_SIZE} offset={offset} total={journalApi.data?.total ?? 0} onChange={setOffset} />
                </>
              )}
            </div>
          )}

          {tab === 'accounts' && (
            <div className="stack">
              <div className="kpi-inline">
                {['asset', 'liability', 'equity', 'revenue', 'expense'].map((type) => {
                  const list = accounts.filter((a) => a.type === type);
                  const total = list.reduce((s, a) => s + Number(a.balance || 0), 0);
                  return (
                    <div className="item" key={type}>
                      <div className="label" style={{ textTransform: 'capitalize' }}>{type}</div>
                      <div className="value">{money(type === 'liability' || type === 'equity' || type === 'revenue' ? -total : total)}</div>
                    </div>
                  );
                })}
              </div>
              {accountsApi.loading && !accountsApi.data ? <LoadingBlock /> : (
                <>
                  {['asset', 'liability', 'equity', 'revenue', 'expense'].map((type) => {
                    const list = accounts.filter((a) => a.type === type);
                    if (!list.length) return null;
                    return (
                      <div key={type}>
                        <div className="section-title"><h3 style={{ textTransform: 'capitalize' }}>{type} accounts</h3><span className="tiny muted">{list.length} accounts</span></div>
                        <DataTable
                          rows={list}
                          columns={[
                            { key: 'code', header: 'Code', render: (r) => <span className="mono">{r.code}</span> },
                            { key: 'name', header: 'Account', render: (r) => <div><b>{r.name}</b>{r.parent_name && <div className="tiny muted">Under {r.parent_name}</div>}</div> },
                            { key: 'subtype', header: 'Subtype', render: (r) => r.subtype ? <Badge tone="neutral">{r.subtype.replaceAll('_', ' ')}</Badge> : <span className="muted">—</span> },
                            { key: 'balance', header: 'Balance', align: 'right', render: (r) => <span className={Number(r.balance) < 0 ? 'neg' : ''}>{money(r.balance)}</span> },
                            {
                              key: 'actions', header: '', align: 'right',
                              render: (r) => (
                                <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
                                  <Button size="sm" variant="ghost" icon={ListTree} onClick={() => setLedgerAccount(r.id)}>Ledger</Button>
                                  {canEditAccounts && <Button size="sm" variant="ghost" icon={Edit3} onClick={() => openAccount(r)}>Edit</Button>}
                                </div>
                              ),
                            },
                          ]}
                        />
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {(tab === 'trial-balance' || tab === 'pnl' || tab === 'cash-flow') && (
            <div className="toolbar" style={{ marginBottom: 14 }}>
              <div className="toolbar-left">
                <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
            </div>
          )}

          {tab === 'trial-balance' && (
            trialApi.loading && !trial ? <LoadingBlock /> : !trial ? <div className="muted">Unable to load trial balance.</div> : (
              <div className="stack">
                <DataTable
                  rows={trialRows}
                  dense
                  empty="No accounts"
                  columns={[
                    { key: 'code', header: 'Code', render: (r) => <span className="mono">{r.code}</span> },
                    { key: 'name', header: 'Account' },
                    { key: 'type', header: 'Type', render: (r) => <Badge tone="neutral">{r.type}</Badge> },
                    { key: 'debit', header: 'Debit', align: 'right', render: (r) => (Number(r.debit) ? money(r.debit) : '') },
                    { key: 'credit', header: 'Credit', align: 'right', render: (r) => (Number(r.credit) ? money(r.credit) : '') },
                    { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b className={Number(r.balance) < 0 ? 'neg' : ''}>{money(r.balance)}</b> },
                  ]}
                  footer={(
                    <tr>
                      <td colSpan={3}><b>Totals</b></td>
                      <td className="align-right"><b>{money(trial.total_debit)}</b></td>
                      <td className="align-right"><b>{money(trial.total_credit)}</b></td>
                      <td className="align-right">
                        {Math.abs(trial.total_debit - trial.total_credit) < 0.005
                          ? <Badge tone="success" dot>Balanced</Badge>
                          : <Badge tone="danger" dot>Out by {money(trial.total_debit - trial.total_credit)}</Badge>}
                      </td>
                    </tr>
                  )}
                />
              </div>
            )
          )}

          {tab === 'pnl' && (
            pnlApi.loading && !pnl ? <LoadingBlock /> : !pnl ? <div className="muted">Unable to load profit & loss.</div> : (
              <div className="stack">
                <div className="stat-grid">
                  <Stat label="Revenue" value={money(pnl.total_revenue)} sub="Net of returns" icon={TrendingUp} tone="brand" />
                  <Stat label="Cost of goods sold" value={money(pnl.cogs)} sub={`Gross margin ${pnl.total_revenue ? ((pnl.gross_profit / pnl.total_revenue) * 100).toFixed(1) : '0.0'}%`} icon={Layers} tone="info" />
                  <Stat label="Operating expenses" value={money(pnl.operating_expenses)} sub={`${pnl.expenses.length} expense account(s)`} icon={TrendingDown} tone="warning" />
                  <Stat label="Net profit" value={money(pnl.net_profit)} sub={`Margin ${pnl.total_revenue ? ((pnl.net_profit / pnl.total_revenue) * 100).toFixed(1) : '0.0'}%`} icon={Sparkles} tone={pnl.net_profit >= 0 ? 'purple' : 'danger'} />
                </div>
                <div className="grid grid-2">
                  <div>
                    <div className="section-title"><h3>Revenue</h3><span className="tiny muted">{money(pnl.total_revenue)}</span></div>
                    <DataTable
                      rows={pnl.revenue}
                      dense
                      empty="No revenue in this period"
                      columns={[
                        { key: 'code', header: 'Code', render: (r) => <span className="mono">{r.code}</span> },
                        { key: 'name', header: 'Account' },
                        { key: 'amount', header: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="section-title"><h3>Expenses</h3><span className="tiny muted">{money(pnl.total_expenses)}</span></div>
                    <DataTable
                      rows={pnl.expenses}
                      dense
                      empty="No expenses in this period"
                      columns={[
                        { key: 'code', header: 'Code', render: (r) => <span className="mono">{r.code}</span> },
                        { key: 'name', header: 'Account', render: (r) => <div><b>{r.name}</b>{r.subtype === 'cogs' && <span className="tiny muted"> · COGS</span>}</div> },
                        { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amount) },
                      ]}
                    />
                  </div>
                </div>
                <div className="pnl-summary">
                  <div className="pnl-box"><div className="label">Gross profit</div><div className="value">{money(pnl.gross_profit)}</div></div>
                  <div className="pnl-box"><div className="label">Net profit</div><div className={`value ${pnl.net_profit < 0 ? 'neg' : ''}`}>{money(pnl.net_profit)}</div></div>
                </div>
              </div>
            )
          )}

          {tab === 'balance-sheet' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <Field label="As of"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
                </div>
                <div className="toolbar-right">
                  {sheet && (Math.abs(sheet.difference) < 0.005
                    ? <Badge tone="success" dot>Balanced</Badge>
                    : <Badge tone="danger" dot>Out by {money(sheet.difference)}</Badge>)}
                </div>
              </div>
              {sheetApi.loading && !sheet ? <LoadingBlock /> : !sheet ? <div className="muted">Unable to load balance sheet.</div> : (
                <div className="grid grid-2">
                  <div>
                    <div className="section-title"><h3>Assets</h3><span className="tiny muted">{money(sheet.total_assets)}</span></div>
                    <DataTable
                      rows={sheet.assets}
                      dense
                      empty="No assets"
                      columns={[
                        { key: 'code', header: 'Code', render: (r) => <span className="mono">{r.code}</span> },
                        { key: 'name', header: 'Account' },
                        { key: 'amount', header: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="section-title"><h3>Liabilities & equity</h3><span className="tiny muted">{money(sheet.total_liabilities_equity)}</span></div>
                    <DataTable
                      rows={[...sheet.liabilities, ...sheet.equity]}
                      dense
                      empty="No liabilities or equity"
                      columns={[
                        { key: 'code', header: 'Code', render: (r) => (r.code ? <span className="mono">{r.code}</span> : <span className="muted">—</span>) },
                        { key: 'name', header: 'Account', render: (r) => <div><b>{r.name}</b>{r.subtype === 'earnings' && <div className="tiny muted">Current period</div>}</div> },
                        { key: 'amount', header: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
                      ]}
                    />
                    <div className="financial-total"><span>Total liabilities & equity</span><b>{money(sheet.total_liabilities_equity)}</b></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'cash-flow' && (
            cashFlowApi.loading && !flow ? <LoadingBlock /> : !flow ? <div className="muted">Unable to load cash flow.</div> : (
              <div className="stack">
                <div className="stat-grid">
                  <Stat label="Opening cash" value={money(flow.opening_cash)} sub={`As of ${date(flow.from)}`} icon={Wallet} tone="brand" />
                  <Stat label="Net change" value={money(flow.net_change)} sub="Operating + investing + financing" icon={ArrowLeftRight} tone={flow.net_change >= 0 ? 'success' : 'danger'} />
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

          {tab === 'expenses' && (
            <div className="stack">
              <div className="toolbar">
                <div className="toolbar-left">
                  <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                  <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                </div>
                <div className="toolbar-right"><Badge tone="neutral">Total {money(expensesApi.data?.total)}</Badge></div>
              </div>
              {expensesApi.loading && !expensesApi.data ? <LoadingBlock /> : (
                <DataTable
                  rows={expenses}
                  empty="No expenses in this period"
                  columns={[
                    { key: 'entry_date', header: 'Date', render: (r) => date(r.entry_date) },
                    { key: 'account_name', header: 'Expense account', render: (r) => <div><b>{r.account_name}</b><div className="tiny muted">{r.account_code}</div></div> },
                    { key: 'method_name', header: 'Paid via', render: (r) => <Badge tone="neutral">{r.method_name}</Badge> },
                    { key: 'reference', header: 'Reference', render: (r) => r.reference || <span className="muted">—</span> },
                    { key: 'notes', header: 'Notes', render: (r) => <span className="small muted">{r.notes || '—'}</span> },
                    { key: 'entry_no', header: 'Entry', render: (r) => r.entry_no ? <span className="mono">{r.entry_no}</span> : <span className="muted">—</span> },
                    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
                  ]}
                />
              )}
            </div>
          )}

          {tab === 'mappings' && (
            <div className="stack">
              <div className="info-note">
                <div>Mappings tell the posting engine which account each transaction type should use. Changing them affects all future postings.</div>
              </div>
              {mappingsApi.loading && !mappingsApi.data ? <LoadingBlock /> : (
                <div className="grid grid-2">
                  {mappings.map((m) => (
                    <div className="mapping-row" key={m.key}>
                      <div>
                        <div className="mapping-label">{MAPPING_LABELS[m.key] || m.key.replaceAll('_', ' ')}</div>
                        <div className="mapping-key mono">{m.key}</div>
                      </div>
                      <Select
                        value={mappingValues[m.key] ?? String(m.account_id)}
                        onChange={(e) => setMappingValues({ ...mappingValues, [m.key]: e.target.value })}
                        disabled={!canMapping}
                      >
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </Select>
                    </div>
                  ))}
                </div>
              )}
              {canMapping && <div><Button icon={Settings2} onClick={saveMappings} loading={mappingSaving}>Save mappings</Button></div>}
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={!!journalId}
        onClose={() => setJournalId(null)}
        title={journal ? journal.entry_no : 'Journal entry'}
        subtitle={journal ? `${date(journal.entry_date)} · ${journal.source_type?.replaceAll('_', ' ')}` : ''}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setJournalId(null)}>Close</Button>}
      >
        {journalDetail.loading && !journal ? <Spinner /> : !journal ? <div className="muted">Unable to load entry.</div> : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Memo</div><div className="value" style={{ fontSize: 13 }}>{journal.memo}</div></div>
              <div className="summary-box"><div className="label">Posted by</div><div className="value" style={{ fontSize: 13 }}>{journal.user_name || 'System'}</div></div>
              <div className="summary-box"><div className="label">Location</div><div className="value" style={{ fontSize: 13 }}>{journal.location_name || '—'}</div></div>
            </div>
            <DataTable
              rows={journal.lines}
              dense
              columns={[
                { key: 'account_code', header: 'Account', render: (r) => <div><span className="mono">{r.account_code}</span> · {r.account_name}</div> },
                { key: 'description', header: 'Description', render: (r) => <span className="small">{r.description || '—'}{r.customer_name ? ` · ${r.customer_name}` : ''}{r.supplier_name ? ` · ${r.supplier_name}` : ''}</span> },
                { key: 'debit', header: 'Debit', align: 'right', render: (r) => (Number(r.debit) ? money(r.debit) : '') },
                { key: 'credit', header: 'Credit', align: 'right', render: (r) => (Number(r.credit) ? money(r.credit) : '') },
              ]}
              footer={(
                <tr>
                  <td colSpan={2}><b>Totals</b></td>
                  <td className="align-right"><b>{money(journal.lines.reduce((s, l) => s + Number(l.debit), 0))}</b></td>
                  <td className="align-right"><b>{money(journal.lines.reduce((s, l) => s + Number(l.credit), 0))}</b></td>
                </tr>
              )}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={!!ledgerAccount}
        onClose={() => setLedgerAccount(null)}
        title={ledgerApi.data?.account ? `${ledgerApi.data.account.code} · ${ledgerApi.data.account.name}` : 'Account ledger'}
        subtitle={ledgerApi.data ? `${date(ledgerApi.data.from)} — ${date(ledgerApi.data.to)}` : ''}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setLedgerAccount(null)}>Close</Button>}
      >
        {ledgerApi.loading && !ledgerApi.data ? <Spinner /> : !ledgerApi.data ? <div className="muted">Unable to load ledger.</div> : (
          <div className="stack">
            <div className="grid grid-3">
              <div className="summary-box"><div className="label">Opening balance</div><div className="value">{money(ledgerApi.data.opening)}</div></div>
              <div className="summary-box"><div className="label">Closing balance</div><div className="value">{money(ledgerApi.data.closing)}</div></div>
              <div className="summary-box"><div className="label">Lines</div><div className="value">{number(ledgerApi.data.lines.length)}</div></div>
            </div>
            <DataTable
              rows={ledgerApi.data.lines}
              dense
              empty="No activity in this period"
              columns={[
                { key: 'entry_date', header: 'Date', render: (r) => date(r.entry_date) },
                { key: 'entry_no', header: 'Entry', render: (r) => <span className="mono">{r.entry_no}</span> },
                { key: 'description', header: 'Description', render: (r) => <span className="small">{r.description || r.memo}</span> },
                { key: 'debit', header: 'Debit', align: 'right', render: (r) => (Number(r.debit) ? money(r.debit) : '') },
                { key: 'credit', header: 'Credit', align: 'right', render: (r) => (Number(r.credit) ? money(r.credit) : '') },
                { key: 'balance', header: 'Balance', align: 'right', render: (r) => <b>{money(r.balance)}</b> },
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={accountsOpen}
        onClose={() => !accountSaving && setAccountsOpen(false)}
        title={accountEditId ? 'Edit account' : 'New account'}
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAccountsOpen(false)} disabled={accountSaving}>Cancel</Button>
            <Button icon={Scale} onClick={submitAccount} loading={accountSaving}>Save account</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitAccount}>
          {accountError && <div className="info-note danger">{accountError}</div>}
          <div className="grid grid-2">
            <Field label="Code"><Input value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} placeholder="6100" /></Field>
            <Field label="Name"><Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Account name" /></Field>
            <Field label="Type">
              <Select value={accountForm.type} onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value })}>
                {['asset', 'liability', 'equity', 'revenue', 'expense'].map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Subtype"><Input value={accountForm.subtype} onChange={(e) => setAccountForm({ ...accountForm, subtype: e.target.value })} placeholder="operating, cogs, bank…" /></Field>
            <Field label="Parent account">
              <Select value={accountForm.parent_id} onChange={(e) => setAccountForm({ ...accountForm, parent_id: e.target.value })}>
                <option value="">No parent</option>
                {accounts.filter((a) => a.id !== accountEditId).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </Select>
            </Field>
            <label className="checkbox" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={accountForm.is_active} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <Field label="Description"><Textarea value={accountForm.description} onChange={(e) => setAccountForm({ ...accountForm, description: e.target.value })} rows={2} /></Field>
        </form>
      </Modal>

      <Modal
        open={manualOpen}
        onClose={() => !manualSaving && setManualOpen(false)}
        title="Manual journal entry"
        subtitle="Debits must equal credits; the entry is immutable once posted."
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setManualOpen(false)} disabled={manualSaving}>Cancel</Button>
            <Button icon={BookOpen} onClick={submitManual} loading={manualSaving} disabled={Math.abs(manualDebit - manualCredit) > 0.005}>Post entry</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitManual}>
          {manualError && <div className="info-note danger">{manualError}</div>}
          <div className="grid grid-3">
            <Field label="Date"><Input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></Field>
            <Field label="Location">
              <Select value={manual.location_id} onChange={(e) => setManual({ ...manual, location_id: e.target.value })}>
                <option value="">No location</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Memo" className="grid-span-1"><Input value={manual.memo} onChange={(e) => setManual({ ...manual, memo: e.target.value })} placeholder="What is this entry for?" /></Field>
          </div>
          <div className="section-title">
            <h3>Lines</h3>
            <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={() => setManual((m) => ({ ...m, lines: [...m.lines, blankLine()] }))}>Add line</Button>
          </div>
          <div className="journal-lines">
            {manual.lines.map((line, index) => (
              <div className="journal-line" key={index}>
                <Select value={line.account_id} onChange={(e) => updateManualLine(index, { account_id: e.target.value })}>
                  <option value="">Choose account</option>
                  {accounts.filter((a) => a.is_active !== false).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </Select>
                <Input value={line.description} onChange={(e) => updateManualLine(index, { description: e.target.value })} placeholder="Description" />
                <Input value={line.debit} onChange={(e) => updateManualLine(index, { debit: e.target.value, credit: e.target.value ? '' : line.credit })} inputMode="decimal" placeholder="Debit" />
                <Input value={line.credit} onChange={(e) => updateManualLine(index, { credit: e.target.value, debit: e.target.value ? '' : line.debit })} inputMode="decimal" placeholder="Credit" />
                <IconButton icon={Trash2} label="Remove line" onClick={() => setManual((m) => ({ ...m, lines: m.lines.filter((_, i) => i !== index) }))} disabled={manual.lines.length <= 2} />
              </div>
            ))}
          </div>
          <div className="journal-total">
            <div className="sum-row"><span>Total debits</span><b>{money(manualDebit)}</b></div>
            <div className="sum-row"><span>Total credits</span><b>{money(manualCredit)}</b></div>
            <div className="sum-row"><span>Difference</span><b className={Math.abs(manualDebit - manualCredit) > 0.005 ? 'neg' : ''}>{money(manualDebit - manualCredit)}</b></div>
          </div>
        </form>
      </Modal>

      <Modal
        open={expenseOpen}
        onClose={() => !expenseSaving && setExpenseOpen(false)}
        title="Record expense"
        subtitle="Debits the expense account and credits cash, bank or a clearing account."
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setExpenseOpen(false)} disabled={expenseSaving}>Cancel</Button>
            <Button icon={Receipt} onClick={submitExpense} loading={expenseSaving}>Post expense</Button>
          </>
        )}
      >
        <form className="stack" onSubmit={submitExpense}>
          {expenseError && <div className="info-note danger">{expenseError}</div>}
          <div className="grid grid-2">
            <Field label="Expense account">
              <Select value={expense.account_id} onChange={(e) => setExpense({ ...expense, account_id: e.target.value })}>
                <option value="">Choose account</option>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </Select>
            </Field>
            <Field label="Amount"><Input value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} inputMode="decimal" placeholder="0.00" /></Field>
            <Field label="Payment method">
              <Select value={expense.method_id} onChange={(e) => setExpense({ ...expense, method_id: e.target.value })}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.type}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} /></Field>
            {method?.type === 'cash' && (
              <Field label="Cash drawer" hint={openSessions.length ? 'Cash expense reduces the drawer' : 'No open drawer'}>
                <Select value={expense.session_id} onChange={(e) => setExpense({ ...expense, session_id: e.target.value })}>
                  <option value="">Choose drawer</option>
                  {openSessions.map((s) => <option key={s.id} value={s.id}>{s.register_name} · {s.cashier_name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Reference"><Input value={expense.reference} onChange={(e) => setExpense({ ...expense, reference: e.target.value })} placeholder="Invoice / receipt no" /></Field>
          </div>
          <Field label="Notes"><Textarea value={expense.notes} onChange={(e) => setExpense({ ...expense, notes: e.target.value })} rows={2} /></Field>
        </form>
      </Modal>
    </div>
  );
}
