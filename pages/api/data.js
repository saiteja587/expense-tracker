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
        const meta = await db.setChallengeMeta(body.startDate, lengthDays);
        return res.status(201).json({ meta });
      }

      if (type === "challenge-day") {
        if (!body.date) return err(res, "Date is required");
        if (typeof body.completed !== "boolean") return err(res, "Completed must be true or false");
        const day = await db.upsertChallengeDay(body.date, body.completed, body.note);
        return res.status(201).json({ day });
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
      else return err(res, "Unknown type");
      return res.status(200).json({ ok: true });
    }

    return err(res, "Method not allowed", 405);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
