import { describe, it, expect } from "vitest";
import { learnCategory, detectSubscriptions, affordability, monthCalendar, jars } from "../lib/smart";
import { seasonFor } from "../lib/festivals";
import { balances, settleUp } from "../lib/settle";
import { analyseSlips } from "../lib/slipTriggers";

const T = "2026-11-18";
const e = (date, amount, note = "", category = "Food") => ({ date, amount, note, category });

describe("learnCategory", () => {
  const hist = [e(T, 120, "Auto to office", "Transport"), e(T, 90, "auto home", "Transport"), e(T, 300, "Swiggy dinner", "Food"), e(T, 250, "swiggy lunch", "Food")];
  it("uses your own history", () => {
    expect(learnCategory(hist, "auto")).toBe("Transport");
    expect(learnCategory(hist, "Swiggy biryani")).toBe("Food");
  });
  it("stays quiet with too little evidence", () => {
    expect(learnCategory(hist, "dinner")).toBeNull();
    expect(learnCategory(hist, "")).toBeNull();
  });
});

describe("subscriptions", () => {
  it("finds steady monthly charges and brands, flags stale ones", () => {
    const xs = [
      e("2026-09-05", 649, "Netflix", "Entertainment"), e("2026-10-05", 649, "Netflix", "Entertainment"), e("2026-11-05", 649, "Netflix", "Entertainment"),
      e("2026-08-10", 1499, "Hotstar", "Entertainment"),
      e("2026-10-01", 1200, "Gym fees", "Health"), e("2026-11-01", 1200, "Gym fees", "Health"),
      e("2026-10-02", 40, "Tea"), e("2026-10-03", 45, "Tea"), e("2026-11-02", 40, "Tea"), e("2026-11-03", 40, "Tea"), e("2026-11-04", 40, "Tea"),
    ];
    const { subs, total } = detectSubscriptions(xs, T);
    const names = subs.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Netflix", "Gym fees", "Hotstar"]));
    expect(names).not.toContain("Tea");
    expect(subs.find((s) => s.name === "Hotstar").stale).toBe(true);
    expect(total).toBe(649 + 1200);
  });
});

describe("affordability", () => {
  const budget = { perDay: 1000, daysLeft: 10 };
  it("gives a verdict and the new daily budget", () => {
    expect(affordability(budget, 2000)).toMatchObject({ verdict: "yes", perDayAfter: 800 });
    expect(affordability(budget, 5000).verdict).toBe("tight");
    expect(affordability(budget, 12000)).toMatchObject({ verdict: "no", shortBy: 2000 });
  });
});

describe("calendar + jars", () => {
  it("colours days against the daily target", () => {
    const cal = monthCalendar([e("2026-11-01", 100), e("2026-11-02", 900), e("2026-11-03", 1500)], "2026-11", 1000);
    expect(cal.days.slice(0, 4).map((d) => d.level)).toEqual([1, 2, 3, 0]);
    expect(cal.firstDow).toBe(0); // 1 Nov 2026 is a Sunday
  });
  it("jars drain with category spend", () => {
    const j = jars([{ ruleType: "category", category: "Food", amount: 1000 }], [e("2026-11-10", 750)], T);
    expect(j[0]).toMatchObject({ left: 250, fill: 0.25 });
  });
});

describe("seasons", () => {
  it("knows Diwali, monsoon, and ordinary days", () => {
    expect(seasonFor("2026-11-08").name).toBe("Diwali");
    expect(seasonFor("2026-07-15").name).toBe("Monsoon");
    expect(seasonFor("2026-11-18")).toBeNull();
  });
});

describe("shared spaces", () => {
  it("computes balances and the fewest transfers", () => {
    const net = balances(["Me", "Priya", "Ravi"], [
      { payer: "Me", amount: 900, splitWith: ["Me", "Priya", "Ravi"] },
      { payer: "Priya", amount: 300, splitWith: ["Me", "Priya", "Ravi"] },
    ]);
    expect(net).toEqual({ Me: 500, Priya: -100, Ravi: -400 });
    expect(settleUp(net)).toEqual([{ from: "Ravi", to: "Me", amount: 400 }, { from: "Priya", to: "Me", amount: 100 }]);
  });
});

describe("slip triggers", () => {
  it("summarises tagged slips", () => {
    const r = analyseSlips([
      { completed: false, reason: "Late night" }, { completed: false, reason: "late night" }, { completed: false, reason: "Stress" },
      { completed: false, reason: "Birthday cake" }, { completed: true },
    ]);
    expect(r).toMatchObject({ total: 4, tagged: 3, untagged: 1 });
    expect(r.byTrigger[0]).toMatchObject({ id: "late", count: 2, pct: 67 });
    expect(r.headline).toBe('67% of your slips come from "late night".');
  });
});
