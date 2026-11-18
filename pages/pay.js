// Pay a recurring bill via UPI (#10). Bill notifications for items with a
// UPI id open /pay?r=<id>; the button hands off to any UPI app (GPay,
// PhonePe, Paytm, BHIM…) with payee, amount and note filled in.
import { useRouter } from "next/router";
import Link from "next/link";
import { useLedger } from "../lib/useLedger";
import { fmt } from "../lib/format";
import { effectiveDayClient } from "../lib/ledger";

export default function PayPage() {
  const router = useRouter();
  const { data, today, loaded } = useLedger();
  const bill = data?.recurring.find((r) => String(r.id) === String(router.query.r));

  if (!loaded) return <div className="page-container" style={{ maxWidth: 480, margin: "0 auto", padding: "32px 20px" }}><div className="skeleton" style={{ height: 220, borderRadius: 22 }} /></div>;
  if (!bill) {
    return (
      <div className="page-container" style={{ maxWidth: 480, margin: "0 auto", padding: "32px 20px" }}>
        <h1 className="lora" style={{ fontSize: 24 }}>Bill not found</h1>
        <p style={{ color: "var(--text-2)" }}>It may have been deleted. <Link href="/settings">Manage recurring bills →</Link></p>
      </div>
    );
  }
  const amount = Math.round(parseFloat(bill.amount) * 100) / 100;
  const label = bill.note || bill.category;
  const due = effectiveDayClient(bill.day_of_month, today);
  const upi = bill.upi_id
    ? `upi://pay?pa=${encodeURIComponent(bill.upi_id)}&pn=${encodeURIComponent(label)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(label)}`
    : null;

  return (
    <div className="page-container" style={{ maxWidth: 480, margin: "0 auto", padding: "28px 20px 120px" }}>
      <Link href="/" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>← Home</Link>
      <div className="card" style={{ marginTop: 14, padding: 24, borderRadius: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40 }} aria-hidden="true">💳</div>
        <div style={{ fontSize: 15, color: "var(--muted)", marginTop: 6 }}>{label}</div>
        <div className="lora tabnum" style={{ fontSize: 42, fontWeight: 700, margin: "4px 0" }}>{fmt(amount)}</div>
        <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>Due on the {due}{[1, 21, 31].includes(due) ? "st" : [2, 22].includes(due) ? "nd" : [3, 23].includes(due) ? "rd" : "th"}{bill.upi_id ? ` · to ${bill.upi_id}` : ""}</div>
        {upi ? (
          <a href={upi} className="btn btn-primary btn-block" style={{ marginTop: 20, minHeight: 54, fontSize: 16, textDecoration: "none" }}>Pay {fmt(amount)} with UPI</a>
        ) : (
          <div style={{ marginTop: 18, fontSize: 13.5, color: "var(--text-2)" }}>
            Add a UPI ID to this bill in <Link href="/settings">Settings → Recurring</Link> to pay in one tap.
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>The expense is logged automatically on its due date — no need to add it again.</div>
      </div>
    </div>
  );
}
