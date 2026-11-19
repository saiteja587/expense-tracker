// Pure money/streak calculations shared by Home, Transactions, Insights and
// the quick-add sheet. No React, no fetch — everything here is unit-tested.
import { MOVIE_CATEGORY, allCategories } from "./categories";

const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ymOf = (iso) => iso.slice(0, 7);
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
// Day a recurring item actually lands on this month (29–31 → last day).
export function effectiveDayClient(dayOfMonth, todayIso) {
  return Math.min(dayOfMonth, daysInMonthOf(todayIso));
}
export function daysInMonthOf(iso) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// ---- API row → app object ----
export const mapExpense = (x) => ({
  id: x.id,
  amount: parseFloat(x.amount),
  category: x.category,
  note: x.note || "",
  date: String(x.expense_date).slice(0, 10),
  time: x.expense_time ? String(x.expense_time).slice(0, 5) : "",
  affectsBalance: x.affects_balance !== false,
  hasReceipt: !!x.has_receipt,
  estimate: !!x.is_estimate,
});
export const mapMovie = (m) => ({
  id: m.id,
  title: m.title,
  date: String(m.watched_date).slice(0, 10),
  time: m.watched_time ? String(m.watched_time).slice(0, 5) : "",
  ticketPrice: parseFloat(m.ticket_price) || 0,
  canteenPrice: parseFloat(m.canteen_price) || 0,
  companions: m.companions || "",
  myTake: m.my_take,
  publicTake: m.public_take,
  genre: m.genre || "",
  venueType: m.venue_type || "Theatre",
  venueName: m.venue_name || "",
  affectsBalance: m.affects_balance !== false,
  quantity: m.quantity || 1,
  rating: m.rating || 0,
});

// A movie can be logged as a booking before you've seen it; its takes stay
// empty until you rate it afterwards. Only rated movies count in "you vs the
// crowd", badges and Wrapped.
export const isRated = (m) => !!m.myTake;
// "upcoming" before the show, "watching" for ~3 hours after it starts, then
// "rate" until you rate it. A movie with no time is assumed to start at 6 PM.
export function movieStatus(m, now = new Date()) {
  if (isRated(m)) return "rated";
  const start = new Date(`${m.date}T${m.time || "18:00"}:00`);
  const ms = now.getTime() - start.getTime();
  if (ms < 0) return "upcoming";
  if (ms < 3 * 3600 * 1000) return "watching";
  return "rate";
}
export const mapTopup = (t) => ({
  id: t.id,
  amount: parseFloat(t.amount),
  note: t.note || "",
  date: String(t.topup_date).slice(0, 10),
  mode: t.mode === "set" ? "set" : "add",
  createdAt: t.created_at,
});
export const mapRule = (r) => ({ id: r.id, ruleType: r.rule_type, category: r.category, amount: parseFloat(r.amount) });

// Movie tickets and snacks count as spending in the "Movies" category.
export function movieItems(movies) {
  const items = [];
  for (const m of movies) {
    const qty = m.quantity || 1;
    const q = qty > 1 ? ` ×${qty}` : "";
    if (m.ticketPrice > 0) items.push({ id: `movie-${m.id}-ticket`, movieId: m.id, amount: m.ticketPrice * qty, category: MOVIE_CATEGORY.name, note: `${m.title} (ticket${q})`, date: m.date, affectsBalance: m.affectsBalance });
    if (m.canteenPrice > 0) items.push({ id: `movie-${m.id}-canteen`, movieId: m.id, amount: m.canteenPrice * qty, category: MOVIE_CATEGORY.name, note: `${m.title} (canteen${q})`, date: m.date, affectsBalance: m.affectsBalance });
  }
  return items;
}

// Recurring items not yet posted this month, shown on the day they'll land.
export function recurringPending(recurring, todayIso) {
  const ym = ymOf(todayIso);
  const dim = daysInMonthOf(todayIso);
  return recurring
    .filter((r) => r.last_generated_month !== ym)
    .map((r) => ({
      id: `recurring-${r.id}`,
      amount: parseFloat(r.amount),
      category: r.category,
      note: r.note || "(recurring)",
      date: `${ym}-${pad(Math.min(r.day_of_month, dim))}`,
      affectsBalance: r.affects_balance !== false,
      isRecurringPending: true,
      recurringId: r.id,
      // Amount-varies bills: last month's amount stands in until you enter it.
      variable: !!r.variable,
      estimate: !!r.variable,
    }));
}

// Balance = money added − money spent (up to today). A "set balance" entry
// resets the baseline: only what happens after its date counts on top.
export function balanceOf(topups, items, todayIso) {
  const sets = topups.filter((t) => t.mode === "set");
  const baseline = sets.length
    ? [...sets].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : new Date(b.createdAt) - new Date(a.createdAt)))[0]
    : null;
  const counts = (x) => x.affectsBalance !== false && x.date <= todayIso;
  if (baseline) {
    const added = topups.filter((t) => t.mode === "add" && t.date > baseline.date).reduce((s, t) => s + t.amount, 0);
    const spent = items.filter((x) => counts(x) && x.date > baseline.date).reduce((s, x) => s + x.amount, 0);
    return { balance: baseline.amount + added - spent, added, spent, baseline };
  }
  const added = topups.filter((t) => t.mode === "add").reduce((s, t) => s + t.amount, 0);
  const spent = items.filter(counts).reduce((s, x) => s + x.amount, 0);
  return { balance: added - spent, added, spent, baseline: null };
}

export function itemsInMonth(items, ym) {
  return items.filter((x) => x.date.slice(0, 7) === ym);
}

// Today's budget: what you can spend per day for the rest of the month and
// stay above zero, after anything already scheduled. `hasMoney` is false
// when nothing has been added yet, so a new user isn't shown a red ₹0.
export function todayBudget({ items, balance, todayIso, hasMoney }) {
  const ym = ymOf(todayIso);
  const month = itemsInMonth(items, ym);
  const dim = daysInMonthOf(todayIso);
  const dom = Number(todayIso.slice(8, 10));
  const daysLeft = dim - dom + 1;
  const spentToday = month.filter((x) => x.date === todayIso).reduce((s, x) => s + x.amount, 0);
  const spentBeforeToday = month.filter((x) => x.date < todayIso).reduce((s, x) => s + x.amount, 0);
  const upcoming = month.filter((x) => x.date > todayIso);
  const upcomingDeducting = upcoming.filter((x) => x.affectsBalance !== false).reduce((s, x) => s + x.amount, 0);
  const upcomingTotal = upcoming.reduce((s, x) => s + x.amount, 0);
  const spentMonth = spentBeforeToday + spentToday;
  const dailyAvg = dom > 1 ? spentBeforeToday / (dom - 1) : spentToday;
  const projected = spentMonth + upcomingTotal + dailyAvg * (dim - dom);
  const pool = balance + spentToday - upcomingDeducting;
  const perDay = Math.max(0, pool / daysLeft);
  const left = perDay - spentToday;
  return {
    hasMoney, perDay, spentToday, left, daysLeft, spentMonth, upcomingTotal, upcoming,
    projected, dailyAvg, enoughForForecast: dom >= 3,
    // 0 → fine, 1 → nearly used, 2 → over
    level: !hasMoney ? 0 : left < 0 ? 2 : perDay > 0 && spentToday / perDay > 0.75 ? 1 : 0,
  };
}

export function byCategory(items, custom = []) {
  const totals = {};
  for (const x of items) totals[x.category] = (totals[x.category] || 0) + x.amount;
  const known = allCategories(custom);
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value, color: known.find((c) => c.name === name)?.color || "#6B6558" }))
    .sort((a, b) => b.value - a.value);
}

// Sugar streak: count back from today. An unmarked TODAY is skipped (the
// day isn't over); any earlier day that isn't marked sugar-free ends it.
export function sugarStreak(meta, daysMap, todayIso) {
  if (!meta) return 0;
  const start = String(meta.start_date).slice(0, 10);
  let streak = 0;
  for (let d = todayIso; d >= start; d = addDays(d, -1)) {
    const v = daysMap[d];
    if (d === todayIso && v !== true && v !== false) continue;
    if (v === true) streak++;
    else break;
  }
  return streak;
}

// Consecutive days (ending today, or yesterday if today has nothing yet)
// with at least one expense logged.
export function loggingStreak(expenses, todayIso) {
  const days = new Set(expenses.map((x) => x.date));
  let d = days.has(todayIso) ? todayIso : addDays(todayIso, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// Most repeated entries in the last 90 days, for one-tap logging. If a
// usual entry tends to happen around this hour, it ranks first.
export function quickSuggestions(expenses, todayIso, hour = 12) {
  const cutoff = addDays(todayIso, -90);
  const map = {};
  for (const x of expenses) {
    if (x.category === MOVIE_CATEGORY.name || x.date < cutoff || x.pending) continue;
    if (x.category === "Other" && !x.note) continue;
    const key = `${x.category}|${x.note.toLowerCase()}|${x.amount}`;
    const h = x.time ? Number(x.time.slice(0, 2)) : null;
    const e = (map[key] = map[key] || { category: x.category, note: x.note, amount: x.amount, count: 0, nearHour: 0 });
    e.count++;
    if (h !== null && Math.abs(h - hour) <= 1) e.nearHour++;
  }
  return Object.values(map)
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.nearHour - a.nearHour || b.count - a.count)
    .slice(0, 6);
}

// "How does this compare to usual?" without silly numbers: a percentage
// against a tiny baseline (₹40 → ₹3,840 = "+9500%") says nothing, so below
// a minimum baseline the difference is given in rupees instead.
export function compareToUsual(current, usual, { minBaseline = 500, maxPct = 200 } = {}) {
  const diff = current - usual;
  if (usual <= 0) return current > 0 ? { kind: "new", diff } : { kind: "same", diff: 0 };
  const pct = Math.round((diff / usual) * 100);
  // Tiny baselines and huge jumps (e.g. +1382% because last month was barely
  // logged) read better as a rupee difference.
  if (usual < minBaseline || Math.abs(pct) > maxPct) return { kind: "amount", diff, up: diff > 0 };
  return { kind: "pct", pct, diff, up: diff > 0 };
}

// One-line text for the above: "▲ 24% vs ₹4,000" / "₹3,800 more than ₹40".
export function describeChange(current, usual, opts) {
  const c = compareToUsual(current, usual, opts);
  if (c.kind === "pct") return `${c.up ? "▲" : "▼"} ${Math.abs(c.pct)}%`;
  if (c.kind === "amount") return `${c.up ? "+" : "−"}₹${Math.abs(Math.round(c.diff)).toLocaleString("en-IN")}`;
  return "";
}
