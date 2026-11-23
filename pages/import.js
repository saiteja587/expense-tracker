// Import a bank or credit-card statement (CSV export from net banking).
// Every row is shown first with a guessed category; rows that look like
// something you already logged are unticked. Importing the same file twice
// adds nothing the second time.
import { useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { parseStatementCsv, findDuplicates, kindOf, isCard } from "../lib/money";
import { parsePdfStatementLines } from "../lib/lifePlus";
import { pdfLines } from "../lib/pdfText";
import { allCategories, MOVIE_CATEGORY } from "../lib/categories";
import { learnCategory } from "../lib/smart";
import { guessCategory } from "../lib/smsParse";
import { apiPost } from "../lib/api";
import { fmt } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const d = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
// Card-payment and self-transfer lines aren't spending.
const LOOKS_LIKE_TRANSFER = /payment received|thank you|autopay|bill ?pay|cc payment|credit card payment|self transfer|own account|neft.*self|imps.*self/i;

export default function ImportPage() {
  const { data, loaded } = useLedger();
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const categories = useMemo(() => (data ? allCategories(data.customCategories).filter((c) => c.name !== MOVIE_CATEGORY.name) : []), [data]);

  if (!loaded || !data) return <Loading />;
  const accounts = (data.accounts || []).filter((a) => !a.archived);
  const account = accounts.find((a) => String(a.id) === accountId) || null;

  function prepare(text, preParsed) {
    const { rows: parsed, error: e } = preParsed ? { rows: preParsed } : parseStatementCsv(text);
    if (e) { setError(e); setRows(null); return; }
    if (!parsed.length) { setError("No transactions found in that file."); setRows(null); return; }
    setError("");
    const seen = {};
    setRows(parsed.map((r) => {
      const base = `${r.date}|${r.description.toLowerCase().slice(0, 50)}|${r.amount}|${r.type}`;
      seen[base] = (seen[base] || 0) + 1;
      const cat = (learnCategory(data.expenses, r.description) || guessCategory(r.description) || "Other");
      const category = categories.some((c) => c.name === cat) ? cat : "Other";
      const dupes = r.type === "debit" ? findDuplicates({ amount: r.amount, date: r.date, category, note: r.description }, data.expenses) : [];
      const transferish = LOOKS_LIKE_TRANSFER.test(r.description);
      return { ...r, key: `${base}|${seen[base] - 1}`, category, dupe: dupes[0] || null, transferish, include: !dupes.length && !transferish };
    }));
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") { readPdf(f); return; }
    prepare(await f.text());
  }

  // PDFs are read on this phone (pdf.js); locked ones ask for the password.
  async function readPdf(f, password) {
    setBusy(true); setError("");
    try {
      const lines = await pdfLines(f, password);
      const parsed = parsePdfStatementLines(lines);
      if (!parsed.length) { setError("Couldn't find transactions in this PDF. Some banks' PDF layouts don't work; try the CSV/Excel download instead."); return; }
      prepare("", parsed);
    } catch (e) {
      if (e.needsPassword) {
        const pw = window.prompt(`${e.message} Enter its password (often your date of birth or customer ID). It's only used on this phone.`);
        if (pw) return readPdf(f, pw);
        setError("This PDF needs its password.");
      } else setError(e.message);
    } finally { setBusy(false); }
  }

  const chosen = (rows || []).filter((r) => r.include);
  const spend = chosen.filter((r) => r.type === "debit").reduce((s, r) => s + r.amount, 0);
  const inflow = chosen.filter((r) => r.type === "credit").reduce((s, r) => s + r.amount, 0);

  async function doImport() {
    setBusy(true);
    try {
      const r = await apiPost({ type: "statement-import", accountId: account ? account.id : null, rows: chosen.map(({ key, date, description, amount, type, category }) => ({ key, date, description, amount, type, category })) });
      notifyLedgerChanged();
      showToast(`${r.added} expense${r.added === 1 ? "" : "s"} and ${r.credited} money-in added${r.skipped ? ` · ${r.skipped} already imported` : ""}`, "📥");
      setRows(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader back="/accounts" backLabel="Accounts" icon={<FileUp size={22} color="var(--accent-solid)" />} title="Import a statement"
        sub="Pick your bank or card statement (CSV, or PDF, even password-protected). It's read on this phone, and you check every row before anything is added." />

      <div className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14, display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 3 }}>
          <span className="field-label">Which account is this statement for?</span>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setRows(null); }}>
            <option value="">👛 Main wallet</option>
            {accounts.map((a) => <option key={a.id} value={String(a.id)}>{kindOf(a.kind).emoji} {a.name}</option>)}
          </select>
        </label>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,.pdf,application/pdf" onChange={onFile} style={{ display: "none" }} />
        <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}><FileUp size={16} /> {busy && !rows ? "Reading…" : "Choose CSV or PDF"}</button>
        <details>
          <summary style={{ fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>Or paste the statement text</summary>
          <textarea rows={5} placeholder="Date,Narration,Withdrawal,Deposit…" onBlur={(e) => e.target.value.trim() && prepare(e.target.value)} style={{ marginTop: 8 }} />
        </details>
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      </div>

      {rows && (
        <>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
            {rows.length} rows · {chosen.length} ticked · {fmt(spend)} spending{inflow ? ` · ${fmt(inflow)} money in` : ""}.
            Unticked: possible duplicates and {account && isCard(account) ? "card payments" : "transfers"}.
          </div>
          <div className="card" style={{ borderRadius: 16, padding: "4px 12px", marginBottom: 14 }}>
            {rows.map((r, i) => (
              <div key={r.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid var(--line)", opacity: r.include ? 1 : 0.55 }}>
                <input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} style={{ width: 18, height: 18, marginTop: 3 }} aria-label={`Include ${r.description}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, wordBreak: "break-word" }}>{r.description || "(no description)"}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                    {d(r.date)}
                    {r.type === "debit" ? (
                      <select value={r.category} onChange={(e) => setRow(i, { category: e.target.value })} style={{ width: "auto", padding: "2px 6px", fontSize: 12, minHeight: 0 }}>
                        {categories.map((c) => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
                      </select>
                    ) : <span style={{ color: "var(--success)" }}>money in</span>}
                    {r.dupe && <span style={{ color: "var(--amber)" }}>· looks like “{r.dupe.note || r.dupe.category}” on {d(r.dupe.date)}</span>}
                    {r.transferish && <span style={{ color: "var(--amber)" }}>· looks like a transfer/payment</span>}
                  </div>
                </div>
                <span className="tabnum" style={{ fontSize: 14, color: r.type === "credit" ? "var(--success)" : undefined }}>{r.type === "credit" ? "+" : ""}{fmt(r.amount)}</span>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={busy || !chosen.length} onClick={doImport} style={{ minHeight: 50 }}>
            {busy ? "Importing…" : `Import ${chosen.length} row${chosen.length === 1 ? "" : "s"} into ${account ? account.name : "main wallet"}`}
          </button>
        </>
      )}
    </div>
  );
}
