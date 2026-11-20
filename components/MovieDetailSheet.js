// Tap any movie: banner, runtime, director, cast, trailer, where to stream
// it in India (highlighting apps you already have), "theatre or wait?",
// franchise progress and "More like this". Data from TMDB.
import { useEffect, useState } from "react";
import { onYourApps, theatreVerdict } from "../lib/movieStats";
import { rememberPoster } from "./Poster";
import { todayISO } from "../lib/format";
import { showToast } from "../lib/toast";

const cache = new Map();

export default function MovieDetailSheet({ target, onClose, onLog, onSave, userApps, nightOut, lovedGenres, seenIds, savedIds }) {
  const [stack, setStack] = useState([target]); // "More like this" opens on top
  const cur = stack[stack.length - 1];
  const key = cur.tmdbId ? `id:${cur.tmdbId}` : `t:${cur.title}|${cur.year || ""}`;
  const [d, setD] = useState(cache.get(key) || null);
  const [failed, setFailed] = useState(false);
  const [follows, setFollows] = useState(null); // Set of person ids
  const [friends, setFriends] = useState(null);

  useEffect(() => {
    fetch("/api/data?type=movie-prefs").then((r) => (r.ok ? r.json() : null)).then((p) => p && setFollows(new Set(p.followIds || []))).catch(() => {});
  }, []);
  useEffect(() => {
    setFriends(null);
    if (!d?.tmdbId) return;
    let live = true;
    fetch(`/api/data?type=friend-ratings&tmdbId=${d.tmdbId}`).then((r) => (r.ok ? r.json() : null)).then((x) => live && x && setFriends(x)).catch(() => {});
    return () => { live = false; };
  }, [d?.tmdbId]);

  async function toggleFollow(p, role) {
    if (!follows) return;
    const on = !follows.has(p.id);
    const next = new Set(follows);
    if (on) next.add(p.id); else next.delete(p.id);
    setFollows(next);
    try {
      const r = on
        ? await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "follow", personId: p.id, name: p.name, role }) })
        : await fetch(`/api/data?type=follow&id=${p.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      showToast(on ? `Following ${p.name}` : `Unfollowed ${p.name}`, on ? "⭐" : "👋");
      window.dispatchEvent(new Event("follows-changed"));
    } catch {
      setFollows(follows);
      showToast("Couldn't save — try again", "⚠️");
    }
  }
  const followBtn = (p, role) => (p?.id && follows ? (
    <button type="button" onClick={() => toggleFollow(p, role)} aria-pressed={follows.has(p.id)} aria-label={`${follows.has(p.id) ? "Unfollow" : "Follow"} ${p.name}`}
      style={{ border: "1px solid var(--line-strong)", background: follows.has(p.id) ? "var(--surface-2)" : "transparent", color: follows.has(p.id) ? "var(--text-2)" : "var(--accent-solid)", borderRadius: 12, padding: "2px 6px", fontSize: 10, fontWeight: 700, cursor: "pointer", marginTop: 4, minHeight: 24, whiteSpace: "nowrap" }}>
      {follows.has(p.id) ? "✓ Following" : "＋ Follow"}
    </button>
  ) : null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    if (cache.has(key)) { setD(cache.get(key)); return; }
    setD(null);
    const q = cur.tmdbId ? `id=${cur.tmdbId}` : `title=${encodeURIComponent(cur.title)}${cur.year ? `&year=${cur.year}` : ""}`;
    fetch(`/api/data?type=movie-details&${q}`)
      .then((r) => (r.ok ? r.json() : { details: null }))
      .then(({ details }) => {
        if (!live) return;
        if (!details) { setFailed(true); return; }
        cache.set(key, details);
        if (details.poster) rememberPoster(details.title, details.poster);
        setD(details);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayISO();
  const mine = d ? onYourApps(d.providers, userApps || new Set()) : [];
  const rel = d?.indiaRelease || d?.releaseDate || "";
  const recent = rel && (rel > today || (new Date(today) - new Date(rel)) / 86400000 <= 70);
  const verdict = d && recent ? theatreVerdict({ rating: d.rating, releaseDate: rel, todayIso: today, nightOut, lovedGenre: lovedGenres?.has?.(d.genre), onYourApps: mine }) : null;
  const seenParts = d?.collectionParts?.filter((p) => seenIds?.has(p.tmdbId)) || [];
  const releasedParts = d?.collectionParts?.filter((p) => p.releaseDate && p.releaseDate <= today) || [];
  const hours = d?.runtime ? `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : "";
  const isSaved = d && savedIds?.has(d.tmdbId);
  const verdictColor = { go: "var(--success)", wait: "var(--warn)", stream: "var(--success)", maybe: "var(--text-2)" };

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={d?.title || cur.title} data-no-tab-swipe="1" style={{ padding: 0, overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
        <div style={{ overflowY: "auto", paddingBottom: 16 }}>
          <div style={{ position: "relative", height: d?.backdrop ? 190 : 72, background: d?.backdrop ? `center/cover no-repeat url(${d.backdrop})` : "var(--surface-2)" }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, var(--bg) 100%)" }} />
            <div className="sheet-handle" style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", margin: 0 }} />
            {stack.length > 1 && (
              <button type="button" onClick={() => setStack(stack.slice(0, -1))} className="chip" style={{ position: "absolute", top: 14, left: 14, background: "rgba(0,0,0,.45)", color: "#fff", border: "none" }}>← Back</button>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="chip" style={{ position: "absolute", top: 14, right: 14, background: "rgba(0,0,0,.45)", color: "#fff", border: "none" }}>✕</button>
          </div>

          <div style={{ padding: "0 18px", marginTop: d?.backdrop ? -64 : -10, position: "relative" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
              {d?.poster && <img src={d.poster} alt="" width={92} height={138} style={{ width: 92, height: 138, objectFit: "cover", borderRadius: 12, boxShadow: "var(--shadow-md)", flexShrink: 0 }} />}
              <div style={{ minWidth: 0, paddingBottom: 4 }}>
                <div className="lora" style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{d?.title || cur.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4 }}>{[d?.year, hours, d?.language].filter(Boolean).join(" · ")}</div>
                {d?.rating != null && <div style={{ fontSize: 13, fontWeight: 700, color: "#C98A00", marginTop: 3 }}>★ {d.rating.toFixed(1)} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({d.votes.toLocaleString("en-IN")} votes)</span></div>}
              </div>
            </div>

            {!d && !failed && <div className="skeleton" style={{ height: 120, borderRadius: 14, marginTop: 16 }} />}
            {failed && <div style={{ marginTop: 16, fontSize: 14, color: "var(--text-2)" }}>Couldn&apos;t find details for this one on TMDB.</div>}

            {d && (
              <>
                {d.genres.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                    {d.genres.slice(0, 4).map((g) => <span key={g} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 20, background: "var(--surface-2)", color: "var(--text-2)" }}>{g}</span>)}
                  </div>
                )}

                {verdict && (
                  <div className="card" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 14, borderLeft: `4px solid ${verdictColor[verdict.verdict]}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: verdictColor[verdict.verdict], textTransform: "uppercase", letterSpacing: ".04em" }}>
                      {verdict.verdict === "go" ? "🍿 Theatre-worthy" : verdict.verdict === "wait" ? "⏳ Maybe wait" : verdict.verdict === "stream" ? "📺 Stream it" : "🤔 Theatre or wait?"}
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 2, lineHeight: 1.4 }}>{verdict.text}</div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  {d.trailer && <a href={d.trailer} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ flex: 1, textDecoration: "none", minHeight: 44 }}>▶ Trailer</a>}
                  {onLog && <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 44 }} onClick={() => onLog(d)}>🎟️ Log it</button>}
                  {onSave && <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 44 }} disabled={isSaved} onClick={() => onSave(d)}>{isSaved ? "✓ Saved" : "🔖 Save"}</button>}
                </div>

                <div style={{ marginTop: 16 }}>
                  <div className="field-label">Where to watch in India</div>
                  {d.providers.stream.length + d.providers.rent.length + d.providers.buy.length + d.providers.free.length === 0 ? (
                    <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>{rel && rel > today ? `Releases ${new Date(rel + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : recent ? "In theatres — not streaming yet." : "Not on any streaming app in India right now."}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {[["Stream", [...d.providers.stream, ...d.providers.free]], ["Rent", d.providers.rent], ["Buy", d.providers.buy]].filter(([, l]) => l.length).map(([label, list]) => (
                        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "var(--muted)", width: 44 }}>{label}</span>
                          {list.slice(0, 6).map((p) => {
                            const have = mine.some((x) => x.name === p.name);
                            return (
                              <span key={p.name} title={p.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "3px 8px 3px 3px", borderRadius: 20, background: have ? "var(--success-bg)" : "var(--surface-2)", fontWeight: have ? 700 : 500 }}>
                                {p.logo && <img src={p.logo} alt="" width={20} height={20} style={{ borderRadius: 6 }} />}
                                {p.name}{have ? " ✓" : ""}
                              </span>
                            );
                          })}
                        </div>
                      ))}
                      {mine.length > 0 && <div style={{ fontSize: 12.5, color: "var(--success)" }}>✓ = an app you already use — watch it at no extra cost.</div>}
                    </div>
                  )}
                </div>

                {(d.tagline || d.overview) && (
                  <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.5, color: "var(--text-2)" }}>
                    {d.tagline && <div style={{ fontStyle: "italic", marginBottom: 4 }}>“{d.tagline}”</div>}
                    {d.overview}
                  </div>
                )}

                {friends?.ratings?.length > 0 && (
                  <div className="card" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 14 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>👥 Friends who watched it</div>
                    {friends.ratings.map((f) => (
                      <div key={f.name} style={{ fontSize: 13.5, padding: "3px 0" }}>
                        <b>{f.name}</b>{" "}
                        {f.rating > 0 ? <span style={{ color: "#F5A524" }}>{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</span> : <span style={{ color: "var(--text-2)" }}>{{ loved: "loved it", liked: "liked it", okay: "found it okay", disliked: "didn't like it" }[f.my_take] || ""}</span>}
                        {f.review && <div style={{ fontSize: 12.5, color: "var(--text-2)", fontStyle: "italic" }}>“{f.review}”</div>}
                      </div>
                    ))}
                  </div>
                )}

                {d.directors.length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 13.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--muted)" }}>Directed by</span>
                    {(d.directorPeople || d.directors.map((name) => ({ name }))).map((p) => (
                      <span key={p.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><b>{p.name}</b><span style={{ marginTop: -4 }}>{followBtn(p, "director")}</span></span>
                    ))}
                  </div>
                )}

                {d.cast.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="field-label">Cast</div>
                    <div className="h-scroll" style={{ gap: 10 }}>
                      {d.cast.map((c) => (
                        <div key={c.name + c.character} style={{ flex: "0 0 72px", textAlign: "center" }}>
                          {c.photo
                            ? <img src={c.photo} alt="" width={56} height={56} loading="lazy" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", background: "var(--line)" }} />
                            : <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--surface-2)", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>👤</div>}
                          <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 4, lineHeight: 1.2 }}>{c.name}</div>
                          {c.character && <div style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.2 }}>{c.character.slice(0, 24)}</div>}
                          {followBtn(c, "actor")}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {releasedParts.length > 1 && (
                  <div className="card" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 14 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{d.collection.name}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2 }}>
                      You&apos;ve seen {seenParts.length} of {releasedParts.length}
                      {releasedParts.find((p) => !seenIds?.has(p.tmdbId)) && <> · next: <b>{releasedParts.find((p) => !seenIds?.has(p.tmdbId)).title}</b></>}
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                      {releasedParts.map((p) => <span key={p.tmdbId} title={p.title} style={{ flex: 1, height: 6, borderRadius: 3, background: seenIds?.has(p.tmdbId) ? "var(--success)" : "var(--line)" }} />)}
                    </div>
                  </div>
                )}

                {d.recommendations.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div className="field-label">More like this</div>
                    <div className="h-scroll" style={{ gap: 10 }}>
                      {d.recommendations.slice(0, 10).map((r) => (
                        <button key={r.tmdbId} type="button" onClick={() => setStack([...stack, { tmdbId: r.tmdbId, title: r.title }])}
                          style={{ flex: "0 0 84px", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}>
                          <img src={r.poster} alt="" width={84} height={126} loading="lazy" style={{ width: 84, height: 126, objectFit: "cover", borderRadius: 10, background: "var(--line)" }} />
                          <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 4, lineHeight: 1.2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 16 }}>Movie data and streaming info from TMDB (via JustWatch). This app isn&apos;t endorsed or certified by TMDB.</div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
