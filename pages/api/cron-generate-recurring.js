import { listExpenses } from "../../lib/db";

// Vercel Cron calls this once a day (see vercel.json). listExpenses() already
// triggers the recurring-expense generation as a side effect, so calling it
// here is enough — no separate logic needed.
export default async function handler(req, res) {
  try {
    await listExpenses();
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to run recurring check" });
  }
}
