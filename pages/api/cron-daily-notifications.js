import { listUsers, listMovies, listRecurring, listExpenses, listChallengeDays, saveBackup, getBillsPaid, listWatchlist, updateWatchlistMeta, listFollows, setFollowNotified } from "../../lib/db";
import { hasTmdb, movieDetails, personMovies, freshReleases } from "../../lib/tmdb";
import { ottKey, userOttApps, SERVICE_NAMES } from "../../lib/movieStats";
import { mapExpense, mapMovie } from "../../lib/ledger";
import { buildExport } from "./data";
import { sendToUser } from "../../lib/push";
import { isAuthorizedCron, rejectCron } from "../../lib/cronAuth";
import { localDateParts, effectiveDay, addDaysISO } from "../../lib/dates";

function toISODate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Runs once a day via Vercel Cron (see vercel.json). For each person, checks
// for anything due TODAY and sends one notification per thing found to that
// person's devices only.
export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    // All "today" logic uses the app's local date (IST), not the server's UTC.
    const local = localDateParts();
    const sent = {};
    for (const u of await listUsers()) {
      try {
        sent[u.id] = await runForUser(u.id, local);
      } catch (e) {
        console.error(`[cron-daily] user ${u.id} failed:`, e);
      }
    }
    return res.status(200).json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to run daily notification check" });
  }
}

async function runForUser(uid, local) {
    const today = local.iso;
    const day = local.day;
    const sentItems = [];
    const sendToAllDevices = (payload) => sendToUser(uid, payload);

    const movies = await listMovies(uid);
    const yesterday = addDaysISO(today, -1);
    for (const m of movies) {
      if (m.my_take) continue; // already watched and rated
      const d = toISODate(m.watched_date);
      if (d === today) {
        const at = m.watched_time ? ` at ${String(m.watched_time).slice(0, 5)}` : "";
        await sendToAllDevices({ title: "🎬 Movie today", body: `"${m.title}"${at} — enjoy! We'll ask how it was afterwards.`, url: "/movies" });
        sentItems.push(`movie:${m.title}`);
      } else if (d === yesterday) {
        // Late shows (and anything the evening check missed).
        await sendToAllDevices({ title: `🍿 How was ${m.title}?`, body: "Rate it while it's fresh — and add what you spent on snacks.", url: `/movies?rate=${m.id}` });
        sentItems.push(`rate:${m.title}`);
      }
    }

    // Watchlist: release-day reminders and "now streaming on your app" alerts.
    if (hasTmdb()) {
      try {
        sentItems.push(...(await watchlistAlerts(uid, today, movies, sendToAllDevices)));
      } catch (e) {
        console.error(`[cron-daily] watchlist alerts for user ${uid} failed:`, e);
      }
      try {
        sentItems.push(...(await followAlerts(uid, today, sendToAllDevices)));
      } catch (e) {
        console.error(`[cron-daily] follow alerts for user ${uid} failed:`, e);
      }
    }

    const recurring = await listRecurring(uid);
    // Tomorrow's date parts (handles month ends).
    const tmr = localDateParts(new Date(Date.now() + 86400000));
    const paid = await getBillsPaid(uid);
    for (const r of recurring) {
      const label = r.note || r.category;
      const amt = `${r.variable ? "about " : ""}₹${Math.round(r.amount)}`;
      // Bills with a UPI id open a "Pay now" page that launches the UPI app;
      // amount-varies bills without one open Home to enter the amount.
      const url = r.upi_id ? `/pay?r=${r.id}` : r.variable ? `/?bill=${r.id}` : "/";
      const dueDay = effectiveDay(r.day_of_month, local.year, local.month);
      const settled = r.variable ? r.last_generated_month === local.ym : paid[r.id] === local.ym;
      if (dueDay === day) {
        const body = r.variable
          ? `${label} is due today — how much was it this month? Tap to log it${r.upi_id ? " and pay" : ""}.`
          : `${label} — ${amt} is due today.${r.upi_id ? " Tap to pay via UPI." : ""}`;
        await sendToAllDevices({ title: r.variable ? "🧾 Bill due today" : "💳 Due today", body, url });
        sentItems.push(`recurring:${label}`);
      } else if (effectiveDay(r.day_of_month, tmr.year, tmr.month) === tmr.day) {
        await sendToAllDevices({ title: "⏰ Bill due tomorrow", body: `${label} — ${amt} is due tomorrow.${r.upi_id ? " Tap to pay now via UPI." : ""}`, url });
        sentItems.push(`recurring-tomorrow:${label}`);
      } else if (!settled && (r.upi_id || r.variable) && (day - dueDay === 1 || day - dueDay === 3)) {
        // Asked "Did it go through?" and said not yet (or never answered):
        // a reminder the next day, and once more two days later.
        const body = r.variable ? `How much was ${label} this month? Tap to log it.` : `${label} — ${amt} was due on the ${dueDay}. Paid already? Tap to mark it.`;
        await sendToAllDevices({ title: r.variable ? "🧾 Still to log" : "💳 Still unpaid?", body, url });
        sentItems.push(`recurring-unpaid:${label}`);
      }
    }

    // Sundays: keep a server-side backup copy (last 4 are kept) and remind
    // you to save one to your phone too.
    if (local.weekday === 0) {
      try {
        await saveBackup(uid, JSON.stringify(await buildExport(uid)));
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

      const allExpenses = await listExpenses(uid);
      const weekSpend = allExpenses
        .filter((x) => toISODate(x.expense_date) > weekAgoStr && toISODate(x.expense_date) <= today)
        .reduce((s, x) => s + parseFloat(x.amount), 0);

      const weekMovies = movies.filter((m) => toISODate(m.watched_date) > weekAgoStr && toISODate(m.watched_date) <= today).length;

      const days = await listChallengeDays(uid);
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

    return sentItems;
}

async function watchlistAlerts(uid, today, movieRows, send) {
  const sent = [];
  const items = (await listWatchlist(uid)).filter((w) => w.tmdb_id).slice(0, 30);
  if (!items.length) return sent;
  const tomorrow = addDaysISO(today, 1);
  const apps = userOttApps({ movies: movieRows.map(mapMovie), expenses: (await listExpenses(uid)).map(mapExpense), todayIso: today });
  for (const w of items) {
    let d;
    try { d = await movieDetails(w.tmdb_id); } catch { continue; }
    const notified = new Set(String(w.notified || "").split(",").filter(Boolean));
    const rel = d.indiaRelease || d.releaseDate || "";
    if (rel === tomorrow && !notified.has(`rel1:${rel}`)) {
      await send({ title: `🎟️ ${w.title} releases tomorrow`, body: "Book tickets? Tap to log the booking.", url: `/movies?book=${w.tmdb_id}` });
      notified.add(`rel1:${rel}`);
      sent.push(`release-tomorrow:${w.title}`);
    } else if (rel === today && !notified.has(`rel0:${rel}`)) {
      await send({ title: `🍿 ${w.title} is out today`, body: "In theatres now — tap to book or see where it's playing.", url: `/movies?book=${w.tmdb_id}` });
      notified.add(`rel0:${rel}`);
      sent.push(`release-today:${w.title}`);
    }
    // Streaming: alert when it lands on an app you use (any app if we
    // don't know yours yet). The first check only records what's there.
    const now = [...new Set(d.providers.stream.map((p) => ottKey(p.name)).filter(Boolean))];
    const before = new Set(String(w.last_providers || "").split(",").filter(Boolean));
    const firstCheck = !notified.has("checked");
    const fresh = now.filter((k) => !before.has(k) && (apps.size === 0 || apps.has(k)));
    if (!firstCheck && fresh.length) {
      const names = fresh.map((k) => SERVICE_NAMES[k] || d.providers.stream.find((p) => ottKey(p.name) === k)?.name || k).join(" & ");
      await send({ title: `📺 ${w.title} is now on ${names}`, body: "Streaming now on an app you use — no ticket needed.", url: `/movies?details=${w.tmdb_id}` });
      sent.push(`now-streaming:${w.title}`);
    }
    notified.add("checked");
    await updateWatchlistMeta(uid, w.id, { releaseDate: rel || null, lastProviders: now.join(","), notified: [...notified].join(",") });
  }
  return sent;
}

// "New film by someone you follow": one alert per film (remembered in
// followed_people.notified), at most one per person per day.
export async function followAlerts(uid, today, send) {
  const out = [];
  for (const f of await listFollows(uid)) {
    const films = await personMovies(f.person_id).catch(() => []);
    const notified = String(f.notified || "").split(",").filter(Boolean);
    const fresh = freshReleases(films, today, notified)[0];
    if (!fresh) continue;
    const when = fresh.releaseDate <= today ? "Out now" : `Releases ${new Date(fresh.releaseDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
    await send({ title: `🎬 New ${f.name} movie: ${fresh.title}`, body: `${when} — tap for details and where to watch.`, url: `/movies?details=${fresh.tmdbId}` });
    await setFollowNotified(uid, f.person_id, [...notified, String(fresh.tmdbId)].slice(-60).join(","));
    out.push(`follow:${f.name}:${fresh.title}`);
  }
  return out;
}
