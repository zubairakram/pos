import { query } from '../db/index.js';
import { getMappings } from './accounting.js';
import { num, round2 } from '../utils.js';

const SALE_FILTER = "s.status <> 'voided' AND s.created_at >= $1::date AND s.created_at < ($2::date + interval '1 day')";
const RETURN_FILTER = "r.created_at >= $1::date AND r.created_at < ($2::date + interval '1 day')";

export async function salesSummary({ from, to, group = 'day' }) {
  const unit = group === 'month' ? 'month' : group === 'hour' ? 'hour' : 'day';
  const [{ rows }, { rows: returns }, { rows: totals }] = await Promise.all([
    query(
      `SELECT to_char(date_trunc($3, s.created_at), 'YYYY-MM-DD HH24:00') AS period,
              COUNT(*)::int AS transactions,
              COALESCE(SUM(s.subtotal),0) AS subtotal,
              COALESCE(SUM(s.discount),0) AS discount,
              COALESCE(SUM(s.tax),0) AS tax,
              COALESCE(SUM(s.total),0) AS total,
              COALESCE(SUM(s.paid),0) AS paid,
              COALESCE(SUM(s.due),0) AS due
       FROM sales s WHERE ${SALE_FILTER}
       GROUP BY 1 ORDER BY 1`,
      [from, to, unit]
    ),
    query(
      `SELECT to_char(date_trunc($3, r.created_at), 'YYYY-MM-DD HH24:00') AS period,
              COUNT(*)::int AS returns, COALESCE(SUM(r.total),0) AS refunded
       FROM sale_returns r WHERE ${RETURN_FILTER} GROUP BY 1 ORDER BY 1`,
      [from, to, unit]
    ),
    query(
      `SELECT
         (SELECT COUNT(*)::int FROM sales s WHERE ${SALE_FILTER}) AS transactions,
         (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE ${SALE_FILTER}) AS total,
         (SELECT COALESCE(SUM(s.subtotal),0) FROM sales s WHERE ${SALE_FILTER}) AS subtotal,
         (SELECT COALESCE(SUM(s.discount),0) FROM sales s WHERE ${SALE_FILTER}) AS discount,
         (SELECT COALESCE(SUM(s.tax),0) FROM sales s WHERE ${SALE_FILTER}) AS tax,
         (SELECT COALESCE(SUM(s.due),0) FROM sales s WHERE ${SALE_FILTER}) AS due,
         (SELECT COALESCE(SUM(r.total),0) FROM sale_returns r WHERE ${RETURN_FILTER}) AS returns,
         (SELECT COALESCE(SUM(si.cost_total),0) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${SALE_FILTER}) AS cogs,
         (SELECT COALESCE(SUM(ri.cost_total),0) FROM return_items ri JOIN sale_returns r ON r.id = ri.return_id WHERE ${RETURN_FILTER}) AS returned_cogs`,
      [from, to]
    ),
  ]);

  const t = totals[0];
  const revenue = round2(num(t.subtotal) - num(t.discount) - num(t.returns));
  const cost = round2(num(t.cogs) - num(t.returned_cogs));
  return {
    series: rows,
    returns_series: returns,
    totals: {
      ...t,
      revenue,
      net_sales: round2(num(t.total) - num(t.returns)),
      cogs: cost,
      gross_profit: round2(revenue - cost),
      gross_margin: revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : 0,
      average_ticket: t.transactions > 0 ? round2(num(t.total) / t.transactions) : 0,
    },
  };
}

export async function salesByProduct({ from, to, limit = 100 }) {
  const { rows } = await query(
    `WITH sold AS (
       SELECT si.product_id, SUM(si.quantity) AS quantity, SUM(si.line_total - si.tax_amount) AS net,
              SUM(si.cost_total) AS cost, SUM(si.line_total) AS gross
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${SALE_FILTER} GROUP BY si.product_id
     ), returned AS (
       SELECT ri.product_id, SUM(ri.quantity) AS quantity, SUM(ri.line_total - ri.tax_amount) AS net,
              SUM(ri.cost_total) AS cost, SUM(ri.line_total) AS gross
       FROM return_items ri JOIN sale_returns r ON r.id = ri.return_id
       WHERE ${RETURN_FILTER} GROUP BY ri.product_id
     )
     SELECT p.id, p.name, p.sku, c.name AS category,
            COALESCE(sold.quantity,0) - COALESCE(returned.quantity,0) AS quantity,
            ROUND(COALESCE(sold.net,0) - COALESCE(returned.net,0), 2) AS revenue,
            ROUND(COALESCE(sold.cost,0) - COALESCE(returned.cost,0), 2) AS cost,
            ROUND((COALESCE(sold.net,0) - COALESCE(returned.net,0)) - (COALESCE(sold.cost,0) - COALESCE(returned.cost,0)), 2) AS profit
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sold ON sold.product_id = p.id
     LEFT JOIN returned ON returned.product_id = p.id
     WHERE sold.product_id IS NOT NULL OR returned.product_id IS NOT NULL
     ORDER BY revenue DESC LIMIT $3`,
    [from, to, Math.min(Number(limit) || 100, 500)]
  );
  return rows;
}

export async function salesByCategory({ from, to }) {
  const { rows } = await query(
    `WITH sold AS (
       SELECT p.category_id, SUM(si.quantity) qty, SUM(si.line_total - si.tax_amount) net, SUM(si.cost_total) cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE ${SALE_FILTER} GROUP BY p.category_id
     ), returned AS (
       SELECT p.category_id, SUM(ri.quantity) qty, SUM(ri.line_total - ri.tax_amount) net, SUM(ri.cost_total) cost
       FROM return_items ri JOIN sale_returns r ON r.id = ri.return_id JOIN products p ON p.id = ri.product_id
       WHERE ${RETURN_FILTER} GROUP BY p.category_id
     )
     SELECT COALESCE(c.name, 'Uncategorised') AS name,
            ROUND(COALESCE(sold.qty,0) - COALESCE(returned.qty,0), 3) AS quantity,
            ROUND(COALESCE(sold.net,0) - COALESCE(returned.net,0), 2) AS revenue,
            ROUND(COALESCE(sold.cost,0) - COALESCE(returned.cost,0), 2) AS cost
     FROM (SELECT DISTINCT category_id FROM products) cats
     LEFT JOIN categories c ON c.id = cats.category_id
     LEFT JOIN sold ON sold.category_id IS NOT DISTINCT FROM cats.category_id
     LEFT JOIN returned ON returned.category_id IS NOT DISTINCT FROM cats.category_id
     ORDER BY revenue DESC NULLS LAST`,
    [from, to]
  );
  return rows;
}

export async function salesByCashier({ from, to }) {
  const { rows } = await query(
    `SELECT u.id, u.name, COUNT(s.id)::int AS transactions,
            COALESCE(SUM(s.total),0) AS total, COALESCE(SUM(s.discount),0) AS discount,
            COALESCE(SUM(s.paid),0) AS collected,
            CASE WHEN COUNT(s.id) > 0 THEN ROUND(SUM(s.total) / COUNT(s.id), 2) ELSE 0 END AS average_ticket
     FROM users u LEFT JOIN sales s ON s.user_id = u.id AND ${SALE_FILTER}
     GROUP BY u.id ORDER BY total DESC`,
    [from, to]
  );
  return rows;
}

export async function salesByLocation({ from, to }) {
  const { rows } = await query(
    `SELECT l.id, l.name, l.code, COUNT(s.id)::int AS transactions, COALESCE(SUM(s.total),0) AS total,
            COALESCE(SUM(s.tax),0) AS tax, COALESCE(SUM(s.discount),0) AS discount
     FROM locations l LEFT JOIN sales s ON s.location_id = l.id AND ${SALE_FILTER}
     GROUP BY l.id ORDER BY total DESC`,
    [from, to]
  );
  return rows;
}

export async function paymentMethodReport({ from, to }) {
  const { rows } = await query(
    `SELECT pm.id, pm.name, pm.type,
            COALESCE(SUM(CASE WHEN p.type = 'sale' THEN p.amount ELSE 0 END),0) AS collected,
            COUNT(CASE WHEN p.type = 'sale' THEN 1 END)::int AS payments,
            COALESCE(SUM(CASE WHEN p.type = 'refund' THEN p.amount ELSE 0 END),0) AS refunded
     FROM payment_methods pm
     LEFT JOIN payments p ON p.method_id = pm.id AND p.created_at >= $1::date AND p.created_at < ($2::date + interval '1 day')
       AND p.type IN ('sale','refund')
     GROUP BY pm.id ORDER BY collected DESC`,
    [from, to]
  );
  return rows;
}

export async function taxReport({ from, to }) {
  const { rows } = await query(
    `WITH sold AS (
       SELECT si.tax_rate, SUM(si.tax_amount) tax, SUM(si.line_total - si.tax_amount) net
       FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${SALE_FILTER} GROUP BY si.tax_rate
     ), returned AS (
       SELECT ri.tax_amount, si.tax_rate FROM return_items ri
       JOIN sale_returns r ON r.id = ri.return_id JOIN sale_items si ON si.id = ri.sale_item_id
       WHERE ${RETURN_FILTER}
     ), returned_agg AS (
       SELECT tax_rate, SUM(tax_amount) tax FROM returned GROUP BY tax_rate
     )
     SELECT COALESCE(sold.tax_rate, returned_agg.tax_rate, 0) AS rate,
            ROUND(COALESCE(sold.net,0),2) AS net_sales,
            ROUND(COALESCE(sold.tax,0),2) AS output_tax,
            ROUND(COALESCE(returned_agg.tax,0),2) AS tax_reversed,
            ROUND(COALESCE(sold.tax,0) - COALESCE(returned_agg.tax,0),2) AS net_tax
     FROM sold FULL OUTER JOIN returned_agg ON returned_agg.tax_rate = sold.tax_rate
     ORDER BY rate`,
    [from, to]
  );
  const { rows: purchases } = await query(
    `SELECT COALESCE(SUM(pi.tax_amount),0) AS input_tax
     FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
     WHERE p.created_at >= $1::date AND p.created_at < ($2::date + interval '1 day') AND p.status <> 'voided'`,
    [from, to]
  );
  const outputTax = round2(rows.reduce((s, r) => s + num(r.net_tax), 0));
  return { rows, output_tax: outputTax, input_tax: num(purchases[0].input_tax), net_due: round2(outputTax - num(purchases[0].input_tax)) };
}

export async function hourlySales({ from, to }) {
  const { rows } = await query(
    `SELECT EXTRACT(HOUR FROM s.created_at)::int AS hour, COUNT(*)::int AS transactions,
            COALESCE(SUM(s.total),0) AS total
     FROM sales s WHERE ${SALE_FILTER} GROUP BY 1 ORDER BY 1`,
    [from, to]
  );
  return rows;
}

export async function inventoryValuation({ location_id } = {}) {
  const params = [];
  let filter = '';
  if (location_id) {
    params.push(Number(location_id));
    filter = 'AND i.location_id = $1';
  }
  const { rows } = await query(
    `SELECT p.id, p.sku, p.name, c.name AS category, l.name AS location,
            i.quantity, i.avg_cost,
            ROUND(i.quantity * i.avg_cost, 2) AS cost_value,
            ROUND(i.quantity * p.sale_price, 2) AS retail_value,
            p.reorder_level,
            CASE WHEN p.track_inventory AND i.quantity <= p.reorder_level THEN true ELSE false END AS low_stock
     FROM inventory i JOIN products p ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     JOIN locations l ON l.id = i.location_id
     WHERE p.is_active = true ${filter}
     ORDER BY cost_value DESC`,
    params
  );
  const totals = rows.reduce((a, r) => ({
    quantity: round2(a.quantity + num(r.quantity)),
    cost_value: round2(a.cost_value + num(r.cost_value)),
    retail_value: round2(a.retail_value + num(r.retail_value)),
    low_stock: a.low_stock + (r.low_stock ? 1 : 0),
  }), { quantity: 0, cost_value: 0, retail_value: 0, low_stock: 0 });
  return { rows, totals };
}

export async function stockMovements({ product_id, from, to, limit = 200 }) {
  const params = [];
  const where = [];
  if (product_id) { params.push(Number(product_id)); where.push(`sm.product_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`sm.created_at >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`sm.created_at < ($${params.length}::date + interval '1 day')`); }
  params.push(Math.min(Number(limit) || 200, 500));
  const { rows } = await query(
    `SELECT sm.*, p.name AS product_name, p.sku, l.name AS location_name, u.name AS user_name
     FROM stock_moves sm JOIN products p ON p.id = sm.product_id
     JOIN locations l ON l.id = sm.location_id LEFT JOIN users u ON u.id = sm.user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY sm.created_at DESC, sm.id DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function trialBalance({ from, to }) {
  const { rows } = await query(
    `SELECT a.id, a.code, a.name, a.type, a.subtype, a.is_system,
            COALESCE(agg.debit,0) AS debit, COALESCE(agg.credit,0) AS credit
     FROM accounts a
     LEFT JOIN (
       SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.entry_date BETWEEN $1 AND $2
       GROUP BY jl.account_id
     ) agg ON agg.account_id = a.id
     WHERE a.is_active = true
     ORDER BY a.code`,
    [from, to]
  );
  const withBalance = rows.map((r) => ({
    ...r,
    balance: round2(num(r.debit) - num(r.credit)),
    debit: round2(num(r.debit)),
    credit: round2(num(r.credit)),
  }));
  return {
    rows: withBalance,
    total_debit: round2(withBalance.reduce((s, r) => s + r.debit, 0)),
    total_credit: round2(withBalance.reduce((s, r) => s + r.credit, 0)),
  };
}

export async function accountLedger(accountId, { from, to }) {
  const { rows } = await query(
    `SELECT je.entry_date, je.entry_no, je.memo, je.source_type, je.id AS entry_id,
            jl.description, jl.debit, jl.credit, jl.customer_id, jl.supplier_id
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = $1 AND je.entry_date BETWEEN $2 AND $3
     ORDER BY je.entry_date, je.id, jl.id`,
    [accountId, from, to]
  );
  const { rows: openingRows } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS opening
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = $1 AND je.entry_date < $2`,
    [accountId, from]
  );
  let balance = num(openingRows[0].opening);
  const lines = rows.map((r) => {
    balance = round2(balance + num(r.debit) - num(r.credit));
    return { ...r, debit: num(r.debit), credit: num(r.credit), balance };
  });
  return { opening: round2(num(openingRows[0].opening)), closing: balance, lines };
}

export async function profitAndLoss({ from, to }) {
  const { rows } = await query(
    `SELECT a.id, a.code, a.name, a.type, a.subtype,
            COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
     FROM accounts a
     JOIN journal_lines jl ON jl.account_id = a.id
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE a.type IN ('revenue','expense') AND je.entry_date BETWEEN $1 AND $2
     GROUP BY a.id ORDER BY a.code`,
    [from, to]
  );
  const revenue = [];
  const expenses = [];
  for (const r of rows) {
    const amount = r.type === 'revenue'
      ? round2(num(r.credit) - num(r.debit))
      : round2(num(r.debit) - num(r.credit));
    if (amount === 0) continue;
    (r.type === 'revenue' ? revenue : expenses).push({
      id: r.id, code: r.code, name: r.name, subtype: r.subtype, amount,
    });
  }
  const totalRevenue = round2(revenue.reduce((s, r) => s + r.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
  const cogs = round2(expenses.filter((e) => e.subtype === 'cogs').reduce((s, e) => s + e.amount, 0));
  const operating = round2(totalExpenses - cogs);
  return {
    revenue, expenses, cogs, operating_expenses: operating,
    total_revenue: totalRevenue, total_expenses: totalExpenses,
    gross_profit: round2(totalRevenue - cogs),
    net_profit: round2(totalRevenue - totalExpenses),
  };
}

export async function balanceSheet({ asOf }) {
  const { rows } = await query(
    `SELECT a.id, a.code, a.name, a.type, a.subtype,
            COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.entry_date <= $1
     GROUP BY a.id ORDER BY a.code`,
    [asOf]
  );
  // Recalculate from lines inside the date, ignoring lines joined to entries outside the date.
  const { rows: dated } = await query(
    `SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.entry_date <= $1 GROUP BY jl.account_id`,
    [asOf]
  );
  const byAccount = new Map(dated.map((r) => [r.account_id, r]));
  const assets = [];
  const liabilities = [];
  const equity = [];
  let revenueTotal = 0;
  let expenseTotal = 0;
  for (const a of rows) {
    const agg = byAccount.get(a.id);
    if (!agg) continue;
    const netDebit = round2(num(agg.debit) - num(agg.credit));
    if (a.type === 'asset') {
      if (netDebit !== 0) assets.push({ ...a, amount: netDebit });
    } else if (a.type === 'liability') {
      const amount = round2(-netDebit);
      if (amount !== 0) liabilities.push({ ...a, amount });
    } else if (a.type === 'equity') {
      const amount = round2(-netDebit);
      if (amount !== 0) equity.push({ ...a, amount });
    } else if (a.type === 'revenue') revenueTotal = round2(revenueTotal - netDebit);
    else if (a.type === 'expense') expenseTotal = round2(expenseTotal + netDebit);
  }
  const netIncome = round2(revenueTotal - expenseTotal);
  const totalAssets = round2(assets.reduce((s, a) => s + a.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, a) => s + a.amount, 0));
  const totalEquity = round2(equity.reduce((s, a) => s + a.amount, 0) + netIncome);
  return {
    assets, liabilities, equity: [
      ...equity,
      ...(netIncome !== 0 ? [{ id: null, code: '', name: 'Current year earnings', subtype: 'earnings', amount: netIncome }] : []),
    ],
    revenue_total: revenueTotal, expense_total: expenseTotal, net_income: netIncome,
    total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity,
    total_liabilities_equity: round2(totalLiabilities + totalEquity),
    difference: round2(totalAssets - totalLiabilities - totalEquity),
    as_of: asOf,
  };
}

async function cashAccountIds() {
  const { rows } = await query(
    `SELECT DISTINCT account_id FROM payment_methods
     UNION SELECT DISTINCT account_id FROM cash_registers
     UNION SELECT id FROM accounts WHERE subtype IN ('bank','cash','clearing')`
  );
  return rows.map((r) => r.account_id);
}

export async function cashFlow({ from, to }) {
  const cashIds = await cashAccountIds();
  const { rows: cashLines } = await query(
    `SELECT jl.entry_id, SUM(jl.debit - jl.credit) AS amount
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ANY($1::int[]) AND je.entry_date BETWEEN $2 AND $3
     GROUP BY jl.entry_id HAVING SUM(jl.debit - jl.credit) <> 0`,
    [cashIds, from, to]
  );
  const entryIds = cashLines.map((r) => r.entry_id);
  let entries = [];
  let lines = [];
  if (entryIds.length) {
    const res = await query(
      `SELECT je.id, je.entry_date, je.entry_no, je.memo, je.source_type,
              jl.account_id, jl.debit, jl.credit, a.type AS account_type, a.subtype AS account_subtype
       FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       WHERE je.id = ANY($1::bigint[]) ORDER BY je.entry_date, je.id`,
      [entryIds]
    );
    entries = res.rows;
  }
  const cashSet = new Set(cashIds);
  const byEntry = new Map();
  for (const line of entries) {
    if (!byEntry.has(line.id)) byEntry.set(line.id, { entry: line, lines: [] });
    byEntry.get(line.id).lines.push(line);
  }
  const sections = { operating: [], investing: [], financing: [] };
  for (const { entry, lines: entryLines } of byEntry.values()) {
    const nonCash = entryLines.filter((l) => !cashSet.has(l.account_id));
    let category = 'operating';
    if (nonCash.some((l) => l.account_subtype === 'fixed_asset')) category = 'investing';
    else if (nonCash.some((l) => l.account_type === 'equity' || l.account_subtype === 'loan')) category = 'financing';
    const amount = round2(entryLines.filter((l) => cashSet.has(l.account_id)).reduce((s, l) => s + num(l.credit) * -1 + num(l.debit), 0));
    if (amount !== 0) {
      sections[category].push({
        entry_id: entry.id, entry_no: entry.entry_no, date: entry.entry_date,
        source_type: entry.source_type, memo: entry.memo, amount,
      });
    }
  }
  const { rows: openingRows } = await query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS opening
     FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
     WHERE jl.account_id = ANY($1::int[]) AND je.entry_date < $2`,
    [cashIds, from]
  );
  const opening = round2(num(openingRows[0].opening));
  const total = (list) => round2(list.reduce((s, r) => s + r.amount, 0));
  const operating = total(sections.operating);
  const investing = total(sections.investing);
  const financing = total(sections.financing);
  return {
    ...sections,
    operating_total: operating, investing_total: investing, financing_total: financing,
    net_change: round2(operating + investing + financing),
    opening_cash: opening,
    closing_cash: round2(opening + operating + investing + financing),
    from, to,
  };
}

export async function arAging() {
  const { rows } = await query(
    `SELECT c.id, c.code, c.name, c.phone,
            ROUND(SUM(s.due),2) AS total,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(s.due_date, s.created_at::date) <= 0 THEN s.due ELSE 0 END),2) AS current,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(s.due_date, s.created_at::date) BETWEEN 1 AND 30 THEN s.due ELSE 0 END),2) AS days_1_30,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(s.due_date, s.created_at::date) BETWEEN 31 AND 60 THEN s.due ELSE 0 END),2) AS days_31_60,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(s.due_date, s.created_at::date) BETWEEN 61 AND 90 THEN s.due ELSE 0 END),2) AS days_61_90,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(s.due_date, s.created_at::date) > 90 THEN s.due ELSE 0 END),2) AS days_90_plus
     FROM sales s JOIN customers c ON c.id = s.customer_id
     WHERE s.due > 0.005 AND s.status NOT IN ('voided','refunded')
     GROUP BY c.id ORDER BY total DESC`
  );
  return rows;
}

export async function apAging() {
  const { rows } = await query(
    `SELECT s.id, s.code, s.name, s.phone,
            ROUND(SUM(p.due),2) AS total,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(p.due_date, p.created_at::date) <= 0 THEN p.due ELSE 0 END),2) AS current,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(p.due_date, p.created_at::date) BETWEEN 1 AND 30 THEN p.due ELSE 0 END),2) AS days_1_30,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(p.due_date, p.created_at::date) BETWEEN 31 AND 60 THEN p.due ELSE 0 END),2) AS days_31_60,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(p.due_date, p.created_at::date) BETWEEN 61 AND 90 THEN p.due ELSE 0 END),2) AS days_61_90,
            ROUND(SUM(CASE WHEN CURRENT_DATE - COALESCE(p.due_date, p.created_at::date) > 90 THEN p.due ELSE 0 END),2) AS days_90_plus
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.due > 0.005 AND p.status = 'received'
     GROUP BY s.id ORDER BY total DESC`
  );
  return rows;
}

export async function customerBalances() {
  const maps = await getMappings({ query: (t, p) => query(t, p) });
  const { rows } = await query(
    `SELECT c.id, c.code, c.name, c.phone, c.credit_limit,
            ROUND(COALESCE(SUM(jl.debit - jl.credit),0),2) AS balance
     FROM customers c
     LEFT JOIN journal_lines jl ON jl.customer_id = c.id AND jl.account_id = $1
     GROUP BY c.id ORDER BY balance DESC`,
    [maps.ar]
  );
  return rows;
}

export async function supplierBalances() {
  const maps = await getMappings({ query: (t, p) => query(t, p) });
  const { rows } = await query(
    `SELECT s.id, s.code, s.name, s.phone,
            ROUND(COALESCE(SUM(jl.credit - jl.debit),0),2) AS balance
     FROM suppliers s
     LEFT JOIN journal_lines jl ON jl.supplier_id = s.id AND jl.account_id = $1
     GROUP BY s.id ORDER BY balance DESC`,
    [maps.ap]
  );
  return rows;
}

export async function customerStatement(customerId, { from, to }) {
  const { rows } = await query(
    `SELECT 'invoice' AS type, s.created_at AS date, s.invoice_no AS reference,
            s.total AS debit, 0 AS credit, NULL::text AS memo
     FROM sales s WHERE s.customer_id = $1 AND s.status <> 'voided'
     UNION ALL
     SELECT 'receipt', p.created_at, COALESCE(p.reference, 'Receipt'), 0, p.amount, pm.name
     FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
     WHERE p.customer_id = $1 AND p.type = 'customer_receipt'
     UNION ALL
     SELECT 'return', r.created_at, r.return_no, 0, r.total, COALESCE(r.reason, 'Sales return')
     FROM sale_returns r WHERE r.customer_id = $1
     ORDER BY date`,
    [customerId]
  );
  const { rows: customer } = await query('SELECT * FROM customers WHERE id = $1', [customerId]);
  let balance = num(customer[0]?.opening_balance || 0);
  const opening = balance;
  const filtered = rows.filter((r) => !from || String(r.date).slice(0, 10) >= from).filter((r) => !to || String(r.date).slice(0, 10) <= to);
  const lines = filtered.map((r) => {
    balance = round2(balance + num(r.debit) - num(r.credit));
    return { ...r, debit: num(r.debit), credit: num(r.credit), balance };
  });
  return { customer: customer[0] || null, opening_balance: opening, closing_balance: balance, lines };
}

export async function supplierStatement(supplierId) {
  const { rows } = await query(
    `SELECT 'bill' AS type, p.created_at AS date, p.bill_no AS reference, p.total AS credit, 0 AS debit, NULL::text AS memo
     FROM purchases p WHERE p.supplier_id = $1 AND p.status = 'received'
     UNION ALL
     SELECT 'payment', p.created_at, COALESCE(p.reference, 'Payment'), 0, p.amount, pm.name
     FROM payments p JOIN payment_methods pm ON pm.id = p.method_id
     WHERE p.supplier_id = $1 AND p.type = 'supplier_payment'
     ORDER BY date`,
    [supplierId]
  );
  const { rows: supplier } = await query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
  let balance = num(supplier[0]?.opening_balance || 0);
  const lines = rows.map((r) => {
    balance = round2(balance + num(r.credit) - num(r.debit));
    return { ...r, debit: num(r.debit), credit: num(r.credit), balance };
  });
  return { supplier: supplier[0] || null, opening_balance: num(supplier[0]?.opening_balance || 0), closing_balance: balance, lines };
}

export async function profitByProduct({ from, to }) {
  return salesByProduct({ from, to, limit: 500 });
}
