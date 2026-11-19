// Browse movies from TMDB: in Indian theatres now, coming soon, trending
// this week, and new releases in the languages you watch most. Tap a poster
// for details; one tap to log a booking or save to the watchlist.
import { useEffect, useState } from "react";
import { rememberPoster } from "./Poster";
import { theatreVerdict } from "../lib/movieStats";
import { todayISO } from "../lib/format";

const VERDICT_CHIP = { go: ["🍿 Go", "var(--success)"], wait: ["⏳ Wait", "var(--warn)"] };

export default function NowShowing({ onBook, onSave, onOpen, savedTitles, langs = [], nightOut }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("nowPlaying");
  const langKey = langs.map((l) => l.code).join(",");

  useEffect(() => {
    fetch(`/api/data?type=now-showing&langs=${langKey}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [langKey]);

  if (!data || (!data.nowPlaying.length && !data.upcoming.length && !data.trending?.length)) return null;
  const tabs = [
    ["nowPlaying", "In theatres", data.nowPlaying],
    ["upcoming", "Coming soon", data.upcoming],
    ["trending", "Trending", data.trending || []],
    ...langs.map((l) => [`lang:${l.code}`, `New in ${l.name}`, data.byLanguage?.[l.code] || []]),
  ].filter(([, , list]) => list.length);
  const current = tabs.find(([k]) => k === tab) || tabs[0];
  const [, title, list] = current;
  const saved = new Set((savedTitles || []).map((t) => t.toLowerCase()));
  const today = todayISO();

  return (
    <section aria-label="Now in theatres" style={{ marginBottom: 28 }}>
      <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>🍿 {title}</div>
      <div role="tablist" className="h-scroll" data-no-tab-swipe="1" style={{ gap: 6, marginBottom: 10 }}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={current[0] === k} className={`chip${current[0] === k ? " active" : ""}`} onClick={() => setTab(k)} style={{ minHeight: 30, fontSize: 12.5 }}>{label}</button>
        ))}
      </div>
      <div className="h-scroll" data-no-tab-swipe="1" style={{ gap: 12, paddingBottom: 6 }}>
        {list.map((m) => {
          const isSaved = saved.has(m.title.toLowerCase());
          const v = current[0] === "nowPlaying" ? theatreVerdict({ rating: m.rating, releaseDate: m.releaseDate, todayIso: today, nightOut }) : null;
          const chip = v && VERDICT_CHIP[v.verdict];
          const big = m.poster?.replace("/w154/", "/w342/");
          return (
            <div key={m.tmdbId} style={{ flex: "0 0 112px", width: 112 }}>
              <button type="button" onClick={() => { rememberPoster(m.title, big); onOpen?.(m); }} aria-label={`${m.title} details`}
                style={{ position: "relative", display: "block", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                <img src={m.poster} alt="" width={112} height={168} loading="lazy"
                  style={{ width: 112, height: 168, objectFit: "cover", borderRadius: 12, boxShadow: "var(--shadow-sm)", background: "var(--line)", display: "block" }} />
                {chip && <span style={{ position: "absolute", left: 6, bottom: 6, fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "rgba(0,0,0,.66)", color: "#fff", borderLeft: `3px solid ${chip[1]}` }}>{chip[0]}</span>}
              </button>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 31 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.rating != null ? `★ ${m.rating.toFixed(1)} · ` : ""}{m.releaseDate > today ? new Date(m.releaseDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : m.language || m.genre}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <button type="button" className="chip" aria-label={`Log ${m.title}`} onClick={() => { rememberPoster(m.title, big); onBook(m); }}
                  style={{ flex: 1, minHeight: 30, padding: "2px 6px", fontSize: 12, justifyContent: "center" }}>🎟️</button>
                <button type="button" className={`chip${isSaved ? " active" : ""}`} disabled={isSaved} aria-label={isSaved ? `${m.title} is on your watchlist` : `Save ${m.title} to watchlist`}
                  onClick={() => { rememberPoster(m.title, big); onSave(m); }}
                  style={{ flex: 1, minHeight: 30, padding: "2px 6px", fontSize: 12, justifyContent: "center" }}>{isSaved ? "✓" : "🔖"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
