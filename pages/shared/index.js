// Your shared spaces (#15): create one for a flatmate or partner, then send
// them the private link. They can view and add that space's expenses — and
// nothing else in your app.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Trash2, Users, ExternalLink } from "lucide-react";
import { showToast } from "../../lib/toast";

export default function SharedSpaces() {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("Me, ");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/data?type=shared-groups");
    if (res.ok) setGroups((await res.json()).groups || []);
  }
  useEffect(() => { load(); }, []);

  const linkFor = (g) => `${window.location.origin}/shared/${g.token}`;

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const list = members.split(",").map((m) => m.trim()).filter(Boolean);
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "shared-group", name, members: list }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't create");
      setName("");
      setMembers("Me, ");
      await load();
      showToast("Shared space created — send the link", "🤝");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(g) {
    try {
      await navigator.clipboard.writeText(linkFor(g));
      showToast("Link copied", "🔗");
    } catch {
      window.prompt("Copy this link", linkFor(g));
    }
  }

  async function share(g) {
    const url = linkFor(g);
    if (navigator.share) await navigator.share({ title: g.name, text: `Let's track ${g.name} together:`, url }).catch(() => {});
    else copy(g);
  }

  async function remove(g) {
    if (!window.confirm(`Delete "${g.name}" and all its entries? The link will stop working.`)) return;
    const res = await fetch(`/api/data?type=shared-group&id=${g.id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="page-container" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 120px" }}>
      <Link href="/me" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>← Me</Link>
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "6px 0 4px" }}>Shared spaces</h1>
      <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 18, lineHeight: 1.5 }}>
        Rent, groceries, a trip — track shared costs with a flatmate or partner. They open a private link; no account or PIN needed, and they only ever see that space.
      </div>

      <form onSubmit={create} className="card" style={{ padding: 16, borderRadius: 18, marginBottom: 20, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 700 }}>New shared space</div>
        <label className="field-label" htmlFor="sg-name">Name</label>
        <input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Flat 302, Goa trip" maxLength={60} />
        <label className="field-label" htmlFor="sg-members">People (comma-separated, include yourself)</label>
        <input id="sg-members" value={members} onChange={(e) => setMembers(e.target.value)} placeholder="Me, Priya" />
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}><Users size={16} /> {busy ? "Creating…" : "Create & get link"}</button>
      </form>

      {groups && groups.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14 }}>No shared spaces yet.</div>}
      {groups && groups.map((g) => (
        <div key={g.id} className="card" style={{ padding: 16, borderRadius: 18, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{g.name}</div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{g.members.join(", ")} · {g.entry_count} entr{g.entry_count === 1 ? "y" : "ies"}</div>
            </div>
            <button type="button" className="icon-btn danger" aria-label={`Delete ${g.name}`} onClick={() => remove(g)}><Trash2 size={17} /></button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Link href={`/shared/${g.token}`} className="chip" style={{ textDecoration: "none" }}><ExternalLink size={14} /> Open</Link>
            <button type="button" className="chip" onClick={() => share(g)}>📤 Send link</button>
            <button type="button" className="chip" onClick={() => copy(g)}><Copy size={14} /> Copy link</button>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>Anyone with a link can see and add to that space, so only share it with the people in it.</div>
    </div>
  );
}
