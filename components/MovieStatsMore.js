// Stats tab: on this day, watch heatmap, people you watch and rate, rewatches,
// snacks vs tickets, and whether a theatre pass would pay off.
import { useMemo, useState } from "react";
import { heatmap, peopleStats, rewatches, onThisDay, snackStats, passValue } from "../lib/movieLab";
import { useLife } from "../lib/useLife";
import { fmt } from "../lib/format";
import { showToast } from "../lib/toast";

const card = { padding: "16px 18px", borderRadius: 18, marginBottom: 20 };
const Title = ({ children }) => <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{children}</div>;
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });
const niceDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function OnThisDay({ movies, today }) {
  const past = onThisDay(movies, today);
  if (!past.length) return null;
  return (
    <section aria-label="On this day" className="card" style={card}>
      <Title>🕰️ On this day</Title>
      {past.slice(0, 4).map((m) => (
        <div key={m.id} style={{ fontSize: 13.5, padding: "3px 0" }}><b>{m.title}</b> · {m.yearsAgo} year{m.yearsAgo > 1 ? "s" : ""} ago{m.venueName ? ` at ${m.venueName}` : ""}{m.companions ? ` with ${m.companions}` : ""}</div>
      ))}
    </section>
  );
}

function Heatmap({ movies, today }) {
  const years = useMemo(() => [...new Set([today.slice(0, 4), ...movies.map((m) => m.date.slice(0, 4)).filter((y) => y <= today.slice(0, 4))])].sort().reverse(), [movies, today]);
  const [year, setYear] = useState(today.slice(0, 4));
  const h = useMemo(() => heatmap(movies, year, today), [movies, year, today]);
  const shade = (c) => (c.n === 0 ? "var(--line)" : c.n === 1 ? "color-mix(in srgb, var(--accent-solid) 60%, var(--surface))" : "var(--accent-solid)");
  return (
    <section aria-label="Watch heatmap" className="card" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>🗓️ When you watch</div>
        <select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: "auto", padding: "4px 8px" }}>{years.map((y) => <option key={y}>{y}</option>)}</select>
      </div>
      <div className="h-scroll" data-no-tab-swipe="1" style={{ gap: 2 }} role="img" aria-label={`${h.total} watch entries in ${year}`}>
        {h.weeks.map((w, i) => (
          <div key={i} style={{ display: "grid", gap: 2, flexShrink: 0 }}>
            {w.map((c, j) => <span key={j} title={c && c.n ? `${niceDate(c.date)}: ${c.n}` : undefined} style={{ width: 10, height: 10, borderRadius: 2, background: c ? shade(c) : "transparent", opacity: c?.future ? 0.35 : 1 }} />)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>
        {h.total === 0 ? "Nothing logged that year." : <>{h.total} in {year}{h.topDay ? ` · mostly on ${h.topDay}` : ""}{h.topMonth ? ` · busiest month ${monthName(h.topMonth.ym)} (${h.topMonth.n})` : ""}</>}
      </div>
    </section>
  );
}

function People({ movies, meta, today }) {
  const p = useMemo(() => peopleStats(movies, meta || {}, today), [movies, meta, today]);
  const [by, setBy] = useState("most");
  if (!p.actors.most.length && !p.directors.most.length) return null;
  const list = (label, rows) => (
    <div style={{ flex: "1 1 200px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Rate two of their films first.</div>}
      {rows.map((x) => <div key={x.name} title={x.films.join(", ")} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "3px 0" }}><span>{x.name}</span><span style={{ color: "var(--text-2)" }}>{by === "best" ? `${x.avg}★ · ${x.rated}` : `${x.count} films${x.avg ? ` · ${x.avg}★` : ""}`}</span></div>)}
    </div>
  );
  return (
    <section aria-label="People you watch" className="card" style={card}>
      <Title>🎭 People you watch</Title>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[["most", "Most watched"], ["best", "Rated highest"]].map(([k, l]) => <button key={k} type="button" className={`chip${by === k ? " active" : ""}`} style={{ minHeight: 30, fontSize: 12.5 }} onClick={() => setBy(k)}>{l}</button>)}
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>{list("Directors", p.directors[by])}{list("Actors", p.actors[by])}</div>
    </section>
  );
}

function Rewatches({ movies, today }) {
  const r = useMemo(() => rewatches(movies, today), [movies, today]);
  if (!r.length) return null;
  return (
    <section aria-label="Rewatches" className="card" style={card}>
      <Title>🔁 Rewatched</Title>
      {r.slice(0, 6).map((x) => <div key={x.title} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, padding: "3px 0" }}><span>{x.title}</span><span style={{ color: "var(--muted)" }}>{x.times}× · last {niceDate(x.dates[x.dates.length - 1])}</span></div>)}
    </section>
  );
}

function Snacks({ movies, today }) {
  const s = useMemo(() => snackStats(movies, today), [movies, today]);
  if (!s || !s.snacks) return null;
  const max = Math.max(...s.months.map((m) => m.tickets + m.snacks), 1);
  return (
    <section aria-label="Snacks vs tickets" className="card" style={card}>
      <Title>🍿 Snacks vs tickets</Title>
      <div style={{ fontSize: 13.5 }}>Snacks are <b>{s.pct}%</b> of your theatre spend: {fmt(s.snacks)} on snacks, {fmt(s.tickets)} on tickets.{s.yearSnacks > 0 && <> {fmt(s.yearSnacks)} of snacks in the last year.</>}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 84, marginTop: 12 }}>
        {s.months.map((m) => (
          <div key={m.ym} title={`${fmt(m.tickets)} tickets, ${fmt(m.snacks)} snacks`} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: (m.snacks / max) * 60, background: "#C98A00", borderRadius: "4px 4px 0 0" }} />
            <div style={{ height: (m.tickets / max) * 60, background: "#3F6E5B" }} />
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{monthName(m.ym)}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}><span style={{ color: "#C98A00" }}>■</span> snacks <span style={{ color: "#3F6E5B" }}>■</span> tickets</div>
      {s.theatres.length > 0 && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>Per visit: {s.theatres.map((t) => `${t.name} ${fmt(t.perVisit)}`).join(" · ")}</div>}
    </section>
  );
}

function Pass({ movies, today }) {
  const life = useLife(["movie_pass"]);
  const [f, setF] = useState(null);
  if (!life.loaded) return null;
  const passes = life.of("movie_pass");
  async function save(e) {
    e.preventDefault();
    try { await life.save({ kind: "movie_pass", data: f }); setF(null); } catch (err) { showToast(err.message, "⚠️"); }
  }
  return (
    <section aria-label="Theatre pass" className="card" style={card}>
      <Title>🎫 Would a theatre pass pay off?</Title>
      {passes.map((p) => {
        const v = passValue({ movies, pass: p, todayIso: today });
        return (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
            <div style={{ fontSize: 13.5 }}>
              <b>{p.name}</b> · {fmt(p.price)} a month for {p.tickets} ticket{p.tickets > 1 ? "s" : ""}{p.weekdaysOnly ? ", Mon–Thu" : ""}
              {v && v.visits > 0 ? (
                <div style={{ color: v.worth ? "var(--success)" : "var(--warn)", fontSize: 13 }}>
                  {v.worth ? `Worth it: ${fmt(v.saving)} saved over the last 6 months.` : `Not worth it: ${fmt(-v.saving)} more than you paid over 6 months.`} You go {v.perMonth} times a month; it pays off from {v.breakEven}.
                </div>
              ) : <div style={{ color: "var(--muted)", fontSize: 12.5 }}>No theatre visits it would cover in the last 6 months.</div>}
            </div>
            <button type="button" className="chip" style={{ minHeight: 28, fontSize: 11.5 }} onClick={() => life.remove(p.id, `Remove ${p.name}?`)}>Remove</button>
          </div>
        );
      })}
      {f ? (
        <form onSubmit={save} style={{ display: "grid", gap: 8, marginTop: 6 }}>
          <input aria-label="Pass name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Pass name" />
          <div style={{ display: "flex", gap: 8 }}>
            <input aria-label="Price a month" type="number" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="₹ a month" />
            <input aria-label="Tickets a month" type="number" inputMode="numeric" value={f.tickets} onChange={(e) => setF({ ...f, tickets: e.target.value })} placeholder="Tickets a month" />
          </div>
          <label style={{ display: "flex", gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.weekdaysOnly} onChange={(e) => setF({ ...f, weekdaysOnly: e.target.checked })} style={{ width: "auto" }} /> Monday to Thursday only</label>
          <button type="submit" className="btn btn-primary" disabled={!f.name.trim() || !(f.price > 0) || !(f.tickets > 0)}>Check it</button>
        </form>
      ) : <button type="button" className="chip" onClick={() => setF({ name: "", price: "", tickets: "", weekdaysOnly: false })}>Compare a pass</button>}
    </section>
  );
}

export default function MovieStatsMore({ movies, meta, today }) {
  return (
    <>
      <OnThisDay movies={movies} today={today} />
      <Heatmap movies={movies} today={today} />
      <People movies={movies} meta={meta} today={today} />
      <Rewatches movies={movies} today={today} />
      <Snacks movies={movies} today={today} />
      <Pass movies={movies} today={today} />
    </>
  );
}
