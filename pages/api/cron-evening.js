// 9 PM IST nudge (#2), run by Vercel Cron (see vercel.json). One
// notification at most: a reminder if nothing was logged today, or a
// heads-up if today went over the daily budget.
import * as db from "../../lib/db";
import { sendToAllDevices } from "../../lib/push";
import { isAuthorizedCron, rejectCron } from "../../lib/cronAuth";
import { localDateParts } from "../../lib/dates";
import { mapExpense, mapMovie, mapTopup, movieItems, recurringPending, balanceOf, todayBudget } from "../../lib/ledger";
import { fmt } from "../../lib/format";

export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    const today = localDateParts().iso;
    const [expRows, movieRows, topupRows, recurring] = await Promise.all([db.listExpenses(), db.listMovies(), db.listTopups(), db.listRecurring()]);
    const expenses = expRows.map(mapExpense);
    const items = [...expenses, ...movieItems(movieRows.map(mapMovie)), ...recurringPending(recurring, today)];
    const topups = topupRows.map(mapTopup);
    const { balance } = balanceOf(topups, items, today);
    const b = todayBudget({ items, balance, todayIso: today, hasMoney: topups.length > 0 });

    let note = null;
    if (!expenses.some((x) => x.date === today)) {
      note = { title: "🧾 Anything to log today?", body: "Nothing logged yet — a 5-second tap keeps your budget honest.", url: "/?quickadd=expense" };
    } else if (b.hasMoney && b.left < 0) {
      const tomorrow = Math.max(0, (b.perDay * b.daysLeft - b.spentToday) / Math.max(1, b.daysLeft - 1));
      note = { title: `💸 ${fmt(-b.left)} over today`, body: `No stress — tomorrow's budget adjusts to about ${fmt(tomorrow)}.`, url: "/" };
    }
    const result = note ? await sendToAllDevices(note) : null;
    return res.status(200).json({ ok: true, sent: note?.title || null, result });
  } catch (e) {
    console.error("[cron-evening]", e);
    return res.status(500).json({ error: "Failed to run evening check" });
  }
}
