"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, HandCoins, MessageCircle } from "lucide-react";

// A friendly, ready-to-send WhatsApp message for an IOU.
function whatsappText(i) {
  const amount = "₹" + Math.round(i.amount).toLocaleString("en-IN");
  const what = i.note ? ` for ${i.note}` : "";
  const due = i.dueDate ? ` (due ${new Date(i.dueDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })})` : "";
  return i.direction === "owed_to_me"
    ? `Hey ${i.personName}! Quick reminder about the ${amount}${what}${due} 🙂 No rush — UPI whenever you get a moment. Thanks!`
    : `Hey ${i.personName}! I owe you ${amount}${what}${due} — sending it soon. Thanks for covering! 🙏`;
}
import { showToast } from "../lib/toast";
import { fmt, todayISO, nowHHMM } from "../lib/format";
import { notifyLedgerChanged } from "../lib/useLedger";
import { newRequestId } from "../lib/offlineQueue";

const emptyForm = { personName: "", amount: "", direction: "owed_to_me", note: "", dueDate: "" };

export default function IousPage() {
  const [ious, setIous] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  // After settling: offer to move the money in/out of your balance.
  const [settlePrompt, setSettlePrompt] = useState(null);
  const [promptBusy, setPromptBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/data?type=ious");
      if (res.ok) {
        const data = await res.json();
        setIous(
          (data.ious || []).map((i) => ({
            id: i.id,
            personName: i.person_name,
            amount: parseFloat(i.amount),
            direction: i.direction,
            note: i.note || "",
            dueDate: i.due_date ? i.due_date.slice(0, 10) : "",
            settled: !!i.settled,
          }))
        );
      }
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const { owedToMe, iOwe, visible } = useMemo(() => {
    const open = ious.filter((i) => !i.settled);
    const owedToMe = open.filter((i) => i.direction === "owed_to_me").reduce((s, i) => s + i.amount, 0);
    const iOwe = open.filter((i) => i.direction === "i_owe").reduce((s, i) => s + i.amount, 0);
    const visible = (showSettled ? ious : open).sort((a, b) => {
      if (a.settled !== b.settled) return a.settled ? 1 : -1;
      if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.id - a.id;
    });
    return { owedToMe, iOwe, visible };
  }, [ious, showSettled]);

  function startEdit(i) {
    setEditingId(i.id);
    setForm({ personName: i.personName, amount: String(i.amount), direction: i.direction, note: i.note, dueDate: i.dueDate });
    setError("");
  }
  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.personName.trim()) return setError("Enter who's involved");
    if (!amount || amount <= 0) return setError("Enter an amount greater than 0");
    setError("");
    setSubmitting(true);
    const isEdit = editingId !== null;
    try {
      const res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ious",
          ...(isEdit ? { id: editingId, settled: ious.find((i) => i.id === editingId)?.settled } : {}),
          personName: form.personName.trim(),
          amount,
          direction: form.direction,
          note: form.note.trim(),
          dueDate: form.dueDate || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't save. Try again.");
        return;
      }
      setForm(emptyForm);
      setEditingId(null);
      await load();
      showToast(isEdit ? "Entry updated" : "Entry added", "🤝");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleSettled(i) {
    const prev = ious;
    const nowSettled = !i.settled;
    setIous(ious.map((x) => (x.id === i.id ? { ...x, settled: nowSettled } : x)));
    const res = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "ious",
        id: i.id,
        personName: i.personName,
        amount: i.amount,
        direction: i.direction,
        note: i.note,
        dueDate: i.dueDate || null,
        settled: nowSettled,
      }),
    });
    if (!res.ok) setIous(prev);
    else {
      showToast(nowSettled ? "Marked settled" : "Marked unsettled", nowSettled ? "✅" : "↩️");
      setSettlePrompt(nowSettled ? i : null);
    }
  }

  async function applySettlement(i) {
    setPromptBusy(true);
    const body = i.direction === "owed_to_me"
      ? { type: "balance", amount: i.amount, note: `${i.personName} paid back${i.note ? ` — ${i.note}` : ""}`, date: todayISO(), mode: "add" }
      : { type: "expenses", amount: i.amount, category: "Other", note: `Paid back ${i.personName}${i.note ? ` — ${i.note}` : ""}`, date: todayISO(), time: nowHHMM(), affectsBalance: true, clientRequestId: newRequestId() };
    try {
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      notifyLedgerChanged();
      showToast(i.direction === "owed_to_me" ? `${fmt(i.amount)} added to your balance` : `${fmt(i.amount)} logged as spent`, "💰");
      setSettlePrompt(null);
    } catch {
      showToast("Couldn't update your balance — try again", "⚠️");
    } finally {
      setPromptBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    const prev = ious;
    setIous(ious.filter((i) => i.id !== id));
    const res = await fetch(`/api/data?type=ious&id=${id}`, { method: "DELETE" });
    if (!res.ok) setIous(prev);
  }

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 28, borderBottom: "1px solid var(--line-strong)", paddingBottom: 20 }}>
        <Link href="/me" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={13} /> Me
        </Link>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <HandCoins size={22} color="var(--danger)" /> <span className="gradient-title">Who owes what</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>Track money owed to you and money you owe others. When one is settled, you can add the money to (or take it from) your balance in one tap.</div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <div className="panel-soft" style={{ flex: 1, borderRadius: 6, padding: "14px 16px", background: "var(--success-bg)" }}>
          <div style={{ fontSize: 12, color: "#4d7a68" }}>Owed to you</div>
          <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600, color: "var(--success)" }}>{fmt(owedToMe)}</div>
        </div>
        <div className="panel-soft" style={{ flex: 1, borderRadius: 6, padding: "14px 16px", background: "var(--danger-bg)" }}>
          <div style={{ fontSize: 12, color: "#a15436" }}>You owe</div>
          <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600, color: "var(--danger)" }}>{fmt(iOwe)}</div>
        </div>
      </div>

      <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 18px", marginBottom: 24 }}>
        {editingId && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 8 }}>Editing — change values below and Save, or Cancel.</div>}
        <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" placeholder="Person's name" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} style={{ width: 150 }} maxLength={80} />
          <input type="number" placeholder="Amount (₹)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ width: 110 }} />
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={{ width: 150 }}>
            <option value="owed_to_me">They owe me</option>
            <option value="i_owe">I owe them</option>
          </select>
          <input type="text" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ width: 150 }} maxLength={140} />
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: "var(--muted)" }}>
            Due date (optional)
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={{ width: 160 }} min={todayISO()} />
          </label>
          <button type="submit" disabled={submitting} className="pill" style={{ background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <Plus size={13} /> {editingId ? "Save changes" : "Add"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} style={{ background: "var(--line)", color: "var(--ink)", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <X size={13} /> Cancel
            </button>
          )}
        </form>
        {error && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{error}</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{visible.length} entr{visible.length !== 1 ? "ies" : "y"}</div>
        <label style={{ fontSize: 13, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} style={{ width: 18, height: 18, margin: 0 }} />
          Show settled
        </label>
      </div>

      {settlePrompt && (
        <div className="card" role="status" style={{ padding: "14px 16px", borderRadius: 16, marginBottom: 14, border: "1px solid var(--line-strong)" }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>
            {settlePrompt.direction === "owed_to_me"
              ? `${settlePrompt.personName} paid you ${fmt(settlePrompt.amount)} — add it back to your balance?`
              : `You paid ${settlePrompt.personName} ${fmt(settlePrompt.amount)} — take it from your balance?`}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
            {settlePrompt.direction === "owed_to_me" ? "Your daily budget goes up to match." : "It's logged as an expense today."}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-primary" style={{ flex: 1, minHeight: 40, fontSize: 13.5 }} disabled={promptBusy} onClick={() => applySettlement(settlePrompt)}>
              {settlePrompt.direction === "owed_to_me" ? `Add ${fmt(settlePrompt.amount)}` : `Log ${fmt(settlePrompt.amount)}`}
            </button>
            <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 40, fontSize: 13.5 }} onClick={() => setSettlePrompt(null)}>No thanks</button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div style={{ border: "1px dashed var(--line-strong)", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
          Nothing here yet — add who owes you, or who you owe.
        </div>
      ) : (
        <div>
          {visible.map((i) => (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)", opacity: i.settled ? 0.5 : 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, textDecoration: i.settled ? "line-through" : "none" }}>
                  {i.personName}{i.note ? ` — ${i.note}` : ""}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {i.direction === "owed_to_me" ? "owes you" : "you owe"}
                  {i.dueDate && ` · due ${new Date(i.dueDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                  {i.settled && " · settled"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <span className="tabnum" style={{ fontSize: 15, fontWeight: 600, color: i.direction === "owed_to_me" ? "var(--success)" : "var(--danger)", marginRight: 4 }}>{fmt(i.amount)}</span>
                {!i.settled && (
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(whatsappText(i))}`}
                    target="_blank" rel="noopener noreferrer"
                    className="icon-btn" aria-label={`Send ${i.personName} a WhatsApp reminder`} title="Remind on WhatsApp"
                    style={{ color: "#1FA855" }}
                  >
                    <MessageCircle size={18} />
                  </a>
                )}
                <button onClick={() => toggleSettled(i)} className="icon-btn" aria-label={i.settled ? "Mark unsettled" : "Mark settled"} title={i.settled ? "Mark unsettled" : "Mark settled"} style={{ color: i.settled ? "var(--muted)" : "var(--success)" }}>
                  <Check size={18} />
                </button>
                <button onClick={() => startEdit(i)} className="icon-btn" aria-label="Edit"><Pencil size={17} /></button>
                <button onClick={() => remove(i.id)} className="icon-btn danger" aria-label="Delete"><Trash2 size={17} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
