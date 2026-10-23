# Ledger POS

Ledger POS is a full point-of-sale system with a real **double-entry general ledger** at its core. Every sale, return, purchase, payment, expense, cash movement and inventory change posts balanced journal entries automatically. It is designed for independent retail with counter cash control, multi-location inventory, customer/supplier accounts and management reporting.

## Features

- **Point of Sale** — Fast counter selling with barcode lookup, taxes, discounts, splits between payment methods, change calculation and one-click receipts.
- **Double-entry accounting** — Immutable `journal_entries`/`journal_lines`. A `postJournal` guard enforces balanced postings on every money-moving transaction.
- **Inventory** — Per-location stock with moving weighted-average cost, stock moves, transfers, adjustments and low-stock alerts.
- **Purchases & payables** — Purchase orders/bills, automatic stock receipt, supplier ledger and partial/all payments.
- **Sales, returns & receivables** — Credit sales, customer receipts, returns with automatic inventory restoration and AR/AP updates.
- **Cash & drawers** — Cash registers, per-user drawer sessions, float, cash in/out movements, count and close with variance posting to `Cash Over / Short`.
- **Chart of accounts & mappings** — Configurable COA with event-to-account mappings so that posting rules stay explicit and auditable.
- **Dashboards by role** — Executive, operations, finance and cashier views with real-time sales, cash, stock and receivables/payables.
- **Reports** — Sales summary/by product/category/cashier/location, hourly sales, payment mix, tax, inventory valuation, stock movements, P&L, balance sheet, cash flow, AR/AP aging, customer/supplier statements and Z-reports.
- **Roles & permissions** — `admin`, `manager`, `accountant`, `cashier`, `storekeeper` with route- and action-level guards.
- **Settings** — Company profile, receipt/invoice prefixes, currency, fiscal year/lock date and account mapping inspection.
- **Audit log** — Key administrative and financial actions are recorded.

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js, Express, `pg` |
| Frontend | React 18, Vite, React Router, Recharts, Lucide React |
| Database | PostgreSQL |
| Auth | JWT (Bearer tokens), role-based access control |

## Quick start (local development)

### Prerequisites

- Node.js >= 20
- PostgreSQL 15+ (or use the bundled local cluster script)

### Option 1: self-contained local PostgreSQL cluster (recommended)

This creates an isolated cluster in `./.pgdata` on port `5433` with user `pos` / password `pos_dev_password` / database `pos`. It won't touch an existing system Postgres install.

```bash
npm install
npm run db:local
cp server/.env.example server/.env
npm run db:reset      # apply schema and seed base data (users, accounts, products, etc.)
npm run db:demo       # add 30 days of realistic trading history (optional but great for demos)
npm run dev           # API at http://localhost:4000, app at http://localhost:5173
```

### Option 2: use an existing PostgreSQL server

```bash
npm install
cp server/.env.example server/.env
# Edit server/.env with your DATABASE_URL (and a strong JWT_SECRET)
# Provision role/database (run against a privileged/admin connection):
ADMIN_URL=postgres://postgres:yourpassword@127.0.0.1:5432/postgres bash scripts/setup-db.sh
# Now point the app at that database and load schema:
npm run db:reset
npm run db:demo       # optional
npm run dev
```

### Demo logins

All passwords are for **local development only**. Change them before any shared environment.

| Role | Email | Password | Access |
| --- | --- | --- | --- |
| Administrator | `admin@ledgerpos.local` | `Admin@123` | Full system access, settings, users, mappings |
| Manager | `manager@ledgerpos.local` | `Manager@123` | Operations, catalogue, inventory, purchases, sales, cash, reports, settings |
| Accountant | `accountant@ledgerpos.local` | `Account@123` | Ledger, journals, reports, AR/AP, expenses, purchasing and receipts |
| Cashier | `cashier@ledgerpos.local` | `Cashier@123` | POS, sales, returns, customers, own cash drawer |
| Storekeeper | `store@ledgerpos.local` | `Store@123` | Products, inventory, transfers/adjustments, purchases, suppliers |

The demo seed also opens a cash drawer for the cashier (`Counter 1` at the Main Store) with a `$300` float.

## Available scripts (root)

| Script | Description |
| --- | --- |
| `npm run dev` | Run API (watch) and Vite dev server concurrently |
| `npm run build` | Build the frontend for production (`client/`) |
| `npm run start` | Start the API in production mode (`server/`) |
| `npm run db:local` | Create/start a local Postgres cluster on `5433` |
| `npm run db:migrate` | Apply pending migrations (idempotent) |
| `npm run db:seed` | Seed base data (safe to re-run only if empty; use `--force` not required) |
| `npm run db:demo` | Add 30 days of trading history (refuses if sales already exist) |
| `npm run db:reset` | Drop schema, migrate, and seed from scratch |
| `npm run test:api` | Run the end-to-end API smoke test against the running server |

Server workspace scripts (`npm run <cmd> -w server`): `dev`, `start`, `migrate`, `reset`, `seed`, `demo`, `test:api`.

## How the accounting works

Ledger POS posts to the general ledger on every financial event through `server/src/services/accounting.js`:

1. `getMappings()` loads event → account mappings from `account_mappings`.
2. `postJournal()` validates lines (no mixed debit/credit on a line, non-negative amounts), ensures debits == credits to the cent, assigns the next `JE` number, writes `journal_entries` + `journal_lines`, and returns the entry.
3. Services call `postJournal()` inside the same `withTransaction()` as the document write, so the ledger stays in sync with the source document.

### Default posting patterns

| Event | Typical postings |
| --- | --- |
| **Cash sale** | Dr Cash (drawer/register), Dr COGS / Cr Inventory (weighted average cost). Cr Sales Revenue, Cr Sales Tax Payable (if taxable). |
| **Credit sale** | Dr Accounts Receivable, Dr COGS / Cr Inventory. Cr Sales Revenue, Cr Sales Tax Payable. |
| **Customer receipt** | Dr Cash/Bank/Wallet, Cr Accounts Receivable. |
| **Sales return** | Dr Sales Returns & Allowances, Dr Sales Tax Payable. Cr Cash/AR. Dr Inventory / Cr COGS to restore cost. |
| **Purchase (received)** | Dr Inventory, Dr Tax Receivable (if applicable). Cr Accounts Payable. |
| **Supplier payment** | Dr Accounts Payable, Cr Cash/Bank. |
| **Expense** | Dr Expense account, Cr Cash/Bank/Drawer account. |
| **Cash in/out** | Dr Cash / Cr Owner's Capital, or Dr Owner's Drawings / Cr Cash (with a journal entry). |
| **Drawer close (variance)** | Dr/Cr Cash Over/Short and offset to the register cash account. |
| **Stock adjustment / transfer** | Posted via `inventory_adjustment` as configured; transfers move stock between locations with move history. |

Account mappings (editable by admins) live in Settings and cover: `ar`, `ap`, `inventory`, `tax_payable`, `tax_receivable`, `sales`, `sales_returns`, `cogs`, `inventory_adjustment`, `cash_over_short`, `opening_balance_equity`, `owner_capital`, `owner_drawings`, `retained_earnings`, `bank`.

Inventory uses **moving weighted-average cost** per `(product_id, location_id)`. Sales write `sale_items.unit_cost`/`cost_total` at the time of issue, and returns restore inventory at the original item cost.

## Project structure

```text
ledger-pos/
├── client/                # React + Vite frontend
│   └── src/
│       ├── components/    # Layout, UI primitives, Receipt
│       ├── pages/         # Dashboard, POS, Sales, Purchases, Inventory, ...
│       ├── hooks.js       # useApi, useLookups, useDebounced
│       ├── api.js         # fetch wrapper + token storage
│       └── styles.css     # Design system
├── server/                # Express API
│   └── src/
│       ├── db/            # migrations, seed, demo, pool
│       ├── middleware/    # auth, error handling
│       ├── routes/        # REST endpoints
│       ├── services/      # business logic + ledger postings
│       └── utils.js       # helpers (rounding, assertions, dates)
├── scripts/
│   ├── local-db.sh        # Create/start a local Postgres cluster
│   └── setup-db.sh        # Provision a role/database on an existing server
└── package.json           # npm workspaces root
```

## API surface (selected)

| Area | Endpoints | Notes |
| --- | --- | --- |
| Auth | `POST /api/auth/login`, `GET /api/auth/me` | JWT auth; login is rate-limited |
| Sales/POS | `GET/POST /api/sales`, `GET /api/sales/:id`, `POST /api/sales/:id/void`, `POST /api/sales/:id/returns`, `POST /api/customer-payments` | Cash sales require an open drawer session |
| Purchases | `GET/POST /api/purchases`, `GET /api/purchases/:id`, `POST /api/purchases/:id/pay`, `POST /api/supplier-payments` | Receiving updates stock and posts to AP/inventory |
| Cash | `GET /api/cash/registers`, `GET/POST /api/cash/sessions/*`, `POST /api/cash/sessions/:id/movements`, `POST /api/cash/sessions/:id/close` | Per-session expected cash, over/short journal on close |
| Accounting | `/api/accounting/accounts`, `/api/accounting/mappings`, `/api/accounting/journal`, `/api/accounting/trial-balance`, `/api/accounting/pnl`, `/api/accounting/balance-sheet`, `/api/accounting/cash-flow`, `/api/accounting/expenses` | Most restricted to `admin`/`manager`/`accountant` |
| Reports | `/api/reports/*` and `/api/reports/z-report/:sessionId` | Filtered by date ranges; role-gated |
| Catalog/Inventory/Contacts/Users/Settings/Dashboard | `/api/products`, `/api/inventory`, `/api/customers`, `/api/suppliers`, `/api/users`, `/api/settings`, `/api/dashboard` | Scoped by role and, where relevant, by location |

All protected endpoints require `Authorization: Bearer <token>`. Validation errors return `{ "error": "..." }` with appropriate HTTP status codes.

## Testing

With the API running and seeded data loaded:

```bash
npm run test:api
```

The smoke test logs in as every role, checks RBAC, creates products/customers/suppliers, does purchases/payments, runs a cash sale + drawer close with variance, completes a credit sale + receipt + return, posts an expense and a manual journal, exercises dashboards and reports, verifies the **trial balance and balance sheet are balanced**, and confirms deactivated users cannot sign in.

## Production build & deployment

```bash
# Build the frontend
npm run build

# Set environment (do NOT use dev defaults in production)
export NODE_ENV=production
export DATABASE_URL=postgres://user:pass@host:5432/pos
export JWT_SECRET="$(openssl rand -base64 48)"
export PORT=4000
export CORS_ORIGIN=https://your-domain.example

# Run migrations + start
npm run db:migrate -w server
npm start -w server
```

In production, the API serves the built React app from `client/dist`. Put it behind a reverse proxy (TLS), restrict database access, rotate secrets, and take regular backups. The built-in rate limiter protects the login endpoint.

## Environment variables

| Variable | Default (dev) | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API listen port |
| `NODE_ENV` | `development` | `development` or `production` |
| `DATABASE_URL` | `postgres://pos:pos_dev_password@127.0.0.1:5433/pos` | PostgreSQL connection string |
| `JWT_SECRET` | `dev-only-insecure-secret` | **Change in production** |
| `JWT_EXPIRES_IN` | `12h` | Token lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origins (comma-separated) |
| `TZ` | `UTC` | Timezone for the server process |

See `server/.env.example` for a template.

## Notes on data integrity

- **Rounding:** Monetary values use cent-level rounding (`round2`) and inventory quantities use `round4` to avoid floating-point drift.
- **Ledger balance:** `postJournal` rejects unbalanced entries; smoke tests assert trial balance and balance sheet balance to the cent.
- **Inventory:** Out-of-stock is blocked unless `Settings → POS → Allow selling products below zero stock` is enabled.
- **Corrections:** Avoid editing posted documents; use returns, reversals or manual journals so the audit trail remains intact.
