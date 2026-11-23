// Health: a 10-second daily log (weight, sleep, mood, steps, water) and
// what it says over time, including how mood and sleep line up with money.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLife } from "../lib/useLife";
import { useLedger } from "../lib/useLedger";
import { healthSummary, sleepHoursFrom, MOODS } from "../lib/life";
import { todayISO, fmt } from "../lib/format";
import { addDays } from "../lib/ledger";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle, Stat } from "../components/PageHeader";


export default function HealthPage() {
  const life = useLife(["day_log"]);
  const { derived } = useLedger();
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [f, setF] = useState({});
  const logs = life.of("day_log");
  const current = logs.find((l) => l.date === date);

  useEffect(() => {
    setF({ weight: current?.weight ?? "", bed: current?.bed ?? "", wake: current?.wake ?? "", steps: current?.steps ?? "", water: current?.water ?? "" });
  }, [current, date]);

  const h = useMemo(() => healthSummary(logs, derived?.items || [], today), [logs, derived, today]);
  if (!life.loaded) return <Loading />;

  async function save(patch) {
    try {
      await life.save({ kind: "day_log", date, data: patch });
      showToast("Saved", "✅");
    } catch (e) { showToast(e.message, "⚠️"); }
  }
  function saveForm(e) {
    e.preventDefault();
    const sleepHours = sleepHoursFrom(f.bed, f.wake);
    save({ weight: f.weight, bed: f.bed, wake: f.wake, sleepHours: sleepHours ?? undefined, steps: f.steps, water: f.water });
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<HeartPulse size={22} color="var(--danger)" />} title="Health" sub="A quick daily log. The more days you fill, the better the patterns." />

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["Today", today], ["Yesterday", addDays(today, -1)]].map(([l, d]) => <button key={d} type="button" className={`chip${date === d ? " active" : ""}`} onClick={() => setDate(d)}>{l}</button>)}
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} style={{ width: 150 }} aria-label="Date" />
      </div>

      <div className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div className="field-label">How are you feeling?</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {MOODS.map(([v, em, label]) => (
            <button key={v} type="button" aria-pressed={current?.mood === v} onClick={() => save({ mood: v })} title={label}
              style={{ flex: 1, fontSize: 26, padding: "8px 0", borderRadius: 12, border: current?.mood === v ? "2px solid var(--accent-solid)" : "1px solid var(--line)", background: current?.mood === v ? "var(--surface-2)" : "transparent", cursor: "pointer" }}>
              {em}
            </button>
          ))}
        </div>
        <form onSubmit={saveForm} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Weight (kg)</span><input type="number" inputMode="decimal" step="0.1" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Steps</span><input type="number" inputMode="numeric" value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></label>
            <label style={{ width: 90, display: "grid", gap: 3 }}><span className="field-label">Glasses 💧</span><input type="number" inputMode="numeric" value={f.water} onChange={(e) => setF({ ...f, water: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Slept at (last night)</span><input type="time" value={f.bed} onChange={(e) => setF({ ...f, bed: e.target.value })} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Woke up</span><input type="time" value={f.wake} onChange={(e) => setF({ ...f, wake: e.target.value })} /></label>
          </div>
          {sleepHoursFrom(f.bed, f.wake) && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>{sleepHoursFrom(f.bed, f.wake)} hours of sleep</div>}
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="Weight" value={h.latestWeight ? `${h.latestWeight} kg` : "—"} sub={h.weekChange != null ? `${h.weekChange > 0 ? "+" : ""}${h.weekChange} kg vs last week` : "log a few days to see the trend"} />
        <Stat label="Sleep (2 weeks)" value={h.sleepAvg ? `${h.sleepAvg} h` : "—"} tone={h.sleepAvg && h.sleepAvg < 6.5 ? "bad" : undefined} sub={h.sleepAvg && h.sleepAvg < 7 ? "aim for 7–8 hours" : undefined} />
      </div>

      {h.weightSeries.length > 2 && (
        <div className="card" style={{ borderRadius: 16, padding: "12px 8px 4px", marginBottom: 14, height: 170 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={h.weightSeries} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" tickFormatter={(v) => v.slice(8)} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={36} />
              <Tooltip formatter={(v) => [`${v} kg`, "Weight"]} />
              <Line type="monotone" dataKey="weight" stroke="var(--accent-solid)" strokeWidth={2.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {(h.moodInsight || h.sleepInsight) && (
        <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 14, fontSize: 14, lineHeight: 1.5 }}>
          {h.moodInsight && <div>💭 {h.moodInsight}</div>}
          {h.sleepInsight && <div>😴 {h.sleepInsight}</div>}
        </div>
      )}
      {h.moodSpend.length > 0 && (
        <div className="card" style={{ borderRadius: 16, padding: "8px 14px", marginBottom: 14 }}>
          <div className="field-label" style={{ paddingTop: 4 }}>Average spending by mood</div>
          {h.moodSpend.map((m) => (
            <div key={m.mood} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
              <span>{MOODS[m.mood - 1][1]} {MOODS[m.mood - 1][2]} <span style={{ color: "var(--muted)", fontSize: 12 }}>({m.days} days)</span></span><span className="tabnum">{fmt(m.avg)}/day</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/diet" className="chip" style={{ textDecoration: "none" }}>🥗 Diet & food log</Link>
        <Link href="/habits" className="chip" style={{ textDecoration: "none" }}>✅ Habits</Link>
        <Link href="/sugar-challenge" className="chip" style={{ textDecoration: "none" }}>🍬 Sugar challenge</Link>
      </div>
    </div>
  );
}
