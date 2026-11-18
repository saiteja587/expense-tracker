import crypto from "crypto";

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
// CRON_SECRET env var is set on the project. Anything else is refused, so the
// cron URLs can't be triggered by whoever finds them.
// Fails closed: if CRON_SECRET isn't configured, the endpoint refuses to run.
export function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function rejectCron(res) {
  const configured = !!process.env.CRON_SECRET;
  return res.status(401).json({
    error: configured ? "Unauthorized" : "CRON_SECRET is not set on the server",
  });
}
