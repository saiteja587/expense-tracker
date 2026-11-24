// Settings → Movie data sources: which free sources are switched on (a key
// is set in Vercel) and a one-time import from a public Trakt profile.
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api";
import { showToast } from "../lib/toast";

const LIST = [
  ["tmdb", "TMDB", "Posters, details, cast, trailers, where to stream", "TMDB_API_KEY"],
  ["omdb", "OMDb", "IMDb, Rotten Tomatoes and Metacritic ratings, awards", "OMDB_API_KEY"],
  ["wikipedia", "Wikipedia + Wikidata", "Budget, box office, hit or flop, summary", null],
  ["tvmaze", "TVmaze", "Exact episode air times and channel", null],
  ["fanart", "fanart.tv", "Movie logos and backgrounds", "FANART_API_KEY"],
  ["opensubtitles", "OpenSubtitles", "Which subtitle languages exist", "OPENSUBTITLES_API_KEY"],
  ["youtube", "YouTube", "Review videos in the film's language", "YOUTUBE_API_KEY"],
  ["trakt", "Trakt", "Import your watch history and watchlist", "TRAKT_CLIENT_ID"],
];

export default function MovieSources() {
  const [on, setOn] = useState(null);
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiGet("movie-sources").then((r) => setOn(r.sources)).catch(() => setOn("error")); }, []);
  if (!on) return <div style={{ fontSize: 13, color: "var(--muted)" }}>Checking…</div>;
  if (on === "error") return <div style={{ fontSize: 13, color: "var(--danger)" }}>Couldn't check the sources. Close and reopen Settings to try again.</div>;

  async function importTrakt(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiPost({ type: "trakt-import", username: user });
      showToast(`Imported ${r.movies} movie${r.movies === 1 ? "" : "s"} and ${r.watchlist} watchlist title${r.watchlist === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} already here` : ""}`, "🎬");
    } catch (err) { showToast(err.message, "⚠️"); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>All free. One with a key switches on after you add that key in Vercel → Settings → Environment Variables and redeploy. Tap any movie poster to see what they add.</div>
      {LIST.map(([id, name, what, env]) => (
        <div key={id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--line)" }}>
          <span aria-hidden="true">{on[id] ? "🟢" : "⚪"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{name} <span style={{ fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>{on[id] ? "· on" : env ? `· add ${env}` : ""}</span></div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{what}</div>
          </div>
        </div>
      ))}
      {on.trakt && (
        <form onSubmit={importTrakt} style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Your Trakt username (profile must be public)" style={{ flex: 1 }} autoCapitalize="none" />
          <button type="submit" className="btn btn-primary" disabled={busy || !user.trim()}>{busy ? "Importing…" : "Import"}</button>
        </form>
      )}
      {on.trakt && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Movies come in as streaming, ₹0, not deducted, with your Trakt rating as your take. Safe to run again.</div>}
    </div>
  );
}
