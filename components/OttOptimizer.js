// Streaming apps you pay for vs what you actually watched on them in the
// last 90 days, with how much pausing the idle ones would save.
import { useMemo } from "react";
import { useLedger } from "../lib/useLedger";
import { ottOptimizer } from "../lib/life";
import { fmt } from "../lib/format";

export default function OttOptimizer({ shows = [] }) {
  const { data, today } = useLedger();
  const r = useMemo(() => (data ? ottOptimizer({ expenses: data.expenses, movies: data.movies, shows, todayIso: today }) : null), [data, shows, today]);
  if (!r || r.rows.length === 0) return null;
  return (
    <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>📡 Your streaming apps</div>
      {r.rows.map((x) => (
        <div key={x.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
          <span>{x.name} <span style={{ color: x.watched <= 1 ? "var(--amber)" : "var(--muted)", fontSize: 12 }}>· {x.watched ? `${x.watched} watched in 90 days` : "nothing watched in 90 days"}</span></span>
          <span className="tabnum">{fmt(x.monthly)}/mo</span>
        </div>
      ))}
      {r.canSave > 0 && (
        <div style={{ fontSize: 13, color: "var(--success)", marginTop: 6 }}>
          Pause {r.idle.map((x) => x.name).join(" and ")} and save about {fmt(r.canSave)} a month ({fmt(r.canSave * 12)} a year). You can restart it for a show you really want.
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Based on subscription payments in your expenses and movies/shows you logged as streaming.</div>
    </div>
  );
}
