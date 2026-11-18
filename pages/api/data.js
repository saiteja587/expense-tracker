import * as db from "../../lib/db";
import { getPinHash, issueSession, clearSessionCookie, hasValidSession, hashPin, verifyPin } from "../../lib/auth";

// Calls the lock screen needs before the user has unlocked. Everything else
// requires a valid session cookie whenever a PIN is set.
const PUBLIC_TYPES = {
  GET: new Set(["pin-status", "session", "vapid-public-key"]),
  POST: new Set(["verify-pin", "logout"]),
};

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

function err(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

export default async function handler(req, res) {
  try {
    const pinHash = await getPinHash();
    const reqType = req.method === "GET" || req.method === "DELETE" ? req.query.type : req.body?.type;
    const isPublic = PUBLIC_TYPES[req.method]?.has(reqType);
    if (pinHash && !isPublic && !(await hasValidSession(req, res, pinHash))) {
      return err(res, "Locked — enter your PIN", 401);
    }

    if (req.method === "GET") {
      const { type } = req.query;
      if (type === "session") {
        const authenticated = !pinHash || (await hasValidSession(req, null, pinHash));
        return res.status(200).json({ hasPin: !!pinHash, authenticated });
      }
      if (type === "expenses") return res.status(200).json({ expenses: await db.listExpenses() });
      if (type === "movies") return res.status(200).json({ movies: await db.listMovies() });
      if (type === "balance") return res.status(200).json({ topups: await db.listTopups() });
      if (type === "budget") return res.status(200).json({ rules: await db.listBudgetRules() });
      if (type === "challenge") {
        const meta = await db.getChallengeMeta();
        const days = await db.listChallengeDays();
        const history = await db.listChallengeHistory();
        return res.status(200).json({ meta, days, history });
      }
      if (type === "recurring") return res.status(200).json({ recurring: await db.listRecurring() });
      if (type === "recurring-income") return res.status(200).json({ recurringIncome: await db.listRecurringIncome() });
      if (type === "ious") return res.status(200).json({ ious: await db.listIous() });
      if (type === "recurring-confirmations") return res.status(200).json({ confirmations: await db.getRecurringConfirmations() });
      if (type === "watchlist") return res.status(200).json({ watchlist: await db.listWatchlist() });
      if (type === "savings-goal") return res.status(200).json({ goal: await db.getSavingsGoal() });
      if (type === "milestone-rewards") return res.status(200).json({ rewards: await db.getMilestoneRewards() });
      if (type === "mini-challenges") {
        const raw = await db.getSetting("mini_challenges");
        return res.status(200).json({ challenges: raw ? JSON.parse(raw) : [] });
      }
      // Movie poster lookup via TMDB (free API key in TMDB_API_KEY). Without a
      // key the app shows generated poster tiles instead.
      if (type === "poster") {
        const title = String(req.query.title || "").trim().slice(0, 120);
        if (!title || !process.env.TMDB_API_KEY) return res.status(200).json({ url: null });
        return res.status(200).json({ url: await lookupPoster(title, req.query.year) });
      }
      if (type === "categories") {
        const raw = await db.getSetting("custom_categories");
        return res.status(200).json({ categories: raw ? JSON.parse(raw) : [] });
      }
      if (type === "theatres") {
        const raw = await db.getSetting("custom_theatres");
        return res.status(200).json({ theatres: raw ? JSON.parse(raw) : ["PVR", "INOX", "Cinepolis", "Miraj Cinemas", "Asian Cinemas", "AMB Cinemas", "Sudarshan 35MM"] });
      }
      if (type === "ott-platforms") {
        const raw = await db.getSetting("custom_ott_platforms");
        return res.status(200).json({ ottPlatforms: raw ? JSON.parse(raw) : ["Netflix", "Amazon Prime Video", "Disney+ Hotstar", "SonyLIV", "ZEE5", "JioCinema", "Apple TV+", "MX Player"] });
      }
      if (type === "vapid-public-key") {
        return res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || null });
      }
      if (type === "pin-status") {
        return res.status(200).json({ hasPin: !!pinHash });
      }
      // Receipt photos by expense id: ?type=receipts&ids=1,2,3 (max 10 per call,
      // keeping the response well under Vercel's ~4.5MB limit).
      if (type === "receipts") {
        const ids = String(req.query.ids || "").split(",").map((n) => parseInt(n, 10)).filter((n) => !isNaN(n)).slice(0, 10);
        const receipts = {};
        for (const id of ids) receipts[id] = await db.getExpenseReceipt(id);
        return res.status(200).json({ receipts });
      }
      // Everything except receipt photos (they'd blow past the response size
      // limit). The client fetches those separately via ?type=receipts, using
      // has_receipt on each expense, and merges them into the backup file.
      if (type === "export-all") {
        const [expenses, movies, topups, rules, recurring, recurringIncome, ious, watchlist] = await Promise.all([
          db.listExpenses(), db.listMovies(), db.listTopups(), db.listBudgetRules(), db.listRecurring(),
          db.listRecurringIncome(), db.listIous(), db.listWatchlist(),
        ]);
        const challengeMeta = await db.getChallengeMeta();
        const challengeDays = await db.listChallengeDays();
        const challengeHistory = await db.listChallengeHistory();
        const setting = async (key) => {
          const raw = await db.getSetting(key);
          return raw ? JSON.parse(raw) : null;
        };
        return res.status(200).json({
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
        });
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
        const expense = await db.createExpense({ amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance, receiptPhoto: body.receiptPhoto, clientRequestId: body.clientRequestId });
        return res.status(201).json({ expense });
      }

      if (type === "movies") {
        const ticketPrice = parseFloat(body.ticketPrice) || 0;
        const canteenPrice = parseFloat(body.canteenPrice) || 0;
        const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
        if (!body.title?.trim()) return err(res, "Movie title is required");
        if (!body.date) return err(res, "Date is required");
        if (ticketPrice < 0 || canteenPrice < 0) return err(res, "Prices can't be negative");
        const movie = await db.createMovie({
          title: body.title.trim(), date: body.date, time: body.time, ticketPrice, canteenPrice,
          companions: (body.companions || "").trim(), myTake: body.myTake, publicTake: body.publicTake,
          note: (body.note || "").trim(), affectsBalance: body.affectsBalance, quantity,
          venueType: body.venueType, venueName: (body.venueName || "").trim(), genre: (body.genre || "").trim(),
          clientRequestId: body.clientRequestId,
        });
        return res.status(201).json({ movie });
      }

      if (type === "balance") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Enter an amount greater than 0");
        if (!body.date) return err(res, "Date is required");
        const topup = await db.createTopup({ amount, note: body.note, date: body.date, mode: body.mode });
        return res.status(201).json({ topup });
      }

      if (type === "budget") {
        const amount = parseFloat(body.amount);
        // low_balance (alert threshold) and movie_count (monthly guideline) are set
        // from the Rules page; they were missing here, so saving them always failed.
        if (!["overall", "category", "savings", "low_balance", "movie_count"].includes(body.ruleType)) return err(res, "Invalid rule type");
        if (!amount || amount <= 0) return err(res, "Enter an amount greater than 0");
        if (body.ruleType === "category" && !body.category) return err(res, "Pick a category");
        const rule = await db.upsertBudgetRule({ ruleType: body.ruleType, category: body.category, amount });
        return res.status(201).json({ rule });
      }

      if (type === "challenge-meta") {
        const lengthDays = parseInt(body.lengthDays, 10) || 41;
        if (!body.startDate) return err(res, "Pick a start date");
        if (lengthDays < 1 || lengthDays > 365) return err(res, "Length must be between 1 and 365 days");
        const sugarPerDay = parseFloat(body.sugarPerDay) || 0;
        const savingsPerDay = parseFloat(body.savingsPerDay) || 0;
        const meta = await db.setChallengeMeta(body.startDate, lengthDays, sugarPerDay, savingsPerDay);
        return res.status(201).json({ meta });
      }

      if (type === "challenge-day") {
        if (!body.date) return err(res, "Date is required");
        if (typeof body.completed !== "boolean") return err(res, "Completed must be true or false");
        const day = await db.upsertChallengeDay(body.date, body.completed, body.note, body.reason, body.naturalSugar);
        return res.status(201).json({ day });
      }

      if (type === "confirm-recurring") {
        if (!body.id) return err(res, "Missing id");
        const confirmations = await db.confirmRecurring(body.id);
        return res.status(201).json({ ok: true, confirmations });
      }

      if (type === "recurring") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurring = await db.createRecurring({ amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance });
        return res.status(201).json({ recurring });
      }

      if (type === "recurring-income") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurringIncome = await db.createRecurringIncome({ amount, note: body.note, dayOfMonth });
        return res.status(201).json({ recurringIncome });
      }

      if (type === "ious") {
        const amount = parseFloat(body.amount);
        if (!body.personName?.trim()) return err(res, "Name is required");
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!["owed_to_me", "i_owe"].includes(body.direction)) return err(res, "Invalid direction");
        const iou = await db.createIou({
          personName: body.personName.trim(), amount, direction: body.direction,
          note: (body.note || "").trim(), dueDate: body.dueDate || null,
        });
        return res.status(201).json({ iou });
      }

      if (type === "watchlist") {
        if (!body.title?.trim()) return err(res, "Title is required");
        const item = await db.createWatchlistItem({ title: body.title.trim(), note: (body.note || "").trim() });
        return res.status(201).json({ item });
      }

      if (type === "savings-goal") {
        if (body.clear) {
          await db.setSavingsGoal(null);
          return res.status(201).json({ goal: null });
        }
        const targetAmount = parseFloat(body.targetAmount);
        if (!targetAmount || targetAmount <= 0) return err(res, "Enter a target amount greater than 0");
        const goal = await db.setSavingsGoal({ targetAmount, targetDate: body.targetDate || null, label: (body.label || "").trim() });
        return res.status(201).json({ goal });
      }

      if (type === "mini-challenges") {
        if (!Array.isArray(body.challenges)) return err(res, "Challenges must be a list");
        const clean = body.challenges.slice(-20).map((c) => ({
          id: String(c.id).slice(0, 60), template: String(c.template).slice(0, 40), start: String(c.start).slice(0, 10),
          days: Math.min(31, Math.max(1, parseInt(c.days, 10) || 7)), param: c.param == null ? null : Number(c.param),
          dismissed: !!c.dismissed,
        }));
        await db.setSetting("mini_challenges", JSON.stringify(clean));
        return res.status(201).json({ challenges: clean });
      }

      if (type === "milestone-rewards") {
        if (!body.rewards || typeof body.rewards !== "object") return err(res, "Rewards must be an object");
        const rewards = await db.setMilestoneRewards(body.rewards);
        return res.status(201).json({ rewards });
      }

      if (type === "categories") {
        if (!Array.isArray(body.categories)) return err(res, "Categories must be a list");
        await db.setSetting("custom_categories", JSON.stringify(body.categories));
        return res.status(201).json({ ok: true });
      }

      if (type === "theatres") {
        if (!Array.isArray(body.theatres)) return err(res, "Theatres must be a list");
        await db.setSetting("custom_theatres", JSON.stringify(body.theatres));
        return res.status(201).json({ ok: true });
      }

      if (type === "ott-platforms") {
        if (!Array.isArray(body.ottPlatforms)) return err(res, "Platforms must be a list");
        await db.setSetting("custom_ott_platforms", JSON.stringify(body.ottPlatforms));
        return res.status(201).json({ ok: true });
      }

      if (type === "save-subscription") {
        const sub = body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return err(res, "Invalid subscription");
        await db.saveSubscription({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
        return res.status(201).json({ ok: true });
      }

      if (type === "remove-subscription") {
        if (!body.endpoint) return err(res, "Missing endpoint");
        await db.deleteSubscription(body.endpoint);
        return res.status(200).json({ ok: true });
      }

      if (type === "set-pin") {
        if (body.pin && !/^[0-9]{4,8}$/.test(body.pin)) return err(res, "PIN must be 4-8 digits");
        const hash = body.pin ? hashPin(body.pin) : "";
        await db.setSetting("app_pin_hash", hash);
        await db.setSetting("pin_failed_attempts", "0");
        await db.setSetting("pin_locked_until", "0");
        // The new PIN invalidates every other device's session; keep this one signed in.
        if (hash) await issueSession(res, hash);
        else clearSessionCookie(res);
        return res.status(201).json({ ok: true });
      }

      if (type === "logout") {
        clearSessionCookie(res);
        return res.status(200).json({ ok: true });
      }

      if (type === "verify-pin") {
        if (!pinHash) return res.status(200).json({ ok: true });

        const lockedUntil = parseInt((await db.getSetting("pin_locked_until")) || "0", 10);
        if (Date.now() < lockedUntil) {
          return res.status(200).json({ ok: false, locked: true, waitSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) });
        }

        const check = verifyPin(String(body.pin || ""), pinHash);
        if (check.ok) {
          await db.setSetting("pin_failed_attempts", "0");
          await db.setSetting("pin_locked_until", "0");
          let currentHash = pinHash;
          if (check.needsUpgrade) {
            // One-time move from the old unsalted SHA-256 to scrypt.
            currentHash = hashPin(String(body.pin));
            await db.setSetting("app_pin_hash", currentHash);
          }
          await issueSession(res, currentHash);
          return res.status(200).json({ ok: true });
        }

        const attempts = parseInt((await db.getSetting("pin_failed_attempts")) || "0", 10) + 1;
        await db.setSetting("pin_failed_attempts", String(attempts));
        let waitSeconds = 0;
        if (attempts >= 5) {
          waitSeconds = Math.min(300, 15 * Math.pow(2, attempts - 5));
          await db.setSetting("pin_locked_until", String(Date.now() + waitSeconds * 1000));
        }
        return res.status(200).json({ ok: false, locked: waitSeconds > 0, waitSeconds, attemptsLeft: Math.max(0, 5 - attempts) });
      }

      if (type === "import-all") {
        if (!body.data || typeof body.data !== "object") return err(res, "No import data received");
        const results = await db.importAll(body.data);
        return res.status(201).json({ ok: true, results });
      }

      if (type === "challenge-archive") {
        if (!body.startDate || !body.lengthDays) return err(res, "Missing challenge info");
        await db.archiveChallenge({
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
        const expense = await db.updateExpense(numId, { amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance, receiptPhoto: body.receiptPhoto });
        return res.status(200).json({ expense });
      }

      if (type === "movies") {
        const ticketPrice = parseFloat(body.ticketPrice) || 0;
        const canteenPrice = parseFloat(body.canteenPrice) || 0;
        const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
        if (!body.title?.trim()) return err(res, "Movie title is required");
        if (!body.date) return err(res, "Date is required");
        const movie = await db.updateMovie(numId, {
          title: body.title.trim(), date: body.date, time: body.time, ticketPrice, canteenPrice,
          companions: (body.companions || "").trim(), myTake: body.myTake, publicTake: body.publicTake,
          note: (body.note || "").trim(), affectsBalance: body.affectsBalance, quantity,
          venueType: body.venueType, venueName: (body.venueName || "").trim(), genre: (body.genre || "").trim(),
        });
        return res.status(200).json({ movie });
      }

      if (type === "balance") {
        const amount = parseFloat(body.amount);
        if (!amount || amount <= 0) return err(res, "Enter an amount greater than 0");
        if (!body.date) return err(res, "Date is required");
        const topup = await db.updateTopup(numId, { amount, note: body.note, date: body.date, mode: body.mode });
        return res.status(200).json({ topup });
      }

      if (type === "recurring") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurring = await db.updateRecurring(numId, { amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance });
        return res.status(200).json({ recurring });
      }

      if (type === "recurring-income") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) return err(res, "Day of month must be between 1 and 31");
        const recurringIncome = await db.updateRecurringIncome(numId, { amount, note: body.note, dayOfMonth });
        return res.status(200).json({ recurringIncome });
      }

      if (type === "ious") {
        const amount = parseFloat(body.amount);
        if (!body.personName?.trim()) return err(res, "Name is required");
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!["owed_to_me", "i_owe"].includes(body.direction)) return err(res, "Invalid direction");
        const iou = await db.updateIou(numId, {
          personName: body.personName.trim(), amount, direction: body.direction,
          note: (body.note || "").trim(), dueDate: body.dueDate || null, settled: !!body.settled,
        });
        return res.status(200).json({ iou });
      }

      return err(res, "Unknown type");
    }

    if (req.method === "DELETE") {
      const { type, id } = req.query;
      const numId = parseInt(id, 10);
      if (isNaN(numId)) return err(res, "Invalid id");
      if (type === "expenses") await db.deleteExpense(numId);
      else if (type === "movies") await db.deleteMovie(numId);
      else if (type === "balance") await db.deleteTopup(numId);
      else if (type === "budget") await db.deleteBudgetRule(numId);
      else if (type === "recurring") await db.deleteRecurring(numId);
      else if (type === "recurring-income") await db.deleteRecurringIncome(numId);
      else if (type === "ious") await db.deleteIou(numId);
      else if (type === "watchlist") await db.deleteWatchlistItem(numId);
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
