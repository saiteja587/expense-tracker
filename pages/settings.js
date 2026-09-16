"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Trash2, Check, Moon, Sun, Lock, Download, Upload, Pencil, X } from "lucide-react";

const BASE_CATEGORY_COLORS = ["#B5533C", "#C98A2C", "#3F6E5B", "#5B3A5C", "#2F4858", "#A3763F", "#6B7A3E", "#8A4B6B", "#6B6558"];

export default function SettingsPage() {
  const [categories, setCategories] = useState([]);
  const [newCat, setNewCat] = useState("");
  const [theatres, setTheatres] = useState([]);
  const [newTheatre, setNewTheatre] = useState("");
  const [ottPlatforms, setOttPlatforms] = useState([]);
  const [newOtt, setNewOtt] = useState("");
  const [recurring, setRecurring] = useState([]);
  const [recForm, setRecForm] = useState({ amount: "", category: "Bills", note: "", dayOfMonth: "1" });
  const [recError, setRecError] = useState("");
  const [editingRecId, setEditingRecId] = useState(null);

  const [hasPin, setHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSaving, setPinSaving] = useState(false);

  const [darkMode, setDarkMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const [catRes, recRes, pinRes, theatreRes, ottRes] = await Promise.all([
        fetch("/api/data?type=categories"),
        fetch("/api/data?type=recurring"),
        fetch("/api/data?type=pin-status"),
        fetch("/api/data?type=theatres"),
        fetch("/api/data?type=ott-platforms"),
      ]);
      if (catRes.ok) setCategories((await catRes.json()).categories || []);
      if (recRes.ok) setRecurring((await recRes.json()).recurring || []);
      if (pinRes.ok) setHasPin((await pinRes.json()).hasPin);
      if (theatreRes.ok) setTheatres((await theatreRes.json()).theatres || []);
      if (ottRes.ok) setOttPlatforms((await ottRes.json()).ottPlatforms || []);
    } catch (e) {
      // best-effort
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    setDarkMode(localStorage.getItem("darkMode") === "1");
  }, []);

  function toggleDarkMode() {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("darkMode", next ? "1" : "0");
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
  }

  async function addCategory(e) {
    e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    const color = BASE_CATEGORY_COLORS[categories.length % BASE_CATEGORY_COLORS.length];
    const next = [...categories, { name, color }];
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "categories", categories: next }),
    });
    if (res.ok) {
      setCategories(next);
      setNewCat("");
    }
  }

  async function removeCategory(name) {
    if (!window.confirm("Remove this category? Past entries keep it, but you won't be able to pick it again.")) return;
    const next = categories.filter((c) => c.name !== name);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "categories", categories: next }),
    });
    if (res.ok) setCategories(next);
  }

  async function addTheatre(e) {
    e.preventDefault();
    const name = newTheatre.trim();
    if (!name || theatres.includes(name)) return;
    const next = [...theatres, name];
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "theatres", theatres: next }),
    });
    if (res.ok) { setTheatres(next); setNewTheatre(""); }
  }

  async function removeTheatre(name) {
    const next = theatres.filter((t) => t !== name);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "theatres", theatres: next }),
    });
    if (res.ok) setTheatres(next);
  }

  async function addOtt(e) {
    e.preventDefault();
    const name = newOtt.trim();
    if (!name || ottPlatforms.includes(name)) return;
    const next = [...ottPlatforms, name];
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ott-platforms", ottPlatforms: next }),
    });
    if (res.ok) { setOttPlatforms(next); setNewOtt(""); }
  }

  async function removeOtt(name) {
    const next = ottPlatforms.filter((o) => o !== name);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ott-platforms", ottPlatforms: next }),
    });
    if (res.ok) setOttPlatforms(next);
  }

  async function addRecurring(e) {
    e.preventDefault();
    const amount = parseFloat(recForm.amount);
    const dayOfMonth = parseInt(recForm.dayOfMonth, 10);
    if (!amount || amount <= 0) { setRecError("Enter an amount greater than 0"); return; }
    if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 28) { setRecError("Day must be between 1 and 28"); return; }
    setRecError("");
    const isEdit = editingRecId !== null;
    const res = await fetch("/api/data", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recurring", ...(isEdit ? { id: editingRecId } : {}), amount, category: recForm.category, note: recForm.note, dayOfMonth, affectsBalance: true }),
    });
    if (res.ok) {
      setRecForm({ amount: "", category: "Bills", note: "", dayOfMonth: "1" });
      setEditingRecId(null);
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setRecError(d.error || "Couldn't save. Try again.");
    }
  }

  function startEditRecurring(r) {
    setEditingRecId(r.id);
    setRecForm({ amount: String(r.amount), category: r.category, note: r.note || "", dayOfMonth: String(r.day_of_month) });
    setRecError("");
  }

  function cancelEditRecurring() {
    setEditingRecId(null);
    setRecForm({ amount: "", category: "Bills", note: "", dayOfMonth: "1" });
    setRecError("");
  }

  async function removeRecurring(id) {
    if (!window.confirm("Delete this recurring expense? This can't be undone.")) return;
    const prev = recurring;
    setRecurring(recurring.filter((r) => r.id !== id));
    const res = await fetch(`/api/data?type=recurring&id=${id}`, { method: "DELETE" });
    if (!res.ok) setRecurring(prev);
  }

  async function savePin(e) {
    e.preventDefault();
    if (pinInput && !/^\d{4,8}$/.test(pinInput)) { setPinError("PIN must be 4-8 digits"); return; }
    setPinError("");
    setPinSaving(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set-pin", pin: pinInput }),
      });
      if (!res.ok) throw new Error();
      setHasPin(!!pinInput);
      setPinInput("");
      sessionStorage.setItem("unlocked", "1");
    } catch {
      setPinError("Couldn't save. Try again.");
    } finally {
      setPinSaving(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/data?type=export-all");
      if (!res.ok) throw new Error();
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expense-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Couldn't export your data. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!window.confirm("Import will ADD every record from this file to your current data — it does not replace anything. If you already have data, this can create duplicates. Best used to restore into a fresh, empty setup. Continue?")) return;
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-all", data }),
      });
      if (!res.ok) throw new Error("Import failed");
      const result = await res.json();
      setImportResult(result.results);
      await load();
    } catch (err) {
      setImportError("Couldn't import that file — make sure it's an export from this app.");
    } finally {
      setImporting(false);
    }
  }

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 32, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600 }}>Settings</div>
      </div>

      {/* Data backup */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Back up your data</div>
          <div style={{ fontSize: 11, color: "#8a8477" }}>Downloads everything — expenses, movies, balance, budget rules, challenge history — as one file.</div>
        </div>
        <button onClick={exportData} disabled={exporting} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12, cursor: exporting ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <Download size={13} /> {exporting ? "Exporting…" : "Export"}
        </button>
      </div>

      {/* Data restore */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Restore from a backup</div>
            <div style={{ fontSize: 11, color: "#8a8477" }}>Adds every record from an exported .json file back into this database. Meant for restoring into a fresh setup, not merging with existing data.</div>
          </div>
          <label style={{ background: importing ? "#EAE5D9" : "#241F1A", color: importing ? "#241F1A" : "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12, cursor: importing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <Upload size={13} /> {importing ? "Importing…" : "Import"}
            <input type="file" accept="application/json" onChange={handleImportFile} disabled={importing} style={{ display: "none" }} />
          </label>
        </div>
        {importResult && (
          <div style={{ fontSize: 12, color: "#2F6F5E", marginTop: 10 }}>
            Restored: {importResult.expenses} expenses, {importResult.movies} movies, {importResult.topups} top-ups, {importResult.budgetRules} rules, {importResult.recurring} recurring, {importResult.challengeDays} challenge days.
          </div>
        )}
        {importError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 10 }}>{importError}</div>}
      </div>

      {/* Dark mode */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {darkMode ? <Moon size={16} /> : <Sun size={16} />}
          <div>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Dark mode</div>
            <div style={{ fontSize: 11, color: "#8a8477" }}>Applied as a color filter, not a full redesign — simple, reversible.</div>
          </div>
        </div>
        <button onClick={toggleDarkMode} style={{ background: darkMode ? "#241F1A" : "#EAE5D9", color: darkMode ? "#FBF8F2" : "#241F1A", border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}>
          {darkMode ? "On" : "Off"}
        </button>
      </div>

      {/* PIN lock */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Lock size={16} />
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>App lock</div>
        </div>
        <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 10 }}>
          {hasPin ? "A PIN is set. Change it below, or clear the field and save to remove it." : "No PIN set — anyone who opens this can see everything. Set one below."}
        </div>
        <form onSubmit={savePin} style={{ display: "flex", gap: 8 }}>
          <input type="password" inputMode="numeric" placeholder={hasPin ? "New PIN (blank to remove)" : "4-8 digit PIN"} value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))} maxLength={8} style={{ width: 180 }} />
          <button type="submit" disabled={pinSaving} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>{pinSaving ? "Saving…" : "Save"}</button>
        </form>
        {pinError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{pinError}</div>}
      </div>

      {/* Custom categories */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Custom categories</div>
        {categories.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {categories.map((c) => (
              <span key={c.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 20, background: c.color + "1A", color: c.color, fontWeight: 500 }}>
                {c.name}
                <button onClick={() => removeCategory(c.name)} style={{ background: "none", border: "none", cursor: "pointer", color: c.color, display: "flex", padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addCategory} style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. Gym, Gifts" value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={30} style={{ width: 200 }} />
          <button type="submit" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Plus size={13} /> Add</button>
        </form>
      </div>

      {/* Theatres */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Theatres</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 10 }}>Shows up in the "Watched via: Theatre" dropdown on the Movies page.</div>
        {theatres.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {theatres.map((t) => (
              <span key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 20, background: "#F1ECDF", color: "#5f5a4f", fontWeight: 500 }}>
                {t}
                <button onClick={() => removeTheatre(t)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", display: "flex", padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addTheatre} style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. Prasads IMAX" value={newTheatre} onChange={(e) => setNewTheatre(e.target.value)} maxLength={60} style={{ width: 200 }} />
          <button type="submit" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Plus size={13} /> Add</button>
        </form>
      </div>

      {/* OTT Platforms */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>OTT platforms</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 10 }}>Shows up in the "Watched via: OTT" dropdown on the Movies page.</div>
        {ottPlatforms.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {ottPlatforms.map((o) => (
              <span key={o} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 20, background: "#F1ECDF", color: "#5f5a4f", fontWeight: 500 }}>
                {o}
                <button onClick={() => removeOtt(o)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", display: "flex", padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addOtt} style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. Aha, Lionsgate Play" value={newOtt} onChange={(e) => setNewOtt(e.target.value)} maxLength={60} style={{ width: 200 }} />
          <button type="submit" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Plus size={13} /> Add</button>
        </form>
      </div>

      {/* Recurring expenses */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Recurring expenses</div>
          {recurring.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div className="tabnum" style={{ fontSize: 16, fontWeight: 600 }}>
                ₹{recurring.reduce((s, r) => s + parseFloat(r.amount), 0).toLocaleString("en-IN")}/mo
              </div>
              <div style={{ fontSize: 10, color: "#8a8477" }}>total committed</div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 12 }}>Logged automatically each month on the day you set — e.g. rent or an EMI. Shows on your Expense Ledger as "scheduled" before the actual day arrives.</div>

        {recurring.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {recurring.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "8px 0", borderBottom: "1px solid #EAE5D9" }}>
                <span>{r.note || r.category} · day {r.day_of_month} · ₹{Math.round(parseFloat(r.amount)).toLocaleString("en-IN")}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEditRecurring(r)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Pencil size={13} /></button>
                  <button onClick={() => removeRecurring(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        {editingRecId && <div style={{ fontSize: 11, color: "#A3763F", marginBottom: 8 }}>Editing — change values below and Save, or Cancel.</div>}
        <form onSubmit={addRecurring} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="number" placeholder="Amount (₹)" value={recForm.amount} onChange={(e) => setRecForm({ ...recForm, amount: e.target.value })} style={{ width: 110 }} />
          <input type="text" placeholder="Category" value={recForm.category} onChange={(e) => setRecForm({ ...recForm, category: e.target.value })} style={{ width: 110 }} />
          <input type="text" placeholder="Note (e.g. Rent)" value={recForm.note} onChange={(e) => setRecForm({ ...recForm, note: e.target.value })} style={{ width: 130 }} />
          <input type="number" placeholder="Day (1-28)" value={recForm.dayOfMonth} onChange={(e) => setRecForm({ ...recForm, dayOfMonth: e.target.value })} min="1" max="28" style={{ width: 100 }} />
          <button type="submit" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Check size={13} /> {editingRecId ? "Save changes" : "Save"}</button>
          {editingRecId && (
            <button type="button" onClick={cancelEditRecurring} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><X size={13} /> Cancel</button>
          )}
        </form>
        {recError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{recError}</div>}
      </div>
    </div>
  );
}
