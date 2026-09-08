import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Wallet, X, Clock } from "lucide-react";

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

const MOVIE_CATEGORY = { name: "Movies", color: "#7A3E56" };

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

const emptyExpenseForm = { amount: "", category: CATEGORIES[0].name, note: "", date: todayISO(), time: "", affectsBalance: true };
const emptyTopupForm = { amount: "", note: "", date: todayISO(), mode: "add" };

export default function Page() {
  const [expenses, setExpenses] = useState([]);
  const [movies, setMovies] = useState([]);
  const [topups, setTopups] = useState([]);
  const [budgetRules, setBudgetRules] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [viewDate, setViewDate] = useState(new Date());

  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [showTopup, setShowTopup] = useState(false);
  const [topupForm, setTopupForm] = useState(emptyTopupForm);
  const [editingTopupId, setEditingTopupId] = useState(null);
  const [topupError, setTopupError] = useState("");
  const [topupSubmitting, setTopupSubmitting] = useState(false);

  async function load() {
    try {
      const [expRes, movRes, balRes, ruleRes] = await Promise.all([
        fetch("/api/data?type=expenses"),
        fetch("/api/data?type=movies"),
        fetch("/api/data?type=balance"),
        fetch("/api/data?type=budget"),
      ]);
      if (!expRes.ok) throw new Error("Request failed");
      const expData = await expRes.json();
      setExpenses(
        expData.expenses.map((x) => ({
          id: x.id,
          amount: parseFloat(x.amount),
          category: x.category,
          note: x.note || "",
          date: x.expense_date.slice(0, 10),
          time: x.expense_time ? x.expense_time.slice(0, 5) : "",
          affectsBalance: x.affects_balance !== false,
        }))
      );
      if (movRes.ok) {
        const movData = await movRes.json();
        setMovies(
          movData.movies.map((m) => ({
            id: m.id,
            title: m.title,
            date: m.watched_date.slice(0, 10),
            ticketPrice: parseFloat(m.ticket_price),
            canteenPrice: parseFloat(m.canteen_price),
            affectsBalance: m.affects_balance !== false,
            quantity: m.quantity || 1,
          }))
        );
      }
      if (balRes.ok) {
        const balData = await balRes.json();
        setTopups(
          balData.topups.map((t) => ({
            id: t.id,
            amount: parseFloat(t.amount),
            note: t.note || "",
            date: t.topup_date.slice(0, 10),
            mode: t.mode === "set" ? "set" : "add",
            createdAt: t.created_at,
          }))
        );
      }
      if (ruleRes.ok) {
        const ruleData = await ruleRes.json();
        setBudgetRules(ruleData.rules.map((r) => ({ id: r.id, ruleType: r.rule_type, category: r.category, amount: parseFloat(r.amount) })));
      }
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

  const movieItems = useMemo(() => {
    const items = [];
    for (const m of movies) {
      const qty = m.quantity || 1;
      const qtyLabel = qty > 1 ? ` ×${qty}` : "";
      if (m.ticketPrice > 0) {
        items.push({ id: `movie-${m.id}-ticket`, amount: m.ticketPrice * qty, category: MOVIE_CATEGORY.name, note: `${m.title} (ticket${qtyLabel})`, date: m.date, affectsBalance: m.affectsBalance });
      }
      if (m.canteenPrice > 0) {
        items.push({ id: `movie-${m.id}-canteen`, amount: m.canteenPrice * qty, category: MOVIE_CATEGORY.name, note: `${m.title} (canteen${qtyLabel})`, date: m.date, affectsBalance: m.affectsBalance });
      }
    }
    return items;
  }, [movies]);

  const allItems = useMemo(() => [...expenses, ...movieItems], [expenses, movieItems]);

  // Balance: expenses/movies dated in the future (e.g. an EMI you logged ahead of
  // time) don't reduce the balance until their date actually arrives. They still
  // show up in the "Upcoming" total below so you can plan for them.
  const today = todayISO();

  // If a "set current balance" top-up exists, it becomes the baseline: everything
  // before its date is ignored (the amount you typed already accounts for it),
  // and only additions/spend after that date apply on top.
  const baselineTopup = useMemo(() => {
    const setTopups = topups.filter((t) => t.mode === "set");
    if (setTopups.length === 0) return null;
    return [...setTopups].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })[0];
  }, [topups]);

  const balanceCalc = useMemo(() => {
    if (baselineTopup) {
      const afterAdds = topups
        .filter((t) => t.mode === "add" && t.date > baselineTopup.date)
        .reduce((s, t) => s + t.amount, 0);
      const spentAfter = allItems
        .filter((x) => x.affectsBalance !== false && x.date > baselineTopup.date && x.date <= today)
        .reduce((s, x) => s + x.amount, 0);
      return {
        balance: baselineTopup.amount + afterAdds - spentAfter,
        addedLabel: `${fmt(baselineTopup.amount)} set on ${new Date(baselineTopup.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${afterAdds > 0 ? ` + ${fmt(afterAdds)} added` : ""}`,
        spentLabel: fmt(spentAfter),
      };
    }
    const totalAdded = topups.filter((t) => t.mode === "add").reduce((s, t) => s + t.amount, 0);
    const totalSpent = allItems.filter((x) => x.affectsBalance !== false && x.date <= today).reduce((s, x) => s + x.amount, 0);
    return { balance: totalAdded - totalSpent, addedLabel: `${fmt(totalAdded)} added`, spentLabel: fmt(totalSpent) };
  }, [topups, allItems, baselineTopup, today]);

  function startEditExpense(x) {
    setEditingExpenseId(x.id);
    setExpenseForm({ amount: String(x.amount), category: x.category, note: x.note, date: x.date, time: x.time || "", affectsBalance: x.affectsBalance !== false });
    setFormError("");
  }

  function cancelEditExpense() {
    setEditingExpenseId(null);
    setExpenseForm(emptyExpenseForm);
    setFormError("");
  }

  async function submitExpense(e) {
    e.preventDefault();
    const amt = parseFloat(expenseForm.amount);
    if (!expenseForm.amount || isNaN(amt) || amt <= 0) {
      setFormError("Enter an amount greater than 0");
      return;
    }
    if (!expenseForm.date) {
      setFormError("Pick a date");
      return;
    }
    if (expenseForm.category === "Other" && !expenseForm.note.trim()) {
      setFormError("Add a reason for this Other expense");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const isEdit = editingExpenseId !== null;
      const res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expenses",
          ...(isEdit ? { id: editingExpenseId } : {}),
          amount: amt,
          category: expenseForm.category,
          note: expenseForm.note.trim(),
          date: expenseForm.date,
          time: expenseForm.time,
          affectsBalance: expenseForm.affectsBalance,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      cancelEditExpense();
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
      const res = await fetch(`/api/data?type=expenses&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setExpenses(prev);
      setLoadError("Couldn't delete that entry. Try again.");
    }
  }

  function startEditTopup(t) {
    setEditingTopupId(t.id);
    setTopupForm({ amount: String(t.amount), note: t.note, date: t.date, mode: t.mode });
    setShowTopup(true);
    setTopupError("");
  }

  function cancelEditTopup() {
    setEditingTopupId(null);
    setTopupForm(emptyTopupForm);
    setShowTopup(false);
    setTopupError("");
  }

  async function submitTopup(e) {
    e.preventDefault();
    const amt = parseFloat(topupForm.amount);
    if (!topupForm.amount || isNaN(amt) || amt <= 0) {
      setTopupError("Enter an amount greater than 0");
      return;
    }
    if (!topupForm.date) {
      setTopupError("Pick a date");
      return;
    }
    setTopupError("");
    setTopupSubmitting(true);
    try {
      const isEdit = editingTopupId !== null;
      const res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "balance", ...(isEdit ? { id: editingTopupId } : {}), amount: amt, note: topupForm.note.trim(), date: topupForm.date, mode: topupForm.mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      cancelEditTopup();
      await load();
    } catch (err) {
      setTopupError(err.message || "Couldn't save that. Try again.");
    } finally {
      setTopupSubmitting(false);
    }
  }

  async function removeTopup(id) {
    const prev = topups;
    setTopups(topups.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/data?type=balance&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setTopups(prev);
      setLoadError("Couldn't remove that top-up. Try again.");
    }
  }

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthItems = useMemo(() => {
    return allItems.filter((x) => {
      const d = new Date(x.date + "T00:00:00");
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [allItems, year, month]);

  const spentSoFar = monthItems.filter((x) => x.date <= today).reduce((s, x) => s + x.amount, 0);
  const upcomingItems = useMemo(() => monthItems.filter((x) => x.date > today), [monthItems, today]);
  const upcomingTotal = upcomingItems.reduce((s, x) => s + x.amount, 0);
  const total = spentSoFar + upcomingTotal;

  const lastMonthDate = new Date(year, month - 1, 1);
  const lastMonthTotal = useMemo(() => {
    return allItems
      .filter((x) => {
        const d = new Date(x.date + "T00:00:00");
        return d.getFullYear() === lastMonthDate.getFullYear() && d.getMonth() === lastMonthDate.getMonth();
      })
      .reduce((s, x) => s + x.amount, 0);
  }, [allItems, year, month]);

  const diff = lastMonthTotal > 0 ? ((spentSoFar - lastMonthTotal) / lastMonthTotal) * 100 : null;

  const byCategory = useMemo(() => {
    const map = {};
    for (const c of CATEGORIES) map[c.name] = 0;
    map[MOVIE_CATEGORY.name] = 0;
    for (const x of monthItems) map[x.category] = (map[x.category] || 0) + x.amount;
    return [...CATEGORIES, MOVIE_CATEGORY]
      .map((c) => ({ name: c.name, value: map[c.name], color: c.color }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [monthItems]);

  const overallRule = budgetRules.find((r) => r.ruleType === "overall");
  const categoryRuleMap = useMemo(() => {
    const map = {};
    for (const r of budgetRules) if (r.ruleType === "category") map[r.category] = r.amount;
    return map;
  }, [budgetRules]);
  const categoryBreaches = byCategory.filter((c) => categoryRuleMap[c.name] && c.value > categoryRuleMap[c.name]);
  const overallBreach = overallRule && spentSoFar > overallRule.amount;

  const grouped = useMemo(() => {
    const sorted = [...monthItems].sort((a, b) => (a.date < b.date ? 1 : -1));
    const map = new Map();
    for (const x of sorted) {
      if (!map.has(x.date)) map.set(x.date, []);
      map.get(x.date).push(x);
    }
    return Array.from(map.entries());
  }, [monthItems]);

  function formatDateLabel(iso) {
    const d = new Date(iso + "T00:00:00");
    if (iso === today) return "Today";
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }

  function catColor(name) {
    if (name === MOVIE_CATEGORY.name) return MOVIE_CATEGORY.color;
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
    <div className="page-container" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
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
          <a href="/movies" style={{ fontSize: 12, color: "#A34A38", textDecoration: "none", display: "inline-block", marginTop: 6, marginRight: 14 }}>
            Movie nights →
          </a>
          <a href="/budget" style={{ fontSize: 12, color: "#A34A38", textDecoration: "none", display: "inline-block", marginTop: 6, marginRight: 14 }}>
            Money rules →
          </a>
          <a href="/sugar-challenge" style={{ fontSize: 12, color: "#A34A38", textDecoration: "none", display: "inline-block", marginTop: 6 }}>
            No-sugar challenge →
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setViewDate(new Date(year, month - 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <div className="tabnum" style={{ fontSize: 14, fontWeight: 500, minWidth: 130, textAlign: "center" }}>
            {MONTH_NAMES[month]} {year}
          </div>
          <button onClick={() => setViewDate(new Date(year, month + 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Balance */}
      <div style={{ background: "#F1ECDF", borderRadius: 6, padding: "18px 20px", marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Balance available</div>
            <div className="lora tabnum" style={{ fontSize: "clamp(24px, 7vw, 32px)", fontWeight: 600, lineHeight: 1, color: balanceCalc.balance < 0 ? "#A34A38" : "#241F1A" }}>
              {fmt(balanceCalc.balance)}
            </div>
            <div style={{ fontSize: 11, color: "#8a8477", marginTop: 4 }}>
              {balanceCalc.addedLabel} · {balanceCalc.spentLabel} deducted
            </div>
          </div>
          <button
            onClick={() => (showTopup ? cancelEditTopup() : setShowTopup(true))}
            style={{ background: showTopup ? "#EAE5D9" : "#241F1A", color: showTopup ? "#241F1A" : "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            {showTopup ? <X size={14} /> : <Plus size={14} />} {showTopup ? "Cancel" : "Add money"}
          </button>
        </div>

        {showTopup && (
          <form onSubmit={submitTopup} style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setTopupForm({ ...topupForm, mode: "add" })}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 20, border: "1px solid " + (topupForm.mode === "add" ? "#241F1A" : "#D9D2C2"), background: topupForm.mode === "add" ? "#241F1A" : "transparent", color: topupForm.mode === "add" ? "#FBF8F2" : "#5f5a4f", cursor: "pointer" }}
              >
                Add to balance
              </button>
              <button
                type="button"
                onClick={() => setTopupForm({ ...topupForm, mode: "set" })}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 20, border: "1px solid " + (topupForm.mode === "set" ? "#241F1A" : "#D9D2C2"), background: topupForm.mode === "set" ? "#241F1A" : "transparent", color: topupForm.mode === "set" ? "#FBF8F2" : "#5f5a4f", cursor: "pointer" }}
              >
                Set current balance
              </button>
            </div>
            {topupForm.mode === "set" && (
              <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 10, maxWidth: 420 }}>
                Use this when you're pasting in whatever amount you currently have on hand, partway through the month. It replaces the balance as of this date — expenses before this date won't be subtracted again.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              <input type="number" inputMode="decimal" placeholder="Amount (₹)" value={topupForm.amount} onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })} step="0.01" min="0" style={{ width: 140 }} />
              <input type="text" placeholder="Source (optional)" value={topupForm.note} onChange={(e) => setTopupForm({ ...topupForm, note: e.target.value })} maxLength={60} style={{ width: 160 }} />
              <input type="date" value={topupForm.date} onChange={(e) => setTopupForm({ ...topupForm, date: e.target.value })} max={todayISO()} style={{ width: 150 }} />
              <button type="submit" disabled={topupSubmitting} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, fontWeight: 500, cursor: topupSubmitting ? "default" : "pointer", opacity: topupSubmitting ? 0.6 : 1 }}>
                {topupSubmitting ? "Saving…" : editingTopupId ? "Save changes" : "Add"}
              </button>
            </div>
            {topupError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{topupError}</div>}
          </form>
        )}

        {topups.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid #E3DCC9", paddingTop: 10 }}>
            {topups.slice(0, 5).map((t) => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#5f5a4f", padding: "4px 0" }}>
                <span>
                  {new Date(t.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  {t.note && <> · {t.note}</>}
                  {t.mode === "set" && <span style={{ color: "#7A3E56" }}> · set balance</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="tabnum" style={{ color: t.mode === "set" ? "#7A3E56" : "#2F6F5E" }}>{t.mode === "set" ? "= " : "+"}{fmt(t.amount)}</span>
                  <button onClick={() => startEditTopup(t)} aria-label="Edit top-up" style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 2, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#5f5a4f")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}>
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => removeTopup(t.id)} aria-label="Delete top-up" style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 2, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#A34A38")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hero total */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Spent in {MONTH_NAMES[month]}</div>
          <div className="lora tabnum" style={{ fontSize: "clamp(30px, 9vw, 44px)", fontWeight: 600, lineHeight: 1 }}>
            {fmt(spentSoFar)}
          </div>
          <div style={{ fontSize: 11, color: "#8a8477", marginTop: 4 }}>Includes movie tickets and canteen spend</div>
        </div>
        {diff !== null && (
          <div style={{ fontSize: 13, color: diff > 0 ? "#A34A38" : "#2F6F5E", paddingBottom: 8 }}>
            {diff > 0 ? "↑" : "↓"} {Math.abs(Math.round(diff))}% vs {MONTH_NAMES[lastMonthDate.getMonth()]}
            <span style={{ color: "#8a8477" }}> ({fmt(lastMonthTotal)})</span>
          </div>
        )}
      </div>

      {upcomingTotal > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#A3763F", marginBottom: 40 }}>
          <Clock size={14} />
          <span><strong className="tabnum">{fmt(upcomingTotal)}</strong> scheduled later this month ({upcomingItems.length} item{upcomingItems.length !== 1 ? "s" : ""}, not yet deducted from balance)</span>
        </div>
      )}
      {upcomingTotal === 0 && <div style={{ marginBottom: upcomingTotal > 0 || overallBreach || categoryBreaches.length > 0 ? 0 : 40 }} />}

      {(overallBreach || categoryBreaches.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#A34A38", marginBottom: 40, flexWrap: "wrap" }}>
          <span>
            Over budget:{" "}
            {overallBreach && <>overall by <strong className="tabnum">{fmt(spentSoFar - overallRule.amount)}</strong></>}
            {overallBreach && categoryBreaches.length > 0 && ", "}
            {categoryBreaches.map((c, i) => (
              <span key={c.name}>
                {c.name} by <strong className="tabnum">{fmt(c.value - categoryRuleMap[c.name])}</strong>{i < categoryBreaches.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
          <a href="/budget" style={{ color: "#A34A38", fontSize: 12, textDecoration: "underline" }}>Adjust rules →</a>
        </div>
      )}

      <div className="responsive-grid">
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            {editingExpenseId ? "Edit expense" : "Add an expense"}
          </div>
          <form onSubmit={submitExpense} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="number" inputMode="decimal" placeholder="Amount (₹)" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} step="0.01" min="0" />
            <select value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder={expenseForm.category === "Other" ? "Reason (required)" : "Note (optional)"}
              value={expenseForm.note}
              onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })}
              maxLength={80}
              style={expenseForm.category === "Other" ? { borderColor: "#A34A38" } : undefined}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} style={{ flex: 1 }} />
              <input type="time" value={expenseForm.time} onChange={(e) => setExpenseForm({ ...expenseForm, time: e.target.value })} style={{ flex: 1 }} />
            </div>
            {expenseForm.date > todayISO() && (
              <div style={{ fontSize: 11, color: "#A3763F", marginTop: -6 }}>Future date — won't reduce your balance until this day arrives</div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5f5a4f", cursor: "pointer" }}>
              <input type="checkbox" checked={expenseForm.affectsBalance} onChange={(e) => setExpenseForm({ ...expenseForm, affectsBalance: e.target.checked })} style={{ width: "auto" }} />
              Deduct from balance
            </label>
            {formError && <div style={{ fontSize: 12, color: "#A34A38" }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={submitting}
                style={{ flex: 1, marginTop: 4, background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={16} /> {submitting ? "Saving…" : editingExpenseId ? "Save changes" : "Add expense"}
              </button>
              {editingExpenseId && (
                <button type="button" onClick={cancelEditExpense} style={{ marginTop: 4, background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                  Cancel
                </button>
              )}
            </div>
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
                  <div style={{ fontSize: 12, color: dateKey > today ? "#A3763F" : "#8a8477", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                    <span>{formatDateLabel(dateKey)}{dateKey > today && " · scheduled"}</span>
                    <span className="tabnum">{fmt(items.reduce((s, x) => s + x.amount, 0))}</span>
                  </div>
                  <div style={{ borderTop: "1px solid #EAE5D9" }}>
                    {items.map((x) => {
                      const isMovie = x.category === MOVIE_CATEGORY.name;
                      return (
                        <div key={x.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #EAE5D9", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor(x.category), flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {x.note || x.category}
                                {x.time && <span style={{ fontSize: 10, color: "#8a8477" }}> · {x.time}</span>}
                                {x.affectsBalance === false && <span style={{ fontSize: 10, color: "#8a8477" }}> · not deducted</span>}
                              </div>
                              {x.note && <div style={{ fontSize: 12, color: "#8a8477" }}>{x.category}</div>}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <span className="tabnum" style={{ fontSize: 14, fontWeight: 500 }}>{fmt(x.amount)}</span>
                            {!isMovie && (
                              <>
                                <button onClick={() => startEditExpense(x)} aria-label="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 4, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#5f5a4f")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}>
                                  <Pencil size={14} />
                                </button>
                                <button onClick={() => removeExpense(x.id)} aria-label="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 4, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#A34A38")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}>
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                            {isMovie && (
                              <a href="/movies" style={{ fontSize: 11, color: "#8a8477", textDecoration: "none" }}>edit on Movies →</a>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
