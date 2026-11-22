// Accounts, card vault, transfers, refunds, trips, loans and statement
// import through the real API against in-process Postgres.
import { describe, it, expect, vi } from "vitest";
import { webcrypto } from "crypto";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));

const { default: handler } = await import("../pages/api/data");
const db = await import("../lib/db");
const { sealSecrets, openSecrets } = await import("../lib/vault");
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

async function call(method, { query = {}, body } = {}) {
  const out = {};
  const res = {
    setHeader() {},
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
  };
  await handler({ method, query, body, headers: {} }, res);
  return out;
}
const get = (type, q = {}) => call("GET", { query: { type, ...q } });
const post = (body) => call("POST", { body });
const put = (body) => call("PUT", { body });
const del = (type, id) => call("DELETE", { query: { type, id: String(id) } });

describe("card vault", () => {
  it("stores only sealed secrets; the right passphrase opens them, a wrong one doesn't", async () => {
    const vault = await sealSecrets({ number: "4111111111111111", cvv: "123", pin: "4321" }, "correct horse", 100000);
    const r = await post({ type: "accounts", name: "HDFC Regalia", kind: "card", last4: "1111", creditLimit: 200000, statementDay: 20, dueDay: 8, vault });
    expect(r.status).toBe(201);
    const stored = (await fake`SELECT vault FROM money_accounts WHERE id = ${r.body.account.id}`)[0].vault;
    expect(stored).not.toContain("4111");
    expect(stored).not.toContain("4321");
    expect(await openSecrets(stored, "correct horse")).toEqual({ number: "4111111111111111", cvv: "123", pin: "4321" });
    await expect(openSecrets(stored, "wrong horse")).rejects.toThrow("Wrong passphrase");
  });

  it("refuses plaintext secrets", async () => {
    const r = await post({ type: "accounts", name: "Oops", kind: "card", vault: JSON.stringify({ number: "4111111111111111", pin: "1234" }) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/encrypted/);
    expect((await fake`SELECT count(*)::int AS n FROM money_accounts WHERE name = 'Oops'`)[0].n).toBe(0);
  });

  it("editing other fields keeps the secrets; vault '' removes them", async () => {
    const vault = await sealSecrets({ number: "5500000000000004" }, "passphrase!", 100000);
    const a = (await post({ type: "accounts", name: "Axis", kind: "card", vault })).body.account;
    await put({ type: "accounts", id: a.id, name: "Axis Ace", kind: "card" });
    expect((await fake`SELECT vault FROM money_accounts WHERE id = ${a.id}`)[0].vault).toBe(vault);
    await put({ type: "accounts", id: a.id, name: "Axis Ace", kind: "card", vault: "" });
    expect((await fake`SELECT vault FROM money_accounts WHERE id = ${a.id}`)[0].vault).toBe("");
  });
});

describe("expenses on accounts, refunds, transfers", () => {
  it("puts an expense on an account and refunds part of it, never more than was spent", async () => {
    const acc = (await post({ type: "accounts", name: "SBI", kind: "bank", openingBalance: 10000 })).body.account;
    const e = (await post({ type: "expenses", amount: 1000, category: "Shopping", note: "Shoes", date: "2026-11-01", accountId: acc.id, taxTag: "nonsense" })).body.expense;
    expect(e.account_id).toBe(acc.id);
    expect(e.tax_tag).toBe("");
    const r1 = await post({ type: "refund", expenseId: e.id, amount: 400, date: "2026-11-05" });
    expect(r1.status).toBe(201);
    expect(parseFloat(r1.body.refund.amount)).toBe(-400);
    expect(r1.body.refund.account_id).toBe(acc.id);
    expect(r1.body.refund.category).toBe("Shopping");
    expect((await post({ type: "refund", expenseId: e.id, amount: 700, date: "2026-11-06" })).status).toBe(400);
    // Editing a refund keeps it negative.
    const upd = await put({ type: "expenses", id: r1.body.refund.id, amount: 300, category: "Shopping", note: "Refund", date: "2026-11-05" });
    expect(parseFloat(upd.body.expense.amount)).toBe(-300);
  });

  it("an edit without account fields leaves them alone", async () => {
    const acc = (await post({ type: "accounts", name: "Cash", kind: "cash" })).body.account;
    const e = (await post({ type: "expenses", amount: 50, category: "Food", date: "2026-11-02", accountId: acc.id, taxTag: "80D" })).body.expense;
    const u = (await put({ type: "expenses", id: e.id, amount: 60, category: "Food", date: "2026-11-02" })).body.expense;
    expect(u.account_id).toBe(acc.id);
    expect(u.tax_tag).toBe("80D");
    const cleared = (await put({ type: "expenses", id: e.id, amount: 60, category: "Food", date: "2026-11-02", accountId: null })).body.expense;
    expect(cleared.account_id).toBe(null);
  });

  it("won't attach another person's account", async () => {
    const theirs = await db.createAccount(2, { name: "Not yours", kind: "bank" });
    const e = (await post({ type: "expenses", amount: 10, category: "Food", date: "2026-11-02", accountId: theirs.id })).body.expense;
    expect(e.account_id).toBe(null);
  });

  it("transfers need two different sides", async () => {
    const acc = (await post({ type: "accounts", name: "ICICI", kind: "bank" })).body.account;
    expect((await post({ type: "transfer", fromAccount: acc.id, toAccount: acc.id, amount: 5, date: "2026-11-01" })).status).toBe(400);
    expect((await post({ type: "transfer", fromAccount: null, toAccount: acc.id, amount: 5, date: "2026-11-01" })).status).toBe(201);
  });

  it("deleting an account moves its expenses back to main and drops its transfers", async () => {
    const acc = (await post({ type: "accounts", name: "Temp", kind: "wallet" })).body.account;
    const e = (await post({ type: "expenses", amount: 70, category: "Food", date: "2026-11-02", accountId: acc.id })).body.expense;
    await post({ type: "transfer", fromAccount: null, toAccount: acc.id, amount: 100, date: "2026-11-01" });
    await del("accounts", acc.id);
    expect((await fake`SELECT account_id FROM expenses WHERE id = ${e.id}`)[0].account_id).toBe(null);
    expect((await fake`SELECT count(*)::int AS n FROM transfers WHERE to_account = ${acc.id}`)[0].n).toBe(0);
  });
});

describe("statement import", () => {
  it("adds debits as expenses and credits as money in, and adds nothing on a second run", async () => {
    const acc = (await post({ type: "accounts", name: "Kotak", kind: "bank" })).body.account;
    const rows = [
      { key: "2026-11-01|swiggy|250|0", date: "2026-11-01", description: "SWIGGY", amount: 250, type: "debit", category: "Food" },
      { key: "2026-11-01|swiggy|250|1", date: "2026-11-01", description: "SWIGGY", amount: 250, type: "debit", category: "Food" },
      { key: "2026-11-02|salary|50000|0", date: "2026-11-02", description: "SALARY", amount: 50000, type: "credit" },
      { key: "bad", date: "nope", amount: 1, type: "debit" },
    ];
    const first = await post({ type: "statement-import", accountId: acc.id, rows });
    expect(first.body).toMatchObject({ added: 2, credited: 1 });
    const again = await post({ type: "statement-import", accountId: acc.id, rows });
    expect(again.body).toMatchObject({ added: 0, credited: 0 });
    const t = (await fake`SELECT * FROM transfers WHERE to_account = ${acc.id} AND kind = 'income'`);
    expect(t).toHaveLength(1);
  });
});

describe("trips and loans", () => {
  it("creates a trip and tags expenses in its dates", async () => {
    await post({ type: "expenses", amount: 900, category: "Food", date: "2026-12-10", note: "Goa dinner" });
    const r = await post({ type: "trip", name: "Goa", startDate: "2026-12-09", endDate: "2026-12-12", people: 3, tagExisting: true });
    expect(r.status).toBe(201);
    expect(r.body.tagged).toBe(1);
    expect((await post({ type: "trip", name: "Bad", startDate: "2026-12-09", endDate: "2026-12-01" })).status).toBe(400);
    await del("trip", r.body.trip.id);
    expect((await fake`SELECT count(*)::int AS n FROM expenses WHERE note = 'Goa dinner' AND trip_id IS NULL`)[0].n).toBe(1);
  });

  it("saves a loan with prepayments", async () => {
    const r = await post({ type: "loan", name: "Home loan", principal: 2500000, rate: 8.5, tenureMonths: 240, startDate: "2025-01-10", prepayments: [{ date: "2026-01-01", amount: 100000 }, { date: "bad", amount: 5 }] });
    expect(r.status).toBe(201);
    expect(JSON.parse(r.body.loan.prepayments)).toEqual([{ date: "2026-01-01", amount: 100000 }]);
    expect((await post({ type: "loan", name: "x", principal: 0, tenureMonths: 12, startDate: "2025-01-01" })).status).toBe(400);
  });
});

describe("backup round trip", () => {
  it("exports the money tables and restores them into another person, re-pointing ids", async () => {
    const exp = (await get("export-all")).body;
    expect(exp.accounts.length).toBeGreaterThan(0);
    expect(exp.transfers.length).toBeGreaterThan(0);
    // Pretend user 3 restores user 1's backup.
    const result = await db.importAll(3, JSON.parse(JSON.stringify(exp)));
    expect(result.accounts).toBe(exp.accounts.length);
    const shoes = (await fake`SELECT e.account_id, a.user_id, a.name FROM expenses e JOIN money_accounts a ON a.id = e.account_id WHERE e.user_id = 3 AND e.note = 'Shoes'`)[0];
    expect(shoes).toMatchObject({ user_id: 3, name: "SBI" });
    const refund = (await fake`SELECT r.refund_of, o.note FROM expenses r JOIN expenses o ON o.id = r.refund_of WHERE r.user_id = 3 AND r.amount < 0`)[0];
    expect(refund.note).toBe("Shoes");
    const sealed = (await fake`SELECT vault FROM money_accounts WHERE user_id = 3 AND name = 'HDFC Regalia'`)[0].vault;
    expect((await openSecrets(sealed, "correct horse")).pin).toBe("4321");
    // Running it again adds nothing.
    const again = await db.importAll(3, JSON.parse(JSON.stringify(exp)));
    expect(again.accounts || 0).toBe(0);
    expect(again.expenses || 0).toBe(0);
    expect(again.transfers || 0).toBe(0);
  });
});
