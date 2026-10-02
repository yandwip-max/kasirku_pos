CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    store_id TEXT,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS product_units (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_items (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    unit_id TEXT REFERENCES product_units(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    document JSONB NOT NULL,
    UNIQUE (transaction_id, position)
);

CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_date TEXT NOT NULL,
    document JSONB NOT NULL,
    UNIQUE (store_id, user_id, work_date)
);

CREATE TABLE IF NOT EXISTS daily_report_runs (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tests (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS status_checks (
    id TEXT PRIMARY KEY,
    store_id TEXT,
    document JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_store_type ON products(store_id, (document->>'type'));
CREATE INDEX IF NOT EXISTS products_store_name ON products(store_id, (document->>'name'));
CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_unique ON products(store_id, (document->>'barcode')) WHERE COALESCE(document->>'barcode', '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS products_store_name_unique ON products(store_id, lower(document->>'name'));
CREATE UNIQUE INDEX IF NOT EXISTS units_store_imei_unique ON product_units(store_id, (document->>'imei')) WHERE COALESCE(document->>'imei', '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS units_store_barcode_unique ON product_units(store_id, (document->>'barcode')) WHERE COALESCE(document->>'barcode', '') <> '';
CREATE INDEX IF NOT EXISTS units_store_product_status ON product_units(store_id, product_id, (document->>'status'));
CREATE UNIQUE INDEX IF NOT EXISTS transactions_store_number_unique ON transactions(store_id, (document->>'transaction_number'));
CREATE UNIQUE INDEX IF NOT EXISTS transactions_store_client_ref_unique ON transactions(store_id, (document->>'client_ref')) WHERE document->>'client_ref' IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_store_created_at ON transactions(store_id, (document->>'created_at') DESC);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_store_user_date_unique ON attendance(store_id, user_id, work_date);
CREATE UNIQUE INDEX IF NOT EXISTS daily_report_runs_store_user_day_unique ON daily_report_runs(store_id, (document->>'user_id'), (document->>'work_date'));
CREATE INDEX IF NOT EXISTS activity_logs_store_at ON activity_logs(store_id, (document->>'at') DESC);
CREATE INDEX IF NOT EXISTS status_checks_timestamp ON status_checks((document->>'timestamp') DESC);
