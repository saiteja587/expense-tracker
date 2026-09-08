import { neon } from "@neondatabase/serverless";

let sql;
export function getSql() {
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

let ready = false;

export async function ensureTable() {
  if (ready) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL,
      category TEXT NOT NULL,
      note TEXT DEFAULT '',
      expense_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);`;
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS affects_balance BOOLEAN NOT NULL DEFAULT true;`;
  ready = true;
}

export async function listExpenses() {
  await ensureTable();
  const sql = getSql();
  return sql`
    SELECT id, amount, category, note, expense_date, affects_balance, created_at
    FROM expenses
    ORDER BY expense_date DESC, created_at DESC;
  `;
}

export async function createExpense({ amount, category, note, date, affectsBalance }) {
  await ensureTable();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO expenses (amount, category, note, expense_date, affects_balance)
    VALUES (${amount}, ${category}, ${note || ""}, ${date}, ${affectsBalance !== false})
    RETURNING id, amount, category, note, expense_date, affects_balance, created_at;
  `;
  return rows[0];
}

export async function updateExpense(id, { amount, category, note, date, affectsBalance }) {
  await ensureTable();
  const sql = getSql();
  const rows = await sql`
    UPDATE expenses
    SET amount = ${amount}, category = ${category}, note = ${note || ""}, expense_date = ${date}, affects_balance = ${affectsBalance !== false}
    WHERE id = ${id}
    RETURNING id, amount, category, note, expense_date, affects_balance, created_at;
  `;
  return rows[0];
}

export async function deleteExpense(id) {
  await ensureTable();
  const sql = getSql();
  await sql`DELETE FROM expenses WHERE id = ${id};`;
}
