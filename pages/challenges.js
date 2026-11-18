// Mini challenges: pick one, watch the day-by-day track fill in.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { TEMPLATES, makeChallenge, evaluateChallenge } from "../lib/miniChallenges";
import { dayLabel, fmt } from "../lib/format";
import { showToast } from "../lib/toast";

async function saveAll(challenges) {
  const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "mini-challenges", challenges }) });
  if (!res.ok) throw new Error();
}

export default function ChallengesPage() {
  const { data, derived, today, loaded } = useLedger();
  const [cap, setCap] = useState(500);
  const [busy, setBusy] = useState(false);
  const list = useMemo(
    () => (data && derived ? data.miniChallenges.map((c) => evaluateChallenge(c, derived.items, today)).filter(Boolean) : []),
    [data, derived, today]
  );
  const running = list.filter((c) => (c.status === "active" || c.status === "upcoming") && !c.dismissed);
  const past = list.filter((c) => c.status === "won" || c.status === "lost").slice(-6).reverse();

  async function start(template) {
    if (running.some((c) => c.template === template)) { showToast("That one's already running", "ℹ️"); return; }
    setBusy(true);
    try {
      await saveAll([...data.miniChallenges, makeChallenge(template, today, template === "daily_cap" ? cap : undefined)]);
      showToast(`${TEMPLATES[template].title} — started!`, "🎯");
      notifyLedgerChanged();
    } catch {
      showToast("Couldn't start it — try again", "⚠️");
    } finally {
      setBusy(false);
    }
  }

  async function quit(id) {
    if (!window.confirm("Stop this challenge?")) return;
    try {
      await saveAll(data.miniChallenges.map((c) => (c.id === id ? { ...c, dismissed: true } : c)));
      notifyLedgerChanged();
    } catch {
      showToast("Couldn't update — try again", "⚠️");
    }
  }

  return (
    <div className="page-container" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 100px" }}>
      <Link href="/me" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>← Me</Link>
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "6px 0 4px" }}>Mini challenges</h1>
      <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 18 }}>Short, winnable goals. Progress updates from what you log.</div>

      {running.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <h2 className="section-title">Running</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {running.map((c) => (
              <div key={c.id} className="card" style={{ padding: 16, borderRadius: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>{c.emoji} {c.title}</div>
                  <button type="button" className="chip" onClick={() => quit(c.id)}>Stop</button>
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px" }}>{c.description}</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {c.dayStates.map((s, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                        background: s === "ok" ? "var(--success)" : s === "broken" ? "var(--danger)" : s === "today" ? "var(--warn-bg)" : "var(--line)",
                        color: s === "ok" || s === "broken" ? "#fff" : "var(--text-2)", border: s === "today" ? "1.5px solid var(--warn)" : "none" }}>
                        {s === "ok" ? "✓" : s === "broken" ? "✗" : i + 1}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>
                  {c.status === "upcoming" ? `Starts ${dayLabel(c.start, today)}` : `Day ${c.day} of ${c.days} · ends ${dayLabel(c.end, today)}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginBottom: 22 }}>
        <h2 className="section-title">Start one</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {Object.entries(TEMPLATES).map(([key, t]) => (
            <div key={key} className="card" style={{ padding: 16, borderRadius: 18, display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 28 }} aria-hidden="true">{t.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{t.title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{t.describe(key === "daily_cap" ? cap : t.param)}</div>
                {key === "daily_cap" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 6, color: "var(--text-2)" }}>
                    Cap ₹ <input type="number" inputMode="numeric" min="50" step="50" value={cap} onChange={(e) => setCap(Math.max(50, parseInt(e.target.value, 10) || 500))} style={{ width: 90, padding: "6px 8px" }} />
                  </label>
                )}
              </div>
              <button type="button" className="btn btn-primary" disabled={busy || !loaded} onClick={() => start(key)} style={{ minHeight: 40 }}>Start</button>
            </div>
          ))}
        </div>
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="section-title">Finished</h2>
          {past.map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}>
              <span>{c.emoji} {c.title}{c.template === "daily_cap" && c.param ? ` (${fmt(c.param)})` : ""}</span>
              <span style={{ fontWeight: 600, color: c.status === "won" ? "var(--success)" : "var(--danger)" }}>{c.status === "won" ? "Won 🏆" : "Missed"}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
