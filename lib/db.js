import { neon } from "@neondatabase/serverless";

let sql;
export function getSql() {
  if (!sql) sql = neon(process.env.DATABASE_URL);
  return sql;
}

let ready = false;
export async function ensureTables() {
  if (ready) return;
  const sql = getSql();

  await sql`CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL,
    note TEXT DEFAULT '', expense_date DATE NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS movies (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, watched_date DATE NOT NULL,
    ticket_price NUMERIC(10,2) NOT NULL DEFAULT 0, canteen_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    companions TEXT DEFAULT '', my_take TEXT NOT NULL, public_take TEXT NOT NULL, note TEXT DEFAULT '',
    affects_balance BOOLEAN NOT NULL DEFAULT true, quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS balance_topups (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '',
    topup_date DATE NOT NULL, mode TEXT NOT NULL DEFAULT 'add', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS budget_rules (
    id SERIAL PRIMARY KEY, rule_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    amount NUMERIC(12,2) NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_rule ON budget_rules (rule_type, category);`;

  await sql`CREATE TABLE IF NOT EXISTS sugar_challenge_meta (
    id INTEGER PRIMARY KEY DEFAULT 1, start_date DATE NOT NULL, length_days INTEGER NOT NULL DEFAULT 41
  );`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_time TIME;`;
  await sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS watched_time TIME;`;

  await sql`CREATE TABLE IF NOT EXISTS sugar_challenge_days (
    id SERIAL PRIMARY KEY, day_date DATE UNIQUE NOT NULL, completed BOOLEAN NOT NULL, note TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS sugar_challenge_history (
    id SERIAL PRIMARY KEY, start_date DATE NOT NULL, length_days INTEGER NOT NULL,
    completed_days INTEGER NOT NULL, longest_streak INTEGER NOT NULL, ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  ready = true;
}

// ---- Expenses ----
export async function listExpenses() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT id, amount, category, note, expense_date, expense_time, affects_balance, created_at FROM expenses ORDER BY expense_date DESC, expense_time DESC NULLS LAST, created_at DESC;`;
}
export async function createExpense({ amount, category, note, date, time, affectsBalance }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO expenses (amount, category, note, expense_date, expense_time, affects_balance)
    VALUES (${amount}, ${category}, ${note || ""}, ${date}, ${time || null}, ${affectsBalance !== false}) RETURNING *;`;
  return rows[0];
}
export async function updateExpense(id, { amount, category, note, date, time, affectsBalance }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE expenses SET amount=${amount}, category=${category}, note=${note || ""},
    expense_date=${date}, expense_time=${time || null}, affects_balance=${affectsBalance !== false} WHERE id=${id} RETURNING *;`;
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
export async function createMovie({ title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO movies (title, watched_date, watched_time, ticket_price, canteen_price, companions, my_take, public_take, note, affects_balance, quantity)
    VALUES (${title}, ${date}, ${time || null}, ${ticketPrice}, ${canteenPrice}, ${companions || ""}, ${myTake}, ${publicTake}, ${note || ""}, ${affectsBalance !== false}, ${quantity || 1}) RETURNING *;`;
  return rows[0];
}
export async function updateMovie(id, { title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE movies SET title=${title}, watched_date=${date}, watched_time=${time || null}, ticket_price=${ticketPrice}, canteen_price=${canteenPrice},
    companions=${companions || ""}, my_take=${myTake}, public_take=${publicTake}, note=${note || ""},
    affects_balance=${affectsBalance !== false}, quantity=${quantity || 1} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteMovie(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM movies WHERE id=${id};`;
}

// ---- Balance top-ups ----
export async function listTopups() {
  await ensureTables(); const sql = getSql();
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
export async function setChallengeMeta(startDate, lengthDays) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO sugar_challenge_meta (id, start_date, length_days) VALUES (1, ${startDate}, ${lengthDays})
    ON CONFLICT (id) DO UPDATE SET start_date=EXCLUDED.start_date, length_days=EXCLUDED.length_days RETURNING *;`;
  return rows[0];
}
export async function listChallengeDays() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT day_date, completed, note FROM sugar_challenge_days ORDER BY day_date;`;
}
export async function upsertChallengeDay(date, completed, note) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO sugar_challenge_days (day_date, completed, note, updated_at) VALUES (${date}, ${completed}, ${note || ""}, now())
    ON CONFLICT (day_date) DO UPDATE SET completed=EXCLUDED.completed, note=EXCLUDED.note, updated_at=now() RETURNING *;`;
  return rows[0];
}
export async function archiveChallenge({ startDate, lengthDays, completedDays, longestStreak }) {
  await ensureTables(); const sql = getSql();
  await sql`INSERT INTO sugar_challenge_history (start_date, length_days, completed_days, longest_streak)
    VALUES (${startDate}, ${lengthDays}, ${completedDays}, ${longestStreak});`;
  await sql`DELETE FROM sugar_challenge_days;`;
  await sql`DELETE FROM sugar_challenge_meta WHERE id=1;`;
}
export async function listChallengeHistory() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM sugar_challenge_history ORDER BY ended_at DESC;`;
}
