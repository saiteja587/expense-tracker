// The facts behind a month's "Wrapped" story. Pure and tested; the page only
// decides how to show them.
import { itemsInMonth, byCategory, daysInMonthOf } from "./ledger";
import { prevMonth } from "./insights";
import { categoryEmoji } from "./categories";

export function wrappedFor({ ym, items, movies = [], challengeDays = {}, custom = [], todayIso }) {
  const spentItems = items.filter((x) => x.date <= todayIso && !x.isRecurringPending);
  const month = itemsInMonth(spentItems, ym);
  const total = month.reduce((s, x) => s + x.amount, 0);
  const prevTotal = itemsInMonth(spentItems, prevMonth(ym)).reduce((s, x) => s + x.amount, 0);
  const cats = byCategory(month, custom);
  const top = cats[0] ? { ...cats[0], share: cats[0].value / total, emoji: categoryEmoji(cats[0].name, custom) } : null;

  const notes = {};
  for (const x of month) {
    if (!x.note) continue;
    const k = x.note.trim().toLowerCase();
    notes[k] = notes[k] || { note: x.note.trim(), count: 0, total: 0 };
    notes[k].count++;
    notes[k].total += x.amount;
  }
  const habit = Object.values(notes).filter((n) => n.count >= 3).sort((a, b) => b.count - a.count || b.total - a.total)[0] || null;

  const byDay = {};
  for (const x of month) byDay[x.date] = (byDay[x.date] || 0) + x.amount;
  const bigDay = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;

  const dim = daysInMonthOf(ym + "-01");
  const lastDay = ym === todayIso.slice(0, 7) ? Number(todayIso.slice(8, 10)) - 1 : dim;
  const noSpendDays = Math.max(0, lastDay - Object.keys(byDay).filter((d) => Number(d.slice(8, 10)) <= lastDay).length);

  const monthMovies = movies.filter((m) => m.date.slice(0, 7) === ym);
  const loved = monthMovies.find((m) => m.myTake === "loved") || monthMovies[0] || null;
  const sugarFree = Object.entries(challengeDays).filter(([d, v]) => d.slice(0, 7) === ym && v === true).length;

  return {
    ym, total, prevTotal, entries: month.length, top, habit,
    bigDay: bigDay ? { date: bigDay[0], amount: bigDay[1] } : null,
    noSpendDays, movies: monthMovies.length, lovedMovie: loved?.title || null, sugarFree,
    empty: month.length === 0,
  };
}
