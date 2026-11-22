import { describe, it, expect } from "vitest";
import {
  accountBalance, cardCycle, mainBalance, emiFor, loanSchedule, prepaySaving, netWorth, tripSummary, activeTrip,
  financialYear, taxSummary, unusualSpend, findDuplicates, parseStatementCsv, parseDateLoose, parseQuery, applyQuery, monthForecast,
} from "../lib/money";

const card = { id: 7, kind: "card", openingBalance: 0, openingDate: "", creditLimit: 100000, statementDay: 20, dueDay: 8 };
const bank = { id: 3, kind: "bank", openingBalance: 50000, openingDate: "2026-11-01" };
const exp = (id, amount, date, extra = {}) => ({ id, amount, date, category: "Food", note: "", ...extra });

describe("accounts", () => {
  it("bank: opening − spending + transfers in − out, only from the opening date and up to today", () => {
    const expenses = [exp(1, 1000, "2026-11-05", { accountId: 3 }), exp(2, 999, "2026-10-30", { accountId: 3 }), exp(3, 50, "2026-11-30", { accountId: 3 })];
    const transfers = [{ id: 1, fromAccount: 3, toAccount: 7, amount: 5000, date: "2026-11-10", kind: "transfer" }, { id: 2, fromAccount: null, toAccount: 3, amount: 20000, date: "2026-11-01", kind: "income" }];
    expect(accountBalance(bank, expenses, transfers, "2026-11-22")).toBe(50000 - 1000 - 5000 + 20000);
  });

  it("card: spending raises what you owe, payments lower it, refunds count", () => {
    const expenses = [exp(1, 3000, "2026-11-01", { accountId: 7 }), exp(2, -500, "2026-11-03", { accountId: 7, refundOf: 1 })];
    const transfers = [{ id: 1, fromAccount: null, toAccount: 7, amount: 1000, date: "2026-11-04", kind: "transfer" }];
    expect(accountBalance(card, expenses, transfers, "2026-11-22")).toBe(1500);
  });

  it("main wallet ignores account spending but counts money moved in and out", () => {
    const topups = [{ amount: 10000, date: "2026-11-01", mode: "add" }];
    const items = [exp(1, 1000, "2026-11-02"), exp(2, 7000, "2026-11-02", { accountId: 7 })];
    const transfers = [
      { id: 1, fromAccount: null, toAccount: 7, amount: 2000, date: "2026-11-05", kind: "transfer" },
      { id: 2, fromAccount: 3, toAccount: null, amount: 500, date: "2026-11-06", kind: "transfer" },
      { id: 3, fromAccount: null, toAccount: null, amount: 300, date: "2026-11-07", kind: "income" },
    ];
    expect(mainBalance(topups, items, transfers, "2026-11-22").balance).toBe(10000 - 1000 - 2000 + 500 + 300);
  });
});

describe("credit card cycle", () => {
  it("splits billed (due) and unbilled, and finds the due date after the statement", () => {
    const expenses = [exp(1, 4000, "2026-11-15", { accountId: 7 }), exp(2, 600, "2026-11-21", { accountId: 7 })];
    const transfers = [{ id: 1, fromAccount: null, toAccount: 7, amount: 1000, date: "2026-11-21", kind: "transfer" }];
    const c = cardCycle(card, expenses, transfers, "2026-11-22");
    expect(c.lastStatement).toBe("2026-11-20");
    expect(c.dueDate).toBe("2026-12-08");
    expect(c.billedDue).toBe(3000);
    expect(c.unbilled).toBe(600);
    expect(c.outstanding).toBe(3600);
    expect(c.status).toBe("due");
  });

  it("uses last month's statement before this month's statement day; overdue after the due date", () => {
    const c = cardCycle(card, [exp(1, 100, "2026-10-15", { accountId: 7 })], [], "2026-11-10");
    expect(c.lastStatement).toBe("2026-10-20");
    expect(c.dueDate).toBe("2026-11-08");
    expect(c.status).toBe("overdue");
  });

  it("clamps day 31 to the month end", () => {
    const c = cardCycle({ ...card, statementDay: 31, dueDay: 20 }, [], [], "2026-03-01");
    expect(c.lastStatement).toBe("2026-02-28");
    expect(c.dueDate).toBe("2026-03-20");
  });
});

describe("loans", () => {
  it("computes the standard EMI", () => {
    expect(emiFor(1000000, 9, 240)).toBeCloseTo(8997.26, 1);
    expect(emiFor(12000, 0, 12)).toBe(1000);
  });

  it("tracks paid EMIs and what's outstanding", () => {
    const loan = { principal: 120000, rate: 12, tenureMonths: 12, startDate: "2026-01-05", emi: 0, prepayments: [] };
    const s = loanSchedule(loan, "2026-04-10");
    expect(s.paidEmis).toBe(3);
    expect(s.remainingEmis).toBe(9);
    expect(s.payoffDate).toBe("2027-01-05");
    expect(s.outstanding).toBeGreaterThan(90000);
    expect(s.outstanding).toBeLessThan(93000);
  });

  it("prepaying cuts interest and months", () => {
    const loan = { principal: 1000000, rate: 9, tenureMonths: 240, startDate: "2026-01-01", emi: 0, prepayments: [] };
    const p = prepaySaving(loan, 200000, "2026-11-22");
    expect(p.interestSaved).toBeGreaterThan(100000);
    expect(p.monthsSaved).toBeGreaterThan(30);
  });

  it("flags an EMI that doesn't cover interest", () => {
    expect(loanSchedule({ principal: 100000, rate: 24, tenureMonths: 12, startDate: "2026-01-01", emi: 1000 }, "2026-02-01").error).toBeTruthy();
  });
});

describe("net worth", () => {
  it("adds cash, accounts, investments and money owed to you; subtracts cards, loans and what you owe", () => {
    const nw = netWorth({
      mainBalance: 5000, accounts: [bank, card], balances: { 3: 40000, 7: 3000 },
      assets: [{ value: 100000 }], loans: [], ious: [{ direction: "owed_to_me", amount: "500", settled: false }, { direction: "i_owe", amount: "200", settled: false }],
      todayIso: "2026-11-22",
    });
    expect(nw.have).toBe(145500);
    expect(nw.owe).toBe(3200);
    expect(nw.net).toBe(142300);
  });
});

describe("trips & tax", () => {
  it("summarises a trip per person and per day", () => {
    const t = { id: 1, people: 3, budget: 9000, startDate: "2026-11-01", endDate: "2026-11-03" };
    const s = tripSummary(t, [exp(1, 3000, "2026-11-01", { tripId: 1 }), exp(2, 3000, "2026-11-02", { tripId: 1, category: "Transport" }), exp(3, 99, "2026-11-02")]);
    expect(s.total).toBe(6000);
    expect(s.perPerson).toBe(2000);
    expect(s.perDay).toBe(3000);
    expect(s.budgetLeft).toBe(3000);
    expect(activeTrip([t], "2026-11-02")).toBe(t);
    expect(activeTrip([t], "2026-11-04")).toBe(null);
  });

  it("uses the April–March year and caps sections at their limits", () => {
    expect(financialYear("2026-03-31").label).toBe("FY 2025–26");
    expect(financialYear("2026-04-01").start).toBe("2026-04-01");
    const fy = financialYear("2026-11-22");
    const s = taxSummary([exp(1, 120000, "2026-05-01", { taxTag: "80C" }), exp(2, 60000, "2026-06-01", { taxTag: "80C" }), exp(3, 5000, "2026-01-01", { taxTag: "80C" })], fy);
    const c = s.sections.find((x) => x.id === "80C");
    expect(c.total).toBe(180000);
    expect(c.counted).toBe(150000);
    expect(c.roomLeft).toBe(0);
  });
});

describe("smart checks", () => {
  it("flags a big jump over your usual day in a category, not small noise", () => {
    const items = [];
    for (let d = 1; d <= 10; d++) items.push(exp(d, 300, `2026-11-${String(d).padStart(2, "0")}`));
    items.push(exp(99, 2400, "2026-11-22"));
    const u = unusualSpend(items, "2026-11-22");
    expect(u[0]).toMatchObject({ category: "Food", today: 2400, usual: 300, times: 8 });
    expect(unusualSpend([...items.slice(0, 10), exp(98, 500, "2026-11-22")], "2026-11-22")).toEqual([]);
  });

  it("spots a likely duplicate: same amount within a day and same category or similar note", () => {
    const list = [exp(1, 250, "2026-11-21", { note: "Swiggy dinner" }), exp(2, 250, "2026-11-10")];
    expect(findDuplicates({ amount: 250, date: "2026-11-22", category: "Shopping", note: "swiggy order" }, list).map((x) => x.id)).toEqual([1]);
    expect(findDuplicates({ amount: 251, date: "2026-11-21", category: "Food", note: "" }, list)).toEqual([]);
  });

  it("forecasts against the monthly budget", () => {
    expect(monthForecast({ projected: 32000, enoughForForecast: true }, [{ ruleType: "overall", amount: 30000 }])).toMatchObject({ over: 2000, limit: 30000 });
  });
});

describe("statement CSV", () => {
  it("reads a typical bank statement with separate debit/credit columns", () => {
    const csv = `HDFC BANK
Statement of account
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/11/26,UPI-SWIGGY-swiggy@icici,123,01/11/26,"1,250.00",,48750.00
02/11/26,SALARY NOV,456,02/11/26,,"75,000.00",123750.00
bad line`;
    const { rows } = parseStatementCsv(csv);
    expect(rows).toEqual([
      { date: "2026-11-01", description: "UPI-SWIGGY-swiggy@icici", amount: 1250, type: "debit" },
      { date: "2026-11-02", description: "SALARY NOV", amount: 75000, type: "credit" },
    ]);
  });

  it("reads a card statement with one amount column and Dr/Cr", () => {
    const csv = `Transaction Date,Details,Amount,Type\n05 Nov 2026,AMAZON PAY,999.00,Dr\n06 Nov 2026,PAYMENT RECEIVED,5000.00,Cr`;
    const { rows } = parseStatementCsv(csv);
    expect(rows.map((r) => [r.date, r.amount, r.type])).toEqual([["2026-11-05", 999, "debit"], ["2026-11-06", 5000, "credit"]]);
  });

  it("parses Indian date formats day-first", () => {
    expect(parseDateLoose("03/04/2026")).toBe("2026-04-03");
    expect(parseDateLoose("2026-04-03")).toBe("2026-04-03");
    expect(parseDateLoose("3-Apr-26")).toBe("2026-04-03");
    expect(parseDateLoose("nope")).toBe(null);
  });

  it("explains when the columns can't be found", () => {
    expect(parseStatementCsv("a,b\n1,2").error).toBeTruthy();
  });
});

describe("plain-English search", () => {
  const today = "2026-11-22";
  it("understands category, period and amount", () => {
    const f = parseQuery("food last month over 500", today, { categories: ["Food", "Shopping"] });
    expect(f).toMatchObject({ categories: ["Food"], from: "2026-10-01", to: "2026-10-31", min: 500, words: "" });
  });
  it("month names, 'k' amounts, accounts and leftover words", () => {
    const f = parseQuery("swiggy on hdfc card in march under 2k", today, { categories: ["Food"], accounts: [{ id: 7, name: "HDFC" }] });
    expect(f).toMatchObject({ accountIds: [7], from: "2026-03-01", to: "2026-03-31", max: 2000, words: "swiggy" });
    const items = [exp(1, 300, "2026-03-04", { note: "Swiggy", accountId: 7 }), exp(2, 300, "2026-03-04", { note: "Swiggy" }), exp(3, 3000, "2026-03-04", { note: "Swiggy", accountId: 7 })];
    expect(applyQuery(items, f).map((x) => x.id)).toEqual([1]);
  });
  it("a month later than now means last year's", () => {
    expect(parseQuery("december", today).from).toBe("2025-12-01");
  });
});
