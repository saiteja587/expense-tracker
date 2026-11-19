// Smarter-money helpers: learned categories, subscription detection, the
// "can I afford it?" maths, the spending calendar and envelope jars.
// Pure functions, unit-tested in tests/smart.test.js.
import { addDays, ymOf, daysInMonthOf, itemsInMonth } from "./ledger";

const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];

// #3 — Learn categories from your own history: the category you most often
// used for entries whose note shares a word with what you're typing.
export function learnCategory(expenses, note) {
  const typed = words(note);
  if (!typed.length) return null;
  const votes = {};
  for (const x of expenses) {
    const w = new Set(words(x.note));
    const hits = typed.filter((t) => w.has(t) || [...w].some((v) => v.startsWith(t) && t.length >= 4)).length;
    if (hits) votes[x.category] = (votes[x.category] || 0) + hits;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

// #4 — Subscriptions: the same note charged in 2+ different months at a
// similar amount (±15%), or a known subscription brand.
const SUB_BRANDS = /netflix|spotify|hotstar|prime|youtube|apple|icloud|google one|jio ?cinema|sony ?liv|zee5|gym|cult|swiggy one|zomato gold|linkedin|chatgpt|claude|notion|canva|adobe|xbox|playstation/i;
export function detectSubscriptions(expenses, todayIso) {
  const since = addDays(todayIso, -200);
  const groups = {};
  for (const x of expenses) {
    if (x.date < since || !x.note) continue;
    const key = x.note.trim().toLowerCase().replace(/\s+\(recurring\)$/, "");
    (groups[key] = groups[key] || []).push(x);
  }
  const subs = [];
  for (const list of Object.values(groups)) {
    const months = new Set(list.map((x) => ymOf(x.date)));
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const amounts = list.map((x) => x.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const steady = amounts.every((a) => Math.abs(a - avg) <= avg * 0.15);
    const brand = SUB_BRANDS.test(last.note);
    if ((months.size >= 2 && steady && list.length <= months.size + 1) || (brand && months.size >= 1)) {
      const daysSince = Math.round((new Date(todayIso) - new Date(last.date)) / 86400000);
      subs.push({ name: last.note.trim(), monthly: Math.round(last.amount), lastDate: last.date, daysSince, months: months.size, stale: daysSince > 45 });
    }
  }
  subs.sort((a, b) => b.monthly - a.monthly);
  return { subs, total: subs.filter((s) => !s.stale).reduce((t, s) => t + s.monthly, 0) };
}

// #9 — "Can I afford it?": what a purchase does to today's daily budget.
export function affordability(budget, price, { goal = null, balance = 0 } = {}) {
  const p = Math.max(0, Number(price) || 0);
  const pool = budget.perDay * budget.daysLeft;
  const after = (pool - p) / budget.daysLeft;
  const goalAfter = goal && goal.targetAmount > 0 ? Math.max(0, Math.min(1, (balance - p) / goal.targetAmount)) : null;
  let verdict;
  if (p <= 0) verdict = "enter";
  else if (after < 0) verdict = "no";
  else if (after < budget.perDay * 0.6) verdict = "tight";
  else verdict = "yes";
  return { price: p, perDayBefore: budget.perDay, perDayAfter: Math.max(0, after), shortBy: after < 0 ? -after * budget.daysLeft : 0, verdict, goalAfter };
}

// #5 — Spending calendar: every day of a month with its total and a level
// against a daily target (0 none, 1 under, 2 near, 3 over).
export function monthCalendar(items, ym, dailyTarget) {
  const month = itemsInMonth(items.filter((x) => !x.isRecurringPending), ym);
  const totals = {};
  for (const x of month) totals[x.date] = (totals[x.date] || 0) + x.amount;
  const dim = daysInMonthOf(ym + "-01");
  const firstDow = new Date(ym + "-01T00:00:00").getDay(); // 0 = Sunday
  const days = [];
  for (let d = 1; d <= dim; d++) {
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    const total = totals[iso] || 0;
    const level = total === 0 ? 0 : !dailyTarget ? 1 : total > dailyTarget ? 3 : total > dailyTarget * 0.75 ? 2 : 1;
    days.push({ iso, day: d, total, level });
  }
  return { days, firstDow, max: Math.max(0, ...Object.values(totals)) };
}

// #8 — Envelope jars from category limits: how full each jar still is.
export function jars(rules, items, todayIso) {
  const ym = ymOf(todayIso);
  const month = itemsInMonth(items.filter((x) => x.date <= todayIso), ym);
  return rules
    .filter((r) => r.ruleType === "category" && r.amount > 0)
    .map((r) => {
      const spent = month.filter((x) => x.category === r.category).reduce((s, x) => s + x.amount, 0);
      const left = r.amount - spent;
      return { category: r.category, limit: r.amount, spent, left, fill: Math.max(0, Math.min(1, left / r.amount)) };
    })
    .sort((a, b) => a.fill - b.fill);
}
