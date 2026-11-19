// A stand-in for @neondatabase/serverless's `neon()` backed by PGlite (real
// Postgres compiled to WASM, running in-process). Lets tests execute the
// app's actual SQL without a database server.
import { PGlite } from "@electric-sql/pglite";

export function createFakeNeon() {
  const db = new PGlite();

  function build(strings, values) {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
    return { text, params: values };
  }

  // Like neon, a query only runs when awaited, so it can also be handed to
  // sql.transaction([...]) unexecuted.
  function sql(strings, ...values) {
    const q = build(strings, values);
    return {
      ...q,
      then(resolve, reject) {
        return db.query(q.text, q.params).then((r) => r.rows).then(resolve, reject);
      },
    };
  }

  // sql.query(text, params): a plain-string query (e.g. dynamic table names).
  sql.query = (text, params = []) => ({
    text, params,
    then(resolve, reject) {
      return db.query(text, params).then((r) => r.rows).then(resolve, reject);
    },
  });

  sql.transaction = async (queries) =>
    db.transaction(async (tx) => {
      const out = [];
      for (const q of queries) out.push((await tx.query(q.text, q.params)).rows);
      return out;
    });

  sql.db = db;
  return sql;
}
