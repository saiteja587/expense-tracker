"use client";

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { Plus, Trash2, ChevronLeft, ChevronRight, Wallet } from "lucide-react";

const CATEGORIES = [
  { name: "Food", color: "#B5533C" },
  { name: "Groceries", color: "#C98A2C" },
  { name: "Transport", color: "#3F6E5B" },
  { name: "Bills", color: "#5B3A5C" },
  { name: "Rent", color: "#2F4858" },
  { name: "Shopping", color: "#A3763F" },
  { name: "Health", color: "#6B7A3E" },
  { name: "Entertainment", color: "#8A4B6B" },
  { name: "Other", color: "#6B6558" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

export default function Page() {
  const [expenses, setExpenses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].name);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());

  async function load() {
    try {
      const res = await fetch("/api/expenses");
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setExpenses(
        data.expenses.map((x) => ({
          id: x.id,
          amount: parseFloat(x.amount),
          category: x.category,
          note: x.note || "",
          date: x.expense_date.slice(0, 10),
        }))
      );
      setLoadError("");
    } catch (err) {
      setLoadError("Couldn't load your expenses. Check the database connection and refresh.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addExpense(e) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setFormError("Enter an amount greater than 0");
      return;
    }
    if (!date) {
      setFormError("Pick a date");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, category, note: note.trim(), date }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setAmount("");
      setNote("");
      await load();
    } catch (err) {
      setFormError(err.message || "Couldn't save that expense. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeExpense(id) {
    const prev = expenses;
    setExpenses(expenses.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setExpenses(prev);
      setLoadError("Couldn't delete that entry. Try again.");
    }
  }

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthExpenses = useMemo(() => {
    return expenses.filter((x) => {
      const d = new Date(x.date + "T00:00:00");
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [expenses, year, month]);

  const total = monthExpenses.reduce((s, x) => s + x.amount, 0);

  const lastMonthDate = new Date(year, month - 1, 1);
  const lastMonthTotal = useMemo(() => {
    return expenses
      .filter((x) => {
        const d = new Date(x.date + "T00:00:00");
        return d.getFullYear() === lastMonthDate.getFullYear() && d.getMonth() === lastMonthDate.getMonth();
      })
      .reduce((s, x) => s + x.amount, 0);
  }, [expenses, year, month]);

  const diff = lastMonthTotal > 0 ? ((total - lastMonthTotal) / lastMonthTotal) * 100 : null;

  const byCategory = useMemo(() => {
    const map = {};
    for (const c of CATEGORIES) map[c.name] = 0;
    for (const x of monthExpenses) map[x.category] = (map[x.category] || 0) + x.amount;
    return CATEGORIES.map((c) => ({ name: c.name, value: map[c.name], color: c.color }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [monthExpenses]);

  const grouped = useMemo(() => {
    const sorted = [...monthExpenses].sort((a, b) => (a.date < b.date ? 1 : -1));
    const map = new Map();
    for (const x of sorted) {
      if (!map.has(x.date)) map.set(x.date, []);
      map.get(x.date).push(x);
    }
    return Array.from(map.entries());
  }, [monthExpenses]);

  function formatDateLabel(iso) {
    const d = new Date(iso + "T00:00:00");
    if (iso === todayISO()) return "Today";
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }

  function catColor(name) {
    return CATEGORIES.find((c) => c.name === name)?.color || "#6B6558";
  }

  if (!loaded) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>
        Loading your ledger…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
      {loadError && (
        <div style={{ background: "#FAECE7", border: "1px solid #D85A30", color: "#712B13", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 32, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <div>
          <div className="lora" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Expense Ledger
          </div>
          <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>
            Track where your money goes, one entry at a time.
          </div>
          <a href="/movies" style={{ fontSize: 12, color: "#A34A38", textDecoration: "none", display: "inline-block", marginTop: 6 }}>
            Movie nights →
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }}
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="tabnum" style={{ fontSize: 14, fontWeight: 500, minWidth: 130, textAlign: "center" }}>
            {MONTH_NAMES[month]} {year}
          </div>
          <button
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }}
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Hero total */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginBottom: 40, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Spent in {MONTH_NAMES[month]}</div>
          <div className="lora tabnum" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1 }}>
            {fmt(total)}
          </div>
        </div>
        {diff !== null && (
          <div style={{ fontSize: 13, color: diff > 0 ? "#A34A38" : "#2F6F5E", paddingBottom: 8 }}>
            {diff > 0 ? "↑" : "↓"} {Math.abs(Math.round(diff))}% vs {MONTH_NAMES[lastMonthDate.getMonth()]}
            <span style={{ color: "#8a8477" }}> ({fmt(lastMonthTotal)})</span>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 40 }}>
        {/* Left: add form + category breakdown */}
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Add an expense
          </div>
          <form onSubmit={addExpense} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="number"
              inputMode="decimal"
              placeholder="Amount (₹)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="0"
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={80}
            />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
            {formError && <div style={{ fontSize: 12, color: "#A34A38" }}>{formError}</div>}
            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 4,
                background: "#241F1A",
                color: "#FBF8F2",
                border: "none",
                borderRadius: 3,
                padding: "10px 14px",
                fontSize: 14,
                fontWeight: 500,
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Plus size={16} /> {submitting ? "Saving…" : "Add expense"}
            </button>
          </form>

          {byCategory.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                By category
              </div>
              <div style={{ height: Math.max(byCategory.length * 34, 60) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCategory} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={90} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#5f5a4f" }} />
                    <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={14}>
                      {byCategory.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {byCategory.map((c) => (
                  <div key={c.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#5f5a4f" }}>
                    <span>{c.name}</span>
                    <span className="tabnum">{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: transaction list */}
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Transactions
          </div>
          {grouped.length === 0 ? (
            <div style={{ border: "1px dashed #D9D2C2", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "#8a8477", fontSize: 14 }}>
              <Wallet size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>Nothing logged for {MONTH_NAMES[month]} yet.</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>Add your first expense on the left.</div>
            </div>
          ) : (
            <div>
              {grouped.map(([dateKey, items]) => (
                <div key={dateKey} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                    <span>{formatDateLabel(dateKey)}</span>
                    <span className="tabnum">{fmt(items.reduce((s, x) => s + x.amount, 0))}</span>
                  </div>
                  <div style={{ borderTop: "1px solid #EAE5D9" }}>
                    {items.map((x) => (
                      <div key={x.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #EAE5D9", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor(x.category), flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {x.note || x.category}
                            </div>
                            {x.note && <div style={{ fontSize: 12, color: "#8a8477" }}>{x.category}</div>}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                          <span className="tabnum" style={{ fontSize: 14, fontWeight: 500 }}>{fmt(x.amount)}</span>
                          <button
                            onClick={() => removeExpense(x.id)}
                            aria-label="Delete"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 4, display: "flex" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "#A34A38")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
