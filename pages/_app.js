import { useEffect, useState } from "react";
import Head from "next/head";
import "../styles/globals.css";
import { flushQueue, getQueue } from "../lib/offlineQueue";

function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "verify-pin", pin }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem("unlocked", "1");
        onUnlock();
      } else {
        setError("Wrong PIN");
        setPin("");
      }
    } catch {
      setError("Couldn't check PIN. Try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FBF8F2", fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <form onSubmit={submit} style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 20, fontWeight: 600, marginBottom: 16, color: "#241F1A" }}>Enter PIN</div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          maxLength={8}
          style={{ fontSize: 24, textAlign: "center", letterSpacing: 8, width: 180, padding: "10px 12px", border: "1px solid #D9D2C2", borderRadius: 4, background: "#fff" }}
        />
        {error && <div style={{ color: "#A34A38", fontSize: 12, marginTop: 10 }}>{error}</div>}
        <button type="submit" disabled={checking} style={{ display: "block", margin: "16px auto 0", background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "10px 22px", fontSize: 14, cursor: "pointer" }}>
          {checking ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

export default function App({ Component, pageProps }) {
  const [locked, setLocked] = useState(null); // null = checking, true/false once known
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  function refreshPending() {
    setPendingCount(getQueue().length);
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    setIsOnline(navigator.onLine);
    refreshPending();
    flushQueue().then(refreshPending);

    const handleOnline = async () => {
      setIsOnline(true);
      await flushQueue();
      refreshPending();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const interval = setInterval(refreshPending, 5000);
    if (document.documentElement.getAttribute("data-theme") === "dark" || localStorage.getItem("darkMode") === "1") {
      document.documentElement.setAttribute("data-theme", "dark");
    }

    if (sessionStorage.getItem("unlocked") === "1") {
      setLocked(false);
    } else {
      fetch("/api/data?type=pin-status")
        .then((r) => r.json())
        .then((d) => setLocked(!!d.hasPin))
        .catch(() => setLocked(false));
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  return (
    <>
      <Head>
        <title>Expense Ledger</title>
        <meta name="description" content="Personal expense tracker" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#241F1A" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Ledger" />
      </Head>
      {locked === null ? null : locked ? (
        <LockScreen onUnlock={() => setLocked(false)} />
      ) : (
        <>
          {(!isOnline || pendingCount > 0) && (
            <div style={{ position: "sticky", top: 0, zIndex: 50, background: !isOnline ? "#A34A38" : "#C98A2C", color: "#FBF8F2", fontSize: 12, textAlign: "center", padding: "6px 12px" }}>
              {!isOnline
                ? `You're offline${pendingCount > 0 ? ` — ${pendingCount} change${pendingCount !== 1 ? "s" : ""} will sync automatically` : ""}`
                : `Syncing ${pendingCount} change${pendingCount !== 1 ? "s" : ""}…`}
            </div>
          )}
          <Component {...pageProps} />
        </>
      )}
    </>
  );
}
