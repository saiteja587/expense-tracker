import { describe, it, expect } from "vitest";
import { generateInsights } from "../lib/insights";
import { computeBadges, levelFor } from "../lib/achievements";
import { makeChallenge, evaluateChallenge, nextSaturday } from "../lib/miniChallenges";
import { addDays } from "../lib/ledger";

const T = "2026-11-18";
const e = (date, amount, extra = {}) => ({ date, amount, category: "Food", note: "", time: "", affectsBalance: true, ...extra });

describe("insights", () => {
  it("says nothing with too little data", () => {
    expect(generateInsights({ items: [e(T, 10)], todayIso: T })).toEqual([]);
  });
  it("spots a small habit that adds up", () => {
    const items = [1, 2, 3, 4, 5].map((d) => e(`2026-11-0${d}`, 40, { note: "Tea" }));
    const out = generateInsights({ items, todayIso: T });
    expect(out.find((i) => i.id === "habit").text).toMatch(/^Tea: 5 times this month — ₹200 so far/);
  });
  it("compares pace with last month without silly percentages", () => {
    const items = [
      ...[1, 2, 3, 4, 5, 6].map((d) => e(`2026-10-0${d}`, 1000)),
      ...[1, 2, 3].map((d) => e(`2026-11-0${d}`, 500)),
    ];
    const pace = generateInsights({ items, todayIso: T }).find((i) => i.id === "pace");
    expect(pace.tone).toBe("good");
    expect(pace.text).toContain("₹4,500 below");
    for (const i of generateInsights({ items, todayIso: T })) expect(i.text).not.toMatch(/\d{4,}%/);
  });
});

describe("badges", () => {
  it("earns streak and no-spend badges from the data", () => {
    const expenses = Array.from({ length: 8 }, (_, i) => e(addDays(T, -i), 50));
    expenses.push(e(addDays(T, -10), 50)); // gap on day −9 → a no-spend day
    const badges = computeBadges({ expenses }, T);
    const get = (id) => badges.find((b) => b.id === id);
    expect(get("first").earned).toBe(true);
    expect(get("streak7").earned).toBe(true);
    expect(get("streak30").progress).toBeCloseTo(8 / 30);
    expect(get("nospend1").earned).toBe(true);
    const lv = levelFor(badges);
    expect(lv.xp).toBe(10 + 50 + 20);
    expect(lv.level).toBe(2);
  });
  it("sugar badges use the longest streak, including past challenges", () => {
    const badges = computeBadges({ challengeHistory: [{ longest_streak: 22 }] }, T);
    expect(badges.find((b) => b.id === "sugar21").earned).toBe(true);
    expect(badges.find((b) => b.id === "sugar41").earned).toBe(false);
  });
});

describe("mini challenges", () => {
  it("no-delivery week: lost on a Swiggy order, won if clean", () => {
    const ch = makeChallenge("no_delivery", "2026-11-01");
    expect(evaluateChallenge(ch, [e("2026-11-03", 300, { note: "Swiggy dinner" })], T).status).toBe("lost");
    const won = evaluateChallenge(ch, [e("2026-11-03", 300, { note: "Groceries" })], T);
    expect(won.status).toBe("won");
    expect(won.dayStates.every((s) => s === "ok")).toBe(true);
  });
  it("daily cap counts the whole day's spend, today stays open", () => {
    const ch = makeChallenge("daily_cap", "2026-11-16", 500);
    const r = evaluateChallenge(ch, [e("2026-11-16", 300), e("2026-11-17", 200), e("2026-11-17", 350), e(T, 100)], T); // 550 on the 17th
    expect(r.dayStates.slice(0, 3)).toEqual(["ok", "broken", "today"]);
    expect(r.status).toBe("lost");
  });
  it("log-daily only judges finished days", () => {
    const r = evaluateChallenge(makeChallenge("log_daily", "2026-11-17"), [e("2026-11-17", 10)], T);
    expect(r.dayStates.slice(0, 2)).toEqual(["ok", "today"]);
    expect(r.status).toBe("active");
  });
  it("weekend challenge starts on the next Saturday", () => {
    expect(nextSaturday(T)).toBe("2026-11-21");
    expect(evaluateChallenge(makeChallenge("no_spend_weekend", T), [], T).status).toBe("upcoming");
  });
});
