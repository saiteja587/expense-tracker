// More movie maths: "tonight" filters, cheapest way to watch, snacks, theatre
// pass value, heatmap, people you rate, rewatches and "on this day", the
// ranking game (Elo), the quiz, taste match, and Letterboxd / IMDb imports.
// Pure functions, unit-tested (tests/movie-lab.test.js).
import { ottKey, onYourApps } from "./movieStats";

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / DAY);
const addDays = (iso, n) => new Date(new Date(iso + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);
const weekday = (iso) => (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round1 = (n) => Math.round(n * 10) / 10;
const key = (t) => String(t || "").trim().toLowerCase();
const isTheatre = (m) => m.venueType !== "OTT";
const qty = (m) => m.quantity || 1;
const seen = (movies, todayIso) => movies.filter((m) => m.date <= todayIso && (m.date < todayIso || m.myTake || m.rating > 0));

// How much you liked something, 1–5: your stars, else your take.
const TAKE_STARS = { loved: 5, liked: 4, okay: 3, disliked: 2 };
export const starsOf = (m) => (m.rating > 0 ? m.rating : TAKE_STARS[m.myTake] || 0);

// ---- Tonight -------------------------------------------------------------------
export const MOODS = {
  any: { label: "Anything", emoji: "🎲", ids: "", names: [] },
  laugh: { label: "Laugh", emoji: "😂", ids: "35", names: ["Comedy"] },
  thrill: { label: "Thrill", emoji: "😱", ids: "53|80|9648", names: ["Thriller", "Crime", "Mystery"] },
  action: { label: "Action", emoji: "💥", ids: "28|12", names: ["Action", "Adventure"] },
  feel: { label: "Feel-good", emoji: "🥰", ids: "10749|10751|35", names: ["Romance", "Family", "Comedy"] },
  drama: { label: "Emotional", emoji: "😢", ids: "18", names: ["Drama"] },
  mind: { label: "Mind-bending", emoji: "🤯", ids: "878|9648", names: ["Science Fiction", "Mystery"] },
  scary: { label: "Scary", emoji: "👻", ids: "27", names: ["Horror"] },
};
export const COMPANY = {
  solo: { label: "Just me", emoji: "🧍", avoid: [], likes: [] },
  couple: { label: "Partner", emoji: "💑", avoid: [], likes: ["Romance", "Comedy", "Drama"] },
  family: { label: "Family", emoji: "👨‍👩‍👧", avoid: ["Horror", "Thriller", "Crime", "War"], likes: ["Family", "Animation", "Adventure", "Comedy"] },
  friends: { label: "Friends", emoji: "🍻", avoid: [], likes: ["Action", "Comedy", "Thriller"] },
};
// TMDB's streaming-service ids. A wrong id can't mislead anyone: every pick
// is checked against its own "where to watch" before it is shown.
export const PROVIDER_IDS = { netflix: [8], prime: [119], hotstar: [2336, 122], sonyliv: [237], zee5: [232], appletv: [350], aha: [532], sunnxt: [309], mubi: [11], lionsgate: [561] };

// Best films for tonight. films: TMDB details (+ saved: on your watchlist).
export function pickTonight({ films = [], apps = new Set(), mood = "any", maxMinutes = 0, company = "solo", seenIds = new Set(), count = 3 }) {
  const want = (MOODS[mood] || MOODS.any).names;
  const who = COMPANY[company] || COMPANY.solo;
  const out = [];
  const used = new Set();
  for (const f of films) {
    if (!f || used.has(f.tmdbId) || seenIds.has(f.tmdbId)) continue;
    const genres = f.genres || [];
    const on = onYourApps(f.providers, apps);
    if (!on.length) continue;
    if (want.length && !genres.some((g) => want.includes(g))) continue;
    if (genres.some((g) => who.avoid.includes(g))) continue;
    if (maxMinutes && !(f.runtime > 0 && f.runtime <= maxMinutes)) continue;
    used.add(f.tmdbId);
    const score = (f.rating || 6) + (f.saved ? 1.5 : 0) + genres.filter((g) => who.likes.includes(g)).length * 0.3;
    out.push({ ...f, on: on.map((p) => p.name), score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, count);
}

// ---- Cheapest way to watch -------------------------------------------------------
// prices: [{ name: "Prime Video", rent, buy }] — what you noted per service.
// nightOut: what one theatre visit usually costs you per head.
export function cheapestWay({ providers, apps = new Set(), prices = [], nightOut = null, inTheatres = false, people = 1 }) {
  if (!providers) return [];
  const opts = [];
  for (const p of onYourApps(providers, apps)) opts.push({ how: `Stream on ${p.name}`, cost: 0, note: "you already have it" });
  for (const p of providers.free || []) opts.push({ how: `Free on ${p.name}`, cost: 0, note: "may have ads" });
  const priceOf = (name, what) => prices.find((x) => ottKey(x.name) === ottKey(name))?.[what] || null;
  for (const [what, list] of [["rent", providers.rent], ["buy", providers.buy]]) {
    for (const p of list || []) opts.push({ how: `${what === "rent" ? "Rent" : "Buy"} on ${p.name}`, cost: priceOf(p.name, what), service: p.name, what });
  }
  if (inTheatres) opts.push({ how: people > 1 ? `Theatre for ${people}` : "Theatre", cost: nightOut ? Math.round(nightOut * people) : null, note: nightOut ? "your usual night out" : "" });
  const uniq = opts.filter((o, i) => opts.findIndex((x) => x.how === o.how) === i);
  return uniq.sort((a, b) => (a.cost == null) - (b.cost == null) || (a.cost || 0) - (b.cost || 0));
}

// ---- Snacks vs tickets -------------------------------------------------------------
export function snackStats(movies, todayIso) {
  const t = seen(movies, todayIso).filter((m) => isTheatre(m) && (m.ticketPrice > 0 || m.canteenPrice > 0));
  if (!t.length) return null;
  const sum = (xs, k) => xs.reduce((s, m) => s + (m[k] || 0) * qty(m), 0);
  const visitsOf = (xs) => xs.reduce((s, m) => s + qty(m), 0);
  const tickets = sum(t, "ticketPrice"), snacks = sum(t, "canteenPrice");
  const by = {}, months = {};
  for (const m of t) {
    const v = m.venueName || "Other";
    (by[v] = by[v] || []).push(m);
    const k = m.date.slice(0, 7);
    const mo = (months[k] = months[k] || { ym: k, tickets: 0, snacks: 0 });
    mo.tickets += (m.ticketPrice || 0) * qty(m);
    mo.snacks += (m.canteenPrice || 0) * qty(m);
  }
  const theatres = Object.entries(by).map(([name, ms]) => ({ name, visits: visitsOf(ms), perVisit: Math.round(sum(ms, "canteenPrice") / visitsOf(ms)) }))
    .filter((x) => x.perVisit > 0).sort((a, b) => b.perVisit - a.perVisit);
  return {
    tickets: Math.round(tickets), snacks: Math.round(snacks), pct: tickets + snacks ? Math.round((snacks / (tickets + snacks)) * 100) : 0,
    yearSnacks: Math.round(sum(t.filter((m) => daysBetween(m.date, todayIso) <= 365), "canteenPrice")),
    theatres: theatres.slice(0, 4),
    months: Object.values(months).sort((a, b) => a.ym.localeCompare(b.ym)).slice(-6),
  };
}

// ---- Would a theatre pass pay off? ----------------------------------------------
// pass: { price, tickets } a month; weekdaysOnly: covers Mon–Thu only.
export function passValue({ movies = [], pass, todayIso, months = 6 }) {
  if (!(pass?.price > 0) || !(pass?.tickets > 0)) return null;
  const from = addDays(todayIso, -Math.round(months * 30.4));
  const t = seen(movies, todayIso).filter((m) => isTheatre(m) && m.ticketPrice > 0 && m.date > from);
  const covered = t.filter((m) => !pass.weekdaysOnly || weekday(m.date) <= 3);
  const byMonth = {};
  for (const m of covered) (byMonth[m.date.slice(0, 7)] = byMonth[m.date.slice(0, 7)] || []).push(...Array(qty(m)).fill(m.ticketPrice));
  const would = Object.values(byMonth).reduce((s, ps) => s + ps.sort((a, b) => b - a).slice(0, pass.tickets).reduce((x, p) => x + p, 0), 0);
  const visits = covered.reduce((s, m) => s + qty(m), 0);
  const cost = pass.price * months;
  const avgTicket = avg(covered.map((m) => m.ticketPrice));
  return {
    visits, months, would: Math.round(would), cost: Math.round(cost), saving: Math.round(would - cost), worth: would > cost,
    breakEven: avgTicket ? Math.ceil(pass.price / avgTicket) : null, perMonth: round1(visits / months),
  };
}

// ---- Watch heatmap: one square a day for a year ------------------------------------
export function heatmap(movies, year, todayIso) {
  const counts = {};
  for (const m of seen(movies, todayIso)) if (m.date.startsWith(String(year))) counts[m.date] = (counts[m.date] || 0) + 1;
  const start = `${year}-01-01`;
  const n = daysBetween(start, `${Number(year) + 1}-01-01`);
  const cells = [...Array(weekday(start)).fill(null), ...Array.from({ length: n }, (_, i) => { const d = addDays(start, i); return { date: d, n: counts[d] || 0, future: d > todayIso }; })];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => ({ name, n: 0 }));
  const months = {};
  for (const [d, c] of Object.entries(counts)) {
    days[weekday(d)].n += c;
    months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + c;
  }
  const top = [...days].sort((a, b) => b.n - a.n)[0];
  const topMonth = Object.entries(months).sort((a, b) => b[1] - a[1])[0] || null;
  return { weeks, days, total: Object.values(counts).reduce((s, c) => s + c, 0), topDay: top.n ? top.name : null, topMonth: topMonth ? { ym: topMonth[0], n: topMonth[1] } : null };
}

// ---- Directors & actors: who you watch most, who you rate highest -----------------
export function peopleStats(movies, meta = {}, todayIso = "9999-12-31") {
  const films = new Map(); // one entry per film: rewatches don't count twice
  for (const m of seen(movies, todayIso)) {
    if (!m.tmdbId || !meta[m.tmdbId]) continue;
    const was = films.get(m.tmdbId);
    if (!was || starsOf(m) > starsOf(was)) films.set(m.tmdbId, m);
  }
  const build = (get) => {
    const by = {};
    for (const [id, m] of films) {
      for (const name of get(meta[id])) {
        const p = (by[name] = by[name] || { films: [], stars: [] });
        p.films.push(m.title);
        if (starsOf(m)) p.stars.push(starsOf(m));
      }
    }
    const all = Object.entries(by).map(([name, p]) => ({ name, count: p.films.length, films: p.films, rated: p.stars.length, avg: p.stars.length ? round1(avg(p.stars)) : null })).filter((p) => p.count > 1);
    return {
      most: [...all].sort((a, b) => b.count - a.count || (b.avg || 0) - (a.avg || 0)).slice(0, 5),
      best: all.filter((p) => p.rated > 1).sort((a, b) => b.avg - a.avg || b.count - a.count).slice(0, 5),
    };
  };
  return { directors: build((d) => d.directors || []), actors: build((d) => (d.cast || []).slice(0, 4)) };
}

// ---- Rewatches and "on this day" -----------------------------------------------------
export function rewatches(movies, todayIso) {
  const by = new Map();
  for (const m of seen(movies, todayIso)) {
    const k = m.tmdbId ? `#${m.tmdbId}` : key(m.title);
    const x = by.get(k) || { title: m.title, times: 0, dates: [] };
    x.times += qty(m);
    x.dates.push(m.date);
    by.set(k, x);
  }
  return [...by.values()].filter((x) => x.times > 1).map((x) => ({ ...x, dates: x.dates.sort() })).sort((a, b) => b.times - a.times || a.title.localeCompare(b.title));
}
export function onThisDay(movies, todayIso) {
  const year = Number(todayIso.slice(0, 4));
  return movies.filter((m) => m.date.slice(5) === todayIso.slice(5) && m.date < todayIso)
    .map((m) => ({ ...m, yearsAgo: year - Number(m.date.slice(0, 4)) })).sort((a, b) => a.yearsAgo - b.yearsAgo);
}

// ---- Ranking game -----------------------------------------------------------------------
// duels in the order they were played: [{ winner, loser }] (titles). Ratings
// start from your stars, so a few rounds already give a sensible list.
export function rankFilms(movies, duels = [], todayIso = "9999-12-31") {
  const films = new Map();
  for (const m of seen(movies, todayIso)) {
    const f = films.get(key(m.title)) || { title: m.title, stars: 0, played: 0 };
    f.stars = Math.max(f.stars, starsOf(m));
    films.set(key(m.title), f);
  }
  for (const f of films.values()) f.elo = 1500 + (f.stars ? (f.stars - 3) * 60 : 0);
  for (const d of duels) {
    const w = films.get(key(d.winner)), l = films.get(key(d.loser));
    if (!w || !l || w === l) continue;
    const gain = 32 * (1 - 1 / (1 + 10 ** ((l.elo - w.elo) / 400)));
    w.elo += gain; l.elo -= gain; w.played++; l.played++;
  }
  return [...films.values()].sort((a, b) => b.elo - a.elo || a.title.localeCompare(b.title));
}
// The next pair: a least-played film against a near neighbour it hasn't met.
export function nextDuel(ranked, duels = [], rand = Math.random) {
  if (ranked.length < 2) return null;
  const pair = (a, b) => [key(a), key(b)].sort().join("|");
  const met = new Set(duels.map((d) => pair(d.winner, d.loser)));
  const low = Math.min(...ranked.map((f) => f.played));
  const pool = ranked.filter((f) => f.played === low);
  const a = pool[Math.floor(rand() * pool.length)];
  const others = ranked.filter((f) => f !== a).sort((x, y) => Math.abs(x.elo - a.elo) - Math.abs(y.elo - a.elo));
  const fresh = others.filter((f) => !met.has(pair(a.title, f.title)));
  const near = (fresh.length ? fresh : others).slice(0, 4);
  const b = near[Math.floor(rand() * near.length)];
  return rand() < 0.5 ? [a, b] : [b, a];
}

// ---- Quiz ----------------------------------------------------------------------------------
function shuffle(xs, rand) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function makeQuiz(movies, meta = {}, { count = 8, rand = Math.random, todayIso = "9999-12-31" } = {}) {
  const films = [...new Map(seen(movies, todayIso).filter((m) => m.tmdbId && meta[m.tmdbId]).map((m) => [m.tmdbId, { m, d: meta[m.tmdbId] }])).values()];
  if (films.length < 4) return [];
  // Theatres with more than one visit to the film would have two right answers.
  const times = {};
  for (const m of movies) times[m.tmdbId] = (times[m.tmdbId] || 0) + 1;
  const ask = (text, answer, wrong, film) => {
    const opts = [...new Set(wrong.filter((x) => x && x !== answer))];
    if (!answer || opts.length < 3) return null;
    return { text, answer, options: shuffle([answer, ...shuffle(opts, rand).slice(0, 3)], rand), film: film.m.title };
  };
  const kinds = [
    (f) => ask(`Who directed ${f.m.title}?`, f.d.directors?.[0], films.flatMap((x) => x.d.directors || []).filter((n) => !(f.d.directors || []).includes(n)), f),
    (f) => (f.d.cast?.[0] ? ask(`Which of these has ${f.d.cast[0]} in it?`, f.m.title, films.filter((x) => !(x.d.cast || []).includes(f.d.cast[0])).map((x) => x.m.title), f) : null),
    (f) => { const y = Number((f.d.releaseDate || "").slice(0, 4)); return y ? ask(`When did ${f.m.title} release?`, String(y), [y - 1, y + 1, y - 3, y + 2, y - 2].map(String), f) : null; },
    (f) => (f.m.venueName && isTheatre(f.m) && times[f.m.tmdbId] === 1 ? ask(`Where did you watch ${f.m.title}?`, f.m.venueName, films.map((x) => x.m.venueName), f) : null),
    (f) => (f.m.rating > 0 && times[f.m.tmdbId] === 1 ? ask(`How many stars did you give ${f.m.title}?`, `${f.m.rating}★`, [1, 2, 3, 4, 5].map((n) => `${n}★`), f) : null),
  ];
  const out = [];
  const perFilm = {};
  for (const [f, make] of shuffle(films.flatMap((f) => kinds.map((k) => [f, k])), rand)) {
    if (out.length >= count) break;
    if ((perFilm[f.m.title] || 0) >= 2) continue;
    const q = make(f);
    if (q) { out.push(q); perFilm[f.m.title] = (perFilm[f.m.title] || 0) + 1; }
  }
  return out;
}

// ---- Taste match -----------------------------------------------------------------------------
// pairs: films you both rated [{ title, mine, theirs }] (1–5 each).
export function tasteMatch(pairs) {
  if (!pairs.length) return null;
  const gap = (p) => Math.abs(p.mine - p.theirs);
  const big = [...pairs].sort((a, b) => gap(b) - gap(a))[0];
  return {
    count: pairs.length, pct: Math.round((1 - avg(pairs.map(gap)) / 4) * 100), enough: pairs.length >= 3,
    both: pairs.filter((p) => p.mine >= 4 && p.theirs >= 4).map((p) => p.title).slice(0, 5),
    clash: gap(big) >= 2 ? big : null,
  };
}

// ---- Monthly budget check before a booking ---------------------------------------------------
export function bookingOverBudget({ movies = [], budget, date, cost, ignoreId = null }) {
  if (!(budget > 0) || !(cost > 0) || !date) return null;
  const spent = movies.filter((m) => m.id !== ignoreId && m.date.slice(0, 7) === date.slice(0, 7)).reduce((s, m) => s + ((m.ticketPrice || 0) + (m.canteenPrice || 0)) * qty(m), 0);
  const after = spent + cost;
  return after > budget ? { spent: Math.round(spent), after: Math.round(after), over: Math.round(after - budget) } : null;
}

// ---- Letterboxd / IMDb CSV ---------------------------------------------------------------------
// A full CSV reader (reviews can contain commas, quotes and new lines).
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  const endRow = () => { row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; endRow(); }
    else cur += c;
  }
  endRow();
  return rows;
}
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const year4 = (v) => (/^\d{4}$/.test(v) ? v : "");
const clampStars = (n) => (n > 0 ? Math.min(5, Math.max(1, Math.round(n))) : null);

// → { source, kind: "watched" | "watchlist", exactDates, items, skipped }
export function parseMovieCsv(text, fileName = "") {
  const rows = parseCsv(text);
  const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
  const has = (name) => head.includes(name);
  const get = (r, name) => (has(name) ? (r[head.indexOf(name)] || "").trim() : "");
  const body = rows.slice(1);
  if (has("const") && has("title")) {
    // IMDb ratings or watchlist export; only ratings have "Your Rating" filled in.
    const ratings = /watchlist/i.test(fileName) ? [] : body.filter((r) => get(r, "your rating"));
    const films = (ratings.length ? ratings : body).filter((r) => !get(r, "title type") || /movie|short|video/i.test(get(r, "title type")));
    const items = films.map((r) => ({ title: get(r, "title"), year: year4(get(r, "year")), date: isoDate(get(r, "date rated") || get(r, "created")), rating: clampStars(Number(get(r, "your rating")) / 2) })).filter((x) => x.title);
    return { source: "imdb", kind: ratings.length ? "watched" : "watchlist", exactDates: false, items, skipped: body.length - items.length };
  }
  if (has("name") && has("letterboxd uri")) {
    const diary = has("watched date");
    // watched.csv and watchlist.csv have the same columns: only the name tells them apart.
    const watchlist = !diary && !has("rating") && /watchlist/i.test(fileName);
    const items = body.map((r) => ({ title: get(r, "name"), year: year4(get(r, "year")), date: isoDate(get(r, "watched date") || get(r, "date")), rating: clampStars(Number(get(r, "rating"))), review: get(r, "review").slice(0, 280) })).filter((x) => x.title);
    return { source: "letterboxd", kind: watchlist ? "watchlist" : "watched", exactDates: diary, items, skipped: body.length - items.length };
  }
  throw new Error("That doesn't look like a Letterboxd or IMDb export.");
}
