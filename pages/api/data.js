import * as db from "../../lib/db";
import crypto from "crypto";
import { issueSession, clearSessionCookie, resolveUser, hashPin, verifyPin } from "../../lib/auth";
import { localDateParts } from "../../lib/dates";
import * as tmdbApi from "../../lib/tmdb";
import { sendToUser } from "../../lib/push";
import * as food from "../../lib/food";
import { LIFE_KINDS } from "../../lib/life";
import * as movieApis from "../../lib/movieApis";
import * as freeApis from "../../lib/freeApis";

// Calls the lock screen needs before the user has unlocked. Everything else
// requires a valid session cookie whenever a PIN is set.
const PUBLIC_TYPES = {
  GET: new Set(["pin-status", "session", "vapid-public-key", "invite-check"]),
  POST: new Set(["verify-pin", "logout", "join"]),
};

// Invite codes: 8 letters/digits without look-alikes (0/O, 1/I/L).
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newInviteCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
const cleanName = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 30);

// Receipt photos arrive as a compressed base64 string in the JSON body,
// which can run a few hundred KB — comfortably over the framework's 1MB
// default, so it's raised here.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

// Everything except receipt photos (they'd blow past the response size
// limit; the client fetches those via ?type=receipts). Also used for the
// weekly server-side backups.
export async function buildExport(uid) {
  const [expenses, movies, topups, rules, recurring, recurringIncome, ious, watchlist, tvShows] = await Promise.all([
    db.listExpenses(uid), db.listMovies(uid), db.listTopups(uid), db.listBudgetRules(uid), db.listRecurring(uid),
    db.listRecurringIncome(uid), db.listIous(uid), db.listWatchlist(uid), db.listTvShows(uid),
  ]);
  // Card secrets travel only in their encrypted form (useless without the
  // passphrase), so a restore brings them back too.
  const [accounts, transfers, loans, assets, trips, netWorth] = await Promise.all([
    db.listAccounts(uid), db.listTransfers(uid), db.listLoans(uid), db.listAssets(uid), db.listTrips(uid), db.listNetWorth(uid),
  ]);
  const challengeMeta = await db.getChallengeMeta(uid);
  const challengeDays = await db.listChallengeDays(uid);
  const challengeHistory = await db.listChallengeHistory(uid);
  const setting = async (key) => {
    const raw = await db.getUserSetting(uid, key);
    return raw ? JSON.parse(raw) : null;
  };
  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 2,
    expenses, movies, topups, budgetRules: rules, recurring, recurringIncome, ious, watchlist, tvShows,
    accounts, transfers, loans, assets, trips, netWorth,
    life: await db.exportLife(uid),
    sugarChallenge: { meta: challengeMeta, days: challengeDays, history: challengeHistory },
    customCategories: (await setting("custom_categories")) || [],
    theatres: await setting("custom_theatres"),
    ottPlatforms: await setting("custom_ott_platforms"),
    savingsGoal: await setting("savings_goal"),
    milestoneRewards: (await setting("milestone_rewards")) || {},
    miniChallenges: (await setting("mini_challenges")) || [],
    sugarFoodLog: await db.listSugarLog(uid, "1900-01-01"),
  };
}

// Poster URLs by title, kept for the life of the server instance.
const posterCache = new Map();
async function lookupPoster(title, year) {
  const key = `${title.toLowerCase()}|${year || ""}`;
  if (posterCache.has(key)) return posterCache.get(key);
  const apiKey = process.env.TMDB_API_KEY;
  // TMDB accepts either a v3 API key (query param) or a v4 read token (Bearer).
  const isBearer = apiKey.startsWith("eyJ");
  const url = new URL("https://api.themoviedb.org/3/search/movie");
  url.searchParams.set("query", title);
  url.searchParams.set("include_adult", "false");
  if (year) url.searchParams.set("year", String(year).slice(0, 4));
  if (!isBearer) url.searchParams.set("api_key", apiKey);
  let poster = null;
  try {
    const r = await fetch(url, { headers: isBearer ? { Authorization: `Bearer ${apiKey}` } : {} });
    if (r.ok) {
      const d = await r.json();
      const hit = (d.results || []).find((m) => m.poster_path);
      poster = hit ? `https://image.tmdb.org/t/p/w342${hit.poster_path}` : null;
    }
  } catch {
    poster = null;
  }
  posterCache.set(key, poster);
  return poster;
}

// Run fn over items, a few at a time (TMDB calls in parallel, but polite).
async function inBatches(items, size, fn) {
  const out = [];
  for (let k = 0; k < items.length; k += size) out.push(...(await Promise.all(items.slice(k, k + size).map(fn))));
  return out;
}
const safe = (p) => p.catch((e) => { console.error("[tmdb]", e.message); return null; });

// Fill in missing TMDB ids for a person's logged movies (a few per call;
// 0 marks "looked, no match" so it isn't searched again).
async function resolveMovieIds(uid, movies, limit = 12) {
  const missing = movies.filter((m) => m.tmdb_id == null).slice(0, limit);
  await inBatches(missing, 6, async (m) => {
    let hit;
    try {
      hit = await tmdbApi.matchMovie(m.title, String(m.watched_date instanceof Date ? m.watched_date.toISOString() : m.watched_date).slice(0, 4));
    } catch (e) {
      console.error("[tmdb] match failed:", e.message);
      return; // try again next time rather than marking "no match"
    }
    const id = hit?.tmdbId || 0;
    m.tmdb_id = id;
    await db.setMovieTmdbId(uid, m.id, id);
  });
  return movies.filter((m) => m.tmdb_id == null).length;
}

function err(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

export default async function handler(req, res) {
  try {
    const reqType = req.method === "GET" || req.method === "DELETE" ? req.query.type : req.body?.type;
    const isPublic = PUBLIC_TYPES[req.method]?.has(reqType);
    // Every non-public call acts as exactly one person: the signed-in user.
    const user = await resolveUser(req, isPublic ? null : res);
    if (!user && !isPublic) return err(res, "Locked — enter your PIN", 401);
    const uid = user?.id;

    if (req.method === "GET") {
      const { type } = req.query;
      // What the lock screen needs: who you are (if signed in), and whether
      // a name must be typed (only once there's more than one person).
      if (type === "session") {
        const users = await db.listUsers();
        const hasPin = users.length > 1 || users.some((u) => u.has_pin);
        return res.status(200).json({
          hasPin, authenticated: !!user, multiUser: users.length > 1,
          user: user ? { id: user.id, name: user.name, isOwner: user.is_owner, hasPin: !!user.pin_hash } : null,
        });
      }
      if (type === "invite-check") {
        return res.status(200).json({ valid: !!(await db.checkInvite(cleanCode(req.query.code))) });
      }
      if (type === "invites") {
        return res.status(200).json({ invites: await db.listInvites(uid), people: user.is_owner ? (await db.listUsers()).map((u) => ({ id: u.id, name: u.name, isOwner: u.is_owner })) : [] });
      }
      if (type === "expenses") return res.status(200).json({ expenses: await db.listExpenses(uid) });
      if (type === "movies") return res.status(200).json({ movies: await db.listMovies(uid) });
      if (type === "accounts") return res.status(200).json({ accounts: await db.listAccounts(uid) });
      if (type === "transfers") return res.status(200).json({ transfers: await db.listTransfers(uid) });
      if (type === "loans") return res.status(200).json({ loans: await db.listLoans(uid) });
      if (type === "assets") return res.status(200).json({ assets: await db.listAssets(uid) });
      if (type === "trips") return res.status(200).json({ trips: await db.listTrips(uid) });
      if (type === "networth") return res.status(200).json({ history: await db.listNetWorth(uid) });
      // ?kinds=habit,habit_log — life trackers (see lib/life.js)
      if (type === "life") {
        const kinds = String(req.query.kinds || "").split(",").filter((k) => LIFE_KINDS[k]);
        if (!kinds.length) return err(res, "Say which kinds");
        return res.status(200).json({ items: await db.listLife(uid, kinds) });
      }
      if (type === "life-photo") return res.status(200).json({ photo: await db.getLifePhoto(uid, parseInt(req.query.id, 10)) });
      // A sealed "ok" that proves which passphrase this person's vault uses.
      if (type === "vault-check") return res.status(200).json({ check: (await db.getUserSetting(uid, "vault_check")) || "" });
      if (type === "balance") return res.status(200).json({ topups: await db.listTopups(uid) });
      if (type === "budget") return res.status(200).json({ rules: await db.listBudgetRules(uid) });
      if (type === "challenge") {
        const meta = await db.getChallengeMeta(uid);
        const days = await db.listChallengeDays(uid);
        const history = await db.listChallengeHistory(uid);
        return res.status(200).json({ meta, days, history });
      }
      if (type === "recurring") return res.status(200).json({ recurring: await db.listRecurring(uid) });
      if (type === "recurring-income") return res.status(200).json({ recurringIncome: await db.listRecurringIncome(uid) });
      if (type === "ious") return res.status(200).json({ ious: await db.listIous(uid) });
      if (type === "recurring-confirmations") return res.status(200).json({ confirmations: await db.getRecurringConfirmations(uid) });
      if (type === "watchlist") return res.status(200).json({ watchlist: await db.listWatchlist(uid) });
      if (type === "bills-paid") return res.status(200).json({ paid: await db.getBillsPaid(uid) });
      if (type === "savings-goal") return res.status(200).json({ goal: await db.getSavingsGoal(uid) });
      if (type === "milestone-rewards") return res.status(200).json({ rewards: await db.getMilestoneRewards(uid) });
      if (type === "mini-challenges") {
        const raw = await db.getUserSetting(uid, "mini_challenges");
        return res.status(200).json({ challenges: raw ? JSON.parse(raw) : [] });
      }
      // Movie poster lookup via TMDB (free API key in TMDB_API_KEY). Without a
      // key the app shows generated poster tiles instead.
      // ---- TMDB-powered movie features (all empty without a TMDB key) ----
      if (type === "movie-search" || type === "tv-search") {
        const q = String(req.query.q || "").trim().slice(0, 80);
        if (q.length < 2 || !tmdbApi.hasTmdb()) return res.status(200).json({ results: [] });
        const results = await safe(type === "tv-search" ? tmdbApi.searchTv(q) : tmdbApi.searchMovies(q));
        return res.status(200).json({ results: results || [] });
      }
      // What's in Indian theatres now, coming soon, trending, new by language.
      if (type === "now-showing") {
        if (!tmdbApi.hasTmdb()) return res.status(200).json({ nowPlaying: [], upcoming: [], trending: [], byLanguage: {} });
        const langs = String(req.query.langs || "").split(",").map((l) => l.trim()).filter((l) => tmdbApi.LANGS[l]).slice(0, 2);
        const [ns, tr, ...byLang] = await Promise.all([safe(tmdbApi.nowShowing()), safe(tmdbApi.trending()), ...langs.map((l) => safe(tmdbApi.newInLanguage(l)))]);
        return res.status(200).json({
          nowPlaying: ns?.nowPlaying || [], upcoming: ns?.upcoming || [], trending: tr || [],
          byLanguage: Object.fromEntries(langs.map((l, k) => [l, byLang[k] || []])),
        });
      }
      // Everything about one film: by TMDB id, or by title (+ year) for
      // movies logged before ids were stored.
      // Extra sources for one film (each skipped if not set up): ratings from
      // OMDb, budget/box office/summary from Wikidata + Wikipedia, art from
      // fanart.tv, subtitle languages from OpenSubtitles, YouTube reviews.
      if (type === "movie-extras") {
        const tmdbId = parseInt(req.query.tmdbId, 10) || null;
        const imdbId = /^tt\d+$/.test(String(req.query.imdbId || "")) ? req.query.imdbId : await safe(movieApis.imdbIdFor(tmdbId));
        const title = String(req.query.title || "").slice(0, 100);
        const [ratings, wiki, art, subtitles, videos] = await Promise.all([
          safe(movieApis.omdbRatings(imdbId)), safe(movieApis.wikiFacts(imdbId)), safe(movieApis.fanartArt(tmdbId)),
          safe(movieApis.subtitleLanguages(imdbId)), safe(movieApis.reviewVideos(title, String(req.query.year || "").slice(0, 4), String(req.query.language || ""))),
        ]);
        return res.status(200).json({ imdbId: imdbId || null, ratings, wiki, art, subtitles, videos });
      }
      if (type === "tv-extras") {
        const tmdbId = parseInt(req.query.tmdbId, 10) || null;
        const imdbId = await safe(movieApis.imdbIdFor(tmdbId, "tv"));
        return res.status(200).json({ tvmaze: await safe(movieApis.tvmazeInfo(imdbId)) });
      }
      // Mutual funds (mfapi.in) and currency rates (Frankfurter): free, no key.
      if (type === "mf-search") return res.status(200).json({ results: (await safe(freeApis.mfSearch(String(req.query.q || "").slice(0, 60)))) || [] });
      if (type === "mf-nav") return res.status(200).json({ nav: await safe(freeApis.mfNav(req.query.code)) });
      if (type === "fx") return res.status(200).json({ fx: await safe(freeApis.fxRate(req.query.from, req.query.date)), currencies: freeApis.CURRENCIES });
      if (type === "my-upi") return res.status(200).json({ upi: (await db.getUserSetting(uid, "my_upi")) || "", name: user.name });
      if (type === "movie-sources") return res.status(200).json({ sources: { tmdb: tmdbApi.hasTmdb(), ...movieApis.sources() } });
      if (type === "movie-details") {
        if (!tmdbApi.hasTmdb()) return res.status(200).json({ details: null });
        let id = parseInt(req.query.id, 10);
        if (!id && req.query.title) id = (await safe(tmdbApi.matchMovie(String(req.query.title).slice(0, 100), req.query.year)))?.tmdbId;
        if (!id) return res.status(200).json({ details: null });
        const details = await safe(tmdbApi.movieDetails(id));
        const coll = details?.collection ? await safe(tmdbApi.collection(details.collection.id)) : null;
        return res.status(200).json({ details: details ? { ...details, collectionParts: coll?.parts || [] } : null });
      }
      // Runtime, people, language and franchise for each logged movie (for
      // stats). Resolves missing ids a few at a time; "pending" says how
      // many are still to look up (the page asks again).
      if (type === "movie-meta") {
        const movies = await db.listMovies(uid);
        if (!tmdbApi.hasTmdb()) return res.status(200).json({ meta: {}, collections: {}, ids: {}, pending: 0 });
        const pending = await resolveMovieIds(uid, movies);
        const ids = [...new Set(movies.map((m) => m.tmdb_id).filter((x) => x > 0))];
        const details = await inBatches(ids, 8, (id) => safe(tmdbApi.movieDetails(id)));
        const meta = {};
        const collIds = new Set();
        details.forEach((d) => {
          if (!d) return;
          meta[d.tmdbId] = { runtime: d.runtime, cast: d.cast.map((c) => c.name), directors: d.directors, language: d.language, collection: d.collection, releaseDate: d.indiaRelease || d.releaseDate || "", rating: d.rating, genres: d.genres };
          if (d.collection) collIds.add(d.collection.id);
        });
        const colls = await inBatches([...collIds], 6, (id) => safe(tmdbApi.collection(id)));
        const collections = {};
        colls.forEach((c) => { if (c) collections[c.id] = { name: c.name, parts: c.parts.map((p) => ({ tmdbId: p.tmdbId, title: p.title, releaseDate: p.releaseDate })) }; });
        return res.status(200).json({ meta, collections, ids: Object.fromEntries(movies.map((m) => [m.id, m.tmdb_id || null])), pending });
      }
      // Watchlist with release date (India), streaming apps and poster.
      if (type === "watchlist-info") {
        const items = await db.listWatchlist(uid);
        if (!tmdbApi.hasTmdb()) return res.status(200).json({ items: {} });
        const ns = await safe(tmdbApi.nowShowing());
        const inTheatres = new Set((ns?.nowPlaying || []).map((m) => m.tmdbId));
        const out = {};
        await inBatches(items, 6, async (w) => {
          let id = w.tmdb_id;
          if (!id) {
            id = (await safe(tmdbApi.matchMovie(w.title)))?.tmdbId || null;
            if (id) await db.updateWatchlistMeta(uid, w.id, { tmdbId: id });
          }
          if (!id) return;
          const d = await safe(tmdbApi.movieDetails(id));
          if (!d) return;
          const rel = d.indiaRelease || d.releaseDate;
          if (rel && String(w.release_date || "").slice(0, 10) !== rel) await db.updateWatchlistMeta(uid, w.id, { releaseDate: rel });
          out[w.id] = { tmdbId: id, poster: d.poster, rating: d.rating, releaseDate: rel, genre: d.genre, stream: d.providers.stream, inTheatres: inTheatres.has(id), runtime: d.runtime, language: d.language };
        });
        return res.status(200).json({ items: out });
      }
      // "Because you loved …": TMDB recommendations from your favourites,
      // minus what you've seen or saved, with where to watch them.
      if (type === "recommendations") {
        if (!tmdbApi.hasTmdb()) return res.status(200).json({ results: [] });
        const [movies, watchlist] = await Promise.all([db.listMovies(uid), db.listWatchlist(uid)]);
        await resolveMovieIds(uid, movies, 6);
        const favs = movies.filter((m) => m.tmdb_id > 0 && ((m.rating || 0) >= 4 || m.my_take === "loved")).slice(0, 4);
        const seeds = favs.length ? favs : movies.filter((m) => m.tmdb_id > 0 && m.my_take === "liked").slice(0, 3);
        const skip = new Set([...movies.map((m) => m.tmdb_id), ...watchlist.map((w) => w.tmdb_id)].filter(Boolean));
        const skipTitles = new Set([...movies, ...watchlist].map((m) => m.title.toLowerCase()));
        const seedDetails = await inBatches(seeds, 4, (m) => safe(tmdbApi.movieDetails(m.tmdb_id)));
        const picks = [];
        // Round-robin so each favourite contributes.
        for (let k = 0; k < 12 && picks.length < 10; k++) {
          for (const sd of seedDetails) {
            const r = sd?.recommendations?.[k];
            if (r && !skip.has(r.tmdbId) && !skipTitles.has(r.title.toLowerCase()) && !picks.some((p) => p.tmdbId === r.tmdbId)) picks.push({ ...r, because: sd.title });
          }
        }
        const ns = await safe(tmdbApi.nowShowing());
        const inTheatres = new Set((ns?.nowPlaying || []).map((m) => m.tmdbId));
        const withWhere = await inBatches(picks.slice(0, 10), 5, async (p) => {
          const d = await safe(tmdbApi.movieDetails(p.tmdbId));
          return { ...p, stream: d?.providers?.stream || [], inTheatres: inTheatres.has(p.tmdbId) };
        });
        return res.status(200).json({ results: withWhere });
      }
      if (type === "watch-lists") {
        return res.status(200).json({ lists: await db.listWatchLists(uid), me: uid });
      }
      // Your movie settings: yearly goal, sharing ratings with friends.
      if (type === "movie-prefs") {
        const [share, goal, follows] = await Promise.all([db.getUserSetting(uid, "share_ratings"), db.getUserSetting(uid, "movie_goal"), db.listFollows(uid)]);
        return res.status(200).json({ shareRatings: share === "1", goal: parseInt(goal, 10) || null, followIds: follows.map((f) => f.person_id) });
      }
      if (type === "friend-ratings") {
        const id = parseInt(req.query.tmdbId, 10);
        if (!id) return res.status(200).json({ sharing: false, ratings: [] });
        return res.status(200).json(await db.friendRatings(uid, id));
      }
      // Actors/directors you follow, with their next (or latest) film.
      if (type === "following") {
        const follows = await db.listFollows(uid);
        const today = localDateParts().iso;
        const out = await inBatches(follows, 4, async (f) => {
          const films = tmdbApi.hasTmdb() ? (await safe(tmdbApi.personMovies(f.person_id))) || [] : [];
          const next = [...films].filter((m) => m.releaseDate >= today).sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))[0] || null;
          const latest = films.find((m) => m.releaseDate && m.releaseDate < today) || null;
          return { personId: f.person_id, name: f.name, role: f.role, next, latest };
        });
        return res.status(200).json({ following: out });
      }
      // Sugar in a food: common Indian foods + Open Food Facts products.
      if (type === "food-search") {
        const q = String(req.query.q || "").trim().slice(0, 60);
        if (q.length < 2) return res.status(200).json({ common: [], products: [] });
        const products = await food.searchFoods(q).catch((e) => { console.error("[food]", e.message); return null; });
        return res.status(200).json({ common: food.searchCommonFoods(q), products: products || [], offline: products === null });
      }
      if (type === "food-barcode") {
        const product = await food.productByBarcode(req.query.code).catch((e) => { console.error("[food]", e.message); return undefined; });
        if (product === undefined) return err(res, "Couldn't reach Open Food Facts — try again", 502);
        return res.status(200).json({ product });
      }
      if (type === "sugar-log") {
        const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        return res.status(200).json({ log: await db.listSugarLog(uid, since) });
      }
      if (type === "tv-details") {
        const id = parseInt(req.query.id, 10);
        if (!id || !tmdbApi.hasTmdb()) return res.status(200).json({ details: null });
        return res.status(200).json({ details: await safe(tmdbApi.tvDetails(id)) });
      }
      if (type === "tv-shows") {
        const shows = await db.listTvShows(uid);
        // Season/episode counts and the next episode date, from TMDB.
        const info = {};
        if (tmdbApi.hasTmdb() && !req.query.lite) {
          await inBatches(shows.filter((t) => t.tmdb_id), 6, async (t) => {
            const d = await safe(tmdbApi.tvDetails(t.tmdb_id));
            if (d) info[t.id] = { seasons: d.seasons, nextEpisode: d.nextEpisode, status: d.status, stream: d.providers.stream, poster: d.poster, episodeRuntime: d.episodeRuntime };
          });
        }
        return res.status(200).json({ shows, info });
      }
      if (type === "poster") {
        const title = String(req.query.title || "").trim().slice(0, 120);
        if (!title || !process.env.TMDB_API_KEY) return res.status(200).json({ url: null });
        return res.status(200).json({ url: await lookupPoster(title, req.query.year) });
      }
      if (type === "categories") {
        const raw = await db.getUserSetting(uid, "custom_categories");
        return res.status(200).json({ categories: raw ? JSON.parse(raw) : [] });
      }
      if (type === "theatres") {
        const raw = await db.getUserSetting(uid, "custom_theatres");
        return res.status(200).json({ theatres: raw ? JSON.parse(raw) : ["PVR", "INOX", "Cinepolis", "Miraj Cinemas", "Asian Cinemas", "AMB Cinemas", "Sudarshan 35MM"] });
      }
      if (type === "ott-platforms") {
        const raw = await db.getUserSetting(uid, "custom_ott_platforms");
        return res.status(200).json({ ottPlatforms: raw ? JSON.parse(raw) : ["Netflix", "Amazon Prime Video", "Disney+ Hotstar", "SonyLIV", "ZEE5", "JioCinema", "Apple TV+", "MX Player"] });
      }
      if (type === "vapid-public-key") {
        return res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || null });
      }
      if (type === "pin-status") {
        // hasPin: does this app need unlocking at all; mine: did YOU set one.
        const users = await db.listUsers();
        return res.status(200).json({ hasPin: users.length > 1 || users.some((u) => u.has_pin), mine: !!user?.pin_hash });
      }
      // Receipt photos by expense id: ?type=receipts&ids=1,2,3 (max 10 per call,
      // keeping the response well under Vercel's ~4.5MB limit).
      if (type === "receipts") {
        const ids = String(req.query.ids || "").split(",").map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)).slice(0, 10);
        const receipts = {};
        for (const id of ids) receipts[id] = await db.getExpenseReceipt(uid, id);
        return res.status(200).json({ receipts });
      }
      if (type === "export-all") {
        return res.status(200).json(await buildExport(uid));
      }
      // Weekly server-side backups (#14): list, or fetch one to download.
      if (type === "backups") {
        return res.status(200).json({ backups: await db.listBackups(uid) });
      }
      if (type === "backup") {
        const payload = await db.getBackup(uid, parseInt(req.query.id, 10));
        if (!payload) return err(res, "Backup not found", 404);
        return res.status(200).json(JSON.parse(payload));
      }
      if (type === "shared-groups") {
        const groups = await db.listSharedGroups(uid);
        return res.status(200).json({ groups: groups.map((g) => ({ ...g, members: JSON.parse(g.members) })) });
      }
      return err(res, "Unknown type");
    }

    if (req.method === "POST") {
      const body = req.body;
      const { type } = body;

      if (type === "expenses") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!body.date) return err(res, "Date is required");
        const expense = await db.createExpense(uid, { amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance, receiptPhoto: body.receiptPhoto, clientRequestId: body.clientRequestId, isEstimate: !!body.isEstimate, accountId: body.accountId, tripId: body.tripId, taxTag: body.taxTag });
        return res.status(201).json({ expense });
      }

      if (type === "refund") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Enter the amount you got back");
        if (!body.date) return err(res, "Date is required");
        const r = await db.createRefund(uid, parseInt(body.expenseId, 10), { amount, date: body.date, note: String(body.note || "").slice(0, 120), accountId: body.accountId, kind: body.kind });
        if (r.error) return err(res, r.error);
        return res.status(201).json(r);
      }

      if (type === "accounts") {
        if (!String(body.name || "").trim()) return err(res, "Give the account a name");
        return res.status(201).json({ account: await db.createAccount(uid, body) });
      }

      if (type === "transfer") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.date) return err(res, "Date is required");
        const r = await db.createTransfer(uid, { ...body, amount });
        if (r.error) return err(res, r.error);
        return res.status(201).json(r);
      }

      if (type === "loan") {
        if (!(parseFloat(body.principal) > 0)) return err(res, "Enter the loan amount");
        if (!(parseInt(body.tenureMonths, 10) > 0)) return err(res, "Enter the tenure in months");
        if (!body.startDate) return err(res, "Enter when the loan started");
        return res.status(201).json({ loan: await db.createLoan(uid, body) });
      }

      if (type === "asset") {
        if (!String(body.name || "").trim()) return err(res, "Give it a name");
        return res.status(201).json({ asset: await db.saveAsset(uid, null, body) });
      }

      if (type === "trip") {
        if (!String(body.name || "").trim()) return err(res, "Give the trip a name");
        if (!body.startDate) return err(res, "When does it start?");
        if (body.endDate && body.endDate < body.startDate) return err(res, "The end date is before the start");
        const trip = await db.saveTrip(uid, null, body);
        const tagged = body.tagExisting ? await db.tagTripByDates(uid, trip.id) : 0;
        return res.status(201).json({ trip, tagged });
      }

      if (type === "trip-tag") {
        return res.status(200).json({ tagged: await db.tagTripByDates(uid, parseInt(body.id, 10)) });
      }

      if (type === "life") {
        const id = body.id ? parseInt(body.id, 10) : null;
        const item = await db.saveLife(uid, id, { kind: body.kind, refId: body.refId, date: body.date, data: body.data || {}, photo: body.photo, vault: body.vault });
        if (!item) return err(res, "Not found", 404);
        return res.status(id ? 200 : 201).json({ item });
      }

      if (type === "habit-toggle") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ""))) return err(res, "Pick a date");
        await db.toggleHabitDay(uid, body.habitId, body.date, !!body.on);
        return res.status(200).json({ ok: true });
      }

      if (type === "vault-check") {
        // Set once; changing it would lock out secrets sealed with the old one.
        if (await db.getUserSetting(uid, "vault_check")) return res.status(200).json({ ok: true, existed: true });
        await db.setUserSetting(uid, "vault_check", db.cleanVault(body.check));
        return res.status(201).json({ ok: true });
      }

      if (type === "my-upi") {
        const v = String(body.upi || "").trim();
        if (v && !/^[\w.-]{2,64}@[a-zA-Z]{2,64}$/.test(v)) return err(res, "That doesn't look like a UPI ID (name@bank)");
        await db.setUserSetting(uid, "my_upi", v);
        return res.status(200).json({ upi: v });
      }

      if (type === "iou-upi") {
        const row = await db.setIouUpi(uid, parseInt(body.id, 10), body.upiId);
        if (!row) return err(res, "Not found", 404);
        return res.status(200).json(row);
      }

      // Re-price mutual funds from today's NAV.
      if (type === "refresh-funds") {
        const codes = await db.listFundCodes(uid);
        const navs = {};
        for (const c of codes) { const n = await safe(freeApis.mfNav(c)); if (n?.nav) navs[c] = n.nav; }
        return res.status(200).json({ updated: await db.updateFundValues(uid, navs) });
      }

      if (type === "trakt-import") {
        const profile = await movieApis.traktProfile(String(body.username || "").slice(0, 60));
        if (profile.error) return err(res, profile.error);
        return res.status(200).json(await db.importTrakt(uid, profile));
      }

      if (type === "networth-snapshot") {
        const net = parseFloat(body.net);
        if (!isFinite(net)) return err(res, "Invalid value");
        await db.saveNetWorth(uid, String(body.ym || ""), { net, have: parseFloat(body.have) || 0, owe: parseFloat(body.owe) || 0 });
        return res.status(200).json({ ok: true });
      }

      // Bank/card statement rows the person ticked. Debits become expenses,
      // credits become money in. Ids come from the statement line itself,
      // so re-importing the same file adds nothing twice.
      if (type === "statement-import") {
        const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
        const accountId = body.accountId == null || body.accountId === "" ? null : parseInt(body.accountId, 10);
        const debits = [], credits = [];
        for (const r of rows) {
          const amount = Math.round((parseFloat(r.amount) || 0) * 100) / 100;
          if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ""))) continue;
          const key = String(r.key || "").slice(0, 120);
          if (!key) continue;
          const crid = `stmt:${uid}:${accountId ?? "main"}:${key}`;
          if (r.type === "credit") credits.push({ toAccount: accountId, amount, date: r.date, note: String(r.description || "").slice(0, 120), clientRequestId: crid });
          else debits.push({ accountId, amount, date: r.date, category: String(r.category || "Other").slice(0, 40), note: String(r.description || "").slice(0, 120), clientRequestId: crid });
        }
        const added = await db.createExpensesBulk(uid, debits);
        const credited = await db.createTransfersBulk(uid, credits);
        return res.status(200).json({ added, credited, skipped: debits.length + credits.length - added - credited });
      }

      if (type === "movies") {
        const ticketPrice = parseFloat(body.ticketPrice) || 0;
        const canteenPrice = parseFloat(body.canteenPrice) || 0;
        const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
        if (!body.title?.trim()) return err(res, "Movie title is required");
        if (!body.date) return err(res, "Date is required");
        if (ticketPrice < 0 || canteenPrice < 0) return err(res, "Prices can't be negative");
        const movie = await db.createMovie(uid, {
          title: body.title.trim(), date: body.date, time: body.time, ticketPrice, canteenPrice,
          companions: (body.companions || "").trim(), myTake: body.myTake, publicTake: body.publicTake,
          note: (body.note || "").trim(), affectsBalance: body.affectsBalance, quantity,
          venueType: body.venueType, venueName: (body.venueName || "").trim(), genre: (body.genre || "").trim(), rating: body.rating, review: (body.review || "").trim(),
          clientRequestId: body.clientRequestId, tmdbId: body.tmdbId,
        });
        return res.status(201).json({ movie });
      }

      if (type === "balance") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Enter an amount greater than 0");
        if (!body.date) return err(res, "Date is required");
        const topup = await db.createTopup(uid, { amount, note: body.note, date: body.date, mode: body.mode });
        return res.status(201).json({ topup });
      }

      if (type === "budget") {
        const amount = parseFloat(body.amount);
        // low_balance (alert threshold) and movie_count (monthly guideline) are set
        // from the Rules page; they were missing here, so saving them always failed.
        if (!["overall", "category", "savings", "low_balance", "movie_count"].includes(body.ruleType)) return err(res, "Invalid rule type");
        if (!amount || amount <= 0) return err(res, "Enter an amount greater than 0");
        if (body.ruleType === "category" && !body.category) return err(res, "Pick a category");
        const rule = await db.upsertBudgetRule(uid, { ruleType: body.ruleType, category: body.category, amount });
        return res.status(201).json({ rule });
      }

      if (type === "challenge-meta") {
        const lengthDays = parseInt(body.lengthDays, 10) || 41;
        if (!body.startDate) return err(res, "Pick a start date");
        if (lengthDays < 1 || lengthDays > 365) return err(res, "Length must be between 1 and 365 days");
        const sugarPerDay = parseFloat(body.sugarPerDay) || 0;
        const savingsPerDay = parseFloat(body.savingsPerDay) || 0;
        const meta = await db.setChallengeMeta(uid, body.startDate, lengthDays, sugarPerDay, savingsPerDay);
        return res.status(201).json({ meta });
      }

      if (type === "challenge-day") {
        if (!body.date) return err(res, "Date is required");
        if (typeof body.completed !== "boolean") return err(res, "Completed must be true or false");
        const day = await db.upsertChallengeDay(uid, body.date, body.completed, body.note, body.reason, body.naturalSugar);
        return res.status(201).json({ day });
      }

      if (type === "confirm-recurring") {
        if (!body.id) return err(res, "Missing id");
        const confirmations = await db.confirmRecurring(uid, body.id);
        return res.status(201).json({ ok: true, confirmations });
      }

      if (type === "recurring") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurring = await db.createRecurring(uid, { amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance, upiId: body.upiId, variable: !!body.variable, accountId: body.accountId });
        return res.status(201).json({ recurring });
      }

      if (type === "recurring-income") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurringIncome = await db.createRecurringIncome(uid, { amount, note: body.note, dayOfMonth });
        return res.status(201).json({ recurringIncome });
      }

      if (type === "ious") {
        const amount = parseFloat(body.amount);
        if (!body.personName?.trim()) return err(res, "Name is required");
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!["owed_to_me", "i_owe"].includes(body.direction)) return err(res, "Invalid direction");
        const iou = await db.createIou(uid, {
          personName: body.personName.trim(), amount, direction: body.direction,
          note: (body.note || "").trim(), dueDate: body.dueDate || null,
        });
        return res.status(201).json({ iou });
      }

      if (type === "watchlist") {
        if (!body.title?.trim()) return err(res, "Title is required");
        const item = await db.createWatchlistItem(uid, { title: body.title.trim(), note: (body.note || "").trim(), tmdbId: body.tmdbId, releaseDate: body.releaseDate });
        return res.status(201).json({ item });
      }

      if (type === "savings-goal") {
        if (body.clear) {
          await db.setSavingsGoal(uid, null);
          return res.status(201).json({ goal: null });
        }
        const targetAmount = parseFloat(body.targetAmount);
        if (!targetAmount || targetAmount <= 0) return err(res, "Enter a target amount greater than 0");
        const goal = await db.setSavingsGoal(uid, { targetAmount, targetDate: body.targetDate || null, label: (body.label || "").trim() });
        return res.status(201).json({ goal });
      }

      if (type === "movie-prefs") {
        if (body.shareRatings !== undefined) await db.setUserSetting(uid, "share_ratings", body.shareRatings ? "1" : "0");
        if (body.goal !== undefined) {
          const g = parseInt(body.goal, 10);
          await db.setUserSetting(uid, "movie_goal", g > 0 && g <= 1000 ? String(g) : "");
        }
        return res.status(200).json({ ok: true });
      }
      if (type === "follow") {
        const personId = parseInt(body.personId, 10);
        const name = String(body.name || "").trim().slice(0, 80);
        if (!personId || !name) return err(res, "Pick someone to follow");
        await db.followPerson(uid, { personId, name, role: String(body.role || "").slice(0, 20) });
        return res.status(201).json({ ok: true });
      }
      if (type === "watch-list-vote") {
        const id = parseInt(body.id, 10);
        const item = id ? await db.voteWatchListItem(uid, id, !!body.on) : null;
        if (!item) return err(res, "Not found", 404);
        if (body.on) {
          const others = await db.watchListOthers(uid, item.list_id);
          await Promise.all(others.map((o) => sendToUser(o, { title: `👍 ${user.name} voted for ${item.title}`, body: "Pick what you'd watch next in your shared list.", url: "/movies?tab=watchlist" }).catch(() => {})));
        }
        return res.status(200).json({ ok: true });
      }
      if (type === "sugar-log") {
        const name = String(body.name || "").trim().slice(0, 100);
        const grams = Math.round((parseFloat(body.grams) || 0) * 10) / 10;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : localDateParts().iso;
        if (!name) return err(res, "What did you have?");
        if (grams < 0 || grams > 1000) return err(res, "Sugar must be between 0 and 1000 g");
        const entry = await db.addSugarLog(uid, { date, name, grams, added: body.added !== false, code: String(body.code || "").slice(0, 20) });
        return res.status(201).json({ entry });
      }

      if (type === "watchlist-order") {
        if (!Array.isArray(body.ids)) return err(res, "ids must be a list");
        await db.reorderWatchlist(uid, body.ids);
        return res.status(200).json({ ok: true });
      }

      // Watch together: a list shared with other people in the app, added
      // by their sign-in names.
      if (type === "watch-list") {
        const name = String(body.name || "").trim().slice(0, 60);
        const names = (Array.isArray(body.members) ? body.members : []).map((n) => String(n).trim()).filter(Boolean).slice(0, 10);
        if (!name) return err(res, "Give the list a name");
        if (!names.length) return err(res, "Add at least one friend by their name in the app");
        const found = [];
        const missing = [];
        for (const n of names) {
          const u = await db.getUserByName(n);
          if (u && u.id !== uid) found.push(u.id);
          else if (!u) missing.push(n);
        }
        if (missing.length) return err(res, `No one called ${missing.join(", ")} uses the app — check the name they sign in with`);
        if (!found.length) return err(res, "Add at least one friend (not yourself)");
        const list = await db.createWatchList(uid, name, found);
        await Promise.all(found.map((f) => sendToUser(f, { title: "🍿 New watch-together list", body: `${user.name} shared "${name}" with you.`, url: "/movies?tab=watchlist" }).catch(() => {})));
        return res.status(201).json({ list });
      }
      if (type === "watch-list-item") {
        const listId = parseInt(body.listId, 10);
        const title = String(body.title || "").trim().slice(0, 120);
        if (!listId || !title) return err(res, "Pick a movie");
        const item = await db.addWatchListItem(uid, listId, { title, tmdbId: body.tmdbId, note: String(body.note || "").slice(0, 100) });
        if (!item) return err(res, "You're not in that list", 403);
        const others = await db.watchListOthers(uid, listId);
        await Promise.all(others.map((o) => sendToUser(o, { title: `🎬 ${user.name} added ${title}`, body: "To your watch-together list.", url: "/movies?tab=watchlist" }).catch(() => {})));
        return res.status(201).json({ item });
      }

      if (type === "tv-show") {
        const title = String(body.title || "").trim().slice(0, 120);
        if (!title) return err(res, "Pick a show");
        const show = await db.createTvShow(uid, { ...body, title, platform: String(body.platform || "").slice(0, 40), note: String(body.note || "").slice(0, 140) });
        return res.status(201).json({ show });
      }

      // Rate a movie after watching it (it may have been logged as a booking).
      if (type === "movie-rate") {
        const id = parseInt(body.id, 10);
        if (isNaN(id)) return err(res, "Invalid id");
        if (body.canteenPrice != null && body.canteenPrice !== "" && !(parseFloat(body.canteenPrice) >= 0)) return err(res, "Snacks can't be negative");
        const movie = await db.rateMovie(uid, id, body);
        if (!movie) return err(res, "Movie not found", 404);
        return res.status(200).json({ movie });
      }

      // "How much was Electricity this month?" for an amount-varies bill.
      if (type === "variable-bill") {
        const id = parseInt(body.id, 10);
        const amount = parseFloat(body.amount);
        if (isNaN(id)) return err(res, "Invalid id");
        if (!amount || amount <= 0) return err(res, "Enter the amount");
        const logged = await db.logVariableBill(uid, id, amount);
        if (!logged) return err(res, "Already logged for this month", 409);
        const { ym } = localDateParts();
        await db.markBillPaid(uid, id, ym, true);
        return res.status(201).json({ ok: true, expenseId: logged.id });
      }

      // After paying in a UPI app: "Did it go through?"
      if (type === "bill-paid") {
        const id = parseInt(body.id, 10);
        if (isNaN(id)) return err(res, "Invalid id");
        const { ym } = localDateParts();
        const paid = await db.markBillPaid(uid, id, ym, body.paid !== false);
        return res.status(200).json({ paid });
      }

      // Estimate -> real amount (and maybe the receipt that came later).
      if (type === "finalize-expense") {
        const id = parseInt(body.id, 10);
        const amount = parseFloat(body.amount);
        if (isNaN(id)) return err(res, "Invalid id");
        if (!amount || amount <= 0) return err(res, "Enter the final amount");
        const expense = await db.finalizeExpense(uid, id, { amount, receiptPhoto: body.receiptPhoto });
        if (!expense) return err(res, "Expense not found", 404);
        return res.status(200).json({ expense });
      }

      if (type === "backup-now") {
        await db.saveBackup(uid, JSON.stringify(await buildExport(uid)));
        return res.status(201).json({ backups: await db.listBackups(uid) });
      }
      // Restoring merges the snapshot back in; rows already present are skipped.
      if (type === "restore-backup") {
        const payload = await db.getBackup(uid, parseInt(body.id, 10));
        if (!payload) return err(res, "Backup not found", 404);
        const results = await db.importAll(uid, JSON.parse(payload));
        return res.status(201).json({ ok: true, results });
      }

      if (type === "shared-group") {
        const name = String(body.name || "").trim().slice(0, 60);
        const members = [...new Set((Array.isArray(body.members) ? body.members : []).map((m) => String(m).trim().slice(0, 40)).filter(Boolean))];
        if (!name) return err(res, "Give the space a name");
        if (members.length < 2) return err(res, "Add at least two people (including you)");
        const token = require("crypto").randomBytes(18).toString("base64url");
        const group = await db.createSharedGroup(uid, { name, members: members.slice(0, 12), token });
        return res.status(201).json({ group: { ...group, members: JSON.parse(group.members) } });
      }

      if (type === "mini-challenges") {
        if (!Array.isArray(body.challenges)) return err(res, "Challenges must be a list");
        const clean = body.challenges.slice(-20).map((c) => ({
          id: String(c.id).slice(0, 60), template: String(c.template).slice(0, 40), start: String(c.start).slice(0, 10),
          days: Math.min(31, Math.max(1, parseInt(c.days, 10) || 7)), param: c.param == null ? null : Number(c.param),
          dismissed: !!c.dismissed,
        }));
        await db.setUserSetting(uid, "mini_challenges", JSON.stringify(clean));
        return res.status(201).json({ challenges: clean });
      }

      if (type === "milestone-rewards") {
        if (!body.rewards || typeof body.rewards !== "object") return err(res, "Rewards must be an object");
        const rewards = await db.setMilestoneRewards(uid, body.rewards);
        return res.status(201).json({ rewards });
      }

      if (type === "categories") {
        if (!Array.isArray(body.categories)) return err(res, "Categories must be a list");
        await db.setUserSetting(uid, "custom_categories", JSON.stringify(body.categories));
        return res.status(201).json({ ok: true });
      }

      if (type === "theatres") {
        if (!Array.isArray(body.theatres)) return err(res, "Theatres must be a list");
        await db.setUserSetting(uid, "custom_theatres", JSON.stringify(body.theatres));
        return res.status(201).json({ ok: true });
      }

      if (type === "ott-platforms") {
        if (!Array.isArray(body.ottPlatforms)) return err(res, "Platforms must be a list");
        await db.setUserSetting(uid, "custom_ott_platforms", JSON.stringify(body.ottPlatforms));
        return res.status(201).json({ ok: true });
      }

      if (type === "save-subscription") {
        const sub = body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return err(res, "Invalid subscription");
        await db.saveSubscription(uid, { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
        return res.status(201).json({ ok: true });
      }

      if (type === "remove-subscription") {
        if (!body.endpoint) return err(res, "Missing endpoint");
        await db.deleteSubscription(body.endpoint);
        return res.status(200).json({ ok: true });
      }

      if (type === "set-pin") {
        if (body.pin && !/^[0-9]{4,8}$/.test(body.pin)) return err(res, "PIN must be 4-8 digits");
        // With more than one person, everyone needs a PIN to sign in.
        if (!body.pin && (await db.countUsers()) > 1) return err(res, "Everyone needs a PIN once more than one person uses the app");
        const hash = body.pin ? hashPin(body.pin) : "";
        await db.setUserPin(uid, hash);
        // The new PIN signs out your other devices; this one stays signed in.
        if (hash) await issueSession(res, { ...user, pin_hash: hash });
        else clearSessionCookie(res);
        return res.status(201).json({ ok: true });
      }

      if (type === "rename") {
        const name = cleanName(body.name);
        if (!name) return err(res, "Enter a name");
        const other = await db.getUserByName(name);
        if (other && other.id !== uid) return err(res, "Someone already uses that name");
        return res.status(200).json({ user: await db.renameUser(uid, name) });
      }

      if (type === "logout") {
        clearSessionCookie(res);
        return res.status(200).json({ ok: true });
      }

      // Sign in with name + PIN. The name can be left out while the app has
      // a single person (the original one-PIN lock screen keeps working).
      if (type === "verify-pin") {
        const users = await db.listUsers();
        let target = null;
        if (body.name) target = await db.getUserByName(body.name);
        else if (users.length === 1) target = await db.getUser(users[0].id);
        else return res.status(200).json({ ok: false, needName: true, error: "Enter your name" });
        if (target && !target.pin_hash && users.length === 1) {
          await issueSession(res, target);
          return res.status(200).json({ ok: true });
        }
        // Unknown name: same answer as a wrong PIN, so names can't be probed.
        if (!target) return res.status(200).json({ ok: false, error: "Name or PIN doesn't match" });

        const lockedUntil = Number(target.locked_until) || 0;
        if (Date.now() < lockedUntil) {
          return res.status(200).json({ ok: false, locked: true, waitSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) });
        }
        const check = verifyPin(String(body.pin || ""), target.pin_hash);
        if (check.ok) {
          let current = target;
          if (check.needsUpgrade) {
            // One-time move from the old unsalted SHA-256 to scrypt.
            current = { ...target, pin_hash: hashPin(String(body.pin)) };
            await db.setUserPin(target.id, current.pin_hash);
          } else {
            await db.recordLoginAttempt(target.id, { ok: true });
          }
          await issueSession(res, current);
          return res.status(200).json({ ok: true, user: { id: current.id, name: current.name } });
        }
        const attempts = (Number(target.failed_attempts) || 0) + 1;
        const waitSeconds = attempts >= 5 ? Math.min(300, 15 * Math.pow(2, attempts - 5)) : 0;
        await db.recordLoginAttempt(target.id, { ok: false, failedAttempts: attempts, lockedUntil: waitSeconds ? Date.now() + waitSeconds * 1000 : 0 });
        return res.status(200).json({ ok: false, locked: waitSeconds > 0, waitSeconds, attemptsLeft: Math.max(0, 5 - attempts), error: "Name or PIN doesn't match" });
      }

      // Invite a friend: a one-time code, valid 7 days. Only the owner
      // invites, and only once they have a PIN (with two people, nobody can
      // be signed in automatically any more).
      if (type === "invite") {
        if (!user.is_owner) return err(res, "Only the app's owner can invite people", 403);
        if (!user.pin_hash) return err(res, "Set a PIN for yourself first (Security, below) — with two people, everyone signs in with a PIN");
        const invite = await db.createInvite(uid, newInviteCode());
        return res.status(201).json({ invite });
      }

      // Join with an invite: pick a name and PIN, get your own empty ledger.
      if (type === "join") {
        const code = cleanCode(body.code);
        const name = cleanName(body.name);
        if (!name) return err(res, "Enter your name");
        if (!/^[0-9]{4,8}$/.test(String(body.pin || ""))) return err(res, "PIN must be 4-8 digits");
        if (await db.getUserByName(name)) return err(res, "That name is taken — try adding an initial");
        let created;
        try {
          created = await db.joinWithInvite(code, { name, pinHash: hashPin(String(body.pin)) });
        } catch (e) {
          if (e?.code === "23505") return err(res, "That name is taken — try adding an initial");
          throw e;
        }
        if (!created) return err(res, "This invite code is wrong, used or expired — ask for a new one", 404);
        await issueSession(res, created);
        return res.status(201).json({ ok: true, user: { id: created.id, name: created.name } });
      }

      if (type === "import-all") {
        if (!body.data || typeof body.data !== "object") return err(res, "No import data received");
        const results = await db.importAll(uid, body.data);
        return res.status(201).json({ ok: true, results });
      }

      if (type === "challenge-archive") {
        if (!body.startDate || !body.lengthDays) return err(res, "Missing challenge info");
        await db.archiveChallenge(uid, {
          startDate: body.startDate,
          lengthDays: body.lengthDays,
          completedDays: body.completedDays || 0,
          longestStreak: body.longestStreak || 0,
        });
        return res.status(201).json({ ok: true });
      }

      return err(res, "Unknown type");
    }

    if (req.method === "PUT") {
      const body = req.body;
      const { type, id } = body;
      const numId = parseInt(id, 10);
      if (isNaN(numId)) return err(res, "Invalid id");

      if (type === "expenses") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!body.date) return err(res, "Date is required");
        const expense = await db.updateExpense(uid, numId, { amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance, receiptPhoto: body.receiptPhoto, isEstimate: body.isEstimate, accountId: body.accountId, tripId: body.tripId, taxTag: body.taxTag });
        return res.status(200).json({ expense });
      }

      if (type === "accounts") {
        if (!String(body.name || "").trim()) return err(res, "Give the account a name");
        const account = await db.updateAccount(uid, numId, body);
        if (!account) return err(res, "Account not found", 404);
        return res.status(200).json({ account });
      }

      if (type === "loan") {
        const loan = await db.updateLoan(uid, numId, body);
        if (!loan) return err(res, "Loan not found", 404);
        return res.status(200).json({ loan });
      }

      if (type === "asset") {
        const asset = await db.saveAsset(uid, numId, body);
        if (!asset) return err(res, "Not found", 404);
        return res.status(200).json({ asset });
      }

      if (type === "trip") {
        if (body.endDate && body.startDate && body.endDate < body.startDate) return err(res, "The end date is before the start");
        const trip = await db.saveTrip(uid, numId, body);
        if (!trip) return err(res, "Trip not found", 404);
        return res.status(200).json({ trip });
      }

      if (type === "movies") {
        const ticketPrice = parseFloat(body.ticketPrice) || 0;
        const canteenPrice = parseFloat(body.canteenPrice) || 0;
        const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
        if (!body.title?.trim()) return err(res, "Movie title is required");
        if (!body.date) return err(res, "Date is required");
        const movie = await db.updateMovie(uid, numId, {
          title: body.title.trim(), date: body.date, time: body.time, ticketPrice, canteenPrice,
          companions: (body.companions || "").trim(), myTake: body.myTake, publicTake: body.publicTake,
          note: (body.note || "").trim(), affectsBalance: body.affectsBalance, quantity,
          venueType: body.venueType, venueName: (body.venueName || "").trim(), genre: (body.genre || "").trim(), rating: body.rating, review: (body.review || "").trim(),
          tmdbId: body.tmdbId,
        });
        return res.status(200).json({ movie });
      }

      if (type === "balance") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Enter an amount greater than 0");
        if (!body.date) return err(res, "Date is required");
        const topup = await db.updateTopup(uid, numId, { amount, note: body.note, date: body.date, mode: body.mode });
        return res.status(200).json({ topup });
      }

      if (type === "recurring") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurring = await db.updateRecurring(uid, numId, { amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance, upiId: body.upiId, variable: !!body.variable, accountId: body.accountId });
        return res.status(200).json({ recurring });
      }

      if (type === "recurring-income") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurringIncome = await db.updateRecurringIncome(uid, numId, { amount, note: body.note, dayOfMonth });
        return res.status(200).json({ recurringIncome });
      }

      if (type === "watch-list-item") {
        const item = await db.updateWatchListItem(uid, numId, { watched: body.watched });
        if (!item) return err(res, "Not found", 404);
        return res.status(200).json({ item });
      }

      if (type === "tv-show") {
        const show = await db.updateTvShow(uid, numId, { ...body, platform: String(body.platform || "").slice(0, 40), note: String(body.note || "").slice(0, 140) });
        if (!show) return err(res, "Show not found", 404);
        return res.status(200).json({ show });
      }

      if (type === "ious") {
        const amount = parseFloat(body.amount);
        if (!body.personName?.trim()) return err(res, "Name is required");
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!["owed_to_me", "i_owe"].includes(body.direction)) return err(res, "Invalid direction");
        const iou = await db.updateIou(uid, numId, {
          personName: body.personName.trim(), amount, direction: body.direction,
          note: (body.note || "").trim(), dueDate: body.dueDate || null, settled: !!body.settled,
        });
        return res.status(200).json({ iou });
      }

      return err(res, "Unknown type");
    }

    if (req.method === "DELETE") {
      const { type, id } = req.query;
      if (type === "invite") {
        await db.deleteInvite(uid, cleanCode(req.query.code));
        return res.status(200).json({ ok: true });
      }
      const numId = parseInt(id, 10);
      if (isNaN(numId)) return err(res, "Invalid id");
      if (type === "expenses") await db.deleteExpense(uid, numId);
      else if (type === "movies") await db.deleteMovie(uid, numId);
      else if (type === "balance") await db.deleteTopup(uid, numId);
      else if (type === "budget") await db.deleteBudgetRule(uid, numId);
      else if (type === "recurring") await db.deleteRecurring(uid, numId);
      else if (type === "recurring-income") await db.deleteRecurringIncome(uid, numId);
      else if (type === "ious") await db.deleteIou(uid, numId);
      else if (type === "watchlist") await db.deleteWatchlistItem(uid, numId);
      else if (type === "shared-group") await db.deleteSharedGroup(uid, numId);
      else if (type === "tv-show") await db.deleteTvShow(uid, numId);
      else if (type === "watch-list") await db.leaveOrDeleteWatchList(uid, numId);
      else if (type === "watch-list-item") await db.deleteWatchListItem(uid, numId);
      else if (type === "follow") await db.unfollowPerson(uid, numId);
      else if (type === "sugar-log") await db.deleteSugarLog(uid, numId);
      else if (type === "accounts") await db.deleteAccount(uid, numId);
      else if (type === "transfer") await db.deleteTransfer(uid, numId);
      else if (type === "loan") await db.deleteLoan(uid, numId);
      else if (type === "asset") await db.deleteAsset(uid, numId);
      else if (type === "trip") await db.deleteTrip(uid, numId);
      else if (type === "life") await db.deleteLife(uid, numId);
      else return err(res, "Unknown type");
      return res.status(200).json({ ok: true });
    }

    return err(res, "Method not allowed", 405);
  } catch (e) {
    const where = `${req.method} ${req.query?.type || req.body?.type || "?"}`;
    if (e && e.status === 400) return err(res, e.message, 400);
    console.error(`[api/data] ${where} failed:`, e);
    // Postgres class 22 = bad input data (invalid date, number too large, …):
    // that's the request's fault, so say what was wrong instead of a bare 500.
    if (e && typeof e.code === "string" && e.code.startsWith("22")) {
      return err(res, `Invalid value: ${e.message}`, 400);
    }
    return res.status(500).json({ error: `Server error (${where}) — details are in the Vercel function logs` });
  }
}
