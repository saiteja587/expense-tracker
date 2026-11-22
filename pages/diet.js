// Diet (free, no AI key): log food from a table of common Indian dishes,
// see today against your targets, get a rule-based 7-day plan with a priced
// shopping list, and send your week to the free Claude app in one tap.
import { useEffect, useMemo, useState } from "react";
import { Salad, Trash2, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useLife } from "../lib/useLife";
import { FOODS, GOALS, searchFoods, dailyTargets, dayTotals, weeklyPlan, claudePrompt } from "../lib/diet";
import { todayISO, fmt } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const PREFS_KEY = "diet_prefs_v1";
const MEALS = [["breakfast", "🌅 Breakfast"], ["lunch", "🍛 Lunch"], ["snack", "☕ Snack"], ["dinner", "🌙 Dinner"]];
const mealNow = () => { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner"; };

function Bar({ label, value, target, unit, over }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const bad = over ? value > target : false;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{label}</span><span className="tabnum" style={{ color: bad ? "var(--danger)" : undefined }}>{value} / {target} {unit}</span></div>
      <div style={{ height: 7, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: bad ? "var(--danger)" : "var(--success)" }} /></div>
    </div>
  );
}

export default function DietPage() {
  const life = useLife(["food", "day_log"]);
  const today = todayISO();
  const [prefs, setPrefs] = useState({ goal: "maintain", diet: "veg", budget: "" });
  const [tab, setTab] = useState("today");
  const [q, setQ] = useState("");
  const [meal, setMeal] = useState(mealNow());
  const [seed, setSeed] = useState(0);
  const [custom, setCustom] = useState(null);

  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); if (p) setPrefs(p); } catch { /* ignore */ }
  }, []);
  const setPref = (patch) => {
    const p = { ...prefs, ...patch };
    setPrefs(p);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  };

  const foods = life.of("food");
  const weight = useMemo(() => [...life.of("day_log")].filter((l) => l.weight > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.weight || 0, [life]);
  const targets = dailyTargets(prefs.goal, weight);
  const tot = dayTotals(foods, today);
  const plan = useMemo(() => weeklyPlan({ goal: prefs.goal, diet: prefs.diet, startIso: today, seed }), [prefs.goal, prefs.diet, today, seed]);
  if (!life.loaded) return <Loading />;

  async function add(f, qty = 1) {
    try {
      await life.save({ kind: "food", date: today, data: { name: f.name, qty, unit: f.serving, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, sugar: f.sugar, meal } });
      setQ("");
      showToast(`${f.name} added`, "🥗");
    } catch (e) { showToast(e.message, "⚠️"); }
  }

  async function askClaude() {
    const text = claudePrompt({ goal: prefs.goal, diet: prefs.diet, weight, targets, foodLogs: foods, todayIso: today, budget: parseFloat(prefs.budget) || 0 });
    try { await navigator.clipboard.writeText(text); showToast("Copied. Paste it into Claude", "📋"); } catch { window.prompt("Copy this and paste it into Claude:", text); }
    window.open("https://claude.ai/new", "_blank", "noopener");
  }

  const results = searchFoods(q);
  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader back="/health" backLabel="Health" icon={<Salad size={22} color="var(--success)" />} title="Diet" sub="Free and offline. Values are typical servings, so treat them as estimates." />

      <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 14, display: "grid", gap: 8 }}>
        <div className="h-scroll">{GOALS.map((g) => <button key={g.id} type="button" className={`chip${prefs.goal === g.id ? " active" : ""}`} onClick={() => setPref({ goal: g.id })}>{g.label}</button>)}</div>
        <div className="h-scroll">{[["veg", "🥦 Vegetarian"], ["egg", "🥚 Veg + egg"], ["nonveg", "🍗 Non-veg"]].map(([id, l]) => <button key={id} type="button" className={`chip${prefs.diet === id ? " active" : ""}`} onClick={() => setPref({ diet: id })}>{l}</button>)}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Targets: ~{targets.kcal} kcal · {targets.protein} g protein · under {targets.sugar} g sugar{weight ? ` (from your ${weight} kg)` : " (add your weight on Health for better numbers)"}</div>
      </div>

      <div className="h-scroll" style={{ marginBottom: 12 }}>
        {[["today", "Today"], ["plan", "7-day plan"], ["shop", "Shopping list"]].map(([id, l]) => <button key={id} type="button" className={`chip${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>

      {tab === "today" && (
        <>
          <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 12 }}>
            <Bar label="Calories" value={tot.kcal} target={targets.kcal} unit="kcal" over />
            <Bar label="Protein" value={tot.protein} target={targets.protein} unit="g" />
            <Bar label="Sugar" value={tot.sugar} target={targets.sugar} unit="g" over />
          </div>
          <div className="h-scroll" style={{ marginBottom: 8 }}>{MEALS.map(([id, l]) => <button key={id} type="button" className={`chip${meal === id ? " active" : ""}`} onClick={() => setMeal(id)}>{l}</button>)}</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: roti, dosa, dal, biryani, chai…" />
          {results.length > 0 && (
            <div className="card" style={{ borderRadius: 12, padding: "2px 12px", margin: "6px 0 12px" }}>
              {results.map((f) => (
                <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{f.name} <span style={{ fontSize: 12, color: "var(--muted)" }}>· {f.serving}</span></div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{f.kcal} kcal · {f.protein} g protein · {f.sugar} g sugar</div>
                  </div>
                  {[1, 2].map((k) => <button key={k} type="button" className="chip" onClick={() => add(f, k)}>+{k}</button>)}
                </div>
              ))}
            </div>
          )}
          {q && results.length === 0 && (
            <button type="button" className="chip" style={{ margin: "6px 0 12px" }} onClick={() => setCustom({ name: q, kcal: "", protein: "", sugar: "" })}>+ Add “{q}” with your own numbers</button>
          )}
          {custom && (
            <div className="card" style={{ borderRadius: 12, padding: 12, marginBottom: 12, display: "grid", gap: 8 }}>
              <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Food" />
              <div style={{ display: "flex", gap: 8 }}>
                {[["kcal", "kcal"], ["protein", "protein g"], ["sugar", "sugar g"]].map(([k, l]) => <input key={k} type="number" inputMode="decimal" value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: e.target.value })} placeholder={l} style={{ flex: 1 }} />)}
              </div>
              <button type="button" className="btn btn-primary" onClick={() => { add({ name: custom.name, serving: "1 serving", kcal: +custom.kcal || 0, protein: +custom.protein || 0, sugar: +custom.sugar || 0, carbs: 0, fat: 0 }); setCustom(null); }}>Add</button>
            </div>
          )}
          {MEALS.map(([id, l]) => {
            const xs = tot.items.filter((x) => (x.meal || "snack") === id);
            if (!xs.length) return null;
            return (
              <div key={id} style={{ marginBottom: 10 }}>
                <div className="field-label">{l}</div>
                {xs.map((x) => (
                  <div key={x.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                    <span>{x.name}{x.qty !== 1 ? ` ×${x.qty}` : ""}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="tabnum" style={{ color: "var(--muted)", fontSize: 13 }}>{Math.round(x.kcal * (x.qty || 1))} kcal</span>
                      <button type="button" className="icon-btn danger" aria-label={`Remove ${x.name}`} onClick={() => life.remove(x.id)}><Trash2 size={15} /></button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          {tot.items.length === 0 && !q && <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 0" }}>Nothing logged today. Search above; {FOODS.length} Indian foods are built in.</div>}
        </>
      )}

      {tab === "plan" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Simple home food. Swap anything you don&apos;t like.</span>
            <button type="button" className="chip" onClick={() => setSeed(seed + 1)}><RefreshCw size={14} /> Shuffle</button>
          </div>
          {plan.days.map((d) => (
            <div key={d.date} className="card" style={{ borderRadius: 14, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                <span>{new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</span>
                <span className="tabnum" style={{ color: "var(--muted)", fontWeight: 400 }}>~{d.kcal} kcal · {d.protein} g protein</span>
              </div>
              {d.meals.map((m) => <div key={m.slot} style={{ fontSize: 13.5, padding: "2px 0" }}>{MEALS.find(([id]) => id === m.slot)[1].split(" ")[0]} {m.name}</div>)}
            </div>
          ))}
        </>
      )}

      {tab === "shop" && (
        <div className="card" style={{ borderRadius: 16, padding: "6px 14px 12px" }}>
          {plan.shopping.map((x) => (
            <div key={`${x.item}|${x.unit}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <span>{x.item} <span style={{ color: "var(--muted)", fontSize: 12 }}>{x.qty}</span></span><span className="tabnum">~{fmt(x.cost)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, paddingTop: 8, borderTop: "1px solid var(--line-strong)" }}><span>About this week</span><span className="tabnum">{fmt(plan.totalCost)}</span></div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Rough city prices for one person. Oil, spices and salt not included.</div>
          <button type="button" className="chip" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(plan.shopping.map((x) => `• ${x.item} — ${x.qty}`).join("\n")).then(() => showToast("List copied", "📋"))}><Copy size={14} /> Copy list (for WhatsApp / Notes)</button>
        </div>
      )}

      <div className="card" style={{ borderRadius: 16, padding: 14, marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>✨ Ask Claude (free)</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>Copies your goal, targets and this week&apos;s food, then opens Claude. Paste it there to get a review and a personal plan. You can also send Claude a photo of your plate or a food label there. Nothing is sent until you paste it.</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" inputMode="numeric" value={prefs.budget} onChange={(e) => setPref({ budget: e.target.value })} placeholder="Weekly grocery budget ₹ (optional)" style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={askClaude}><ExternalLink size={15} /> Ask Claude</button>
        </div>
      </div>
    </div>
  );
}
