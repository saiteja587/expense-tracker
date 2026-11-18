import { listMovies, listRecurring, listExpenses, listChallengeDays, saveBackup } from "../../lib/db";
import { buildExport } from "./data";
import { sendToAllDevices } from "../../lib/push";
import { isAuthorizedCron, rejectCron } from "../../lib/cronAuth";
import { localDateParts, effectiveDay, addDaysISO } from "../../lib/dates";

function toISODate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Runs once a day via Vercel Cron (see vercel.json). Checks for anything
// due TODAY and sends one notification per thing found.
export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    // All "today" logic uses the app's local date (IST), not the server's UTC.
    const local = localDateParts();
    const today = local.iso;
    const sentItems = [];

    const movies = await listMovies();
    for (const m of movies) {
      if (toISODate(m.watched_date) === today) {
        await sendToAllDevices({
          title: "🎬 Movie today",
          body: `You've got "${m.title}" scheduled for today.`,
          url: "/movies",
        });
        sentItems.push(`movie:${m.title}`);
      }
    }

    const recurring = await listRecurring();
    const day = local.day;
    // Tomorrow's date parts (handles month ends).
    const tmr = localDateParts(new Date(Date.now() + 86400000));
    for (const r of recurring) {
      const label = r.note || r.category;
      // Bills with a UPI id open a "Pay now" page that launches the UPI app.
      const url = r.upi_id ? `/pay?r=${r.id}` : "/";
      if (effectiveDay(r.day_of_month, local.year, local.month) === day) {
        await sendToAllDevices({ title: "💳 Due today", body: `${label} — ₹${Math.round(r.amount)} is due today.${r.upi_id ? " Tap to pay via UPI." : ""}`, url });
        sentItems.push(`recurring:${label}`);
      } else if (effectiveDay(r.day_of_month, tmr.year, tmr.month) === tmr.day) {
        await sendToAllDevices({ title: "⏰ Bill due tomorrow", body: `${label} — ₹${Math.round(r.amount)} is due tomorrow.${r.upi_id ? " Tap to pay now via UPI." : ""}`, url });
        sentItems.push(`recurring-tomorrow:${label}`);
      }
    }

    // Sundays: keep a server-side backup copy (last 4 are kept) and remind
    // you to save one to your phone too.
    if (local.weekday === 0) {
      try {
        await saveBackup(JSON.stringify(await buildExport()));
        await sendToAllDevices({ title: "🛟 Weekly backup saved", body: "A copy is stored on the server. Tap to download one to your phone as well.", url: "/settings?backup=1" });
        sentItems.push("weekly-backup");
      } catch (e) {
        console.error("[cron-daily] weekly backup failed:", e);
      }
    }

    // On the 1st of each month, last month is fully closed out — nudge to
    // go read the report instead of it just sitting there unopened.
    if (day === 1) {
      const lastMonthDate = new Date(Date.UTC(local.year, local.month - 2, 1));
      const lastMonthName = lastMonthDate.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
      await sendToAllDevices({
        title: "📊 Your monthly report is ready",
        body: `${lastMonthName}'s money, movies, and diet — all in one place.`,
        url: "/report",
      });
      sentItems.push("monthly-report");
    }

    // Once a week (Sunday), send a single digest instead of only daily pings —
    // a short recap of money, movies, and diet for the week just finished.
    if (local.weekday === 0) {
      const weekAgoStr = addDaysISO(today, -7);

      const allExpenses = await listExpenses();
      const weekSpend = allExpenses
        .filter((x) => toISODate(x.expense_date) > weekAgoStr && toISODate(x.expense_date) <= today)
        .reduce((s, x) => s + parseFloat(x.amount), 0);

      const weekMovies = movies.filter((m) => toISODate(m.watched_date) > weekAgoStr && toISODate(m.watched_date) <= today).length;

      const days = await listChallengeDays();
      let streak = 0;
      const sorted = [...days].sort((a, b) => (toISODate(a.day_date) < toISODate(b.day_date) ? 1 : -1));
      for (const d of sorted) {
        if (d.completed) streak++;
        else break;
      }

      await sendToAllDevices({
        title: "🗓️ Your week in review",
        body: `₹${Math.round(weekSpend).toLocaleString("en-IN")} spent · ${weekMovies} movie${weekMovies !== 1 ? "s" : ""} · ${streak}-day sugar-free streak`,
        url: "/year",
      });
      sentItems.push("weekly-digest");
    }

    return res.status(200).json({ ok: true, sentItems });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to run daily notification check" });
  }
}
