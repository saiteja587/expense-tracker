// Goals board: savings (from an account's live balance), weight (from the
// health log), habit check-ins, or anything you count yourself.
import { useMemo, useState } from "react";
import { Target, Plus, Pencil, Trash2, X } from "lucide-react";
import { useLife } from "../lib/useLife";
import { useLedger } from "../lib/useLedger";
import { goalProgress } from "../lib/lifePlus";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { celebrate } from "../lib/celebrate";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const TYPES = [["savings", "💰 Save money"], ["weight", "⚖️ Weight"], ["habit", "✅ Habit days"], ["custom", "🎯 Anything else"]];
const d = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function GoalsPage() {
  const life = useLife(["goal", "habit", "habit_log", "day_log"]);
  const { data, derived } = useLedger();
  const today = todayISO();
  const [form, setForm] = useState(null);
  const ctx = useMemo(() => {
    const w = life.of("day_log").filter((l) => l.weight > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return { balances: derived?.accountBalances || {}, mainBalance: derived?.balance || 0, latestWeight: w?.weight || null, habitLogs: life.of("habit_log"), todayIso: today };
  }, [life, derived, today]);
  if (!life.loaded || !data) return <Loading />;
  const goals = life.of("goal");
  const habits = life.of("habit");
  const accounts = (data.accounts || []).filter((a) => a.kind !== "card" && !a.archived);

  const show = (g) => (g.type === "savings" ? fmt : g.type === "weight" ? (v) => `${v} kg` : (v) => `${v}${g.unit ? ` ${g.unit}` : ""}`);
  async function save(e) {
    e.preventDefault();
    try {
      await life.save({ kind: "goal", id: form.id, date: form.date || null, data: { title: form.title, type: form.type, target: form.target, start: form.type === "weight" ? form.start || ctx.latestWeight : form.start, current: form.current, unit: form.unit, accountId: form.accountId, habitId: form.habitId, done: form.done } });
      setForm(null);
    } catch (err) { showToast(err.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Target size={22} color="var(--accent-solid)" />} title="Goals" sub="Progress updates itself from your accounts, health log and habits.">
        <button type="button" className="chip active" onClick={() => setForm({ title: "", type: "savings", target: "", date: "" })}><Plus size={14} /> New</button>
      </PageHeader>

      {form && (
        <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="h-scroll">{TYPES.map(([k, l]) => <button key={k} type="button" className={`chip${form.type === k ? " active" : ""}`} onClick={() => setForm({ ...form, type: k })}>{l}</button>)}</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
          </div>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={{ savings: "e.g. Emergency fund", weight: "e.g. Reach 72 kg", habit: "e.g. Walk 60 days", custom: "e.g. Read 12 books" }[form.type]} />
          {form.type === "savings" && (
            <select value={form.accountId || ""} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              <option value="">Counting: 👛 Main wallet balance</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>Counting: {a.name} balance</option>)}
            </select>
          )}
          {form.type === "habit" && (
            <select value={form.habitId || ""} onChange={(e) => setForm({ ...form, habitId: e.target.value })}>
              <option value="">Which habit?</option>
              {habits.map((h) => <option key={h.id} value={h.id}>{h.emoji} {h.name}</option>)}
            </select>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Target{form.type === "weight" ? " (kg)" : form.type === "savings" ? " (₹)" : ""}</span><input type="number" inputMode="decimal" value={form.target ?? ""} onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
            {form.type === "custom" && <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">So far</span><input type="number" inputMode="decimal" value={form.current ?? ""} onChange={(e) => setForm({ ...form, current: e.target.value })} /></label>}
            {form.type === "custom" && <label style={{ width: 90, display: "grid", gap: 3 }}><span className="field-label">Unit</span><input value={form.unit || ""} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="books" /></label>}
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">By (optional)</span><input type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          </div>
          {form.type === "weight" && !ctx.latestWeight && <div style={{ fontSize: 12, color: "var(--muted)" }}>Log your weight on Health so progress can be tracked.</div>}
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}

      {goals.length === 0 && !form && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>Set a goal: an emergency fund, a target weight, 60 days of walking, 12 books this year.</div>}
      {goals.map((g) => {
        const p = goalProgress(g, ctx);
        const f = show(g);
        return (
          <div key={g.id} className="card" style={{ borderRadius: 18, padding: 16, marginBottom: 12, opacity: g.done ? 0.65 : 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{TYPES.find(([k]) => k === g.type)?.[1].split(" ")[0]} {g.title}{p.done ? " 🎉" : ""}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {f(p.current)} of {f(g.target)}{g.date ? ` · by ${d(g.date)}${p.daysLeft != null && p.daysLeft >= 0 ? ` (${p.daysLeft} days)` : ""}` : ""}
                  {p.onTrack === true ? " · on track" : p.onTrack === false ? " · behind" : ""}
                </div>
              </div>
              <button type="button" className="icon-btn" aria-label="Edit goal" onClick={() => setForm({ ...g })}><Pencil size={16} /></button>
              <button type="button" className="icon-btn danger" aria-label="Delete goal" onClick={() => life.remove(g.id, `Delete "${g.title}"?`)}><Trash2 size={16} /></button>
            </div>
            <div style={{ height: 10, borderRadius: 6, background: "var(--line)", overflow: "hidden", marginTop: 10 }}>
              <div style={{ height: "100%", width: `${Math.round(p.pct * 100)}%`, background: p.done ? "var(--success)" : p.onTrack === false ? "var(--amber)" : "var(--accent-gradient)", transition: "width .6s" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {g.type === "custom" && !p.done && <button type="button" className="chip" onClick={async () => { await life.save({ kind: "goal", id: g.id, date: g.date || null, data: { ...strip(g), current: (g.current || 0) + 1 } }); if ((g.current || 0) + 1 >= g.target) celebrate({ title: "Goal reached!", message: g.title, emoji: "🎯" }); }}>+1 {g.unit || ""}</button>}
              {!g.done && p.pct >= 1 && <button type="button" className="chip" onClick={() => life.save({ kind: "goal", id: g.id, date: g.date || null, data: { ...strip(g), done: true } })}>🏁 Mark achieved</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
const FIELDS = ["title", "type", "target", "start", "current", "unit", "accountId", "habitId", "done"];
function strip(g) { const o = {}; for (const f of FIELDS) if (g[f] !== undefined && g[f] !== "") o[f] = g[f]; return o; }
