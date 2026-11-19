// Movie extras: a poster wall sorted by your rating (#11) and a "Pick for
// me" spinner for the watchlist (#12).
import { useMemo, useRef, useState } from "react";
import Poster from "./Poster";
import { vibrate } from "../lib/haptics";
import { movieStatus } from "../lib/ledger";

export function PosterWall({ movies }) {
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const years = useMemo(() => [...new Set(movies.map((m) => m.date.slice(0, 4)))].sort().reverse(), [movies]);
  const wall = useMemo(() => {
    const seen = new Set();
    return movies
      .filter((m) => m.date.startsWith(year) && movieStatus(m) !== "upcoming")
      .sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.date.localeCompare(a.date))
      .filter((m) => (seen.has(m.title.toLowerCase()) ? false : seen.add(m.title.toLowerCase())));
  }, [movies, year]);
  if (!movies.length) return null;
  return (
    <section aria-label="Poster wall" style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>🎞️ Your {year} wall</div>
        {years.length > 1 && (
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" style={{ width: 100, padding: "6px 10px" }}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>
      {wall.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>No movies logged in {year} yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 12 }}>
          {wall.map((m) => (
            <div key={m.id} title={m.title} style={{ textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center" }}><Poster title={m.title} width={84} radius={10} /></div>
              <div style={{ fontSize: 12, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
              {m.rating > 0 && <div aria-label={`${m.rating} stars`} style={{ color: "#F5A524", fontSize: 11 }}>{"★".repeat(m.rating)}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Spins through your watchlist and lands on one. With an empty watchlist it
// suggests rewatching your highest-rated movie.
export function PickForMe({ watchlist, movies }) {
  const [shown, setShown] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const timer = useRef(null);

  function spin() {
    if (spinning) return;
    const pool = watchlist.map((w) => ({ title: w.title, why: w.note || "From your watchlist" }));
    if (!pool.length) {
      const fav = [...movies].filter((m) => m.rating >= 4).sort((a, b) => b.rating - a.rating)[0];
      setShown(fav ? { title: fav.title, why: `A rewatch? You gave it ${"★".repeat(fav.rating)}` } : { title: "Add some to your watchlist first", why: "" });
      return;
    }
    setSpinning(true);
    let n = 0;
    const steps = 14;
    const tick = () => {
      setShown(pool[Math.floor(Math.random() * pool.length)]);
      vibrate(3);
      n++;
      if (n < steps) timer.current = setTimeout(tick, 60 + n * 18);
      else setSpinning(false);
    };
    tick();
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <button type="button" className="chip" onClick={spin} disabled={spinning}>🎲 {spinning ? "Picking…" : "Pick for me"}</button>
      {shown && (
        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderRadius: 16, marginTop: 10, transition: "transform 0.2s", transform: spinning ? "scale(0.98)" : "scale(1)" }}>
          <Poster title={shown.title} width={48} radius={8} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{spinning ? shown.title : `🍿 Tonight: ${shown.title}`}</div>
            {shown.why && !spinning && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{shown.why}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
