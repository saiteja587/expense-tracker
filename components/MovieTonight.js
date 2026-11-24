// Discover tab: "Tonight" (mood + time + who's watching → three films on apps
// you use) and "For you" (from directors and actors you rate highly).
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { MOODS, COMPANY } from "../lib/movieLab";
import { SERVICE_NAMES, onYourApps } from "../lib/movieStats";

const TIMES = [[0, "Any length"], [100, "≤ 1h 40m"], [130, "≤ 2h 10m"], [160, "≤ 2h 40m"]];
const Chips = ({ label, options, value, onChange }) => (
  <div role="radiogroup" aria-label={label} className="h-scroll" data-no-tab-swipe="1" style={{ gap: 6, marginBottom: 8 }}>
    {options.map(([k, text]) => (
      <button key={k} type="button" role="radio" aria-checked={value === k} className={`chip${value === k ? " active" : ""}`} style={{ minHeight: 32, fontSize: 12.5, flexShrink: 0 }} onClick={() => onChange(k)}>{text}</button>
    ))}
  </div>
);

export function Tonight({ onOpen }) {
  const [mood, setMood] = useState("any");
  const [company, setCompany] = useState("solo");
  const [minutes, setMinutes] = useState(0);
  const [shown, setShown] = useState([]);
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (fn) => (v) => { fn(v); setR(null); setShown([]); };

  async function find(skip) {
    setBusy(true);
    setError("");
    try {
      const d = await apiGet("tonight", { mood, company, minutes: String(minutes), skip: skip.join(",") });
      setR(d);
      setShown([...skip, ...d.picks.map((p) => p.tmdbId)]);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Tonight" className="card" style={{ padding: "16px 18px", borderRadius: 18, marginBottom: 28 }}>
      <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>🌙 What to watch tonight</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>Three films you haven&apos;t seen, on apps you already use.</div>
      <Chips label="Mood" options={Object.entries(MOODS).map(([k, m]) => [k, `${m.emoji} ${m.label}`])} value={mood} onChange={change(setMood)} />
      <Chips label="Who's watching" options={Object.entries(COMPANY).map(([k, m]) => [k, `${m.emoji} ${m.label}`])} value={company} onChange={change(setCompany)} />
      <Chips label="Time" options={TIMES} value={minutes} onChange={change(setMinutes)} />
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => find(r?.picks.length ? shown : [])}>{busy ? "Looking…" : r?.picks.length ? "Three more" : "Find films"}</button>
      {error && <div role="alert" style={{ fontSize: 13, color: "var(--danger)", marginTop: 8 }}>{error}</div>}
      {r && r.picks.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 10 }}>
          {r.noTmdb ? "This needs the TMDB key." : !r.apps.length ? "I don't know your streaming apps yet. Log a film you streamed, or an expense like “Netflix”, and try again." : shown.length ? "That's everything that fits. Change the mood or time for more." : "Nothing fits. Try another mood or more time."}
        </div>
      )}
      {r?.picks.map((p) => (
        <button key={p.tmdbId} type="button" onClick={() => onOpen({ tmdbId: p.tmdbId, title: p.title })} style={{ display: "flex", gap: 12, width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 0 0", color: "inherit", cursor: "pointer" }}>
          {p.poster && <img src={p.poster} alt="" width={60} height={90} style={{ width: 60, height: 90, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{p.title} {p.rating != null && <span style={{ fontSize: 12.5, color: "#C98A00" }}>★{p.rating.toFixed(1)}</span>}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{[p.year, p.runtime ? `${Math.floor(p.runtime / 60)}h ${p.runtime % 60}m` : "", p.language, ...p.genres].filter(Boolean).join(" · ")}</div>
            <div style={{ fontSize: 12.5, color: "var(--success)", fontWeight: 600, marginTop: 2 }}>📺 {p.on.join(", ")}{p.saved ? " · 🔖 on your watchlist" : ""}</div>
          </div>
        </button>
      ))}
      {r?.apps.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Looking on {r.apps.map((a) => SERVICE_NAMES[a] || a).join(", ")}. Streaming info from TMDB (via JustWatch).</div>}
    </section>
  );
}

export function ForYou({ onOpen, userApps }) {
  const [r, setR] = useState(null);
  useEffect(() => { let live = true; apiGet("for-you").then((d) => live && setR(d)).catch(() => {}); return () => { live = false; }; }, []);
  if (!r?.results?.length) return null;
  return (
    <section aria-label="For you" style={{ marginBottom: 28 }}>
      <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>💛 For you</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>From people you rate highly: {r.people.join(", ")}</div>
      <div className="h-scroll" data-no-tab-swipe="1" style={{ gap: 12, paddingBottom: 6 }}>
        {r.results.map((f) => {
          const mine = onYourApps({ stream: f.stream }, userApps)[0];
          return (
            <button key={f.tmdbId} type="button" onClick={() => onOpen({ tmdbId: f.tmdbId, title: f.title })} style={{ flex: "0 0 104px", width: 104, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}>
              <img src={f.poster} alt="" width={104} height={156} loading="lazy" style={{ width: 104, height: 156, objectFit: "cover", borderRadius: 12, background: "var(--line)", display: "block" }} />
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 5, lineHeight: 1.2 }}>{f.title}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{f.why} · ★{f.rating.toFixed(1)}</div>
              {mine && <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--success)" }}>📺 {mine.name}</div>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
