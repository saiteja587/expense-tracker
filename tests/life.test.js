import { describe, it, expect, vi } from "vitest";
import {
  cleanLifeData, habitStats, healthSummary, sleepHoursFrom, addMonths, dueStatus, warrantyEnds, vehicleStats,
  nextOccurrence, ottOptimizer, weeklySummary, expensesCsv,
} from "../lib/life";
import { searchFoods, dailyTargets, dayTotals, weeklyPlan, claudePrompt } from "../lib/diet";
import { createFakeNeon } from "./helpers/pgliteNeon";

const today = "2026-11-22"; // a Sunday
const exp = (id, amount, date, extra = {}) => ({ id, amount, date, category: "Food", note: "", ...extra });

describe("cleaning life items", () => {
  it("keeps only known fields, in range", () => {
    expect(cleanLifeData("day_log", { weight: "72.5", mood: 9, bed: "23:30", hack: "x", sleepHours: -2 })).toEqual({ weight: 72.5, mood: 5, bed: "23:30" });
    expect(cleanLifeData("renewal", { name: " Car insurance ", category: "bogus", amount: "8500", everyMonths: 12 })).toEqual({ name: "Car insurance", amount: 8500, everyMonths: 12 });
  });
  it("needs a name, and knows its kinds", () => {
    expect(() => cleanLifeData("habit", {})).toThrow("Give it a name");
    expect(() => cleanLifeData("nope", {})).toThrow("Unknown");
  });
});

describe("habits", () => {
  it("counts the streak (today may still be open), best run and this week", () => {
    const logs = ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((date) => ({ refId: 1, date }));
    const s = habitStats({ id: 1, perWeek: 3 }, logs, today);
    expect(s).toMatchObject({ doneToday: false, streak: 3, best: 4, thisWeek: 3, goalMet: true });
    expect(s.week).toHaveLength(7);
    expect(s.week[0].date).toBe("2026-11-16");
  });
});

describe("health", () => {
  it("weight trend week over week, sleep from times, and mood vs spending", () => {
    const logs = [
      { date: "2026-11-10", weight: 75 }, { date: "2026-11-12", weight: 74.6 },
      { date: "2026-11-18", weight: 74.2 }, { date: "2026-11-21", weight: 73.8 },
    ];
    for (let k = 1; k <= 3; k++) logs.push({ date: `2026-10-0${k}`, mood: 1 }, { date: `2026-10-1${k}`, mood: 5 });
    const items = [];
    for (let k = 1; k <= 3; k++) items.push(exp(k, 900, `2026-10-0${k}`), exp(10 + k, 200, `2026-10-1${k}`));
    const h = healthSummary(logs, items, today);
    expect(h.latestWeight).toBe(73.8);
    expect(h.weekChange).toBe(-0.8);
    expect(h.moodInsight).toMatch(/4\.5×/);
    expect(sleepHoursFrom("23:30", "07:00")).toBe(7.5);
    expect(sleepHoursFrom("01:00", "06:30")).toBe(5.5);
  });
});

describe("renewals, warranties, occasions", () => {
  it("moves dates by months, clamping month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-22", 12)).toBe("2027-11-22");
  });
  it("tells how soon something is due", () => {
    expect(dueStatus("2026-11-25", today)).toEqual({ daysLeft: 3, level: "soon" });
    expect(dueStatus("2026-11-01", today).level).toBe("overdue");
    expect(warrantyEnds({ date: "2025-12-01", months: 12 })).toBe("2026-12-01");
  });
  it("finds the next birthday, this year or next", () => {
    expect(nextOccurrence({ month: 11, day: 25 }, today)).toEqual({ date: "2026-11-25", daysLeft: 3 });
    expect(nextOccurrence({ month: 1, day: 5 }, today).date).toBe("2027-01-05");
    expect(nextOccurrence({ month: 2, day: 29 }, "2026-02-01").date).toBe("2026-02-28");
  });
});

describe("vehicles", () => {
  it("mileage from full tank to full tank, and km to the next service", () => {
    const v = { id: 5, serviceEveryKm: 3000, lastServiceKm: 10000 };
    const fills = [
      { refId: 5, odometer: 10000, litres: 5, amount: 500, full: true },
      { refId: 5, odometer: 10100, litres: 2, amount: 200, full: false },
      { refId: 5, odometer: 10400, litres: 6, amount: 600, full: true },
    ];
    const s = vehicleStats(v, fills);
    expect(s.mileage).toBe(50); // 400 km / 8 L
    expect(s.odometer).toBe(10400);
    expect(s.kmToService).toBe(2600);
    expect(s.costPerKm).toBe(1.8); // (1300 − 600 not yet used) / 400 km
  });
});

describe("OTT optimizer", () => {
  it("flags apps you pay for but barely watch", () => {
    const expenses = [exp(1, 649, "2026-10-05", { note: "Netflix" }), exp(2, 649, "2026-11-05", { note: "Netflix" }), exp(3, 299, "2026-11-01", { note: "Hotstar" })];
    const movies = [{ venueType: "OTT", venueName: "Hotstar", date: "2026-11-10" }, { venueType: "OTT", venueName: "Hotstar", date: "2026-11-12" }];
    const r = ottOptimizer({ expenses, movies, shows: [], todayIso: today });
    expect(r.idle.map((x) => x.key)).toEqual(["netflix"]);
    expect(r.canSave).toBe(649);
  });
});

describe("weekly summary & CSV", () => {
  it("sums the last 7 days", () => {
    const w = weeklySummary({ items: [exp(1, 300, "2026-11-20"), exp(2, 100, "2026-11-22", { category: "Transport" }), exp(3, 999, "2026-11-10")], sugarDays: { "2026-11-21": true }, todayIso: today });
    expect(w.text).toBe("₹400 spent · most on Food · 1 sugar-free day");
  });
  it("writes quoted CSV", () => {
    expect(expensesCsv([{ date: "2026-11-01", category: "Food", note: 'Dinner "big"', amount: 250 }]).split("\n")[1]).toBe('"2026-11-01","","Food","Dinner ""big""","250","",""');
  });
});

describe("diet", () => {
  it("finds Indian foods and totals a day", () => {
    expect(searchFoods("dosa").map((f) => f.name)).toContain("Masala dosa");
    const t = dayTotals([{ date: today, kcal: 110, protein: 3, qty: 2 }, { date: today, kcal: 150, protein: 9, qty: 1 }, { date: "2026-11-21", kcal: 999 }], today);
    expect(t).toMatchObject({ kcal: 370, protein: 15 });
  });
  it("targets from goal and weight", () => {
    expect(dailyTargets("lose", 80)).toEqual({ kcal: 1900, protein: 112, sugar: 25 });
    expect(dailyTargets("lowsugar", 0).sugar).toBe(15);
  });
  it("a vegetarian plan has no egg or meat, covers 7 days and prices a shopping list", () => {
    const p = weeklyPlan({ goal: "lose", diet: "veg", startIso: today });
    expect(p.days).toHaveLength(7);
    const names = p.days.flatMap((d) => d.meals.map((m) => m.name)).join(" ");
    expect(names).not.toMatch(/egg|omelette|chicken|fish/i);
    expect(p.totalCost).toBeGreaterThan(0);
    expect(p.shopping.find((x) => x.item === "Atta")).toBeTruthy();
    const nv = weeklyPlan({ goal: "muscle", diet: "nonveg", startIso: today, seed: 1 });
    expect(nv.days.flatMap((d) => d.meals).some((m) => /chicken|fish|egg/i.test(m.name))).toBe(true);
  });
  it("builds a prompt for the Claude app with the week's food", () => {
    const pr = claudePrompt({ goal: "lose", diet: "veg", weight: 80, targets: { kcal: 1900, protein: 112, sugar: 25 }, foodLogs: [{ date: today, meal: "lunch", name: "Rajma", qty: 1, kcal: 210 }], todayIso: today });
    expect(pr).toContain("Goal: Lose weight");
    expect(pr).toContain("Rajma");
  });
});

// ---- Through the API ----
const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const { default: handler } = await import("../pages/api/data");
const db = await import("../lib/db");
async function call(method, { query = {}, body } = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method, query, body, headers: {} }, res);
  return out;
}
const post = (body) => call("POST", { body });

describe("life API", () => {
  it("habits: create, check in once per day, toggle off, delete with its check-ins", async () => {
    const h = (await post({ type: "life", kind: "habit", data: { name: "Walk 30 min", perWeek: 5 } })).body.item;
    expect((await post({ type: "habit-toggle", habitId: h.id, date: today, on: true })).status).toBe(200);
    await post({ type: "habit-toggle", habitId: h.id, date: today, on: true });
    let logs = (await call("GET", { query: { type: "life", kinds: "habit_log" } })).body.items;
    expect(logs).toHaveLength(1);
    await post({ type: "habit-toggle", habitId: h.id, date: today, on: false });
    logs = (await call("GET", { query: { type: "life", kinds: "habit_log" } })).body.items;
    expect(logs).toHaveLength(0);
    await post({ type: "habit-toggle", habitId: h.id, date: "2026-11-21", on: true });
    await call("DELETE", { query: { type: "life", id: String(h.id) } });
    expect((await fake`SELECT count(*)::int AS n FROM life_items WHERE kind LIKE 'habit%'`)[0].n).toBe(0);
  });

  it("day log: weight and mood saved separately merge into one row", async () => {
    await post({ type: "life", kind: "day_log", date: today, data: { weight: 72 } });
    await post({ type: "life", kind: "day_log", date: today, data: { mood: 4 } });
    const rows = (await call("GET", { query: { type: "life", kinds: "day_log" } })).body.items;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data)).toEqual({ weight: 72, mood: 4 });
  });

  it("documents take only sealed secrets; photos must be images", async () => {
    const bad = await post({ type: "life", kind: "document", data: { name: "PAN" }, vault: JSON.stringify({ pan: "ABCDE1234F" }) });
    expect(bad.status).toBe(400);
    const pic = await post({ type: "life", kind: "warranty", date: today, data: { name: "TV", months: 12 }, photo: "javascript:alert(1)" });
    expect(pic.status).toBe(400);
    const ok = await post({ type: "life", kind: "warranty", date: today, data: { name: "TV", months: 12 }, photo: "data:image/jpeg;base64,AAAA" });
    expect(ok.body.item.has_photo).toBe(true);
    expect((await call("GET", { query: { type: "life-photo", id: String(ok.body.item.id) } })).body.photo).toContain("data:image/jpeg");
  });

  it("a fuel fill must belong to your own vehicle", async () => {
    const theirs = await db.saveLife(2, null, { kind: "vehicle", data: { name: "Their bike" } });
    expect((await post({ type: "life", kind: "fuel", refId: theirs.id, date: today, data: { litres: 5 } })).status).toBe(400);
  });

  it("the vault check is set once", async () => {
    const sealed = JSON.stringify({ v: 1, iter: 100000, salt: "c2FsdA==", iv: "aXY=", ct: "Y3Q=" });
    expect((await post({ type: "vault-check", check: sealed })).status).toBe(201);
    expect((await post({ type: "vault-check", check: sealed })).body.existed).toBe(true);
    expect((await call("GET", { query: { type: "vault-check" } })).body.check).toContain('"v":1');
  });

  it("backs up and restores life items with parents re-linked", async () => {
    const v = (await post({ type: "life", kind: "vehicle", data: { name: "Activa" } })).body.item;
    await post({ type: "life", kind: "fuel", refId: v.id, date: today, data: { litres: 4, odometer: 1200, full: true } });
    const exp2 = (await call("GET", { query: { type: "export-all" } })).body;
    const r = await db.importAll(9, JSON.parse(JSON.stringify(exp2)));
    expect(r.life).toBeGreaterThan(0);
    const fuel = (await fake`SELECT f.ref_id, v.data FROM life_items f JOIN life_items v ON v.id = f.ref_id WHERE f.user_id = 9 AND f.kind = 'fuel'`)[0];
    expect(JSON.parse(fuel.data).name).toBe("Activa");
    expect((await db.importAll(9, JSON.parse(JSON.stringify(exp2)))).life || 0).toBe(0);
  });

  it("a recurring bill on a card lands on that card", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T06:00:00Z"));
    const card = (await post({ type: "accounts", name: "HDFC", kind: "card" })).body.account;
    await post({ type: "recurring", amount: 649, category: "Bills", note: "Netflix", dayOfMonth: 5, accountId: card.id });
    await db.listExpenses(1);
    const row = (await fake`SELECT account_id FROM expenses WHERE note = 'Netflix' AND user_id = 1`)[0];
    expect(row.account_id).toBe(card.id);
    vi.useRealTimers();
  });
});
