import { query } from '../db/index.js';
import { getMappings } from './accounting.js';
import { arAging, apAging } from './reports.js';
import { num, round2, todayISO, firstOfMonthISO } from '../utils.js';

async function salesStats(from, to) {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS transactions,
       COALESCE(SUM(s.total),0) AS total,
       COALESCE(SUM(s.subtotal),0) AS subtotal,
       COALESCE(SUM(s.tax),0) AS tax,
       COALESCE(SUM(s.discount),0) AS discount,
       COALESCE(SUM(s.paid),0) AS paid,
       COALESCE(SUM(s.due),0) AS due,
       COALESCE((SELECT SUM(si.cost_total) FROM sale_items si JOIN sales s2 ON s2.id = si.sale_id
                 WHERE s2.status <> 'voided' AND s2.created_at >= $1::date AND s2.created_at < ($2::date + interval '1 day')),0) AS cogs,
       COALESCE((SELECT SUM(r.total) FROM sale_returns r
                 WHERE r.created_at >= $1::date AND r.created_at < ($2::date + interval '1 day')),0) AS returns,
       COALESCE((SELECT SUM(ri.cost_total) FROM return_items ri JOIN sale_returns r ON r.id = ri.return_id
                 WHERE r.created_at >= $1::date AND r.created_at < ($2::date + interval '1 day')),0) AS returned_cogs,
       COALESCE((SELECT COUNT(*) FROM sale_returns r
                 WHERE r.created_at >= $1::date AND r.created_at < ($2::date + interval '1 day')),0)::int AS return_count
     FROM sales s
     WHERE s.status <> 'voided' AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')`,
    [from, to]
  );
  const r = rows[0];
  const revenue = round2(num(r.subtotal) - num(r.discount) - num(r.returns));
  const cost = round2(num(r.cogs) - num(r.returned_cogs));
  return {
    ...r,
    revenue,
    cogs: cost,
    gross_profit: round2(revenue - cost),
    average_ticket: r.transactions > 0 ? round2(num(r.total) / r.transactions) : 0,
    margin: revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0,
  };
}

async function expenseStats(from, to) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS total
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.type = 'expense' AND a.subtype = 'cogs' AND je.entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const { rows: opex } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS total
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.type = 'expense' AND a.subtype <> 'cogs' AND je.entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  return { cogs: num(rows[0].total), operating: num(opex[0].total), total: round2(num(rows[0].total) + num(opex[0].total)) };
}

export async function dashboard(user, view = null) {
  const allowedViews = user.role === 'cashier'
    ? ['cashier']
    : user.role === 'accountant'
      ? ['executive', 'finance']
      : ['executive', 'operations', 'finance', 'cashier'];
  const requested = view || (user.role === 'cashier' ? 'cashier' : user.role === 'accountant' ? 'finance' : 'executive');
  const activeView = allowedViews.includes(requested) ? requested : allowedViews[0];

  const today = todayISO();
  const monthStart = firstOfMonthISO(today);
  const maps = await getMappings({ query: (t, p) => query(t, p) });
  const cashierOnly = activeView === 'cashier';

  const [
    todayStats, monthStats, monthExpenses, trend, paymentMix, topProducts, categoryMix,
    recentSales, lowStock, openSessions, cashAccounts, arBalance, apBalance, inventoryValue,
    taxPayable, ar, ap, hourly, staff, journalBalance, varianceAlerts,
  ] = await Promise.all([
    salesStats(today, today),
    salesStats(monthStart, today),
    expenseStats(monthStart, today),
    query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(x.total,0) AS total,
              COALESCE(x.transactions,0)::int AS transactions
       FROM generate_series(CURRENT_DATE - interval '13 days', CURRENT_DATE, interval '1 day') AS d(day)
       LEFT JOIN (
         SELECT created_at::date AS day, SUM(total) AS total, COUNT(*) AS transactions
         FROM sales WHERE status <> 'voided' AND created_at >= CURRENT_DATE - interval '13 days'
         GROUP BY 1
       ) x ON x.day = d.day::date ORDER BY d.day`
    ),
    query(
      `SELECT pm.name, pm.type, COALESCE(SUM(p.amount),0) AS amount
       FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
       JOIN sales s ON s.id = p.sale_id
       WHERE p.type = 'sale' AND s.status <> 'voided'
         AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')
       GROUP BY pm.id ORDER BY amount DESC`,
      [monthStart, today]
    ),
    query(
      `SELECT p.id, p.name, p.sku, SUM(si.quantity) AS quantity,
              ROUND(SUM(si.line_total - si.tax_amount),2) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE s.status <> 'voided' AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')
       GROUP BY p.id ORDER BY revenue DESC LIMIT 6`,
      [monthStart, today]
    ),
    query(
      `SELECT COALESCE(c.name,'Uncategorised') AS name, ROUND(SUM(si.line_total - si.tax_amount),2) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.status <> 'voided' AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`,
      [monthStart, today]
    ),
    query(
      `SELECT s.id, s.invoice_no, s.total, s.status, s.created_at, s.paid, s.due,
              COALESCE(c.name,'Walk-in customer') AS customer_name, u.name AS cashier_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.user_id
       ${cashierOnly ? 'WHERE s.user_id = $1' : ''}
       ORDER BY s.created_at DESC, s.id DESC LIMIT 8`,
      cashierOnly ? [user.id] : []
    ),
    query(
      `SELECT p.id, p.name, p.sku, i.location_id, l.name AS location_name, i.quantity, p.reorder_level
       FROM inventory i JOIN products p ON p.id = i.product_id JOIN locations l ON l.id = i.location_id
       WHERE p.track_inventory = true AND i.quantity <= p.reorder_level
       ORDER BY (i.quantity - p.reorder_level) ASC LIMIT 8`
    ),
    query(
      `SELECT cs.id, cs.opened_at, cs.opening_float, cs.user_id, r.name AS register_name, l.name AS location_name,
              u.name AS cashier_name,
              ROUND(cs.opening_float + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.session_id = cs.id),0),2) AS expected_cash
       FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id
       JOIN locations l ON l.id = r.location_id JOIN users u ON u.id = cs.user_id
       WHERE cs.status = 'open' ORDER BY cs.opened_at`
    ),
    query(
      `SELECT a.id, a.code, a.name, a.subtype,
              ROUND(COALESCE(SUM(jl.debit - jl.credit),0),2) AS balance
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.entry_date <= $1
       WHERE a.subtype IN ('cash','bank','clearing')
       GROUP BY a.id HAVING COALESCE(SUM(jl.debit - jl.credit),0) <> 0
       ORDER BY a.code`,
      [today]
    ),
    query(
      `SELECT ROUND(COALESCE(SUM(jl.debit - jl.credit),0),2) AS balance
       FROM journal_lines jl WHERE jl.account_id = $1`,
      [maps.ar]
    ),
    query(
      `SELECT ROUND(COALESCE(SUM(jl.credit - jl.debit),0),2) AS balance
       FROM journal_lines jl WHERE jl.account_id = $1`,
      [maps.ap]
    ),
    query('SELECT ROUND(COALESCE(SUM(quantity * avg_cost),0),2) AS value FROM inventory'),
    query(
      `SELECT ROUND(COALESCE(SUM(jl.credit - jl.debit),0),2) AS balance
       FROM journal_lines jl WHERE jl.account_id = $1`,
      [maps.tax_payable]
    ),
    arAging(),
    apAging(),
    query(
      `SELECT EXTRACT(HOUR FROM s.created_at)::int AS hour, COUNT(*)::int AS transactions, COALESCE(SUM(s.total),0) AS total
       FROM sales s WHERE s.status <> 'voided' AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')
       GROUP BY 1 ORDER BY 1`,
      [today, today]
    ),
    query(
      `SELECT u.id, u.name, COUNT(s.id)::int AS transactions, COALESCE(SUM(s.total),0) AS total
       FROM users u JOIN sales s ON s.user_id = u.id AND s.status <> 'voided'
         AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')
       GROUP BY u.id ORDER BY total DESC LIMIT 6`,
      [today, today]
    ),
    query(
      `SELECT ROUND(COALESCE(SUM(jl.debit),0),2) AS debit, ROUND(COALESCE(SUM(jl.credit),0),2) AS credit
       FROM journal_lines jl`
    ),
    query(
      `SELECT cs.id, cs.register_id, r.name AS register_name, cs.variance, cs.closed_at
       FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id
       WHERE cs.status = 'closed' AND cs.variance <> 0 ORDER BY cs.closed_at DESC LIMIT 5`
    ),
  ]);

  let cashierSession = null;
  let cashierToday = null;
  if (activeView === 'cashier') {
    const { rows: sess } = await query(
      `SELECT cs.*, r.name AS register_name, l.name AS location_name,
              ROUND(cs.opening_float + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.session_id = cs.id),0),2) AS expected_cash
       FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id JOIN locations l ON l.id = r.location_id
       WHERE cs.user_id = $1 AND cs.status = 'open' ORDER BY cs.opened_at DESC LIMIT 1`,
      [user.id]
    );
    cashierSession = sess[0] || null;
    const stats = await salesStats(today, today);
    const { rows: mine } = await query(
      `SELECT COUNT(*)::int AS transactions, COALESCE(SUM(total),0) AS total,
              COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(discount),0) AS discount
       FROM sales WHERE user_id = $1 AND status <> 'voided' AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
      [user.id, today, today]
    );
    cashierToday = { ...stats, ...mine, sales: num(mine[0].total) };
  }

  const cashTotal = round2(cashAccounts.rows.reduce((s, a) => s + num(a.balance), 0));
  const arTotal = num(arBalance.rows[0].balance);
  const apTotal = num(apBalance.rows[0].balance);
  const overdueAr = round2(ar.reduce((s, r) => s + num(r.days_31_60) + num(r.days_61_90) + num(r.days_90_plus), 0));
  const overdueAp = round2(ap.reduce((s, r) => s + num(r.days_31_60) + num(r.days_61_90) + num(r.days_90_plus), 0));
  const ledgerBalanced = Math.abs(num(journalBalance.rows[0].debit) - num(journalBalance.rows[0].credit)) < 0.01;

  const alerts = [];
  if (!ledgerBalanced) alerts.push({ severity: 'critical', type: 'ledger', title: 'Ledger out of balance', detail: 'Debits and credits do not match. Investigate immediately.' });
  if (lowStock.rows.length) alerts.push({ severity: 'warning', type: 'stock', title: `${lowStock.rows.length} item(s) at or below reorder level`, detail: lowStock.rows.map((i) => i.name).slice(0, 3).join(', ') });
  if (overdueAr > 0) alerts.push({ severity: 'warning', type: 'ar', title: 'Overdue receivables', detail: `Over 30 days: ${overdueAr.toFixed(2)}` });
  if (overdueAp > 0) alerts.push({ severity: 'info', type: 'ap', title: 'Overdue payables', detail: `Over 30 days: ${overdueAp.toFixed(2)}` });
  if (varianceAlerts.rows.length) alerts.push({ severity: 'info', type: 'cash', title: 'Recent cash drawer variances', detail: `${varianceAlerts.rows.length} closed session(s) with a difference.` });
  if (!openSessions.rows.length) alerts.push({ severity: 'info', type: 'cash', title: 'No open cash drawers', detail: 'Open a counter session to start taking cash.' });

  return {
    view: activeView,
    allowed_views: allowedViews,
    generated_at: new Date().toISOString(),
    dates: { today, month_start: monthStart },
    kpis: {
      today_sales: num(todayStats.total),
      today_transactions: todayStats.transactions,
      today_profit: todayStats.gross_profit,
      today_average_ticket: todayStats.average_ticket,
      month_sales: num(monthStats.total),
      month_profit: monthStats.gross_profit,
      month_expenses: monthExpenses.total,
      month_net_profit: round2(monthStats.revenue - monthExpenses.total),
      month_transactions: monthStats.transactions,
      cash_position: cashTotal,
      receivables: arTotal,
      payables: apTotal,
      inventory_value: num(inventoryValue.rows[0].value),
      tax_payable: num(taxPayable.rows[0].balance),
      open_drawers: openSessions.rows.length,
      low_stock_count: lowStock.rows.length,
      overall_margin: monthStats.margin,
    },
    today: todayStats,
    month: { ...monthStats, expenses: monthExpenses },
    cashier: {
      session: cashierSession,
      today: cashierToday,
    },
    charts: {
      sales_trend: trend.rows,
      payment_mix: paymentMix.rows,
      top_products: topProducts.rows,
      category_mix: categoryMix.rows,
      hourly_today: hourly.rows,
    },
    finance: {
      cash_accounts: cashAccounts.rows,
      ar_aging: ar.rows,
      ap_aging: ap.rows,
      ledger_balanced: ledgerBalanced,
      trial_debits: num(journalBalance.rows[0].debit),
      trial_credits: num(journalBalance.rows[0].credit),
      paid_this_month: monthStats.paid,
      overdue_receivables: overdueAr,
      overdue_payables: overdueAp,
    },
    operations: {
      open_sessions: openSessions.rows,
      low_stock: lowStock.rows,
      recent_sales: recentSales.rows,
      staff_today: staff.rows,
      returns_today: todayStats.return_count,
    },
    alerts,
  };
}
