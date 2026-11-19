// "Now in theatres / Coming soon" in India, from TMDB. One tap to log a
// booking or save to the watchlist.
import { useEffect, useState } from "react";
import { rememberPoster } from "./Poster";

export default function NowShowing({ onBook, onSave, savedTitles }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("nowPlaying");

  useEffect(() => {
    fetch("/api/data?type=now-showing").then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, []);

  if (!data || (!data.nowPlaying.length && !data.upcoming.length)) return null;
  const list = data[tab].length ? data[tab] : data[tab === "nowPlaying" ? "upcoming" : "nowPlaying"];
  const saved = new Set((savedTitles || []).map((t) => t.toLowerCase()));

  return (
    <section aria-label="Now in theatres" style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>🍿 {tab === "nowPlaying" ? "In theatres now" : "Coming soon"}</div>
        <div role="tablist" style={{ display: "flex", gap: 6 }}>
          {[["nowPlaying", "Now"], ["upcoming", "Soon"]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? " active" : ""}`} onClick={() => setTab(k)} style={{ minHeight: 30, fontSize: 12.5 }}>{label}</button>
          ))}
        </div>
      </div>
      <div className="h-scroll" data-no-tab-swipe="1" style={{ gap: 12, paddingBottom: 6 }}>
        {list.map((m) => {
          const isSaved = saved.has(m.title.toLowerCase());
          return (
            <div key={m.tmdbId} style={{ flex: "0 0 112px", width: 112 }}>
              <img src={m.poster} alt={`${m.title} poster`} width={112} height={168} loading="lazy"
                style={{ width: 112, height: 168, objectFit: "cover", borderRadius: 12, boxShadow: "var(--shadow-sm)", background: "var(--line)", display: "block" }} />
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 31 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.rating != null ? `★ ${m.rating.toFixed(1)} · ` : ""}{tab === "upcoming" && m.releaseDate ? new Date(m.releaseDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : m.language || m.genre}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <button type="button" className="chip" aria-label={`Log ${m.title}`} onClick={() => { rememberPoster(m.title, m.poster?.replace("/w154/", "/w342/")); onBook(m); }}
                  style={{ flex: 1, minHeight: 30, padding: "2px 6px", fontSize: 12, justifyContent: "center" }}>🎟️</button>
                <button type="button" className={`chip${isSaved ? " active" : ""}`} disabled={isSaved} aria-label={isSaved ? `${m.title} is on your watchlist` : `Save ${m.title} to watchlist`}
                  onClick={() => { rememberPoster(m.title, m.poster?.replace("/w154/", "/w342/")); onSave(m); }}
                  style={{ flex: 1, minHeight: 30, padding: "2px 6px", fontSize: 12, justifyContent: "center" }}>{isSaved ? "✓" : "🔖"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
