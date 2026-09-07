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
  ready = true;
}

export async function listTopups() {
  await ensureBalanceTable();
  const sql = getSql();
  return sql`
    SELECT id, amount, note, topup_date, created_at
    FROM balance_topups
    ORDER BY topup_date DESC, created_at DESC;
  `;
}

export async function createTopup({ amount, note, date }) {
  await ensureBalanceTable();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO balance_topups (amount, note, topup_date)
    VALUES (${amount}, ${note || ""}, ${date})
    RETURNING id, amount, note, topup_date, created_at;
  `;
  return rows[0];
}

export async function updateTopup(id, { amount, note, date }) {
  await ensureBalanceTable();
  const sql = getSql();
  const rows = await sql`
    UPDATE balance_topups
    SET amount = ${amount}, note = ${note || ""}, topup_date = ${date}
    WHERE id = ${id}
    RETURNING id, amount, note, topup_date, created_at;
  `;
  return rows[0];
}

export async function deleteTopup(id) {
  await ensureBalanceTable();
  const sql = getSql();
  await sql`DELETE FROM balance_topups WHERE id = ${id};`;
}
