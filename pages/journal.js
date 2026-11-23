// Journal: one line a day, with your mood. Stored on the same day log as
// the health numbers, so mood, sleep and money can be read together.
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { useLife } from "../lib/useLife";
import { MOODS } from "../lib/life";
import { addDays } from "../lib/ledger";
import { todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const PROMPTS = ["What made today good?", "One thing you're grateful for?", "What did you learn today?", "What would make tomorrow better?", "Best moment today?"];

export default function JournalPage() {
  const life = useLife(["day_log"]);
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [text, setText] = useState(null);
  const [q, setQ] = useState("");
  if (!life.loaded) return <Loading />;
  const logs = life.of("day_log").sort((a, b) => (a.date < b.date ? 1 : -1));
  const current = logs.find((l) => l.date === date);
  const value = text ?? current?.journal ?? "";
  const entries = logs.filter((l) => l.journal && (!q || l.journal.toLowerCase().includes(q.toLowerCase())));
  const prompt = PROMPTS[new Date(date + "T00:00:00").getDate() % PROMPTS.length];

  async function save(patch) {
    try { await life.save({ kind: "day_log", date, data: patch }); setText(null); showToast("Saved", "📓"); } catch (e) { showToast(e.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<BookOpen size={22} color="var(--accent-solid)" />} title="Journal" sub={`${entries.length} entr${entries.length === 1 ? "y" : "ies"}. A line a day is enough.`} />
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[["Today", today], ["Yesterday", addDays(today, -1)]].map(([l, dd]) => <button key={dd} type="button" className={`chip${date === dd ? " active" : ""}`} onClick={() => { setDate(dd); setText(null); }}>{l}</button>)}
        <input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value || today); setText(null); }} style={{ width: 150 }} aria-label="Date" />
      </div>
      <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {MOODS.map(([v, em, label]) => (
            <button key={v} type="button" title={label} aria-pressed={current?.mood === v} onClick={() => save({ mood: v })}
              style={{ flex: 1, fontSize: 22, padding: "6px 0", borderRadius: 12, border: current?.mood === v ? "2px solid var(--accent-solid)" : "1px solid var(--line)", background: "transparent", cursor: "pointer" }}>{em}</button>
          ))}
        </div>
        <textarea rows={4} value={value} onChange={(e) => setText(e.target.value)} placeholder={prompt} maxLength={1000} />
        <button type="button" className="btn btn-primary" disabled={text === null} onClick={() => save({ journal: value.trim() })}>Save</button>
      </div>
      {entries.length > 3 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your journal" style={{ marginBottom: 10 }} />}
      {entries.map((l) => (
        <button key={l.date} type="button" onClick={() => { setDate(l.date); setText(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid var(--line)", padding: "10px 0", cursor: "pointer", color: "inherit" }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(l.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} {l.mood ? MOODS[l.mood - 1][1] : ""}</div>
          <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{l.journal}</div>
        </button>
      ))}
    </div>
  );
}
