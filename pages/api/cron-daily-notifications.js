import { listMovies, listRecurring } from "../../lib/db";
import { sendToAllDevices } from "../../lib/push";

function toISODate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Runs once a day via Vercel Cron (see vercel.json). Checks for anything
// due TODAY and sends one notification per thing found.
export default async function handler(req, res) {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
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
    const day = now.getDate();
    for (const r of recurring) {
      if (r.day_of_month === day) {
        await sendToAllDevices({
          title: "💳 Recurring expense today",
          body: `${r.note || r.category} — ₹${Math.round(r.amount)} is due today.`,
          url: "/",
        });
        sentItems.push(`recurring:${r.note || r.category}`);
      }
    }

    // On the 1st of each month, last month is fully closed out — nudge to
    // go read the report instead of it just sitting there unopened.
    if (day === 1) {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthName = lastMonthDate.toLocaleDateString("en-US", { month: "long" });
      await sendToAllDevices({
        title: "📊 Your monthly report is ready",
        body: `${lastMonthName}'s money, movies, and diet — all in one place.`,
        url: "/report",
      });
      sentItems.push("monthly-report");
    }

    return res.status(200).json({ ok: true, sentItems });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to run daily notification check" });
  }
}
