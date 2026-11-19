// Upgrading a real single-person database (schema v5) to multi-user (v6):
// every existing row must end up owned by user #1, who keeps their PIN.
import { describe, it, expect, vi } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const db = await import("../lib/db");

describe("v5 → v6 migration", () => {
  it("gives all existing data to user #1 and keeps their PIN and settings", async () => {
    // A cut-down v5 database with data in it.
    await fake.db.exec(`
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO app_settings VALUES ('schema_version', '5'), ('app_pin_hash', 'scrypt$abc$def'),
        ('custom_categories', '["Pets"]'), ('auth_secret', 'keep-me');
      CREATE TABLE expenses (id SERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, category TEXT NOT NULL,
        note TEXT DEFAULT '', expense_date DATE NOT NULL, affects_balance BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO expenses (amount, category, expense_date) VALUES (250, 'Food', '2026-11-01'), (90, 'Auto', '2026-11-02');
      CREATE TABLE budget_rules (id SERIAL PRIMARY KEY, rule_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
        amount NUMERIC(12,2) NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX uq_budget_rule ON budget_rules (rule_type, category);
      INSERT INTO budget_rules (rule_type, amount) VALUES ('overall', 30000);
      CREATE TABLE sugar_challenge_meta (id INTEGER PRIMARY KEY DEFAULT 1, start_date DATE NOT NULL, length_days INTEGER NOT NULL DEFAULT 41);
      INSERT INTO sugar_challenge_meta (start_date) VALUES ('2026-11-01');
      CREATE TABLE sugar_challenge_days (id SERIAL PRIMARY KEY, day_date DATE UNIQUE NOT NULL, completed BOOLEAN NOT NULL,
        note TEXT DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO sugar_challenge_days (day_date, completed) VALUES ('2026-11-01', true);
    `);

    await db.ensureTables();

    const users = await db.listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 1, name: "Me", is_owner: true, has_pin: true });
    expect((await db.getUser(1)).pin_hash).toBe("scrypt$abc$def");

    expect(await db.listExpenses(1)).toHaveLength(2);
    expect(await db.listBudgetRules(1)).toHaveLength(1);
    expect((await db.getChallengeMeta(1)).length_days).toBe(41);
    expect(await db.listChallengeDays(1)).toHaveLength(1);
    expect(JSON.parse(await db.getUserSetting(1, "custom_categories"))).toEqual(["Pets"]);
    expect(await db.getSetting("auth_secret")).toBe("keep-me");

    // A new person starts empty, and the old one-per-app limits are now per person.
    await db.ensureTables();
    await fake`INSERT INTO users (name, name_key) VALUES ('Ravi', 'ravi')`;
    const ravi = (await db.getUserByName("RAVI")).id;
    expect(ravi).toBe(2);
    expect(await db.listExpenses(ravi)).toHaveLength(0);
    await db.upsertBudgetRule(ravi, { ruleType: "overall", amount: 15000 });
    await db.setChallengeMeta(ravi, "2026-11-10", 21, 0, 0);
    await db.upsertChallengeDay(ravi, "2026-11-01", false, "", "Cake", false);
    expect(parseFloat((await db.listBudgetRules(1))[0].amount)).toBe(30000);
    expect((await db.getChallengeMeta(1)).length_days).toBe(41);
    expect((await db.listChallengeDays(1))[0].completed).toBe(true);
  });
});
