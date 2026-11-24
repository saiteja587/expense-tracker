// Movie corner: ranking game, quiz, ticket stubs, taste match with friends,
// and importing from Letterboxd or IMDb.
import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Trash2 } from "lucide-react";
import { useLife } from "../lib/useLife";
import { apiGet, apiPost } from "../lib/api";
import { mapMovie } from "../lib/ledger";
import { rankFilms, nextDuel, makeQuiz, parseMovieCsv } from "../lib/movieLab";
import { fileToCompressedDataUrl } from "../lib/receiptImage";
import { todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import Poster from "../components/Poster";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const card = { borderRadius: 18, padding: 16, marginBottom: 16 };
const H = ({ children, sub }) => <div style={{ marginBottom: 10 }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{children}</div>{sub && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{sub}</div>}</div>;
const TABS = [["rank", "🏆 Ranking"], ["quiz", "❓ Quiz"], ["stubs", "🎟️ Stubs"], ["friends", "🤝 Taste match"], ["import", "📥 Import"]];

function Ranking({ movies, today }) {
  const life = useLife(["duel"]);
  const [pair, setPair] = useState(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const duels = useMemo(() => [...life.of("duel")].sort((a, b) => a.id - b.id), [life]);
  const ranked = useMemo(() => rankFilms(movies, duels, today), [movies, duels, today]);
  const count = duels.length;
  useEffect(() => { if (life.loaded) setPair(nextDuel(ranked, duels)); }, [life.loaded, count, movies]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!life.loaded) return null;
  if (ranked.length < 2) return <div className="card" style={card}>Log at least two watched films to start ranking.</div>;
  async function choose(i) {
    if (busy) return;
    setBusy(true);
    try { await life.save({ kind: "duel", data: { winner: pair[i].title, loser: pair[1 - i].title } }); } catch (e) { showToast(e.message, "⚠️"); } finally { setBusy(false); }
  }
  const last = duels[duels.length - 1];
  return (
    <>
      {pair && (
        <div className="card" style={card}>
          <H sub={`${count} match${count === 1 ? "" : "es"} played`}>Which was better?</H>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {pair.map((f, i) => (
              <button key={f.title} type="button" disabled={busy} onClick={() => choose(i)} aria-label={`${f.title} was better`} style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 14, padding: 12, cursor: "pointer", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <Poster title={f.title} width={96} />
                <span style={{ fontSize: 14, fontWeight: 600, textAlign: "center" }}>{f.title}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="chip" onClick={() => setPair(nextDuel(ranked, duels))}>Skip</button>
            {last && <button type="button" className="chip" onClick={() => life.remove(last.id)}>Undo last</button>}
          </div>
        </div>
      )}
      <div className="card" style={card}>
        <H sub="Starts from your stars, then your choices move it.">Your all-time list</H>
        <ol style={{ margin: 0, paddingLeft: 26 }}>
          {ranked.slice(0, all ? 200 : 10).map((f) => <li key={f.title} style={{ fontSize: 14, padding: "3px 0" }}>{f.title}{f.stars ? <span style={{ color: "#C98A00", fontSize: 12 }}> {f.stars}★</span> : null}</li>)}
        </ol>
        {ranked.length > 10 && <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? "Show top 10" : "Show more"}</button>}
      </div>
    </>
  );
}

function Quiz({ movies, meta, today }) {
  const [quiz, setQuiz] = useState(null);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState(0);
  const start = () => { setQuiz(makeQuiz(movies, meta, { todayIso: today })); setAt(0); setPicked(null); setScore(0); };
  if (!quiz) return <div className="card" style={card}><H sub="Questions from the films you've watched.">How well do you remember them?</H><button type="button" className="btn btn-primary" onClick={start}>Start quiz</button></div>;
  if (!quiz.length) return <div className="card" style={card}>Not enough yet: log at least four films that TMDB recognises, by different directors, then try again.</div>;
  if (at >= quiz.length) return <div className="card" style={card}><H>You got {score} of {quiz.length}</H><button type="button" className="btn btn-primary" onClick={start}>Play again</button></div>;
  const q = quiz[at];
  return (
    <div className="card" style={card}>
      <H sub={`Question ${at + 1} of ${quiz.length} · score ${score}`}>{q.text}</H>
      <div style={{ display: "grid", gap: 8 }}>
        {q.options.map((o) => {
          const right = picked && o === q.answer, wrong = picked === o && o !== q.answer;
          return <button key={o} type="button" disabled={!!picked} onClick={() => { setPicked(o); if (o === q.answer) setScore(score + 1); }} style={{ padding: "11px 14px", borderRadius: 12, textAlign: "left", border: "1px solid var(--line-strong)", cursor: "pointer", color: "var(--ink)", background: right ? "var(--success-bg)" : wrong ? "var(--danger-bg)" : "var(--surface)" }}>{o}{right ? " ✓" : wrong ? " ✗" : ""}</button>;
        })}
      </div>
      {picked && <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => { setAt(at + 1); setPicked(null); }}>Next</button>}
    </div>
  );
}

function StubPhoto({ stub, onOpen }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { let live = true; if (stub.hasPhoto) apiGet("life-photo", { id: stub.id }).then((r) => live && setSrc(r.photo)).catch(() => {}); return () => { live = false; }; }, [stub.id, stub.hasPhoto]);
  if (!src) return <div style={{ height: 120, borderRadius: 10, background: "var(--surface-2)", display: "grid", placeItems: "center", fontSize: 30 }}>🎟️</div>;
  return <button type="button" onClick={() => onOpen(src)} aria-label={`Open ${stub.title} ticket`} style={{ border: "none", padding: 0, background: "none", cursor: "pointer", width: "100%" }}><img src={src} alt={`Ticket for ${stub.title}`} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 10, display: "block" }} /></button>;
}
function Stubs({ movies, today }) {
  const life = useLife(["stub"]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(null);
  const [shown, setShown] = useState(12);
  if (!life.loaded) return null;
  const stubs = life.of("stub");
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { const photo = await fileToCompressedDataUrl(file, { maxDimension: 1000, quality: 0.6 }); setF((x) => ({ ...x, photo })); } catch (err) { showToast(err.message, "⚠️"); }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await life.save({ kind: "stub", date: f.date, photo: f.photo || undefined, data: { title: f.title, venue: f.venue, seat: f.seat } });
      setF(null);
    } catch (err) { showToast(err.message, "⚠️"); } finally { setBusy(false); }
  }
  function pickMovie(title) {
    const m = movies.find((x) => x.title === title);
    setF((x) => ({ ...x, title, ...(m ? { date: m.date, venue: m.venueName || x.venue } : {}) }));
  }
  return (
    <div className="card" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><H sub="Photos of your tickets.">Ticket stubs</H>{!f && <button type="button" className="chip" onClick={() => setF({ title: "", venue: "", seat: "", date: today })}>Add stub</button>}</div>
      {f && (
        <form onSubmit={save} style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          <input aria-label="Stub movie" list="stub-movies" value={f.title} onChange={(e) => pickMovie(e.target.value)} placeholder="Movie" />
          <datalist id="stub-movies">{[...new Set(movies.map((m) => m.title))].slice(0, 200).map((t) => <option key={t} value={t} />)}</datalist>
          <label style={{ display: "grid", gap: 3 }}><span className="field-label">Date</span><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <div style={{ display: "flex", gap: 8 }}>
            <input aria-label="Theatre" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="Theatre" />
            <input aria-label="Seat" value={f.seat} onChange={(e) => setF({ ...f, seat: e.target.value })} placeholder="Seat" />
          </div>
          <label className="chip" style={{ justifySelf: "start" }}>{f.photo ? "Photo added ✓" : "📷 Add photo"}<input type="file" accept="image/*" onChange={pick} style={{ display: "none" }} /></label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setF(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !f.title.trim()}>{busy ? "Saving…" : "Save stub"}</button>
          </div>
        </form>
      )}
      {stubs.length === 0 && !f && <div style={{ fontSize: 13, color: "var(--muted)" }}>No stubs yet.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
        {stubs.slice(0, shown).map((x) => (
          <div key={x.id}>
            <StubPhoto stub={x} onOpen={setBig} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 4, marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{x.title}<div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--muted)" }}>{[x.date, x.venue, x.seat].filter(Boolean).join(" · ")}</div></div>
              <button type="button" className="icon-btn danger" aria-label={`Remove ${x.title} stub`} onClick={() => life.remove(x.id, `Remove the ${x.title} stub?`)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      {stubs.length > shown && <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={() => setShown(shown + 12)}>Show more</button>}
      {stubs.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>Stub photos aren&apos;t included in backups.</div>}
      {big && <div role="dialog" aria-modal="true" aria-label="Ticket" onClick={() => setBig(null)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.85)", display: "grid", placeItems: "center", padding: 16 }}><img src={big} alt="Ticket" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 10 }} /></div>}
    </div>
  );
}

function Friends() {
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  const load = () => apiGet("taste-match").then(setR).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function share() {
    try { await apiPost({ type: "movie-prefs", shareRatings: true }); await load(); } catch (e) { showToast(e.message, "⚠️"); }
  }
  if (error) return <div className="card" style={card}>{error}</div>;
  if (!r) return null;
  return (
    <div className="card" style={card}>
      <H sub="From films you've both rated. Only people who share their ratings appear.">Taste match</H>
      {!r.sharing && <><div style={{ fontSize: 13, marginBottom: 8 }}>Share your ratings with people who use this app to see how closely you agree. You can turn it off under Movies → Stats.</div><button type="button" className="btn btn-primary" onClick={share}>Share my ratings</button></>}
      {r.sharing && r.friends.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No one who shares has rated the same films yet.</div>}
      {r.friends.map((f) => (
        <div key={f.name} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b>{f.name}</b><b style={{ color: f.pct >= 70 ? "var(--success)" : "var(--warn)" }}>{f.pct}%</b></div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{f.count} film{f.count > 1 ? "s" : ""} in common{f.enough ? "" : " (a rough guess until you have 3)"}</div>
          {f.both.length > 0 && <div style={{ fontSize: 12.5 }}>You both liked {f.both.join(", ")}</div>}
          {f.clash && <div style={{ fontSize: 12.5 }}>You disagree on {f.clash.title}: you {f.clash.mine}★, {f.name} {f.clash.theirs}★</div>}
        </div>
      ))}
    </div>
  );
}

function Import({ onDone }) {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setDone("");
    if (!file) return;
    try {
      const parsed = parseMovieCsv(await file.text(), file.name);
      if (!parsed.items.length) throw new Error("No films in that file.");
      setP({ ...parsed, name: file.name });
    } catch (err) { setP(null); showToast(err.message, "⚠️"); }
  }
  async function run() {
    setBusy(true);
    let added = 0, skipped = 0;
    try {
      for (let i = 0; i < p.items.length; i += 300) {
        const r = await apiPost({ type: "movie-import", source: p.source, kind: p.kind, exactDates: p.exactDates, items: p.items.slice(i, i + 300) });
        added += r.added; skipped += r.skipped;
      }
      setDone(`Added ${added}${skipped ? `, skipped ${skipped} you already had` : ""}.`);
      setP(null);
      onDone();
    } catch (err) { showToast(`${err.message}${added ? ` (${added} were added; run it again to finish)` : ""}`, "⚠️"); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={card}>
      <H sub="Films come in as streaming, ₹0, not deducted. Safe to run again.">Import from Letterboxd or IMDb</H>
      <ul style={{ fontSize: 13, color: "var(--text-2)", paddingLeft: 18, margin: "0 0 12px" }}>
        <li><b>Letterboxd:</b> Settings → Data → Export your data. Unzip it and choose diary.csv first, then ratings.csv, watched.csv or watchlist.csv.</li>
        <li><b>IMDb:</b> open Your ratings or Watchlist on the website → Export.</li>
      </ul>
      <label className="btn btn-secondary" style={{ cursor: "pointer" }}>Choose CSV file<input type="file" accept=".csv,text/csv" onChange={pick} style={{ display: "none" }} aria-label="Movie CSV file" /></label>
      {p && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13.5 }}><b>{p.items.length}</b> films from {p.source === "imdb" ? "IMDb" : "Letterboxd"} {p.skipped ? `(${p.skipped} TV or blank rows left out)` : ""}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{p.items.slice(0, 4).map((x) => x.title).join(", ")}{p.items.length > 4 ? "…" : ""}</div>
          <div role="radiogroup" aria-label="Import as" style={{ display: "flex", gap: 6, margin: "10px 0" }}>
            {[["watched", "As watched"], ["watchlist", "To watchlist"]].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={p.kind === k} className={`chip${p.kind === k ? " active" : ""}`} onClick={() => setP({ ...p, kind: k })}>{l}</button>)}
          </div>
          {p.kind === "watched" && !p.exactDates && <div style={{ fontSize: 12, color: "var(--warn)", marginBottom: 8 }}>This file has the day you rated or added each film, not the day you watched it, so dates are approximate. Films you already have are skipped.</div>}
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={run}>{busy ? "Importing…" : `Import ${p.items.length} films`}</button>
        </div>
      )}
      {done && <div role="status" style={{ marginTop: 10, color: "var(--success)", fontSize: 13.5 }}>{done}</div>}
    </div>
  );
}

export default function MovieCorner() {
  const today = todayISO();
  const [tab, setTab] = useState("rank");
  const [movies, setMovies] = useState(null);
  const [meta, setMeta] = useState({});
  async function load() {
    try {
      const rows = (await apiGet("movies")).movies || [];
      setMovies(rows.map((r) => ({ ...mapMovie(r), tmdbId: r.tmdb_id > 0 ? r.tmdb_id : null })));
      const m = await apiGet("movie-meta");
      setMeta(m.meta || {});
      setMovies(rows.map((r) => ({ ...mapMovie(r), tmdbId: m.ids?.[r.id] || null })));
    } catch (e) { showToast(e.message, "⚠️"); setMovies((x) => x || []); }
  }
  useEffect(() => { load(); }, []);
  if (!movies) return <Loading />;
  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader back="/movies" backLabel="Movies" icon={<Clapperboard size={22} color="var(--accent-solid)" />} title="Movie corner" sub="Rank, quiz, collect and compare." />
      <div className="h-scroll" data-no-tab-swipe="1" role="tablist" aria-label="Movie corner" style={{ gap: 6, marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip${tab === k ? " active" : ""}`} style={{ flexShrink: 0 }} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "rank" && <Ranking movies={movies} today={today} />}
      {tab === "quiz" && <Quiz movies={movies} meta={meta} today={today} />}
      {tab === "stubs" && <Stubs movies={movies} today={today} />}
      {tab === "friends" && <Friends />}
      {tab === "import" && <Import onDone={load} />}
    </div>
  );
}
