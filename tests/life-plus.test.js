import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rewardRate, feeWaiver, pickCard, pointsExpiring, choreNext, doseTimes, medicineDay, dueDoses, meterStats, goalProgress,
  wishStatus, upiLink, parsePdfStatementLines, taxNudge, lifeYear,
} from "../lib/lifePlus";
import { createFakeNeon } from "./helpers/pgliteNeon";

const today = "2026-11-22";
const card = (o) => ({ kind: "card", id: 1, name: "A", creditLimit: 100000, rewardDefault: 1, rewardRules: [], ...o });

describe("cards", () => {
  it("reward by category, else the default", () => {
    const c = card({ rewardRules: [{ category: "Food", pct: 5 }] });
    expect(rewardRate(c, "food")).toBe(5);
    expect(rewardRate(c, "Shopping")).toBe(1);
  });
  it("fee waiver progress in the card year", () => {
    const c = card({ annualFee: 1000, feeWaiverSpend: 100000, feeMonth: 4 });
    const fw = feeWaiver(c, [{ accountId: 1, amount: 40000, date: "2026-05-01" }, { accountId: 1, amount: 9999, date: "2026-03-30" }], today);
    expect(fw).toMatchObject({ start: "2026-04-01", end: "2027-03-31", spent: 40000, left: 60000, done: false });
  });
  it("picks the best card that fits, explaining why", () => {
    const a = card({ id: 1, name: "Swiggy HDFC", rewardRules: [{ category: "Food", pct: 10 }] });
    const b = card({ id: 2, name: "Amazon ICICI", rewardDefault: 1, rewardRules: [{ category: "Shopping", pct: 5 }] });
    const full = card({ id: 3, name: "Maxed", rewardDefault: 20 });
    const cycles = { 1: { outstanding: 0, available: 100000 }, 2: { outstanding: 0, available: 100000 }, 3: { outstanding: 99900, available: 100 } };
    const r = pickCard({ cards: [a, b, full], category: "Food", amount: 600, cycles, expenses: [], todayIso: today });
    expect(r.map((x) => x.card.name)).toEqual(["Swiggy HDFC", "Amazon ICICI"]);
    expect(r[0].reward).toBe(60);
    expect(r[0].reasons[0]).toMatch(/10% back on Food/);
  });
  it("warns about points expiring within 60 days", () => {
    expect(pointsExpiring(card({ points: 4200, pointsExpiry: "2026-12-15" }), today)).toEqual({ points: 4200, daysLeft: 23, date: "2026-12-15" });
    expect(pointsExpiring(card({ points: 4200, pointsExpiry: "2027-06-01" }), today)).toBe(null);
  });
});

describe("home & health", () => {
  it("chores come round again", () => {
    expect(choreNext({ date: "2026-06-10", everyMonths: 6 }, today)).toEqual({ next: "2026-12-10", daysLeft: 18 });
    expect(choreNext({ date: "2026-11-01", everyDays: 30 }, today).next).toBe("2026-12-01");
  });
  it("medicines: today's doses, stock and due reminders", () => {
    const m = { id: 4, times: "20:00, 08:00, bad", stock: 9, perDose: 1, refillAt: 0 };
    expect(doseTimes(m)).toEqual(["08:00", "20:00"]);
    const doses = [{ refId: 4, date: today, time: "08:00" }];
    const day = medicineDay(m, doses, today);
    expect(day).toMatchObject({ daysLeft: 4, refill: true });
    expect(day.times).toEqual([{ time: "08:00", taken: true }, { time: "20:00", taken: false }]);
    expect(dueDoses([m], doses, today, "20:30").map((x) => x.time)).toEqual(["20:00"]);
    expect(dueDoses([m], doses, today, "23:30")).toEqual([]);
    expect(dueDoses([{ ...m, paused: true }], doses, today, "20:30")).toEqual([]);
  });
  it("meter units per month, cost per unit, change vs usual", () => {
    const meter = { id: 7 };
    const rd = (date, reading, amount) => ({ refId: 7, date, reading, amount });
    const s = meterStats(meter, [rd("2026-07-01", 1000), rd("2026-08-01", 1150, 900), rd("2026-09-01", 1300, 900), rd("2026-10-01", 1450, 900), rd("2026-10-31", 1650, 1200)]);
    expect(s.last).toMatchObject({ units: 200, perMonth: 200 });
    expect(s.usual).toBe(146.8); // 150 units over 31, 31 and 30 days
    expect(s.change).toBe(36);
    expect(s.costPerUnit).toBe(6); // ₹3,900 for 650 units
  });
});

describe("goals, wishlist, UPI", () => {
  it("savings, weight and habit goals read live numbers", () => {
    const ctx = { balances: { 3: 25000 }, mainBalance: 0, latestWeight: 78, habitLogs: [{ refId: 9, date: "2026-11-01" }, { refId: 9, date: "2026-11-02" }], todayIso: today };
    expect(goalProgress({ type: "savings", target: 100000, accountId: 3 }, ctx)).toMatchObject({ current: 25000, pct: 0.25 });
    expect(goalProgress({ type: "weight", target: 75, start: 80 }, ctx).pct).toBeCloseTo(0.4);
    expect(goalProgress({ type: "habit", target: 20, habitId: 9 }, ctx).current).toBe(2);
    expect(goalProgress({ type: "custom", target: 12, current: 12 }, ctx).done).toBe(true);
  });
  it("30-day rule", () => {
    expect(wishStatus({ date: "2026-10-01", target: 20000, price: 19999 }, today)).toEqual({ waited: 52, coolingDone: true, atTarget: true });
  });
  it("UPI pay link", () => {
    expect(upiLink({ vpa: "ravi@okhdfc", name: "Ravi K", amount: 250, note: "Dinner split" })).toBe("upi://pay?pa=ravi%40okhdfc&pn=Ravi%20K&cu=INR&am=250.00&tn=Dinner%20split");
    expect(upiLink({ vpa: "not-upi" })).toBe(null);
  });
});

describe("PDF statements & tax", () => {
  it("reads lines with a running balance to tell debits from credits", () => {
    const rows = parsePdfStatementLines([
      "Date Narration Chq Value Dt Withdrawal Deposit Balance",
      "Opening balance 50,000.00",
      "01/11/26 UPI-SWIGGY-12345 01/11/26 1,250.00 48,750.00",
      "02/11/26 NEFT SALARY ACME 02/11/26 75,000.00 1,23,750.00",
      "03 Nov 2026 AMAZON PAY 999.00 Dr",
    ]);
    expect(rows).toEqual([
      { date: "2026-11-01", description: "UPI-SWIGGY-12345", amount: 1250, type: "debit" },
      { date: "2026-11-02", description: "NEFT SALARY ACME", amount: 75000, type: "credit" },
      { date: "2026-11-03", description: "AMAZON PAY", amount: 999, type: "debit" },
    ]);
  });
  it("nudges about 80C room only in January–March", () => {
    expect(taxNudge([{ amount: 50000, date: "2026-06-01", taxTag: "80C" }], "2027-02-01")).toMatchObject({ room: 100000, fy: "FY 2026–27" });
    expect(taxNudge([], today)).toBe(null);
  });
});

describe("year in life", () => {
  it("adds up habits, weight, sleep, km and more", () => {
    const life = [
      { kind: "habit", id: 1, name: "Walk" },
      { kind: "habit_log", refId: 1, date: "2026-03-01" }, { kind: "habit_log", refId: 1, date: "2026-03-02" },
      { kind: "day_log", date: "2026-01-05", weight: 80, sleepHours: 7, mood: 4, journal: "ok" },
      { kind: "day_log", date: "2026-10-05", weight: 76.5, sleepHours: 6, mood: 2 },
      { kind: "fuel", refId: 5, date: "2026-02-01", odometer: 1000 }, { kind: "fuel", refId: 5, date: "2026-09-01", odometer: 6000 },
    ];
    expect(lifeYear({ year: 2026, life, trips: [{ startDate: "2026-05-01" }] })).toMatchObject({
      habitCheckins: 2, topHabit: { name: "Walk", days: 2, best: 2 }, weightChange: -3.5, avgSleep: 6.5, goodDays: 1, journalEntries: 1, km: 5000, trips: 1,
    });
  });
});

// ---- API ----
const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const { default: handler } = await import("../pages/api/data");
const { clearTmdbMemory } = await import("../lib/tmdb");
async function call(method, { query = {}, body } = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method, query, body, headers: {} }, res);
  return out;
}
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); clearTmdbMemory(); });

describe("API", () => {
  it("card reward settings round-trip and survive an edit that doesn't send them", async () => {
    const a = (await call("POST", { body: { type: "accounts", name: "HDFC", kind: "card", rewardType: "cashback", rewardDefault: 1.5, rewardRules: [{ category: "Food", pct: 5 }, { category: "", pct: 9 }], annualFee: 500, feeWaiverSpend: 50000, feeMonth: 4, points: 1200, pointsExpiry: "2027-01-01" } })).body.account;
    expect(a).toMatchObject({ reward_type: "cashback", annual_fee: "500.00", fee_month: 4, points: 1200 });
    expect(JSON.parse(a.reward_rules)).toEqual([{ category: "Food", pct: 5 }]);
    const b = (await call("PUT", { body: { type: "accounts", id: a.id, name: "HDFC Millennia", kind: "card" } })).body.account;
    expect(b.reward_type).toBe("cashback");
  });

  it("mutual fund units are priced from the NAV", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ meta: { scheme_code: 122639, scheme_name: "PPFAS Flexi Direct" }, data: [{ date: "20-11-2026", nav: "95.4585" }] })));
    const asset = (await call("POST", { body: { type: "asset", name: "PPFAS", kind: "mf", schemeCode: "122639", units: 100.5, value: 0 } })).body.asset;
    expect(asset.scheme_code).toBe("122639");
    expect((await call("POST", { body: { type: "refresh-funds" } })).body.updated).toBe(1);
    expect(parseFloat((await fake`SELECT value FROM assets WHERE id = ${asset.id}`)[0].value)).toBe(9593.58);
    expect((await call("GET", { query: { type: "mf-nav", code: "122639" } })).body.nav).toEqual({ code: "122639", name: "PPFAS Flexi Direct", nav: 95.4585, date: "2026-11-20" });
  });

  it("currency rates only for supported currencies", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ date: "2026-11-20", rates: { INR: 92.68 } })));
    expect((await call("GET", { query: { type: "fx", from: "usd", date: "2026-11-20" } })).body.fx).toEqual({ rate: 92.68, date: "2026-11-20" });
    expect((await call("GET", { query: { type: "fx", from: "AED" } })).body.fx).toBe(null);
  });

  it("my UPI id and a payee UPI on an IOU are validated", async () => {
    expect((await call("POST", { body: { type: "my-upi", upi: "me at bank" } })).status).toBe(400);
    expect((await call("POST", { body: { type: "my-upi", upi: "me@okaxis" } })).body.upi).toBe("me@okaxis");
    expect((await call("GET", { query: { type: "my-upi" } })).body.upi).toBe("me@okaxis");
    const iou = (await call("POST", { body: { type: "ious", personName: "Ravi", amount: 200, direction: "i_owe" } })).body.iou;
    expect((await call("POST", { body: { type: "iou-upi", id: iou.id, upiId: "ravi@ybl" } })).body.upi_id).toBe("ravi@ybl");
    expect((await call("POST", { body: { type: "iou-upi", id: iou.id, upiId: "junk" } })).body.upi_id).toBe("");
  });

  it("new life kinds save with their own rules", async () => {
    expect((await call("POST", { body: { type: "life", kind: "chore", data: { name: "AC service", everyMonths: 6 } } })).status).toBe(201);
    expect((await call("POST", { body: { type: "life", kind: "goal", data: { title: "Emergency fund", type: "savings", target: 100000 } } })).status).toBe(201);
    const med = (await call("POST", { body: { type: "life", kind: "medicine", data: { name: "Vitamin D", times: "08:00", stock: 30 } } })).body.item;
    expect((await call("POST", { body: { type: "life", kind: "dose", refId: med.id, date: "2026-11-22", data: { time: "08:00" } } })).status).toBe(201);
    expect((await call("POST", { body: { type: "life", kind: "day_log", date: "2026-11-22", data: { journal: "Good day" } } })).status).toBe(201);
  });
});

// ---- Medicine reminders ride on the frequent water ping ----
const pushed = [];
vi.mock("../lib/push", () => ({ sendToUser: async (uid, p) => { pushed.push({ uid, ...p }); return { sent: 1 }; }, sendToAll: async () => ({}) }));
const { default: water } = await import("../pages/api/notify-water");
describe("medicine dose reminders", () => {
  it("reminds once per dose time, not again on the next ping, and not once taken", async () => {
    vi.stubEnv("WATER_NOTIFY_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T03:00:00Z")); // 08:30 IST
    const med = (await call("POST", { body: { type: "life", kind: "medicine", data: { name: "Thyroxine", dose: "50mcg", times: "08:00, 21:00", stock: 20 } } })).body.item;
    const ping = async () => { const out = {}; await water({ query: { secret: "s3cret" } }, { status() { return this; }, json(b) { Object.assign(out, b); return this; } }); return out; };
    pushed.length = 0;
    const thy = (r) => r.medicines.filter((x) => x.includes("Thyroxine"));
    expect(thy(await ping())).toEqual([expect.stringContaining("Thyroxine@08:00")]);
    expect(pushed.filter((p) => p.title.includes("Thyroxine"))).toHaveLength(1);
    expect(thy(await ping())).toEqual([]);
    vi.setSystemTime(new Date("2026-11-23T15:45:00Z")); // 21:15 IST, evening dose already taken
    await call("POST", { body: { type: "life", kind: "dose", refId: med.id, date: "2026-11-23", data: { time: "21:00" } } });
    expect(thy(await ping())).toEqual([]);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
});
