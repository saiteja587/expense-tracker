// Shared spaces (#15): a partner or flatmate opens /shared/<token>. The long
// random token in the link is the only key, and it unlocks this one space's
// entries — never the owner's PIN-protected data.
import * as db from "../../lib/db";

function err(res, msg, status = 400) {
  return res.status(status).json({ error: msg });
}

export default async function handler(req, res) {
  try {
    const token = String((req.method === "GET" || req.method === "DELETE" ? req.query.token : req.body?.token) || "");
    if (!/^[\w-]{16,64}$/.test(token)) return err(res, "Invalid link", 404);
    const group = await db.getSharedGroupByToken(token);
    if (!group) return err(res, "This shared space doesn't exist (or was deleted)", 404);
    const members = JSON.parse(group.members);

    if (req.method === "GET") {
      const entries = await db.listSharedEntries(group.id);
      return res.status(200).json({
        group: { name: group.name, members },
        entries: entries.map((e) => ({ id: e.id, payer: e.payer, amount: parseFloat(e.amount), note: e.note, date: String(e.entry_date instanceof Date ? e.entry_date.toISOString() : e.entry_date).slice(0, 10), splitWith: JSON.parse(e.split_with) })),
      });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const amount = parseFloat(b.amount);
      if (!members.includes(b.payer)) return err(res, "Pick who paid");
      if (!amount || amount <= 0 || amount > 10000000) return err(res, "Enter an amount");
      const splitWith = (Array.isArray(b.splitWith) ? b.splitWith : members).filter((m) => members.includes(m));
      if (!splitWith.length) return err(res, "Pick who it's split between");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : new Date().toISOString().slice(0, 10);
      const entry = await db.createSharedEntry(group.id, { payer: b.payer, amount, note: String(b.note || "").trim().slice(0, 120), date, splitWith });
      return res.status(201).json({ id: entry.id });
    }

    if (req.method === "DELETE") {
      const id = parseInt(req.query.id, 10);
      if (isNaN(id)) return err(res, "Invalid id");
      await db.deleteSharedEntry(group.id, id);
      return res.status(200).json({ ok: true });
    }
    return err(res, "Method not allowed", 405);
  } catch (e) {
    console.error("[api/shared]", e);
    return res.status(500).json({ error: "Server error" });
  }
}
