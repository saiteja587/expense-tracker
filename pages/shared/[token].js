// A shared space, opened from its private link (#15). No PIN: the token in
// the URL is the key, and it only reaches this space via /api/shared.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { Trash2 } from "lucide-react";
import { balances, settleUp } from "../../lib/settle";
import { fmt, todayISO } from "../../lib/format";

export default function SharedSpace() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";
  const [state, setState] = useState({ loading: true });
  const [form, setForm] = useState({ payer: "", amount: "", note: "", splitWith: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/api/shared?token=${encodeURIComponent(token)}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setState({ loading: false, error: d.error || "Couldn't open this space" });
    else setState({ loading: false, ...d });
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const members = state.group?.members || [];
  const net = useMemo(() => balances(members, state.entries || []), [members, state.entries]);
  const transfers = useMemo(() => settleUp(net), [net]);
  const total = (state.entries || []).reduce((s, e) => s + e.amount, 0);
  const splitWith = form.splitWith || members;

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/shared", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, payer: form.payer || members[0], amount: form.amount, note: form.note, date: todayISO(), splitWith }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save");
      setForm({ payer: form.payer, amount: "", note: "", splitWith: null });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this entry?")) return;
    await fetch(`/api/shared?token=${encodeURIComponent(token)}&id=${id}`, { method: "DELETE" });
    load();
  }

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div>;
  if (state.error) return <div style={{ padding: 40, textAlign: "center" }}><div style={{ fontSize: 40 }}>🔗</div><p>{state.error}</p></div>;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 60px" }}>
      <Head><title>{state.group.name} · Shared</title></Head>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>Shared space · Expense Ledger</div>
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "4px 0 2px" }}>{state.group.name}</h1>
      <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 18 }}>{members.join(" · ")} · {fmt(total)} spent together</div>

      <div className="card" style={{ padding: 16, borderRadius: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Settle up</div>
        {transfers.length === 0 ? (
          <div style={{ color: "var(--success)", fontSize: 14 }}>✅ All square — nobody owes anything.</div>
        ) : transfers.map((t, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 15 }}>
            <span><b>{t.from}</b> pays <b>{t.to}</b></span>
            <span className="tabnum" style={{ fontWeight: 700 }}>{fmt(t.amount)}</span>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="card" style={{ padding: 16, borderRadius: 18, marginBottom: 16, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 700 }}>Add an expense</div>
        <div style={{ display: "flex", gap: 8 }}>
          <select aria-label="Who paid" value={form.payer || members[0]} onChange={(e) => setForm({ ...form, payer: e.target.value })} style={{ flex: 1 }}>
            {members.map((m) => <option key={m} value={m}>{m} paid</option>)}
          </select>
          <input aria-label="Amount" type="number" inputMode="decimal" placeholder="₹ amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ flex: 1 }} />
        </div>
        <input aria-label="What for" placeholder="What for? e.g. Groceries" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={120} />
        <div>
          <div className="field-label">Split between</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {members.map((m) => {
              const on = splitWith.includes(m);
              return (
                <button key={m} type="button" className={`chip${on ? " active" : ""}`} aria-pressed={on}
                  onClick={() => setForm({ ...form, splitWith: on ? splitWith.filter((x) => x !== m) : [...splitWith, m] })}>
                  {on ? "✓ " : ""}{m}
                </button>
              );
            })}
          </div>
        </div>
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Adding…" : "Add"}</button>
      </form>

      <div style={{ fontWeight: 700, margin: "4px 0 8px" }}>History</div>
      {(state.entries || []).length === 0 && <div style={{ color: "var(--muted)", fontSize: 14 }}>Nothing yet — add the first shared expense above.</div>}
      {(state.entries || []).map((e) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 500 }}>{e.note || "Shared expense"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {e.payer} paid · split {e.splitWith.length} way{e.splitWith.length !== 1 ? "s" : ""} · {new Date(e.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </div>
          </div>
          <div className="tabnum" style={{ fontWeight: 600 }}>{fmt(e.amount)}</div>
          <button type="button" className="icon-btn danger" aria-label="Delete entry" onClick={() => remove(e.id)}><Trash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
}
