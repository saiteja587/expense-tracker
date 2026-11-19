// Pay a recurring bill via UPI (#10). Bill notifications for items with a
// UPI id open /pay?r=<id>; the button hands off to any UPI app (GPay,
// PhonePe, Paytm, BHIM…) with payee, amount and note filled in. When you
// come back, the page asks whether it went through, so the app knows the
// bill is paid (unpaid ones get a reminder on Home and the next morning).
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { fmt } from "../lib/format";
import { effectiveDayClient, ymOf } from "../lib/ledger";
import { showToast } from "../lib/toast";

const ordinal = (d) => `${d}${[1, 21, 31].includes(d) ? "st" : [2, 22].includes(d) ? "nd" : [3, 23].includes(d) ? "rd" : "th"}`;

export default function PayPage() {
  const router = useRouter();
  const { data, today, loaded } = useLedger();
  const bill = data?.recurring.find((r) => String(r.id) === String(router.query.r));
  const [amountText, setAmountText] = useState("");
  const [stage, setStage] = useState("idle"); // idle | launched | ask | done
  const [paidMap, setPaidMap] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bill) setAmountText(String(Math.round(parseFloat(bill.amount) * 100) / 100));
  }, [bill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/data?type=bills-paid").then((r) => (r.ok ? r.json() : null)).then((d) => d && setPaidMap(d.paid || {})).catch(() => {});
  }, []);

  // Back from the UPI app → ask whether it worked.
  useEffect(() => {
    if (stage !== "launched") return;
    const onVisible = () => { if (document.visibilityState === "visible") setStage("ask"); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setTimeout(() => setStage((s) => (s === "launched" ? "ask" : s)), 8000);
    return () => { document.removeEventListener("visibilitychange", onVisible); clearTimeout(t); };
  }, [stage]);

  const wrap = (children) => <div className="page-container" style={{ maxWidth: 480, margin: "0 auto", padding: "28px 20px 120px" }}>{children}</div>;

  if (!loaded) return wrap(<div className="skeleton" style={{ height: 220, borderRadius: 22 }} />);
  if (!bill) {
    return wrap(
      <>
        <h1 className="lora" style={{ fontSize: 24 }}>Bill not found</h1>
        <p style={{ color: "var(--text-2)" }}>It may have been deleted. <Link href="/settings#recurring">Manage recurring bills →</Link></p>
      </>
    );
  }
  const ym = ymOf(today);
  const amount = Math.round((parseFloat(amountText) || 0) * 100) / 100;
  const label = bill.note || bill.category;
  const due = effectiveDayClient(bill.day_of_month, today);
  const alreadyLogged = bill.variable && bill.last_generated_month === ym;
  const alreadyPaid = (paidMap && paidMap[bill.id] === ym) || alreadyLogged;
  const upi = bill.upi_id && amount > 0
    ? `upi://pay?pa=${encodeURIComponent(bill.upi_id)}&pn=${encodeURIComponent(label)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(label)}`
    : null;

  async function confirm(paid) {
    setBusy(true);
    try {
      const body = bill.variable && paid && !alreadyLogged
        ? { type: "variable-bill", id: bill.id, amount }
        : { type: "bill-paid", id: bill.id, paid };
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save");
      if (paid) {
        setPaidMap((m) => ({ ...(m || {}), [bill.id]: ym }));
        showToast(bill.variable ? `${label} · ${fmt(amount)} logged as paid` : `${label} marked paid`, "✅");
        notifyLedgerChanged();
        setStage("done");
      } else {
        showToast("OK — we'll remind you tomorrow", "⏰");
        setStage("idle");
      }
    } catch (e) {
      showToast(e.message, "⚠️");
    } finally {
      setBusy(false);
    }
  }

  return wrap(
    <>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>← Home</Link>
      <div className="card" style={{ marginTop: 14, padding: 24, borderRadius: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40 }} aria-hidden="true">{alreadyPaid ? "✅" : "💳"}</div>
        <div style={{ fontSize: 15, color: "var(--muted)", marginTop: 6 }}>{label}</div>
        {bill.variable && !alreadyPaid ? (
          <>
            <label className="field-label" htmlFor="pay-amount" style={{ marginTop: 8 }}>This month&apos;s amount (last time {fmt(parseFloat(bill.amount))})</label>
            <input id="pay-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amountText} onChange={(e) => setAmountText(e.target.value)}
              className="lora tabnum" style={{ fontSize: 30, fontWeight: 700, textAlign: "center", padding: "8px 10px" }} />
          </>
        ) : (
          <div className="lora tabnum" style={{ fontSize: 42, fontWeight: 700, margin: "4px 0" }}>{fmt(alreadyLogged ? parseFloat(bill.amount) : amount)}</div>
        )}
        <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 4 }}>Due on the {ordinal(due)}{bill.upi_id ? ` · to ${bill.upi_id}` : ""}</div>

        {alreadyPaid && stage !== "ask" ? (
          <div style={{ marginTop: 18, fontSize: 14, color: "var(--success)", fontWeight: 600 }}>Paid for this month 🎉</div>
        ) : stage === "ask" ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Did the payment go through?</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn btn-primary" style={{ flex: 1, minHeight: 48 }} disabled={busy} onClick={() => confirm(true)}>✅ Paid</button>
              <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 48 }} disabled={busy} onClick={() => confirm(false)}>❌ Not yet</button>
            </div>
          </div>
        ) : (
          <>
            {upi ? (
              <a href={upi} onClick={() => setStage("launched")} className="btn btn-primary btn-block" style={{ marginTop: 20, minHeight: 54, fontSize: 16, textDecoration: "none" }}>Pay {fmt(amount)} with UPI</a>
            ) : bill.upi_id ? null : (
              <div style={{ marginTop: 18, fontSize: 13.5, color: "var(--text-2)" }}>
                Add a UPI ID to this bill in <Link href="/settings#recurring" style={{ color: "var(--accent-solid)", fontWeight: 600 }}>Settings → Recurring</Link> to pay in one tap.
              </div>
            )}
            <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 10 }} disabled={busy || (bill.variable && !(amount > 0))} onClick={() => confirm(true)}>
              I&apos;ve already paid this
            </button>
          </>
        )}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
          {bill.variable ? "Confirming logs this month's amount as the expense." : "The expense is logged automatically on its due date — no need to add it again."}
        </div>
      </div>
    </>
  );
}
