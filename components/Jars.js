// Envelope budgets (#8): each category limit is a jar that empties as you
// spend this month. Uses the shared data hook so it stays in sync.
import { useMemo } from "react";
import { useLedger } from "../lib/useLedger";
import { jars as computeJars } from "../lib/smart";
import { categoryColor, categoryEmoji } from "../lib/categories";
import { fmt } from "../lib/format";

export default function Jars() {
  const { data, derived, today } = useLedger();
  const list = useMemo(() => (data && derived ? computeJars(data.rules, derived.items, today) : []), [data, derived, today]);
  if (!list.length) return null;
  return (
    <section aria-label="Spending jars" className="card" style={{ padding: 18, borderRadius: 20, marginBottom: 20 }}>
      <h2 className="section-title" style={{ marginBottom: 4 }}>Your jars this month</h2>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Each category limit is a jar. It empties as you spend.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 14 }}>
        {list.map((j) => {
          const color = j.left < 0 ? "var(--danger)" : categoryColor(j.category, data.customCategories);
          return (
            <div key={j.category} style={{ textAlign: "center" }}>
              <div style={{ position: "relative", width: 64, height: 84, margin: "0 auto", borderRadius: "14px 14px 18px 18px", border: "3px solid var(--line-strong)", borderTopWidth: 6, overflow: "hidden", background: "var(--surface-2)" }}
                aria-label={`${j.category}: ${fmt(Math.max(0, j.left))} left of ${fmt(j.limit)}`}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${j.fill * 100}%`, background: color, opacity: 0.85, transition: "height 0.9s var(--ease-fluid)" }} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }} aria-hidden="true">{categoryEmoji(j.category, data.customCategories)}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{j.category}</div>
              <div className="tabnum" style={{ fontSize: 12, color: j.left < 0 ? "var(--danger)" : "var(--muted)" }}>
                {j.left < 0 ? `${fmt(-j.left)} over` : `${fmt(j.left)} left`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
