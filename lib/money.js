// Where the money sits: accounts and cards, transfers, credit-card billing
// cycles, loans, net worth, trips, tax and the "smart" checks (unusual
// spending, duplicates, statement import, plain-English search).
// Pure functions — no React, no fetch — all unit-tested in tests/money.test.js.
import { addDays, daysInMonthOf, ymOf, balanceOf } from "./ledger";

const pad = (n) => String(n).padStart(2, "0");
const sum = (xs, f = (x) => x.amount) => xs.reduce((s, x) => s + f(x), 0);
const round2 = (n) => Math.round(n * 100) / 100;
const iso = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "");

// ---- Accounts -------------------------------------------------------------
// "main" (no account) is the original wallet with its top-ups; everything
// else is an account you add. Cards hold what you OWE, not what you have.
export const ACCOUNT_KINDS = [
  { id: "bank", label: "Bank account", emoji: "🏦" },
  { id: "upi", label: "UPI / UPI Lite", emoji: "📲" },
  { id: "cash", label: "Cash", emoji: "💵" },
  { id: "wallet", label: "Wallet (Paytm, Amazon Pay…)", emoji: "👛" },
  { id: "meal", label: "Meal card", emoji: "🍱" },
  { id: "card", label: "Credit card", emoji: "💳" },
];
export const kindOf = (id) => ACCOUNT_KINDS.find((k) => k.id === id) || ACCOUNT_KINDS[0];
export const isCard = (a) => a?.kind === "card";

export const mapAccount = (a) => ({
  id: a.id,
  name: a.name,
  kind: a.kind,
  openingBalance: parseFloat(a.opening_balance) || 0,
  openingDate: iso(a.opening_date),
  creditLimit: parseFloat(a.credit_limit) || 0,
  statementDay: a.statement_day || 0,
  dueDay: a.due_day || 0,
  bank: a.bank || "",
  network: a.network || "",
  last4: a.last4 || "",
  loginUrl: a.login_url || "",
  loginUsername: a.login_username || "",
  vault: a.vault || "",
  color: a.color || "",
  archived: !!a.archived,
  note: a.note || "",
  rewardType: a.reward_type || "",
  rewardDefault: parseFloat(a.reward_default) || 0,
  rewardRules: typeof a.reward_rules === "string" ? JSON.parse(a.reward_rules || "[]") : a.reward_rules || [],
  points: a.points || 0,
  pointsExpiry: iso(a.points_expiry),
  annualFee: parseFloat(a.annual_fee) || 0,
  feeWaiverSpend: parseFloat(a.fee_waiver_spend) || 0,
  feeMonth: a.fee_month || 0,
});
export const mapTransfer = (t) => ({
  id: t.id,
  fromAccount: t.from_account ?? null,
  toAccount: t.to_account ?? null,
  amount: parseFloat(t.amount),
  date: iso(t.transfer_date),
  note: t.note || "",
  kind: t.kind === "income" ? "income" : "transfer",
});

// Counts only what happened on/after the account's opening date (the opening
// balance already includes everything before it) and up to today.
function inWindow(acc, date, todayIso) {
  return date <= todayIso && (!acc.openingDate || date >= acc.openingDate);
}

// Balance of one account. For a bank/cash/wallet: money in it. For a card:
// what you owe on it (spending raises it, payments lower it).
export function accountBalance(acc, expenses, transfers, todayIso) {
  const spent = sum(expenses.filter((x) => x.accountId === acc.id && inWindow(acc, x.date, todayIso)));
  const tin = sum(transfers.filter((t) => t.toAccount === acc.id && inWindow(acc, t.date, todayIso)));
  const tout = sum(transfers.filter((t) => t.fromAccount === acc.id && inWindow(acc, t.date, todayIso)));
  return isCard(acc) ? round2(acc.openingBalance + spent - tin + tout) : round2(acc.openingBalance - spent + tin - tout);
}

// Transfers touching the main wallet, as entries the existing balance maths
// understands: money out of main is an item that "affects balance", money in
// is an "add" top-up. They never count as spending. Income ("money from
// outside") has no from side; with no "to" account it lands in main.
export function mainWalletTransfers(transfers) {
  const items = [], topups = [];
  for (const t of transfers) {
    if (t.kind !== "income" && t.fromAccount == null && t.toAccount != null) items.push({ id: `transfer-${t.id}`, amount: t.amount, category: "Transfer", note: t.note, date: t.date, affectsBalance: true, isTransfer: true });
    if (t.toAccount == null && (t.fromAccount != null || t.kind === "income")) topups.push({ id: `transfer-${t.id}`, amount: t.amount, note: t.note || "Money in", date: t.date, mode: "add", createdAt: t.date });
  }
  return { items, topups };
}

// The main wallet's balance once accounts exist: only expenses with no
// account, plus money moved in/out of main. Same rules as balanceOf.
export function mainBalance(topups, items, transfers, todayIso) {
  const mw = mainWalletTransfers(transfers);
  return balanceOf([...topups, ...mw.topups], [...items.filter((x) => !x.accountId), ...mw.items], todayIso);
}

// ---- Credit-card billing cycle ---------------------------------------------
// The day a statement_day/due_day lands in a given month (29–31 → month end).
function dayIn(ym, day) {
  return `${ym}-${pad(Math.min(day, daysInMonthOf(`${ym}-01`)))}`;
}
function shiftYm(ym, n) {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${pad(m)}`;
}

export function cardCycle(card, expenses, transfers, todayIso) {
  const outstanding = accountBalance(card, expenses, transfers, todayIso);
  const limit = card.creditLimit || 0;
  const base = { outstanding, limit, available: limit ? round2(limit - outstanding) : null, utilisation: limit ? outstanding / limit : null };
  if (!card.statementDay) return { ...base, hasCycle: false };

  const ym = ymOf(todayIso);
  let lastStatement = dayIn(ym, card.statementDay);
  if (lastStatement > todayIso) lastStatement = dayIn(shiftYm(ym, -1), card.statementDay);
  const nextStatement = dayIn(shiftYm(ymOf(lastStatement), 1), card.statementDay);
  // Due date follows the statement: same month if the due day is later,
  // otherwise next month (e.g. statement 20th → due 8th of next month).
  const dueDay = card.dueDay || card.statementDay;
  let dueDate = dayIn(ymOf(lastStatement), dueDay);
  if (dueDate <= lastStatement) dueDate = dayIn(shiftYm(ymOf(lastStatement), 1), dueDay);

  const owedAtStatement = accountBalance(card, expenses, transfers, lastStatement);
  const paidSince = sum(transfers.filter((t) => t.toAccount === card.id && t.date > lastStatement && t.date <= todayIso))
    - sum(transfers.filter((t) => t.fromAccount === card.id && t.date > lastStatement && t.date <= todayIso));
  const billedDue = round2(Math.max(0, owedAtStatement - paidSince));
  const unbilled = round2(sum(expenses.filter((x) => x.accountId === card.id && x.date > lastStatement && x.date <= todayIso)));
  const daysToDue = Math.round((new Date(dueDate + "T00:00:00") - new Date(todayIso + "T00:00:00")) / 86400000);
  return {
    ...base, hasCycle: true, lastStatement, nextStatement, dueDate, daysToDue,
    billedDue, unbilled, paidSince: round2(paidSince),
    status: billedDue <= 0 ? "paid" : daysToDue < 0 ? "overdue" : daysToDue <= 3 ? "due-soon" : "due",
  };
}

// ---- Loans & EMIs ------------------------------------------------------------
export const mapLoan = (l) => ({
  id: l.id,
  name: l.name,
  lender: l.lender || "",
  principal: parseFloat(l.principal) || 0,
  rate: parseFloat(l.rate) || 0,
  tenureMonths: l.tenure_months || 0,
  startDate: iso(l.start_date),
  emi: parseFloat(l.emi) || 0,
  prepayments: typeof l.prepayments === "string" ? JSON.parse(l.prepayments || "[]") : l.prepayments || [],
  closed: !!l.closed,
  note: l.note || "",
});

export function emiFor(principal, annualRate, months) {
  if (!months) return 0;
  const r = annualRate / 1200;
  if (!r) return round2(principal / months);
  const f = Math.pow(1 + r, months);
  return round2((principal * r * f) / (f - 1));
}

// EMI dates: one month after the start, then monthly.
function emiDate(startIso, k) {
  const [y, m, d] = startIso.split("-").map(Number);
  const ym = shiftYm(`${y}-${pad(m)}`, k);
  return dayIn(ym, d);
}

// Walks the schedule month by month. Prepayments cut principal and keep the
// EMI the same, so the loan ends sooner. `extraNow` adds a what-if lump sum
// today.
export function loanSchedule(loan, todayIso, { extraNow = 0 } = {}) {
  const emi = loan.emi || emiFor(loan.principal, loan.rate, loan.tenureMonths);
  const r = loan.rate / 1200;
  const pre = [...(loan.prepayments || [])].map((p) => ({ date: p.date, amount: parseFloat(p.amount) || 0 }));
  if (extraNow > 0) pre.push({ date: todayIso, amount: extraNow });
  pre.sort((a, b) => (a.date < b.date ? -1 : 1));
  let bal = loan.principal, paidEmis = 0, interestPaid = 0, interestTotal = 0, k = 0, lastDate = loan.startDate;
  let outstandingToday = null, pi = 0;
  const applyPre = (upTo) => {
    while (pi < pre.length && pre[pi].date <= upTo) { bal = Math.max(0, bal - pre[pi].amount); pi++; }
  };
  while (bal > 0.5 && k < 1200) {
    k++;
    const date = emiDate(loan.startDate, k);
    if (outstandingToday === null && date > todayIso) { applyPre(todayIso); outstandingToday = bal; }
    applyPre(addDays(date, -1));
    if (bal <= 0.5) break;
    const interest = bal * r;
    const principalPart = Math.min(bal, emi - interest);
    if (principalPart <= 0) return { emi, error: "The EMI doesn't cover the interest — check the rate and EMI." };
    bal -= principalPart;
    interestTotal += interest;
    if (date <= todayIso) { paidEmis++; interestPaid += interest; }
    lastDate = date;
  }
  if (outstandingToday === null) { applyPre(todayIso); outstandingToday = Math.max(0, bal); }
  return {
    emi, paidEmis, remainingEmis: k - paidEmis, payoffDate: lastDate,
    outstanding: round2(Math.max(0, outstandingToday)), interestPaid: round2(interestPaid), interestTotal: round2(interestTotal),
  };
}

// "If I prepay ₹X today": interest and months saved.
export function prepaySaving(loan, amount, todayIso) {
  const now = loanSchedule(loan, todayIso);
  const after = loanSchedule(loan, todayIso, { extraNow: amount });
  if (now.error || after.error) return null;
  return { interestSaved: round2(now.interestTotal - after.interestTotal), monthsSaved: now.remainingEmis - after.remainingEmis, newPayoff: after.payoffDate };
}

// ---- Assets & net worth ----------------------------------------------------
export const ASSET_KINDS = [
  { id: "fd", label: "Fixed deposit", emoji: "🏛️" },
  { id: "mf", label: "Mutual funds", emoji: "📈" },
  { id: "stocks", label: "Stocks", emoji: "📊" },
  { id: "pf", label: "PF / PPF / NPS", emoji: "🧓" },
  { id: "gold", label: "Gold", emoji: "🪙" },
  { id: "property", label: "Property", emoji: "🏡" },
  { id: "other", label: "Other", emoji: "📦" },
];
export const mapAsset = (a) => ({ id: a.id, name: a.name, kind: a.kind, value: parseFloat(a.value) || 0, note: a.note || "", updatedAt: iso(a.updated_at), schemeCode: a.scheme_code || "", units: parseFloat(a.units) || 0 });

export function netWorth({ mainBalance = 0, accounts = [], balances = {}, assets = [], loans = [], ious = [], todayIso }) {
  const cash = accounts.filter((a) => !isCard(a) && !a.archived).reduce((s, a) => s + (balances[a.id] || 0), mainBalance);
  const cards = accounts.filter((a) => isCard(a) && !a.archived).reduce((s, a) => s + Math.max(0, balances[a.id] || 0), 0);
  const invest = sum(assets, (a) => a.value);
  const loanDebt = loans.filter((l) => !l.closed).reduce((s, l) => s + (loanSchedule(l, todayIso).outstanding || 0), 0);
  const open = ious.filter((i) => !i.settled);
  const owedToMe = sum(open.filter((i) => i.direction === "owed_to_me"), (i) => parseFloat(i.amount));
  const iOwe = sum(open.filter((i) => i.direction === "i_owe"), (i) => parseFloat(i.amount));
  const have = cash + invest + owedToMe;
  const owe = cards + loanDebt + iOwe;
  return { cash: round2(cash), invest: round2(invest), owedToMe: round2(owedToMe), cards: round2(cards), loans: round2(loanDebt), iOwe: round2(iOwe), have: round2(have), owe: round2(owe), net: round2(have - owe) };
}

// ---- Refunds -------------------------------------------------------------
// A refund/cashback is stored as a negative expense in the same category,
// linked to the original, so category totals come out right by themselves.
export function refundedSoFar(expenseId, expenses) {
  return round2(-sum(expenses.filter((x) => x.refundOf === expenseId)));
}

// ---- Trips ---------------------------------------------------------------
export const mapTrip = (t) => ({
  id: t.id, name: t.name, startDate: iso(t.start_date), endDate: iso(t.end_date),
  budget: parseFloat(t.budget) || 0, people: Math.max(1, t.people || 1), note: t.note || "",
});
export const activeTrip = (trips, todayIso) => trips.find((t) => t.startDate <= todayIso && (!t.endDate || t.endDate >= todayIso)) || null;

export function tripSummary(trip, expenses) {
  const xs = expenses.filter((x) => x.tripId === trip.id);
  const total = round2(sum(xs));
  const byCat = {};
  for (const x of xs) byCat[x.category] = (byCat[x.category] || 0) + x.amount;
  const byDay = {};
  for (const x of xs) byDay[x.date] = (byDay[x.date] || 0) + x.amount;
  const days = Object.keys(byDay).length;
  return {
    items: xs, total, perPerson: round2(total / trip.people), perDay: days ? round2(total / days) : 0,
    byCategory: Object.entries(byCat).map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value),
    byDay: Object.entries(byDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value: round2(value) })),
    budgetLeft: trip.budget ? round2(trip.budget - total) : null,
  };
}

// ---- Tax (India, old regime deductions) ---------------------------------------
export const TAX_SECTIONS = [
  { id: "80C", label: "80C — PPF, ELSS, LIC, tuition fees, home-loan principal", limit: 150000 },
  { id: "80CCD1B", label: "80CCD(1B) — extra NPS", limit: 50000 },
  { id: "80D", label: "80D — health insurance, check-ups", limit: 25000 },
  { id: "80D-parents", label: "80D — parents' health insurance", limit: 50000 },
  { id: "24b", label: "24(b) — home-loan interest", limit: 200000 },
  { id: "80E", label: "80E — education-loan interest", limit: 0 },
  { id: "80G", label: "80G — donations", limit: 0 },
  { id: "HRA", label: "HRA / 80GG — rent paid", limit: 0 },
  { id: "80TTA", label: "80TTA — savings interest", limit: 10000 },
];
export const taxSection = (id) => TAX_SECTIONS.find((s) => s.id === id);

// Indian financial year (April–March) containing a date.
export function financialYear(todayIso, offset = 0) {
  const y = Number(todayIso.slice(0, 4)), m = Number(todayIso.slice(5, 7));
  const start = (m >= 4 ? y : y - 1) + offset;
  return { start: `${start}-04-01`, end: `${start + 1}-03-31`, label: `FY ${start}–${String(start + 1).slice(2)}` };
}

export function taxSummary(expenses, fy) {
  const xs = expenses.filter((x) => x.taxTag && x.date >= fy.start && x.date <= fy.end);
  const sections = TAX_SECTIONS.map((s) => {
    const items = xs.filter((x) => x.taxTag === s.id);
    const total = round2(sum(items));
    return { ...s, items, total, counted: s.limit ? Math.min(total, s.limit) : total, roomLeft: s.limit ? round2(Math.max(0, s.limit - total)) : null };
  }).filter((s) => s.items.length || s.id === "80C" || s.id === "80D");
  return { sections, total: round2(sum(sections, (s) => s.counted)) };
}

// ---- Unusual spending -----------------------------------------------------------
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Today's spending in a category against your usual day for it (median of
// the last 60 days that had any). Flags only big, real jumps.
export function unusualSpend(items, todayIso, { factor = 3, minDiff = 500, minDays = 4 } = {}) {
  const since = addDays(todayIso, -60);
  const real = items.filter((x) => !x.isRecurringPending && !x.isTransfer && x.amount > 0);
  const today = real.filter((x) => x.date === todayIso);
  const out = [];
  const cats = [...new Set(today.map((x) => x.category))];
  for (const cat of cats) {
    const now = sum(today.filter((x) => x.category === cat));
    const perDay = {};
    for (const x of real) if (x.category === cat && x.date >= since && x.date < todayIso) perDay[x.date] = (perDay[x.date] || 0) + x.amount;
    const vals = Object.values(perDay);
    if (vals.length < minDays) continue;
    const usual = median(vals);
    if (now >= usual * factor && now - usual >= minDiff) out.push({ category: cat, today: round2(now), usual: round2(usual), times: Math.round((now / usual) * 10) / 10 });
  }
  return out.sort((a, b) => b.today - b.usual - (a.today - a.usual));
}

// ---- Duplicate check -------------------------------------------------------------
const words = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
function similarNote(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return !a && !b;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.5;
}
// Same amount within a day, and the same category or a similar note.
export function findDuplicates(entry, expenses) {
  return expenses.filter((x) => {
    if (x.id === entry.id) return false;
    if (Math.abs(x.amount - entry.amount) > 0.009) return false;
    const days = Math.abs(new Date(x.date + "T00:00:00") - new Date(entry.date + "T00:00:00")) / 86400000;
    if (days > 1) return false;
    return x.category === entry.category || similarNote(x.note, entry.note);
  });
}

// ---- Bank-statement CSV import --------------------------------------------------
function splitCsvLine(line, delim) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
export function parseDateLoose(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/); // Indian banks: day first
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[2] > 12) return null;
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,4})[-/ ,]*(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`;
  }
  return null;
}
const money = (s) => {
  const t = String(s || "").replace(/[₹,\s]|INR|Rs\.?/gi, "");
  if (!t || t === "-") return 0;
  const v = parseFloat(t.replace(/(cr|dr)$/i, ""));
  return isNaN(v) ? 0 : v;
};

// Finds the header row and the date / description / debit / credit (or
// amount + Dr/Cr) columns used by most Indian bank and card statements.
export function parseStatementCsv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const delim = (lines.slice(0, 20).join("\n").match(/\t/g) || []).length > (lines.slice(0, 20).join("\n").match(/,/g) || []).length ? "\t" : lines.some((l) => l.includes(";")) && !lines.some((l) => l.includes(",")) ? ";" : ",";
  let header = -1, cols = null;
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = splitCsvLine(lines[i], delim).map((c) => c.toLowerCase());
    const find = (re) => cells.findIndex((c) => re.test(c));
    const date = find(/(^|\s)(txn |transaction |value )?date/);
    const desc = find(/narration|description|particulars|details|remarks|merchant/);
    if (date < 0 || desc < 0) continue;
    cols = {
      date, desc,
      debit: find(/withdraw|debit|dr\b|paid out/),
      credit: find(/deposit|credit|cr\b|paid in/),
      amount: find(/^amount|amt|transaction amount/),
      type: find(/^(type|dr\/cr|cr\/dr|debit\/credit)$/),
    };
    header = i;
    break;
  }
  if (!cols) return { rows: [], error: "Couldn't find Date and Description columns. Export the statement as CSV and try again." };
  const rows = [];
  for (const line of lines.slice(header + 1)) {
    const c = splitCsvLine(line, delim);
    const date = parseDateLoose(c[cols.date]);
    if (!date) continue;
    let debit = cols.debit >= 0 && cols.debit !== cols.credit ? money(c[cols.debit]) : 0;
    let credit = cols.credit >= 0 && cols.credit !== cols.debit ? money(c[cols.credit]) : 0;
    if (!debit && !credit && cols.amount >= 0) {
      const raw = c[cols.amount] || "";
      const v = money(raw);
      const flag = `${cols.type >= 0 ? c[cols.type] : ""} ${raw}`.toLowerCase();
      if (/\bcr\b|credit|cr$/.test(flag) || v < 0) credit = Math.abs(v); else debit = Math.abs(v);
    }
    if (!debit && !credit) continue;
    rows.push({ date, description: (c[cols.desc] || "").replace(/\s+/g, " ").trim(), amount: round2(debit || credit), type: debit ? "debit" : "credit" });
  }
  return { rows };
}

// ---- Plain-English search ---------------------------------------------------------
// "food last month over 500", "swiggy this week", "shopping on hdfc card in march"
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function parseQuery(q, todayIso, { categories = [], accounts = [] } = {}) {
  let text = ` ${String(q || "").toLowerCase()} `;
  const out = { categories: [], accountIds: [], from: "", to: "", min: null, max: null, words: "" };
  const take = (re, fn) => { const m = text.match(re); if (m) { fn(m); text = text.replace(m[0], " "); } };
  const num = (s) => parseFloat(String(s).replace(/[,k]/gi, "")) * (/k$/i.test(s) ? 1000 : 1);
  const ym = ymOf(todayIso);
  const monthStart = (y) => `${y}-01`;
  const monthEnd = (m) => `${m}-${pad(daysInMonthOf(`${m}-01`))}`;

  take(/\bbetween\s*₹?\s*([\d,.]+k?)\s*(?:and|-|to)\s*₹?\s*([\d,.]+k?)\b/, (m) => { out.min = num(m[1]); out.max = num(m[2]); });
  take(/\b(?:over|above|more than|greater than|>)\s*₹?\s*([\d,.]+k?)\b/, (m) => { out.min = num(m[1]); });
  take(/\b(?:under|below|less than|<)\s*₹?\s*([\d,.]+k?)\b/, (m) => { out.max = num(m[1]); });
  take(/\btoday\b/, () => { out.from = out.to = todayIso; });
  take(/\byesterday\b/, () => { out.from = out.to = addDays(todayIso, -1); });
  take(/\bthis week\b/, () => { const dow = (new Date(todayIso + "T00:00:00").getDay() + 6) % 7; out.from = addDays(todayIso, -dow); out.to = todayIso; });
  take(/\blast week\b/, () => { const dow = (new Date(todayIso + "T00:00:00").getDay() + 6) % 7; out.to = addDays(todayIso, -dow - 1); out.from = addDays(out.to, -6); });
  take(/\bthis month\b/, () => { out.from = `${ym}-01`; out.to = todayIso; });
  take(/\blast month\b/, () => { const p = shiftYm(ym, -1); out.from = `${p}-01`; out.to = monthEnd(p); });
  take(/\blast (\d+) days\b/, (m) => { out.from = addDays(todayIso, -(+m[1] - 1)); out.to = todayIso; });
  take(/\bthis year\b/, () => { out.from = `${todayIso.slice(0, 4)}-01-01`; out.to = todayIso; });
  take(/\blast year\b/, () => { const y = +todayIso.slice(0, 4) - 1; out.from = `${y}-01-01`; out.to = `${y}-12-31`; });
  take(new RegExp(`\\b(?:in\\s+)?(${MONTH_NAMES.join("|")}|${MONTH_NAMES.map((n) => n.slice(0, 3)).join("|")})\\b(?:\\s+(\\d{4}))?`), (m) => {
    const idx = MONTH_NAMES.findIndex((n) => n.startsWith(m[1]));
    let y = m[2] ? +m[2] : +todayIso.slice(0, 4);
    if (!m[2] && `${y}-${pad(idx + 1)}` > ym) y--;
    const mm = `${y}-${pad(idx + 1)}`;
    out.from = `${mm}-01`; out.to = monthEnd(mm);
  });
  take(/\b(?:in\s+)?(20\d\d)\b/, (m) => { out.from = `${monthStart(m[1])}-01`; out.to = `${m[1]}-12-31`; });
  for (const c of categories) {
    const re = new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(text)) { out.categories.push(c); text = text.replace(re, " "); }
  }
  for (const a of accounts) {
    const re = new RegExp(`\\b(?:on|from|via|using)?\\s*${a.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(text)) { out.accountIds.push(a.id); text = text.replace(re, " "); }
  }
  out.words = text.replace(/\b(on|in|at|for|spent|spending|expenses?|show|me|my|all|the|from|card)\b/g, " ").replace(/\s+/g, " ").trim();
  return out;
}

export function applyQuery(items, f) {
  const w = f.words.toLowerCase();
  return items.filter((x) =>
    (!f.categories.length || f.categories.includes(x.category)) &&
    (!f.accountIds.length || f.accountIds.includes(x.accountId)) &&
    (!f.from || x.date >= f.from) && (!f.to || x.date <= f.to) &&
    (f.min == null || x.amount >= f.min) && (f.max == null || x.amount <= f.max) &&
    (!w || `${x.note} ${x.category}`.toLowerCase().includes(w)));
}

// ---- Month-end forecast -----------------------------------------------------------
// Uses todayBudget's projection; compares it against the monthly budget rule.
export function monthForecast(budget, rules) {
  const overall = rules.find((r) => r.ruleType === "overall");
  const limit = overall?.amount || 0;
  return {
    projected: round2(budget.projected), limit, ready: budget.enoughForForecast,
    over: limit ? round2(budget.projected - limit) : null,
  };
}
