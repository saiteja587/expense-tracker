import * as db from "../../lib/db";
import crypto from "crypto";
import { issueSession, clearSessionCookie, resolveUser, hashPin, verifyPin } from "../../lib/auth";
import { localDateParts } from "../../lib/dates";

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
  const [expenses, movies, topups, rules, recurring, recurringIncome, ious, watchlist] = await Promise.all([
    db.listExpenses(uid), db.listMovies(uid), db.listTopups(uid), db.listBudgetRules(uid), db.listRecurring(uid),
    db.listRecurringIncome(uid), db.listIous(uid), db.listWatchlist(uid),
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
    expenses, movies, topups, budgetRules: rules, recurring, recurringIncome, ious, watchlist,
    sugarChallenge: { meta: challengeMeta, days: challengeDays, history: challengeHistory },
    customCategories: (await setting("custom_categories")) || [],
    theatres: await setting("custom_theatres"),
    ottPlatforms: await setting("custom_ott_platforms"),
    savingsGoal: await setting("savings_goal"),
    milestoneRewards: (await setting("milestone_rewards")) || {},
    miniChallenges: (await setting("mini_challenges")) || [],
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

// ---- TMDB search / now showing (needs TMDB_API_KEY; empty without it) ----
// TMDB genre ids → the app's genre list.
const TMDB_GENRES = {
  28: "Action", 12: "Action", 10752: "Action", 37: "Action", 16: "Animation", 35: "Comedy", 10751: "Comedy",
  80: "Thriller", 53: "Thriller", 9648: "Thriller", 99: "Documentary", 18: "Drama", 36: "Drama",
  27: "Horror", 10749: "Romance", 878: "Sci-Fi", 14: "Sci-Fi",
};
// The crowd's verdict from TMDB's audience score (only with enough votes).
function crowdTake(avg, votes) {
  if (!votes || votes < 15 || !avg) return "";
  return avg >= 7.5 ? "loved" : avg >= 6.5 ? "liked" : avg >= 5.5 ? "okay" : "disliked";
}
async function tmdb(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  const isBearer = apiKey.startsWith("eyJ");
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!isBearer) url.searchParams.set("api_key", apiKey);
  const r = await fetch(url, { headers: isBearer ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}
const LANGS = { te: "Telugu", ta: "Tamil", hi: "Hindi", ml: "Malayalam", kn: "Kannada", en: "English", bn: "Bengali", mr: "Marathi", ko: "Korean", ja: "Japanese" };
function shapeMovie(m) {
  const year = (m.release_date || "").slice(0, 4);
  return {
    tmdbId: m.id,
    title: m.title || m.original_title,
    year,
    releaseDate: m.release_date || "",
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w154${m.poster_path}` : null,
    genre: (m.genre_ids || []).map((g) => TMDB_GENRES[g]).find(Boolean) || "",
    rating: m.vote_count >= 15 ? Math.round(m.vote_average * 10) / 10 : null,
    votes: m.vote_count || 0,
    crowdTake: crowdTake(m.vote_average, m.vote_count),
    language: LANGS[m.original_language] || "",
    overview: (m.overview || "").slice(0, 220),
  };
}
const searchCache = new Map(); // query → { at, results }
const SEARCH_TTL = 6 * 3600 * 1000;
async function searchMovies(q) {
  const key = q.toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.results;
  const d = await tmdb("/search/movie", { query: q, include_adult: "false", region: "IN" });
  // Popular, well-known matches first; then whatever else matched.
  const results = (d.results || [])
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 7)
    .map(shapeMovie);
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(key, { at: Date.now(), results });
  return results;
}
let nowCache = null;
async function nowShowing() {
  if (nowCache && Date.now() - nowCache.at < SEARCH_TTL) return nowCache;
  const [now, soon] = await Promise.all([
    tmdb("/movie/now_playing", { region: "IN", page: 1 }),
    tmdb("/movie/upcoming", { region: "IN", page: 1 }),
  ]);
  const shape = (list) => (list.results || []).filter((m) => m.poster_path).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 12).map(shapeMovie);
  nowCache = { at: Date.now(), nowPlaying: shape(now), upcoming: shape(soon) };
  return nowCache;
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
      // Type-ahead for movie titles.
      if (type === "movie-search") {
        const q = String(req.query.q || "").trim().slice(0, 80);
        if (q.length < 2 || !process.env.TMDB_API_KEY) return res.status(200).json({ results: [] });
        try {
          return res.status(200).json({ results: await searchMovies(q) });
        } catch (e) {
          console.error("[movie-search]", e.message);
          return res.status(200).json({ results: [] });
        }
      }
      // What's in Indian theatres now, and coming soon.
      if (type === "now-showing") {
        if (!process.env.TMDB_API_KEY) return res.status(200).json({ nowPlaying: [], upcoming: [] });
        try {
          const d = await nowShowing();
          return res.status(200).json({ nowPlaying: d.nowPlaying, upcoming: d.upcoming });
        } catch (e) {
          console.error("[now-showing]", e.message);
          return res.status(200).json({ nowPlaying: [], upcoming: [] });
        }
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
        const expense = await db.createExpense(uid, { amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance, receiptPhoto: body.receiptPhoto, clientRequestId: body.clientRequestId, isEstimate: !!body.isEstimate });
        return res.status(201).json({ expense });
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
          clientRequestId: body.clientRequestId,
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
        const recurring = await db.createRecurring(uid, { amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance, upiId: body.upiId, variable: !!body.variable });
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
        const item = await db.createWatchlistItem(uid, { title: body.title.trim(), note: (body.note || "").trim() });
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
        const expense = await db.updateExpense(uid, numId, { amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance, receiptPhoto: body.receiptPhoto, isEstimate: body.isEstimate });
        return res.status(200).json({ expense });
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
        const recurring = await db.updateRecurring(uid, numId, { amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance, upiId: body.upiId, variable: !!body.variable });
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
      else return err(res, "Unknown type");
      return res.status(200).json({ ok: true });
    }

    return err(res, "Method not allowed", 405);
  } catch (e) {
    const where = `${req.method} ${req.query?.type || req.body?.type || "?"}`;
    console.error(`[api/data] ${where} failed:`, e);
    // Postgres class 22 = bad input data (invalid date, number too large, …):
    // that's the request's fault, so say what was wrong instead of a bare 500.
    if (e && typeof e.code === "string" && e.code.startsWith("22")) {
      return err(res, `Invalid value: ${e.message}`, 400);
    }
    return res.status(500).json({ error: `Server error (${where}) — details are in the Vercel function logs` });
  }
}
