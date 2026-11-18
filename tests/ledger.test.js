import { describe, it, expect } from "vitest";
import { balanceOf, todayBudget, sugarStreak, loggingStreak, quickSuggestions, compareToUsual, recurringPending, byCategory } from "../lib/ledger";
import { parseExpenseText } from "../lib/smsParse";
import { fmt, fmtShort } from "../lib/format";

const T = "2026-11-18";
const e = (date, amount, extra = {}) => ({ date, amount, category: "Food", note: "", time: "", affectsBalance: true, ...extra });

describe("balance", () => {
  it("adds top-ups and subtracts spend up to today only", () => {
    const r = balanceOf([{ mode: "add", amount: 1000, date: "2026-11-01" }], [e(T, 100), e("2026-11-20", 500)], T);
    expect(r.balance).toBe(900);
  });
  it("uses the latest 'set balance' as the new baseline", () => {
    const topups = [
      { mode: "add", amount: 5000, date: "2026-11-01" },
      { mode: "set", amount: 2000, date: "2026-11-10", createdAt: "2026-11-10T10:00:00Z" },
      { mode: "add", amount: 300, date: "2026-11-12" },
    ];
    const r = balanceOf(topups, [e("2026-11-05", 999), e("2026-11-15", 100)], T);
    expect(r.balance).toBe(2200);
  });
});

describe("todayBudget", () => {
  it("splits money left over the remaining days, after scheduled items", () => {
    const b = todayBudget({ items: [e(T, 100), e("2026-11-30", 1300)], balance: 2900, todayIso: T, hasMoney: true });
    // pool = 2900 + 100 (today's spend added back) − 1300 scheduled = 1700 over 13 days
    expect(Math.round(b.perDay)).toBe(131);
    expect(Math.round(b.left)).toBe(31);
    expect(b.level).toBe(1); // 76% of today's budget used → "nearly used"
  });
  it("is calm (level 0) for a new user with no money added yet", () => {
    expect(todayBudget({ items: [], balance: 0, todayIso: T, hasMoney: false }).level).toBe(0);
  });
  it("flags going over today's budget", () => {
    expect(todayBudget({ items: [e(T, 500)], balance: 800, todayIso: T, hasMoney: true }).level).toBe(2);
  });
});

describe("streaks", () => {
  const meta = { start_date: "2026-11-01" };
  it("skips an unmarked today, stops at a slip", () => {
    const days = { "2026-11-14": false, "2026-11-15": true, "2026-11-16": true, "2026-11-17": true };
    expect(sugarStreak(meta, days, T)).toBe(3);
  });
  it("counts today once marked", () => {
    expect(sugarStreak(meta, { "2026-11-17": true, [T]: true }, T)).toBe(2);
  });
  it("logging streak ends today or yesterday", () => {
    expect(loggingStreak([e(T, 1), e("2026-11-17", 1), e("2026-11-16", 1), e("2026-11-14", 1)], T)).toBe(3);
    expect(loggingStreak([e("2026-11-17", 1), e("2026-11-16", 1)], T)).toBe(2);
    expect(loggingStreak([e("2026-11-15", 1)], T)).toBe(0);
  });
});

describe("quick suggestions", () => {
  it("ranks repeated entries, preferring ones usual at this hour", () => {
    const xs = [
      e("2026-11-10", 40, { note: "Tea", time: "08:05" }), e("2026-11-11", 40, { note: "Tea", time: "08:10" }),
      e("2026-11-10", 120, { note: "Auto", time: "18:00", category: "Transport" }),
      e("2026-11-12", 120, { note: "Auto", time: "18:30", category: "Transport" }),
      e("2026-11-12", 120, { note: "Auto", time: "18:10", category: "Transport" }),
    ];
    expect(quickSuggestions(xs, T, 8)[0].note).toBe("Tea");
    expect(quickSuggestions(xs, T, 18)[0].note).toBe("Auto");
  });
});

describe("compareToUsual", () => {
  it("never produces silly percentages off a tiny baseline", () => {
    expect(compareToUsual(3840, 40)).toEqual({ kind: "amount", diff: 3800, up: true });
    expect(compareToUsual(6000, 4000)).toMatchObject({ kind: "pct", pct: 50, up: true });
    expect(compareToUsual(100, 0).kind).toBe("new");
  });
});

describe("misc", () => {
  it("recurring day 31 lands on Nov 30", () => {
    expect(recurringPending([{ id: 1, amount: "10", category: "Rent", day_of_month: 31, last_generated_month: "2026-10" }], T)[0].date).toBe("2026-11-30");
  });
  it("byCategory sorts by total", () => {
    expect(byCategory([e(T, 5), e(T, 50, { category: "Rent" })]).map((c) => c.name)).toEqual(["Rent", "Food"]);
  });
  it("formats negatives and short amounts", () => {
    expect(fmt(-1580)).toBe("−₹1,580");
    expect(fmt(123456)).toBe("₹1,23,456");
    expect(fmtShort(12400)).toBe("₹12.4k");
    expect(fmtShort(250000)).toBe("₹2.5L");
  });
});

describe("SMS / text parsing", () => {
  it.each([
    ["Rs.250.00 debited from A/c XX1234 on 18-11-26 to VPA swiggy@icici Ref 1234", 250, "Swiggy", "Food"],
    ["INR 1,240 spent on HDFC Bank Card XX12 at BIG BAZAAR on 2026-11-17", 1240, "Big Bazaar", "Groceries"],
    ["Sent Rs.40 From HDFC Bank A/C *1234 To CHAI POINT On 18/11/26", 40, "Chai Point", "Food"],
    ["You have paid ₹180 to Ravi via GPay", 180, "Ravi", null],
    ["120 uber to office", 120, "uber to office", "Transport"],
  ])("%s", (text, amount, note, category) => {
    const r = parseExpenseText(text);
    expect(r.amount).toBe(amount);
    expect(r.note.toLowerCase()).toBe(note.toLowerCase());
    expect(r.category).toBe(category);
  });
  it("ignores OTP messages and flags credits", () => {
    expect(parseExpenseText("Your OTP is 482913 for txn of Rs 500")).toBeNull();
    expect(parseExpenseText("Rs 50000 credited to your account").isCredit).toBe(true);
  });
});
