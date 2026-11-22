import { listUsers, listMovies, listRecurring, listExpenses, listChallengeDays, saveBackup, getBillsPaid, listWatchlist, updateWatchlistMeta, listFollows, setFollowNotified } from "../../lib/db";
import { hasTmdb, movieDetails, personMovies, freshReleases } from "../../lib/tmdb";
import { ottKey, userOttApps, SERVICE_NAMES } from "../../lib/movieStats";
import { mapExpense, mapMovie } from "../../lib/ledger";
import { mapAccount, mapTransfer, cardCycle, isCard } from "../../lib/money";
import { listAccounts, listTransfers, listLifeForReminders, markLifeNotified } from "../../lib/db";
import { mapLife, dueStatus, warrantyEnds, nextOccurrence, vehicleStats, REMIND_RENEWAL, REMIND_WARRANTY } from "../../lib/life";
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

    // Credit-card bills: 3 days before, the day before, and the day after if
    // still unpaid.
    try {
      const [accRows, trRows, expRows] = await Promise.all([listAccounts(uid), listTransfers(uid), listExpenses(uid)]);
      const exps = expRows.map(mapExpense), transfers = trRows.map(mapTransfer);
      for (const card of accRows.map(mapAccount).filter((a) => isCard(a) && !a.archived)) {
        const cy = cardCycle(card, exps, transfers, today);
        if (!cy.hasCycle || cy.billedDue <= 0 || ![3, 1, -1].includes(cy.daysToDue)) continue;
        const amount = "₹" + Math.round(cy.billedDue).toLocaleString("en-IN");
        await sendToAllDevices(cy.daysToDue < 0
          ? { title: `⚠️ ${card.name} bill overdue`, body: `${amount} was due yesterday. Pay today to keep late fees and interest small.`, url: "/accounts" }
          : { title: `💳 ${card.name}: ${amount} due ${cy.daysToDue === 1 ? "tomorrow" : "in 3 days"}`, body: "Tap to pay and mark it paid.", url: "/accounts" });
        sentItems.push(`card:${card.name}`);
      }
    } catch (e) {
      console.error("[cron-daily] card reminders failed:", e);
    }

    // Renewals, warranties, birthdays, service due, lent items. Each item
    // remembers the last reminder it sent (notified), so a re-run that day
    // doesn't send it twice.
    try {
      const rows = await listLifeForReminders(uid);
      const items = rows.map((r) => ({ ...mapLife(r), notified: r.notified }));
      const once = async (item, tag, payload) => {
        if (item.notified === tag) return;
        await sendToAllDevices(payload);
        await markLifeNotified(item.id, tag);
        sentItems.push(`${item.kind}:${tag}`);
      };
      const inDays = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
      for (const r of items.filter((x) => x.kind === "renewal" && x.date)) {
        const st = dueStatus(r.date, today);
        if (REMIND_RENEWAL.includes(st.daysLeft)) {
          await once(r, `${r.date}|${st.daysLeft}`, { title: `📅 ${r.name} ${st.daysLeft === 0 ? "expires today" : `due ${inDays(st.daysLeft)}`}`, body: r.amount ? `About ₹${Math.round(r.amount).toLocaleString("en-IN")}. Tap to mark it renewed.` : "Tap to mark it renewed.", url: "/renewals" });
        }
      }
      for (const w of items.filter((x) => x.kind === "warranty")) {
        const ends = warrantyEnds(w);
        const st = dueStatus(ends, today);
        if (ends && REMIND_WARRANTY.includes(st.daysLeft)) {
          await once(w, `${ends}|${st.daysLeft}`, { title: `🧾 ${w.name}: warranty ends ${inDays(st.daysLeft)}`, body: "Anything not working right? Get it checked while it's free.", url: "/renewals" });
        }
      }
      for (const o of items.filter((x) => x.kind === "occasion")) {
        const nx = nextOccurrence(o, today);
        const what = o.type === "anniversary" ? "anniversary" : o.type === "birthday" ? "birthday" : "day";
        if (nx.daysLeft === 7) await once(o, `${nx.date}|7`, { title: `🎁 ${o.person}'s ${what} in a week`, body: o.budget ? `Gift budget ₹${Math.round(o.budget).toLocaleString("en-IN")}. See what you gave last time.` : "Time to plan something. See what you gave last time.", url: "/people" });
        if (nx.daysLeft === 0) await once(o, `${nx.date}|0`, { title: `🎉 It's ${o.person}'s ${what} today`, body: "Tap to send wishes.", url: "/people" });
      }
      const fuel = items.filter((x) => x.kind === "fuel");
      for (const v of items.filter((x) => x.kind === "vehicle" && x.serviceEveryKm > 0)) {
        const st = vehicleStats(v, fuel);
        if (st.kmToService != null && st.kmToService <= 200) await once(v, `service|${st.nextServiceKm}`, { title: `🔧 ${v.name} service due`, body: st.kmToService <= 0 ? "You've passed the service kilometres." : `About ${st.kmToService} km to go.`, url: "/vehicles" });
      }
      if (new Date(today + "T00:00:00").getDay() === 0) {
        const old = items.filter((x) => x.kind === "lent" && !x.returned && x.date && dueStatus(x.date, today).daysLeft <= -30);
        if (old.length) {
          const first = old[0];
          await once(first, `lent|${today}`, { title: `📦 ${old.length === 1 ? `${first.person} still has your ${first.item}` : `${old.length} things you lent aren't back yet`}`, body: "It's been over a month. A gentle reminder?", url: "/people" });
        }
      }
    } catch (e) {
      console.error("[cron-daily] life reminders failed:", e);
    }

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
