import { getSql } from "./db";

let ready = false;

export async function ensureChallengeTables() {
  if (ready) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS sugar_challenge_meta (
      id INTEGER PRIMARY KEY DEFAULT 1,
      start_date DATE NOT NULL,
      length_days INTEGER NOT NULL DEFAULT 41,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sugar_challenge_days (
      id SERIAL PRIMARY KEY,
      day_date DATE UNIQUE NOT NULL,
      completed BOOLEAN NOT NULL,
      note TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  ready = true;
}

export async function getMeta() {
  await ensureChallengeTables();
  const sql = getSql();
  const rows = await sql`SELECT id, start_date, length_days FROM sugar_challenge_meta WHERE id = 1;`;
  return rows[0] || null;
}

export async function setMeta(startDate, lengthDays) {
  await ensureChallengeTables();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO sugar_challenge_meta (id, start_date, length_days)
    VALUES (1, ${startDate}, ${lengthDays})
    ON CONFLICT (id) DO UPDATE SET start_date = EXCLUDED.start_date, length_days = EXCLUDED.length_days
    RETURNING id, start_date, length_days;
  `;
  return rows[0];
}

export async function listDays() {
  await ensureChallengeTables();
  const sql = getSql();
  return sql`SELECT day_date, completed, note FROM sugar_challenge_days ORDER BY day_date;`;
}

export async function upsertDay(date, completed, note) {
  await ensureChallengeTables();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO sugar_challenge_days (day_date, completed, note, updated_at)
    VALUES (${date}, ${completed}, ${note || ""}, now())
    ON CONFLICT (day_date) DO UPDATE SET completed = EXCLUDED.completed, note = EXCLUDED.note, updated_at = now()
    RETURNING day_date, completed, note;
  `;
  return rows[0];
}
