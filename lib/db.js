import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

let ready = false;

export async function ensureTable() {
  if (ready) return;
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
  ready = true;
}

export async function listExpenses() {
  await ensureTable();
  return sql`
    SELECT id, amount, category, note, expense_date, created_at
    FROM expenses
    ORDER BY expense_date DESC, created_at DESC;
  `;
}

export async function createExpense({ amount, category, note, date }) {
  await ensureTable();
  const rows = await sql`
    INSERT INTO expenses (amount, category, note, expense_date)
    VALUES (${amount}, ${category}, ${note || ""}, ${date})
    RETURNING id, amount, category, note, expense_date, created_at;
  `;
  return rows[0];
}

export async function deleteExpense(id) {
  await ensureTable();
  await sql`DELETE FROM expenses WHERE id = ${id};`;
}
