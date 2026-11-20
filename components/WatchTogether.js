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
