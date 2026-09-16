import webpush from "web-push";
import { listSubscriptions, deleteSubscription } from "./db";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    "mailto:notifications@expense-ledger.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

// Sends one notification to every registered device. Dead subscriptions
// (uninstalled app, revoked permission) get cleaned up automatically.
export async function sendToAllDevices(payload) {
  ensureConfigured();
  const subs = await listSubscriptions();
  let sent = 0, removed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await deleteSubscription(sub.endpoint);
        removed++;
      }
    }
  }
  return { sent, removed, total: subs.length };
}
