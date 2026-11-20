// Movie money and fun maths: is each streaming app worth it, cheaper-show
// tips, money saved by waiting for OTT, a yearly goal with badges, your
// taste vs TMDB audiences, and the year-in-movies recap. Pure functions
// (no fetch, no dates from the clock), unit-tested.
import { ottKey, serviceInText, SERVICE_NAMES } from "./movieStats";

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / DAY);
const num = (v) => (typeof v === "number" ? v : parseFloat(v) || 0);
const round = (n) => Math.round(n);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const watchedOnly = (movies, todayIso) => movies.filter((m) => m.date <= todayIso && (m.myTake || m.date < todayIso || m.rating > 0));
const isTheatre = (m) => m.venueType !== "OTT";

// ---- 1. Is each streaming subscription worth it? ----
// Cost: a recurring bill naming the service (monthly), else what you paid
// for it in the last 30 days (a yearly plan, spotted by "year"/"annual" in
// the note, counts as 1/12th). Use: movies streamed on it in the last 30
// days plus series you're watching there.
export function subscriptionValue({ recurring = [], expenses = [], movies = [], tvShows = [], todayIso, nightOut = null }) {
  const cost = {};
  const label = {};
  for (const r of recurring) {
    const k = serviceInText(`${r.note || ""} ${r.category || ""}`);
    if (!k) continue;
    cost[k] = (cost[k] || 0) + num(r.amount);
    label[k] = "a month";
  }
  for (const x of expenses) {
    const k = serviceInText(x.note);
    if (!k || label[k] === "a month") continue;
    const age = daysBetween(x.date, todayIso);
    const yearly = /year|annual|12\s*month/i.test(x.note || "");
    if (age < 0 || age > (yearly ? 365 : 30)) continue;
    cost[k] = (cost[k] || 0) + (yearly ? num(x.amount) / 12 : num(x.amount));
    label[k] = label[k] || (yearly ? "a month (yearly plan)" : "this month");
  }
  return Object.keys(cost).map((k) => {
    const films = movies.filter((m) => m.venueType === "OTT" && ottKey(m.venueName) === k && daysBetween(m.date, todayIso) >= 0 && daysBetween(m.date, todayIso) <= 30)
      .reduce((s, m) => s + (m.quantity || 1), 0);
    const shows = tvShows.filter((t) => ottKey(t.platform) === k && t.status === "watching" && (!t.updated_at || daysBetween(String(t.updated_at).slice(0, 10), todayIso) <= 30)).length;
    const uses = films + shows;
    const monthly = round(cost[k]);
    const perUse = uses ? round(monthly / uses) : null;
    const pricey = Math.max(250, nightOut || 0);
    const verdict = uses === 0 ? "unused" : perUse > pricey ? "pricey" : "good";
    const what = [films && `${films} movie${films > 1 ? "s" : ""}`, shows && `${shows} series`].filter(Boolean).join(" + ");
    const text = verdict === "unused"
      ? `Nothing watched on it in 30 days — pause it and save ₹${monthly.toLocaleString("en-IN")}?`
      : verdict === "pricey"
        ? `${what} = ₹${perUse.toLocaleString("en-IN")} a watch — pricier than a ticket. Pause it for a month?`
        : `${what} = ₹${perUse.toLocaleString("en-IN")} a watch — good value.`;
    return { key: k, name: SERVICE_NAMES[k] || k, monthly, per: label[k], films, shows, uses, perUse, verdict, text };
  }).sort((a, b) => (a.uses === 0 ? -1 : 0) - (b.uses === 0 ? -1 : 0) || (b.perUse || 0) - (a.perUse || 0));
}

// ---- 2. Cheaper-show tips from your own ticket prices ----
// Weekday vs weekend (Fri–Sun), matinee (before 3 PM) vs evening (5 PM on)
// and your cheapest vs priciest theatre — each only with 2+ shows a side
// and a real gap (10%+). "saving" = a year of moving half the pricier shows.
export function showPriceTips(movies, todayIso) {
  const t = movies.filter((m) => isTheatre(m) && m.ticketPrice > 0 && m.date <= todayIso && daysBetween(m.date, todayIso) <= 365);
  const tips = [];
  const compare = (cheapSet, dearSet, make) => {
    if (cheapSet.length < 2 || dearSet.length < 2) return;
    const lo = avg(cheapSet.map((m) => m.ticketPrice));
    const hi = avg(dearSet.map((m) => m.ticketPrice));
    if (hi < lo * 1.1) return;
    const pct = round(((hi - lo) / hi) * 100);
    const saving = round(((hi - lo) * dearSet.length) / 2);
    tips.push({ ...make(round(lo), round(hi), pct), saving });
  };
  const dow = (m) => new Date(m.date + "T00:00:00").getDay();
  const weekend = t.filter((m) => [0, 5, 6].includes(dow(m)));
  const weekday = t.filter((m) => ![0, 5, 6].includes(dow(m)));
  compare(weekday, weekend, (lo, hi, pct) => ({ emoji: "📅", text: `Weekday shows cost you ${pct}% less — ₹${lo} vs ₹${hi} a ticket on Fri–Sun.` }));
  const timed = t.filter((m) => /^\d\d:\d\d/.test(m.time || ""));
  compare(timed.filter((m) => m.time < "15:00"), timed.filter((m) => m.time >= "17:00"), (lo, hi, pct) => ({ emoji: "☀️", text: `Matinees cost you ${pct}% less — ₹${lo} vs ₹${hi} for evening shows.` }));
  const byTheatre = {};
  for (const m of t) if (m.venueName) (byTheatre[m.venueName] = byTheatre[m.venueName] || []).push(m);
  const ranked = Object.entries(byTheatre).filter(([, ms]) => ms.length >= 2).map(([name, ms]) => ({ name, ms, avg: avg(ms.map((m) => m.ticketPrice)) })).sort((a, b) => a.avg - b.avg);
  if (ranked.length >= 2) {
    const cheap = ranked[0], dear = ranked[ranked.length - 1];
    compare(cheap.ms, dear.ms, (lo, hi) => ({ emoji: "🏟️", text: `${dear.name} averages ₹${hi} a ticket; ${cheap.name} ₹${lo}.` }));
  }
  return tips.sort((a, b) => b.saving - a.saving);
}

// ---- 3. Saved by waiting for streaming ----
// A movie you streamed within 4 months of its release was a theatre film
// you chose to wait for: that's one night out (your average) not spent.
export function savedByWaiting({ movies = [], meta = {}, nightOut, todayIso }) {
  if (!nightOut) return null;
  const waited = movies.filter((m) => {
    if (m.venueType !== "OTT" || !m.tmdbId || m.date > todayIso) return false;
    const rel = meta[m.tmdbId]?.releaseDate;
    if (!rel) return false;
    const gap = daysBetween(rel, m.date);
    return gap >= 7 && gap <= 120;
  });
  if (!waited.length) return null;
  const year = todayIso.slice(0, 4);
  const thisYear = waited.filter((m) => m.date.startsWith(year));
  return {
    count: waited.length,
    saved: waited.length * nightOut,
    savedThisYear: thisYear.length * nightOut,
    countThisYear: thisYear.length,
    titles: waited.slice(-3).map((m) => m.title),
  };
}

// ---- 7. Your year in movies ----
export function yearRecap({ movies = [], meta = {}, year, todayIso }) {
  const ms = watchedOnly(movies, todayIso).filter((m) => m.date.startsWith(String(year)));
  if (!ms.length) return null;
  const viewings = ms.reduce((s, m) => s + (m.quantity || 1), 0);
  const titles = new Set(ms.map((m) => m.title.toLowerCase())).size;
  const minutes = ms.reduce((s, m) => s + (meta[m.tmdbId]?.runtime || 0) * (m.quantity || 1), 0);
  const spend = ms.reduce((s, m) => s + ((m.ticketPrice || 0) + (m.canteenPrice || 0)) * (m.quantity || 1), 0);
  const count = (key) => {
    const c = {};
    for (const m of ms) { const k = key(m); if (k) c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  };
  const top = [...ms].filter((m) => m.rating > 0).sort((a, b) => b.rating - a.rating || b.date.localeCompare(a.date))[0] || null;
  return {
    year: String(year), viewings, titles,
    hours: round(minutes / 60),
    spend: round(spend),
    theatre: ms.filter(isTheatre).reduce((s, m) => s + (m.quantity || 1), 0),
    streamed: ms.filter((m) => !isTheatre(m)).reduce((s, m) => s + (m.quantity || 1), 0),
    topLanguage: count((m) => meta[m.tmdbId]?.language)?.[0] || null,
    favTheatre: count((m) => (isTheatre(m) ? m.venueName : ""))?.[0] || null,
    topRated: top ? { title: top.title, rating: top.rating } : null,
    topCompanion: count((m) => String(m.companions || "").split(/[,&]| and /i)[0].trim())?.[0] || null,
  };
}

// ---- 8. Yearly goal, streak and badges ----
export function movieGoal({ movies = [], meta = {}, goal, todayIso }) {
  const all = watchedOnly(movies, todayIso);
  const year = todayIso.slice(0, 4);
  const done = all.filter((m) => m.date.startsWith(year)).reduce((s, m) => s + (m.quantity || 1), 0);
  const dayOfYear = daysBetween(`${year}-01-01`, todayIso) + 1;
  const daysInYear = daysBetween(`${year}-01-01`, `${Number(year) + 1}-01-01`);
  const expected = goal ? Math.floor((goal * dayOfYear) / daysInYear) : 0;

  // Months in a row with at least one movie, ending this month (or last
  // month, so the streak isn't "lost" on the 1st).
  const months = new Set(all.map((m) => m.date.slice(0, 7)));
  const ym = (d) => d.toISOString().slice(0, 7);
  const cursor = new Date(todayIso.slice(0, 7) + "-15T00:00:00Z");
  if (!months.has(ym(cursor))) cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  let streak = 0;
  while (months.has(ym(cursor))) { streak++; cursor.setUTCMonth(cursor.getUTCMonth() - 1); }

  const theatres = new Set(all.filter((m) => isTheatre(m) && m.venueName && m.venueName !== "Other").map((m) => m.venueName.toLowerCase())).size;
  const langs = new Set(all.map((m) => meta[m.tmdbId]?.language).filter(Boolean)).size;
  const fdfs = all.filter((m) => isTheatre(m) && m.tmdbId && meta[m.tmdbId]?.releaseDate === m.date).length;
  const rated = all.filter((m) => m.rating > 0).length;
  const total = all.reduce((s, m) => s + (m.quantity || 1), 0);
  const B = (id, emoji, title, desc, have, need) => ({ id, emoji, title, desc, have: Math.min(have, need), need, earned: have >= need });
  const badges = [
    B("hopper", "🏟️", "Theatre hopper", "Watch at 5 different theatres", theatres, 5),
    B("polyglot", "🌏", "Polyglot", "Movies in 3 languages", langs, 3),
    B("regular", "🔥", "Regular", "A movie every month for 3 months", streak, 3),
    B("fdfs", "🎟️", "First day, first show", "Catch a movie on release day", fdfs, 1),
    B("critic", "⭐", "Critic", "Rate 20 movies", rated, 20),
    B("fifty", "🎬", "Half century", "50 movies logged", total, 50),
  ];
  return {
    year, done, goal: goal || null, expected,
    pct: goal ? Math.min(100, round((done / goal) * 100)) : null,
    pace: !goal ? null : done >= goal ? "done" : done >= expected ? "ahead" : "behind",
    behindBy: goal ? Math.max(0, expected - done) : 0,
    streak, badges,
  };
}

// ---- 9. Your taste vs TMDB audiences ----
// Your stars (×2) against TMDB's /10 score. Positive = you like it more.
export function tasteVsCrowd({ movies = [], meta = {} }) {
  const pairs = [];
  const seen = new Set();
  for (const m of movies) {
    const d = m.tmdbId && meta[m.tmdbId];
    if (!d || d.rating == null || !(m.rating > 0) || seen.has(m.tmdbId)) continue;
    seen.add(m.tmdbId);
    pairs.push({ title: m.title, diff: m.rating * 2 - d.rating, language: d.language || "", genre: m.genre || (d.genres || [])[0] || "", mine: m.rating, crowd: d.rating });
  }
  if (pairs.length < 3) return null;
  const stars = (x) => Math.round((x / 2) * 10) / 10;
  const overall = stars(avg(pairs.map((p) => p.diff)));
  const groups = [];
  for (const key of ["language", "genre"]) {
    const by = {};
    for (const p of pairs) if (p[key]) (by[p[key]] = by[p[key]] || []).push(p.diff);
    for (const [name, ds] of Object.entries(by)) {
      if (ds.length < 2) continue;
      const s = stars(avg(ds));
      if (Math.abs(s) >= 0.5) groups.push({ name, kind: key, stars: s, count: ds.length });
    }
  }
  groups.sort((a, b) => Math.abs(b.stars) - Math.abs(a.stars));
  const lines = groups.slice(0, 3).map((g) => `You rate ${g.name}${g.kind === "genre" ? " movies" : " films"} ${Math.abs(g.stars)}★ ${g.stars > 0 ? "higher" : "lower"} than TMDB audiences (${g.count} movies).`);
  const split = [...pairs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  return {
    count: pairs.length,
    overall,
    summary: Math.abs(overall) < 0.3 ? "You're in tune with the crowd." : overall > 0 ? `You're a generous rater — ${overall}★ above the crowd on average.` : `You're a tough critic — ${Math.abs(overall)}★ below the crowd on average.`,
    lines,
    biggest: Math.abs(split.diff) >= 3 ? { title: split.title, mine: split.mine, crowd: split.crowd, crowdStars: stars(split.crowd) } : null,
  };
}

// ---- 4. "What tonight?" filters for the picker ----
export function pickPool({ watchlist = [], info = {}, userApps = new Set(), onMyApps = false, maxMinutes = 0, language = "" }) {
  return watchlist.filter((w) => {
    const i = info[w.id] || {};
    if (onMyApps && !(i.stream || []).some((p) => userApps.has(ottKey(p.name)))) return false;
    if (maxMinutes && !(i.runtime > 0 && i.runtime <= maxMinutes)) return false;
    if (language && i.language !== language) return false;
    return true;
  });
}
