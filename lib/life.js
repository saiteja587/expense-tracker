// "Life" trackers: habits, health (weight / sleep / mood), food, renewals,
// warranties, documents, vehicles & fuel, occasions & gifts, lent items.
// They share one table (life_items); each kind's fields are listed in
// LIFE_KINDS and cleaned by cleanLifeData on the server.
// Everything here is pure and unit-tested (tests/life.test.js).
import { addDays, ymOf } from "./ledger";
import { detectSubscriptions } from "./smart";
import { ottKey, serviceInText, SERVICE_NAMES } from "./movieStats";

const iso = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "");
const round1 = (n) => Math.round(n * 10) / 10;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

// ---- Field types & kinds ----------------------------------------------------
// s: text (max len) · n: number ≥ 0 · i: whole number · b: yes/no · d: date ·
// e: one of a list · t: time HH:MM
const s = (max) => ({ t: "s", max });
const n = (max = 1e9) => ({ t: "n", max });
const i = (min, max) => ({ t: "i", min, max });
const e = (...opts) => ({ t: "e", opts });
const b = { t: "b" };
const d = { t: "d" };
const t = { t: "t" };

// ref: which kind a child item points to (ref_id). unique: one per (ref, date).
// date: the item's main date (item_date). vault: can hold encrypted secrets.
// photo: can hold a photo (bill / document).
export const LIFE_KINDS = {
  habit: { fields: { name: s(40), emoji: s(8), perWeek: i(1, 7), archived: b } },
  habit_log: { ref: "habit", unique: true, date: true, fields: {} },
  day_log: { unique: true, date: true, fields: { weight: n(400), sleepHours: n(24), bed: t, wake: t, mood: i(1, 5), steps: i(0, 200000), water: i(0, 40) } },
  food: { date: true, fields: { name: s(80), qty: n(50), unit: s(20), kcal: n(5000), protein: n(500), carbs: n(1000), fat: n(500), sugar: n(500), meal: e("breakfast", "lunch", "snack", "dinner") } },
  renewal: { date: true, fields: { name: s(60), category: e("insurance", "vehicle", "id", "home", "subscription", "other"), amount: n(), everyMonths: i(0, 120), provider: s(60), policyNo: s(60), note: s(200) }, vault: true },
  warranty: { date: true, photo: true, fields: { name: s(60), store: s(60), price: n(), months: i(1, 240), serial: s(60), note: s(200) } },
  document: { date: true, photo: true, vault: true, fields: { name: s(60), type: e("aadhaar", "pan", "passport", "licence", "voter", "insurance", "bank", "other"), holder: s(40), note: s(200) } },
  vehicle: { fields: { name: s(40), type: e("bike", "scooter", "car", "other"), number: s(20), serviceEveryKm: i(0, 100000), lastServiceKm: i(0, 2000000), lastServiceDate: d } },
  fuel: { ref: "vehicle", date: true, fields: { odometer: i(0, 2000000), litres: n(500), amount: n(), full: b, note: s(80) } },
  occasion: { fields: { person: s(40), type: e("birthday", "anniversary", "festival", "other"), month: i(1, 12), day: i(1, 31), budget: n(), phone: s(20), note: s(200) } },
  gift: { ref: "occasion", date: true, fields: { what: s(80), amount: n(), note: s(120) } },
  lent: { date: true, fields: { item: s(60), person: s(40), returned: b, returnedOn: d, note: s(120) } },
};
export const lifeKind = (k) => LIFE_KINDS[k] || null;

// Server-side cleaning: unknown fields dropped, every value forced into its
// type and range. Throws {status: 400} for a missing required name.
export function cleanLifeData(kind, data = {}) {
  const spec = LIFE_KINDS[kind];
  if (!spec) throw Object.assign(new Error("Unknown item type"), { status: 400 });
  const out = {};
  for (const [k, f] of Object.entries(spec.fields)) {
    const v = data[k];
    if (v === undefined || v === null || v === "") continue;
    if (f.t === "s") out[k] = String(v).trim().slice(0, f.max);
    else if (f.t === "n") { const x = parseFloat(v); if (isFinite(x) && x >= 0) out[k] = Math.min(x, f.max); }
    else if (f.t === "i") { const x = parseInt(v, 10); if (Number.isInteger(x)) out[k] = Math.min(f.max, Math.max(f.min, x)); }
    else if (f.t === "b") out[k] = v === true || v === "true" || v === 1;
    else if (f.t === "d") { const x = iso(v); if (/^\d{4}-\d{2}-\d{2}$/.test(x)) out[k] = x; }
    else if (f.t === "t") { const x = String(v).slice(0, 5); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) out[k] = x; }
    else if (f.t === "e") { if (f.opts.includes(v)) out[k] = v; }
  }
  const named = { habit: "name", food: "name", renewal: "name", warranty: "name", document: "name", vehicle: "name", occasion: "person", gift: "what", lent: "item" }[kind];
  if (named && !out[named]) throw Object.assign(new Error("Give it a name"), { status: 400 });
  return out;
}

export const mapLife = (r) => ({
  id: r.id, kind: r.kind, refId: r.ref_id ?? null, date: iso(r.item_date),
  ...(typeof r.data === "string" ? JSON.parse(r.data || "{}") : r.data || {}),
  hasPhoto: !!r.has_photo, vault: r.vault || "", createdAt: r.created_at,
});

// ---- Habits -------------------------------------------------------------------
// Streak of days in a row (today can still be open), and this week's count.
export function habitStats(habit, logs, todayIso) {
  const days = new Set(logs.filter((l) => l.refId === habit.id).map((l) => l.date));
  let streak = 0;
  for (let day = days.has(todayIso) ? todayIso : addDays(todayIso, -1); days.has(day); day = addDays(day, -1)) streak++;
  const dow = (new Date(todayIso + "T00:00:00").getDay() + 6) % 7; // Monday = 0
  const monday = addDays(todayIso, -dow);
  const week = [...Array(7)].map((_, k) => addDays(monday, k));
  const thisWeek = week.filter((x) => days.has(x)).length;
  let best = 0, run = 0, prev = null;
  for (const day of [...days].sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { doneToday: days.has(todayIso), streak, best, thisWeek, week: week.map((x) => ({ date: x, done: days.has(x), future: x > todayIso })), goalMet: thisWeek >= (habit.perWeek || 7) };
}

// ---- Health: weight trend, sleep, mood vs money ----------------------------------
export function healthSummary(dayLogs, items, todayIso) {
  const logs = [...dayLogs].sort((a, b2) => (a.date < b2.date ? -1 : 1));
  const weights = logs.filter((l) => l.weight > 0);
  const avgOf = (xs) => (xs.length ? round1(sum(xs, (x) => x) / xs.length) : null);
  const lastWeek = weights.filter((l) => l.date > addDays(todayIso, -7)).map((l) => l.weight);
  const prevWeek = weights.filter((l) => l.date <= addDays(todayIso, -7) && l.date > addDays(todayIso, -14)).map((l) => l.weight);
  const sleep = logs.filter((l) => l.sleepHours > 0 && l.date > addDays(todayIso, -14)).map((l) => l.sleepHours);

  // Spending per day (real spending only) to compare with mood / sleep.
  const spend = {};
  for (const x of items) if (!x.isRecurringPending && !x.isTransfer && x.date <= todayIso) spend[x.date] = (spend[x.date] || 0) + x.amount;
  const byMood = {};
  for (const l of logs) if (l.mood) (byMood[l.mood] = byMood[l.mood] || []).push(spend[l.date] || 0);
  const moodSpend = Object.entries(byMood).map(([mood, xs]) => ({ mood: +mood, days: xs.length, avg: Math.round(sum(xs, (x) => x) / xs.length) })).sort((a, b2) => a.mood - b2.mood);
  const low = moodSpend.filter((m) => m.mood <= 2), high = moodSpend.filter((m) => m.mood >= 4);
  const wavg = (ms) => { const dd = sum(ms, (m) => m.days); return dd ? sum(ms, (m) => m.avg * m.days) / dd : 0; };
  let moodInsight = null;
  if (sum(low, (m) => m.days) >= 3 && sum(high, (m) => m.days) >= 3) {
    const lo = wavg(low), hi = wavg(high);
    if (lo > hi * 1.3 && lo - hi >= 150) moodInsight = `On low-mood days you spend about ${(lo / Math.max(1, hi)).toFixed(1)}× what you do on good days.`;
  }
  // Short sleep → next day's food spending.
  const food = {};
  for (const x of items) if (x.category === "Food" && !x.isRecurringPending) food[x.date] = (food[x.date] || 0) + x.amount;
  const shortNext = [], okNext = [];
  for (const l of logs) if (l.sleepHours > 0) (l.sleepHours < 6 ? shortNext : okNext).push(food[l.date] || 0);
  let sleepInsight = null;
  if (shortNext.length >= 3 && okNext.length >= 3) {
    const a = sum(shortNext, (x) => x) / shortNext.length, c = sum(okNext, (x) => x) / okNext.length;
    if (a > c * 1.3 && a - c >= 100) sleepInsight = `After nights under 6 hours you spend about ₹${Math.round(a - c)} more on food.`;
  }
  return {
    latestWeight: weights.length ? weights[weights.length - 1].weight : null,
    weekAvg: avgOf(lastWeek), prevWeekAvg: avgOf(prevWeek),
    weekChange: avgOf(lastWeek) != null && avgOf(prevWeek) != null ? round1(avgOf(lastWeek) - avgOf(prevWeek)) : null,
    sleepAvg: avgOf(sleep), moodSpend, moodInsight, sleepInsight,
    weightSeries: weights.slice(-60).map((l) => ({ date: l.date, weight: l.weight })),
  };
}

// Sleep hours from bed/wake times ("23:30" → "07:00" = 7.5).
export function sleepHoursFrom(bed, wake) {
  if (!bed || !wake) return null;
  const [bh, bm] = bed.split(":").map(Number), [wh, wm] = wake.split(":").map(Number);
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60;
  return round1(mins / 60);
}

// ---- Renewals, warranties --------------------------------------------------------
// A renewal's due date is item_date. "Mark renewed" moves it on by everyMonths.
export function addMonths(isoDate, months) {
  const [y, m, dd] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`;
}
export function dueStatus(dueIso, todayIso) {
  if (!dueIso) return { daysLeft: null, level: "none" };
  const daysLeft = daysBetween(todayIso, dueIso);
  return { daysLeft, level: daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "soon" : daysLeft <= 30 ? "month" : "ok" };
}
export const warrantyEnds = (w) => (w.date && w.months ? addMonths(w.date, w.months) : "");
// Reminder days: renewals 30/7/1/0 days before; warranties 30 and 7 days before.
export const REMIND_RENEWAL = [30, 7, 1, 0];
export const REMIND_WARRANTY = [30, 7];

// ---- Vehicles: mileage (full-tank method), cost per km, service due ---------------
export function vehicleStats(vehicle, fuelLogs) {
  const fills = fuelLogs.filter((f) => f.refId === vehicle.id && f.odometer > 0).sort((a, b2) => a.odometer - b2.odometer);
  let km = 0, litres = 0;
  // Between two full tanks: distance / litres added after the first one.
  let lastFull = null, since = 0;
  for (const f of fills) {
    if (lastFull) since += f.litres || 0;
    if (f.full) {
      if (lastFull && since > 0) { km += f.odometer - lastFull.odometer; litres += since; }
      lastFull = f; since = 0;
    }
  }
  const odometer = fills.length ? fills[fills.length - 1].odometer : vehicle.lastServiceKm || 0;
  const spent = sum(fills, (f) => f.amount || 0);
  const span = fills.length >= 2 ? fills[fills.length - 1].odometer - fills[0].odometer : 0;
  const nextServiceKm = vehicle.serviceEveryKm ? (vehicle.lastServiceKm || 0) + vehicle.serviceEveryKm : null;
  return {
    mileage: litres > 0 ? round1(km / litres) : null, odometer,
    costPerKm: span > 0 ? round1((spent - (fills[fills.length - 1].amount || 0)) / span) : null,
    spent: Math.round(spent), fills: fills.length,
    nextServiceKm, kmToService: nextServiceKm != null ? nextServiceKm - odometer : null,
  };
}

// ---- Occasions ------------------------------------------------------------------
export function nextOccurrence(o, todayIso) {
  const y = +todayIso.slice(0, 4);
  const at = (yy) => {
    const last = new Date(yy, o.month, 0).getDate();
    return `${yy}-${String(o.month).padStart(2, "0")}-${String(Math.min(o.day, last)).padStart(2, "0")}`;
  };
  const date = at(y) >= todayIso ? at(y) : at(y + 1);
  return { date, daysLeft: daysBetween(todayIso, date) };
}

// ---- OTT optimizer ----------------------------------------------------------------
// Streaming apps you pay for (from expenses) vs what you actually watched on
// them in the last 90 days (movies logged as OTT + TV shows you track).
export function ottOptimizer({ expenses = [], movies = [], shows = [], todayIso }) {
  const { subs } = detectSubscriptions(expenses, todayIso);
  const paid = {};
  for (const s2 of subs) {
    const k = serviceInText(s2.name);
    if (k && !s2.stale) paid[k] = paid[k] || { key: k, monthly: s2.monthly, note: s2.name };
  }
  const since = addDays(todayIso, -90);
  const used = {};
  for (const m of movies) if (m.venueType === "OTT" && m.date >= since) { const k = ottKey(m.venueName); if (k) used[k] = (used[k] || 0) + 1; }
  for (const sh of shows) if (sh.platform && sh.status === "watching") { const k = ottKey(sh.platform); if (k) used[k] = (used[k] || 0) + 1; }
  const rows = Object.values(paid).map((p) => ({ ...p, name: SERVICE_NAMES[p.key] || p.note, watched: used[p.key] || 0 }));
  const idle = rows.filter((r) => r.watched <= 1).sort((a, b2) => b2.monthly - a.monthly);
  return { rows: rows.sort((a, b2) => b2.monthly - a.monthly), idle, canSave: sum(idle, (r) => r.monthly) };
}

// ---- Weekly summary (Sunday evening push) --------------------------------------
export function weeklySummary({ items = [], movies = [], sugarDays = {}, habitLogs = [], todayIso }) {
  const from = addDays(todayIso, -6);
  const week = items.filter((x) => x.date >= from && x.date <= todayIso && !x.isRecurringPending && !x.isTransfer);
  const spent = Math.round(sum(week, (x) => x.amount));
  const cats = {};
  for (const x of week) cats[x.category] = (cats[x.category] || 0) + x.amount;
  const top = Object.entries(cats).sort((a, b2) => b2[1] - a[1])[0];
  const sugarFree = Object.entries(sugarDays).filter(([day, v]) => day >= from && day <= todayIso && v === true).length;
  const watched = movies.filter((m) => m.date >= from && m.date <= todayIso).length;
  const habits = habitLogs.filter((l) => l.date >= from && l.date <= todayIso).length;
  const bits = [`₹${spent.toLocaleString("en-IN")} spent`];
  if (top) bits.push(`most on ${top[0]}`);
  if (sugarFree) bits.push(`${sugarFree} sugar-free day${sugarFree === 1 ? "" : "s"}`);
  if (watched) bits.push(`${watched} movie${watched === 1 ? "" : "s"}`);
  if (habits) bits.push(`${habits} habit check-in${habits === 1 ? "" : "s"}`);
  return { spent, top: top ? top[0] : null, sugarFree, watched, habits, text: bits.join(" · ") };
}

// ---- Expenses as CSV (opens in Excel / Google Sheets) ------------------------------
export function expensesCsv(rows, accountName = () => "") {
  const head = ["Date", "Time", "Category", "Note", "Amount", "Account", "Tax tag"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...rows.map((x) => [x.date, x.time || "", x.category, x.note || "", x.amount, accountName(x.accountId), x.taxTag || ""])]
    .map((r) => r.map(esc).join(",")).join("\n");
}

export const monthOf = (isoDate) => ymOf(isoDate);
