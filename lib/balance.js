import { getSql } from "./db";

let ready = false;

export async function ensureBalanceTable() {
  if (ready) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS balance_topups (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL,
      note TEXT DEFAULT '',
      topup_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE balance_topups ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'add';`;
  ready = true;
}

export async function listTopups() {
  await ensureBalanceTable();
  const sql = getSql();
  return sql`
    SELECT id, amount, note, topup_date, mode, created_at
    FROM balance_topups
    ORDER BY topup_date DESC, created_at DESC;
  `;
}

export async function createTopup({ amount, note, date, mode }) {
  await ensureBalanceTable();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO balance_topups (amount, note, topup_date, mode)
    VALUES (${amount}, ${note || ""}, ${date}, ${mode === "set" ? "set" : "add"})
    RETURNING id, amount, note, topup_date, mode, created_at;
  `;
  return rows[0];
}

export async function updateTopup(id, { amount, note, date, mode }) {
  await ensureBalanceTable();
  const sql = getSql();
  const rows = await sql`
    UPDATE balance_topups
    SET amount = ${amount}, note = ${note || ""}, topup_date = ${date}, mode = ${mode === "set" ? "set" : "add"}
    WHERE id = ${id}
    RETURNING id, amount, note, topup_date, mode, created_at;
  `;
  return rows[0];
}

export async function deleteTopup(id) {
  await ensureBalanceTable();
  const sql = getSql();
  await sql`DELETE FROM balance_topups WHERE id = ${id};`;
}
