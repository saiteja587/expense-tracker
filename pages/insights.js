// Insights tab: this month vs last, where the money went, plain-language
// observations, and the money × movies × diet patterns. Links out to the
// monthly report, year view and Wrapped.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileText, CalendarRange, Sparkles } from "lucide-react";
import { useLedger } from "../lib/useLedger";
import { itemsInMonth, byCategory, ymOf, compareToUsual } from "../lib/ledger";
import { generateInsights, prevMonth } from "../lib/insights";
import { fmt, todayISO } from "../lib/format";
import PatternsSection from "../components/PatternsSection";

const monthName = (ym) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default function InsightsPage() {
  const { data, derived, today, loaded } = useLedger();
  const [ym, setYm] = useState(() => ymOf(todayISO()));

  const view = useMemo(() => {
    if (!derived) return null;
    const spent = derived.items.filter((x) => !x.isRecurringPending || x.date <= today);
    const now = itemsInMonth(spent, ym);
    const last = itemsInMonth(spent, prevMonth(ym));
    const total = now.reduce((s, x) => s + x.amount, 0);
    const lastTotal = last.reduce((s, x) => s + x.amount, 0);
    const cats = byCategory(now, data.customCategories);
    const lastCats = Object.fromEntries(byCategory(last, data.customCategories).map((c) => [c.name, c.value]));
    const days = new Set(now.map((x) => x.date)).size;
    return { total, lastTotal, cats, lastCats, days, cmp: compareToUsual(total, lastTotal) };
  }, [derived, data, ym, today]);

  const insights = useMemo(
    () => (derived ? generateInsights({ items: derived.items, movies: data.movies, todayIso: today }) : []),
    [derived, data, today]
  );

  if (!loaded || !view) {
    return (
      <div className="page-container" style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 100px" }}>
        <div className="skeleton" style={{ height: 28, width: 140, marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 20, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 20 }} />
      </div>
    );
  }

  const isCurrent = ym === ymOf(today);
  const top = view.cats[0]?.value || 1;

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 100px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Insights</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}>
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setYm(prevMonth(ym))}><ChevronLeft size={20} /></button>
          <div style={{ fontWeight: 600, minWidth: 150, textAlign: "center" }}>{monthName(ym)}</div>
          <button type="button" className="icon-btn" aria-label="Next month" disabled={isCurrent} onClick={() => setYm(nextMonth(ym))}><ChevronRight size={20} /></button>
        </div>
      </header>

      <div className="card" style={{ padding: 18, borderRadius: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{isCurrent ? "Spent so far" : "Spent"}</div>
        <div className="lora tabnum" style={{ fontSize: 34, fontWeight: 700 }}>{fmt(view.total)}</div>
        <div style={{ fontSize: 13, color: "var(--text-2)" }}>
          {view.lastTotal > 0 ? (
            view.cmp.kind === "pct"
              ? <><b style={{ color: view.cmp.up ? "var(--danger)" : "var(--success)" }}>{view.cmp.up ? "▲" : "▼"} {Math.abs(view.cmp.pct)}%</b> vs {fmt(view.lastTotal)} last month{isCurrent ? " (whole month)" : ""}</>
              : <>{view.cmp.up ? "+" : "−"}{fmt(Math.abs(view.cmp.diff))} vs last month</>
          ) : "No spending logged the month before."}
          {" · "}{view.days} day{view.days !== 1 ? "s" : ""} with spending
        </div>
      </div>

      {insights.length > 0 && isCurrent && (
        <section aria-label="Observations" style={{ marginBottom: 16 }}>
          <h2 className="section-title">What stands out</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {insights.map((i) => (
              <div key={i.id} className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", borderRadius: 16 }}>
                <span style={{ fontSize: 22 }} aria-hidden="true">{i.emoji}</span>
                <div style={{ fontSize: 14, lineHeight: 1.45, color: i.tone === "warn" ? "var(--danger)" : "var(--ink)" }}>{i.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-label="By category" className="card" style={{ padding: 18, borderRadius: 20, marginBottom: 16 }}>
        <h2 className="section-title">Where it went</h2>
        {view.cats.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>Nothing logged this month.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {view.cats.map((c) => {
              const prev = view.lastCats[c.name] || 0;
              return (
                <div key={c.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 5, gap: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ width: 9, height: 9, borderRadius: 5, background: c.color }} />{c.name}</span>
                    <span className="tabnum" style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>
                      {fmt(c.value)} <span style={{ color: "var(--muted)", fontSize: 12 }}>{Math.round((c.value / view.total) * 100)}%</span>
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 5, background: "var(--line)", overflow: "hidden" }}>
                    <div className="bar-grow" style={{ width: `${(c.value / top) * 100}%`, height: "100%", background: c.color, borderRadius: 5 }} />
                  </div>
                  {prev > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{fmt(prev)} last month</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 8 }}>
        {[
          { href: "/wrapped", label: "Wrapped", Icon: Sparkles },
          { href: "/report", label: "Monthly report", Icon: FileText },
          { href: "/year", label: "Year view", Icon: CalendarRange },
        ].map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="card" style={{ textDecoration: "none", color: "var(--ink)", padding: "14px 10px", borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, textAlign: "center" }}>
            <Icon size={20} color="var(--accent-solid)" /> {label}
          </Link>
        ))}
      </div>

      <PatternsSection />
    </div>
  );
}
