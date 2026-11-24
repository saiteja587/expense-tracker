// Watch together: watchlists shared with friends who use the app (added by
// the name they sign in with). Everyone in a list can add movies, tick
// them off and remove them; the others get a notification when you add one.
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import MovieSearchInput from "./MovieSearchInput";
import Poster from "./Poster";
import { showToast } from "../lib/toast";

async function api(method, body, query = "") {
  const res = await fetch(`/api/data${query}`, method === "GET" || method === "DELETE" ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Couldn't save");
  return d;
}

function ListCard({ list, me, onChanged, onOpen }) {
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const others = list.members.filter((m) => m.id !== me).map((m) => m.name);
  const open = list.items.filter((i) => !i.watched);
  const done = list.items.filter((i) => i.watched);

  async function add(m) {
    try {
      await api("POST", { type: "watch-list-item", listId: list.id, title: m.title, tmdbId: m.tmdbId, note: [m.language, m.year].filter(Boolean).join(" · ") });
      setQ("");
      showToast(`Added to ${list.name}`, "🍿");
      onChanged();
    } catch (e) { showToast(e.message, "⚠️"); }
  }
  async function addTyped(e) {
    e.preventDefault();
    if (q.trim()) add({ title: q.trim() });
  }
  async function toggle(i) {
    await api("PUT", { type: "watch-list-item", id: i.id, watched: !i.watched }).catch((e) => showToast(e.message, "⚠️"));
    onChanged();
  }
  async function vote(i) {
    try {
      await api("POST", { type: "watch-list-vote", id: i.id, on: !i.my_vote });
      if (!i.my_vote) showToast(`Voted for ${i.title}`, "👍");
    } catch (e) { showToast(e.message, "⚠️"); }
    onChanged();
  }
  async function remove(i) {
    await api("DELETE", null, `?type=watch-list-item&id=${i.id}`).catch(() => {});
    onChanged();
  }
  async function leave() {
    const owner = list.owner_id === me;
    if (!window.confirm(owner ? `Delete "${list.name}" for everyone?` : `Leave "${list.name}"?`)) return;
    await api("DELETE", null, `?type=watch-list&id=${list.id}`).catch(() => {});
    onChanged();
  }

  return (
    <div className="card" style={{ padding: 14, borderRadius: 18, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15.5 }}>{list.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>with {others.join(", ") || "—"}</div>
        </div>
        <button type="button" className="chip" onClick={leave} style={{ minHeight: 30, fontSize: 12 }}>{list.owner_id === me ? "Delete" : "Leave"}</button>
      </div>
      <form onSubmit={addTyped} style={{ marginTop: 10 }}>
        <MovieSearchInput id={`wt-${list.id}`} placeholder="Add a movie for everyone" value={q} onChange={setQ} onPick={add} />
      </form>
      {open.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>Nothing yet — add the first one.</div>}
      {open.length > 1 && open[0].votes > 0 && (
        <div style={{ fontSize: 12.5, marginTop: 10, color: "var(--success)", fontWeight: 600 }}>👑 Leading the vote: {open[0].title} ({open[0].votes})</div>
      )}
      {open.map((i) => (
        <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
          <button type="button" onClick={() => onOpen?.({ tmdbId: i.tmdb_id, title: i.title })} aria-label={`${i.title} details`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <Poster title={i.title} width={34} radius={6} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{i.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>added by {i.added_by === me ? "you" : i.added_by_name}{i.note ? ` · ${i.note}` : ""}</div>
            {i.votes > 0 && <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>👍 {i.voters}</div>}
          </div>
          <button type="button" className={`chip${i.my_vote ? " active" : ""}`} aria-pressed={!!i.my_vote} aria-label={`${i.my_vote ? "Remove vote for" : "Vote for"} ${i.title}`} onClick={() => vote(i)} style={{ minHeight: 32, fontSize: 12, padding: "0 10px" }}>
            👍 {i.votes || ""}
          </button>
          <button type="button" className="chip" onClick={() => toggle(i)} style={{ minHeight: 32, fontSize: 12, whiteSpace: "nowrap" }}>✓ Watched</button>
          <button type="button" className="icon-btn danger" aria-label={`Remove ${i.title}`} onClick={() => remove(i)}><Trash2 size={17} /></button>
        </div>
      ))}
      <Dates list={list} me={me} onChanged={onChanged} />
      {done.length > 0 && (
        <button type="button" onClick={() => setShowDone(!showDone)} style={{ background: "none", border: "none", padding: "8px 0 0", color: "var(--muted)", fontSize: 12.5, cursor: "pointer" }}>
          {showDone ? "Hide" : "Show"} watched ({done.length})
        </button>
      )}
      {showDone && done.map((i) => (
        <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13, color: "var(--muted)" }}>
          <span style={{ flex: 1, textDecoration: "line-through" }}>{i.title}</span>
          <button type="button" className="chip" onClick={() => toggle(i)} style={{ minHeight: 28, fontSize: 11.5 }}>Undo</button>
        </div>
      ))}
    </div>
  );
}

// Suggest days for a movie night; everyone ticks the ones that suit them.
function Dates({ list, me, onChanged }) {
  const [f, setF] = useState(null);
  const dates = list.dates || [];
  const n = list.members.length;
  async function act(fn) {
    try { await fn(); onChanged(); return true; } catch (e) { showToast(e.message, "⚠️"); return false; }
  }
  const label = (d) => new Date(d.day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) + (d.at ? ` · ${d.at}` : "");
  const all = dates.find((d) => d.votes === n && n > 1);
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>📅 Movie night</div>
        {!f && <button type="button" className="chip" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setF({ day: "", at: "" })}>Suggest a day</button>}
      </div>
      {all && <div style={{ fontSize: 12.5, color: "var(--success)", fontWeight: 600, marginTop: 4 }}>🎉 Everyone can make {label(all)}</div>}
      {f && (
        <form style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }} onSubmit={async (e) => { e.preventDefault(); if (await act(() => api("POST", { type: "watch-list-date", listId: list.id, ...f }))) setF(null); }}>
          <input type="date" aria-label="Movie night date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} style={{ flex: "1 1 130px" }} />
          <input type="time" aria-label="Movie night time" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} style={{ flex: "1 1 100px" }} />
          <button type="submit" className="btn btn-primary" disabled={!f.day}>Add</button>
          <button type="button" className="btn btn-secondary" onClick={() => setF(null)}>Cancel</button>
        </form>
      )}
      {dates.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
          <div style={{ flex: 1, fontSize: 13.5 }}>{label(d)}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{d.voters || "No votes"}</div></div>
          <button type="button" className={`chip${d.my_vote ? " active" : ""}`} aria-pressed={!!d.my_vote} aria-label={`${d.my_vote ? "I can't make" : "I can make"} ${label(d)}`} style={{ minHeight: 30, fontSize: 12 }} onClick={() => act(() => api("POST", { type: "watch-list-date-vote", id: d.id, on: !d.my_vote }))}>👍 {d.votes}/{n}</button>
          {(d.added_by === me || list.owner_id === me) && <button type="button" className="icon-btn danger" aria-label={`Remove ${label(d)}`} onClick={() => act(() => api("DELETE", null, `?type=watch-list-date&id=${d.id}`))}><Trash2 size={15} /></button>}
        </div>
      ))}
    </div>
  );
}

export default function WatchTogether({ onOpen }) {
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [friends, setFriends] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await api("GET", null, "?type=watch-lists")); } catch { /* offline */ }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", { type: "watch-list", name: name.trim(), members: friends.split(",").map((f) => f.trim()).filter(Boolean) });
      setName("");
      setFriends("");
      setCreating(false);
      showToast("Watch-together list created", "🍿");
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!data) return null;
  return (
    <section aria-label="Watch together" style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>👥 Watch together</div>
        {!creating && <button type="button" className="chip" onClick={() => setCreating(true)} style={{ minHeight: 32, fontSize: 12.5 }}>➕ New list</button>}
      </div>
      {creating && (
        <form onSubmit={create} className="card" style={{ padding: 14, borderRadius: 18, marginBottom: 12, display: "grid", gap: 8 }}>
          <label className="field-label" htmlFor="wt-name">List name</label>
          <input id="wt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekend movies with Ravi" maxLength={60} />
          <label className="field-label" htmlFor="wt-friends">Friends (the names they sign in with, comma-separated)</label>
          <input id="wt-friends" value={friends} onChange={(e) => setFriends(e.target.value)} placeholder="Ravi, Priya" autoCapitalize="words" />
          {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setCreating(false); setError(""); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={busy || !name.trim() || !friends.trim()}>{busy ? "Creating…" : "Create list"}</button>
          </div>
        </form>
      )}
      {data.lists.length === 0 && !creating && (
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Plan movies with a friend who uses this app: you both add to one list, vote on what to watch next, and each of you gets a ping when the other adds or votes.
        </div>
      )}
      {data.lists.map((l) => <ListCard key={l.id} list={l} me={data.me} onChanged={load} onOpen={onOpen} />)}
    </section>
  );
}
