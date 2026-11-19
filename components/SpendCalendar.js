// Spending calendar (#5): each day coloured against your daily target —
// green under, amber close, red over. Tap a day to see what you spent.
import { useMemo, useState } from "react";
import { monthCalendar } from "../lib/smart";
import { fmt, fmtShort } from "../lib/format";

const LEVEL_BG = ["var(--surface-2)", "color-mix(in srgb, var(--success) 30%, var(--surface))", "color-mix(in srgb, var(--warn) 40%, var(--surface))", "color-mix(in srgb, var(--danger) 45%, var(--surface))"];

export default function SpendCalendar({ items, ym, dailyTarget, todayIso }) {
  const cal = useMemo(() => monthCalendar(items, ym, dailyTarget), [items, ym, dailyTarget]);
  const [picked, setPicked] = useState(null);
  const dayItems = picked ? items.filter((x) => x.date === picked && !x.isRecurringPending) : [];

  return (
    <section aria-label="Spending calendar" className="card" style={{ padding: 18, borderRadius: 20, marginBottom: 16 }}>
      <h2 className="section-title" style={{ marginBottom: 4 }}>Spending calendar</h2>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
        {dailyTarget ? `Against ${fmt(dailyTarget)} a day` : "Darker = more spent"} · tap a day
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5, fontSize: 11, color: "var(--muted)", textAlign: "center", marginBottom: 5 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5 }}>
        {Array.from({ length: cal.firstDow }, (_, i) => <div key={`b${i}`} />)}
        {cal.days.map((d) => {
          const future = d.iso > todayIso;
          return (
            <button
              key={d.iso} type="button" onClick={() => setPicked(d.iso === picked ? null : d.iso)} disabled={future}
              aria-label={`${d.day}: ${fmt(d.total)}`}
              style={{
                aspectRatio: "1 / 1", borderRadius: 10, border: d.iso === todayIso ? "2px solid var(--ink)" : picked === d.iso ? "2px solid var(--accent-solid)" : "none",
                background: future ? "transparent" : LEVEL_BG[d.level], color: "var(--ink)", padding: 2, cursor: future ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: future ? 0.35 : 1,
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.day}</span>
              {d.total > 0 && <span className="tabnum" style={{ fontSize: 9.5, color: "var(--text-2)" }}>{fmtShort(d.total).replace("₹", "")}</span>}
            </button>
          );
        })}
      </div>
      {picked && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {new Date(picked + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          {dayItems.length === 0 ? (
            <div style={{ fontSize: 14, color: "var(--success)" }}>🌿 No spending — a no-spend day!</div>
          ) : (
            dayItems.map((x) => (
              <div key={x.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}>
                <span>{x.note || x.category} <span style={{ color: "var(--muted)", fontSize: 12 }}>· {x.category}</span></span>
                <span className="tabnum">{fmt(x.amount)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
