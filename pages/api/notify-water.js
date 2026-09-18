import { getChallengeMeta, listChallengeDays, getSetting, setSetting } from "../../lib/db";
import { sendToAllDevices } from "../../lib/push";

function toISODate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

const WATER_MESSAGES = [
  "Quick reminder to hydrate.",
  "A glass of water takes 10 seconds. Go on.",
  "Your body's been asking. Drink up.",
  "Small habit, real difference — have some water.",
  "Pause, drink, continue.",
];

const SUGAR_MESSAGES = [
  "You haven't logged today yet — don't lose your streak.",
  "One tap keeps the streak alive. Go mark today.",
  "Today's not marked yet. A slip only counts if you don't log it either way.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Not driven by Vercel Cron — Hobby's cron only fires once a day, too
// infrequent for "every 90 minutes." Instead, an external free scheduler
// (e.g. cron-job.org) hits this URL directly on whatever interval you want,
// protected by a shared secret so nobody else can trigger it.
export default async function handler(req, res) {
  if (req.query.secret !== process.env.WATER_NOTIFY_SECRET) {
    return res.status(401).json({ error: "Invalid secret" });
  }
  try {
    const result = await sendToAllDevices({
      title: "💧 Drink some water",
      body: pick(WATER_MESSAGES),
      icon: "/icon-water.png",
      url: "/",
    });

    // Bonus: once it's evening and today's sugar-challenge day isn't marked
    // yet, piggyback a reminder on whichever ping happens to land after 8pm
    // IST — sent at most once per day, tracked so it doesn't repeat.
    const nowUTC = new Date();
    const istHour = (nowUTC.getUTCHours() + 5) % 24 + (nowUTC.getUTCMinutes() >= 30 ? 0.5 : 0);
    const todayIST = new Date(nowUTC.getTime() + 5.5 * 60 * 60000).toISOString().slice(0, 10);

    if (istHour >= 20) {
      const lastSent = await getSetting("last_sugar_reminder_date");
      if (lastSent !== todayIST) {
        const meta = await getChallengeMeta();
        if (meta) {
          const days = await listChallengeDays();
          const markedToday = days.some((d) => toISODate(d.day_date) === todayIST);
          if (!markedToday) {
            await sendToAllDevices({
              title: "🔥 Mark today's sugar challenge",
              body: pick(SUGAR_MESSAGES),
              icon: "/icon-sugar.png",
              url: "/sugar-challenge",
            });
          }
        }
        await setSetting("last_sugar_reminder_date", todayIST);
      }
    }

    return res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to send" });
  }
}
