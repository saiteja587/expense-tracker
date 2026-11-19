// Movie maths built on TMDB data: which streaming apps you use, what's
// available on them, hours/cost-per-hour/favourite people/language stats,
// franchise progress, and "theatre or wait for OTT?". Pure functions (no
// fetch), used by pages and the daily cron, and unit-tested.

// One key per streaming service, whatever the spelling: "Disney+ Hotstar",
// "JioHotstar" and "Disney Plus Hotstar" are all "hotstar".
const SERVICES = [
  ["netflix", "netflix"], ["primevideo", "prime"], ["amazonprime", "prime"], ["prime", "prime"],
  ["hotstar", "hotstar"], ["jiocinema", "hotstar"], ["sonyliv", "sonyliv"], ["zee5", "zee5"],
  ["appletv", "appletv"], ["mxplayer", "mxplayer"], ["aha", "aha"], ["sunnxt", "sunnxt"],
  ["youtube", "youtube"], ["lionsgate", "lionsgate"], ["mubi", "mubi"], ["erosnow", "erosnow"],
];
export const SERVICE_NAMES = { netflix: "Netflix", prime: "Prime Video", hotstar: "JioHotstar", sonyliv: "SonyLIV", zee5: "ZEE5", appletv: "Apple TV+", mxplayer: "MX Player", aha: "aha", sunnxt: "Sun NXT", youtube: "YouTube", lionsgate: "Lionsgate Play", mubi: "MUBI", erosnow: "Eros Now" };

// Language name (as shown) → TMDB language code, for "New in Telugu".
export const LANGUAGE_CODES = { Telugu: "te", Tamil: "ta", Hindi: "hi", Malayalam: "ml", Kannada: "kn", English: "en", Bengali: "bn", Marathi: "mr", Korean: "ko", Japanese: "ja", Punjabi: "pa", Gujarati: "gu" };

export function ottKey(name) {
  const n = String(name || "").toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
  if (!n) return "";
  const hit = SERVICES.find(([token]) => n.includes(token));
  return hit ? hit[1] : n;
}
// A note like "Netflix", "Prime renewal" or "Hotstar yearly" → service key.
function serviceInText(text) {
  const n = String(text || "").toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
  const hit = SERVICES.find(([token]) => token.length > 3 && n.includes(token));
  return hit ? hit[1] : "";
}

const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

// Streaming apps you use: ones you've watched movies on recently, plus ones
// you pay for (spotted in your expense notes).
export function userOttApps({ movies = [], expenses = [], todayIso }) {
  const apps = new Set();
  for (const m of movies) {
    if (m.venueType === "OTT" && m.venueName && daysBetween(m.date, todayIso) <= 180) {
      const k = ottKey(m.venueName);
      if (k) apps.add(k);
    }
  }
  for (const x of expenses) {
    if (daysBetween(x.date, todayIso) > 75) continue;
    const k = serviceInText(x.note);
    if (k) apps.add(k);
  }
  return apps;
}

// Which of a movie's streaming providers you already have.
export function onYourApps(providers, apps) {
  const out = [];
  for (const p of providers?.stream || []) {
    const k = ottKey(p.name);
    if (apps.has(k) && !out.some((x) => ottKey(x.name) === k)) out.push(p);
  }
  return out;
}

const top = (counts, n = 3) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, count]) => ({ name, count }));

// All-time numbers from your logged movies + their TMDB details.
//   meta: { [tmdbId]: { runtime, cast: [names], directors: [names], language, collection } }
//   collections: { [id]: { name, parts: [{ tmdbId, title, releaseDate }] } }
export function movieStats({ movies = [], meta = {}, collections = {}, expenses = [], todayIso }) {
  const watched = movies.filter((m) => m.myTake || m.date <= todayIso);
  let theatreMin = 0, ottMin = 0, theatreSpend = 0, ottMin90 = 0;
  const actors = {}, directors = {}, langs = {};
  let langTotal = 0;
  for (const m of watched) {
    const d = m.tmdbId ? meta[m.tmdbId] : null;
    const qty = m.quantity || 1;
    const mins = (d?.runtime || 0) * qty;
    if (m.venueType === "OTT") {
      ottMin += mins;
      if (daysBetween(m.date, todayIso) <= 90) ottMin90 += mins;
    } else {
      theatreMin += mins;
      if (d?.runtime) theatreSpend += ((m.ticketPrice || 0) + (m.canteenPrice || 0)) * qty;
    }
    if (!d) continue;
    for (const a of (d.cast || []).slice(0, 4)) actors[a] = (actors[a] || 0) + 1;
    for (const p of d.directors || []) directors[p] = (directors[p] || 0) + 1;
    if (d.language) { langs[d.language] = (langs[d.language] || 0) + 1; langTotal++; }
  }
  // OTT cost: what you paid for streaming apps in the last 90 days, over
  // the hours you streamed in that time.
  const subsSpend90 = expenses.filter((x) => daysBetween(x.date, todayIso) <= 90 && daysBetween(x.date, todayIso) >= 0 && serviceInText(x.note)).reduce((s, x) => s + x.amount, 0);

  const seenIds = new Set(watched.map((m) => m.tmdbId).filter(Boolean));
  const franchises = Object.values(collections)
    .map((c) => {
      const released = c.parts.filter((p) => p.releaseDate && p.releaseDate <= todayIso);
      const seen = released.filter((p) => seenIds.has(p.tmdbId));
      const next = released.find((p) => !seenIds.has(p.tmdbId)) || null;
      return { name: c.name, seen: seen.length, total: released.length, next };
    })
    .filter((f) => f.seen > 0 && f.total > 1)
    .sort((a, b) => b.seen / b.total - a.seen / a.total);

  return {
    hours: Math.round((theatreMin + ottMin) / 60),
    theatreHours: Math.round(theatreMin / 60),
    ottHours: Math.round(ottMin / 60),
    costPerHourTheatre: theatreMin >= 60 ? Math.round(theatreSpend / (theatreMin / 60)) : null,
    costPerHourOtt: ottMin90 >= 60 && subsSpend90 > 0 ? Math.round(subsSpend90 / (ottMin90 / 60)) : null,
    topActors: top(actors).filter((a) => a.count > 1),
    topDirectors: top(directors, 2).filter((a) => a.count > 1),
    languages: top(langs, 4).map((l) => ({ ...l, pct: Math.round((l.count / Math.max(1, langTotal)) * 100) })),
    franchises,
    matched: watched.filter((m) => m.tmdbId && meta[m.tmdbId]).length,
    total: watched.length,
  };
}

// What a night at the movies usually costs you (ticket + snacks, per head).
export function avgNightOut(movies) {
  const t = movies.filter((m) => m.venueType !== "OTT" && m.ticketPrice > 0);
  if (!t.length) return null;
  return Math.round(t.reduce((s, m) => s + m.ticketPrice + (m.canteenPrice || 0), 0) / t.length);
}

// Theatre or wait for OTT? Indian films usually stream ~4 weeks after
// release; a strong audience score (or a genre you love) tips it to "go".
export function theatreVerdict({ rating, releaseDate, todayIso, nightOut, lovedGenre, onYourApps: onApps = [] }) {
  if (onApps.length) return { verdict: "stream", text: `Already on ${onApps.map((p) => p.name).join(" & ")} — no ticket needed.` };
  if (!releaseDate) return null;
  const since = daysBetween(releaseDate, todayIso);
  const otAt = new Date(new Date(releaseDate + "T00:00:00").getTime() + 28 * 86400000);
  const otLabel = otAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const cost = nightOut ? `your usual night out is ₹${nightOut.toLocaleString("en-IN")}` : "";
  const streamSoon = since >= 0 && since < 28 ? `likely on OTT around ${otLabel}` : since >= 28 ? "could reach OTT any day" : "";
  if (rating == null) return { verdict: "maybe", text: [since < 0 ? "Not out yet" : "Too new to judge", streamSoon].filter(Boolean).join(" · ") };
  if (rating >= 7.5 || (rating >= 7 && lovedGenre)) return { verdict: "go", text: `★${rating.toFixed(1)} — worth the big screen${cost ? ` (${cost})` : ""}.` };
  if (rating < 6.5) return { verdict: "wait", text: `★${rating.toFixed(1)}${cost ? ` and ${cost}` : ""} — maybe wait${streamSoon ? `; ${streamSoon}` : " for OTT"}.` };
  return { verdict: "maybe", text: `★${rating.toFixed(1)} — your call${streamSoon ? `; ${streamSoon}` : ""}.` };
}
