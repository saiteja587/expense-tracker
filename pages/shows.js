// TV shows you binge on OTT apps: where you are (season/episode), one tap
// for the next episode, when the next one airs, and where it streams.
// Show data from TMDB.
import { useEffect, useMemo, useState } from "react";
import OttOptimizer from "../components/OttOptimizer";

// Next episode: the date from TMDB, plus the exact time in IST and the
// channel from TVmaze (free, no key) when it knows the show.
const airCache = new Map();
function AirTime({ show, nx }) {
  const [tv, setTv] = useState(airCache.get(show.tmdb_id) || null);
  useEffect(() => {
    if (!show.tmdb_id || airCache.has(show.tmdb_id)) return;
    let live = true;
    fetch(`/api/data?type=tv-extras&tmdbId=${show.tmdb_id}`).then((r) => (r.ok ? r.json() : null)).then((j) => { airCache.set(show.tmdb_id, j?.tvmaze || null); if (live) setTv(j?.tvmaze || null); }).catch(() => {});
    return () => { live = false; };
  }, [show.tmdb_id]);
  const exact = tv?.next && tv.next.season === nx.season && tv.next.episode === nx.episode ? new Date(tv.next.airstamp) : null;
  const when = exact
    ? exact.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : new Date(nx.airDate + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div style={{ fontSize: 12, color: "var(--success)", marginTop: 5, fontWeight: 600 }}>
      🆕 S{nx.season} E{nx.episode} airs {when}{tv?.network ? ` on ${tv.network}` : ""}
    </div>
  );
}
import Link from "next/link";
import { ArrowLeft, Trash2, Plus } from "lucide-react";
import MovieSearchInput from "../components/MovieSearchInput";
import { showToast } from "../lib/toast";
import { vibrate } from "../lib/haptics";
import { todayISO } from "../lib/format";

const STATUSES = [["watching", "▶ Watching"], ["paused", "⏸ Paused"], ["finished", "✅ Finished"], ["plan", "🔖 Want to watch"]];

async function api(method, body, query = "") {
  const res = await fetch(`/api/data${query}`, method === "GET" || method === "DELETE" ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Couldn't save");
  return d;
}

export default function Shows() {
  const [shows, setShows] = useState(null);
  const [info, setInfo] = useState({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("watching");

  async function load() {
    try {
      const d = await api("GET", null, "?type=tv-shows");
      setShows(d.shows || []);
      setInfo(d.info || {});
    } catch {
      setShows((s) => s || []);
    }
  }
  useEffect(() => { load(); }, []);

  async function add(m) {
    setBusy(true);
    try {
      const det = await api("GET", null, `?type=tv-details&id=${m.tmdbId}`).catch(() => ({}));
      const platform = det.details?.providers?.stream?.[0]?.name || "";
      await api("POST", { type: "tv-show", tmdbId: m.tmdbId, title: m.title, poster: m.poster || "", platform, status: "watching", season: 1, episode: 0 });
      setQ("");
      setFilter("watching");
      showToast(`${m.title} added`, "📺");
      load();
    } catch (e) { showToast(e.message, "⚠️"); } finally { setBusy(false); }
  }

  async function save(show, changes, toast) {
    const next = { ...show, ...changes };
    setShows((list) => list.map((s) => (s.id === show.id ? next : s)));
    try {
      await api("PUT", { type: "tv-show", id: show.id, platform: next.platform, status: next.status, season: next.season, episode: next.episode, rating: next.rating, note: next.note });
      if (toast) showToast(toast, "📺");
    } catch (e) {
      showToast(e.message, "⚠️");
      load();
    }
  }

  function nextEpisode(show) {
    vibrate(8);
    const seasons = info[show.id]?.seasons || [];
    const cur = seasons.find((s) => s.number === show.season);
    if (cur && cur.episodes && show.episode + 1 >= cur.episodes) {
      const hasNext = seasons.some((s) => s.number === show.season + 1);
      return save(show, { episode: cur.episodes, status: hasNext || info[show.id]?.status === "Returning Series" ? show.status : "finished" },
        hasNext ? `Season ${show.season} done! 🎉` : `${show.title} — all caught up 🎉`);
    }
    return save(show, { episode: show.episode + 1, status: show.status === "plan" ? "watching" : show.status });
  }

  async function remove(show) {
    if (!window.confirm(`Remove ${show.title}?`)) return;
    setShows((list) => list.filter((s) => s.id !== show.id));
    await api("DELETE", null, `?type=tv-show&id=${show.id}`).catch(() => load());
  }

  const today = todayISO();
  const counts = useMemo(() => Object.fromEntries(STATUSES.map(([k]) => [k, (shows || []).filter((s) => s.status === k).length])), [shows]);
  const visible = (shows || []).filter((s) => s.status === filter);
  // Rough binge time: episodes watched × typical episode length.
  const hours = useMemo(() => {
    let mins = 0;
    for (const s of shows || []) {
      const i = info[s.id];
      if (!i?.episodeRuntime) continue;
      const before = (i.seasons || []).filter((x) => x.number < s.season).reduce((t, x) => t + x.episodes, 0);
      mins += (before + s.episode) * i.episodeRuntime;
    }
    return Math.round(mins / 60);
  }, [shows, info]);

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 120px" }}>
      <Link href="/movies" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--muted)", textDecoration: "none" }}><ArrowLeft size={13} /> Movies</Link>
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "6px 0 2px" }}>📺 Shows</h1>
      <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 16 }}>
        Series you&apos;re watching — where you left off, and when the next episode drops.{hours > 0 ? ` About ${hours} hours watched so far.` : ""}
      </div>
      <OttOptimizer shows={shows || []} />

      <MovieSearchInput kind="tv" id="tv-search" placeholder="Add a show — type to search" value={q} onChange={setQ} onPick={add} />
      {busy && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Adding…</div>}

      <div role="tablist" className="h-scroll" data-no-tab-swipe="1" style={{ gap: 6, margin: "16px 0 12px" }}>
        {STATUSES.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} className={`chip${filter === k ? " active" : ""}`} onClick={() => setFilter(k)} style={{ minHeight: 32, fontSize: 12.5 }}>
            {label}{counts[k] ? ` · ${counts[k]}` : ""}
          </button>
        ))}
      </div>

      {shows === null && <div className="skeleton" style={{ height: 120, borderRadius: 18 }} />}
      {shows && visible.length === 0 && (
        <div style={{ border: "1px dashed var(--line-strong)", borderRadius: 16, padding: "28px 16px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          {shows.length === 0 ? "Search above to add the first show you're watching." : "Nothing here."}
        </div>
      )}

      {visible.map((s) => {
        const i = info[s.id] || {};
        const season = (i.seasons || []).find((x) => x.number === s.season);
        const total = season?.episodes || 0;
        const pct = total ? Math.min(100, (s.episode / total) * 100) : 0;
        const hasNextSeason = (i.seasons || []).some((x) => x.number === s.season + 1);
        const seasonDone = total && s.episode >= total;
        const nx = i.nextEpisode;
        return (
          <div key={s.id} className="card" style={{ display: "flex", gap: 12, padding: 12, borderRadius: 18, marginBottom: 12 }}>
            {(i.poster || s.poster)
              ? <img src={i.poster || s.poster} alt="" width={70} height={105} style={{ width: 70, height: 105, objectFit: "cover", borderRadius: 10, flexShrink: 0, background: "var(--line)" }} />
              : <div style={{ width: 70, height: 105, borderRadius: 10, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>📺</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 15.5, lineHeight: 1.25 }}>{s.title}</div>
                <button type="button" className="icon-btn danger" aria-label={`Remove ${s.title}`} onClick={() => remove(s)} style={{ marginTop: -6, marginRight: -6 }}><Trash2 size={16} /></button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{[s.platform || i.stream?.[0]?.name, i.status === "Ended" ? "Ended" : i.status === "Returning Series" ? "Returning" : ""].filter(Boolean).join(" · ")}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>
                Season {s.season} · Episode {s.episode}{total ? ` of ${total}` : ""}
              </div>
              {total > 0 && (
                <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden", marginTop: 4 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-gradient)", borderRadius: 4 }} />
                </div>
              )}
              {nx && nx.airDate >= today && <AirTime show={s} nx={nx} />}
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {seasonDone && hasNextSeason ? (
                  <button type="button" className="btn btn-primary" style={{ minHeight: 36, fontSize: 13 }} onClick={() => save(s, { season: s.season + 1, episode: 0, status: "watching" }, `Starting season ${s.season + 1}`)}>Start season {s.season + 1}</button>
                ) : !seasonDone ? (
                  <button type="button" className="btn btn-primary" style={{ minHeight: 36, fontSize: 13 }} onClick={() => nextEpisode(s)}><Plus size={14} /> Watched E{s.episode + 1}</button>
                ) : null}
                <select aria-label="Status" value={s.status} onChange={(e) => save(s, { status: e.target.value })} style={{ width: "auto", minHeight: 36, fontSize: 13, padding: "4px 8px" }}>
                  {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                {s.episode > 0 && (
                  <button type="button" className="chip" style={{ minHeight: 36 }} aria-label="Undo one episode" onClick={() => save(s, { episode: s.episode - 1 })}>−1</button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 24 }}>Show data from TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB.</div>
    </div>
  );
}
