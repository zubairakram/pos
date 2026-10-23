-- Ledger POS — core schema
-- Every financial event writes an immutable double-entry journal.

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'store' CHECK (type IN ('store','warehouse','office')),
  address     text,
  phone       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            serial PRIMARY KEY,
  location_id   int REFERENCES locations(id),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin','manager','accountant','cashier','storekeeper')),
  phone         text,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_location ON users(location_id);

CREATE TABLE accounts (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  subtype     text,
  parent_id   int REFERENCES accounts(id),
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_mappings (
  key        text PRIMARY KEY,
  account_id int NOT NULL REFERENCES accounts(id)
);

CREATE TABLE tax_rates (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  rate         numeric(7,4) NOT NULL DEFAULT 0,
  is_inclusive boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE payment_methods (
  id                  serial PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  type                text NOT NULL CHECK (type IN ('cash','bank','card','wallet')),
  account_id          int NOT NULL REFERENCES accounts(id),
  requires_reference  boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE categories (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  parent_id int REFERENCES categories(id),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE units (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  short_name text NOT NULL UNIQUE
);

CREATE TABLE products (
  id              serial PRIMARY KEY,
  sku             text NOT NULL UNIQUE,
  barcode         text UNIQUE,
  name            text NOT NULL,
  description     text,
  category_id     int REFERENCES categories(id),
  unit_id         int REFERENCES units(id),
  cost_price      numeric(14,4) NOT NULL DEFAULT 0,
  sale_price      numeric(14,4) NOT NULL DEFAULT 0,
  tax_rate_id     int REFERENCES tax_rates(id),
  track_inventory boolean NOT NULL DEFAULT true,
  reorder_level   numeric(14,3) NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE inventory (
  product_id  int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location_id int NOT NULL REFERENCES locations(id),
  quantity    numeric(16,3) NOT NULL DEFAULT 0,
  avg_cost    numeric(16,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE stock_moves (
  id          bigserial PRIMARY KEY,
  product_id  int NOT NULL REFERENCES products(id),
  location_id int NOT NULL REFERENCES locations(id),
  type        text NOT NULL CHECK (type IN ('opening','purchase','sale','return_in','return_out','adjustment','transfer_in','transfer_out')),
  quantity    numeric(16,3) NOT NULL,
  unit_cost   numeric(16,6) NOT NULL DEFAULT 0,
  total_cost  numeric(16,2) NOT NULL DEFAULT 0,
  ref_type    text,
  ref_id      bigint,
  note        text,
  user_id     int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_moves_product ON stock_moves(product_id, created_at DESC);
CREATE INDEX idx_stock_moves_ref ON stock_moves(ref_type, ref_id);

CREATE TABLE customers (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  email           text,
  phone           text,
  address         text,
  tax_number      text,
  credit_limit    numeric(14,2) NOT NULL DEFAULT 0,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  email           text,
  phone           text,
  address         text,
  tax_number      text,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_registers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  location_id int NOT NULL REFERENCES locations(id),
  account_id  int NOT NULL REFERENCES accounts(id),
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE cash_sessions (
  id             serial PRIMARY KEY,
  register_id    int NOT NULL REFERENCES cash_registers(id),
  user_id        int NOT NULL REFERENCES users(id),
  opening_float  numeric(14,2) NOT NULL DEFAULT 0,
  expected_cash  numeric(14,2),
  counted_cash   numeric(14,2),
  variance       numeric(14,2),
  denominations  jsonb,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_note   text,
  closing_note   text,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);
CREATE INDEX idx_cash_sessions_register ON cash_sessions(register_id, status);

CREATE TABLE cash_movements (
  id          bigserial PRIMARY KEY,
  session_id  int NOT NULL REFERENCES cash_sessions(id),
  type        text NOT NULL CHECK (type IN ('sale','refund','receipt','payment','cash_in','cash_out')),
  amount      numeric(14,2) NOT NULL, -- signed: positive into drawer, negative out
  reason      text,
  ref_type    text,
  ref_id      bigint,
  user_id     int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_movements_session ON cash_movements(session_id);

CREATE TABLE document_sequences (
  key         text PRIMARY KEY,
  prefix      text NOT NULL DEFAULT '',
  next_number int NOT NULL DEFAULT 1
);

CREATE TABLE sales (
  id            bigserial PRIMARY KEY,
  invoice_no    text NOT NULL UNIQUE,
  location_id   int NOT NULL REFERENCES locations(id),
  customer_id   int REFERENCES customers(id),
  user_id       int NOT NULL REFERENCES users(id),
  session_id    int REFERENCES cash_sessions(id),
  status        text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided','partially_refunded','refunded')),
  subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  discount      numeric(14,2) NOT NULL DEFAULT 0,
  tax           numeric(14,2) NOT NULL DEFAULT 0,
  total         numeric(14,2) NOT NULL DEFAULT 0,
  paid          numeric(14,2) NOT NULL DEFAULT 0,
  due           numeric(14,2) NOT NULL DEFAULT 0,
  change_due    numeric(14,2) NOT NULL DEFAULT 0,
  due_date      date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_status ON sales(status);

CREATE TABLE sale_items (
  id           bigserial PRIMARY KEY,
  sale_id      bigint NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   int REFERENCES products(id),
  description  text NOT NULL,
  quantity     numeric(14,3) NOT NULL,
  unit_price   numeric(14,4) NOT NULL,
  discount     numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate     numeric(7,4) NOT NULL DEFAULT 0,
  tax_amount   numeric(14,2) NOT NULL DEFAULT 0,
  line_total   numeric(14,2) NOT NULL,
  unit_cost    numeric(16,6) NOT NULL DEFAULT 0,
  cost_total   numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE purchases (
  id          bigserial PRIMARY KEY,
  bill_no     text NOT NULL UNIQUE,
  supplier_id int NOT NULL REFERENCES suppliers(id),
  location_id int NOT NULL REFERENCES locations(id),
  user_id     int NOT NULL REFERENCES users(id),
  status      text NOT NULL DEFAULT 'received' CHECK (status IN ('received','voided')),
  subtotal    numeric(14,2) NOT NULL DEFAULT 0,
  discount    numeric(14,2) NOT NULL DEFAULT 0,
  tax         numeric(14,2) NOT NULL DEFAULT 0,
  total       numeric(14,2) NOT NULL DEFAULT 0,
  paid        numeric(14,2) NOT NULL DEFAULT 0,
  due         numeric(14,2) NOT NULL DEFAULT 0,
  due_date    date,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz
);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX idx_purchases_created ON purchases(created_at);

CREATE TABLE purchase_items (
  id          bigserial PRIMARY KEY,
  purchase_id bigint NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  int NOT NULL REFERENCES products(id),
  description text NOT NULL,
  quantity    numeric(14,3) NOT NULL,
  unit_cost   numeric(14,4) NOT NULL,
  discount    numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate    numeric(7,4) NOT NULL DEFAULT 0,
  tax_amount  numeric(14,2) NOT NULL DEFAULT 0,
  line_total  numeric(14,2) NOT NULL
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);

CREATE TABLE sale_returns (
  id          bigserial PRIMARY KEY,
  return_no   text NOT NULL UNIQUE,
  sale_id     bigint NOT NULL REFERENCES sales(id),
  customer_id int REFERENCES customers(id),
  location_id int NOT NULL REFERENCES locations(id),
  user_id     int NOT NULL REFERENCES users(id),
  session_id  int REFERENCES cash_sessions(id),
  method_id   int REFERENCES payment_methods(id),
  subtotal    numeric(14,2) NOT NULL DEFAULT 0,
  tax         numeric(14,2) NOT NULL DEFAULT 0,
  total       numeric(14,2) NOT NULL DEFAULT 0,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_returns_sale ON sale_returns(sale_id);

CREATE TABLE return_items (
  id           bigserial PRIMARY KEY,
  return_id    bigint NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id bigint NOT NULL REFERENCES sale_items(id),
  product_id   int REFERENCES products(id),
  quantity     numeric(14,3) NOT NULL,
  unit_price   numeric(14,4) NOT NULL,
  tax_amount   numeric(14,2) NOT NULL DEFAULT 0,
  line_total   numeric(14,2) NOT NULL,
  unit_cost    numeric(16,6) NOT NULL DEFAULT 0,
  cost_total   numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_return_items_return ON return_items(return_id);

CREATE TABLE payments (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('sale','refund','customer_receipt','supplier_payment')),
  method_id   int NOT NULL REFERENCES payment_methods(id),
  amount      numeric(14,2) NOT NULL,
  reference   text,
  sale_id     bigint REFERENCES sales(id),
  purchase_id bigint REFERENCES purchases(id),
  return_id   bigint REFERENCES sale_returns(id),
  customer_id int REFERENCES customers(id),
  supplier_id int REFERENCES suppliers(id),
  session_id  int REFERENCES cash_sessions(id),
  user_id     int REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_sale ON payments(sale_id);
CREATE INDEX idx_payments_purchase ON payments(purchase_id);
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_payments_created ON payments(created_at);

CREATE TABLE journal_entries (
  id          bigserial PRIMARY KEY,
  entry_no    text NOT NULL UNIQUE,
  entry_date  date NOT NULL,
  memo        text,
  source_type text NOT NULL,
  source_id   bigint,
  location_id int REFERENCES locations(id),
  user_id     int REFERENCES users(id),
  is_posted   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_entries_source ON journal_entries(source_type, source_id);

CREATE TABLE journal_lines (
  id          bigserial PRIMARY KEY,
  entry_id    bigint NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  int NOT NULL REFERENCES accounts(id),
  debit       numeric(16,2) NOT NULL DEFAULT 0,
  credit      numeric(16,2) NOT NULL DEFAULT 0,
  description text,
  customer_id int REFERENCES customers(id),
  supplier_id int REFERENCES suppliers(id),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_customer ON journal_lines(customer_id);

CREATE TABLE expenses (
  id               bigserial PRIMARY KEY,
  entry_date       date NOT NULL,
  account_id       int NOT NULL REFERENCES accounts(id),
  amount           numeric(14,2) NOT NULL,
  tax              numeric(14,2) NOT NULL DEFAULT 0,
  method_id        int NOT NULL REFERENCES payment_methods(id),
  location_id      int REFERENCES locations(id),
  session_id       int REFERENCES cash_sessions(id),
  reference        text,
  notes            text,
  user_id          int REFERENCES users(id),
  journal_entry_id bigint REFERENCES journal_entries(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_date ON expenses(entry_date);

CREATE TABLE stock_transfers (
  id               bigserial PRIMARY KEY,
  transfer_no      text NOT NULL UNIQUE,
  from_location_id int NOT NULL REFERENCES locations(id),
  to_location_id   int NOT NULL REFERENCES locations(id),
  status           text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  notes            text,
  user_id          int REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_transfer_items (
  id          bigserial PRIMARY KEY,
  transfer_id bigint NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id  int NOT NULL REFERENCES products(id),
  quantity    numeric(14,3) NOT NULL,
  unit_cost   numeric(16,6) NOT NULL DEFAULT 0
);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  user_id    int REFERENCES users(id),
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  details    jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
