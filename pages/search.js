"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Search as SearchIcon } from "lucide-react";

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export default function SearchPage() {
  const [expenses, setExpenses] = useState([]);
  const [movies, setMovies] = useState([]);
  const [dietDays, setDietDays] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/data?type=expenses"), fetch("/api/data?type=movies"), fetch("/api/data?type=challenge")])
      .then(async ([e, m, c]) => {
        if (e.ok) setExpenses((await e.json()).expenses.map((x) => ({
          id: x.id, type: "expense", amount: parseFloat(x.amount), category: x.category,
          note: x.note || "", date: x.expense_date.slice(0, 10),
        })));
        if (m.ok) setMovies((await m.json()).movies.map((m2) => ({
          id: m2.id, type: "movie", amount: (parseFloat(m2.ticket_price) + parseFloat(m2.canteen_price)) * (m2.quantity || 1),
          category: "Movies", note: m2.title, date: m2.watched_date.slice(0, 10),
        })));
        if (c.ok) {
          const days = (await c.json()).days || [];
          setDietDays(
            days
              .filter((d) => (d.note && d.note.trim()) || (d.reason && d.reason.trim()))
              .map((d) => ({
                id: d.day_date, type: "diet", amount: 0, category: "Diet",
                note: [d.completed === false ? "Slipped" : "Sugar-free", d.reason, d.note].filter(Boolean).join(" — "),
                date: d.day_date.slice(0, 10),
              }))
          );
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const allCategories = useMemo(() => {
    const set = new Set([...expenses.map((x) => x.category), ...(movies.length ? ["Movies"] : []), ...(dietDays.length ? ["Diet"] : [])]);
    return Array.from(set).sort();
  }, [expenses, movies, dietDays]);

  const results = useMemo(() => {
    const all = [...expenses, ...movies, ...dietDays];
    const q = query.trim().toLowerCase();
    return all
      .filter((x) => !q || x.note.toLowerCase().includes(q) || x.category.toLowerCase().includes(q))
      .filter((x) => !category || x.category === category)
      .filter((x) => !fromDate || x.date >= fromDate)
      .filter((x) => !toDate || x.date <= toDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [expenses, movies, dietDays, query, category, fromDate, toDate]);

  const total = results.reduce((s, x) => s + x.amount, 0);

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 28, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600 }}>Search</div>
        <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>Across every expense, movie, and diet note you've logged.</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, border: "1px solid #D9D2C2", borderRadius: 4, padding: "8px 12px" }}>
        <SearchIcon size={15} color="#8a8477" />
        <input
          type="text"
          placeholder="Search by note, title, or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ border: "none", padding: 0, flex: 1 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 150 }}>
          <option value="">All categories</option>
          {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 150 }} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 150 }} />
        {(query || category || fromDate || toDate) && (
          <button onClick={() => { setQuery(""); setCategory(""); setFromDate(""); setToDate(""); }} style={{ background: "#EAE5D9", border: "none", borderRadius: 3, padding: "8px 12px", fontSize: 12, cursor: "pointer" }}>
            Clear filters
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 12 }}>
        {results.length} result{results.length !== 1 ? "s" : ""} · <span className="tabnum">{fmt(total)}</span> total (money entries only)
      </div>

      {results.length === 0 ? (
        <div style={{ border: "1px dashed #D9D2C2", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "#8a8477", fontSize: 14 }}>
          Nothing matches. Try a different search or clear the filters.
        </div>
      ) : (
        <div>
          {results.map((x) => (
            <div key={`${x.type}-${x.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #EAE5D9" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{x.note || x.category}</div>
                <div style={{ fontSize: 11, color: "#8a8477" }}>
                  {new Date(x.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {x.category}
                  {x.type === "movie" && " · movie"}
                  {x.type === "diet" && " · diet"}
                </div>
              </div>
              {x.type !== "diet" && (
                <span className="tabnum" style={{ fontSize: 14, fontWeight: 500, flexShrink: 0 }}>{fmt(x.amount)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
