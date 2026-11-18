// Small, opt-in money challenges ("No delivery week", "Under ₹500 a day").
// Active challenges are stored in app_settings (mini_challenges); progress
// is always computed from your expenses, so it can't drift.
import { addDays } from "./ledger";
import { fmt } from "./format";

const DELIVERY = /swiggy|zomato|eatsure|eatclub|domino|delivery/i;

export const TEMPLATES = {
  no_delivery: {
    title: "No food delivery week",
    emoji: "🥡",
    days: 7,
    describe: () => "7 days without Swiggy, Zomato or other delivery.",
    // Returns true if the day broke the rule.
    breaks: (dayItems) => dayItems.some((x) => DELIVERY.test(`${x.note} ${x.category}`)),
  },
  daily_cap: {
    title: "Daily cap",
    emoji: "🎯",
    days: 5,
    param: 500,
    describe: (p) => `Spend under ${fmt(p)} every day for 5 days.`,
    breaks: (dayItems, p) => dayItems.reduce((s, x) => s + x.amount, 0) > p,
  },
  no_shopping: {
    title: "No shopping week",
    emoji: "🛍️",
    days: 7,
    describe: () => "7 days with nothing in Shopping.",
    breaks: (dayItems) => dayItems.some((x) => x.category === "Shopping"),
  },
  log_daily: {
    title: "Log every day",
    emoji: "✍️",
    days: 7,
    describe: () => "Log at least one expense every day for a week.",
    // Judged only once the day is over.
    breaks: (dayItems, _p, isPast) => isPast && dayItems.length === 0,
  },
  no_spend_weekend: {
    title: "No-spend weekend",
    emoji: "🌿",
    days: 2,
    describe: () => "A Saturday and Sunday without spending (bills excepted).",
    breaks: (dayItems) => dayItems.some((x) => !x.isRecurringPending && !["Bills", "Rent"].includes(x.category)),
  },
};

// Next Saturday (or today if it is one) — the weekend challenge starts there.
export function nextSaturday(todayIso) {
  let d = todayIso;
  while (new Date(d + "T00:00:00").getDay() !== 6) d = addDays(d, 1);
  return d;
}

export function makeChallenge(template, todayIso, param) {
  const t = TEMPLATES[template];
  const start = template === "no_spend_weekend" ? nextSaturday(todayIso) : todayIso;
  return { id: `${template}-${Date.now()}`, template, start, days: t.days, param: param ?? t.param ?? null };
}

// { status: "upcoming" | "active" | "won" | "lost", day: n of days, dayStates: ["ok"|"broken"|"pending"], ... }
export function evaluateChallenge(ch, items, todayIso) {
  const t = TEMPLATES[ch.template];
  if (!t) return null;
  const end = addDays(ch.start, ch.days - 1);
  const dayStates = [];
  for (let i = 0; i < ch.days; i++) {
    const d = addDays(ch.start, i);
    if (d > todayIso) { dayStates.push("pending"); continue; }
    const dayItems = items.filter((x) => x.date === d);
    const broken = t.breaks(dayItems, ch.param, d < todayIso);
    dayStates.push(broken ? "broken" : d < todayIso ? "ok" : "today");
  }
  const lost = dayStates.includes("broken");
  let status = "active";
  if (todayIso < ch.start) status = "upcoming";
  else if (lost) status = "lost";
  else if (todayIso > end) status = "won";
  const day = Math.min(ch.days, Math.max(0, Math.round((new Date(todayIso) - new Date(ch.start)) / 86400000) + 1));
  return { ...ch, title: t.title, emoji: t.emoji, description: t.describe(ch.param), status, day, end, dayStates };
}
