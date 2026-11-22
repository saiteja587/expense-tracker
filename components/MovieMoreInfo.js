// Extra facts for a film from free sources (each shows only if set up):
// IMDb / Rotten Tomatoes / Metacritic (OMDb), budget vs box office and a
// summary (Wikidata + Wikipedia), logo (fanart.tv), subtitle languages
// (OpenSubtitles) and review videos (YouTube).
import { useEffect, useState } from "react";

const cache = new Map();
const money = (m) => {
  if (!m) return "";
  const { amount, currency } = m;
  if (currency === "₹") return amount >= 1e7 ? `₹${(amount / 1e7).toFixed(amount >= 1e9 ? 0 : 1)} crore` : `₹${(amount / 1e5).toFixed(1)} lakh`;
  const sym = currency || "";
  return amount >= 1e9 ? `${sym}${(amount / 1e9).toFixed(1)}B` : amount >= 1e6 ? `${sym}${(amount / 1e6).toFixed(1)}M` : `${sym}${amount.toLocaleString("en-IN")}`;
};

export default function MovieMoreInfo({ d }) {
  const key = d?.tmdbId;
  const [x, setX] = useState(key ? cache.get(key) || null : null);
  useEffect(() => {
    if (!key) return;
    if (cache.has(key)) { setX(cache.get(key)); return; }
    let live = true;
    const q = new URLSearchParams({ type: "movie-extras", tmdbId: String(key), title: d.title || "", year: d.year || "", language: d.language || "", ...(d.imdbId ? { imdbId: d.imdbId } : {}) });
    fetch(`/api/data?${q}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) cache.set(key, j); if (live) setX(j); }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!x) return null;
  const { ratings, wiki, art, subtitles, videos } = x;
  const chips = [];
  if (ratings?.imdb) chips.push(<a key="imdb" href={ratings.imdbUrl} target="_blank" rel="noopener noreferrer" className="chip" style={{ textDecoration: "none", background: "#F5C518", color: "#000", border: "none", fontWeight: 700 }}>IMDb {ratings.imdb.toFixed(1)}</a>);
  if (ratings?.rottenTomatoes) chips.push(<span key="rt" className="chip" style={{ cursor: "default" }}>🍅 {ratings.rottenTomatoes}</span>);
  if (ratings?.metacritic) chips.push(<span key="mc" className="chip" style={{ cursor: "default" }}>Metacritic {ratings.metacritic}</span>);
  const any = chips.length || wiki || art?.logo || subtitles?.length || videos?.length;
  if (!any) return null;

  return (
    <div style={{ marginTop: 14 }}>
      {art?.logo && <img src={art.logo} alt={`${d.title} logo`} style={{ maxWidth: "70%", maxHeight: 70, objectFit: "contain", display: "block", marginBottom: 8 }} />}
      {chips.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chips}</div>}
      {ratings?.awards && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6 }}>🏆 {ratings.awards}</div>}

      {wiki && (wiki.budget || wiki.boxOffice || wiki.summary) && (
        <div className="card" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 14 }}>
          {(wiki.budget || wiki.boxOffice) && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
              {wiki.budget && <span>Budget <b>{money(wiki.budget)}</b></span>}
              {wiki.boxOffice && <span>Box office <b>{money(wiki.boxOffice)}</b></span>}
              {wiki.verdict && <span style={{ color: wiki.verdict.ratio >= 1 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{wiki.verdict.label} ({wiki.verdict.ratio}× budget)</span>}
            </div>
          )}
          {wiki.summary && <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-2)", marginTop: wiki.budget || wiki.boxOffice ? 6 : 0 }}>{wiki.summary}</div>}
          {wiki.article && <a href={wiki.article} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--muted)" }}>Wikipedia ↗</a>}
        </div>
      )}

      {subtitles?.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>💬 Subtitles exist in {subtitles.slice(0, 5).map((s) => s.name).join(", ")}</div>
      )}

      {videos?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="field-label">Reviews on YouTube</div>
          <div className="h-scroll">
            {videos.map((v) => (
              <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" style={{ width: 180, flexShrink: 0, textDecoration: "none", color: "inherit" }}>
                {v.thumb && <img src={v.thumb} alt="" width={180} height={101} style={{ width: 180, height: 101, objectFit: "cover", borderRadius: 10 }} />}
                <div style={{ fontSize: 12, lineHeight: 1.3, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.title}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{v.channel}</div>
              </a>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8 }}>
        {[ratings && "Ratings via OMDb", wiki && "facts from Wikipedia/Wikidata (CC BY-SA)", art?.logo && "art from fanart.tv", subtitles?.length && "subtitles info from OpenSubtitles"].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}
