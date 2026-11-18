// Badges and levels across money, movies and diet. Pure: computed from the
// data every time, so nothing to store or keep in sync.
import { addDays, ymOf } from "./ledger";

export const LEVELS = [0, 60, 150, 300, 500, 800, 1200, 1800, 2600];
export const LEVEL_NAMES = ["Newbie", "Tracker", "Saver", "Planner", "Budget Pro", "Money Ninja", "Finance Guru", "Legend", "Mythic"];

function longestRun(dateSet) {
  const ds = [...dateSet].sort();
  let best = 0, cur = 0, prev = null;
  for (const d of ds) {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

function sugarLongest(challengeDays, history = []) {
  const done = new Set(Object.entries(challengeDays || {}).filter(([, v]) => v === true).map(([d]) => d));
  return Math.max(longestRun(done), ...history.map((h) => h.longest_streak || 0), 0);
}

export function computeBadges(data, todayIso) {
  const { expenses = [], movies = [], rules = [], challengeDays = {}, challengeHistory = [], ious = [] } = data || {};
  const logDays = new Set(expenses.map((x) => x.date).filter((d) => d <= todayIso));
  const logRun = longestRun(logDays);
  const first = [...logDays].sort()[0];

  // No-spend days: days since your first entry (excluding today) with nothing logged.
  let noSpend = 0, noSpendThisMonth = 0;
  if (first) {
    for (let d = first; d < todayIso; d = addDays(d, 1)) {
      if (!logDays.has(d)) {
        noSpend++;
        if (ymOf(d) === ymOf(todayIso)) noSpendThisMonth++;
      }
    }
  }

  const overall = rules.find((r) => r.ruleType === "overall");
  const weekSpend = expenses.filter((x) => x.date > addDays(todayIso, -7) && x.date <= todayIso).reduce((s, x) => s + x.amount, 0);
  const underWeek = overall && logDays.size >= 7 && weekSpend <= (overall.amount / 30) * 7;

  const year = todayIso.slice(0, 4);
  const moviesThisYear = movies.filter((m) => m.date.startsWith(year)).length;
  const matched = movies.filter((m) => m.myTake && m.myTake === m.publicTake).length;
  const receipts = expenses.filter((x) => x.hasReceipt).length;
  const settled = ious.filter((i) => i.settled).length;
  const sugar = sugarLongest(challengeDays, challengeHistory);

  const B = (id, emoji, title, desc, points, value, target) => ({
    id, emoji, title, desc, points, earned: value >= target, progress: Math.min(1, value / target), value: Math.min(value, target), target,
  });

  return [
    B("first", "✍️", "First entry", "Log your first expense", 10, logDays.size, 1),
    B("streak7", "🔥", "Week streak", "Log something 7 days in a row", 50, logRun, 7),
    B("streak30", "⚡", "Month streak", "Log something 30 days in a row", 150, logRun, 30),
    B("nospend1", "🌱", "No-spend day", "Have a day with no spending", 20, noSpend, 1),
    B("nospend3", "🌿", "Frugal month", "3 no-spend days in one month", 60, noSpendThisMonth, 3),
    B("underweek", "🛡️", "On budget week", "Keep a week under your monthly limit's pace", 60, underWeek ? 1 : 0, 1),
    B("receipts", "🧾", "Receipt keeper", "Attach 10 receipt photos", 30, receipts, 10),
    B("movies10", "🎬", "Cinephile", "Watch 10 movies this year", 60, moviesThisYear, 10),
    B("critic", "🎯", "In tune", "Agree with the crowd on 5 movies", 30, matched, 5),
    B("sugar7", "🍬", "Sweet escape", "7 sugar-free days in a row", 40, sugar, 7),
    B("sugar21", "💪", "Habit formed", "21 sugar-free days in a row", 100, sugar, 21),
    B("sugar41", "🏆", "Sugar slayer", "41 sugar-free days in a row", 200, sugar, 41),
    B("ious", "🤝", "Square deal", "Settle 5 IOUs", 30, settled, 5),
  ];
}

export function levelFor(badges) {
  const xp = badges.filter((b) => b.earned).reduce((s, b) => s + b.points, 0);
  let level = 0;
  while (level + 1 < LEVELS.length && xp >= LEVELS[level + 1]) level++;
  const next = LEVELS[level + 1];
  return {
    xp,
    level: level + 1,
    name: LEVEL_NAMES[level],
    next: next ?? null,
    progress: next ? (xp - LEVELS[level]) / (next - LEVELS[level]) : 1,
  };
}
