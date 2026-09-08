import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Pencil, Trash2, Check, X, Plus } from "lucide-react";

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
  { name: "Movies", color: "#7A3E56" },
];

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function ProgressBar({ spent, limit }) {
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const over = spent > limit;
  const color = over ? "#A34A38" : pct > 75 ? "#C98A2C" : "#2F6F5E";
  return (
    <div style={{ height: 6, background: "#EAE5D9", borderRadius: 4, overflow: "hidden", marginTop: 6 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.2s" }} />
    </div>
  );
}

export default function BudgetPage() {
  const [expenses, setExpenses] = useState([]);
  const [movies, setMovies] = useState([]);
  const [topups, setTopups] = useState([]);
  const [rules, setRules] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [overallInput, setOverallInput] = useState("");
  const [editingOverall, setEditingOverall] = useState(false);
  const [savingsInput, setSavingsInput] = useState("");
  const [editingSavings, setEditingSavings] = useState(false);

  const [newCatCategory, setNewCatCategory] = useState("");
  const [newCatAmount, setNewCatAmount] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [editCatAmount, setEditCatAmount] = useState("");
  const [saveError, setSaveError] = useState("");

  async function load() {
    try {
      const [expRes, movRes, balRes, ruleRes] = await Promise.all([
        fetch("/api/data?type=expenses"),
        fetch("/api/data?type=movies"),
        fetch("/api/data?type=balance"),
        fetch("/api/data?type=budget"),
      ]);
      if (expRes.ok) {
        const d = await expRes.json();
        setExpenses(d.expenses.map((x) => ({ amount: parseFloat(x.amount), category: x.category, date: x.expense_date.slice(0, 10) })));
      }
      if (movRes.ok) {
        const d = await movRes.json();
        setMovies(d.movies.map((m) => ({
          date: m.watched_date.slice(0, 10),
          amount: (parseFloat(m.ticket_price) + parseFloat(m.canteen_price)) * (m.quantity || 1),
        })));
      }
      if (balRes.ok) {
        const d = await balRes.json();
        setTopups(d.topups.map((t) => ({ amount: parseFloat(t.amount), date: t.topup_date.slice(0, 10), mode: t.mode })));
      }
      if (ruleRes.ok) {
        const d = await ruleRes.json();
        setRules(d.rules.map((r) => ({ id: r.id, ruleType: r.rule_type, category: r.category, amount: parseFloat(r.amount) })));
      }
      setLoadError("");
    } catch (err) {
      setLoadError("Couldn't load your data. Check the database connection and refresh.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const today = todayISO();
  const currentMonth = today.slice(0, 7);

  const monthExpenses = useMemo(() => expenses.filter((x) => x.date.slice(0, 7) === currentMonth && x.date <= today), [expenses, currentMonth, today]);
  const monthMovieSpend = useMemo(() => movies.filter((m) => m.date.slice(0, 7) === currentMonth && m.date <= today).reduce((s, m) => s + m.amount, 0), [movies, currentMonth, today]);
  const monthAdded = useMemo(() => topups.filter((t) => t.mode === "add" && t.date.slice(0, 7) === currentMonth).reduce((s, t) => s + t.amount, 0), [topups, currentMonth]);

  const spentByCategory = useMemo(() => {
    const map = {};
    for (const x of monthExpenses) map[x.category] = (map[x.category] || 0) + x.amount;
    map["Movies"] = (map["Movies"] || 0) + monthMovieSpend;
    return map;
  }, [monthExpenses, monthMovieSpend]);

  const overallSpent = useMemo(() => monthExpenses.reduce((s, x) => s + x.amount, 0) + monthMovieSpend, [monthExpenses, monthMovieSpend]);
  const savedSoFar = monthAdded - overallSpent;

  const overallRule = rules.find((r) => r.ruleType === "overall");
  const savingsRule = rules.find((r) => r.ruleType === "savings");
  const categoryRules = rules.filter((r) => r.ruleType === "category");

  async function saveRule(ruleType, category, amount) {
    setSaveError("");
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "budget", ruleType, category, amount }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save");
      }
      await load();
      return true;
    } catch (err) {
      setSaveError(err.message || "Couldn't save. Try again.");
      return false;
    }
  }

  async function removeRule(id) {
    const prev = rules;
    setRules(rules.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/data?type=budget&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setRules(prev);
      setLoadError("Couldn't remove that rule. Try again.");
    }
  }

  async function submitOverall() {
    const amt = parseFloat(overallInput);
    if (!amt || amt <= 0) {
      setSaveError("Enter an amount greater than 0");
      return;
    }
    const ok = await saveRule("overall", null, amt);
    if (ok) {
      setEditingOverall(false);
      setOverallInput("");
    }
  }

  async function submitSavings() {
    const amt = parseFloat(savingsInput);
    if (!amt || amt <= 0) {
      setSaveError("Enter an amount greater than 0");
      return;
    }
    const ok = await saveRule("savings", null, amt);
    if (ok) {
      setEditingSavings(false);
      setSavingsInput("");
    }
  }

  async function submitNewCategoryLimit() {
    const amt = parseFloat(newCatAmount);
    if (!newCatCategory) {
      setSaveError("Pick a category");
      return;
    }
    if (!amt || amt <= 0) {
      setSaveError("Enter an amount greater than 0");
      return;
    }
    const ok = await saveRule("category", newCatCategory, amt);
    if (ok) {
      setNewCatCategory("");
      setNewCatAmount("");
    }
  }

  async function submitEditCategoryLimit(category) {
    const amt = parseFloat(editCatAmount);
    if (!amt || amt <= 0) {
      setSaveError("Enter an amount greater than 0");
      return;
    }
    const ok = await saveRule("category", category, amt);
    if (ok) {
      setEditingCategory(null);
      setEditCatAmount("");
    }
  }

  const availableCategories = CATEGORIES.filter((c) => !categoryRules.some((r) => r.category === c.name));

  if (!loaded) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>
        Loading your money rules…
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px" }}>
      {loadError && (
        <div style={{ background: "#FAECE7", border: "1px solid #D85A30", color: "#712B13", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      <div style={{ marginBottom: 32, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Money Rules
        </div>
        <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>
          Set limits for yourself and see if you're keeping to them, this month.
        </div>
      </div>

      {saveError && <div style={{ fontSize: 12, color: "#A34A38", marginBottom: 16 }}>{saveError}</div>}

      {/* Overall limit */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Overall monthly limit</div>
            {overallRule ? (
              <>
                <div style={{ fontSize: 13, color: "#5f5a4f", marginTop: 4 }}>
                  <span className="tabnum">{fmt(overallSpent)}</span> of <span className="tabnum">{fmt(overallRule.amount)}</span> spent this month
                  {overallSpent > overallRule.amount && <span style={{ color: "#A34A38", fontWeight: 500 }}> — over by {fmt(overallSpent - overallRule.amount)}</span>}
                </div>
                <ProgressBar spent={overallSpent} limit={overallRule.amount} />
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#8a8477", marginTop: 4 }}>No limit set — spending is unrestricted.</div>
            )}
          </div>
          {!editingOverall && (
            <button onClick={() => { setEditingOverall(true); setOverallInput(overallRule ? String(overallRule.amount) : ""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", padding: 4, display: "flex" }}>
              <Pencil size={14} />
            </button>
          )}
        </div>
        {editingOverall && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input type="number" inputMode="decimal" placeholder="Monthly limit (₹)" value={overallInput} onChange={(e) => setOverallInput(e.target.value)} style={{ width: 160 }} />
            <button onClick={submitOverall} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}><Check size={14} /></button>
            <button onClick={() => { setEditingOverall(false); setOverallInput(""); }} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}><X size={14} /></button>
            {overallRule && (
              <button onClick={() => { removeRule(overallRule.id); setEditingOverall(false); }} style={{ background: "none", border: "none", color: "#A34A38", cursor: "pointer", fontSize: 12 }}>Remove limit</button>
            )}
          </div>
        )}
      </div>

      {/* Savings goal */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Savings goal this month</div>
            {savingsRule ? (
              <>
                <div style={{ fontSize: 13, color: "#5f5a4f", marginTop: 4 }}>
                  Saved <span className="tabnum" style={{ color: savedSoFar >= savingsRule.amount ? "#2F6F5E" : "#241F1A" }}>{fmt(savedSoFar)}</span> of <span className="tabnum">{fmt(savingsRule.amount)}</span> goal
                  {savedSoFar >= savingsRule.amount
                    ? <span style={{ color: "#2F6F5E", fontWeight: 500 }}> — goal met</span>
                    : <span style={{ color: "#8a8477" }}> — {fmt(savingsRule.amount - savedSoFar)} to go</span>}
                </div>
                <ProgressBar spent={Math.max(0, savedSoFar)} limit={savingsRule.amount} />
                <div style={{ fontSize: 11, color: "#8a8477", marginTop: 4 }}>Based on money added minus money spent this month</div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#8a8477", marginTop: 4 }}>No savings goal set yet.</div>
            )}
          </div>
          {!editingSavings && (
            <button onClick={() => { setEditingSavings(true); setSavingsInput(savingsRule ? String(savingsRule.amount) : ""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", padding: 4, display: "flex" }}>
              <Pencil size={14} />
            </button>
          )}
        </div>
        {editingSavings && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input type="number" inputMode="decimal" placeholder="Savings goal (₹)" value={savingsInput} onChange={(e) => setSavingsInput(e.target.value)} style={{ width: 160 }} />
            <button onClick={submitSavings} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}><Check size={14} /></button>
            <button onClick={() => { setEditingSavings(false); setSavingsInput(""); }} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}><X size={14} /></button>
            {savingsRule && (
              <button onClick={() => { removeRule(savingsRule.id); setEditingSavings(false); }} style={{ background: "none", border: "none", color: "#A34A38", cursor: "pointer", fontSize: 12 }}>Remove goal</button>
            )}
          </div>
        )}
      </div>

      {/* Category limits */}
      <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px" }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Category limits</div>

        {categoryRules.length === 0 && <div style={{ fontSize: 13, color: "#8a8477", marginBottom: 12 }}>No category limits set yet.</div>}

        {categoryRules.map((r) => {
          const spent = spentByCategory[r.category] || 0;
          const catColor = CATEGORIES.find((c) => c.name === r.category)?.color || "#6B6558";
          const isEditing = editingCategory === r.category;
          return (
            <div key={r.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #EAE5D9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor }} />
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{r.category}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="tabnum" style={{ fontSize: 13, color: "#5f5a4f" }}>{fmt(spent)} / {fmt(r.amount)}</span>
                  <button onClick={() => { setEditingCategory(r.category); setEditCatAmount(String(r.amount)); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", padding: 4, display: "flex" }}><Pencil size={13} /></button>
                  <button onClick={() => removeRule(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", padding: 4, display: "flex" }}><Trash2 size={13} /></button>
                </div>
              </div>
              {spent > r.amount && <div style={{ fontSize: 11, color: "#A34A38", marginTop: 2 }}>Over by {fmt(spent - r.amount)}</div>}
              <ProgressBar spent={spent} limit={r.amount} />
              {isEditing && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input type="number" inputMode="decimal" value={editCatAmount} onChange={(e) => setEditCatAmount(e.target.value)} style={{ width: 140 }} />
                  <button onClick={() => submitEditCategoryLimit(r.category)} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}><Check size={14} /></button>
                  <button onClick={() => setEditingCategory(null)} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center" }}><X size={14} /></button>
                </div>
              )}
            </div>
          );
        })}

        {availableCategories.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={newCatCategory} onChange={(e) => setNewCatCategory(e.target.value)} style={{ width: 160 }}>
              <option value="">Choose category</option>
              {availableCategories.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input type="number" inputMode="decimal" placeholder="Limit (₹)" value={newCatAmount} onChange={(e) => setNewCatAmount(e.target.value)} style={{ width: 120 }} />
            <button onClick={submitNewCategoryLimit} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> Add limit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
