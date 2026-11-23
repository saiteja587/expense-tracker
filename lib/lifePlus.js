// Logic for the third batch: card picker & rewards, chores, medicines,
// meters, goals, wishlist, UPI links, PDF statements, tax nudges, the
// year-in-life summary. Pure and unit-tested (tests/life-plus.test.js).
import { addDays } from "./ledger";
import { addMonths, dueStatus, habitStats } from "./life";
import { parseDateLoose, financialYear, taxSummary, isCard } from "./money";

const round = (n, k = 0) => Math.round(n * 10 ** k) / 10 ** k;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

// ---- Cards: rewards, annual fee, "which card?" ------------------------------------
export function rewardRate(card, category) {
  const rules = typeof card.rewardRules === "string" ? JSON.parse(card.rewardRules || "[]") : card.rewardRules || [];
  const hit = rules.find((r) => r.category && category && r.category.toLowerCase() === category.toLowerCase());
  return hit ? hit.pct : card.rewardDefault || 0;
}

// Spend needed this card-year to waive the annual fee. The card year starts
// in feeMonth (the month the fee is charged).
export function feeWaiver(card, expenses, todayIso) {
  if (!card.annualFee || !card.feeWaiverSpend || !card.feeMonth) return null;
  const y = +todayIso.slice(0, 4), m = +todayIso.slice(5, 7);
  const startY = m >= card.feeMonth ? y : y - 1;
  const start = `${startY}-${String(card.feeMonth).padStart(2, "0")}-01`;
  const end = addDays(addMonths(start, 12), -1);
  const spent = expenses.filter((x) => x.accountId === card.id && x.date >= start && x.date <= todayIso).reduce((s, x) => s + x.amount, 0);
  const left = Math.max(0, card.feeWaiverSpend - spent);
  const daysLeft = daysBetween(todayIso, end);
  return { start, end, spent: round(spent), left: round(left), daysLeft, done: left <= 0, perMonth: left > 0 && daysLeft > 0 ? round(left / Math.max(1, daysLeft / 30)) : 0 };
}

// Best card for a purchase: highest reward that still fits in the available
// limit, nudged toward a card still short of its fee-waiver spend, away
// from cards above 30% of their limit.
export function pickCard({ cards, category, amount, cycles, expenses, todayIso }) {
  const out = [];
  for (const c of cards.filter((x) => isCard(x) && !x.archived)) {
    const cy = cycles[c.id] || {};
    if (cy.available != null && cy.available < amount) continue;
    const rate = rewardRate(c, category);
    const reward = (amount * rate) / 100;
    const fw = feeWaiver(c, expenses, todayIso);
    const utilAfter = c.creditLimit ? ((cy.outstanding || 0) + amount) / c.creditLimit : null;
    const reasons = [];
    let score = reward;
    if (rate) reasons.push(`${rate}% ${c.rewardType === "points" ? "in points" : "back"} on ${category || "this"} ≈ ₹${round(reward)}`);
    if (fw && !fw.done) { score += Math.min(amount, fw.left) * 0.01; reasons.push(`helps waive the ₹${round(c.annualFee)} fee (₹${round(fw.left)} to go)`); }
    if (utilAfter != null && utilAfter > 0.3) { score -= amount * 0.01; reasons.push(`limit use would be ${Math.round(utilAfter * 100)}%`); }
    out.push({ card: c, rate, reward: round(reward, 2), score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function pointsExpiring(card, todayIso) {
  if (!card.points || !card.pointsExpiry) return null;
  const st = dueStatus(card.pointsExpiry, todayIso);
  return st.daysLeft != null && st.daysLeft <= 60 ? { points: card.points, daysLeft: st.daysLeft, date: card.pointsExpiry } : null;
}

// ---- Chores & maintenance --------------------------------------------------------------
export function choreNext(chore, todayIso) {
  if (!chore.date) return { next: todayIso, daysLeft: 0, never: true };
  const next = chore.everyMonths ? addMonths(chore.date, chore.everyMonths) : chore.everyDays ? addDays(chore.date, chore.everyDays) : null;
  return next ? { next, daysLeft: daysBetween(todayIso, next) } : { next: null, daysLeft: null };
}

// ---- Medicines ----------------------------------------------------------------------------
export const doseTimes = (m) => String(m.times || "").split(/[,\s]+/).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort();
export function medicineDay(m, doses, todayIso) {
  const times = doseTimes(m);
  const taken = new Set(doses.filter((d) => d.refId === m.id && d.date === todayIso).map((d) => d.time));
  const perDay = times.length * (m.perDose || 1);
  const daysLeft = perDay > 0 && m.stock != null ? Math.floor(m.stock / perDay) : null;
  return {
    times: times.map((t) => ({ time: t, taken: taken.has(t) })),
    daysLeft, refill: m.stock != null && ((m.refillAt && m.stock <= m.refillAt) || (daysLeft != null && daysLeft <= 5)),
  };
}
// Doses that became due in the last `windowMins` and aren't marked taken.
export function dueDoses(meds, doses, todayIso, nowHHMM, windowMins = 120) {
  const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const now = toMin(nowHHMM);
  const out = [];
  for (const m of meds.filter((x) => !x.paused)) {
    const day = medicineDay(m, doses, todayIso);
    for (const t of day.times) if (!t.taken && toMin(t.time) <= now && now - toMin(t.time) <= windowMins) out.push({ med: m, time: t.time });
  }
  return out;
}

// ---- Utility meters ---------------------------------------------------------------------------
export function meterStats(meter, readings) {
  const rs = readings.filter((r) => r.refId === meter.id && r.reading >= 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const periods = [];
  for (let k = 1; k < rs.length; k++) {
    const units = rs[k].reading - rs[k - 1].reading;
    const days = Math.max(1, daysBetween(rs[k - 1].date, rs[k].date));
    if (units < 0) continue; // meter replaced
    periods.push({ from: rs[k - 1].date, to: rs[k].date, units: round(units, 1), perMonth: round((units / days) * 30, 1), amount: rs[k].amount || null });
  }
  const last = periods[periods.length - 1] || null;
  const prev = periods.slice(-4, -1);
  const usual = prev.length ? prev.reduce((s, p) => s + p.perMonth, 0) / prev.length : null;
  const change = last && usual ? Math.round(((last.perMonth - usual) / usual) * 100) : null;
  const paid = periods.filter((p) => p.amount && p.units > 0);
  const costPerUnit = paid.length ? round(paid.reduce((s, p) => s + p.amount, 0) / paid.reduce((s, p) => s + p.units, 0), 2) : meter.rate || null;
  return { periods, last, usual: usual != null ? round(usual, 1) : null, change, costPerUnit, estMonth: last && costPerUnit ? Math.round(last.perMonth * costPerUnit) : null, latest: rs[rs.length - 1] || null };
}

// ---- Goals ----------------------------------------------------------------------------------------
// ctx: { balances (by account id), mainBalance, latestWeight, habitLogs, todayIso }
export function goalProgress(g, ctx) {
  let current = g.current || 0;
  if (g.type === "savings") current = g.accountId ? ctx.balances?.[g.accountId] || 0 : ctx.mainBalance || 0;
  if (g.type === "weight") current = ctx.latestWeight || g.start || 0;
  if (g.type === "habit") current = (ctx.habitLogs || []).filter((l) => l.refId === g.habitId && (!g.createdAt || l.date >= String(g.createdAt).slice(0, 10))).length;
  const start = g.type === "weight" ? g.start || current : g.start || 0;
  const span = g.target - start;
  const pct = span ? Math.max(0, Math.min(1, (current - start) / span)) : current >= g.target ? 1 : 0;
  let onTrack = null;
  if (g.date && g.createdAt && pct < 1) {
    const total = daysBetween(String(g.createdAt).slice(0, 10), g.date), gone = daysBetween(String(g.createdAt).slice(0, 10), ctx.todayIso);
    if (total > 0) onTrack = pct >= Math.min(1, gone / total) - 0.05;
  }
  return { current: round(current, 1), pct, done: pct >= 1 || !!g.done, onTrack, daysLeft: g.date ? daysBetween(ctx.todayIso, g.date) : null };
}

// ---- Wishlist: the 30-day rule ---------------------------------------------------------------------
export function wishStatus(w, todayIso) {
  const waited = w.date ? daysBetween(w.date, todayIso) : 0;
  return { waited, coolingDone: waited >= 30, atTarget: !!(w.target && w.price && w.price <= w.target) };
}

// ---- UPI ---------------------------------------------------------------------------------------------
export const isUpiId = (v) => /^[\w.-]{2,64}@[a-zA-Z]{2,64}$/.test(String(v || "").trim());
export function upiLink({ vpa, name, amount, note }) {
  if (!isUpiId(vpa)) return null;
  const p = new URLSearchParams({ pa: vpa.trim(), pn: (name || "").slice(0, 40), cu: "INR" });
  if (amount > 0) p.set("am", (Math.round(amount * 100) / 100).toFixed(2));
  if (note) p.set("tn", note.slice(0, 60));
  return `upi://pay?${p.toString().replace(/\+/g, "%20")}`;
}

// ---- PDF bank statements (text lines extracted on the phone) ----------------------------------------
// A transaction line starts with a date and ends with amounts. With a
// running balance, the change in balance says whether it was money out or in.
const AMT = /-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})|-?\d+\.\d{1,2}/g;
export function parsePdfStatementLines(lines) {
  const rows = [];
  let prevBal = null;
  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, " ").trim();
    const m = line.match(/^(\d{1,2}[-/. ](?:\d{1,2}|[A-Za-z]{3,4})[-/. ,]*\d{2,4})\s+(.*)$/);
    if (!m) continue;
    const date = parseDateLoose(m[1]);
    if (!date) continue;
    let rest = m[2];
    const flag = /\b(cr|dr)\.?\s*$/i.exec(rest)?.[1]?.toLowerCase() || null;
    const nums = (rest.match(AMT) || []).map((x) => parseFloat(x.replace(/,/g, "")));
    if (!nums.length) continue;
    const firstNum = rest.search(AMT);
    let desc = rest.slice(0, firstNum).replace(/\s+\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*$/, "").trim(); // drop a value-date column
    let amount, type, bal = null;
    if (nums.length >= 2) {
      bal = nums[nums.length - 1];
      amount = Math.abs(nums[nums.length - 2]);
      if (prevBal != null) type = bal < prevBal ? "debit" : "credit";
      else type = flag === "cr" ? "credit" : "debit";
    } else {
      amount = Math.abs(nums[0]);
      type = flag === "cr" ? "credit" : "debit";
    }
    if (bal != null) prevBal = bal;
    if (!(amount > 0)) continue;
    rows.push({ date, description: desc || "(no description)", amount: round(amount, 2), type });
  }
  return rows;
}

// ---- Tax-saving nudge (January–March) -----------------------------------------------------------------
export function taxNudge(expenses, todayIso) {
  const m = +todayIso.slice(5, 7);
  if (m < 1 || m > 3) return null;
  const fy = financialYear(todayIso);
  const s = taxSummary(expenses, fy).sections.find((x) => x.id === "80C");
  if (!s || s.roomLeft <= 0) return null;
  return { room: s.roomLeft, daysLeft: daysBetween(todayIso, fy.end), fy: fy.label };
}

// ---- Year in life (for the Year page) -------------------------------------------------------------------
export function lifeYear({ year, life = [], trips = [] }) {
  const inYear = (x) => x.date && x.date.startsWith(String(year));
  const of = (k) => life.filter((x) => x.kind === k);
  const checkins = of("habit_log").filter(inYear);
  const habits = of("habit").map((h) => ({ name: h.name, days: checkins.filter((l) => l.refId === h.id).length, best: habitStats(h, of("habit_log"), `${year}-12-31`).best }))
    .filter((h) => h.days).sort((a, b) => b.days - a.days);
  const days = of("day_log").filter(inYear);
  const w = days.filter((d) => d.weight > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const sleep = days.filter((d) => d.sleepHours > 0);
  const moods = days.filter((d) => d.mood);
  const fuel = of("fuel").filter(inYear).filter((f) => f.odometer > 0);
  const kmByVehicle = {};
  for (const f of fuel) (kmByVehicle[f.refId] = kmByVehicle[f.refId] || []).push(f.odometer);
  const km = Object.values(kmByVehicle).reduce((s, xs) => s + (Math.max(...xs) - Math.min(...xs)), 0);
  return {
    habitCheckins: checkins.length, topHabit: habits[0] || null,
    weightChange: w.length >= 2 ? round(w[w.length - 1].weight - w[0].weight, 1) : null,
    avgSleep: sleep.length ? round(sleep.reduce((s, d) => s + d.sleepHours, 0) / sleep.length, 1) : null,
    goodDays: moods.filter((d) => d.mood >= 4).length, moodDays: moods.length,
    journalEntries: days.filter((d) => d.journal).length,
    trips: trips.filter((t) => t.startDate?.startsWith(String(year))).length,
    km: Math.round(km), gifts: of("gift").filter(inYear).length,
    goalsDone: of("goal").filter((g) => g.done).length,
  };
}
