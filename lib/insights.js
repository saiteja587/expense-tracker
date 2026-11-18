// Plain-language observations about your money, ranked so the most useful
// one can headline the Home screen. Each: { id, emoji, text, tone, score }.
// tone: "good" | "warn" | "info". Thresholds keep out noise like "+9500%".
import { addDays, ymOf, daysInMonthOf, compareToUsual } from "./ledger";
import { fmt } from "./format";
import { categoryEmoji } from "./categories";

const sum = (xs) => xs.reduce((s, x) => s + x.amount, 0);
const monthLabel = (ym) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long" });

export function prevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function generateInsights({ items, movies = [], todayIso }) {
  const out = [];
  const spent = items.filter((x) => x.date <= todayIso && !x.isRecurringPending);
  if (spent.length < 3) return out;
  const ym = ymOf(todayIso);
  const dom = Number(todayIso.slice(8, 10));
  const thisMonth = spent.filter((x) => ymOf(x.date) === ym);
  const lastYm = prevMonth(ym);
  const lastMonth = spent.filter((x) => ymOf(x.date) === lastYm);

  // 1. Pace vs the same point last month.
  if (lastMonth.length >= 5 && dom >= 5) {
    const lastSamePoint = sum(lastMonth.filter((x) => Number(x.date.slice(8, 10)) <= dom));
    const now = sum(thisMonth);
    const diff = now - lastSamePoint;
    if (Math.abs(diff) >= 500) {
      out.push(diff < 0
        ? { id: "pace", emoji: "👏", tone: "good", score: 80, text: `You're ${fmt(-diff)} below where you were in ${monthLabel(lastYm)} by this date.` }
        : { id: "pace", emoji: "📈", tone: "warn", score: 75, text: `You're ${fmt(diff)} ahead of ${monthLabel(lastYm)}'s spending by this date.` });
    }
  }

  // 2. Weekends vs weekdays (last 8 weeks, per-day average).
  const since = addDays(todayIso, -56);
  const recent = spent.filter((x) => x.date >= since);
  const byDay = {};
  for (const x of recent) byDay[x.date] = (byDay[x.date] || 0) + x.amount;
  const days = Object.keys(byDay);
  const isWeekend = (d) => [0, 6].includes(new Date(d + "T00:00:00").getDay());
  const we = days.filter(isWeekend), wd = days.filter((d) => !isWeekend(d));
  if (we.length >= 4 && wd.length >= 8) {
    const weAvg = we.reduce((s, d) => s + byDay[d], 0) / we.length;
    const wdAvg = wd.reduce((s, d) => s + byDay[d], 0) / wd.length;
    if (weAvg >= wdAvg * 1.4 && weAvg - wdAvg >= 200) {
      out.push({ id: "weekend", emoji: "🎉", tone: "info", score: 60, text: `Weekends cost you ${(weAvg / wdAvg).toFixed(1)}× weekdays (${fmt(weAvg)} vs ${fmt(wdAvg)} a day).` });
    }
  }

  // 3. Small habits that add up this month.
  const habits = {};
  for (const x of thisMonth) {
    if (!x.note || x.amount > 300) continue;
    const k = x.note.trim().toLowerCase();
    habits[k] = habits[k] || { note: x.note.trim(), n: 0, total: 0, category: x.category };
    habits[k].n++;
    habits[k].total += x.amount;
  }
  const habit = Object.values(habits).filter((h) => h.n >= 4).sort((a, b) => b.total - a.total)[0];
  if (habit) {
    const perMonth = (habit.total / dom) * daysInMonthOf(todayIso);
    out.push({ id: "habit", emoji: categoryEmoji(habit.category), tone: "info", score: 55, text: `${habit.note}: ${habit.n} times this month — ${fmt(habit.total)} so far, about ${fmt(perMonth)} by month end.` });
  }

  // 4. Biggest category move vs last month (only meaningful baselines).
  if (lastMonth.length >= 5 && dom >= 10) {
    const cats = {};
    const slot = (name) => (cats[name] = cats[name] || { now: 0, last: 0 });
    for (const x of thisMonth) slot(x.category).now += x.amount;
    for (const x of lastMonth) slot(x.category).last += x.amount;
    let best = null;
    for (const [name, v] of Object.entries(cats)) {
      const scaledLast = (v.last / daysInMonthOf(lastYm + "-01")) * dom; // same number of days
      const c = compareToUsual(v.now, scaledLast, { minBaseline: 800 });
      if (c.kind === "pct" && Math.abs(c.pct) >= 30 && (!best || Math.abs(c.diff) > Math.abs(best.c.diff))) best = { name, c };
    }
    if (best) {
      out.push(best.c.up
        ? { id: "cat", emoji: "👀", tone: "warn", score: 70, text: `${best.name} is up ${best.c.pct}% on last month at this point (${fmt(best.c.diff)} more).` }
        : { id: "cat", emoji: "🌱", tone: "good", score: 70, text: `${best.name} is down ${-best.c.pct}% on last month at this point — ${fmt(-best.c.diff)} saved.` });
    }
  }

  // 5. No-spend days this month.
  const spendDays = new Set(thisMonth.map((x) => x.date));
  const noSpend = dom - [...spendDays].filter((d) => d <= todayIso).length - (spendDays.has(todayIso) ? 0 : 1);
  if (noSpend >= 2) out.push({ id: "nospend", emoji: "🌿", tone: "good", score: 45, text: `${noSpend} no-spend days so far this month. Nice.` });

  // 6. Biggest single spend this month.
  const big = [...thisMonth].sort((a, b) => b.amount - a.amount)[0];
  if (big && big.amount >= 1000) {
    const d = new Date(big.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    out.push({ id: "big", emoji: "💸", tone: "info", score: 30, text: `Biggest spend this month: ${big.note || big.category}, ${fmt(big.amount)} on ${d}.` });
  }

  // 7. Movies this month.
  const mm = movies.filter((m) => ymOf(m.date) === ym);
  const movieSpend = mm.reduce((s, m) => s + (m.ticketPrice + m.canteenPrice) * (m.quantity || 1), 0);
  if (mm.length >= 2 && movieSpend > 0) {
    out.push({ id: "movies", emoji: "🎬", tone: "info", score: 35, text: `${mm.length} movies this month, ${fmt(movieSpend)} in all — ${fmt(movieSpend / mm.length)} a movie.` });
  }

  return out.sort((a, b) => b.score - a.score);
}
