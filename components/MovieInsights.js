// Stats-tab extras: yearly movie goal + badges, "is each streaming app
// worth it", cheaper-show tips, money saved by waiting for OTT, your taste
// vs TMDB audiences, people you follow, and sharing ratings with friends.
import { useEffect, useMemo, useState } from "react";
import { showToast } from "../lib/toast";
import { fmt } from "../lib/format";
import { subscriptionValue, showPriceTips, savedByWaiting, movieGoal, tasteVsCrowd } from "../lib/movieInsights";

const card = { padding: "16px 18px", borderRadius: 18, marginBottom: 20 };
const title = { fontSize: 15, fontWeight: 600, marginBottom: 10 };

async function post(body) {
  const r = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Couldn't save");
}

export function useMoviePrefs() {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    fetch("/api/data?type=movie-prefs").then((r) => (r.ok ? r.json() : null)).then((d) => d && setPrefs(d)).catch(() => {});
  }, []);
  async function save(patch) {
    const prev = prefs;
    setPrefs({ ...prefs, ...patch });
    try { await post({ type: "movie-prefs", ...patch }); } catch (e) { setPrefs(prev); showToast(e.message, "⚠️"); throw e; }
  }
  return [prefs, save];
}

function Ring({ pct, size = 76, children }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-solid)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .6s" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", lineHeight: 1.1 }}>{children}</div>
    </div>
  );
}

// ---- Goal & badges ----
export function MovieGoalCard({ movies, meta, today, prefs, savePrefs }) {
  const [draft, setDraft] = useState(null);
  const g = useMemo(() => movieGoal({ movies, meta: meta || {}, goal: prefs?.goal, todayIso: today }), [movies, meta, prefs?.goal, today]);
  if (!prefs) return null;
  async function saveGoal(e) {
    e.preventDefault();
    try {
      await savePrefs({ goal: parseInt(draft, 10) || null });
      setDraft(null);
      showToast(parseInt(draft, 10) ? `Goal set: ${parseInt(draft, 10)} movies in ${g.year}` : "Goal removed", "🎯");
    } catch { /* toast shown */ }
  }
  const earned = g.badges.filter((b) => b.earned).length;
  return (
    <section aria-label="Movie goal" className="card" style={card}>
      <div className="lora" style={title}>🎯 {g.year} movie goal</div>
      {draft !== null ? (
        <form onSubmit={saveGoal} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="number" inputMode="numeric" min="0" max="1000" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Movies this year" style={{ width: 110 }} autoFocus />
          <span style={{ fontSize: 13, color: "var(--muted)" }}>movies this year</span>
          <button type="submit" className="btn btn-primary" style={{ minHeight: 38, padding: "0 16px" }}>Save</button>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 38, padding: "0 14px" }} onClick={() => setDraft(null)}>Cancel</button>
        </form>
      ) : g.goal ? (
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Ring pct={g.pct}>
            <span className="tabnum" style={{ fontWeight: 800, fontSize: 18 }}>{g.done}</span>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>of {g.goal}</span>
          </Ring>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>
              {g.pace === "done" ? "Goal smashed! 🎉" : g.pace === "ahead" ? "On track 👏" : `${g.behindBy} behind pace`}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2 }}>
              {g.pace === "done" ? `${g.done} movies so far this year.` : `${g.goal - g.done} to go${g.pace === "behind" ? " — a movie this weekend?" : "."}`}
            </div>
            <button type="button" onClick={() => setDraft(String(g.goal))} style={{ background: "none", border: "none", padding: 0, marginTop: 4, color: "var(--accent-solid)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Change goal</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>{g.done} movie{g.done === 1 ? "" : "s"} so far this year. Set a target?</div>
          <button type="button" className="chip" onClick={() => setDraft(String(Math.max(12, Math.ceil((g.done + 1) / 6) * 6 + 6)))}>🎯 Set a goal</button>
        </div>
      )}
      {g.streak >= 2 && <div style={{ fontSize: 13, marginTop: 12 }}>🔥 <b>{g.streak}-month streak</b> — at least one movie every month.</div>}
      <div style={{ fontSize: 12, color: "var(--muted)", margin: "14px 0 8px" }}>Badges · {earned} of {g.badges.length}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
        {g.badges.map((b) => (
          <div key={b.id} title={b.desc} style={{ textAlign: "center", padding: "10px 6px", borderRadius: 14, background: b.earned ? "var(--surface-2)" : "transparent", border: "1px solid var(--line)", opacity: b.earned ? 1 : 0.6 }}>
            <div style={{ fontSize: 24, filter: b.earned ? "none" : "grayscale(1)" }}>{b.emoji}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 2, lineHeight: 1.2 }}>{b.title}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{b.earned ? "Earned" : `${b.have}/${b.need}`}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Money: streaming value, cheaper shows, saved by waiting ----
export function MovieMoneyCard({ movies, meta, expenses, recurring, nightOut, today }) {
  const [shows, setShows] = useState([]);
  useEffect(() => {
    fetch("/api/data?type=tv-shows&lite=1").then((r) => (r.ok ? r.json() : null)).then((d) => d && setShows(d.shows || [])).catch(() => {});
  }, []);
  const subs = useMemo(() => subscriptionValue({ recurring, expenses, movies, tvShows: shows, todayIso: today, nightOut }), [recurring, expenses, movies, shows, today, nightOut]);
  const tips = useMemo(() => showPriceTips(movies, today), [movies, today]);
  const waited = useMemo(() => savedByWaiting({ movies, meta: meta || {}, nightOut, todayIso: today }), [movies, meta, nightOut, today]);
  if (!subs.length && !tips.length && !waited) return null;
  const color = { unused: "var(--danger)", pricey: "var(--warn, #C98A00)", good: "var(--success)" };
  return (
    <section aria-label="Movie money" className="card" style={card}>
      <div className="lora" style={title}>💰 Movie money</div>
      {subs.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Your streaming apps, last 30 days</div>
          {subs.map((s) => (
            <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: color[s.verdict], marginTop: 6, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12.5 }}>· {fmt(s.monthly)} {s.per}</span></div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{s.text}</div>
              </div>
            </div>
          ))}
        </>
      )}
      {waited && (
        <div style={{ marginTop: 12, fontSize: 13.5 }}>
          ⏳ <b>Waiting for OTT saved you {fmt(waited.savedThisYear || waited.saved)}</b>{waited.countThisYear ? " this year" : ""}
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{waited.countThisYear || waited.count} theatre release{(waited.countThisYear || waited.count) === 1 ? "" : "s"} you streamed instead (your night out ≈ {fmt(nightOut)}), like {waited.titles.join(", ")}.</div>
        </div>
      )}
      {tips.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Cheaper shows, from your own tickets</div>
          {tips.map((t) => (
            <div key={t.emoji} style={{ fontSize: 13, padding: "4px 0" }}>
              {t.emoji} {t.text}{t.saving >= 100 && <span style={{ color: "var(--success)", fontWeight: 600 }}> Switching half would save ~{fmt(t.saving)} a year.</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Taste vs TMDB audiences ----
export function TasteCard({ movies, meta }) {
  const t = useMemo(() => tasteVsCrowd({ movies, meta: meta || {} }), [movies, meta]);
  if (!t) return null;
  return (
    <section aria-label="Your taste" className="card" style={card}>
      <div className="lora" style={title}>🧐 Your taste vs the crowd</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{t.summary}</div>
      {t.lines.map((l) => <div key={l} style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>• {l}</div>)}
      {t.biggest && (
        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6 }}>
          • Biggest disagreement: <b>{t.biggest.title}</b> — you gave {"★".repeat(t.biggest.mine)}, the crowd ★{t.biggest.crowd.toFixed(1)}/10.
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>From {t.count} movies you rated, against TMDB user scores.</div>
    </section>
  );
}

// ---- People you follow + sharing with friends ----
export function FollowingCard({ onOpen, prefs, savePrefs }) {
  const [list, setList] = useState(null);
  async function load() {
    const d = await fetch("/api/data?type=following").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setList(d.following);
  }
  useEffect(() => {
    load();
    const again = () => load();
    window.addEventListener("follows-changed", again);
    return () => window.removeEventListener("follows-changed", again);
  }, []);
  async function unfollow(p) {
    await fetch(`/api/data?type=follow&id=${p.personId}`, { method: "DELETE" }).catch(() => {});
    showToast(`Unfollowed ${p.name}`, "👋");
    load();
  }
  const date = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <section aria-label="Following" className="card" style={card}>
      <div className="lora" style={title}>⭐ Actors & directors you follow</div>
      {!list ? null : list.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Open any movie and tap <b>＋ Follow</b> on an actor or director — you&apos;ll get a notification when they have a new release.</div>
      ) : list.map((p) => (
        <div key={p.personId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
            {p.next ? (
              <button type="button" onClick={() => onOpen?.({ tmdbId: p.next.tmdbId, title: p.next.title })} style={{ background: "none", border: "none", padding: 0, textAlign: "left", color: "var(--success)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                Next: {p.next.title} · {date(p.next.releaseDate)}
              </button>
            ) : p.latest ? (
              <button type="button" onClick={() => onOpen?.({ tmdbId: p.latest.tmdbId, title: p.latest.title })} style={{ background: "none", border: "none", padding: 0, textAlign: "left", color: "var(--text-2)", fontSize: 12.5, cursor: "pointer" }}>
                Latest: {p.latest.title}
              </button>
            ) : <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Nothing announced yet</div>}
          </div>
          <button type="button" className="chip" onClick={() => unfollow(p)} style={{ minHeight: 30, fontSize: 12 }}>Unfollow</button>
        </div>
      ))}
      {prefs && (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={!!prefs.shareRatings} onChange={(e) => savePrefs({ shareRatings: e.target.checked }).then(() => showToast(e.target.checked ? "Friends who share can now see your ratings" : "Your ratings are private again", "👥")).catch(() => {})} style={{ width: 18, height: 18, marginTop: 1 }} />
          <span>
            <b>Share my movie ratings with friends in the app</b>
            <span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>When you open a movie you&apos;ll see “Ravi gave it ★★★★” — only from friends who share too. Money stays private.</span>
          </span>
        </label>
      )}
    </section>
  );
}
