"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, AlertTriangle, TrendingUp, TrendingDown, Download } from "lucide-react";

const CATEGORIES = [
  { name: "Food", color: "#B5533C" }, { name: "Groceries", color: "#C98A2C" },
  { name: "Transport", color: "#3F6E5B" }, { name: "Bills", color: "#5B3A5C" },
  { name: "Rent", color: "#2F4858" }, { name: "Shopping", color: "#A3763F" },
  { name: "Health", color: "#6B7A3E" }, { name: "Entertainment", color: "#8A4B6B" },
  { name: "Other", color: "#6B6558" },
];
const MOVIE_CAT = "Movies";
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function ym(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default function ReportPage() {
  const [expenses, setExpenses] = useState([]);
  const [movies, setMovies] = useState([]);
  const [topups, setTopups] = useState([]);
  const [rules, setRules] = useState([]);
  const [challengeDays, setChallengeDays] = useState([]);
  const [challengeMeta, setChallengeMeta] = useState(null);
  const [customCategories, setCustomCategories] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Default to the most recently completed month, since a report about
  // the month still in progress isn't really "end of month" yet.
  const now = new Date();
  const defaultDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [viewDate, setViewDate] = useState(defaultDate);

  useEffect(() => {
    Promise.all([
      fetch("/api/data?type=expenses"),
      fetch("/api/data?type=movies"),
      fetch("/api/data?type=balance"),
      fetch("/api/data?type=budget"),
      fetch("/api/data?type=challenge"),
      fetch("/api/data?type=categories"),
    ]).then(async ([e, m, b, r, c, cat]) => {
      if (e.ok) setExpenses((await e.json()).expenses.map((x) => ({
        amount: parseFloat(x.amount), category: x.category, note: x.note || "", date: x.expense_date.slice(0, 10),
      })));
      if (m.ok) setMovies((await m.json()).movies.map((x) => ({
        title: x.title, date: x.watched_date.slice(0, 10),
        ticketPrice: parseFloat(x.ticket_price), canteenPrice: parseFloat(x.canteen_price),
        quantity: x.quantity || 1, myTake: x.my_take, publicTake: x.public_take,
        venueType: x.venue_type, venueName: x.venue_name, companions: x.companions || "",
      })));
      if (b.ok) setTopups((await b.json()).topups.map((t) => ({ amount: parseFloat(t.amount), date: t.topup_date.slice(0, 10), mode: t.mode })));
      if (r.ok) setRules((await r.json()).rules.map((x) => ({ ruleType: x.rule_type, category: x.category, amount: parseFloat(x.amount) })));
      if (c.ok) {
        const d = await c.json();
        setChallengeMeta(d.meta);
        setChallengeDays((d.days || []).map((x) => ({ date: x.day_date.slice(0, 10), completed: x.completed })));
      }
      if (cat.ok) setCustomCategories((await cat.json()).categories || []);
    }).finally(() => setLoaded(true));
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const targetYM = ym(year, month);
  const lastYM = ym(new Date(year, month - 1, 1).getFullYear(), new Date(year, month - 1, 1).getMonth());

  const monthExpenses = useMemo(() => expenses.filter((x) => x.date.slice(0, 7) === targetYM), [expenses, targetYM]);
  const monthMovies = useMemo(() => movies.filter((m) => m.date.slice(0, 7) === targetYM), [movies, targetYM]);
  const lastMonthExpenses = useMemo(() => expenses.filter((x) => x.date.slice(0, 7) === lastYM), [expenses, lastYM]);
  const lastMonthMovies = useMemo(() => movies.filter((m) => m.date.slice(0, 7) === lastYM), [movies, lastYM]);

  const movieSpend = (m) => (m.ticketPrice + m.canteenPrice) * m.quantity;

  const totalExpenseSpend = monthExpenses.reduce((s, x) => s + x.amount, 0);
  const totalMovieSpend = monthMovies.reduce((s, m) => s + movieSpend(m), 0);
  const totalSpend = totalExpenseSpend + totalMovieSpend;

  const lastTotalSpend = lastMonthExpenses.reduce((s, x) => s + x.amount, 0) + lastMonthMovies.reduce((s, m) => s + movieSpend(m), 0);
  const spendChangePct = lastTotalSpend > 0 ? Math.round(((totalSpend - lastTotalSpend) / lastTotalSpend) * 100) : null;

  const allCategories = [...CATEGORIES, ...customCategories];
  const byCategory = useMemo(() => {
    const map = {};
    for (const c of allCategories) map[c.name] = 0;
    map[MOVIE_CAT] = totalMovieSpend;
    for (const x of monthExpenses) map[x.category] = (map[x.category] || 0) + x.amount;
    return Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }, [monthExpenses, totalMovieSpend, customCategories]);

  const monthAdded = topups.filter((t) => t.mode === "add" && t.date.slice(0, 7) === targetYM).reduce((s, t) => s + t.amount, 0);
  const netChange = monthAdded - totalSpend;

  // Budget rules performance
  const overallRule = rules.find((r) => r.ruleType === "overall");
  const categoryRules = rules.filter((r) => r.ruleType === "category");
  const overallBroken = overallRule && totalSpend > overallRule.amount;
  const brokenCategories = categoryRules
    .map((r) => ({ ...r, spent: byCategory.find(([n]) => n === r.category)?.[1] || 0 }))
    .filter((r) => r.spent > r.amount);

  // Diet
  const monthChallengeDays = challengeDays.filter((d) => d.date.slice(0, 7) === targetYM);
  const completedDays = monthChallengeDays.filter((d) => d.completed === true).length;
  const slippedDays = monthChallengeDays.filter((d) => d.completed === false).length;

  // Movies
  const totalViewings = monthMovies.reduce((s, m) => s + m.quantity, 0);
  const matchedTaste = monthMovies.filter((m) => m.myTake === m.publicTake).length;

  // "Worth a look" — wastage/attention flags
  const otherExpenses = monthExpenses.filter((x) => x.category === "Other");
  const biggestExpenses = useMemo(() => [...monthExpenses].sort((a, b) => b.amount - a.amount).slice(0, 3), [monthExpenses]);
  const rewatches = monthMovies.filter((m) => m.quantity > 1);

  function goMonth(delta) {
    setViewDate(new Date(year, month + delta, 1));
  }

  // One-tap CSV of everything logged this month — expenses and movies,
  // in date order, for keeping outside the app or sharing.
  function downloadCsv() {
    const dataRows = [
      ...monthExpenses.map((x) => [x.date, "Expense", x.category, x.note || "", x.amount]),
      ...monthMovies.map((m) => [m.date, "Movie", "Movies", m.title, movieSpend(m)]),
    ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const rows = [["Date", "Type", "Category", "Description", "Amount"], ...dataRows];
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${targetYM}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!loaded) {
    return <div className="loading-screen"><div className="app-spinner" /> Building your report…</div>;
  }

  const hasAnyData = monthExpenses.length > 0 || monthMovies.length > 0 || monthChallengeDays.length > 0;

  return (
    <div className="page-container" style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 28, borderBottom: "1px solid #D9D2C2", paddingBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
            <ArrowLeft size={12} /> Expense ledger
          </a>
          <div className="lora" style={{ fontSize: 24, fontWeight: 600 }}>Monthly Report</div>
          <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>Money, movies, and diet — one end-of-month picture.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <button onClick={() => goMonth(-1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }}><ChevronLeft size={18} /></button>
          <div className="tabnum" style={{ fontSize: 14, fontWeight: 500, minWidth: 130, textAlign: "center" }}>{MONTH_NAMES[month]} {year}</div>
          <button onClick={() => goMonth(1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }}><ChevronRight size={18} /></button>
          {hasAnyData && (
            <button onClick={downloadCsv} style={{ background: "none", border: "1px solid #D9D2C2", borderRadius: 20, padding: "6px 12px", fontSize: 12, color: "#5f5a4f", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginLeft: 6 }}>
              <Download size={13} /> CSV
            </button>
          )}
        </div>
      </div>

      {!hasAnyData ? (
        <div style={{ border: "1px dashed #D9D2C2", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "#8a8477", fontSize: 14 }}>
          Nothing logged for {MONTH_NAMES[month]} {year} yet.
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="panel-soft" style={{ background: "#F1ECDF", borderRadius: 6, padding: "20px 22px", marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Total spent, money + movies</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div className="lora tabnum" style={{ fontSize: "clamp(30px, 8vw, 40px)", fontWeight: 600, lineHeight: 1 }}>{fmt(totalSpend)}</div>
              {spendChangePct !== null && (
                <div style={{ fontSize: 13, color: spendChangePct > 0 ? "#A34A38" : "#2F6F5E", display: "flex", alignItems: "center", gap: 4, paddingBottom: 6 }}>
                  {spendChangePct > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {Math.abs(spendChangePct)}% vs {MONTH_NAMES[new Date(year, month - 1, 1).getMonth()]}
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#5f5a4f", marginTop: 10 }}>
              {fmt(monthAdded)} added · net {netChange >= 0 ? "+" : ""}{fmt(netChange)} this month
            </div>
          </div>

          {/* By category */}
          {byCategory.length > 0 && (
            <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "18px 20px", marginBottom: 20 }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Where it went</div>
              {byCategory.map(([name, value]) => {
                const color = name === MOVIE_CAT ? "#7A3E56" : allCategories.find((c) => c.name === name)?.color || "#6B6558";
                const pct = totalSpend > 0 ? (value / totalSpend) * 100 : 0;
                return (
                  <div key={name} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span>{name}</span>
                      <span className="tabnum">{fmt(value)} · {Math.round(pct)}%</span>
                    </div>
                    <div style={{ height: 6, background: "#EAE5D9", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Money rules performance */}
          {(overallRule || categoryRules.length > 0) && (
            <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "18px 20px", marginBottom: 20 }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Money rules</div>
              {overallRule && (
                <div style={{ fontSize: 13, color: overallBroken ? "#A34A38" : "#2F6F5E", marginBottom: 6 }}>
                  {overallBroken ? `Over your overall limit by ${fmt(totalSpend - overallRule.amount)}` : `Stayed within your overall limit (${fmt(overallRule.amount)})`}
                </div>
              )}
              {categoryRules.length > 0 && (
                <div style={{ fontSize: 13, color: brokenCategories.length > 0 ? "#A34A38" : "#2F6F5E" }}>
                  {brokenCategories.length === 0
                    ? `Kept all ${categoryRules.length} category limit${categoryRules.length !== 1 ? "s" : ""}`
                    : `Broke ${brokenCategories.length} of ${categoryRules.length} category limits: ${brokenCategories.map((r) => `${r.category} (+${fmt(r.spent - r.amount)})`).join(", ")}`}
                </div>
              )}
            </div>
          )}

          {/* Movies summary */}
          {monthMovies.length > 0 && (
            <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "18px 20px", marginBottom: 20 }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Movies</div>
              <div style={{ fontSize: 13, color: "#5f5a4f", lineHeight: 1.8 }}>
                <div><span className="tabnum">{totalViewings}</span> viewing{totalViewings !== 1 ? "s" : ""} · <span className="tabnum">{fmt(totalMovieSpend)}</span> spent{rewatches.length > 0 && <> · {rewatches.length} rewatched</>}</div>
                <div>Agreed with the public on <span className="tabnum">{monthMovies.length > 0 ? Math.round((matchedTaste / monthMovies.length) * 100) : 0}%</span> of what you watched</div>
              </div>
            </div>
          )}

          {/* Diet summary */}
          {monthChallengeDays.length > 0 && (
            <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "18px 20px", marginBottom: 20 }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>No-Sugar Challenge</div>
              <div style={{ fontSize: 13, color: "#5f5a4f" }}>
                <span className="tabnum" style={{ color: "#2F6F5E", fontWeight: 600 }}>{completedDays}</span> sugar-free day{completedDays !== 1 ? "s" : ""}
                {slippedDays > 0 && <> · <span className="tabnum" style={{ color: "#A34A38" }}>{slippedDays}</span> slip{slippedDays !== 1 ? "s" : ""}</>}
              </div>
            </div>
          )}

          {/* Worth a look — wastage / attention flags */}
          {(brokenCategories.length > 0 || otherExpenses.length > 0 || biggestExpenses.length > 0) && (
            <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "18px 20px" }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={15} color="#A3763F" /> Worth a look
              </div>

              {biggestExpenses.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 6 }}>Your biggest single expenses this month</div>
                  {biggestExpenses.map((x, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                      <span>{x.note || x.category}</span>
                      <span className="tabnum">{fmt(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {otherExpenses.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 6 }}>
                    Logged as "Other" — <span className="tabnum">{fmt(otherExpenses.reduce((s, x) => s + x.amount, 0))}</span> total, worth a second look since these didn't fit anywhere specific
                  </div>
                  {otherExpenses.slice(0, 5).map((x, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                      <span>{x.note}</span>
                      <span className="tabnum">{fmt(x.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {rewatches.length > 0 && (
                <div style={{ fontSize: 12, color: "#8a8477" }}>
                  {rewatches.length} movie{rewatches.length !== 1 ? "s" : ""} rewatched this month — {rewatches.map((m) => `${m.title} (×${m.quantity})`).join(", ")}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
