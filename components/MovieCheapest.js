// "Cheapest way to watch" in a movie's details. Free services don't give rent
// prices, so you note each service's price once and it's used from then on.
import { useState } from "react";
import { useLife } from "../lib/useLife";
import { cheapestWay } from "../lib/movieLab";
import { ottKey } from "../lib/movieStats";
import { fmt } from "../lib/format";
import { showToast } from "../lib/toast";

export default function MovieCheapest({ d, userApps, nightOut, inTheatres }) {
  const life = useLife(["watch_price"]);
  const [people, setPeople] = useState(1);
  const prices = life.of("watch_price");
  const opts = cheapestWay({ providers: d.providers, apps: userApps || new Set(), prices, nightOut, inTheatres, people });
  if (!life.loaded || !opts.length) return null;

  async function setPrice(o) {
    const was = prices.find((p) => ottKey(p.name) === ottKey(o.service));
    const v = window.prompt(`What does it cost to ${o.what} on ${o.service}? (₹)`, String(was?.[o.what] || ""));
    if (v === null) return;
    const data = { name: was?.name || o.service, rent: was?.rent, buy: was?.buy, [o.what]: parseFloat(v) || "" };
    try { await life.save({ kind: "watch_price", id: was?.id, data }); } catch (e) { showToast(e.message, "⚠️"); }
  }

  return (
    <section aria-label="Cheapest way to watch" className="card" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>💸 Cheapest way to watch</div>
        {inTheatres && (
          <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>People
            <input type="number" min="1" max="20" inputMode="numeric" value={people} onChange={(e) => setPeople(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))} style={{ width: 54, padding: "3px 6px" }} />
          </label>
        )}
      </div>
      {opts.slice(0, 7).map((o, i) => (
        <div key={o.how} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "5px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
          <span>{o.how}{o.note ? <span style={{ color: "var(--muted)", fontSize: 12 }}> · {o.note}</span> : null}</span>
          <span style={{ whiteSpace: "nowrap", fontWeight: i === 0 && o.cost != null ? 700 : 400, color: i === 0 && o.cost != null ? "var(--success)" : "inherit" }}>
            {o.cost === 0 ? "₹0" : o.cost != null ? fmt(o.cost) : !o.service ? "—" : null}
            {o.service && <button type="button" onClick={() => setPrice(o)} aria-label={`Set ${o.what} price on ${o.service}`} style={{ background: "none", border: "none", color: "var(--accent-solid)", fontSize: 12, cursor: "pointer", padding: "0 0 0 6px" }}>{o.cost != null ? "✎" : "add price"}</button>}
          </span>
        </div>
      ))}
    </section>
  );
}
