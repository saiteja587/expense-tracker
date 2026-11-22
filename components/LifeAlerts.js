// Home: what's coming up outside money. Renewals due within a week, birthdays
// within 3 days, warranties ending this month, and habits still open today.
import Link from "next/link";
import { useLife } from "../lib/useLife";
import { dueStatus, warrantyEnds, nextOccurrence, habitStats } from "../lib/life";

export default function LifeAlerts({ today }) {
  const life = useLife(["renewal", "warranty", "document", "occasion", "habit", "habit_log"]);
  if (!life.loaded) return null;
  const rows = [];
  for (const r of [...life.of("renewal"), ...life.of("document")]) {
    const st = dueStatus(r.date, today);
    if (st.daysLeft != null && st.daysLeft <= 7) rows.push({ href: "/renewals", emoji: "📅", tone: st.daysLeft < 0 ? "bad" : "warn", text: `${r.name} ${st.daysLeft < 0 ? `expired ${-st.daysLeft} days ago` : st.daysLeft === 0 ? "expires today" : `due in ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"}`}`, k: st.daysLeft });
  }
  for (const w of life.of("warranty")) {
    const st = dueStatus(warrantyEnds(w), today);
    if (st.daysLeft != null && st.daysLeft >= 0 && st.daysLeft <= 30) rows.push({ href: "/renewals", emoji: "🧾", text: `${w.name} warranty ends in ${st.daysLeft} days`, k: st.daysLeft + 5 });
  }
  for (const o of life.of("occasion")) {
    const nx = nextOccurrence(o, today);
    if (nx.daysLeft <= 3) rows.push({ href: "/people", emoji: o.type === "anniversary" ? "💍" : "🎂", text: `${o.person}'s ${o.type === "anniversary" ? "anniversary" : o.type === "birthday" ? "birthday" : "day"} ${nx.daysLeft === 0 ? "is today" : nx.daysLeft === 1 ? "is tomorrow" : `in ${nx.daysLeft} days`}`, k: nx.daysLeft });
  }
  const habits = life.of("habit").filter((h) => !h.archived);
  const open = habits.filter((h) => !habitStats(h, life.of("habit_log"), today).doneToday);
  if (habits.length && open.length) rows.push({ href: "/habits", emoji: "✅", text: `${open.length} habit${open.length === 1 ? "" : "s"} left today: ${open.slice(0, 2).map((h) => h.name).join(", ")}${open.length > 2 ? "…" : ""}`, k: 50 });
  if (!rows.length) return null;
  rows.sort((a, b) => a.k - b.k);
  return (
    <div className="card" style={{ borderRadius: 18, padding: "6px 16px", marginBottom: 16 }}>
      {rows.slice(0, 4).map((r, i) => (
        <Link key={i} href={r.href} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none", textDecoration: "none", color: r.tone === "bad" ? "var(--danger)" : r.tone === "warn" ? "var(--amber)" : "var(--ink)", fontSize: 14 }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>{r.emoji}</span><span>{r.text}</span>
        </Link>
      ))}
    </div>
  );
}
