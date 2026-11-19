// "Needs you" on Home: small things the app can only finish with your help,
// asked at the right moment instead of up front.
//  - Movies you've watched but not rated yet (booked earlier).
//  - Amount-varies bills (electricity…): "How much was it this month?"
//  - UPI bills past their due day that you haven't confirmed as paid.
//  - Rough "≈ estimate" expenses waiting for the real amount.
//  - Start of the month: a 30-second look back and limit check.
//  - Savings goal reached: celebrate, then pick the next one.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notifyLedgerChanged } from "../lib/useLedger";
import { movieStatus, itemsInMonth, ymOf, addDays, effectiveDayClient } from "../lib/ledger";
import { fmt } from "../lib/format";
import { showToast } from "../lib/toast";
import { celebrate } from "../lib/celebrate";
import RateMovieSheet from "./RateMovieSheet";

const ordinal = (d) => `${d}${[1, 21, 31].includes(d) ? "st" : [2, 22].includes(d) ? "nd" : [3, 23].includes(d) ? "rd" : "th"}`;
const monthName = (ym) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long" });

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

async function post(body) {
  const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Couldn't save — try again");
  return d;
}

function Row({ emoji, title, sub, children }) {
  return (
    <div className="card" style={{ padding: "12px 14px", borderRadius: 18, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 22, lineHeight: 1.2 }} aria-hidden="true">{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
          {sub && <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
        </div>
      </div>
      {children && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function AmountForm({ initial, cta, onSubmit, label }) {
  const [v, setV] = useState(initial ? String(Math.round(initial)) : "");
  const [busy, setBusy] = useState(false);
  return (
    <form style={{ display: "flex", gap: 8 }} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try { await onSubmit(parseFloat(v)); } catch (err) { showToast(err.message, "⚠️"); } finally { setBusy(false); }
    }}>
      <input type="number" inputMode="decimal" min="0" step="0.01" aria-label={label} value={v} onChange={(e) => setV(e.target.value)} placeholder="₹" style={{ flex: 1, minWidth: 0 }} />
      <button type="submit" className="btn btn-primary" disabled={busy || !(parseFloat(v) > 0)} style={{ minHeight: 40, fontSize: 13.5 }}>{busy ? "Saving…" : cta}</button>
    </form>
  );
}

export default function NeedsYou({ data, derived, today, focusBill }) {
  const [paid, setPaid] = useState(null);
  const [rateTarget, setRateTarget] = useState(null);
  const [hidden, setHidden] = useState({});
  const ym = ymOf(today);
  const lastYm = ymOf(addDays(today.slice(0, 8) + "01", -1));

  useEffect(() => {
    fetch("/api/data?type=bills-paid").then((r) => (r.ok ? r.json() : null)).then((d) => d && setPaid(d.paid || {})).catch(() => {});
  }, [data]);

  const items = useMemo(() => {
    const dom = Number(today.slice(8, 10));
    const toRate = data.movies.filter((m) => movieStatus(m) === "rate").slice(0, 3);
    const variableDue = data.recurring.filter((r) => r.variable && r.last_generated_month !== ym &&
      (effectiveDayClient(r.day_of_month, today) <= dom || String(r.id) === String(focusBill)));
    const unpaid = paid ? data.recurring.filter((r) => r.upi_id && !r.variable && paid[r.id] !== ym &&
      effectiveDayClient(r.day_of_month, today) <= dom && !hidden[`bill-${r.id}`]) : [];
    const estimates = data.expenses.filter((x) => x.estimate && x.date < today && !hidden[`est-${x.id}`]).slice(0, 3);

    // Month check-in: first 5 days, once per month, only if last month had activity.
    let checkin = null;
    if (dom <= 5 && !hidden.checkin && lsGet(`checkin_${ym}`) !== "done") {
      const spent = itemsInMonth(derived.items, lastYm).reduce((s, x) => s + x.amount, 0);
      const limit = data.rules.find((r) => r.ruleType === "overall")?.amount || 0;
      if (spent > 0) checkin = { spent, limit, suggested: Math.ceil((spent * 1.05) / 1000) * 1000 };
    }

    const goal = data.savingsGoal && data.savingsGoal.targetAmount > 0 && derived.balance >= data.savingsGoal.targetAmount ? data.savingsGoal : null;
    return { toRate, variableDue, unpaid, estimates, checkin, goal };
  }, [data, derived, today, ym, lastYm, paid, hidden, focusBill]);

  // Confetti once per goal.
  useEffect(() => {
    const g = items.goal;
    if (!g) return;
    const key = `goal_done_${g.targetAmount}_${g.label || ""}`;
    if (lsGet(key)) return;
    lsSet(key, "1");
    celebrate({ emoji: "🎯", title: "Goal reached!", message: <>You saved <strong>{fmt(g.targetAmount)}</strong>{g.label ? <> for <strong>{g.label}</strong></> : null}. 🎉</> });
  }, [items.goal]);

  const { toRate, variableDue, unpaid, estimates, checkin, goal } = items;
  if (!toRate.length && !variableDue.length && !unpaid.length && !estimates.length && !checkin && !goal) return null;

  async function setNextGoal(amount) {
    try {
      await post({ type: "savings-goal", label: "Next goal", targetAmount: amount, targetDate: null });
      showToast(`New goal: ${fmt(amount)}`, "🎯");
      notifyLedgerChanged();
    } catch (e) { showToast(e.message, "⚠️"); }
  }

  return (
    <section aria-label="Needs you" style={{ marginBottom: 18 }}>
      <h2 className="section-title" style={{ fontSize: 15, marginBottom: 8 }}>Needs you</h2>

      {goal && (
        <Row emoji="🎯" title={`Goal reached — ${goal.label || "savings goal"}!`} sub={`You've got ${fmt(derived.balance)}, past your ${fmt(goal.targetAmount)} target. Set the next one?`}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[1.5, 2].map((k) => {
              const amt = Math.ceil((goal.targetAmount * k) / 1000) * 1000;
              return <button key={k} type="button" className="chip" onClick={() => setNextGoal(amt)}>{fmt(amt)}</button>;
            })}
            <Link href="/settings#goal" className="chip" style={{ textDecoration: "none" }}>Custom…</Link>
          </div>
        </Row>
      )}

      {toRate.map((m) => (
        <Row key={`m-${m.id}`} emoji="🍿" title={`How was ${m.title}?`} sub="Rate it while it's fresh — and add what you spent on snacks.">
          <button type="button" className="btn btn-primary" style={{ minHeight: 40, fontSize: 13.5 }} onClick={() => setRateTarget(m)}>Rate it</button>
        </Row>
      ))}

      {variableDue.map((r) => (
        <Row key={`v-${r.id}`} emoji="🧾" title={`How much was ${r.note || r.category} this month?`}
          sub={`Due on the ${ordinal(effectiveDayClient(r.day_of_month, today))}. Last time it was ${fmt(parseFloat(r.amount))}.`}>
          <AmountForm label={`${r.note || r.category} amount`} initial={parseFloat(r.amount)} cta="Log it" onSubmit={async (amount) => {
            await post({ type: "variable-bill", id: r.id, amount });
            showToast(`${r.note || r.category} · ${fmt(amount)} logged`, "🧾");
            notifyLedgerChanged();
          }} />
        </Row>
      ))}

      {unpaid.map((r) => (
        <Row key={`u-${r.id}`} emoji="💳" title={`Did you pay ${r.note || r.category}?`} sub={`${fmt(parseFloat(r.amount))} was due on the ${ordinal(effectiveDayClient(r.day_of_month, today))}.`}>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/pay?r=${r.id}`} className="btn btn-primary" style={{ textDecoration: "none", minHeight: 40, fontSize: 13.5, flex: 1 }}>Pay now</Link>
            <button type="button" className="btn btn-secondary" style={{ minHeight: 40, fontSize: 13.5, flex: 1 }} onClick={async () => {
              setHidden((h) => ({ ...h, [`bill-${r.id}`]: true }));
              try { await post({ type: "bill-paid", id: r.id, paid: true }); showToast("Marked paid", "✅"); } catch (e) { showToast(e.message, "⚠️"); }
            }}>Already paid</button>
          </div>
        </Row>
      ))}

      {estimates.map((x) => (
        <Row key={`e-${x.id}`} emoji="≈" title={`Final amount for ${x.note || x.category}?`} sub={`You logged about ${fmt(x.amount)} on ${new Date(x.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. Receipt? Add it from All transactions.`}>
          <AmountForm label="Final amount" initial={x.amount} cta="Confirm" onSubmit={async (amount) => {
            await post({ type: "finalize-expense", id: x.id, amount });
            setHidden((h) => ({ ...h, [`est-${x.id}`]: true }));
            showToast(amount === x.amount ? "Confirmed" : `Updated to ${fmt(amount)}`, "✅");
            notifyLedgerChanged();
          }} />
        </Row>
      ))}

      {checkin && (
        <Row emoji="🗓️" title={`${monthName(lastYm)} in one line`}
          sub={checkin.limit
            ? <>You spent <b>{fmt(checkin.spent)}</b> of your <b>{fmt(checkin.limit)}</b> limit — {checkin.spent <= checkin.limit ? <>{fmt(checkin.limit - checkin.spent)} under 🎉</> : <>{fmt(checkin.spent - checkin.limit)} over</>}. Keep the same limit for {monthName(ym)}?</>
            : <>You spent <b>{fmt(checkin.spent)}</b>. Want a monthly limit for {monthName(ym)}? Around {fmt(checkin.suggested)} fits how you spend.</>}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {checkin.limit ? (
              <button type="button" className="chip active" onClick={() => { lsSet(`checkin_${ym}`, "done"); setHidden((h) => ({ ...h, checkin: true })); showToast(`Keeping ${fmt(checkin.limit)}`, "👍"); }}>Keep {fmt(checkin.limit)}</button>
            ) : (
              <button type="button" className="chip active" onClick={async () => {
                try {
                  await post({ type: "budget", ruleType: "overall", amount: checkin.suggested });
                  lsSet(`checkin_${ym}`, "done");
                  showToast(`Limit set to ${fmt(checkin.suggested)}`, "🎯");
                  notifyLedgerChanged();
                } catch (e) { showToast(e.message, "⚠️"); }
              }}>Set {fmt(checkin.suggested)}</button>
            )}
            <Link href="/budget" className="chip" style={{ textDecoration: "none" }} onClick={() => lsSet(`checkin_${ym}`, "done")}>Change / jars</Link>
            <Link href="/wrapped" className="chip" style={{ textDecoration: "none" }}>See Wrapped</Link>
            <button type="button" className="chip" onClick={() => { lsSet(`checkin_${ym}`, "done"); setHidden((h) => ({ ...h, checkin: true })); }}>Dismiss</button>
          </div>
        </Row>
      )}

      {rateTarget && <RateMovieSheet movie={rateTarget} onClose={() => setRateTarget(null)} onSaved={() => notifyLedgerChanged()} />}
    </section>
  );
}
