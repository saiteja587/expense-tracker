import * as db from "../../lib/db";

function err(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { type } = req.query;
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
      if (type === "pin-status") {
        const hash = await db.getSetting("app_pin_hash");
        return res.status(200).json({ hasPin: !!hash });
      }
      if (type === "export-all") {
        const [expenses, movies, topups, rules, recurring] = await Promise.all([
          db.listExpenses(), db.listMovies(), db.listTopups(), db.listBudgetRules(), db.listRecurring(),
        ]);
        const challengeMeta = await db.getChallengeMeta();
        const challengeDays = await db.listChallengeDays();
        const challengeHistory = await db.listChallengeHistory();
        const categoriesRaw = await db.getSetting("custom_categories");
        return res.status(200).json({
          exportedAt: new Date().toISOString(),
          expenses, movies, topups, budgetRules: rules, recurring,
          sugarChallenge: { meta: challengeMeta, days: challengeDays, history: challengeHistory },
          customCategories: categoriesRaw ? JSON.parse(categoriesRaw) : [],
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
        const expense = await db.createExpense({ amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance });
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
          venueType: body.venueType, venueName: (body.venueName || "").trim(),
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
        if (!["overall", "category", "savings"].includes(body.ruleType)) return err(res, "Invalid rule type");
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
        const day = await db.upsertChallengeDay(body.date, body.completed, body.note);
        return res.status(201).json({ day });
      }

      if (type === "recurring") {
        const amount = parseFloat(body.amount);
        const dayOfMonth = parseInt(body.dayOfMonth, 10);
        if (!amount || amount <= 0) return err(res, "Amount must be greater than 0");
        if (!body.category) return err(res, "Category is required");
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 28) return err(res, "Day of month must be between 1 and 28");
        const recurring = await db.createRecurring({ amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance });
        return res.status(201).json({ recurring });
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

      if (type === "set-pin") {
        if (body.pin && !/^[0-9]{4,8}$/.test(body.pin)) return err(res, "PIN must be 4-8 digits");
        const crypto = require("crypto");
        const hash = body.pin ? crypto.createHash("sha256").update(body.pin).digest("hex") : "";
        await db.setSetting("app_pin_hash", hash);
        await db.setSetting("pin_failed_attempts", "0");
        await db.setSetting("pin_locked_until", "0");
        return res.status(201).json({ ok: true });
      }

      if (type === "verify-pin") {
        const storedHash = await db.getSetting("app_pin_hash");
        if (!storedHash) return res.status(200).json({ ok: true });

        const lockedUntil = parseInt((await db.getSetting("pin_locked_until")) || "0", 10);
        if (Date.now() < lockedUntil) {
          return res.status(200).json({ ok: false, locked: true, waitSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) });
        }

        const crypto = require("crypto");
        const inputHash = crypto.createHash("sha256").update(body.pin || "").digest("hex");
        if (inputHash === storedHash) {
          await db.setSetting("pin_failed_attempts", "0");
          await db.setSetting("pin_locked_until", "0");
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
        const expense = await db.updateExpense(numId, { amount, category: body.category, note: body.note, date: body.date, time: body.time, affectsBalance: body.affectsBalance });
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
          venueType: body.venueType, venueName: (body.venueName || "").trim(),
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
        if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 28) return err(res, "Day of month must be between 1 and 28");
        const recurring = await db.updateRecurring(numId, { amount, category: body.category, note: body.note, dayOfMonth, affectsBalance: body.affectsBalance });
        return res.status(200).json({ recurring });
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
      else return err(res, "Unknown type");
      return res.status(200).json({ ok: true });
    }

    return err(res, "Method not allowed", 405);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
