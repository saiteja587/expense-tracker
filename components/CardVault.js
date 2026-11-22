// Show and edit a card's secret details. They're sealed on this device
// with your vault passphrase (lib/vault.js); revealing them asks for it
// every time, and they hide themselves again after a minute.
import { useEffect, useState } from "react";
import { Lock, Eye, EyeOff, Copy } from "lucide-react";
import { openSecrets, groupCard, MIN_PASSPHRASE } from "../lib/vault";
import { showToast } from "../lib/toast";

export const SECRET_FIELDS = [
  { id: "number", label: "Card number", inputMode: "numeric", placeholder: "16 digits" },
  { id: "expiry", label: "Expiry (MM/YY)", placeholder: "08/29" },
  { id: "cvv", label: "CVV", inputMode: "numeric", placeholder: "3 or 4 digits" },
  { id: "pin", label: "ATM / card PIN", inputMode: "numeric" },
  { id: "password", label: "Net-banking / app password" },
  { id: "tpin", label: "Other PIN (T-PIN, MPIN…)" },
  { id: "notes", label: "Notes (security answers, customer ID…)", multiline: true },
];

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied`, "📋");
  } catch {
    showToast("Couldn't copy", "⚠️");
  }
}

export function RevealSecrets({ vault }) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [secrets, setSecrets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);

  // Auto-hide after 60s, and when the app goes to the background.
  useEffect(() => {
    if (!secrets) return;
    setLeft(60);
    const t = setInterval(() => setLeft((n) => {
      if (n <= 1) { setSecrets(null); return 0; }
      return n - 1;
    }), 1000);
    const onHide = () => document.hidden && setSecrets(null);
    document.addEventListener("visibilitychange", onHide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onHide); };
  }, [secrets]);

  if (!vault) return null;

  async function reveal(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      setSecrets(await openSecrets(vault, pass));
      setPass("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (secrets) {
    return (
      <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line-strong)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Hides in {left}s</span>
          <button type="button" className="chip" onClick={() => setSecrets(null)}><EyeOff size={14} /> Hide</button>
        </div>
        {SECRET_FIELDS.filter((f) => secrets[f.id]).map((f) => {
          const v = f.id === "number" ? groupCard(secrets[f.id]) : secrets[f.id];
          return (
            <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.label}</div>
                <div className="tabnum" style={{ fontSize: 15, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{v}</div>
              </div>
              <button type="button" className="icon-btn" aria-label={`Copy ${f.label}`} onClick={() => copy(f.id === "number" ? String(secrets.number).replace(/\s/g, "") : String(secrets[f.id]), f.label)}><Copy size={16} /></button>
            </div>
          );
        })}
        {!SECRET_FIELDS.some((f) => secrets[f.id]) && <div style={{ fontSize: 13, color: "var(--muted)" }}>No secret details saved.</div>}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        <Lock size={14} /> Show card details
      </button>
    );
  }
  return (
    <form onSubmit={reveal} style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Vault passphrase" style={{ flex: 1, minWidth: 160 }} />
      <button type="submit" className="btn btn-primary" disabled={busy || !pass}><Eye size={15} /> {busy ? "Opening…" : "Show"}</button>
      <button type="button" className="chip" onClick={() => { setOpen(false); setPass(""); setError(""); }}>Cancel</button>
      {error && <div role="alert" style={{ width: "100%", color: "var(--danger)", fontSize: 13 }}>{error}</div>}
    </form>
  );
}

// Fields for typing secrets in the add/edit form. `value` is the plain
// secrets object (kept only in memory while the form is open).
export function SecretsEditor({ value, onChange, passphrase, onPassphrase, confirm, onConfirm, isNew }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
        🔐 Sealed on this phone with your passphrase before it's saved. The server never sees these. <b>If you forget the passphrase, nobody can recover them</b>, so use one you'll remember and the same one for every card.
      </div>
      {SECRET_FIELDS.map((f) => (
        <label key={f.id} style={{ display: "grid", gap: 3 }}>
          <span className="field-label">{f.label}</span>
          {f.multiline ? (
            <textarea rows={2} value={value[f.id] || ""} onChange={(e) => onChange({ ...value, [f.id]: e.target.value })} maxLength={600} />
          ) : (
            <input type={show || f.id === "expiry" ? "text" : "password"} inputMode={f.inputMode} autoComplete="off" placeholder={f.placeholder}
              value={value[f.id] || ""} onChange={(e) => onChange({ ...value, [f.id]: e.target.value })} maxLength={f.id === "number" ? 23 : 120} />
          )}
        </label>
      ))}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: 18, height: 18 }} /> Show what I'm typing
      </label>
      <label style={{ display: "grid", gap: 3 }}>
        <span className="field-label">Vault passphrase (at least {MIN_PASSPHRASE} characters)</span>
        <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => onPassphrase(e.target.value)} />
      </label>
      {isNew && (
        <label style={{ display: "grid", gap: 3 }}>
          <span className="field-label">Type the passphrase again</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} />
        </label>
      )}
    </div>
  );
}
