// Loans & EMIs: what's left, EMIs paid/remaining, payoff date, and "what if
// I prepay ₹X" (interest and months saved). Prepayments you make are saved
// on the loan and shorten it.
import { useEffect, useMemo, useState } from "react";
import { Building2, Plus, Pencil, Trash2, X } from "lucide-react";
import { mapLoan, loanSchedule, prepaySaving, emiFor } from "../lib/money";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle, Stat } from "../components/PageHeader";

const monthYear = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const emptyForm = () => ({ id: null, name: "", lender: "", principal: "", rate: "", tenureMonths: "", startDate: todayISO(), emi: "", note: "", closed: false, prepayments: [] });

export default function LoansPage() {
  const [loans, setLoans] = useState(null);
  const [form, setForm] = useState(null);
  const today = todayISO();

  async function load() {
    try { setLoans(((await apiGet("loans")).loans || []).map(mapLoan)); } catch (e) { showToast(e.message, "⚠️"); setLoans([]); }
  }
  useEffect(() => { load(); }, []);

  const view = useMemo(() => {
    if (!loans) return null;
    const rows = loans.map((l) => ({ ...l, s: loanSchedule(l, today) }));
    const open = rows.filter((l) => !l.closed);
    return {
      rows, outstanding: open.reduce((s, l) => s + (l.s.outstanding || 0), 0),
      emis: open.reduce((s, l) => s + (l.s.remainingEmis > 0 ? l.s.emi : 0), 0),
    };
  }, [loans, today]);

  if (!view) return <Loading />;

  async function save(l) {
    const body = { type: "loan", ...l, principal: parseFloat(l.principal), rate: parseFloat(l.rate) || 0, tenureMonths: parseInt(l.tenureMonths, 10), emi: parseFloat(l.emi) || 0 };
    if (l.id) await apiPut(body); else await apiPost(body);
    await load();
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Building2 size={22} color="var(--accent-solid)" />} title="Loans & EMIs" sub="Home, car, personal or education loans: what's left, when it ends, and what prepaying saves.">
        <button type="button" className="chip active" onClick={() => setForm(emptyForm())}><Plus size={14} /> Add</button>
      </PageHeader>

      {form && <LoanForm form={form} setForm={setForm} onSave={async (l) => { await save(l); setForm(null); showToast("Loan saved", "🏦"); }} />}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Left to repay" value={fmt(view.outstanding)} tone={view.outstanding ? "bad" : undefined} />
        <Stat label="EMIs every month" value={fmt(view.emis)} />
      </div>

      {view.rows.length === 0 && (
        <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>
          No loans. Add one to see its payoff date and what an extra payment would save. Tip: also add the EMI as a recurring bill in Settings so it's counted in your spending.
        </div>
      )}
      {view.rows.map((l) => (
        <LoanCard key={l.id} l={l} today={today} onEdit={() => setForm({ ...l, principal: String(l.principal), rate: String(l.rate), tenureMonths: String(l.tenureMonths), emi: l.emi ? String(l.emi) : "" })}
          onDelete={async () => {
            if (!window.confirm(`Delete ${l.name}?`)) return;
            try { await apiDelete("loan", l.id); await load(); } catch (e) { showToast(e.message, "⚠️"); }
          }}
          onPrepay={async (amount, date) => {
            try { await save({ ...l, prepayments: [...l.prepayments, { date, amount }] }); showToast(`Prepayment of ${fmt(amount)} recorded`, "🎉"); } catch (e) { showToast(e.message, "⚠️"); }
          }} />
      ))}
    </div>
  );
}

function LoanCard({ l, today, onEdit, onDelete, onPrepay }) {
  const s = l.s;
  const [extra, setExtra] = useState("");
  const amt = parseFloat(extra) || 0;
  const what = amt > 0 && !s.error ? prepaySaving(l, amt, today) : null;
  const done = l.tenureMonths ? Math.min(1, s.paidEmis / (s.paidEmis + s.remainingEmis || 1)) : 0;
  return (
    <div className="card" style={{ borderRadius: 18, padding: 16, marginBottom: 12, opacity: l.closed ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{l.name}{l.closed && " · closed"}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{[l.lender, `${fmt(l.principal)} at ${l.rate}%`, `${l.tenureMonths} months from ${monthYear(l.startDate)}`].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Edit loan" onClick={onEdit}><Pencil size={16} /></button>
        <button type="button" className="icon-btn danger" aria-label="Delete loan" onClick={onDelete}><Trash2 size={16} /></button>
      </div>
      {s.error ? <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{s.error}</div> : (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>Outstanding</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600 }}>{fmt(s.outstanding)}</div></div>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>EMI</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600 }}>{fmt(s.emi)}</div></div>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>EMIs left</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600 }}>{s.remainingEmis}</div></div>
            <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>Ends</div><div className="lora" style={{ fontSize: 19, fontWeight: 600 }}>{monthYear(s.payoffDate)}</div></div>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden", marginTop: 10 }}>
            <div style={{ height: "100%", width: `${done * 100}%`, background: "var(--success)" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{s.paidEmis} EMIs paid · {fmt(s.interestPaid)} interest so far of {fmt(s.interestTotal)} total</div>
          {!l.closed && s.outstanding > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <div className="field-label">What if I prepay…</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="₹ amount" style={{ flex: 1 }} />
                {amt > 0 && <button type="button" className="chip" onClick={() => { if (window.confirm(`Record a prepayment of ${fmt(amt)} today?`)) { onPrepay(amt, today); setExtra(""); } }}>I paid this</button>}
              </div>
              {what && <div style={{ fontSize: 13, marginTop: 6, color: "var(--success)" }}>Saves {fmt(what.interestSaved)} in interest and {what.monthsSaved} EMI{what.monthsSaved === 1 ? "" : "s"}. It would end in {monthYear(what.newPayoff)}.</div>}
            </div>
          )}
          {l.prepayments.length > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Prepaid: {l.prepayments.map((p) => `${fmt(p.amount)} (${monthYear(p.date)})`).join(", ")}</div>}
        </>
      )}
    </div>
  );
}

function LoanForm({ form, setForm, onSave }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const calc = emiFor(parseFloat(form.principal) || 0, parseFloat(form.rate) || 0, parseInt(form.tenureMonths, 10) || 0);
  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Name it, e.g. Home loan");
    if (!(parseFloat(form.principal) > 0)) return setError("Enter the loan amount");
    if (!(parseInt(form.tenureMonths, 10) > 0)) return setError("Enter the tenure in months");
    setBusy(true); setError("");
    try { await onSave(form); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 20, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit loan" : "Add a loan"}</div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.name} onChange={set("name")} placeholder="Name, e.g. Home loan" maxLength={60} style={{ flex: 1 }} />
        <input value={form.lender} onChange={set("lender")} placeholder="Lender" maxLength={60} style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 2, display: "grid", gap: 3 }}><span className="field-label">Loan amount</span><input type="number" inputMode="decimal" value={form.principal} onChange={set("principal")} /></label>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Interest % / yr</span><input type="number" inputMode="decimal" step="0.01" value={form.rate} onChange={set("rate")} /></label>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Months</span><input type="number" inputMode="numeric" value={form.tenureMonths} onChange={set("tenureMonths")} /></label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Loan started</span><input type="date" value={form.startDate} onChange={set("startDate")} /></label>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">EMI (blank = calculate)</span><input type="number" inputMode="decimal" value={form.emi} onChange={set("emi")} placeholder={calc ? fmt(calc) : ""} /></label>
      </div>
      {form.id && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={form.closed} onChange={set("closed")} style={{ width: 18, height: 18 }} /> Closed / fully repaid</label>}
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </form>
  );
}
