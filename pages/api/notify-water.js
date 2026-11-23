import { getChallengeMeta, listChallengeDays, getUserSetting, setUserSetting, listUsers, listLifeForReminders, markLifeNotified } from "../../lib/db";
import { mapLife } from "../../lib/life";
import { dueDoses } from "../../lib/lifePlus";
import { localDateParts, localHHMM } from "../../lib/dates";
import { sendToUser } from "../../lib/push";

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
    // Medicine doses for everyone who has them: due within the last 2 hours
    // and not marked taken. Each medicine remembers which of today's times
    // it already reminded about.
    const medsSent = [];
    try {
      const today = localDateParts().iso, now = localHHMM();
      for (const u of await listUsers()) {
        const rows = await listLifeForReminders(u.id);
        const items = rows.map((r) => ({ ...mapLife(r), notified: r.notified }));
        const due = dueDoses(items.filter((x) => x.kind === "medicine"), items.filter((x) => x.kind === "dose"), today, now);
        for (const { med, time } of due) {
          const [day, list = ""] = String(med.notified || "").split("#");
          const sent = day === today ? list.split(",").filter(Boolean) : [];
          if (sent.includes(time)) continue;
          await sendToUser(u.id, { title: `💊 ${med.name}${med.dose ? ` — ${med.dose}` : ""}`, body: `Your ${time} dose${med.person ? ` (for ${med.person})` : ""}. Tap to mark it taken.`, url: "/medical" });
          med.notified = `${today}#${[...sent, time].join(",")}`;
          await markLifeNotified(med.id, med.notified);
          medsSent.push(`${u.id}:${med.name}@${time}`);
        }
      }
    } catch (e) {
      console.error("[notify-water] medicine reminders failed:", e);
    }

    // A personal reminder set up by the app's owner (via an external
    // scheduler) — it goes to the owner's devices only, not to everyone.
    const owner = (await listUsers()).find((u) => u.is_owner);
    if (!owner) return res.status(200).json({ ok: true, result: null, medicines: medsSent });
    const uid = owner.id;
    const sendToAllDevices = (payload) => sendToUser(uid, payload);
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
      const lastSent = await getUserSetting(uid, "last_sugar_reminder_date");
      if (lastSent !== todayIST) {
        const meta = await getChallengeMeta(uid);
        if (meta) {
          const days = await listChallengeDays(uid);
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
        await setUserSetting(uid, "last_sugar_reminder_date", todayIST);
      }
    }

    return res.status(200).json({ ok: true, result, medicines: medsSent });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to send" });
  }
}
