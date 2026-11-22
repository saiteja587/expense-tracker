// Tax helper (India, old-regime deductions): expenses you tagged with a
// section (80C, 80D, rent…) added up per financial year, with how much room
// is left under each limit. A summary to hand your CA, not tax advice.
import { useMemo, useState } from "react";
import { Receipt, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useLedger } from "../lib/useLedger";
import { financialYear, taxSummary } from "../lib/money";
import { fmt } from "../lib/format";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const d = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function TaxPage() {
  const { data, today, loaded } = useLedger();
  const [offset, setOffset] = useState(0);
  const fy = financialYear(today, offset);
  const sum = useMemo(() => (data ? taxSummary(data.expenses, fy) : null), [data, fy.start]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded || !sum) return <Loading />;

  function downloadCsv() {
    const rows = [["Section", "Date", "Note", "Category", "Amount"]];
    for (const s of sum.sections) for (const x of s.items) rows.push([s.id, x.date, x.note, x.category, x.amount]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `tax-${fy.label.replace(/\s|–/g, "-")}.csv`;
    a.click();
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Receipt size={22} color="var(--accent-solid)" />} title="Tax deductions" sub="Tag an expense with its section when you log it (quick-add → date & more, or edit in Transactions)." />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button type="button" className="icon-btn" aria-label="Previous year" onClick={() => setOffset(offset - 1)}><ChevronLeft size={18} /></button>
        <div className="lora" style={{ fontSize: 17, fontWeight: 600 }}>{fy.label}</div>
        <button type="button" className="icon-btn" aria-label="Next year" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><ChevronRight size={18} /></button>
      </div>

      <div className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Deductions counted (after limits)</div>
        <div className="lora tabnum" style={{ fontSize: 28, fontWeight: 700 }}>{fmt(sum.total)}</div>
        <button type="button" className="chip" style={{ marginTop: 8 }} onClick={downloadCsv}><Download size={14} /> Download for your CA (CSV)</button>
      </div>

      {sum.sections.map((s) => (
        <div key={s.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
            <div className="tabnum" style={{ fontSize: 15, fontWeight: 600 }}>{fmt(s.total)}</div>
          </div>
          {s.limit > 0 && (
            <>
              <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden", marginTop: 8 }}>
                <div style={{ height: "100%", width: `${Math.min(100, (s.total / s.limit) * 100)}%`, background: s.total >= s.limit ? "var(--success)" : "var(--accent-solid)" }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                Limit {fmt(s.limit)} · {s.roomLeft > 0 ? `${fmt(s.roomLeft)} more can still be claimed` : "fully used ✓"}
              </div>
            </>
          )}
          {s.items.slice(0, 6).map((x) => (
            <div key={x.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text-2)", paddingTop: 5 }}>
              <span>{d(x.date)} · {x.note || x.category}</span><span className="tabnum">{fmt(x.amount)}</span>
            </div>
          ))}
          {s.items.length > 6 && <div style={{ fontSize: 12, color: "var(--muted)", paddingTop: 4 }}>+ {s.items.length - 6} more (in the CSV)</div>}
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
        Limits are the usual old-regime ones (80C ₹1.5L, 80D ₹25k self / ₹50k senior-citizen parents, 24(b) ₹2L). The new regime allows most of these deductions only partly or not at all. Check with your CA.
      </div>
    </div>
  );
}
