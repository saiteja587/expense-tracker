import { neon } from "@neondatabase/serverless";
import { localDateParts, daysInMonth } from "./dates";

let sql;
export function getSql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// Bump this whenever the DDL below changes. Each cold start does one cheap
// SELECT; the full DDL batch only runs when the stored version differs.
const SCHEMA_VERSION = "11";

// Every table that holds someone's data. Each row carries the user_id of its
// owner, and every query below filters on it.
const USER_TABLES = [
  "expenses", "movies", "balance_topups", "budget_rules", "sugar_challenge_meta", "sugar_challenge_days",
  "sugar_challenge_history", "push_subscriptions", "recurring_expenses", "recurring_income", "ious",
  "movie_watchlist", "backups", "shared_groups",
];
// Per-person settings that used to live in the global app_settings table.
const USER_SETTING_KEYS = [
  "custom_categories", "custom_theatres", "custom_ott_platforms", "savings_goal", "milestone_rewards",
  "mini_challenges", "recurring_confirmations", "bills_paid", "last_sugar_reminder_date",
];

let ready = false;
export async function ensureTables() {
  if (ready) return;
  const sql = getSql();
  try {
    const rows = await sql`SELECT value FROM app_settings WHERE key = 'schema_version';`;
    if (rows[0]?.value === SCHEMA_VERSION) {
      ready = true;
      return;
    }
  } catch {
    // app_settings doesn't exist yet: fresh database.
  }

  // One HTTP round trip, one transaction, instead of ~90 sequential calls.
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL,
    note TEXT DEFAULT '', expense_date DATE NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS movies (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, watched_date DATE NOT NULL,
    ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0, canteen_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    companions TEXT DEFAULT '', my_take TEXT NOT NULL, public_take TEXT NOT NULL, note TEXT DEFAULT '',
    affects_balance BOOLEAN NOT NULL DEFAULT true, quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS venue_type TEXT NOT NULL DEFAULT 'Theatre';`,
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS venue_name TEXT NOT NULL DEFAULT '';`,
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS genre TEXT DEFAULT '';`,
    sql`CREATE TABLE IF NOT EXISTS balance_topups (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '',
    topup_date DATE NOT NULL, mode TEXT NOT NULL DEFAULT 'add', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS budget_rules (
    id SERIAL PRIMARY KEY, rule_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    amount NUMERIC(12,2) NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS sugar_challenge_meta (
    id INTEGER PRIMARY KEY DEFAULT 1, start_date DATE NOT NULL, length_days INTEGER NOT NULL DEFAULT 41
  );`,
    sql`ALTER TABLE sugar_challenge_meta ADD COLUMN IF NOT EXISTS sugar_per_day NUMERIC(6,1) NOT NULL DEFAULT 0;`,
    sql`ALTER TABLE sugar_challenge_meta ADD COLUMN IF NOT EXISTS savings_per_day NUMERIC(10,2) NOT NULL DEFAULT 0;`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_time TIME;`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_photo TEXT DEFAULT '';`,
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS watched_time TIME;`,
    sql`CREATE TABLE IF NOT EXISTS sugar_challenge_days (
    id SERIAL PRIMARY KEY, day_date DATE UNIQUE NOT NULL, completed BOOLEAN NOT NULL, note TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`ALTER TABLE sugar_challenge_days ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '';`,
    sql`ALTER TABLE sugar_challenge_days ADD COLUMN IF NOT EXISTS natural_sugar BOOLEAN NOT NULL DEFAULT false;`,
    sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );`,
    sql`CREATE TABLE IF NOT EXISTS recurring_expenses (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL, note TEXT DEFAULT '',
    day_of_month INTEGER NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
    last_generated_month TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS sugar_challenge_history (
    id SERIAL PRIMARY KEY, start_date DATE NOT NULL, length_days INTEGER NOT NULL,
    completed_days INTEGER NOT NULL, longest_streak INTEGER NOT NULL, ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS recurring_income (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '',
    day_of_month INTEGER NOT NULL, last_generated_month TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS ious (
    id SERIAL PRIMARY KEY, person_name TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL,
    direction TEXT NOT NULL, note TEXT DEFAULT '', due_date DATE, settled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`CREATE TABLE IF NOT EXISTS movie_watchlist (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_request_id TEXT;`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_client_request ON expenses (client_request_id);`,
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS client_request_id TEXT;`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_movies_client_request ON movies (client_request_id);`,
    sql`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);`,
    // v4: movie ratings/reviews, UPI ids on recurring bills, weekly server
    // backups, shared spaces.
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS rating INTEGER;`,
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS review TEXT DEFAULT '';`,
    sql`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS upi_id TEXT DEFAULT '';`,
    sql`CREATE TABLE IF NOT EXISTS backups (
      id SERIAL PRIMARY KEY, payload TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE TABLE IF NOT EXISTS shared_groups (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, token TEXT UNIQUE NOT NULL, members TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE TABLE IF NOT EXISTS shared_entries (
      id SERIAL PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES shared_groups(id) ON DELETE CASCADE,
      payer TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '', entry_date DATE NOT NULL,
      split_with TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_shared_entries_group ON shared_entries (group_id);`,
    // v5: bills whose amount changes monthly, and "estimate" expenses.
    sql`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS variable BOOLEAN NOT NULL DEFAULT false;`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_estimate BOOLEAN NOT NULL DEFAULT false;`,

    // v6: several people in one app. Everything that existed before belongs
    // to user #1 (the original owner), who keeps their existing PIN.
    sql`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL DEFAULT '',
      is_owner BOOLEAN NOT NULL DEFAULT false, failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`INSERT INTO users (id, name, name_key, pin_hash, is_owner)
      SELECT 1, 'Me', 'me', COALESCE((SELECT value FROM app_settings WHERE key = 'app_pin_hash'), ''), true
      WHERE NOT EXISTS (SELECT 1 FROM users);`,
    sql`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT max(id) FROM users), 1));`,
    sql`CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY, created_by INTEGER NOT NULL, used_by INTEGER, used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key)
    );`,
    sql`INSERT INTO user_settings (user_id, key, value)
      SELECT 1, key, value FROM app_settings WHERE key = ANY(${USER_SETTING_KEYS})
      ON CONFLICT DO NOTHING;`,
    ...USER_TABLES.flatMap((t) => [
      sql.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS user_id INTEGER;`),
      sql.query(`UPDATE ${t} SET user_id = 1 WHERE user_id IS NULL;`),
      sql.query(`ALTER TABLE ${t} ALTER COLUMN user_id SET NOT NULL;`),
      sql.query(`CREATE INDEX IF NOT EXISTS idx_${t}_user ON ${t} (user_id);`),
    ]),
    // One-per-person uniqueness instead of one-per-app.
    sql`DROP INDEX IF EXISTS uq_budget_rule;`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_rule_user ON budget_rules (user_id, rule_type, category);`,
    sql`ALTER TABLE sugar_challenge_meta DROP CONSTRAINT IF EXISTS sugar_challenge_meta_pkey;`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_meta_user ON sugar_challenge_meta (user_id);`,
    sql`ALTER TABLE sugar_challenge_days DROP CONSTRAINT IF EXISTS sugar_challenge_days_day_date_key;`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_day_user ON sugar_challenge_days (user_id, day_date);`,

    // v7: TMDB ids (exact film, not just a title), release/streaming
    // tracking on the watchlist, a shared TMDB cache, and TV shows.
    sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_id INTEGER;`,
    sql`ALTER TABLE movie_watchlist ADD COLUMN IF NOT EXISTS tmdb_id INTEGER;`,
    sql`ALTER TABLE movie_watchlist ADD COLUMN IF NOT EXISTS release_date DATE;`,
    sql`ALTER TABLE movie_watchlist ADD COLUMN IF NOT EXISTS last_providers TEXT NOT NULL DEFAULT '';`,
    sql`ALTER TABLE movie_watchlist ADD COLUMN IF NOT EXISTS notified TEXT NOT NULL DEFAULT '';`,
    sql`CREATE TABLE IF NOT EXISTS tmdb_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now());`,
    sql`CREATE TABLE IF NOT EXISTS tv_shows (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, tmdb_id INTEGER, title TEXT NOT NULL, poster TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'watching', season INTEGER NOT NULL DEFAULT 1,
      episode INTEGER NOT NULL DEFAULT 0, rating INTEGER, note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_tv_shows_user ON tv_shows (user_id);`,
    // v8: your own watchlist order, and watch-together lists shared
    // between people who use the app.
    sql`ALTER TABLE movie_watchlist ADD COLUMN IF NOT EXISTS position INTEGER;`,
    sql`CREATE TABLE IF NOT EXISTS watch_lists (
      id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE TABLE IF NOT EXISTS watch_list_members (
      list_id INTEGER NOT NULL REFERENCES watch_lists(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (list_id, user_id)
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_watch_list_members_user ON watch_list_members (user_id);`,
    sql`CREATE TABLE IF NOT EXISTS watch_list_items (
      id SERIAL PRIMARY KEY, list_id INTEGER NOT NULL REFERENCES watch_lists(id) ON DELETE CASCADE, added_by INTEGER NOT NULL,
      title TEXT NOT NULL, tmdb_id INTEGER, note TEXT NOT NULL DEFAULT '', watched BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_watch_list_items_list ON watch_list_items (list_id);`,
    // v9: votes in watch-together lists, followed actors/directors, and a
    // sugar food log (Open Food Facts lookups).
    sql`CREATE TABLE IF NOT EXISTS watch_list_votes (
      item_id INTEGER NOT NULL REFERENCES watch_list_items(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (item_id, user_id)
    );`,
    sql`CREATE TABLE IF NOT EXISTS followed_people (
      user_id INTEGER NOT NULL, person_id INTEGER NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
      notified TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, person_id)
    );`,
    sql`CREATE TABLE IF NOT EXISTS sugar_food_log (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, day_date DATE NOT NULL, name TEXT NOT NULL,
      grams NUMERIC(6,1) NOT NULL DEFAULT 0, added BOOLEAN NOT NULL DEFAULT true, code TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_sugar_food_log_user ON sugar_food_log (user_id, day_date);`,
    // v10: where the money sits — accounts & cards (card secrets only ever
    // arrive encrypted by the phone), transfers, loans, assets, trips, net
    // worth history; and per-expense account / trip / tax tag / refund link.
    sql`CREATE TABLE IF NOT EXISTS money_accounts (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'bank',
      opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0, opening_date DATE, credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
      statement_day INTEGER NOT NULL DEFAULT 0, due_day INTEGER NOT NULL DEFAULT 0, bank TEXT NOT NULL DEFAULT '',
      network TEXT NOT NULL DEFAULT '', last4 TEXT NOT NULL DEFAULT '', login_url TEXT NOT NULL DEFAULT '',
      login_username TEXT NOT NULL DEFAULT '', vault TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', archived BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_money_accounts_user ON money_accounts (user_id);`,
    sql`CREATE TABLE IF NOT EXISTS transfers (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, from_account INTEGER, to_account INTEGER,
      amount NUMERIC(14,2) NOT NULL, transfer_date DATE NOT NULL, note TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'transfer', client_request_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_transfers_user ON transfers (user_id);`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_client_request ON transfers (client_request_id);`,
    sql`CREATE TABLE IF NOT EXISTS loans (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, lender TEXT NOT NULL DEFAULT '',
      principal NUMERIC(14,2) NOT NULL, rate NUMERIC(6,3) NOT NULL DEFAULT 0, tenure_months INTEGER NOT NULL,
      start_date DATE NOT NULL, emi NUMERIC(14,2) NOT NULL DEFAULT 0, prepayments TEXT NOT NULL DEFAULT '[]',
      closed BOOLEAN NOT NULL DEFAULT false, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_loans_user ON loans (user_id);`,
    sql`CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
      value NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_assets_user ON assets (user_id);`,
    sql`CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE,
      budget NUMERIC(14,2) NOT NULL DEFAULT 0, people INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_trips_user ON trips (user_id);`,
    sql`CREATE TABLE IF NOT EXISTS networth_snapshots (
      user_id INTEGER NOT NULL, ym TEXT NOT NULL, net NUMERIC(16,2) NOT NULL, have NUMERIC(16,2) NOT NULL DEFAULT 0,
      owe NUMERIC(16,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, ym)
    );`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_id INTEGER;`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS trip_id INTEGER;`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax_tag TEXT NOT NULL DEFAULT '';`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS refund_of INTEGER;`,
    // v11: life trackers in one table (habits, health, food, renewals,
    // warranties, documents, vehicles, occasions, lent items — see
    // lib/life.js), and recurring bills paid from an account or card.
    sql`CREATE TABLE IF NOT EXISTS life_items (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER, item_date DATE,
      data TEXT NOT NULL DEFAULT '{}', photo TEXT NOT NULL DEFAULT '', vault TEXT NOT NULL DEFAULT '',
      notified TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    sql`CREATE INDEX IF NOT EXISTS idx_life_items_user_kind ON life_items (user_id, kind);`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_life_daily ON life_items (user_id, kind, (COALESCE(ref_id, 0)), item_date)
      WHERE kind IN ('habit_log', 'day_log');`,
    sql`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS account_id INTEGER;`,
    sql`INSERT INTO app_settings (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
  ]);
  ready = true;
}

// ---- Users & invites ----
export const nameKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
export async function listUsers() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, name, is_owner, (pin_hash <> '') AS has_pin, created_at FROM users ORDER BY id;`;
}
export async function countUsers() {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT count(*)::int AS n FROM users;`)[0].n;
}
export async function getUser(id) {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT * FROM users WHERE id=${id};`)[0] || null;
}
export async function getUserByName(name) {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT * FROM users WHERE name_key=${nameKey(name)};`)[0] || null;
}
export async function setUserPin(id, pinHash) {
  await ensureTables(); const sql = getSql();
  await sql`UPDATE users SET pin_hash=${pinHash}, failed_attempts=0, locked_until=0 WHERE id=${id};`;
}
export async function renameUser(id, name) {
  await ensureTables(); const sql = getSql();
  return (await sql`UPDATE users SET name=${String(name).trim()}, name_key=${nameKey(name)} WHERE id=${id} RETURNING id, name;`)[0];
}
export async function recordLoginAttempt(id, { ok, failedAttempts = 0, lockedUntil = 0 }) {
  await ensureTables(); const sql = getSql();
  if (ok) await sql`UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=${id};`;
  else await sql`UPDATE users SET failed_attempts=${failedAttempts}, locked_until=${lockedUntil} WHERE id=${id};`;
}
export async function createInvite(uid, code, days = 7) {
  await ensureTables(); const sql = getSql();
  return (await sql`INSERT INTO invites (code, created_by, expires_at) VALUES (${code}, ${uid}, now() + make_interval(days => ${days}::int))
    RETURNING code, expires_at, created_at;`)[0];
}
export async function listInvites(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT i.code, i.expires_at, i.used_at, u.name AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by
    WHERE i.created_by=${uid} ORDER BY i.created_at DESC LIMIT 20;`;
}
export async function deleteInvite(uid, code) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM invites WHERE code=${code} AND created_by=${uid} AND used_at IS NULL;`;
}
export async function checkInvite(code) {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT code FROM invites WHERE code=${code} AND used_at IS NULL AND expires_at > now();`)[0] || null;
}
// Claims the invite and creates the user in ONE statement, so a code can't
// be used twice even by two people joining at the same moment. Returns the
// new user, or null if the code is invalid, used or expired. Throws a
// unique violation (code 23505) if the name is taken — and then nothing,
// including the invite claim, is saved.
export async function joinWithInvite(code, { name, pinHash }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`WITH inv AS (
      UPDATE invites SET used_at = now() WHERE code=${code} AND used_at IS NULL AND expires_at > now() RETURNING code
    ), u AS (
      INSERT INTO users (name, name_key, pin_hash) SELECT ${String(name).trim()}, ${nameKey(name)}, ${pinHash} FROM inv RETURNING *
    )
    SELECT * FROM u;`;
  const user = rows[0] || null;
  if (user) await sql`UPDATE invites SET used_by=${user.id} WHERE code=${code};`;
  return user;
}

// ---- Settings ----
// Global (app-wide) settings: schema version, auth secret.
export async function getSetting(key) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT value FROM app_settings WHERE key=${key};`;
  return rows[0]?.value ?? null;
}
export async function setSetting(key, value) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;`;
}
// One person's settings (categories, goal, theatres…).
export async function getUserSetting(uid, key) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT value FROM user_settings WHERE user_id=${uid} AND key=${key};`;
  return rows[0]?.value ?? null;
}
export async function setUserSetting(uid, key, value) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO user_settings (user_id, key, value) VALUES (${uid}, ${key}, ${value})
    ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value;`;
}
async function getUserJson(uid, key, fallback) {
  const raw = await getUserSetting(uid, key);
  return raw ? JSON.parse(raw) : fallback;
}

/// ---- Expenses ----
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : parseInt(v, 10) || null);
const TAX_TAGS = ["80C", "80CCD1B", "80D", "80D-parents", "24b", "80E", "80G", "HRA", "80TTA"];
const cleanTaxTag = (t) => (TAX_TAGS.includes(t) ? t : "");
const EXPENSE_COLS = `id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
    account_id, trip_id, tax_tag, refund_of, (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at`;

export async function listExpenses(uid) {
  await ensureTables();
  await generateDueRecurring();
  const sql = getSql();
  // Receipt photos are large (base64); the list only says whether one exists.
  return sql.query(`SELECT ${EXPENSE_COLS} FROM expenses WHERE user_id=$1
    ORDER BY expense_date DESC, expense_time DESC NULLS LAST, created_at DESC;`, [uid]);
}
export async function getExpenseReceipt(uid, id) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT receipt_photo FROM expenses WHERE id=${id} AND user_id=${uid};`;
  return rows[0]?.receipt_photo || "";
}
// An account / trip id only counts if it's one of this person's own.
async function ownId(table, uid, id) {
  const n = intOrNull(id);
  if (n == null) return null;
  const sql = getSql();
  const rows = await sql.query(`SELECT id FROM ${table} WHERE id=$1 AND user_id=$2;`, [n, uid]);
  return rows[0] ? n : null;
}
// clientRequestId makes retries safe: if the offline queue re-sends a
// request whose first attempt actually reached the DB, the existing row is
// returned instead of inserting a duplicate.
export async function createExpense(uid, { amount, category, note, date, time, affectsBalance, receiptPhoto, clientRequestId, isEstimate, accountId, tripId, taxTag }) {
  await ensureTables(); const sql = getSql();
  const acc = await ownId("money_accounts", uid, accountId);
  const trip = await ownId("trips", uid, tripId);
  const rows = await sql`INSERT INTO expenses (user_id, amount, category, note, expense_date, expense_time, affects_balance, receipt_photo, client_request_id, is_estimate, account_id, trip_id, tax_tag)
    VALUES (${uid}, ${amount}, ${category}, ${note || ""}, ${date}, ${time || null}, ${affectsBalance !== false}, ${receiptPhoto || ""}, ${clientRequestId || null}, ${!!isEstimate}, ${acc}, ${trip}, ${cleanTaxTag(taxTag)})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING id;`;
  const id = rows[0]?.id ?? (await sql`SELECT id FROM expenses WHERE client_request_id=${clientRequestId} AND user_id=${uid};`)[0]?.id;
  return id == null ? undefined : (await sql.query(`SELECT ${EXPENSE_COLS} FROM expenses WHERE id=$1;`, [id]))[0];
}
// receiptPhoto: a data URL replaces the photo, "" removes it, and
// null/undefined keeps whatever is stored. isEstimate works the same way.
// accountId / tripId / taxTag: undefined keeps what's stored; null or ""
// clears it (no account = the main wallet). A refund always stays negative.
export async function updateExpense(uid, id, { amount, category, note, date, time, affectsBalance, receiptPhoto, isEstimate, accountId, tripId, taxTag }) {
  await ensureTables(); const sql = getSql();
  const photo = receiptPhoto === undefined ? null : receiptPhoto;
  const est = typeof isEstimate === "boolean" ? isEstimate : null;
  const setAcc = accountId !== undefined, setTrip = tripId !== undefined, setTax = taxTag !== undefined;
  const acc = setAcc ? await ownId("money_accounts", uid, accountId) : null;
  const trip = setTrip ? await ownId("trips", uid, tripId) : null;
  const rows = await sql`UPDATE expenses SET amount=CASE WHEN refund_of IS NOT NULL THEN -abs(${amount}::numeric) ELSE ${amount}::numeric END,
    category=${category}, note=${note || ""},
    expense_date=${date}, expense_time=${time || null}, affects_balance=${affectsBalance !== false},
    receipt_photo=COALESCE(${photo}, receipt_photo), is_estimate=COALESCE(${est}::boolean, is_estimate),
    account_id=CASE WHEN ${setAcc}::boolean THEN ${acc}::int ELSE account_id END,
    trip_id=CASE WHEN ${setTrip}::boolean THEN ${trip}::int ELSE trip_id END,
    tax_tag=CASE WHEN ${setTax}::boolean THEN ${cleanTaxTag(taxTag)} ELSE tax_tag END
    WHERE id=${id} AND user_id=${uid} RETURNING id;`;
  return rows[0] ? (await sql.query(`SELECT ${EXPENSE_COLS} FROM expenses WHERE id=$1;`, [rows[0].id]))[0] : undefined;
}
// "That ~Rs.500 dinner was really Rs.540": only the amount (and optionally a
// receipt) changes, and it stops being an estimate.
export async function finalizeExpense(uid, id, { amount, receiptPhoto }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE expenses SET amount=${amount}, is_estimate=false,
    receipt_photo=COALESCE(${receiptPhoto || null}, receipt_photo) WHERE id=${id} AND user_id=${uid}
    RETURNING id, amount, is_estimate;`;
  return rows[0];
}
// A refund or cashback: a negative entry in the original's category, linked
// to it, going back to the same account unless another is given. Can't
// refund more than what's left of the original.
export async function createRefund(uid, originalId, { amount, date, note, accountId, kind }) {
  await ensureTables(); const sql = getSql();
  const orig = (await sql`SELECT * FROM expenses WHERE id=${originalId} AND user_id=${uid} AND refund_of IS NULL;`)[0];
  if (!orig) return { error: "Original expense not found" };
  const done = (await sql`SELECT COALESCE(-sum(amount), 0) AS n FROM expenses WHERE refund_of=${originalId} AND user_id=${uid};`)[0].n;
  const left = Math.round((parseFloat(orig.amount) - parseFloat(done)) * 100) / 100;
  if (amount > left + 0.005) return { error: `Only ₹${left} of this expense is left to refund` };
  const acc = accountId === undefined ? orig.account_id : await ownId("money_accounts", uid, accountId);
  const label = kind === "cashback" ? "Cashback" : "Refund";
  const rows = await sql`INSERT INTO expenses (user_id, amount, category, note, expense_date, affects_balance, account_id, trip_id, refund_of)
    VALUES (${uid}, ${-amount}, ${orig.category}, ${note || `${label}: ${orig.note || orig.category}`}, ${date}, ${orig.affects_balance}, ${acc}, ${orig.trip_id}, ${originalId})
    RETURNING id;`;
  return { refund: (await sql.query(`SELECT ${EXPENSE_COLS} FROM expenses WHERE id=$1;`, [rows[0].id]))[0] };
}
// Many expenses at once (statement import). Each row's clientRequestId is
// derived from the statement line, so importing the same file twice adds
// nothing the second time.
export async function createExpensesBulk(uid, rows) {
  await ensureTables(); const sql = getSql();
  if (!rows.length) return 0;
  const accIds = new Set((await sql`SELECT id FROM money_accounts WHERE user_id=${uid};`).map((r) => r.id));
  const out = await sql.transaction(rows.map((r) => sql`INSERT INTO expenses (user_id, amount, category, note, expense_date, affects_balance, client_request_id, account_id)
    VALUES (${uid}, ${r.amount}, ${r.category}, ${r.note || ""}, ${r.date}, ${r.affectsBalance !== false}, ${r.clientRequestId}, ${accIds.has(r.accountId) ? r.accountId : null})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING id;`));
  return out.reduce((n, x) => n + x.length, 0);
}
export async function deleteExpense(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM expenses WHERE id=${id} AND user_id=${uid};`;
}

// ---- Movies ----
export async function listMovies(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM movies WHERE user_id=${uid} ORDER BY watched_date DESC, created_at DESC;`;
}
const cleanRating = (r) => (r == null || r === "" ? null : Math.min(5, Math.max(1, parseInt(r, 10) || 0)) || null);
const cleanTmdb = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
export async function createMovie(uid, { title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity, venueType, venueName, genre, clientRequestId, rating, review, tmdbId }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO movies (user_id, title, watched_date, watched_time, ticket_price, canteen_price, companions, my_take, public_take, note, affects_balance, quantity, venue_type, venue_name, genre, client_request_id, rating, review, tmdb_id)
    VALUES (${uid}, ${title}, ${date}, ${time || null}, ${ticketPrice || 0}, ${canteenPrice || 0}, ${companions || ""}, ${myTake || ""}, ${publicTake || ""}, ${note || ""}, ${affectsBalance !== false}, ${quantity || 1}, ${venueType || "Theatre"}, ${venueName || ""}, ${genre || ""}, ${clientRequestId || null}, ${cleanRating(rating)}, ${(review || "").slice(0, 280)}, ${cleanTmdb(tmdbId)})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING *;`;
  if (rows[0]) return rows[0];
  const existing = await sql`SELECT * FROM movies WHERE client_request_id=${clientRequestId} AND user_id=${uid};`;
  return existing[0];
}
export async function updateMovie(uid, id, { title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity, venueType, venueName, genre, rating, review, tmdbId }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE movies SET title=${title}, watched_date=${date}, watched_time=${time || null}, ticket_price=${ticketPrice || 0}, canteen_price=${canteenPrice || 0},
    companions=${companions || ""}, my_take=${myTake || ""}, public_take=${publicTake || ""}, note=${note || ""},
    affects_balance=${affectsBalance !== false}, quantity=${quantity || 1}, venue_type=${venueType || "Theatre"}, venue_name=${venueName || ""}, genre=${genre || ""},
    rating=${cleanRating(rating)}, review=${(review || "").slice(0, 280)}, tmdb_id=COALESCE(${cleanTmdb(tmdbId)}::int, tmdb_id)
    WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
// After the show: fill in what you only know afterwards (takes, stars,
// review, snacks, who came) without touching the booking details.
const TAKE_VALUES = ["loved", "liked", "okay", "disliked"];
export async function rateMovie(uid, id, { myTake, publicTake, rating, review, canteenPrice, companions }) {
  await ensureTables(); const sql = getSql();
  const mine = TAKE_VALUES.includes(myTake) ? myTake : "";
  const pub = TAKE_VALUES.includes(publicTake) ? publicTake : "";
  const canteen = canteenPrice == null || canteenPrice === "" ? null : Math.max(0, parseFloat(canteenPrice) || 0);
  const who = companions == null ? null : String(companions).trim().slice(0, 120);
  const rows = await sql`UPDATE movies SET my_take=${mine}, public_take=${pub}, rating=${cleanRating(rating)},
    review=${String(review || "").trim().slice(0, 280)}, canteen_price=COALESCE(${canteen}::numeric, canteen_price),
    companions=COALESCE(${who}, companions) WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
// Remember which TMDB film a logged movie is (0 = looked up, no match).
export async function setMovieTmdbId(uid, id, tmdbId) {
  await ensureTables(); const sql = getSql();
  await sql`UPDATE movies SET tmdb_id=${tmdbId} WHERE id=${id} AND user_id=${uid};`;
}
export async function deleteMovie(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM movies WHERE id=${id} AND user_id=${uid};`;
}

// ---- Recurring generation (everyone's at once) ----
// Claim-and-insert in ONE statement: the UPDATE marks the template done for
// this month, and only the caller whose UPDATE actually changed the row gets
// it back from RETURNING. Concurrent page loads (or a page load racing the
// daily cron) therefore can't insert the same item twice. Each generated row
// goes to the template's owner. Dates use the app's timezone (IST), and a
// day of 29–31 lands on the last day of shorter months.
async function generateDueRecurringIncome() {
  const sql = getSql();
  const { year, month, day, ym } = localDateParts();
  const dim = daysInMonth(year, month);
  await sql`WITH claimed AS (
      UPDATE recurring_income SET last_generated_month = ${ym}
      WHERE last_generated_month IS DISTINCT FROM ${ym} AND LEAST(day_of_month, ${dim}::int) <= ${day}::int
      RETURNING user_id, amount, note, LEAST(day_of_month, ${dim}::int) AS d
    )
    INSERT INTO balance_topups (user_id, amount, note, topup_date, mode)
    SELECT user_id, amount, COALESCE(NULLIF(note, ''), '(recurring income)'), make_date(${year}::int, ${month}::int, d), 'add'
    FROM claimed;`;
}
async function generateDueRecurring() {
  const sql = getSql();
  const { year, month, day, ym } = localDateParts();
  const dim = daysInMonth(year, month);
  await sql`WITH claimed AS (
      UPDATE recurring_expenses SET last_generated_month = ${ym}
      WHERE NOT variable AND last_generated_month IS DISTINCT FROM ${ym} AND LEAST(day_of_month, ${dim}::int) <= ${day}::int
      RETURNING user_id, amount, category, note, affects_balance, account_id, LEAST(day_of_month, ${dim}::int) AS d
    )
    INSERT INTO expenses (user_id, amount, category, note, expense_date, affects_balance, account_id)
    SELECT user_id, amount, category, COALESCE(NULLIF(note, ''), '(recurring)'), make_date(${year}::int, ${month}::int, d), affects_balance, account_id
    FROM claimed;`;
}
export async function generateAllRecurring() {
  await ensureTables();
  await generateDueRecurring();
  await generateDueRecurringIncome();
}

// ---- Balance top-ups ----
export async function listTopups(uid) {
  await ensureTables();
  await generateDueRecurringIncome();
  const sql = getSql();
  return sql`SELECT * FROM balance_topups WHERE user_id=${uid} ORDER BY topup_date DESC, created_at DESC;`;
}
export async function createTopup(uid, { amount, note, date, mode }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO balance_topups (user_id, amount, note, topup_date, mode)
    VALUES (${uid}, ${amount}, ${note || ""}, ${date}, ${mode === "set" ? "set" : "add"}) RETURNING *;`;
  return rows[0];
}
export async function updateTopup(uid, id, { amount, note, date, mode }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE balance_topups SET amount=${amount}, note=${note || ""}, topup_date=${date},
    mode=${mode === "set" ? "set" : "add"} WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
export async function deleteTopup(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM balance_topups WHERE id=${id} AND user_id=${uid};`;
}

// ---- Budget rules ----
export async function listBudgetRules(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM budget_rules WHERE user_id=${uid} ORDER BY rule_type, category;`;
}
export async function upsertBudgetRule(uid, { ruleType, category, amount }) {
  await ensureTables(); const sql = getSql();
  const cat = ruleType === "category" ? category : "";
  const rows = await sql`INSERT INTO budget_rules (user_id, rule_type, category, amount, updated_at)
    VALUES (${uid}, ${ruleType}, ${cat}, ${amount}, now())
    ON CONFLICT (user_id, rule_type, category) DO UPDATE SET amount=EXCLUDED.amount, updated_at=now() RETURNING *;`;
  return rows[0];
}
export async function deleteBudgetRule(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM budget_rules WHERE id=${id} AND user_id=${uid};`;
}

// ---- Sugar challenge ----
export async function getChallengeMeta(uid) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT * FROM sugar_challenge_meta WHERE user_id=${uid};`;
  return rows[0] || null;
}
export async function setChallengeMeta(uid, startDate, lengthDays, sugarPerDay, savingsPerDay) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO sugar_challenge_meta (id, user_id, start_date, length_days, sugar_per_day, savings_per_day)
    VALUES (${uid}, ${uid}, ${startDate}, ${lengthDays}, ${sugarPerDay || 0}, ${savingsPerDay || 0})
    ON CONFLICT (user_id) DO UPDATE SET start_date=EXCLUDED.start_date, length_days=EXCLUDED.length_days,
      sugar_per_day=EXCLUDED.sugar_per_day, savings_per_day=EXCLUDED.savings_per_day RETURNING *;`;
  return rows[0];
}
export async function listChallengeDays(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT day_date, completed, note, reason, natural_sugar FROM sugar_challenge_days WHERE user_id=${uid} ORDER BY day_date;`;
}
export async function upsertChallengeDay(uid, date, completed, note, reason, naturalSugar) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO sugar_challenge_days (user_id, day_date, completed, note, reason, natural_sugar, updated_at)
    VALUES (${uid}, ${date}, ${completed}, ${note || ""}, ${reason || ""}, ${!!naturalSugar}, now())
    ON CONFLICT (user_id, day_date) DO UPDATE SET completed=EXCLUDED.completed, note=EXCLUDED.note, reason=EXCLUDED.reason,
      natural_sugar=EXCLUDED.natural_sugar, updated_at=now() RETURNING *;`;
  return rows[0];
}
export async function archiveChallenge(uid, { startDate, lengthDays, completedDays, longestStreak }) {
  await ensureTables(); const sql = getSql();
  // All-or-nothing: never leave history saved but days not cleared (or vice versa).
  await sql.transaction([
    sql`INSERT INTO sugar_challenge_history (user_id, start_date, length_days, completed_days, longest_streak)
      VALUES (${uid}, ${startDate}, ${lengthDays}, ${completedDays}, ${longestStreak});`,
    sql`DELETE FROM sugar_challenge_days WHERE user_id=${uid};`,
    sql`DELETE FROM sugar_challenge_meta WHERE user_id=${uid};`,
  ]);
}
export async function listChallengeHistory(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM sugar_challenge_history WHERE user_id=${uid} ORDER BY ended_at DESC;`;
}

// ---- Recurring expenses ----
export async function listRecurring(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM recurring_expenses WHERE user_id=${uid} ORDER BY day_of_month;`;
}
// upiId: optional payee (e.g. landlord@okhdfc) so the bill reminder can
// open a UPI app with the amount filled in.
const cleanUpi = (u) => (/^[\w.-]{2,64}@[a-zA-Z]{2,64}$/.test(String(u || "").trim()) ? String(u).trim() : "");
export async function createRecurring(uid, { amount, category, note, dayOfMonth, affectsBalance, upiId, variable, accountId }) {
  await ensureTables(); const sql = getSql();
  const acc = await ownId("money_accounts", uid, accountId);
  const rows = await sql`INSERT INTO recurring_expenses (user_id, amount, category, note, day_of_month, affects_balance, upi_id, variable, account_id)
    VALUES (${uid}, ${amount}, ${category}, ${note || ""}, ${dayOfMonth}, ${affectsBalance !== false}, ${cleanUpi(upiId)}, ${!!variable}, ${acc}) RETURNING *;`;
  return rows[0];
}
// accountId: undefined keeps the stored account; null = main wallet.
export async function updateRecurring(uid, id, { amount, category, note, dayOfMonth, affectsBalance, upiId, variable, accountId }) {
  await ensureTables(); const sql = getSql();
  const setAcc = accountId !== undefined;
  const acc = setAcc ? await ownId("money_accounts", uid, accountId) : null;
  const rows = await sql`UPDATE recurring_expenses SET amount=${amount}, category=${category}, note=${note || ""},
    day_of_month=${dayOfMonth}, affects_balance=${affectsBalance !== false}, upi_id=${cleanUpi(upiId)}, variable=${!!variable},
    account_id=CASE WHEN ${setAcc}::boolean THEN ${acc}::int ELSE account_id END
    WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
export async function deleteRecurring(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM recurring_expenses WHERE id=${id} AND user_id=${uid};`;
}
// A bill whose amount changes ("amount varies"): you say what it came to
// this month. Claims the month (so it's asked once) and logs the expense in
// one statement; the amount becomes next month's estimate. Logged on the due
// day, or today if you paid early. Returns null if already logged.
export async function logVariableBill(uid, id, amount) {
  await ensureTables(); const sql = getSql();
  const { year, month, day, ym } = localDateParts();
  const dim = daysInMonth(year, month);
  const rows = await sql`WITH claimed AS (
      UPDATE recurring_expenses SET last_generated_month = ${ym}, amount = ${amount}
      WHERE id = ${id} AND user_id = ${uid} AND last_generated_month IS DISTINCT FROM ${ym}
      RETURNING user_id, category, note, affects_balance, account_id, LEAST(day_of_month, ${dim}::int, ${day}::int) AS d
    )
    INSERT INTO expenses (user_id, amount, category, note, expense_date, affects_balance, account_id)
    SELECT user_id, ${amount}, category, COALESCE(NULLIF(note, ''), '(recurring)'), make_date(${year}::int, ${month}::int, d), affects_balance, account_id
    FROM claimed RETURNING id;`;
  return rows[0] || null;
}
// Bills you confirmed as paid via UPI, as { [billId]: "YYYY-MM" }.
export async function getBillsPaid(uid) {
  return getUserJson(uid, "bills_paid", {});
}
export async function markBillPaid(uid, id, ym, paid = true) {
  const map = await getBillsPaid(uid);
  if (paid) map[id] = ym;
  else delete map[id];
  await setUserSetting(uid, "bills_paid", JSON.stringify(map));
  return map;
}

// ---- Weekly server-side backups (#14). The last 4 per person are kept. ----
export async function saveBackup(uid, payloadJson) {
  await ensureTables(); const sql = getSql();
  await sql.transaction([
    sql`INSERT INTO backups (user_id, payload, size_bytes) VALUES (${uid}, ${payloadJson}, ${payloadJson.length});`,
    sql`DELETE FROM backups WHERE user_id=${uid} AND id NOT IN (SELECT id FROM backups WHERE user_id=${uid} ORDER BY created_at DESC LIMIT 4);`,
  ]);
}
export async function listBackups(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, size_bytes, created_at FROM backups WHERE user_id=${uid} ORDER BY created_at DESC;`;
}
export async function getBackup(uid, id) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT payload FROM backups WHERE id=${id} AND user_id=${uid};`;
  return rows[0] ? rows[0].payload : null;
}

// ---- Shared spaces (#15) ----
export async function listSharedGroups(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT g.*, (SELECT count(*)::int FROM shared_entries e WHERE e.group_id = g.id) AS entry_count
    FROM shared_groups g WHERE g.user_id=${uid} ORDER BY g.created_at DESC;`;
}
export async function createSharedGroup(uid, { name, members, token }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO shared_groups (user_id, name, token, members) VALUES (${uid}, ${name}, ${token}, ${JSON.stringify(members)}) RETURNING *;`;
  return rows[0];
}
export async function deleteSharedGroup(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM shared_groups WHERE id=${id} AND user_id=${uid};`;
}
// Public, token-scoped (the link is the key).
export async function getSharedGroupByToken(token) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT * FROM shared_groups WHERE token=${token};`;
  return rows[0] || null;
}
export async function listSharedEntries(groupId) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM shared_entries WHERE group_id=${groupId} ORDER BY entry_date DESC, created_at DESC;`;
}
export async function createSharedEntry(groupId, { payer, amount, note, date, splitWith }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO shared_entries (group_id, payer, amount, note, entry_date, split_with)
    VALUES (${groupId}, ${payer}, ${amount}, ${note || ""}, ${date}, ${JSON.stringify(splitWith || [])}) RETURNING *;`;
  return rows[0];
}
export async function deleteSharedEntry(groupId, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM shared_entries WHERE id=${id} AND group_id=${groupId};`;
}

// ---- Full data import (disaster recovery from an export-all backup) ----
//
// Imports into ONE person's data. Safe to run more than once, and
// all-or-nothing per call:
// - Every row keeps its original created_at from the backup. A row whose
//   created_at (to the millisecond — JSON exports drop microseconds) and key
//   fields already exist for this person is skipped, so importing the same
//   file twice never duplicates anything.
// - All writes for one call run in a single transaction.
const isoDate = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const hhmm = (v) => (v ? String(v).slice(0, 5) : null);
const ts = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
const num = (v) => parseFloat(v) || 0;

export async function importAll(uid, data) {
  await ensureTables();
  const sql = getSql();
  const q = []; // [section, query]
  // Accounts/trips first: expenses point at them by their new ids.
  const money = await importMoney(uid, data);
  const lifeAdded = Array.isArray(data.life) ? await importLife(uid, data.life) : 0;
  if (lifeAdded) money.counts.life = lifeAdded;
  const accOf = (id) => (id == null ? null : money.accMap[id] ?? null);
  const tripOf = (id) => (id == null ? null : money.tripMap[id] ?? null);

  for (const x of data.expenses || []) {
    const c = ts(x.created_at);
    q.push(["expenses", sql`INSERT INTO expenses (user_id, amount, category, note, expense_date, expense_time, affects_balance, receipt_photo, is_estimate,
        account_id, trip_id, tax_tag, created_at)
      SELECT ${uid}, ${num(x.amount)}, ${x.category}, ${x.note || ""}, ${isoDate(x.expense_date)}, ${hhmm(x.expense_time)},
        ${x.affects_balance !== false}, ${x.receipt_photo || ""}, ${!!x.is_estimate},
        ${accOf(x.account_id)}::int, ${tripOf(x.trip_id)}::int, ${cleanTaxTag(x.tax_tag)}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM expenses WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz)
          AND amount = ${num(x.amount)} AND expense_date = ${isoDate(x.expense_date)})
      RETURNING id;`]);
  }

  for (const m of data.movies || []) {
    const c = ts(m.created_at);
    q.push(["movies", sql`INSERT INTO movies (user_id, title, watched_date, watched_time, ticket_price, canteen_price, companions, my_take, public_take,
        note, affects_balance, quantity, venue_type, venue_name, genre, rating, review, tmdb_id, created_at)
      SELECT ${uid}, ${m.title}, ${isoDate(m.watched_date)}, ${hhmm(m.watched_time)}, ${num(m.ticket_price)}, ${num(m.canteen_price)},
        ${m.companions || ""}, ${m.my_take || ""}, ${m.public_take || ""}, ${m.note || ""}, ${m.affects_balance !== false},
        ${parseInt(m.quantity, 10) || 1}, ${m.venue_type || "Theatre"}, ${m.venue_name || ""}, ${m.genre || ""}, ${cleanRating(m.rating)}, ${m.review || ""}, ${cleanTmdb(m.tmdb_id)}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM movies WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND title = ${m.title})
      RETURNING id;`]);
  }

  for (const t of data.topups || []) {
    const c = ts(t.created_at);
    q.push(["topups", sql`INSERT INTO balance_topups (user_id, amount, note, topup_date, mode, created_at)
      SELECT ${uid}, ${num(t.amount)}, ${t.note || ""}, ${isoDate(t.topup_date)}, ${t.mode === "set" ? "set" : "add"}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM balance_topups WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND amount = ${num(t.amount)})
      RETURNING id;`]);
  }

  for (const r of data.budgetRules || []) {
    const cat = r.rule_type === "category" ? r.category : "";
    q.push(["budgetRules", sql`INSERT INTO budget_rules (user_id, rule_type, category, amount, updated_at)
      VALUES (${uid}, ${r.rule_type}, ${cat}, ${num(r.amount)}, now())
      ON CONFLICT (user_id, rule_type, category) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now() RETURNING id;`]);
  }

  // last_generated_month is kept so an import doesn't re-add this month's
  // recurring items a second time.
  for (const r of data.recurring || []) {
    const c = ts(r.created_at);
    q.push(["recurring", sql`INSERT INTO recurring_expenses (user_id, amount, category, note, day_of_month, affects_balance, last_generated_month, upi_id, variable, created_at)
      SELECT ${uid}, ${num(r.amount)}, ${r.category}, ${r.note || ""}, ${parseInt(r.day_of_month, 10)}, ${r.affects_balance !== false},
        ${r.last_generated_month || ""}, ${cleanUpi(r.upi_id)}, ${!!r.variable}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM recurring_expenses WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz))
      RETURNING id;`]);
  }

  for (const r of data.recurringIncome || []) {
    const c = ts(r.created_at);
    q.push(["recurringIncome", sql`INSERT INTO recurring_income (user_id, amount, note, day_of_month, last_generated_month, created_at)
      SELECT ${uid}, ${num(r.amount)}, ${r.note || ""}, ${parseInt(r.day_of_month, 10)}, ${r.last_generated_month || ""}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM recurring_income WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz))
      RETURNING id;`]);
  }

  for (const i of data.ious || []) {
    const c = ts(i.created_at);
    q.push(["ious", sql`INSERT INTO ious (user_id, person_name, amount, direction, note, due_date, settled, created_at)
      SELECT ${uid}, ${i.person_name}, ${num(i.amount)}, ${i.direction}, ${i.note || ""}, ${isoDate(i.due_date)}, ${!!i.settled}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM ious WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND person_name = ${i.person_name})
      RETURNING id;`]);
  }

  for (const w of data.watchlist || []) {
    const c = ts(w.created_at);
    q.push(["watchlist", sql`INSERT INTO movie_watchlist (user_id, title, note, tmdb_id, release_date, created_at)
      SELECT ${uid}, ${w.title}, ${w.note || ""}, ${cleanTmdb(w.tmdb_id)}, ${isoDate(w.release_date)}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM movie_watchlist WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND title = ${w.title})
      RETURNING id;`]);
  }

  for (const f of data.sugarFoodLog || []) {
    if (!f?.name || !f.day_date) continue;
    q.push(["sugarFoodLog", sql`INSERT INTO sugar_food_log (user_id, day_date, name, grams, added, code)
      SELECT ${uid}, ${isoDate(f.day_date)}, ${f.name}, ${num(f.grams)}, ${f.added !== false}, ${f.code || ""}
      WHERE NOT EXISTS (SELECT 1 FROM sugar_food_log WHERE user_id = ${uid} AND day_date = ${isoDate(f.day_date)} AND name = ${f.name} AND grams = ${num(f.grams)})
      RETURNING id;`]);
  }
  for (const t of data.tvShows || []) {
    const c = ts(t.created_at);
    q.push(["tvShows", sql`INSERT INTO tv_shows (user_id, tmdb_id, title, poster, platform, status, season, episode, rating, note, created_at)
      SELECT ${uid}, ${cleanTmdb(t.tmdb_id)}, ${t.title}, ${t.poster || ""}, ${t.platform || ""}, ${t.status || "watching"},
        ${parseInt(t.season, 10) || 1}, ${parseInt(t.episode, 10) || 0}, ${cleanRating(t.rating)}, ${t.note || ""}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM tv_shows WHERE user_id = ${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND title = ${t.title})
      RETURNING id;`]);
  }

  const sc = data.sugarChallenge || {};
  if (sc.meta) {
    const m = sc.meta;
    q.push(["challengeMeta", sql`INSERT INTO sugar_challenge_meta (id, user_id, start_date, length_days, sugar_per_day, savings_per_day)
      VALUES (${uid}, ${uid}, ${isoDate(m.start_date)}, ${parseInt(m.length_days, 10) || 41}, ${num(m.sugar_per_day)}, ${num(m.savings_per_day)})
      ON CONFLICT (user_id) DO UPDATE SET start_date=EXCLUDED.start_date, length_days=EXCLUDED.length_days,
        sugar_per_day=EXCLUDED.sugar_per_day, savings_per_day=EXCLUDED.savings_per_day RETURNING id;`]);
  }
  for (const d of sc.days || []) {
    q.push(["challengeDays", sql`INSERT INTO sugar_challenge_days (user_id, day_date, completed, note, reason, natural_sugar, updated_at)
      VALUES (${uid}, ${isoDate(d.day_date)}, ${!!d.completed}, ${d.note || ""}, ${d.reason || ""}, ${!!d.natural_sugar}, now())
      ON CONFLICT (user_id, day_date) DO UPDATE SET completed=EXCLUDED.completed, note=EXCLUDED.note, reason=EXCLUDED.reason,
        natural_sugar=EXCLUDED.natural_sugar, updated_at=now() RETURNING id;`]);
  }
  for (const h of sc.history || []) {
    const e = ts(h.ended_at);
    q.push(["challengeHistory", sql`INSERT INTO sugar_challenge_history (user_id, start_date, length_days, completed_days, longest_streak, ended_at)
      SELECT ${uid}, ${isoDate(h.start_date)}, ${parseInt(h.length_days, 10) || 0}, ${parseInt(h.completed_days, 10) || 0},
        ${parseInt(h.longest_streak, 10) || 0}, COALESCE(${e}::timestamptz, now())
      WHERE ${e}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM sugar_challenge_history WHERE user_id = ${uid} AND date_trunc('milliseconds', ended_at) = date_trunc('milliseconds', ${e}::timestamptz))
      RETURNING id;`]);
  }

  // Simple settings stored as JSON.
  const settings = [
    ["custom_categories", data.customCategories, Array.isArray(data.customCategories)],
    ["custom_theatres", data.theatres, Array.isArray(data.theatres)],
    ["custom_ott_platforms", data.ottPlatforms, Array.isArray(data.ottPlatforms)],
    ["savings_goal", data.savingsGoal, !!data.savingsGoal],
    ["milestone_rewards", data.milestoneRewards, !!data.milestoneRewards && typeof data.milestoneRewards === "object"],
    ["mini_challenges", data.miniChallenges, Array.isArray(data.miniChallenges)],
  ];
  for (const [key, value, present] of settings) {
    if (!present) continue;
    q.push(["settings", sql`INSERT INTO user_settings (user_id, key, value) VALUES (${uid}, ${key}, ${JSON.stringify(value)})
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value RETURNING key;`]);
  }

  const results = { ...money.counts };
  if (q.length === 0) return results;
  const out = await sql.transaction(q.map(([, query]) => query));
  q.forEach(([section], i) => {
    results[section] = (results[section] || 0) + out[i].length;
  });

  // Re-link refunds to their originals (both found by their created_at).
  const byId = new Map((data.expenses || []).map((x) => [x.id, x]));
  const links = (data.expenses || []).filter((x) => x.refund_of != null && byId.get(x.refund_of)?.created_at && x.created_at).map((x) => {
    const c = ts(x.created_at), o = ts(byId.get(x.refund_of).created_at);
    return sql`UPDATE expenses SET refund_of = (SELECT id FROM expenses WHERE user_id=${uid} AND refund_of IS NULL
        AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${o}::timestamptz) LIMIT 1)
      WHERE user_id=${uid} AND refund_of IS NULL AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) RETURNING id;`;
  });
  if (links.length) await sql.transaction(links);
  return results;
}

// ---- Push notification subscriptions (a device belongs to whoever last
// turned notifications on from it) ----
export async function saveSubscription(uid, { endpoint, p256dh, auth }) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${uid}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth;`;
}
export async function listSubscriptions(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM push_subscriptions WHERE user_id=${uid};`;
}
export async function deleteSubscription(endpoint) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM push_subscriptions WHERE endpoint=${endpoint};`;
}

// ---- Recurring income ----
export async function listRecurringIncome(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM recurring_income WHERE user_id=${uid} ORDER BY day_of_month;`;
}
export async function createRecurringIncome(uid, { amount, note, dayOfMonth }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO recurring_income (user_id, amount, note, day_of_month)
    VALUES (${uid}, ${amount}, ${note || ""}, ${dayOfMonth}) RETURNING *;`;
  return rows[0];
}
export async function updateRecurringIncome(uid, id, { amount, note, dayOfMonth }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE recurring_income SET amount=${amount}, note=${note || ""}, day_of_month=${dayOfMonth}
    WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
export async function deleteRecurringIncome(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM recurring_income WHERE id=${id} AND user_id=${uid};`;
}

// ---- Who-owes-what (IOUs) ----
export async function listIous(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM ious WHERE user_id=${uid} ORDER BY settled ASC, due_date ASC NULLS LAST, created_at DESC;`;
}
export async function createIou(uid, { personName, amount, direction, note, dueDate }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO ious (user_id, person_name, amount, direction, note, due_date)
    VALUES (${uid}, ${personName}, ${amount}, ${direction}, ${note || ""}, ${dueDate || null}) RETURNING *;`;
  return rows[0];
}
export async function updateIou(uid, id, { personName, amount, direction, note, dueDate, settled }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE ious SET person_name=${personName}, amount=${amount}, direction=${direction},
    note=${note || ""}, due_date=${dueDate || null}, settled=${!!settled} WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
export async function deleteIou(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM ious WHERE id=${id} AND user_id=${uid};`;
}

// ---- Movie watchlist ----
export async function listWatchlist(uid) {
  await ensureTables(); const sql = getSql();
  // Your drag-and-drop order first; anything never reordered goes on top,
  // newest first (so a just-added movie is easy to see).
  return sql`SELECT * FROM movie_watchlist WHERE user_id=${uid}
    ORDER BY position IS NOT NULL, position ASC, created_at DESC;`;
}
export async function createWatchlistItem(uid, { title, note, tmdbId, releaseDate }) {
  await ensureTables(); const sql = getSql();
  const rel = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || "") ? releaseDate : null;
  const rows = await sql`INSERT INTO movie_watchlist (user_id, title, note, tmdb_id, release_date)
    VALUES (${uid}, ${title}, ${note || ""}, ${cleanTmdb(tmdbId)}, ${rel}) RETURNING *;`;
  return rows[0];
}
// Release date / streaming bookkeeping for one watchlist item (from TMDB).
export async function updateWatchlistMeta(uid, id, { tmdbId, releaseDate, lastProviders, notified }) {
  await ensureTables(); const sql = getSql();
  const rel = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || "") ? releaseDate : null;
  await sql`UPDATE movie_watchlist SET tmdb_id=COALESCE(${tmdbId ?? null}::int, tmdb_id), release_date=COALESCE(${rel}::date, release_date),
    last_providers=COALESCE(${lastProviders ?? null}, last_providers), notified=COALESCE(${notified ?? null}, notified)
    WHERE id=${id} AND user_id=${uid};`;
}
export async function deleteWatchlistItem(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM movie_watchlist WHERE id=${id} AND user_id=${uid};`;
}

// ---- Savings goal, streak rewards, "still using this?" confirmations ----
export const getSavingsGoal = (uid) => getUserJson(uid, "savings_goal", null);
export async function setSavingsGoal(uid, goal) {
  await setUserSetting(uid, "savings_goal", JSON.stringify(goal));
  return goal;
}
export const getMilestoneRewards = (uid) => getUserJson(uid, "milestone_rewards", {});
export async function setMilestoneRewards(uid, rewards) {
  await setUserSetting(uid, "milestone_rewards", JSON.stringify(rewards));
  return rewards;
}
export const getRecurringConfirmations = (uid) => getUserJson(uid, "recurring_confirmations", {});
export async function confirmRecurring(uid, id) {
  const map = await getRecurringConfirmations(uid);
  map[id] = new Date().toISOString().slice(0, 10);
  await setUserSetting(uid, "recurring_confirmations", JSON.stringify(map));
  return map;
}

// ---- TMDB cache (shared by everyone: it's public movie data) ----
export async function getCache(key) {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT data, fetched_at FROM tmdb_cache WHERE key=${key};`)[0] || null;
}
export async function setCache(key, data) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO tmdb_cache (key, data, fetched_at) VALUES (${key}, ${data}, now())
    ON CONFLICT (key) DO UPDATE SET data=EXCLUDED.data, fetched_at=now();`;
}

// ---- TV shows you're watching ----
const TV_STATUS = ["watching", "finished", "paused", "plan"];
export async function listTvShows(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM tv_shows WHERE user_id=${uid} ORDER BY (status = 'watching') DESC, updated_at DESC;`;
}
export async function createTvShow(uid, { tmdbId, title, poster, platform, status, season, episode, note }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO tv_shows (user_id, tmdb_id, title, poster, platform, status, season, episode, note)
    VALUES (${uid}, ${cleanTmdb(tmdbId)}, ${title}, ${poster || ""}, ${platform || ""}, ${TV_STATUS.includes(status) ? status : "watching"},
      ${Math.max(1, parseInt(season, 10) || 1)}, ${Math.max(0, parseInt(episode, 10) || 0)}, ${note || ""}) RETURNING *;`;
  return rows[0];
}
export async function updateTvShow(uid, id, { platform, status, season, episode, rating, note }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE tv_shows SET platform=${platform || ""}, status=${TV_STATUS.includes(status) ? status : "watching"},
    season=${Math.max(1, parseInt(season, 10) || 1)}, episode=${Math.max(0, parseInt(episode, 10) || 0)},
    rating=${cleanRating(rating)}, note=${note || ""}, updated_at=now() WHERE id=${id} AND user_id=${uid} RETURNING *;`;
  return rows[0];
}
export async function deleteTvShow(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM tv_shows WHERE id=${id} AND user_id=${uid};`;
}

// Save a new watchlist order (ids top to bottom). Only your own rows move.
export async function reorderWatchlist(uid, ids) {
  await ensureTables(); const sql = getSql();
  const clean = ids.map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 500);
  if (!clean.length) return;
  await sql.transaction(clean.map((id, i) => sql`UPDATE movie_watchlist SET position=${i} WHERE id=${id} AND user_id=${uid};`));
}

// ---- Watch-together lists: a watchlist several people share ----
async function isListMember(uid, listId) {
  const sql = getSql();
  return (await sql`SELECT 1 FROM watch_list_members WHERE list_id=${listId} AND user_id=${uid};`).length > 0;
}
export async function listWatchLists(uid) {
  await ensureTables(); const sql = getSql();
  const lists = await sql`SELECT l.id, l.name, l.owner_id, l.created_at FROM watch_lists l
    JOIN watch_list_members m ON m.list_id = l.id WHERE m.user_id=${uid} ORDER BY l.created_at;`;
  if (!lists.length) return [];
  const ids = lists.map((l) => l.id);
  const [members, items] = await Promise.all([
    sql`SELECT m.list_id, u.id, u.name FROM watch_list_members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ANY(${ids}) ORDER BY u.id;`,
    sql`SELECT i.*, u.name AS added_by_name,
        (SELECT COUNT(*)::int FROM watch_list_votes v WHERE v.item_id = i.id) AS votes,
        EXISTS (SELECT 1 FROM watch_list_votes v WHERE v.item_id = i.id AND v.user_id = ${uid}) AS my_vote,
        (SELECT string_agg(vu.name, ', ' ORDER BY vu.id) FROM watch_list_votes v JOIN users vu ON vu.id = v.user_id WHERE v.item_id = i.id) AS voters
      FROM watch_list_items i LEFT JOIN users u ON u.id = i.added_by
      WHERE i.list_id = ANY(${ids}) ORDER BY i.watched ASC, votes DESC, i.created_at DESC;`,
  ]);
  return lists.map((l) => ({
    ...l,
    members: members.filter((m) => m.list_id === l.id).map((m) => ({ id: m.id, name: m.name })),
    items: items.filter((i) => i.list_id === l.id),
  }));
}
export async function createWatchList(uid, name, memberIds) {
  await ensureTables(); const sql = getSql();
  const list = (await sql`INSERT INTO watch_lists (owner_id, name) VALUES (${uid}, ${name}) RETURNING *;`)[0];
  const all = [...new Set([uid, ...memberIds])];
  await sql.transaction(all.map((m) => sql`INSERT INTO watch_list_members (list_id, user_id) VALUES (${list.id}, ${m}) ON CONFLICT DO NOTHING;`));
  return list;
}
// The owner deletes the list for everyone; anyone else just leaves it.
export async function leaveOrDeleteWatchList(uid, listId) {
  await ensureTables(); const sql = getSql();
  const l = (await sql`SELECT owner_id FROM watch_lists WHERE id=${listId};`)[0];
  if (!l) return;
  if (l.owner_id === uid) await sql`DELETE FROM watch_lists WHERE id=${listId};`;
  else await sql`DELETE FROM watch_list_members WHERE list_id=${listId} AND user_id=${uid};`;
}
export async function addWatchListItem(uid, listId, { title, tmdbId, note }) {
  await ensureTables(); const sql = getSql();
  if (!(await isListMember(uid, listId))) return null;
  return (await sql`INSERT INTO watch_list_items (list_id, added_by, title, tmdb_id, note)
    VALUES (${listId}, ${uid}, ${title}, ${cleanTmdb(tmdbId)}, ${note || ""}) RETURNING *;`)[0];
}
export async function updateWatchListItem(uid, id, { watched }) {
  await ensureTables(); const sql = getSql();
  return (await sql`UPDATE watch_list_items SET watched=${!!watched}
    WHERE id=${id} AND list_id IN (SELECT list_id FROM watch_list_members WHERE user_id=${uid}) RETURNING *;`)[0] || null;
}
export async function deleteWatchListItem(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM watch_list_items WHERE id=${id} AND list_id IN (SELECT list_id FROM watch_list_members WHERE user_id=${uid});`;
}
// Other members of a list (for "Ravi added X" notifications).
export async function watchListOthers(uid, listId) {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT user_id FROM watch_list_members WHERE list_id=${listId} AND user_id <> ${uid};`).map((r) => r.user_id);
}

// A vote for what to watch next in a watch-together list (members only).
// Returns the item (with its list) or null if you're not in that list.
export async function voteWatchListItem(uid, id, on) {
  await ensureTables(); const sql = getSql();
  const it = (await sql`SELECT i.id, i.list_id, i.title FROM watch_list_items i
    JOIN watch_list_members m ON m.list_id = i.list_id AND m.user_id = ${uid} WHERE i.id = ${id};`)[0];
  if (!it) return null;
  if (on) await sql`INSERT INTO watch_list_votes (item_id, user_id) VALUES (${id}, ${uid}) ON CONFLICT DO NOTHING;`;
  else await sql`DELETE FROM watch_list_votes WHERE item_id = ${id} AND user_id = ${uid};`;
  return it;
}

// ---- Followed actors & directors ----
export async function listFollows(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT person_id, name, role, notified FROM followed_people WHERE user_id = ${uid} ORDER BY created_at;`;
}
export async function followPerson(uid, { personId, name, role }) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO followed_people (user_id, person_id, name, role) VALUES (${uid}, ${personId}, ${name}, ${role || ""})
    ON CONFLICT (user_id, person_id) DO UPDATE SET name = EXCLUDED.name;`;
}
export async function unfollowPerson(uid, personId) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM followed_people WHERE user_id = ${uid} AND person_id = ${personId};`;
}
export async function setFollowNotified(uid, personId, notified) {
  await ensureTables(); const sql = getSql();
  await sql`UPDATE followed_people SET notified = ${notified} WHERE user_id = ${uid} AND person_id = ${personId};`;
}

// What other people in the app thought of a movie — only people who chose
// to share their ratings, and only if you share yours too.
export async function friendRatings(uid, tmdbId) {
  await ensureTables(); const sql = getSql();
  const mine = await getUserSetting(uid, "share_ratings");
  if (mine !== "1") return { sharing: false, ratings: [] };
  const ratings = await sql`SELECT DISTINCT ON (m.user_id) u.name, m.rating, m.my_take, m.review, m.watched_date
    FROM movies m JOIN users u ON u.id = m.user_id
    JOIN user_settings s ON s.user_id = m.user_id AND s.key = 'share_ratings' AND s.value = '1'
    WHERE m.tmdb_id = ${tmdbId} AND m.user_id <> ${uid} AND (m.rating > 0 OR m.my_take <> '')
    ORDER BY m.user_id, m.watched_date DESC;`;
  return { sharing: true, ratings };
}

// ---- Sugar food log (what you ate, grams of sugar) ----
export async function listSugarLog(uid, since) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, day_date, name, grams, added, code FROM sugar_food_log WHERE user_id = ${uid} AND day_date >= ${since} ORDER BY day_date DESC, created_at DESC;`;
}
export async function addSugarLog(uid, { date, name, grams, added, code }) {
  await ensureTables(); const sql = getSql();
  return (await sql`INSERT INTO sugar_food_log (user_id, day_date, name, grams, added, code)
    VALUES (${uid}, ${date}, ${name}, ${grams}, ${added !== false}, ${code || ""}) RETURNING id, day_date, name, grams, added, code;`)[0];
}
export async function deleteSugarLog(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM sugar_food_log WHERE id = ${id} AND user_id = ${uid};`;
}

// ---- Accounts & cards ----
// Card secrets (full number, CVV, PINs, passwords) are encrypted on the
// phone with a passphrase the server never sees. The server only accepts
// that sealed form: anything that doesn't look like it is refused, so a
// plaintext secret can't end up in the database by mistake.
const B64 = /^[A-Za-z0-9+/=_-]+$/;
export function cleanVault(v) {
  if (v == null || v === "") return "";
  let o;
  try { o = typeof v === "string" ? JSON.parse(v) : v; } catch { o = null; }
  const ok = o && o.v === 1 && typeof o.salt === "string" && typeof o.iv === "string" && typeof o.ct === "string" &&
    B64.test(o.salt) && B64.test(o.iv) && B64.test(o.ct) && o.salt.length <= 64 && o.iv.length <= 32 && o.ct.length <= 8000 &&
    Number.isInteger(o.iter) && o.iter >= 100000 && o.iter <= 5000000;
  if (!ok) {
    const e = new Error("Card secrets must be encrypted on your device before saving");
    e.status = 400;
    throw e;
  }
  return JSON.stringify({ v: 1, iter: o.iter, salt: o.salt, iv: o.iv, ct: o.ct });
}
const ACCOUNT_KIND_IDS = ["bank", "upi", "cash", "wallet", "meal", "card"];
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const dayNum = (d) => Math.min(31, Math.max(0, parseInt(d, 10) || 0));
function cleanAccount(a) {
  return {
    name: clip(a.name, 40) || "Account",
    kind: ACCOUNT_KIND_IDS.includes(a.kind) ? a.kind : "bank",
    openingBalance: parseFloat(a.openingBalance) || 0,
    openingDate: a.openingDate || null,
    creditLimit: Math.max(0, parseFloat(a.creditLimit) || 0),
    statementDay: dayNum(a.statementDay), dueDay: dayNum(a.dueDay),
    bank: clip(a.bank, 40), network: clip(a.network, 20),
    last4: String(a.last4 || "").replace(/\D/g, "").slice(-4),
    loginUrl: clip(a.loginUrl, 300), loginUsername: clip(a.loginUsername, 120),
    color: clip(a.color, 20), note: clip(a.note, 200), archived: !!a.archived,
  };
}
export async function listAccounts(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM money_accounts WHERE user_id=${uid} ORDER BY archived, kind = 'card', created_at;`;
}
export async function createAccount(uid, input) {
  await ensureTables(); const sql = getSql();
  const a = cleanAccount(input);
  const vault = cleanVault(input.vault);
  return (await sql`INSERT INTO money_accounts (user_id, name, kind, opening_balance, opening_date, credit_limit, statement_day, due_day,
      bank, network, last4, login_url, login_username, vault, color, note, archived)
    VALUES (${uid}, ${a.name}, ${a.kind}, ${a.openingBalance}, ${a.openingDate}, ${a.creditLimit}, ${a.statementDay}, ${a.dueDay},
      ${a.bank}, ${a.network}, ${a.last4}, ${a.loginUrl}, ${a.loginUsername}, ${vault}, ${a.color}, ${a.note}, ${a.archived}) RETURNING *;`)[0];
}
// vault: undefined keeps the stored secrets, "" removes them.
export async function updateAccount(uid, id, input) {
  await ensureTables(); const sql = getSql();
  const a = cleanAccount(input);
  const keep = input.vault === undefined;
  const vault = keep ? "" : cleanVault(input.vault);
  return (await sql`UPDATE money_accounts SET name=${a.name}, kind=${a.kind}, opening_balance=${a.openingBalance}, opening_date=${a.openingDate},
      credit_limit=${a.creditLimit}, statement_day=${a.statementDay}, due_day=${a.dueDay}, bank=${a.bank}, network=${a.network},
      last4=${a.last4}, login_url=${a.loginUrl}, login_username=${a.loginUsername},
      vault=CASE WHEN ${keep}::boolean THEN vault ELSE ${vault} END, color=${a.color}, note=${a.note}, archived=${a.archived}
    WHERE id=${id} AND user_id=${uid} RETURNING *;`)[0];
}
// Its expenses move back to the main wallet; its transfers go with it.
export async function deleteAccount(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql.transaction([
    sql`UPDATE expenses SET account_id=NULL WHERE account_id=${id} AND user_id=${uid};`,
    sql`DELETE FROM transfers WHERE (from_account=${id} OR to_account=${id}) AND user_id=${uid};`,
    sql`DELETE FROM money_accounts WHERE id=${id} AND user_id=${uid};`,
  ]);
}

// ---- Transfers (incl. card bill payments and money coming in) ----
// from/to null = the main wallet. kind "income" = money from outside
// (salary into a bank account, a card refund on a statement): it has no
// "from" side at all.
export async function listTransfers(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, from_account, to_account, amount, transfer_date, note, kind, created_at FROM transfers
    WHERE user_id=${uid} ORDER BY transfer_date DESC, created_at DESC;`;
}
export async function createTransfer(uid, { fromAccount, toAccount, amount, date, note, kind, clientRequestId }) {
  await ensureTables(); const sql = getSql();
  const k = kind === "income" ? "income" : "transfer";
  const from = k === "income" ? null : await ownId("money_accounts", uid, fromAccount);
  const to = await ownId("money_accounts", uid, toAccount);
  if (k === "transfer" && from === to) return { error: "Pick two different accounts" };
  const rows = await sql`INSERT INTO transfers (user_id, from_account, to_account, amount, transfer_date, note, kind, client_request_id)
    VALUES (${uid}, ${from}, ${to}, ${amount}, ${date}, ${clip(note, 120)}, ${k}, ${clientRequestId || null})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING *;`;
  return { transfer: rows[0] || null };
}
export async function createTransfersBulk(uid, rows) {
  await ensureTables(); const sql = getSql();
  if (!rows.length) return 0;
  const accIds = new Set((await sql`SELECT id FROM money_accounts WHERE user_id=${uid};`).map((r) => r.id));
  const out = await sql.transaction(rows.map((r) => sql`INSERT INTO transfers (user_id, from_account, to_account, amount, transfer_date, note, kind, client_request_id)
    VALUES (${uid}, NULL, ${accIds.has(r.toAccount) ? r.toAccount : null}, ${r.amount}, ${r.date}, ${clip(r.note, 120)}, 'income', ${r.clientRequestId})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING id;`));
  return out.reduce((n, x) => n + x.length, 0);
}
export async function deleteTransfer(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM transfers WHERE id=${id} AND user_id=${uid};`;
}

// ---- Loans ----
function cleanLoan(l) {
  const pre = (Array.isArray(l.prepayments) ? l.prepayments : [])
    .map((p) => ({ date: String(p.date || "").slice(0, 10), amount: Math.max(0, parseFloat(p.amount) || 0) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.amount > 0).slice(0, 200);
  return {
    name: clip(l.name, 60) || "Loan", lender: clip(l.lender, 60), principal: Math.max(0, parseFloat(l.principal) || 0),
    rate: Math.min(60, Math.max(0, parseFloat(l.rate) || 0)), tenureMonths: Math.min(600, Math.max(1, parseInt(l.tenureMonths, 10) || 1)),
    startDate: l.startDate, emi: Math.max(0, parseFloat(l.emi) || 0), prepayments: JSON.stringify(pre), closed: !!l.closed, note: clip(l.note, 200),
  };
}
export async function listLoans(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM loans WHERE user_id=${uid} ORDER BY closed, created_at;`;
}
export async function createLoan(uid, input) {
  await ensureTables(); const sql = getSql();
  const l = cleanLoan(input);
  return (await sql`INSERT INTO loans (user_id, name, lender, principal, rate, tenure_months, start_date, emi, prepayments, closed, note)
    VALUES (${uid}, ${l.name}, ${l.lender}, ${l.principal}, ${l.rate}, ${l.tenureMonths}, ${l.startDate}, ${l.emi}, ${l.prepayments}, ${l.closed}, ${l.note}) RETURNING *;`)[0];
}
export async function updateLoan(uid, id, input) {
  await ensureTables(); const sql = getSql();
  const l = cleanLoan(input);
  return (await sql`UPDATE loans SET name=${l.name}, lender=${l.lender}, principal=${l.principal}, rate=${l.rate}, tenure_months=${l.tenureMonths},
      start_date=${l.startDate}, emi=${l.emi}, prepayments=${l.prepayments}, closed=${l.closed}, note=${l.note}
    WHERE id=${id} AND user_id=${uid} RETURNING *;`)[0];
}
export async function deleteLoan(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM loans WHERE id=${id} AND user_id=${uid};`;
}

// ---- Assets (FDs, funds, PF, gold…) ----
const ASSET_KIND_IDS = ["fd", "mf", "stocks", "pf", "gold", "property", "other"];
export async function listAssets(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM assets WHERE user_id=${uid} ORDER BY value DESC;`;
}
export async function saveAsset(uid, id, { name, kind, value, note }) {
  await ensureTables(); const sql = getSql();
  const k = ASSET_KIND_IDS.includes(kind) ? kind : "other";
  const v = Math.max(0, parseFloat(value) || 0);
  if (id) {
    return (await sql`UPDATE assets SET name=${clip(name, 60) || "Asset"}, kind=${k}, value=${v}, note=${clip(note, 200)}, updated_at=now()
      WHERE id=${id} AND user_id=${uid} RETURNING *;`)[0];
  }
  return (await sql`INSERT INTO assets (user_id, name, kind, value, note) VALUES (${uid}, ${clip(name, 60) || "Asset"}, ${k}, ${v}, ${clip(note, 200)}) RETURNING *;`)[0];
}
export async function deleteAsset(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM assets WHERE id=${id} AND user_id=${uid};`;
}

// ---- Trips ----
export async function listTrips(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM trips WHERE user_id=${uid} ORDER BY start_date DESC;`;
}
export async function saveTrip(uid, id, { name, startDate, endDate, budget, people, note }) {
  await ensureTables(); const sql = getSql();
  const p = Math.min(50, Math.max(1, parseInt(people, 10) || 1));
  const b = Math.max(0, parseFloat(budget) || 0);
  if (id) {
    return (await sql`UPDATE trips SET name=${clip(name, 60) || "Trip"}, start_date=${startDate}, end_date=${endDate || null}, budget=${b}, people=${p}, note=${clip(note, 200)}
      WHERE id=${id} AND user_id=${uid} RETURNING *;`)[0];
  }
  return (await sql`INSERT INTO trips (user_id, name, start_date, end_date, budget, people, note)
    VALUES (${uid}, ${clip(name, 60) || "Trip"}, ${startDate}, ${endDate || null}, ${b}, ${p}, ${clip(note, 200)}) RETURNING *;`)[0];
}
// Expenses stay; they just stop belonging to the trip.
export async function deleteTrip(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql.transaction([
    sql`UPDATE expenses SET trip_id=NULL WHERE trip_id=${id} AND user_id=${uid};`,
    sql`DELETE FROM trips WHERE id=${id} AND user_id=${uid};`,
  ]);
}
// Tag every expense in the trip's dates (that isn't in another trip).
export async function tagTripByDates(uid, id) {
  await ensureTables(); const sql = getSql();
  const t = (await sql`SELECT * FROM trips WHERE id=${id} AND user_id=${uid};`)[0];
  if (!t) return 0;
  const rows = await sql`UPDATE expenses SET trip_id=${id} WHERE user_id=${uid} AND trip_id IS NULL
    AND expense_date >= ${t.start_date} AND expense_date <= COALESCE(${t.end_date}::date, CURRENT_DATE) RETURNING id;`;
  return rows.length;
}

// ---- Net-worth history (one point per month, last write wins) ----
export async function listNetWorth(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT ym, net, have, owe FROM networth_snapshots WHERE user_id=${uid} ORDER BY ym;`;
}
export async function saveNetWorth(uid, ym, { net, have, owe }) {
  await ensureTables(); const sql = getSql();
  if (!/^\d{4}-\d{2}$/.test(ym)) return;
  await sql`INSERT INTO networth_snapshots (user_id, ym, net, have, owe) VALUES (${uid}, ${ym}, ${net}, ${have || 0}, ${owe || 0})
    ON CONFLICT (user_id, ym) DO UPDATE SET net=EXCLUDED.net, have=EXCLUDED.have, owe=EXCLUDED.owe, updated_at=now();`;
}

// ---- Backup/restore of the money tables ----
// Accounts and trips get new ids in the restored database, so expenses and
// transfers are re-pointed through an old→new id map. Runs before the main
// import transaction (see importAll), and is itself safe to run twice: an
// account/trip whose created_at already exists is reused, not duplicated.
export async function importMoney(uid, data) {
  await ensureTables(); const sql = getSql();
  const accMap = {}, tripMap = {};
  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  for (const a of data.accounts || []) {
    const c = ts(a.created_at);
    const existing = c ? (await sql`SELECT id FROM money_accounts WHERE user_id=${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND name=${a.name};`)[0] : null;
    if (existing) { accMap[a.id] = existing.id; continue; }
    const x = cleanAccount({ ...a, openingBalance: a.opening_balance, openingDate: isoDate(a.opening_date), creditLimit: a.credit_limit,
      statementDay: a.statement_day, dueDay: a.due_day, loginUrl: a.login_url, loginUsername: a.login_username });
    let vault = "";
    try { vault = cleanVault(a.vault); } catch { vault = ""; }
    const row = (await sql`INSERT INTO money_accounts (user_id, name, kind, opening_balance, opening_date, credit_limit, statement_day, due_day,
        bank, network, last4, login_url, login_username, vault, color, note, archived, created_at)
      VALUES (${uid}, ${x.name}, ${x.kind}, ${x.openingBalance}, ${x.openingDate}, ${x.creditLimit}, ${x.statementDay}, ${x.dueDay},
        ${x.bank}, ${x.network}, ${x.last4}, ${x.loginUrl}, ${x.loginUsername}, ${vault}, ${x.color}, ${x.note}, ${x.archived}, COALESCE(${c}::timestamptz, now())) RETURNING id;`)[0];
    accMap[a.id] = row.id; bump("accounts");
  }
  for (const t of data.trips || []) {
    const c = ts(t.created_at);
    const existing = c ? (await sql`SELECT id FROM trips WHERE user_id=${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND name=${t.name};`)[0] : null;
    if (existing) { tripMap[t.id] = existing.id; continue; }
    const row = (await sql`INSERT INTO trips (user_id, name, start_date, end_date, budget, people, note, created_at)
      VALUES (${uid}, ${t.name}, ${isoDate(t.start_date)}, ${isoDate(t.end_date)}, ${num(t.budget)}, ${parseInt(t.people, 10) || 1}, ${t.note || ""}, COALESCE(${c}::timestamptz, now())) RETURNING id;`)[0];
    tripMap[t.id] = row.id; bump("trips");
  }
  const q = [];
  const mapAcc = (id) => (id == null ? null : accMap[id] ?? null);
  for (const t of data.transfers || []) {
    const c = ts(t.created_at);
    q.push(["transfers", sql`INSERT INTO transfers (user_id, from_account, to_account, amount, transfer_date, note, kind, created_at)
      SELECT ${uid}, ${mapAcc(t.from_account)}, ${mapAcc(t.to_account)}, ${num(t.amount)}, ${isoDate(t.transfer_date)}, ${t.note || ""}, ${t.kind === "income" ? "income" : "transfer"}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (SELECT 1 FROM transfers WHERE user_id=${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND amount=${num(t.amount)})
      RETURNING id;`]);
  }
  for (const l of data.loans || []) {
    const c = ts(l.created_at);
    const x = cleanLoan({ ...l, tenureMonths: l.tenure_months, startDate: isoDate(l.start_date), prepayments: typeof l.prepayments === "string" ? JSON.parse(l.prepayments || "[]") : l.prepayments });
    q.push(["loans", sql`INSERT INTO loans (user_id, name, lender, principal, rate, tenure_months, start_date, emi, prepayments, closed, note, created_at)
      SELECT ${uid}, ${x.name}, ${x.lender}, ${x.principal}, ${x.rate}, ${x.tenureMonths}, ${x.startDate}, ${x.emi}, ${x.prepayments}, ${x.closed}, ${x.note}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (SELECT 1 FROM loans WHERE user_id=${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz))
      RETURNING id;`]);
  }
  for (const a of data.assets || []) {
    const c = ts(a.created_at);
    q.push(["assets", sql`INSERT INTO assets (user_id, name, kind, value, note, created_at)
      SELECT ${uid}, ${a.name}, ${ASSET_KIND_IDS.includes(a.kind) ? a.kind : "other"}, ${num(a.value)}, ${a.note || ""}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (SELECT 1 FROM assets WHERE user_id=${uid} AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz))
      RETURNING id;`]);
  }
  for (const s of data.netWorth || []) {
    if (!/^\d{4}-\d{2}$/.test(s.ym || "")) continue;
    q.push(["netWorth", sql`INSERT INTO networth_snapshots (user_id, ym, net, have, owe) VALUES (${uid}, ${s.ym}, ${num(s.net)}, ${num(s.have)}, ${num(s.owe)})
      ON CONFLICT (user_id, ym) DO NOTHING RETURNING ym;`]);
  }
  if (q.length) {
    const out = await sql.transaction(q.map(([, x]) => x));
    q.forEach(([k], i) => bump(k, out[i].length));
  }
  return { accMap, tripMap, counts };
}

// ---- Life trackers (habits, health, food, renewals, warranties, documents,
// vehicles, occasions, gifts, lent items) — one table, cleaned per kind by
// lib/life.js. Photos are stored separately from the list (like receipts).
const LIFE_COLS = `id, kind, ref_id, item_date, data, vault, (photo != '') AS has_photo, created_at`;
export async function listLife(uid, kinds) {
  await ensureTables(); const sql = getSql();
  return sql.query(`SELECT ${LIFE_COLS} FROM life_items WHERE user_id=$1 AND kind = ANY($2) ORDER BY item_date DESC NULLS LAST, id DESC;`, [uid, kinds]);
}
export async function getLifePhoto(uid, id) {
  await ensureTables(); const sql = getSql();
  return (await sql`SELECT photo FROM life_items WHERE id=${id} AND user_id=${uid};`)[0]?.photo || "";
}
// A child (habit check-in, fuel fill, gift) must point at the person's own parent.
async function ownLifeRef(uid, kind, refId) {
  const spec = (await import("./life")).LIFE_KINDS[kind];
  if (!spec?.ref) return null;
  const n = parseInt(refId, 10);
  if (!n) throw Object.assign(new Error("Missing parent item"), { status: 400 });
  const sql = getSql();
  const row = (await sql`SELECT id FROM life_items WHERE id=${n} AND user_id=${uid} AND kind=${spec.ref};`)[0];
  if (!row) throw Object.assign(new Error("Parent item not found"), { status: 400 });
  return n;
}
// photo: data URL replaces, "" removes, undefined keeps. vault: same, sealed only.
export async function saveLife(uid, id, { kind, refId, date, data, photo, vault }) {
  await ensureTables(); const sql = getSql();
  const { cleanLifeData, LIFE_KINDS } = await import("./life");
  const spec = LIFE_KINDS[kind];
  if (!spec) throw Object.assign(new Error("Unknown item type"), { status: 400 });
  const clean = JSON.stringify(cleanLifeData(kind, data));
  const d = spec.date ? (/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : null) : null;
  if (spec.date && !d && kind !== "renewal" && kind !== "document") throw Object.assign(new Error("Pick a date"), { status: 400 });
  const ph = !spec.photo || photo === undefined ? null : String(photo || "");
  if (ph && (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 3_000_000)) throw Object.assign(new Error("That photo can't be saved"), { status: 400 });
  const vt = !spec.vault || vault === undefined ? null : cleanVault(vault);
  const ref = await ownLifeRef(uid, kind, refId);
  if (id) {
    return (await sql.query(`UPDATE life_items SET item_date=$3, data=$4, photo=COALESCE($5, photo), vault=COALESCE($6, vault), notified=''
      WHERE id=$1 AND user_id=$2 AND kind=$7 RETURNING ${LIFE_COLS};`, [id, uid, d, clean, ph, vt, kind]))[0];
  }
  if (spec.unique) {
    return (await sql.query(`INSERT INTO life_items (user_id, kind, ref_id, item_date, data) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, kind, (COALESCE(ref_id, 0)), item_date) WHERE kind IN ('habit_log', 'day_log')
      DO UPDATE SET data = (life_items.data::jsonb || EXCLUDED.data::jsonb)::text RETURNING ${LIFE_COLS};`, [uid, kind, ref, d, clean]))[0];
  }
  return (await sql.query(`INSERT INTO life_items (user_id, kind, ref_id, item_date, data, photo, vault) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${LIFE_COLS};`,
    [uid, kind, ref, d, clean, ph || "", vt || ""]))[0];
}
// Deleting a parent (habit, vehicle, occasion) deletes its children too.
export async function deleteLife(uid, id) {
  await ensureTables(); const sql = getSql();
  await sql.transaction([
    sql`DELETE FROM life_items WHERE ref_id=${id} AND user_id=${uid};`,
    sql`DELETE FROM life_items WHERE id=${id} AND user_id=${uid};`,
  ]);
}
// Habit check-in on/off for a day.
export async function toggleHabitDay(uid, habitId, date, on) {
  await ensureTables(); const sql = getSql();
  const ref = await ownLifeRef(uid, "habit_log", habitId);
  if (on) {
    await sql`INSERT INTO life_items (user_id, kind, ref_id, item_date) VALUES (${uid}, 'habit_log', ${ref}, ${date})
      ON CONFLICT (user_id, kind, (COALESCE(ref_id, 0)), item_date) WHERE kind IN ('habit_log', 'day_log') DO NOTHING;`;
  } else {
    await sql`DELETE FROM life_items WHERE user_id=${uid} AND kind='habit_log' AND ref_id=${ref} AND item_date=${date};`;
  }
}
export async function markLifeNotified(id, tag) {
  await ensureTables(); const sql = getSql();
  await sql`UPDATE life_items SET notified=${tag} WHERE id=${id};`;
}
export async function listLifeForReminders(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, kind, ref_id, item_date, data, notified FROM life_items WHERE user_id=${uid}
    AND kind IN ('renewal', 'warranty', 'occasion', 'lent', 'vehicle', 'fuel');`;
}
// Backups: parents first (new ids), then children re-pointed. Photos are
// left out of backups (size), like receipt photos in the weekly ones.
export async function exportLife(uid) {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, kind, ref_id, item_date, data, vault, created_at FROM life_items WHERE user_id=${uid} ORDER BY id;`;
}
export async function importLife(uid, items = []) {
  await ensureTables(); const sql = getSql();
  const { LIFE_KINDS } = await import("./life");
  const map = {};
  let added = 0;
  const parents = items.filter((x) => LIFE_KINDS[x.kind] && !LIFE_KINDS[x.kind].ref);
  const children = items.filter((x) => LIFE_KINDS[x.kind]?.ref);
  for (const x of [...parents, ...children]) {
    const c = ts(x.created_at);
    const ref = x.ref_id == null ? null : map[x.ref_id] ?? null;
    if (LIFE_KINDS[x.kind].ref && ref == null) continue;
    let vault = "";
    try { vault = cleanVault(x.vault); } catch { vault = ""; }
    const data = typeof x.data === "string" ? x.data : JSON.stringify(x.data || {});
    const existing = c ? (await sql`SELECT id FROM life_items WHERE user_id=${uid} AND kind=${x.kind}
      AND date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz);`)[0] : null;
    if (existing) { map[x.id] = existing.id; continue; }
    const row = (await sql.query(`INSERT INTO life_items (user_id, kind, ref_id, item_date, data, vault, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
      ON CONFLICT (user_id, kind, (COALESCE(ref_id, 0)), item_date) WHERE kind IN ('habit_log', 'day_log') DO NOTHING RETURNING id;`,
      [uid, x.kind, ref, isoDate(x.item_date), data, vault, c]))[0];
    if (row) { map[x.id] = row.id; added++; }
  }
  return added;
}

// ---- Trakt import: movies you watched (as streaming, ₹0, not deducted) and
// your watchlist. Skips anything already here: the same Trakt entry, or the
// same film (by TMDB id or title) logged within 3 days of that date.
export async function importTrakt(uid, { movies = [], watchlist = [] }) {
  await ensureTables(); const sql = getSql();
  const have = await sql`SELECT title, tmdb_id, watched_date, client_request_id FROM movies WHERE user_id=${uid};`;
  const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 3 * 86400000;
  const iso = (v) => String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
  const ids = new Set(have.map((m) => m.client_request_id).filter(Boolean));
  const fresh = movies.filter((m) => {
    if (ids.has(`trakt:${uid}:${m.traktHistoryId}`)) return false;
    return !have.some((h) => near(iso(h.watched_date), m.date) && ((m.tmdbId && h.tmdb_id === m.tmdbId) || h.title.toLowerCase() === m.title.toLowerCase()));
  }).slice(0, 1000);
  const out = fresh.length ? await sql.transaction(fresh.map((m) => sql`INSERT INTO movies (user_id, title, watched_date, ticket_price, canteen_price, my_take, public_take, note,
      affects_balance, quantity, venue_type, venue_name, client_request_id, tmdb_id)
    VALUES (${uid}, ${String(m.title).slice(0, 200)}, ${m.date}, 0, 0, ${m.myTake || ""}, '', 'Imported from Trakt', false, 1, 'OTT', '', ${`trakt:${uid}:${m.traktHistoryId}`}, ${cleanTmdb(m.tmdbId)})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING id;`)) : [];
  const wl = await sql`SELECT title, tmdb_id FROM movie_watchlist WHERE user_id=${uid};`;
  const seen = await sql`SELECT tmdb_id FROM movies WHERE user_id=${uid} AND tmdb_id IS NOT NULL;`;
  const skip = new Set([...wl.map((w) => w.tmdb_id), ...seen.map((x) => x.tmdb_id)].filter(Boolean));
  const titles = new Set(wl.map((w) => w.title.toLowerCase()));
  const addWl = watchlist.filter((w) => !(w.tmdbId && skip.has(w.tmdbId)) && !titles.has(w.title.toLowerCase())).slice(0, 300);
  if (addWl.length) await sql.transaction(addWl.map((w) => sql`INSERT INTO movie_watchlist (user_id, title, tmdb_id) VALUES (${uid}, ${String(w.title).slice(0, 200)}, ${cleanTmdb(w.tmdbId)}) RETURNING id;`));
  return { movies: out.reduce((n, x) => n + x.length, 0), watchlist: addWl.length, skipped: movies.length - fresh.length };
}
