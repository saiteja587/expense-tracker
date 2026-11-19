// Settings → "You & people": your name, signing out, and (for the app's
// owner) inviting friends. Each person who joins gets their own separate
// ledger; nobody can see anyone else's data.
import { useEffect, useState } from "react";
import { showToast } from "../lib/toast";
import { clearSession } from "../lib/unlockSession";
import { getAccount, rememberAccount } from "../lib/account";

async function api(method, body, query = "") {
  const res = await fetch(`/api/data${query}`, method === "GET" || method === "DELETE" ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Something went wrong");
  return d;
}

export default function PeopleSection() {
  const [me, setMe] = useState(null);
  const [multiUser, setMultiUser] = useState(false);
  const [name, setName] = useState("");
  const [invites, setInvites] = useState([]);
  const [people, setPeople] = useState([]);
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const s = await api("GET", null, "?type=session");
      setMe(s.user);
      setMultiUser(!!s.multiUser);
      setName(s.user?.name || "");
      if (s.user?.isOwner) {
        const d = await api("GET", null, "?type=invites");
        setInvites(d.invites || []);
        setPeople(d.people || []);
      }
    } catch { /* offline */ }
  }
  useEffect(() => { load(); }, []);

  const linkFor = (code) => `${window.location.origin}/join?code=${code}`;
  const message = (code) => `Join me on Expense Ledger — your own private money, movies & no-sugar tracker 🙂\n\nOpen: ${linkFor(code)}\nInvite code: ${code} (valid 7 days)\n\nOn iPhone: open it in Safari, then Share → Add to Home Screen.`;

  async function saveName(e) {
    e.preventDefault();
    setError("");
    try {
      const d = await api("POST", { type: "rename", name });
      rememberAccount({ ...(getAccount() || {}), ...me, name: d.user.name });
      setMe({ ...me, name: d.user.name });
      showToast("Name saved", "✅");
    } catch (err) { setError(err.message); }
  }

  async function invite() {
    setBusy(true);
    setError("");
    try {
      const d = await api("POST", { type: "invite" });
      setFresh(d.invite.code);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function share(code) {
    const text = message(code);
    if (navigator.share) {
      try { await navigator.share({ title: "Join Expense Ledger", text }); return; } catch { /* cancelled */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }
  async function copy(code) {
    try { await navigator.clipboard.writeText(message(code)); showToast("Invite copied", "🔗"); } catch { window.prompt("Copy this invite", message(code)); }
  }
  async function cancel(code) {
    await api("DELETE", null, `?type=invite&code=${code}`).catch(() => {});
    if (fresh === code) setFresh(null);
    load();
  }

  async function signOut() {
    await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "logout" }) }).catch(() => {});
    clearSession();
    window.location.replace("/");
  }

  if (!me) return null;
  const pending = invites.filter((i) => !i.used_at && new Date(i.expires_at) > new Date());

  return (
    <details className="settings-group" id="people" open={multiUser || undefined}>
      <summary>👥 You &amp; people</summary>
      <div className="settings-body">
        <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 18px" }}>
          <form onSubmit={saveName} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px" }}>
              <label className="field-label" htmlFor="me-name">Your name {multiUser ? "(you type this to sign in)" : ""}</label>
              <input id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={!name.trim() || name.trim() === me.name} style={{ minHeight: 42 }}>Save</button>
          </form>
          {(multiUser || me.hasPin) && (
            <button type="button" className="btn btn-secondary btn-block" onClick={signOut} style={{ marginTop: 12 }}>Sign out of this phone</button>
          )}
        </div>

        {me.isOwner && (
          <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 18px", marginTop: 14 }}>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Invite a friend</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 12px", lineHeight: 1.45 }}>
              They get their own private ledger in this same app — on Android or iPhone. Each code works once, for 7 days.
            </div>
            {!me.hasPin && <div style={{ fontSize: 12.5, color: "var(--amber)", marginBottom: 10 }}>First set a PIN for yourself under Security — once two people use the app, everyone signs in with name + PIN.</div>}
            {fresh ? (
              <div style={{ background: "var(--surface-2)", borderRadius: 14, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Invite code</div>
                <div className="tabnum" style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, margin: "2px 0 10px" }}>{fresh}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => share(fresh)}>📤 Send</button>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => copy(fresh)}>Copy</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-block" disabled={busy || !me.hasPin} onClick={invite}>{busy ? "Creating…" : "➕ Create an invite"}</button>
            )}
            {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{error}</div>}

            {people.length > 1 && (
              <div style={{ marginTop: 14 }}>
                <div className="field-label">People using the app</div>
                {people.map((p) => (
                  <div key={p.id} style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                    {p.name}{p.isOwner ? " · owner" : ""}{p.id === me.id ? " (you)" : ""}
                  </div>
                ))}
              </div>
            )}
            {pending.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="field-label">Waiting to be used</div>
                {pending.map((i) => (
                  <div key={i.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                    <span className="tabnum" style={{ fontWeight: 700, letterSpacing: 1, flex: 1 }}>{i.code}</span>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>until {new Date(i.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    <button type="button" className="chip" onClick={() => share(i.code)}>Send</button>
                    <button type="button" className="chip" onClick={() => cancel(i.code)}>Cancel</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
