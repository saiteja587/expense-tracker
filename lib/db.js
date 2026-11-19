import { neon } from "@neondatabase/serverless";
import { localDateParts, daysInMonth } from "./dates";

let sql;
export function getSql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// Bump this whenever the DDL below changes. Each cold start does one cheap
// SELECT; the full DDL batch only runs when the stored version differs.
const SCHEMA_VERSION = "7";

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

// ---- Expenses ----
export async function listExpenses(uid) {
  await ensureTables();
  await generateDueRecurring();
  const sql = getSql();
  // Receipt photos are large (base64); the list only says whether one exists.
  return sql`SELECT id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
    (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at
    FROM expenses WHERE user_id=${uid} ORDER BY expense_date DESC, expense_time DESC NULLS LAST, created_at DESC;`;
}
export async function getExpenseReceipt(uid, id) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT receipt_photo FROM expenses WHERE id=${id} AND user_id=${uid};`;
  return rows[0]?.receipt_photo || "";
}
// clientRequestId makes retries safe: if the offline queue re-sends a
// request whose first attempt actually reached the DB, the existing row is
// returned instead of inserting a duplicate.
export async function createExpense(uid, { amount, category, note, date, time, affectsBalance, receiptPhoto, clientRequestId, isEstimate }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO expenses (user_id, amount, category, note, expense_date, expense_time, affects_balance, receipt_photo, client_request_id, is_estimate)
    VALUES (${uid}, ${amount}, ${category}, ${note || ""}, ${date}, ${time || null}, ${affectsBalance !== false}, ${receiptPhoto || ""}, ${clientRequestId || null}, ${!!isEstimate})
    ON CONFLICT (client_request_id) DO NOTHING
    RETURNING id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
      (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at;`;
  if (rows[0]) return rows[0];
  const existing = await sql`SELECT id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
      (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at
    FROM expenses WHERE client_request_id=${clientRequestId} AND user_id=${uid};`;
  return existing[0];
}
// receiptPhoto: a data URL replaces the photo, "" removes it, and
// null/undefined keeps whatever is stored. isEstimate works the same way.
export async function updateExpense(uid, id, { amount, category, note, date, time, affectsBalance, receiptPhoto, isEstimate }) {
  await ensureTables(); const sql = getSql();
  const photo = receiptPhoto === undefined ? null : receiptPhoto;
  const est = typeof isEstimate === "boolean" ? isEstimate : null;
  const rows = await sql`UPDATE expenses SET amount=${amount}, category=${category}, note=${note || ""},
    expense_date=${date}, expense_time=${time || null}, affects_balance=${affectsBalance !== false},
    receipt_photo=COALESCE(${photo}, receipt_photo), is_estimate=COALESCE(${est}::boolean, is_estimate) WHERE id=${id} AND user_id=${uid}
    RETURNING id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
      (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at;`;
  return rows[0];
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
      RETURNING user_id, amount, category, note, affects_balance, LEAST(day_of_month, ${dim}::int) AS d
    )
    INSERT INTO expenses (user_id, amount, category, note, expense_date, affects_balance)
    SELECT user_id, amount, category, COALESCE(NULLIF(note, ''), '(recurring)'), make_date(${year}::int, ${month}::int, d), affects_balance
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
export async function createRecurring(uid, { amount, category, note, dayOfMonth, affectsBalance, upiId, variable }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO recurring_expenses (user_id, amount, category, note, day_of_month, affects_balance, upi_id, variable)
    VALUES (${uid}, ${amount}, ${category}, ${note || ""}, ${dayOfMonth}, ${affectsBalance !== false}, ${cleanUpi(upiId)}, ${!!variable}) RETURNING *;`;
  return rows[0];
}
export async function updateRecurring(uid, id, { amount, category, note, dayOfMonth, affectsBalance, upiId, variable }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE recurring_expenses SET amount=${amount}, category=${category}, note=${note || ""},
    day_of_month=${dayOfMonth}, affects_balance=${affectsBalance !== false}, upi_id=${cleanUpi(upiId)}, variable=${!!variable}
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
      RETURNING user_id, category, note, affects_balance, LEAST(day_of_month, ${dim}::int, ${day}::int) AS d
    )
    INSERT INTO expenses (user_id, amount, category, note, expense_date, affects_balance)
    SELECT user_id, ${amount}, category, COALESCE(NULLIF(note, ''), '(recurring)'), make_date(${year}::int, ${month}::int, d), affects_balance
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

  for (const x of data.expenses || []) {
    const c = ts(x.created_at);
    q.push(["expenses", sql`INSERT INTO expenses (user_id, amount, category, note, expense_date, expense_time, affects_balance, receipt_photo, is_estimate, created_at)
      SELECT ${uid}, ${num(x.amount)}, ${x.category}, ${x.note || ""}, ${isoDate(x.expense_date)}, ${hhmm(x.expense_time)},
        ${x.affects_balance !== false}, ${x.receipt_photo || ""}, ${!!x.is_estimate}, COALESCE(${c}::timestamptz, now())
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

  const results = {};
  if (q.length === 0) return results;
  const out = await sql.transaction(q.map(([, query]) => query));
  q.forEach(([section], i) => {
    results[section] = (results[section] || 0) + out[i].length;
  });
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
  return sql`SELECT * FROM movie_watchlist WHERE user_id=${uid} ORDER BY created_at DESC;`;
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
