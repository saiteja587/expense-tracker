"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, HandCoins } from "lucide-react";
import { showToast } from "../lib/toast";

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
const emptyForm = { personName: "", amount: "", direction: "owed_to_me", note: "", dueDate: "" };

export default function IousPage() {
  const [ious, setIous] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

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
    else showToast(nowSettled ? "Marked settled" : "Marked unsettled", nowSettled ? "✅" : "↩️");
  }

  async function remove(id) {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    const prev = ious;
    setIous(ious.filter((i) => i.id !== id));
    const res = await fetch(`/api/data?type=ious&id=${id}`, { method: "DELETE" });
    if (!res.ok) setIous(prev);
  }

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 28, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <HandCoins size={22} color="#A34A38" /> Who owes what
        </div>
        <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>Track money owed to you and money you owe others. Doesn't touch your balance.</div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <div className="panel-soft" style={{ flex: 1, borderRadius: 6, padding: "14px 16px", background: "#EAF3EF" }}>
          <div style={{ fontSize: 11, color: "#4d7a68" }}>Owed to you</div>
          <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600, color: "#2F6F5E" }}>{fmt(owedToMe)}</div>
        </div>
        <div className="panel-soft" style={{ flex: 1, borderRadius: 6, padding: "14px 16px", background: "#FAECE7" }}>
          <div style={{ fontSize: 11, color: "#a15436" }}>You owe</div>
          <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600, color: "#A34A38" }}>{fmt(iOwe)}</div>
        </div>
      </div>

      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 24 }}>
        {editingId && <div style={{ fontSize: 11, color: "#A3763F", marginBottom: 8 }}>Editing — change values below and Save, or Cancel.</div>}
        <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" placeholder="Person's name" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} style={{ width: 150 }} maxLength={80} />
          <input type="number" placeholder="Amount (₹)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ width: 110 }} />
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={{ width: 150 }}>
            <option value="owed_to_me">They owe me</option>
            <option value="i_owe">I owe them</option>
          </select>
          <input type="text" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ width: 150 }} maxLength={140} />
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={{ width: 150 }} min={todayISO()} />
          <button type="submit" disabled={submitting} className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <Plus size={13} /> {editingId ? "Save changes" : "Add"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <X size={13} /> Cancel
            </button>
          )}
        </form>
        {error && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{error}</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "#8a8477" }}>{visible.length} entr{visible.length !== 1 ? "ies" : "y"}</div>
        <label style={{ fontSize: 12, color: "#8a8477", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showSettled} onChange={(e) => setShowSettled(e.target.checked)} />
          Show settled
        </label>
      </div>

      {visible.length === 0 ? (
        <div style={{ border: "1px dashed #D9D2C2", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "#8a8477", fontSize: 14 }}>
          Nothing here yet — add who owes you, or who you owe.
        </div>
      ) : (
        <div>
          {visible.map((i) => (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #EAE5D9", opacity: i.settled ? 0.5 : 1 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, textDecoration: i.settled ? "line-through" : "none" }}>
                  {i.personName}{i.note ? ` — ${i.note}` : ""}
                </div>
                <div style={{ fontSize: 11, color: "#8a8477" }}>
                  {i.direction === "owed_to_me" ? "owes you" : "you owe"}
                  {i.dueDate && ` · due ${new Date(i.dueDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                  {i.settled && " · settled"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span className="tabnum" style={{ fontSize: 14, fontWeight: 500, color: i.direction === "owed_to_me" ? "#2F6F5E" : "#A34A38" }}>{fmt(i.amount)}</span>
                <button onClick={() => toggleSettled(i)} title={i.settled ? "Mark unsettled" : "Mark settled"} style={{ background: "none", border: "none", cursor: "pointer", color: i.settled ? "#C4BDAC" : "#2F6F5E", display: "flex" }}>
                  <Check size={15} />
                </button>
                <button onClick={() => startEdit(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Pencil size={13} /></button>
                <button onClick={() => remove(i.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
