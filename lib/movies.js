import { getSql } from "./db";

let ready = false;

export async function ensureMoviesTable() {
  if (ready) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS movies (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      watched_date DATE NOT NULL,
      ticket_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
      canteen_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
      companions TEXT DEFAULT '',
      my_take TEXT NOT NULL,
      public_take TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_movies_date ON movies (watched_date);`;
  ready = true;
}

export async function listMovies() {
  await ensureMoviesTable();
  const sql = getSql();
  return sql`
    SELECT id, title, watched_date, ticket_price, canteen_price, companions, my_take, public_take, note, created_at
    FROM movies
    ORDER BY watched_date DESC, created_at DESC;
  `;
}

export async function createMovie({ title, date, ticketPrice, canteenPrice, companions, myTake, publicTake, note }) {
  await ensureMoviesTable();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO movies (title, watched_date, ticket_price, canteen_price, companions, my_take, public_take, note)
    VALUES (${title}, ${date}, ${ticketPrice}, ${canteenPrice}, ${companions || ""}, ${myTake}, ${publicTake}, ${note || ""})
    RETURNING id, title, watched_date, ticket_price, canteen_price, companions, my_take, public_take, note, created_at;
  `;
  return rows[0];
}

export async function deleteMovie(id) {
  await ensureMoviesTable();
  const sql = getSql();
  await sql`DELETE FROM movies WHERE id = ${id};`;
}
