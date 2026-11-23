// Stand-in for @neondatabase/serverless during browser tests: one
// in-memory PGlite database shared by every API request in the dev server.
import { createFakeNeon } from "../helpers/pgliteNeon";

export function neon() {
  if (!globalThis.__e2eSql) globalThis.__e2eSql = createFakeNeon();
  return globalThis.__e2eSql;
}
