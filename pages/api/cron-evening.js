// 9 PM IST nudge (#2), run by Vercel Cron (see vercel.json): a reminder if
// nothing was logged today, or a heads-up if today went over the daily
// budget — plus "How was <movie>?" for today's unrated movies.
import * as db from "../../lib/db";
import { sendToUser } from "../../lib/push";
import { isAuthorizedCron, rejectCron } from "../../lib/cronAuth";
import { localDateParts } from "../../lib/dates";
import { mapExpense, mapMovie, mapTopup, movieItems, recurringPending, todayBudget } from "../../lib/ledger";
import { mapAccount, mapTransfer, mapLoan, mapAsset, mainBalance, accountBalance, unusualSpend, netWorth, isCard } from "../../lib/money";
import { mapLife, weeklySummary } from "../../lib/life";
import { mfNav } from "../../lib/freeApis";
import { fmt } from "../../lib/format";

export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    const today = localDateParts().iso;
    const out = {};
    for (const u of await db.listUsers()) {
      try {
        out[u.id] = await runForUser(u.id, today);
      } catch (e) {
        console.error(`[cron-evening] user ${u.id} failed:`, e);
      }
    }
    return res.status(200).json({ ok: true, out });
  } catch (e) {
    console.error("[cron-evening]", e);
    return res.status(500).json({ error: "Failed to run evening check" });
  }
}

async function runForUser(uid, today) {
    const sendToAllDevices = (payload) => sendToUser(uid, payload);
    const [expRows, movieRows, topupRows, recurring, accRows, trRows] = await Promise.all([
      db.listExpenses(uid), db.listMovies(uid), db.listTopups(uid), db.listRecurring(uid), db.listAccounts(uid), db.listTransfers(uid)]);
    const accounts = accRows.map(mapAccount), transfers = trRows.map(mapTransfer);
    const expenses = expRows.map(mapExpense);
    const items = [...expenses, ...movieItems(movieRows.map(mapMovie)), ...recurringPending(recurring, today)];
    const topups = topupRows.map(mapTopup);
    const { balance } = mainBalance(topups, items, transfers, today);
    const cardOwed = accounts.filter((a) => isCard(a) && !a.archived).reduce((s, a) => s + Math.max(0, accountBalance(a, expenses, transfers, today)), 0);
    const b = todayBudget({ items, balance: balance - cardOwed, todayIso: today, hasMoney: topups.length > 0 || transfers.length > 0 });

    let note = null;
    if (!expenses.some((x) => x.date === today)) {
      note = { title: "🧾 Anything to log today?", body: "Nothing logged yet — a 5-second tap keeps your budget honest.", url: "/?quickadd=expense" };
    } else if (b.hasMoney && b.left < 0) {
      const tomorrow = Math.max(0, (b.perDay * b.daysLeft - b.spentToday) / Math.max(1, b.daysLeft - 1));
      note = { title: `💸 ${fmt(-b.left)} over today`, body: `No stress — tomorrow's budget adjusts to about ${fmt(tomorrow)}.`, url: "/" };
    }
    // Nothing else to say? Flag a day far above your usual in a category.
    if (!note) {
      const u = unusualSpend(items, today)[0];
      if (u) note = { title: `👀 ${fmt(u.today)} on ${u.category} today`, body: `That's ${u.times}× your usual ${fmt(u.usual)}. All good? Tap to check today's entries.`, url: "/transactions" };
    }
    const result = note ? await sendToAllDevices(note) : null;

    // Sunday: the week in one line.
    if (new Date(today + "T00:00:00").getDay() === 0) {
      try {
        const [days, habitRows] = await Promise.all([db.listChallengeDays(uid), db.listLife(uid, ["habit_log"])]);
        const sugarDays = {};
        for (const x of days) sugarDays[String(x.day_date instanceof Date ? x.day_date.toISOString() : x.day_date).slice(0, 10)] = x.completed;
        const w = weeklySummary({ items, movies: movieRows.map(mapMovie), sugarDays, habitLogs: habitRows.map(mapLife), todayIso: today });
        if (w.spent > 0 || w.habits || w.sugarFree) await sendToAllDevices({ title: "📊 Your week", body: w.text, url: "/insights" });
      } catch (e) {
        console.error("[cron-evening] weekly summary failed:", e);
      }
    }

    // This month's net-worth point (the trend on /networth), after
    // re-pricing mutual funds from today's NAV.
    try {
      const navs = {};
      for (const code of await db.listFundCodes(uid)) {
        const n = await mfNav(code).catch(() => null);
        if (n?.nav) navs[code] = n.nav;
      }
      if (Object.keys(navs).length) await db.updateFundValues(uid, navs);
      const [loanRows, assetRows, ious] = await Promise.all([db.listLoans(uid), db.listAssets(uid), db.listIous(uid)]);
      const balances = {};
      for (const a of accounts) balances[a.id] = accountBalance(a, expenses, transfers, today);
      if (accounts.length || assetRows.length || loanRows.length) {
        const nw = netWorth({ mainBalance: balance, accounts, balances, assets: assetRows.map(mapAsset), loans: loanRows.map(mapLoan), ious, todayIso: today });
        await db.saveNetWorth(uid, today.slice(0, 7), nw);
      }
    } catch (e) {
      console.error("[cron-evening] net worth snapshot failed:", e);
    }

    // Movies from earlier today that haven't been rated yet (booked ahead, or
    // logged without a take): ask while it's fresh. Shows starting by 6 PM
    // are over by now; later shows get asked the next morning.
    const toRate = movieRows.filter((m) => String(m.watched_date).slice(0, 10) === today && !m.my_take &&
      (!m.watched_time || String(m.watched_time).slice(0, 5) <= "18:00"));
    for (const m of toRate) {
      await sendToAllDevices({ title: `🍿 How was ${m.title}?`, body: "Rate it in ten seconds — and add what you spent on snacks.", url: `/movies?rate=${m.id}` });
    }
    return { sent: note?.title || null, rated: toRate.map((m) => m.title), result };
}
