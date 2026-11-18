import { listExpenses, listTopups } from "../../lib/db";
import { isAuthorizedCron, rejectCron } from "../../lib/cronAuth";

// Vercel Cron calls this once a day (see vercel.json). listExpenses() already
// triggers the recurring-expense generation as a side effect, so calling it
// here is enough — no separate logic needed.
export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    // Listing triggers generation of any due recurring expenses / income.
    await listExpenses();
    await listTopups();
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to run recurring check" });
  }
}
