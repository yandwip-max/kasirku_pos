# MongoDB to PostgreSQL / Supabase

The backend now uses `asyncpg` against PostgreSQL. The existing router signatures and response dictionaries remain unchanged; each entity has a relational table with a JSONB document payload, while stable relationships are enforced by PostgreSQL foreign keys.

## Entity model

```text
stores
  ├── users
  ├── products ── product_units
  ├── transactions ── transaction_items ── products
  │                                  └────── product_units
  ├── attendance ── users
  ├── categories
  ├── activity_logs
  └── daily_report_runs ── users

email_tests ── users
```

The tables are defined in `backend/schema.sql`. `transaction_items` stores one relational row per sale line, including optional product/unit foreign keys and the original JSONB snapshot. The parent transaction's `items` array remains in its existing response shape. Category names remain strings on products because the current API supports products whose category has no separate category record and renames categories by name.

## Connection setup

Set `DATABASE_URL` in `backend/.env`. For a local Supabase instance, the default in `.env.example` is:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

For hosted Supabase, use the project's PostgreSQL connection string, preferably the Session pooler URL. If the URL includes `sslmode=require`, the adapter enables TLS. Do not commit `.env` or expose the database password in frontend variables.

At application startup, `ensure_indexes()` applies `schema.sql` to the configured database. This creates tables, constraints, and indexes; it does not copy MongoDB records.

## One-time data migration

1. Stop writes to the MongoDB-backed application and take a MongoDB backup.
2. Set `SOURCE_MONGO_URL` and `SOURCE_DB_NAME` in `backend/.env`. The script falls back to `MONGO_URL` and `DB_NAME` for the source.
3. Set `DATABASE_URL` to the PostgreSQL target. Use an empty target database to avoid uniqueness conflicts.
4. Install backend requirements and run from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe migrate_mongo.py
```

The migration copies stores and users before dependent products, units, transactions, attendance, and logs. It drops Mongo `_id`; application `id` values are retained. Transaction item snapshots are also inserted into `transaction_items`. The script is intended for a one-time run against an empty target, not as a change-data-capture process.

## Atomic writes and reporting

Registration, checkout, void/return, product stock updates, and category changes use PostgreSQL transactions. Checkout stock claims remain conditional SQL updates, so concurrent requests cannot both claim the same unit or oversell quantity stock. Product stock aggregation is performed with SQL `GROUP BY`. Existing report and Excel response construction remains in Python/Pandas and returns the same models and dictionaries.

For a database-independent adapter test, run `pytest tests/test_postgres_adapter.py -q` from `backend/`. A full API smoke test requires a reachable PostgreSQL/Supabase database and migrated data.
