-- Reference schema for Expense Ledger.
--
-- You don't need to run this: lib/db.js -> ensureTables() applies exactly
-- these statements automatically (in one transaction) whenever SCHEMA_VERSION
-- changes. It's kept here for reading, or for setting up a database by hand
-- in the Neon console. Regenerate it from ensureTables() when the schema changes.

CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL,
    note TEXT DEFAULT '', expense_date DATE NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS movies (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, watched_date DATE NOT NULL,
    ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0, canteen_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    companions TEXT DEFAULT '', my_take TEXT NOT NULL, public_take TEXT NOT NULL, note TEXT DEFAULT '',
    affects_balance BOOLEAN NOT NULL DEFAULT true, quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

ALTER TABLE movies ADD COLUMN IF NOT EXISTS venue_type TEXT NOT NULL DEFAULT 'Theatre';

ALTER TABLE movies ADD COLUMN IF NOT EXISTS venue_name TEXT NOT NULL DEFAULT '';

ALTER TABLE movies ADD COLUMN IF NOT EXISTS genre TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS balance_topups (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '',
    topup_date DATE NOT NULL, mode TEXT NOT NULL DEFAULT 'add', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS budget_rules (
    id SERIAL PRIMARY KEY, rule_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    amount NUMERIC(12,2) NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_rule ON budget_rules (rule_type, category);

CREATE TABLE IF NOT EXISTS sugar_challenge_meta (
    id INTEGER PRIMARY KEY DEFAULT 1, start_date DATE NOT NULL, length_days INTEGER NOT NULL DEFAULT 41
  );

ALTER TABLE sugar_challenge_meta ADD COLUMN IF NOT EXISTS sugar_per_day NUMERIC(6,1) NOT NULL DEFAULT 0;

ALTER TABLE sugar_challenge_meta ADD COLUMN IF NOT EXISTS savings_per_day NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_time TIME;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_photo TEXT DEFAULT '';

ALTER TABLE movies ADD COLUMN IF NOT EXISTS watched_time TIME;

CREATE TABLE IF NOT EXISTS sugar_challenge_days (
    id SERIAL PRIMARY KEY, day_date DATE UNIQUE NOT NULL, completed BOOLEAN NOT NULL, note TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

ALTER TABLE sugar_challenge_days ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '';

ALTER TABLE sugar_challenge_days ADD COLUMN IF NOT EXISTS natural_sugar BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS recurring_expenses (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL, note TEXT DEFAULT '',
    day_of_month INTEGER NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
    last_generated_month TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS sugar_challenge_history (
    id SERIAL PRIMARY KEY, start_date DATE NOT NULL, length_days INTEGER NOT NULL,
    completed_days INTEGER NOT NULL, longest_streak INTEGER NOT NULL, ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS recurring_income (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '',
    day_of_month INTEGER NOT NULL, last_generated_month TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS ious (
    id SERIAL PRIMARY KEY, person_name TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL,
    direction TEXT NOT NULL, note TEXT DEFAULT '', due_date DATE, settled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS movie_watchlist (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_client_request ON expenses (client_request_id);

ALTER TABLE movies ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_movies_client_request ON movies (client_request_id);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);
