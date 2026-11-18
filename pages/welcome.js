// First-run setup: starting balance → monthly limit → PIN. Every step can
// be skipped; Home sends brand-new users here once.
import { useState } from "react";
import { useRouter } from "next/router";
import { Wallet, Target, Lock, Sparkles } from "lucide-react";
import { notifyLedgerChanged, WELCOMED_KEY } from "../lib/useLedger";
import { todayISO } from "../lib/format";


async function post(body) {
  const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save");
}

const STEPS = [
  { Icon: Sparkles, title: "Welcome to Expense Ledger", sub: "Money, movies and a no-sugar streak — in one calm little app. Three quick questions and you're set." },
  { Icon: Wallet, title: "How much money do you have right now?", sub: "Your bank + UPI balance. We'll turn it into a daily budget.", field: "balance", placeholder: "e.g. 25000" },
  { Icon: Target, title: "A monthly spending limit?", sub: "We'll warn you before you cross it. You can change it any time.", field: "limit", placeholder: "e.g. 30000" },
  { Icon: Lock, title: "Lock it with a PIN", sub: "4–8 digits. Without a PIN anyone with the link could see your data.", field: "pin", placeholder: "••••" },
];

export default function Welcome() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = STEPS[step];

  function finish() {
    try { localStorage.setItem(WELCOMED_KEY, "1"); } catch { /* ignore */ }
    notifyLedgerChanged();
    router.replace("/");
  }
  function next() {
    setValue("");
    setError("");
    if (step === STEPS.length - 1) finish();
    else setStep(step + 1);
  }

  async function save() {
    if (!s.field) return next();
    const v = value.trim();
    if (!v) return next();
    setBusy(true);
    setError("");
    try {
      if (s.field === "balance") await post({ type: "balance", amount: parseFloat(v), mode: "set", date: todayISO(), note: "Starting balance" });
      if (s.field === "limit") await post({ type: "budget", ruleType: "overall", amount: parseFloat(v) });
      if (s.field === "pin") {
        if (!/^\d{4,8}$/.test(v)) throw new Error("PIN must be 4–8 digits");
        await post({ type: "set-pin", pin: v });
      }
      next();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", padding: "calc(28px + env(safe-area-inset-top, 0px)) 24px 32px", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 40 }} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: i <= step ? "var(--accent-gradient)" : "var(--line)" }} />)}
      </div>
      <div key={step} style={{ flex: 1, animation: "riseIn 0.5s var(--ease-fluid)" }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: "var(--accent-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--accent-glow)" }}>
          <s.Icon size={30} />
        </div>
        <h1 className="lora" style={{ fontSize: 28, fontWeight: 700, margin: "22px 0 8px", lineHeight: 1.2 }}>{s.title}</h1>
        <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.5, margin: 0 }}>{s.sub}</p>
        {s.field && (
          <input
            autoFocus
            type={s.field === "pin" ? "password" : "number"}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(s.field === "pin" ? e.target.value.replace(/\D/g, "").slice(0, 8) : e.target.value)}
            placeholder={s.placeholder}
            aria-label={s.title}
            onKeyDown={(e) => e.key === "Enter" && save()}
            style={{ marginTop: 26, fontSize: 24, padding: "14px 16px", textAlign: s.field === "pin" ? "center" : "left", letterSpacing: s.field === "pin" ? 8 : 0 }}
          />
        )}
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 14, marginTop: 10 }}>{error}</div>}
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={save} style={{ minHeight: 54, fontSize: 16 }}>
        {busy ? "Saving…" : step === 0 ? "Let's go" : step === STEPS.length - 1 ? "Finish" : "Continue"}
      </button>
      {s.field && (
        <button type="button" onClick={next} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 14, marginTop: 12, padding: 10, cursor: "pointer" }}>
          Skip for now
        </button>
      )}
    </div>
  );
}
