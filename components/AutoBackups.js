// Automatic weekly backups (#14): the server keeps the last 4 snapshots
// (taken every Sunday by the daily cron). Download one, restore one, or take
// one now. Opening Settings with ?backup=1 (the Sunday notification) saves
// the newest snapshot to the phone.
import { useEffect, useState } from "react";
import { notifyLedgerChanged } from "../lib/useLedger";
import { showToast } from "../lib/toast";

function kb(n) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function download(id) {
  const res = await fetch(`/api/data?type=backup&id=${id}`);
  if (!res.ok) throw new Error();
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `expense-ledger-auto-backup-${String(data.exportedAt || "").slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function AutoBackups({ onRestored }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState("");

  async function load() {
    const res = await fetch("/api/data?type=backups");
    if (res.ok) setList((await res.json()).backups || []);
    return res.ok;
  }

  useEffect(() => {
    load().then(async () => {
      if (new URLSearchParams(window.location.search).get("backup") !== "1") return;
      window.history.replaceState({}, "", "/settings");
      const res = await fetch("/api/data?type=backups");
      const latest = res.ok ? (await res.json()).backups?.[0] : null;
      if (latest) download(latest.id).then(() => showToast("Backup saved to your phone", "🛟")).catch(() => {});
    });
  }, []);

  async function backupNow() {
    setBusy("now");
    try {
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "backup-now" }) });
      if (!res.ok) throw new Error();
      setList((await res.json()).backups || []);
      showToast("Backup stored on the server", "🛟");
    } catch {
      showToast("Couldn't back up — try again", "⚠️");
    } finally {
      setBusy("");
    }
  }

  async function restore(b) {
    const when = new Date(b.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    if (!window.confirm(`Restore the backup from ${when}? Anything missing since then is added back; records you already have are skipped.`)) return;
    setBusy(`r${b.id}`);
    try {
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "restore-backup", id: b.id }) });
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      const added = Object.values(results || {}).reduce((s, n) => s + n, 0);
      showToast(added ? `Restored — ${added} records added back` : "Nothing was missing — all good", "✅");
      notifyLedgerChanged();
      onRestored?.();
    } catch {
      showToast("Couldn't restore — try again", "⚠️");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Automatic weekly backups</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Every Sunday a copy is stored on the server (last 4 kept). Receipt photos aren&apos;t included.</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={backupNow} disabled={!!busy} style={{ minHeight: 36, fontSize: 13 }}>
          {busy === "now" ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {list && list.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>No automatic backups yet — the first one happens this Sunday.</div>}
      {list && list.map((b) => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: "1px solid var(--line)", marginTop: 8 }}>
          <div style={{ flex: 1, fontSize: 13.5 }}>
            {new Date(b.created_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
            <span style={{ color: "var(--muted)", fontSize: 12 }}> · {kb(b.size_bytes)}</span>
          </div>
          <button type="button" className="chip" disabled={!!busy} onClick={() => download(b.id).catch(() => showToast("Couldn't download", "⚠️"))}>Download</button>
          <button type="button" className="chip" disabled={!!busy} onClick={() => restore(b)}>{busy === `r${b.id}` ? "Restoring…" : "Restore"}</button>
        </div>
      ))}
    </div>
  );
}
