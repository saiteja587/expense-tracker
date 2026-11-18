import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));

const db = await import("../lib/db");

const count = async (table) => (await fake.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

beforeAll(async () => {
  await db.ensureTables();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ensureTables", () => {
  it("records the schema version and is safe to re-run", async () => {
    const rows = await fake`SELECT value FROM app_settings WHERE key = 'schema_version'`;
    expect(rows[0].value).toBeTruthy();
    await db.ensureTables();
  });
});

describe("recurring generation", () => {
  it("adds a due recurring expense exactly once, however often the list loads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T06:00:00Z")); // 11:30 IST, Mar 15
    await db.createRecurring({ amount: 499, category: "Bills", note: "Phone", dayOfMonth: 10, affectsBalance: true });

    await Promise.all([db.listExpenses(), db.listExpenses(), db.listExpenses()]);
    await db.listExpenses();

    const rows = await fake`SELECT * FROM expenses WHERE note = 'Phone'`;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].expense_date instanceof Date ? rows[0].expense_date.toISOString() : rows[0].expense_date).slice(0, 10)).toBe("2026-03-10");
  });

  it("puts day 31 on the last day of a short month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-28T10:00:00Z"));
    await db.createRecurring({ amount: 100, category: "Bills", note: "Month-end", dayOfMonth: 31, affectsBalance: true });
    await db.listExpenses();
    const rows = await fake`SELECT to_char(expense_date, 'YYYY-MM-DD') AS d FROM expenses WHERE note = 'Month-end'`;
    expect(rows.map((r) => r.d)).toEqual(["2026-02-28"]);
  });

  it("uses India time: 00:30 IST on the 1st is already the new month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-30T19:00:00Z")); // 2026-05-01 00:30 IST
    await db.createRecurringIncome({ amount: 50000, note: "Salary", dayOfMonth: 1 });
    await db.listTopups();
    const rows = await fake`SELECT to_char(topup_date, 'YYYY-MM-DD') AS d FROM balance_topups WHERE note = 'Salary'`;
    expect(rows.map((r) => r.d)).toEqual(["2026-05-01"]);
  });
});

describe("idempotent creates", () => {
  it("returns the existing expense when the same clientRequestId is sent twice", async () => {
    const a = await db.createExpense({ amount: 40, category: "Food", note: "tea", date: "2026-01-02", clientRequestId: "req-1" });
    const b = await db.createExpense({ amount: 40, category: "Food", note: "tea", date: "2026-01-02", clientRequestId: "req-1" });
    expect(b.id).toBe(a.id);
    const rows = await fake`SELECT id FROM expenses WHERE client_request_id = 'req-1'`;
    expect(rows).toHaveLength(1);
  });

  it("still allows many expenses without a request id", async () => {
    await db.createExpense({ amount: 1, category: "Food", date: "2026-01-03" });
    await db.createExpense({ amount: 1, category: "Food", date: "2026-01-03" });
    const rows = await fake`SELECT id FROM expenses WHERE expense_date = '2026-01-03'`;
    expect(rows).toHaveLength(2);
  });
});

describe("receipts", () => {
  it("lists has_receipt instead of the photo, and keeps the photo on edit unless told otherwise", async () => {
    const e = await db.createExpense({ amount: 300, category: "Shopping", date: "2026-01-05", receiptPhoto: "data:image/jpeg;base64,AAA" });
    const listed = (await db.listExpenses()).find((x) => x.id === e.id);
    expect(listed.has_receipt).toBe(true);
    expect(listed.receipt_photo).toBeUndefined();

    await db.updateExpense(e.id, { amount: 310, category: "Shopping", date: "2026-01-05", receiptPhoto: null });
    expect(await db.getExpenseReceipt(e.id)).toBe("data:image/jpeg;base64,AAA");

    await db.updateExpense(e.id, { amount: 310, category: "Shopping", date: "2026-01-05", receiptPhoto: "" });
    expect(await db.getExpenseReceipt(e.id)).toBe("");
  });
});

describe("archiveChallenge", () => {
  it("moves the challenge to history and clears it in one go", async () => {
    await db.setChallengeMeta("2026-01-01", 30, 0, 0);
    await db.upsertChallengeDay("2026-01-01", true, "", "", false);
    await db.archiveChallenge({ startDate: "2026-01-01", lengthDays: 30, completedDays: 1, longestStreak: 1 });
    expect(await db.getChallengeMeta()).toBeNull();
    expect(await db.listChallengeDays()).toHaveLength(0);
    expect((await db.listChallengeHistory()).length).toBeGreaterThan(0);
  });
});

describe("importAll", () => {
  const backup = {
    expenses: [
      { amount: "120.00", category: "Food", note: "lunch", expense_date: "2025-12-01", expense_time: "13:05:00", affects_balance: true, receipt_photo: "data:x", created_at: "2025-12-01T07:35:12.345Z" },
      { amount: "40.00", category: "Food", note: "tea", expense_date: "2025-12-01", affects_balance: true, created_at: "2025-12-01T10:00:00.001Z" },
    ],
    ious: [{ person_name: "Ravi", amount: "500", direction: "owed_to_me", settled: true, created_at: "2025-11-01T00:00:00.000Z" }],
    recurring: [{ amount: "999", category: "Bills", note: "Internet", day_of_month: 5, last_generated_month: "2099-01", created_at: "2025-10-01T00:00:00.000Z" }],
    sugarChallenge: { history: [{ start_date: "2025-01-01", length_days: 41, completed_days: 30, longest_streak: 12, ended_at: "2025-02-11T00:00:00.000Z" }] },
    theatres: ["PVR", "My Local Cinema"],
    savingsGoal: { targetAmount: 100000, label: "Bike" },
  };

  it("imports everything, including fields that used to be lost", async () => {
    const r = await db.importAll(backup);
    expect(r.expenses).toBe(2);
    const lunch = (await fake`SELECT * FROM expenses WHERE note = 'lunch'`)[0];
    expect(lunch.receipt_photo).toBe("data:x");
    const iou = (await fake`SELECT * FROM ious WHERE person_name = 'Ravi'`)[0];
    expect(iou.settled).toBe(true);
    const rec = (await fake`SELECT * FROM recurring_expenses WHERE note = 'Internet'`)[0];
    expect(rec.last_generated_month).toBe("2099-01");
    expect((await db.listChallengeHistory()).some((h) => h.completed_days === 30)).toBe(true);
    expect(JSON.parse(await db.getSetting("custom_theatres"))).toEqual(["PVR", "My Local Cinema"]);
    expect(await db.getSavingsGoal()).toEqual({ targetAmount: 100000, label: "Bike" });
  });

  it("skips everything on a second import of the same file", async () => {
    const before = await count("expenses");
    const r = await db.importAll(backup);
    expect(r.expenses || 0).toBe(0);
    expect(r.ious || 0).toBe(0);
    expect(await count("expenses")).toBe(before);
  });

  it("skips rows already in the database even when created_at had microseconds", async () => {
    // Simulate a row created by the app (microsecond precision), then
    // exported to JSON (millisecond precision) and imported back.
    await fake`INSERT INTO expenses (amount, category, expense_date, created_at) VALUES (77, 'Food', '2025-12-24', '2025-12-24T08:00:00.123456Z')`;
    const r = await db.importAll({ expenses: [{ amount: "77.00", category: "Food", expense_date: "2025-12-24", created_at: "2025-12-24T08:00:00.123Z" }] });
    expect(r.expenses || 0).toBe(0);
  });

  it("is all-or-nothing: a bad row rolls back the whole call", async () => {
    const before = await count("expenses");
    await expect(
      db.importAll({
        expenses: [
          { amount: "1", category: "Food", expense_date: "2025-12-02", created_at: "2025-12-02T00:00:00.000Z" },
          { amount: "1", category: "Food", expense_date: "not-a-date", created_at: "2025-12-02T00:00:01.000Z" },
        ],
      })
    ).rejects.toThrow();
    expect(await count("expenses")).toBe(before);
  });
});
