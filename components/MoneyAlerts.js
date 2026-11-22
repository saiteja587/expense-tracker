// Home's money heads-ups: a card bill due soon (or overdue), spending that's
// far above your usual day, and the month-end forecast against your budget.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cardCycle, unusualSpend, monthForecast, isCard } from "../lib/money";
import { categoryEmoji } from "../lib/categories";
import { fmt } from "../lib/format";

function Alert({ href, emoji, tone, children }) {
  const bg = tone === "bad" ? "var(--danger-bg)" : tone === "warn" ? "var(--warn-bg)" : "var(--surface)";
  const body = (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderRadius: 18, marginBottom: 10, background: bg }}>
      <span style={{ fontSize: 22 }} aria-hidden="true">{emoji}</span>
      <div style={{ fontSize: 14, lineHeight: 1.4, flex: 1 }}>{children}</div>
      {href && <ChevronRight size={18} color="var(--muted)" />}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{body}</Link> : body;
}

export default function MoneyAlerts({ data, derived, budget, today }) {
  const cards = (data.accounts || []).filter((a) => isCard(a) && !a.archived)
    .map((c) => ({ c, cy: cardCycle(c, data.expenses, data.transfers || [], today) }))
    .filter(({ cy }) => cy.hasCycle && cy.billedDue > 0 && cy.daysToDue <= 5);
  const unusual = unusualSpend(derived.items, today).slice(0, 1);
  const fc = monthForecast(budget, data.rules);
  const showForecast = fc.ready && fc.limit > 0 && fc.over > 0;

  if (!cards.length && !unusual.length && !showForecast) return null;
  return (
    <div>
      {cards.map(({ c, cy }) => (
        <Alert key={c.id} href="/accounts" emoji="💳" tone={cy.daysToDue < 0 ? "bad" : "warn"}>
          <b>{c.name}</b>: {fmt(cy.billedDue)} {cy.daysToDue < 0 ? `overdue by ${-cy.daysToDue} day${cy.daysToDue === -1 ? "" : "s"}` : cy.daysToDue === 0 ? "due today" : cy.daysToDue === 1 ? "due tomorrow" : `due in ${cy.daysToDue} days`}
        </Alert>
      ))}
      {unusual.map((u) => (
        <Alert key={u.category} href="/transactions" emoji={categoryEmoji(u.category, data.customCategories)} tone="warn">
          {fmt(u.today)} on {u.category} today, {u.times}× your usual {fmt(u.usual)} day.
        </Alert>
      ))}
      {showForecast && (
        <Alert href="/budget" emoji="🔮" tone="warn">
          At this pace you&apos;ll spend about <b>{fmt(fc.projected)}</b> this month, {fmt(fc.over)} over your {fmt(fc.limit)} budget.
        </Alert>
      )}
    </div>
  );
}
