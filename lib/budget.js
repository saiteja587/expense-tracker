import { getSql } from "./db";

let ready = false;

export async function ensureBudgetTable() {
  if (ready) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS budget_rules (
      id SERIAL PRIMARY KEY,
      rule_type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      amount NUMERIC(12, 2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_rule ON budget_rules (rule_type, category);`;
  ready = true;
}

export async function listBudgetRules() {
  await ensureBudgetTable();
  const sql = getSql();
  return sql`
    SELECT id, rule_type, category, amount, updated_at
    FROM budget_rules
    ORDER BY rule_type, category;
  `;
}

export async function upsertBudgetRule({ ruleType, category, amount }) {
  await ensureBudgetTable();
  const sql = getSql();
  const cat = ruleType === "category" ? category : "";
  const rows = await sql`
    INSERT INTO budget_rules (rule_type, category, amount, updated_at)
    VALUES (${ruleType}, ${cat}, ${amount}, now())
    ON CONFLICT (rule_type, category)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
    RETURNING id, rule_type, category, amount, updated_at;
  `;
  return rows[0];
}

export async function deleteBudgetRule(id) {
  await ensureBudgetTable();
  const sql = getSql();
  await sql`DELETE FROM budget_rules WHERE id = ${id};`;
}
