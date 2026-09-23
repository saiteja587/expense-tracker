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
  await sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS venue_type TEXT NOT NULL DEFAULT 'Theatre';`;
  await sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS venue_name TEXT NOT NULL DEFAULT '';`;

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
  await sql`ALTER TABLE sugar_challenge_meta ADD COLUMN IF NOT EXISTS sugar_per_day NUMERIC(6,1) NOT NULL DEFAULT 0;`;
  await sql`ALTER TABLE sugar_challenge_meta ADD COLUMN IF NOT EXISTS savings_per_day NUMERIC(10,2) NOT NULL DEFAULT 0;`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_time TIME;`;
  await sql`ALTER TABLE movies ADD COLUMN IF NOT EXISTS watched_time TIME;`;

  await sql`CREATE TABLE IF NOT EXISTS sugar_challenge_days (
    id SERIAL PRIMARY KEY, day_date DATE UNIQUE NOT NULL, completed BOOLEAN NOT NULL, note TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );`;

  await sql`CREATE TABLE IF NOT EXISTS recurring_expenses (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL, note TEXT DEFAULT '',
    day_of_month INTEGER NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
    last_generated_month TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS sugar_challenge_history (
    id SERIAL PRIMARY KEY, start_date DATE NOT NULL, length_days INTEGER NOT NULL,
    completed_days INTEGER NOT NULL, longest_streak INTEGER NOT NULL, ended_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS recurring_income (
    id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, note TEXT DEFAULT '',
    day_of_month INTEGER NOT NULL, last_generated_month TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  await sql`CREATE TABLE IF NOT EXISTS ious (
    id SERIAL PRIMARY KEY, person_name TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL,
    direction TEXT NOT NULL, note TEXT DEFAULT '', due_date DATE, settled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );`;

  ready = true;
}

// ---- Expenses ----
export async function listExpenses() {
  await ensureTables();
  await generateDueRecurring();
  const sql = getSql();
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
export async function createMovie({ title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity, venueType, venueName }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO movies (title, watched_date, watched_time, ticket_price, canteen_price, companions, my_take, public_take, note, affects_balance, quantity, venue_type, venue_name)
    VALUES (${title}, ${date}, ${time || null}, ${ticketPrice}, ${canteenPrice}, ${companions || ""}, ${myTake}, ${publicTake}, ${note || ""}, ${affectsBalance !== false}, ${quantity || 1}, ${venueType || "Theatre"}, ${venueName || ""}) RETURNING *;`;
  return rows[0];
}
export async function updateMovie(id, { title, date, time, ticketPrice, canteenPrice, companions, myTake, publicTake, note, affectsBalance, quantity, venueType, venueName }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE movies SET title=${title}, watched_date=${date}, watched_time=${time || null}, ticket_price=${ticketPrice}, canteen_price=${canteenPrice},
    companions=${companions || ""}, my_take=${myTake}, public_take=${publicTake}, note=${note || ""},
    affects_balance=${affectsBalance !== false}, quantity=${quantity || 1}, venue_type=${venueType || "Theatre"}, venue_name=${venueName || ""} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteMovie(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM movies WHERE id=${id};`;
}

// ---- Balance top-ups ----
async function generateDueRecurringIncome() {
  const sql = getSql();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today = now.getDate();
  const templates = await sql`SELECT * FROM recurring_income WHERE last_generated_month != ${ym} AND day_of_month <= ${today};`;
  for (const t of templates) {
    const day = String(t.day_of_month).padStart(2, "0");
    const date = `${ym}-${day}`;
    await sql`INSERT INTO balance_topups (amount, note, topup_date, mode)
      VALUES (${t.amount}, ${t.note || "(recurring income)"}, ${date}, 'add');`;
    await sql`UPDATE recurring_income SET last_generated_month=${ym} WHERE id=${t.id};`;
  }
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
async function generateDueRecurring() {
  const sql = getSql();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today = now.getDate();
  const templates = await sql`SELECT * FROM recurring_expenses WHERE last_generated_month != ${ym} AND day_of_month <= ${today};`;
  for (const t of templates) {
    const day = String(t.day_of_month).padStart(2, "0");
    const date = `${ym}-${day}`;
    await sql`INSERT INTO expenses (amount, category, note, expense_date, affects_balance)
      VALUES (${t.amount}, ${t.category}, ${t.note || "(recurring)"}, ${date}, ${t.affects_balance});`;
    await sql`UPDATE recurring_expenses SET last_generated_month=${ym} WHERE id=${t.id};`;
  }
}
export async function listRecurring() {
  await ensureTables(); const sql = getSql();
  return sql`SELECT * FROM recurring_expenses ORDER BY day_of_month;`;
}
export async function createRecurring({ amount, category, note, dayOfMonth, affectsBalance }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`INSERT INTO recurring_expenses (amount, category, note, day_of_month, affects_balance)
    VALUES (${amount}, ${category}, ${note || ""}, ${dayOfMonth}, ${affectsBalance !== false}) RETURNING *;`;
  return rows[0];
}
export async function updateRecurring(id, { amount, category, note, dayOfMonth, affectsBalance }) {
  await ensureTables(); const sql = getSql();
  const rows = await sql`UPDATE recurring_expenses SET amount=${amount}, category=${category}, note=${note || ""},
    day_of_month=${dayOfMonth}, affects_balance=${affectsBalance !== false} WHERE id=${id} RETURNING *;`;
  return rows[0];
}
export async function deleteRecurring(id) {
  await ensureTables(); const sql = getSql();
  await sql`DELETE FROM recurring_expenses WHERE id=${id};`;
}

// ---- Full data import (disaster recovery from an export-all backup) ----
export async function importAll(data) {
  await ensureTables();
  const results = { expenses: 0, movies: 0, topups: 0, budgetRules: 0, recurring: 0, challengeDays: 0 };

  for (const x of data.expenses || []) {
    await createExpense({
      amount: parseFloat(x.amount), category: x.category, note: x.note,
      date: (x.expense_date || "").slice(0, 10), time: x.expense_time ? x.expense_time.slice(0, 5) : null,
      affectsBalance: x.affects_balance !== false,
    });
    results.expenses++;
  }

  for (const m of data.movies || []) {
    await createMovie({
      title: m.title, date: (m.watched_date || "").slice(0, 10), time: m.watched_time ? m.watched_time.slice(0, 5) : null,
      ticketPrice: parseFloat(m.ticket_price) || 0, canteenPrice: parseFloat(m.canteen_price) || 0,
      companions: m.companions, myTake: m.my_take, publicTake: m.public_take, note: m.note,
      affectsBalance: m.affects_balance !== false, quantity: m.quantity || 1,
      venueType: m.venue_type, venueName: m.venue_name,
    });
    results.movies++;
  }

  for (const t of data.topups || []) {
    await createTopup({
      amount: parseFloat(t.amount), note: t.note, date: (t.topup_date || "").slice(0, 10), mode: t.mode,
    });
    results.topups++;
  }

  for (const r of data.budgetRules || []) {
    await upsertBudgetRule({ ruleType: r.rule_type, category: r.category, amount: parseFloat(r.amount) });
    results.budgetRules++;
  }

  for (const rec of data.recurring || []) {
    await createRecurring({
      amount: parseFloat(rec.amount), category: rec.category, note: rec.note,
      dayOfMonth: rec.day_of_month, affectsBalance: rec.affects_balance !== false,
    });
    results.recurring++;
  }

  if (data.sugarChallenge?.meta) {
    const m = data.sugarChallenge.meta;
    await setChallengeMeta(
      (m.start_date || "").slice(0, 10), m.length_days,
      parseFloat(m.sugar_per_day) || 0, parseFloat(m.savings_per_day) || 0
    );
  }
  for (const d of data.sugarChallenge?.days || []) {
    await upsertChallengeDay((d.day_date || "").slice(0, 10), d.completed, d.note);
    results.challengeDays++;
  }

  if (Array.isArray(data.customCategories)) {
    await setSetting("custom_categories", JSON.stringify(data.customCategories));
  }

  for (const ri of data.recurringIncome || []) {
    await createRecurringIncome({ amount: parseFloat(ri.amount), note: ri.note, dayOfMonth: ri.day_of_month });
    results.recurringIncome = (results.recurringIncome || 0) + 1;
  }

  for (const i of data.ious || []) {
    await createIou({
      personName: i.person_name, amount: parseFloat(i.amount), direction: i.direction,
      note: i.note, dueDate: i.due_date ? String(i.due_date).slice(0, 10) : null,
    });
    results.ious = (results.ious || 0) + 1;
  }

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
