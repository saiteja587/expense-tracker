import { generateAllRecurring } from "../../lib/db";
import { isAuthorizedCron, rejectCron } from "../../lib/cronAuth";

// Vercel Cron calls this once a day (see vercel.json): adds everyone's due
// recurring expenses and income.
export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) return rejectCron(res);
  try {
    await generateAllRecurring();
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to run recurring check" });
  }
}
