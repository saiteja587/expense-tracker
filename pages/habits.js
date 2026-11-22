// Habits: anything you want to do regularly (walk, gym, read, sleep by 11,
// no smoking). Tap to check in today, see the streak and this week's dots.
import { useMemo, useState } from "react";
import { ListChecks, Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { useLife } from "../lib/useLife";
import { habitStats } from "../lib/life";
import { apiPost } from "../lib/api";
import { todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { vibrate } from "../lib/haptics";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const IDEAS = [["🚶", "Walk 30 minutes"], ["🏋️", "Gym / workout"], ["📖", "Read 20 pages"], ["🧘", "Meditate"], ["😴", "Sleep by 11 PM"], ["🚭", "No smoking"], ["📵", "No phone after 10 PM"], ["🥗", "Home-cooked dinner"]];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

export default function HabitsPage() {
  const life = useLife(["habit", "habit_log"]);
  const today = todayISO();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);

  const habits = useMemo(() => life.of("habit").filter((h) => !h.archived).map((h) => ({ ...h, st: habitStats(h, life.of("habit_log"), today) })), [life, today]);
  if (!life.loaded) return <Loading />;
  const doneToday = habits.filter((h) => h.st.doneToday).length;

  async function toggle(h, date, on) {
    setBusy(`${h.id}|${date}`);
    try {
      await apiPost({ type: "habit-toggle", habitId: h.id, date, on });
      vibrate(on ? [10, 30, 10] : 5);
      await life.reload();
      if (on && date === today) {
        const st = habitStats(h, [...life.of("habit_log"), { refId: h.id, date }], today);
        if ([3, 7, 14, 21, 30, 50, 100].includes(st.streak)) showToast(`${st.streak}-day streak on ${h.name}! 🔥`, "🏆");
      }
    } catch (e) { showToast(e.message, "⚠️"); } finally { setBusy(null); }
  }

  async function save(e) {
    e.preventDefault();
    try {
      await life.save({ kind: "habit", id: form.id, data: { name: form.name, emoji: form.emoji, perWeek: form.perWeek } });
      setForm(null);
    } catch (err) { showToast(err.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<ListChecks size={22} color="var(--accent-solid)" />} title="Habits" sub={habits.length ? `${doneToday} of ${habits.length} done today` : "Small things you want to do regularly."}>
        <button type="button" className="chip active" onClick={() => setForm({ name: "", emoji: "✅", perWeek: 7 })}><Plus size={14} /> New</button>
      </PageHeader>

      {form && (
        <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit habit" : "New habit"}</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
          </div>
          {!form.id && (
            <div className="h-scroll">
              {IDEAS.map(([em, name]) => <button key={name} type="button" className="chip" onClick={() => setForm({ ...form, emoji: em, name })}>{em} {name}</button>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={4} aria-label="Emoji" style={{ width: 60, textAlign: "center" }} />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Habit, e.g. Walk 30 minutes" maxLength={40} style={{ flex: 1 }} />
          </div>
          <label style={{ display: "grid", gap: 3 }}>
            <span className="field-label">How many days a week?</span>
            <div className="h-scroll">{[1, 2, 3, 4, 5, 6, 7].map((k) => <button key={k} type="button" className={`chip${form.perWeek === k ? " active" : ""}`} onClick={() => setForm({ ...form, perWeek: k })}>{k === 7 ? "Every day" : k}</button>)}</div>
          </label>
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}

      {habits.length === 0 && !form && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>No habits yet. Tap New and pick one to start; one or two is plenty.</div>}

      {habits.map((h) => (
        <div key={h.id} className="card" style={{ borderRadius: 18, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" aria-pressed={h.st.doneToday} aria-label={`${h.name}: ${h.st.doneToday ? "done today" : "mark done today"}`} disabled={busy === `${h.id}|${today}`}
              onClick={() => toggle(h, today, !h.st.doneToday)}
              style={{ width: 48, height: 48, borderRadius: 14, border: h.st.doneToday ? "none" : "2px dashed var(--line-strong)", background: h.st.doneToday ? "var(--success)" : "transparent", color: "#fff", fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              {h.st.doneToday ? <Check size={24} /> : <span aria-hidden="true">{h.emoji || "✅"}</span>}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{h.emoji} {h.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {h.st.streak > 0 ? `🔥 ${h.st.streak}-day streak` : "No streak yet"} · best {h.st.best} · {h.st.thisWeek}/{h.perWeek || 7} this week{h.st.goalMet ? " ✓" : ""}
              </div>
            </div>
            <button type="button" className="icon-btn" aria-label="Edit habit" onClick={() => setForm({ id: h.id, name: h.name, emoji: h.emoji || "", perWeek: h.perWeek || 7 })}><Pencil size={16} /></button>
            <button type="button" className="icon-btn danger" aria-label="Delete habit" onClick={() => life.remove(h.id, `Delete "${h.name}" and its history?`)}><Trash2 size={16} /></button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {h.st.week.map((w, k) => (
              <button key={w.date} type="button" disabled={w.future || busy === `${h.id}|${w.date}`} onClick={() => toggle(h, w.date, !w.done)} aria-label={`${w.date} ${w.done ? "done" : "not done"}`}
                style={{ flex: 1, height: 34, borderRadius: 10, border: w.date === today ? "2px solid var(--accent-solid)" : "1px solid var(--line)", background: w.done ? "var(--success)" : "var(--surface-2)", color: w.done ? "#fff" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: w.future ? "default" : "pointer", opacity: w.future ? 0.4 : 1 }}>
                {DOW[k]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
