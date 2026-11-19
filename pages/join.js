// Join with an invite (/join?code=XXXX): an invited friend picks a name and
// PIN and gets their own, completely separate ledger in the same app.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { rememberAccount } from "../lib/account";
import { extendSession } from "../lib/unlockSession";

export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codeOk, setCodeOk] = useState(null); // null = not checked yet
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!router.isReady) return;
    const c = typeof router.query.code === "string" ? router.query.code.toUpperCase() : "";
    if (c) setCode(c);
  }, [router.isReady, router.query.code]);

  // Check the code as soon as it looks complete.
  useEffect(() => {
    const c = code.replace(/[^A-Z0-9]/gi, "");
    if (c.length < 8) { setCodeOk(null); return; }
    let live = true;
    fetch(`/api/data?type=invite-check&code=${encodeURIComponent(c)}`)
      .then((r) => r.json())
      .then((d) => live && setCodeOk(!!d.valid))
      .catch(() => live && setCodeOk(null));
    return () => { live = false; };
  }, [code]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Enter your name");
    if (!/^\d{4,8}$/.test(pin)) return setError("PIN must be 4–8 digits");
    if (pin !== pin2) return setError("The two PINs don't match");
    setBusy(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "join", code, name: name.trim(), pin }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't join — try again");
      rememberAccount({ ...d.user, hasPin: true }, { multiUser: true });
      extendSession();
      // A full load, so the app starts fresh as the new person.
      window.location.replace("/welcome");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 16px" }}>
      <Head><title>Join · Expense Ledger</title></Head>
      <form onSubmit={submit} className="card" style={{ width: "100%", maxWidth: 380, padding: 24, borderRadius: 24, display: "grid", gap: 10 }}>
        <div style={{ textAlign: "center" }}>
          <img src="/icon-192.png" alt="" width={56} height={56} style={{ borderRadius: 16, boxShadow: "var(--shadow-md)" }} />
          <h1 className="lora gradient-title" style={{ fontSize: 24, fontWeight: 700, margin: "10px 0 2px" }}>Join Expense Ledger</h1>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.45 }}>You get your own private ledger — nobody else can see your money, movies or streaks.</div>
        </div>

        <label className="field-label" htmlFor="j-code">Invite code</label>
        <input id="j-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. K7QM2XRA" autoCapitalize="characters" autoComplete="off" maxLength={16}
          style={{ letterSpacing: 2, fontWeight: 600, textAlign: "center" }} />
        {codeOk === false && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>This code is wrong, already used or expired — ask for a new one.</div>}
        {codeOk === true && <div style={{ fontSize: 12.5, color: "var(--success)" }}>✓ Valid invite</div>}

        <label className="field-label" htmlFor="j-name">Your name</label>
        <input id="j-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" autoComplete="username" autoCapitalize="words" maxLength={30} />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>You&apos;ll type this to sign in.</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label className="field-label" htmlFor="j-pin">PIN (4–8 digits)</label>
            <input id="j-pin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} maxLength={8} />
          </div>
          <div>
            <label className="field-label" htmlFor="j-pin2">PIN again</label>
            <input id="j-pin2" type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} maxLength={8} />
          </div>
        </div>

        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || codeOk === false} style={{ minHeight: 50, marginTop: 4 }}>
          {busy ? "Creating your ledger…" : "Create my ledger"}
        </button>
        <Link href="/" style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>Already have an account? Sign in</Link>
      </form>
    </div>
  );
}
