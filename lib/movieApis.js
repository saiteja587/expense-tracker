// Extra free movie & TV sources on top of TMDB. Server-only. Each one is
// optional: without its key it's simply skipped (Wikipedia/Wikidata and
// TVmaze need no key). Results are cached in the database (tmdb_cache), so
// the free daily limits are never close.
//
//   OMDb            OMDB_API_KEY            IMDb / Rotten Tomatoes / Metacritic, awards
//   Wikidata + Wikipedia  (no key)          budget, box office, summary
//   fanart.tv       FANART_API_KEY          logos & backgrounds
//   OpenSubtitles   OPENSUBTITLES_API_KEY   which subtitle languages exist
//   YouTube         YOUTUBE_API_KEY         review videos
//   TVmaze          (no key)                next episode air time, channel
//   Trakt           TRAKT_CLIENT_ID         import a public profile's history & watchlist
import { cached, tmdb, hasTmdb } from "./tmdb";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// Wikimedia asks automated clients to identify themselves; nothing personal.
const UA = "ExpenseLedger/1.0 (personal finance & movie log app)";

export const sources = () => ({
  omdb: !!process.env.OMDB_API_KEY,
  fanart: !!process.env.FANART_API_KEY,
  opensubtitles: !!process.env.OPENSUBTITLES_API_KEY,
  youtube: !!process.env.YOUTUBE_API_KEY,
  trakt: !!process.env.TRAKT_CLIENT_ID,
  wikipedia: true,
  tvmaze: true,
});

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// ---- IMDb id (TMDB knows it) ----------------------------------------------------
export async function imdbIdFor(tmdbId, kind = "movie") {
  if (!tmdbId || !hasTmdb()) return "";
  return cached(`imdb:${kind}:${tmdbId}`, 30 * DAY, async () => (await tmdb(`/${kind}/${tmdbId}/external_ids`, {})).imdb_id || "");
}

// ---- OMDb ------------------------------------------------------------------------
export function shapeOmdb(j) {
  if (!j || j.Response === "False") return null;
  const find = (src) => (j.Ratings || []).find((r) => r.Source === src)?.Value || null;
  const n = (v) => (v && v !== "N/A" ? v : null);
  return {
    imdb: n(j.imdbRating) ? parseFloat(j.imdbRating) : null,
    imdbVotes: n(j.imdbVotes),
    rottenTomatoes: find("Rotten Tomatoes"),
    metacritic: n(j.Metascore) ? parseInt(j.Metascore, 10) : null,
    awards: n(j.Awards),
    rated: n(j.Rated),
    imdbUrl: j.imdbID ? `https://www.imdb.com/title/${j.imdbID}/` : null,
  };
}
export async function omdbRatings(imdbId) {
  const key = process.env.OMDB_API_KEY;
  if (!key || !imdbId) return null;
  return cached(`omdb:${imdbId}`, 3 * DAY, async () => shapeOmdb(await getJson(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(key)}`)));
}

// ---- Wikidata + Wikipedia -----------------------------------------------------------
const UNITS = { Q80524: "₹", Q4917: "$", Q4916: "€", Q25224: "£" };
const unitOf = (uri) => UNITS[String(uri || "").split("/").pop()] || null;
export function shapeWikidata(j) {
  const rows = j?.results?.bindings || [];
  if (!rows.length) return null;
  const pick = (k) => rows.map((r) => r[k]).find(Boolean);
  const pickPair = (amount, unit) => {
    const r = rows.find((x) => x[amount] && unitOf(x[unit]?.value)) || rows.find((x) => x[amount]);
    return r ? { amount: Math.round(parseFloat(r[amount].value)), currency: unitOf(r[unit]?.value) } : null;
  };
  const budget = pickPair("budget", "budgetUnit");
  // Box office can be listed per region; the largest same-currency figure is the worldwide one.
  const boxes = rows.filter((r) => r.box).map((r) => ({ amount: Math.round(parseFloat(r.box.value)), currency: unitOf(r.boxUnit?.value) }));
  const sameCur = budget ? boxes.filter((b) => b.currency === budget.currency) : boxes;
  const box = (sameCur.length ? sameCur : boxes).sort((a, b) => b.amount - a.amount)[0] || null;
  let verdict = null;
  if (budget?.amount > 0 && box && box.currency === budget.currency) {
    const x = box.amount / budget.amount;
    verdict = { ratio: Math.round(x * 10) / 10, label: x >= 3 ? "Blockbuster" : x >= 2 ? "Hit" : x >= 1.2 ? "Did okay" : x >= 1 ? "Broke even" : "Below its budget" };
  }
  const article = pick("article")?.value || null;
  return { budget, boxOffice: box, verdict, article, title: article ? decodeURIComponent(article.split("/wiki/").pop()).replace(/_/g, " ") : null };
}
export async function wikiFacts(imdbId) {
  if (!/^tt\d+$/.test(imdbId || "")) return null;
  return cached(`wiki:${imdbId}`, 7 * DAY, async () => {
    const q = `SELECT ?budget ?budgetUnit ?box ?boxUnit ?article WHERE {
      ?item wdt:P345 "${imdbId}" .
      OPTIONAL { ?item p:P2130/psv:P2130 [ wikibase:quantityAmount ?budget; wikibase:quantityUnit ?budgetUnit ] }
      OPTIONAL { ?item p:P2142/psv:P2142 [ wikibase:quantityAmount ?box; wikibase:quantityUnit ?boxUnit ] }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
    } LIMIT 20`;
    const facts = shapeWikidata(await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`));
    if (!facts) return null;
    if (facts.title) {
      const s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(facts.title.replace(/ /g, "_"))}`).catch(() => null);
      if (s?.extract) facts.summary = s.extract.length > 600 ? `${s.extract.slice(0, 600).replace(/\s+\S*$/, "")}…` : s.extract;
    }
    return facts;
  });
}

// ---- fanart.tv ------------------------------------------------------------------------
export function shapeFanart(j) {
  if (!j) return null;
  const best = (list) => {
    const xs = list || [];
    return (xs.find((x) => x.lang === "en") || xs.find((x) => !x.lang || x.lang === "00") || xs[0])?.url || null;
  };
  const logo = best(j.hdmovielogo) || best(j.movielogo) || best(j.hdtvlogo) || best(j.clearlogo);
  const background = best(j.moviebackground) || best(j.showbackground);
  return logo || background ? { logo, background } : null;
}
export async function fanartArt(tmdbId, kind = "movie") {
  const key = process.env.FANART_API_KEY;
  if (!key || !tmdbId) return null;
  return cached(`fanart:${kind}:${tmdbId}`, 7 * DAY, async () => {
    if (kind === "tv") return null; // fanart.tv keys TV by TVDB id; skipped
    return shapeFanart(await getJson(`https://webservice.fanart.tv/v3/movies/${tmdbId}?api_key=${encodeURIComponent(key)}`));
  });
}

// ---- OpenSubtitles ----------------------------------------------------------------------
const LANG_NAMES = { en: "English", te: "Telugu", hi: "Hindi", ta: "Tamil", ml: "Malayalam", kn: "Kannada", bn: "Bengali", mr: "Marathi" };
export function shapeSubtitles(j) {
  const counts = {};
  for (const s of j?.data || []) { const l = s.attributes?.language; if (l) counts[l] = (counts[l] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: LANG_NAMES[code] || code, count: n }));
}
export async function subtitleLanguages(imdbId) {
  const key = process.env.OPENSUBTITLES_API_KEY;
  if (!key || !/^tt\d+$/.test(imdbId || "")) return null;
  return cached(`subs:${imdbId}`, 3 * DAY, async () => shapeSubtitles(await getJson(
    `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${parseInt(imdbId.slice(2), 10)}&languages=${Object.keys(LANG_NAMES).join(",")}`,
    { "Api-Key": key },
  )));
}

// ---- YouTube review videos ------------------------------------------------------------------
const YT_LANG = { Telugu: "te", Hindi: "hi", Tamil: "ta", Malayalam: "ml", Kannada: "kn", English: "en" };
export function shapeYoutube(j) {
  return (j?.items || []).filter((v) => v.id?.videoId).slice(0, 4).map((v) => ({
    id: v.id.videoId, title: decodeEntities(v.snippet?.title || ""), channel: v.snippet?.channelTitle || "",
    thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
    url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
  }));
}
const decodeEntities = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
export async function reviewVideos(title, year, language) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !title) return null;
  const lang = YT_LANG[language] || "en";
  return cached(`yt:${title.toLowerCase()}|${year || ""}|${lang}`, 3 * DAY, async () => shapeYoutube(await getJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=6&safeSearch=moderate&relevanceLanguage=${lang}&q=${encodeURIComponent(`${title} ${year || ""} movie review`)}&key=${encodeURIComponent(key)}`,
  )));
}

// ---- TVmaze ---------------------------------------------------------------------------------
export function shapeTvmaze(show, next) {
  if (!show) return null;
  return {
    network: show.network?.name || show.webChannel?.name || null,
    status: show.status || null,
    next: next?.airstamp ? { airstamp: next.airstamp, season: next.season, episode: next.number, name: next.name || "" } : null,
    url: show.url || null,
  };
}
export async function tvmazeInfo(imdbId) {
  if (!/^tt\d+$/.test(imdbId || "")) return null;
  return cached(`tvmaze:${imdbId}`, 6 * HOUR, async () => {
    const show = await getJson(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`);
    if (!show) return null;
    const nextHref = show._links?.nextepisode?.href;
    const next = nextHref ? await getJson(nextHref.replace(/^http:/, "https:")).catch(() => null) : null;
    return shapeTvmaze(show, next);
  });
}

// ---- Trakt (public profile import) ------------------------------------------------------------
// Trakt rating 1–10 → the app's takes.
export const takeFromTrakt = (r) => (!r ? "" : r >= 9 ? "loved" : r >= 7 ? "liked" : r >= 5 ? "okay" : "disliked");
export function traktToMovies(history = [], ratings = []) {
  const byTrakt = new Map(ratings.map((r) => [r.movie?.ids?.trakt, r.rating]));
  return history.filter((h) => h.movie?.title && h.watched_at).map((h) => ({
    traktHistoryId: h.id,
    title: h.movie.title,
    year: h.movie.year || null,
    tmdbId: h.movie.ids?.tmdb || null,
    date: String(h.watched_at).slice(0, 10),
    myTake: takeFromTrakt(byTrakt.get(h.movie.ids?.trakt)),
  }));
}
async function trakt(path) {
  return getJson(`https://api.trakt.tv${path}`, { "trakt-api-version": "2", "trakt-api-key": process.env.TRAKT_CLIENT_ID, "Content-Type": "application/json" });
}
// Up to `pages` × 100 history entries; the profile must be public.
export async function traktProfile(username, pages = 5) {
  if (!process.env.TRAKT_CLIENT_ID) return { error: "Trakt isn't set up (TRAKT_CLIENT_ID)" };
  const u = encodeURIComponent(String(username || "").trim().toLowerCase());
  if (!u) return { error: "Enter your Trakt username" };
  const history = [];
  for (let p = 1; p <= pages; p++) {
    const page = await trakt(`/users/${u}/history/movies?page=${p}&limit=100`);
    if (page === null) return { error: "That Trakt profile wasn't found or isn't public" };
    history.push(...page);
    if (page.length < 100) break;
  }
  const ratings = (await trakt(`/users/${u}/ratings/movies`).catch(() => [])) || [];
  const watchlist = ((await trakt(`/users/${u}/watchlist/movies`).catch(() => [])) || [])
    .filter((w) => w.movie?.title).map((w) => ({ title: w.movie.title, tmdbId: w.movie.ids?.tmdb || null }));
  return { movies: traktToMovies(history, ratings), watchlist };
}
