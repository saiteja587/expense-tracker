import { neon } from "@neondatabase/serverless";
import { localDateParts, daysInMonth } from "./dates";

let sql;
export function getSql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

// Bump this whenever the DDL below changes. Each cold start does one cheap
// SELECT; the full DDL batch only runs when the stored version differs.
const SCHEMA_VERSION = "5";

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

  // One HTTP round trip, one transaction, instead of ~25 sequential calls.
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
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_rule ON budget_rules (rule_type, category);`,
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
    // v5: bills whose amount changes monthly (asked, not auto-logged), and
    // rough "estimate" expenses to finalise later.
    sql`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS variable BOOLEAN NOT NULL DEFAULT false;`,
    sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_estimate BOOLEAN NOT NULL DEFAULT false;`,
    sql`INSERT INTO app_settings (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
  ]);
  ready = true;
}

// ---- Expenses ----
export async function listExpenses() {
  await ensureTables();
  await generateDueRecurring();
  const sql = getSql();
  // Receipt photos are large (base64); the list only says whether one exists.
  // The image itself is fetched with getExpenseReceipt(id) when it's shown.
  return sql`SELECT id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
    (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at
    FROM expenses ORDER BY expense_date DESC, expense_time DESC NULLS LAST, created_at DESC;`;
}
export async function getExpenseReceipt(id) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT receipt_photo FROM expenses WHERE id=${id};`;
  return rows[0]?.receipt_photo || "";
}
// For backups only: every expense, receipts included.
export async function listExpensesWithReceipts() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC;`;
}
// clientRequestId makes retries safe: if the offline queue re-sends a
// request whose first attempt actually reached the DB, the existing row is
// returned instead of inserting a duplicate.
export async function createExpense({ amount, category, note, date, time, affectsBalance, receiptPhoto, clientRequestId, isEstimate }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO expenses (amount, category, note, expense_date, expense_time, affects_balance, receipt_photo, client_request_id, is_estimate)
    VALUES (${amount}, ${category}, ${note || ""}, ${date}, ${time || null}, ${affectsBalance !== false}, ${receiptPhoto || ""}, ${clientRequestId || null}, ${!!isEstimate})
    ON CONFLICT (client_request_id) DO NOTHING
    RETURNING id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
      (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at;`;
  if (rows[0]) return rows[0];
  const existing = await sql`SELECT id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
      (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at
    FROM expenses WHERE client_request_id=${clientRequestId};`;
  return existing[0];
}
// receiptPhoto: a data URL replaces the photo, "" removes it, and
// null/undefined keeps whatever is stored (the list no longer loads photos,
// so an edit must not wipe one it never saw). isEstimate works the same way.
export async function updateExpense(id, { amount, category, note, date, time, affectsBalance, receiptPhoto, isEstimate }) {
  await ensureTables(); const sql = getSql();
  const photo = receiptPhoto === undefined ? null : receiptPhoto;
  const est = typeof isEstimate === "boolean" ? isEstimate : null;
  const rows = await sql`UPDATE expenses SET amount=${amount}, category=${category}, note=${note || ""},
    expense_date=${date}, expense_time=${time || null}, affects_balance=${affectsBalance !== false},
    receipt_photo=COALESCE(${photo}, receipt_photo), is_estimate=COALESCE(${est}::boolean, is_estimate) WHERE id=${id}
    RETURNING id, amount, category, note, expense_date, expense_time, affects_balance, is_estimate,
      (receipt_photo IS NOT NULL AND receipt_photo != '') AS has_receipt, created_at;`;
  return rows[0];
}
// "That ~Rs.500 dinner was really Rs.540": only the amount (and optionally a
// receipt) changes, and it stops being an estimate.
export async function finalizeExpense(id, { amount, receiptPhoto }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE expenses SET amount=${amount}, is_estimate=false,
    receipt_photo=COALESCE(${receiptPhoto || null}, receipt_photo) WHERE id=${id}
    RETURNING id, amount, is_estimate;`;
  return rows[0];
}
export async function deleteExpense(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM expenses WHERE id=${id};`;
}

// ---- Movies ----
export async function listMovies() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM movies ORDER BY watched_date DESC, created_at DESC;`;
}
const cleanRating = (r) => (r == null || r === "" ? null : Math.min(5, Math.max(1, parseInt(r, 10) || 0)) || null);
export async function createMovie({ title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity, venueType, venueName, genre, clientRequestId, rating, review }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO movies (title, watched_date, watched_time, ticket_price, canteen_price, companions, my_take, public_take, note, affects_balance, quantity, venue_type, venue_name, genre, client_request_id, rating, review)
    VALUES (${title}, ${date}, ${time || null}, ${ticketPrice}, ${canteenPrice}, ${companions || ""}, ${myTake || ""}, ${publicTake || ""}, ${note || ""}, ${affectsBalance !== false}, ${quantity || 1}, ${venueType || "Theatre"}, ${venueName || ""}, ${genre || ""}, ${clientRequestId || null}, ${cleanRating(rating)}, ${(review || "").slice(0, 280)})
    ON CONFLICT (client_request_id) DO NOTHING RETURNING *;`;
  if (rows[0]) return rows[0];
  const existing = await sql`SELECT * FROM movies WHERE client_request_id=${clientRequestId};`;
  return existing[0];
}
export async function updateMovie(id, { title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity, venueType, venueName, genre, rating, review }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE movies SET title=${title}, watched_date=${date}, watched_time=${time || null}, ticket_price=${ticketPrice}, canteen_price=${canteenPrice},
    companions=${companions || ""}, my_take=${myTake || ""}, public_take=${publicTake || ""}, note=${note || ""},
    affects_balance=${affectsBalance !== false}, quantity=${quantity || 1}, venue_type=${venueType || "Theatre"}, venue_name=${venueName || ""}, genre=${genre || ""},
    rating=${cleanRating(rating)}, review=${(review || "").slice(0, 280)} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
// After the show: fill in what you only know afterwards (takes, stars,
// review, snacks, who came) without touching the booking details.
const TAKE_VALUES = ["loved", "liked", "okay", "disliked"];
export async function rateMovie(id, { myTake, publicTake, rating, review, canteenPrice, companions }) {
  await ensureTables(); const sql = getSql();
  const mine = TAKE_VALUES.includes(myTake) ? myTake : "";
  const pub = TAKE_VALUES.includes(publicTake) ? publicTake : "";
  const canteen = canteenPrice == null || canteenPrice === "" ? null : Math.max(0, parseFloat(canteenPrice) || 0);
  const who = companions == null ? null : String(companions).trim().slice(0, 120);
  const rows = await sql`UPDATE movies SET my_take=${mine}, public_take=${pub}, rating=${cleanRating(rating)},
    review=${String(review || "").trim().slice(0, 280)}, canteen_price=COALESCE(${canteen}::numeric, canteen_price),
    companions=COALESCE(${who}, companions) WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteMovie(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM movies WHERE id=${id};`;
}

// ---- Balance top-ups ----
// Claim-and-insert in ONE statement: the UPDATE marks the template done for
// this month, and only the caller whose UPDATE actually changed the row gets
// it back from RETURNING. Concurrent page loads (or a page load racing the
// daily cron) therefore can't insert the same item twice.
// Dates use the app's local timezone (IST), and a day of 29–31 lands on the
// last day of shorter months.
async function generateDueRecurringIncome() {
  const sql = getSql();
  const { year, month, day, ym } = localDateParts();
  const dim = daysInMonth(year, month);
  await sql`WITH claimed AS (
      UPDATE recurring_income SET last_generated_month = ${ym}
      WHERE last_generated_month IS DISTINCT FROM ${ym} AND LEAST(day_of_month, ${dim}::int) <= ${day}::int
      RETURNING amount, note, LEAST(day_of_month, ${dim}::int) AS d
    )
    INSERT INTO balance_topups (amount, note, topup_date, mode)
    SELECT amount, COALESCE(NULLIF(note, ''), '(recurring income)'), make_date(${year}::int, ${month}::int, d), 'add'
    FROM claimed;`;
}
export async function listTopups() {
  await ensureTables();
  await generateDueRecurringIncome();
  const sql = getSql();
  return sql`SELECT * FROM balance_topups ORDER BY topup_date DESC, created_at DESC;`;
}
export async function createTopup({ amount, note, date, mode }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO balance_topups (amount, note, topup_date, mode)
    VALUES (${amount}, ${note || ""}, ${date}, ${mode === "set" ? "set" : "add"}) RETURNING *;`;
  return rows[0];
}
export async function updateTopup(id, { amount, note, date, mode }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE balance_topups SET amount=${amount}, note=${note || ""}, topup_date=${date},
    mode=${mode === "set" ? "set" : "add"} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteTopup(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM balance_topups WHERE id=${id};`;
}

// ---- Budget rules ----
export async function listBudgetRules() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM budget_rules ORDER BY rule_type, category;`;
}
export async function upsertBudgetRule({ ruleType, category, amount }) {
  await ensureTables(); const sql = getSql();
  const cat = ruleType === "category" ? category : "";
  const rows = await sql`INSERT INTO budget_rules (rule_type, category, amount, updated_at)
    VALUES (${ruleType}, ${cat}, ${amount}, now())
    ON CONFLICT (rule_type, category) DO UPDATE SET amount=EXCLUDED.amount, updated_at=now() RETURNING *;`;
  return rows[0];
}
export async function deleteBudgetRule(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM budget_rules WHERE id=${id};`;
}

// ---- Sugar challenge ----
export async function getChallengeMeta() {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT * FROM sugar_challenge_meta WHERE id=1;`;
  return rows[0] || null;
}
export async function setChallengeMeta(startDate, lengthDays, sugarPerDay, savingsPerDay) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO sugar_challenge_meta (id, start_date, length_days, sugar_per_day, savings_per_day)
    VALUES (1, ${startDate}, ${lengthDays}, ${sugarPerDay || 0}, ${savingsPerDay || 0})
    ON CONFLICT (id) DO UPDATE SET start_date=EXCLUDED.start_date, length_days=EXCLUDED.length_days,
      sugar_per_day=EXCLUDED.sugar_per_day, savings_per_day=EXCLUDED.savings_per_day RETURNING *;`;
  return rows[0];
}
export async function listChallengeDays() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT day_date, completed, note, reason, natural_sugar FROM sugar_challenge_days ORDER BY day_date;`;
}
export async function upsertChallengeDay(date, completed, note, reason, naturalSugar) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO sugar_challenge_days (day_date, completed, note, reason, natural_sugar, updated_at)
    VALUES (${date}, ${completed}, ${note || ""}, ${reason || ""}, ${!!naturalSugar}, now())
    ON CONFLICT (day_date) DO UPDATE SET completed=EXCLUDED.completed, note=EXCLUDED.note, reason=EXCLUDED.reason,
      natural_sugar=EXCLUDED.natural_sugar, updated_at=now() RETURNING *;`;
  return rows[0];
}
export async function archiveChallenge({ startDate, lengthDays, completedDays, longestStreak }) {
  await ensureTables(); const sql = getSql();
  // All-or-nothing: never leave history saved but days not cleared (or vice versa).
  await sql.transaction([
    sql`INSERT INTO sugar_challenge_history (start_date, length_days, completed_days, longest_streak)
      VALUES (${startDate}, ${lengthDays}, ${completedDays}, ${longestStreak});`,
    sql`DELETE FROM sugar_challenge_days;`,
    sql`DELETE FROM sugar_challenge_meta WHERE id=1;`,
  ]);
}
export async function listChallengeHistory() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM sugar_challenge_history ORDER BY ended_at DESC;`;
}

// ---- App settings (generic key/value: pin, dark mode, custom categories) ----
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

// ---- Recurring expenses ----
// Same single-statement claim as generateDueRecurringIncome.
async function generateDueRecurring() {
  const sql = getSql();
  const { year, month, day, ym } = localDateParts();
  const dim = daysInMonth(year, month);
  await sql`WITH claimed AS (
      UPDATE recurring_expenses SET last_generated_month = ${ym}
      WHERE NOT variable AND last_generated_month IS DISTINCT FROM ${ym} AND LEAST(day_of_month, ${dim}::int) <= ${day}::int
      RETURNING amount, category, note, affects_balance, LEAST(day_of_month, ${dim}::int) AS d
    )
    INSERT INTO expenses (amount, category, note, expense_date, affects_balance)
    SELECT amount, category, COALESCE(NULLIF(note, ''), '(recurring)'), make_date(${year}::int, ${month}::int, d), affects_balance
    FROM claimed;`;
}
export async function listRecurring() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM recurring_expenses ORDER BY day_of_month;`;
}
// upiId: optional payee (e.g. landlord@okhdfc) so the bill reminder can
// open a UPI app with the amount filled in.
const cleanUpi = (u) => (/^[\w.-]{2,64}@[a-zA-Z]{2,64}$/.test(String(u || "").trim()) ? String(u).trim() : "");
export async function createRecurring({ amount, category, note, dayOfMonth, affectsBalance, upiId, variable }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO recurring_expenses (amount, category, note, day_of_month, affects_balance, upi_id, variable)
    VALUES (${amount}, ${category}, ${note || ""}, ${dayOfMonth}, ${affectsBalance !== false}, ${cleanUpi(upiId)}, ${!!variable}) RETURNING *;`;
  return rows[0];
}
export async function updateRecurring(id, { amount, category, note, dayOfMonth, affectsBalance, upiId, variable }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE recurring_expenses SET amount=${amount}, category=${category}, note=${note || ""},
    day_of_month=${dayOfMonth}, affects_balance=${affectsBalance !== false}, upi_id=${cleanUpi(upiId)}, variable=${!!variable} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
// A bill whose amount changes ("amount varies"): you say what it came to
// this month. Claims the month (so it's asked once) and logs the expense in
// one statement; the amount becomes next month's estimate. Logged on the due
// day, or today if you paid early. Returns null if already logged.
export async function logVariableBill(id, amount) {
  await ensureTables(); const sql = getSql();
  const { year, month, day, ym } = localDateParts();
  const dim = daysInMonth(year, month);
  const rows = await sql`WITH claimed AS (
      UPDATE recurring_expenses SET last_generated_month = ${ym}, amount = ${amount}
      WHERE id = ${id} AND last_generated_month IS DISTINCT FROM ${ym}
      RETURNING category, note, affects_balance, LEAST(day_of_month, ${dim}::int, ${day}::int) AS d
    )
    INSERT INTO expenses (amount, category, note, expense_date, affects_balance)
    SELECT ${amount}, category, COALESCE(NULLIF(note, ''), '(recurring)'), make_date(${year}::int, ${month}::int, d), affects_balance
    FROM claimed RETURNING id;`;
  return rows[0] || null;
}
// Bills you confirmed as paid via UPI, as { [billId]: "YYYY-MM" }.
export async function getBillsPaid() {
  const raw = await getSetting("bills_paid");
  return raw ? JSON.parse(raw) : {};
}
export async function markBillPaid(id, ym, paid = true) {
  const map = await getBillsPaid();
  if (paid) map[id] = ym;
  else delete map[id];
  await setSetting("bills_paid", JSON.stringify(map));
  return map;
}

// ---- Weekly server-side backups (#14). The last 4 are kept. ----
export async function saveBackup(payloadJson) {
  await ensureTables(); const sql = getSql();
  await sql.transaction([
    sql`INSERT INTO backups (payload, size_bytes) VALUES (${payloadJson}, ${payloadJson.length});`,
    sql`DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC LIMIT 4);`,
  ]);
}
export async function listBackups() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, size_bytes, created_at FROM backups ORDER BY created_at DESC;`;
}
export async function getBackup(id) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`SELECT payload FROM backups WHERE id=${id};`;
  return rows[0] ? rows[0].payload : null;
}

// ---- Shared spaces (#15) ----
export async function listSharedGroups() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT g.*, (SELECT count(*)::int FROM shared_entries e WHERE e.group_id = g.id) AS entry_count
    FROM shared_groups g ORDER BY g.created_at DESC;`;
}
export async function createSharedGroup({ name, members, token }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO shared_groups (name, token, members) VALUES (${name}, ${token}, ${JSON.stringify(members)}) RETURNING *;`;
  return rows[0];
}
export async function deleteSharedGroup(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM shared_groups WHERE id=${id};`;
}
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
export async function deleteRecurring(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM recurring_expenses WHERE id=${id};`;
}

// ---- Full data import (disaster recovery from an export-all backup) ----
//
// Safe to run more than once, and all-or-nothing per call:
// - Every row keeps its original created_at from the backup. A row whose
//   created_at (to the millisecond — JSON exports drop microseconds) and key
//   fields already exist is skipped, so importing the same file twice, or
//   re-running an import that failed halfway, never duplicates anything.
// - All writes for one call run in a single transaction. The client splits a
//   large backup into several calls (request bodies are capped at ~4MB);
//   because of the de-duplication, simply re-run the import if one fails.
const isoDate = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const hhmm = (v) => (v ? String(v).slice(0, 5) : null);
const ts = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
const num = (v) => parseFloat(v) || 0;

export async function importAll(data) {
  await ensureTables();
  const sql = getSql();
  const q = []; // [section, query]

  for (const x of data.expenses || []) {
    const c = ts(x.created_at);
    q.push(["expenses", sql`INSERT INTO expenses (amount, category, note, expense_date, expense_time, affects_balance, receipt_photo, is_estimate, created_at)
      SELECT ${num(x.amount)}, ${x.category}, ${x.note || ""}, ${isoDate(x.expense_date)}, ${hhmm(x.expense_time)},
        ${x.affects_balance !== false}, ${x.receipt_photo || ""}, ${!!x.is_estimate}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM expenses WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz)
          AND amount = ${num(x.amount)} AND expense_date = ${isoDate(x.expense_date)})
      RETURNING id;`]);
  }

  for (const m of data.movies || []) {
    const c = ts(m.created_at);
    q.push(["movies", sql`INSERT INTO movies (title, watched_date, watched_time, ticket_price, canteen_price, companions, my_take, public_take,
        note, affects_balance, quantity, venue_type, venue_name, genre, rating, review, created_at)
      SELECT ${m.title}, ${isoDate(m.watched_date)}, ${hhmm(m.watched_time)}, ${num(m.ticket_price)}, ${num(m.canteen_price)},
        ${m.companions || ""}, ${m.my_take || ""}, ${m.public_take || ""}, ${m.note || ""}, ${m.affects_balance !== false},
        ${parseInt(m.quantity, 10) || 1}, ${m.venue_type || "Theatre"}, ${m.venue_name || ""}, ${m.genre || ""}, ${cleanRating(m.rating)}, ${m.review || ""}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM movies WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND title = ${m.title})
      RETURNING id;`]);
  }

  for (const t of data.topups || []) {
    const c = ts(t.created_at);
    q.push(["topups", sql`INSERT INTO balance_topups (amount, note, topup_date, mode, created_at)
      SELECT ${num(t.amount)}, ${t.note || ""}, ${isoDate(t.topup_date)}, ${t.mode === "set" ? "set" : "add"}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM balance_topups WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND amount = ${num(t.amount)})
      RETURNING id;`]);
  }

  for (const r of data.budgetRules || []) {
    const cat = r.rule_type === "category" ? r.category : "";
    q.push(["budgetRules", sql`INSERT INTO budget_rules (rule_type, category, amount, updated_at)
      VALUES (${r.rule_type}, ${cat}, ${num(r.amount)}, now())
      ON CONFLICT (rule_type, category) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now() RETURNING id;`]);
  }

  // last_generated_month is kept so an import doesn't re-add this month's
  // recurring items a second time.
  for (const r of data.recurring || []) {
    const c = ts(r.created_at);
    q.push(["recurring", sql`INSERT INTO recurring_expenses (amount, category, note, day_of_month, affects_balance, last_generated_month, upi_id, variable, created_at)
      SELECT ${num(r.amount)}, ${r.category}, ${r.note || ""}, ${parseInt(r.day_of_month, 10)}, ${r.affects_balance !== false},
        ${r.last_generated_month || ""}, ${cleanUpi(r.upi_id)}, ${!!r.variable}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM recurring_expenses WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz))
      RETURNING id;`]);
  }

  for (const r of data.recurringIncome || []) {
    const c = ts(r.created_at);
    q.push(["recurringIncome", sql`INSERT INTO recurring_income (amount, note, day_of_month, last_generated_month, created_at)
      SELECT ${num(r.amount)}, ${r.note || ""}, ${parseInt(r.day_of_month, 10)}, ${r.last_generated_month || ""}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM recurring_income WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz))
      RETURNING id;`]);
  }

  for (const i of data.ious || []) {
    const c = ts(i.created_at);
    q.push(["ious", sql`INSERT INTO ious (person_name, amount, direction, note, due_date, settled, created_at)
      SELECT ${i.person_name}, ${num(i.amount)}, ${i.direction}, ${i.note || ""}, ${isoDate(i.due_date)}, ${!!i.settled}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM ious WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND person_name = ${i.person_name})
      RETURNING id;`]);
  }

  for (const w of data.watchlist || []) {
    const c = ts(w.created_at);
    q.push(["watchlist", sql`INSERT INTO movie_watchlist (title, note, created_at)
      SELECT ${w.title}, ${w.note || ""}, COALESCE(${c}::timestamptz, now())
      WHERE ${c}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM movie_watchlist WHERE date_trunc('milliseconds', created_at) = date_trunc('milliseconds', ${c}::timestamptz) AND title = ${w.title})
      RETURNING id;`]);
  }

  const sc = data.sugarChallenge || {};
  if (sc.meta) {
    const m = sc.meta;
    q.push(["challengeMeta", sql`INSERT INTO sugar_challenge_meta (id, start_date, length_days, sugar_per_day, savings_per_day)
      VALUES (1, ${isoDate(m.start_date)}, ${parseInt(m.length_days, 10) || 41}, ${num(m.sugar_per_day)}, ${num(m.savings_per_day)})
      ON CONFLICT (id) DO UPDATE SET start_date=EXCLUDED.start_date, length_days=EXCLUDED.length_days,
        sugar_per_day=EXCLUDED.sugar_per_day, savings_per_day=EXCLUDED.savings_per_day RETURNING id;`]);
  }
  for (const d of sc.days || []) {
    q.push(["challengeDays", sql`INSERT INTO sugar_challenge_days (day_date, completed, note, reason, natural_sugar, updated_at)
      VALUES (${isoDate(d.day_date)}, ${!!d.completed}, ${d.note || ""}, ${d.reason || ""}, ${!!d.natural_sugar}, now())
      ON CONFLICT (day_date) DO UPDATE SET completed=EXCLUDED.completed, note=EXCLUDED.note, reason=EXCLUDED.reason,
        natural_sugar=EXCLUDED.natural_sugar, updated_at=now() RETURNING id;`]);
  }
  for (const h of sc.history || []) {
    const e = ts(h.ended_at);
    q.push(["challengeHistory", sql`INSERT INTO sugar_challenge_history (start_date, length_days, completed_days, longest_streak, ended_at)
      SELECT ${isoDate(h.start_date)}, ${parseInt(h.length_days, 10) || 0}, ${parseInt(h.completed_days, 10) || 0},
        ${parseInt(h.longest_streak, 10) || 0}, COALESCE(${e}::timestamptz, now())
      WHERE ${e}::timestamptz IS NULL OR NOT EXISTS (
        SELECT 1 FROM sugar_challenge_history WHERE date_trunc('milliseconds', ended_at) = date_trunc('milliseconds', ${e}::timestamptz))
      RETURNING id;`]);
  }

  // Simple settings stored as JSON in app_settings.
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
    q.push(["settings", sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${JSON.stringify(value)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key;`]);
  }

  const results = {};
  if (q.length === 0) return results;
  const out = await sql.transaction(q.map(([, query]) => query));
  q.forEach(([section], i) => {
    results[section] = (results[section] || 0) + out[i].length;
  });
  return results;
}

// ---- Push notification subscriptions ----
export async function saveSubscription({ endpoint, p256dh, auth }) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO NOTHING;`;
}
export async function listSubscriptions() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM push_subscriptions;`;
}
export async function deleteSubscription(endpoint) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM push_subscriptions WHERE endpoint=${endpoint};`;
}

// ---- Recurring income ----
export async function listRecurringIncome() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM recurring_income ORDER BY day_of_month;`;
}
export async function createRecurringIncome({ amount, note, dayOfMonth }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO recurring_income (amount, note, day_of_month)
    VALUES (${amount}, ${note || ""}, ${dayOfMonth}) RETURNING *;`;
  return rows[0];
}
export async function updateRecurringIncome(id, { amount, note, dayOfMonth }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE recurring_income SET amount=${amount}, note=${note || ""}, day_of_month=${dayOfMonth}
    WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteRecurringIncome(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM recurring_income WHERE id=${id};`;
}

// ---- Who-owes-what (IOUs) ----
export async function listIous() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM ious ORDER BY settled ASC, due_date ASC NULLS LAST, created_at DESC;`;
}
export async function createIou({ personName, amount, direction, note, dueDate }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO ious (person_name, amount, direction, note, due_date)
    VALUES (${personName}, ${amount}, ${direction}, ${note || ""}, ${dueDate || null}) RETURNING *;`;
  return rows[0];
}
export async function updateIou(id, { personName, amount, direction, note, dueDate, settled }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE ious SET person_name=${personName}, amount=${amount}, direction=${direction},
    note=${note || ""}, due_date=${dueDate || null}, settled=${!!settled} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteIou(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM ious WHERE id=${id};`;
}

// ---- Movie watchlist ("want to watch", separate from logged movies) ----
export async function listWatchlist() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM movie_watchlist ORDER BY created_at DESC;`;
}
export async function createWatchlistItem({ title, note }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO movie_watchlist (title, note) VALUES (${title}, ${note || ""}) RETURNING *;`;
  return rows[0];
}
export async function deleteWatchlistItem(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM movie_watchlist WHERE id=${id};`;
}

// ---- Savings goal (a long-term target, distinct from the monthly savings
// budget rule) and custom streak-milestone rewards — both small enough to
// live as JSON blobs in app_settings rather than their own tables. ----
export async function getSavingsGoal() {
  const raw = await getSetting("savings_goal");
  return raw ? JSON.parse(raw) : null;
}
export async function setSavingsGoal(goal) {
  await setSetting("savings_goal", JSON.stringify(goal));
  return goal;
}
export async function getMilestoneRewards() {
  const raw = await getSetting("milestone_rewards");
  return raw ? JSON.parse(raw) : {};
}
export async function setMilestoneRewards(rewards) {
  await setSetting("milestone_rewards", JSON.stringify(rewards));
  return rewards;
}

// ---- "Still using this?" confirmations for quiet recurring expenses ----
export async function getRecurringConfirmations() {
  const raw = await getSetting("recurring_confirmations");
  return raw ? JSON.parse(raw) : {};
}
export async function confirmRecurring(id) {
  const map = await getRecurringConfirmations();
  map[id] = new Date().toISOString().slice(0, 10);
  await setSetting("recurring_confirmations", JSON.stringify(map));
  return map;
}
