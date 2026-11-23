// Home: what you own (value, warranty photo), maintenance that repeats
// (AC service, RO filter…), utility meters (units, cost per unit, unusual
// months) and a grocery list.
import { useState } from "react";
import { Home as HomeIcon, Plus, Pencil, Trash2, X, Camera, Image as ImageIcon, Share2 } from "lucide-react";
import { useLife } from "../lib/useLife";
import { choreNext, meterStats } from "../lib/lifePlus";
import { weeklyPlan } from "../lib/diet";
import { fileToCompressedDataUrl } from "../lib/receiptImage";
import { apiGet } from "../lib/api";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { openQuickAdd } from "../components/QuickAddSheet";
import PageHeader, { Loading, pageStyle, Stat } from "../components/PageHeader";

const d = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const CHORE_IDEAS = [["AC service", 6, 0], ["Water purifier filter", 4, 0], ["Pest control", 6, 0], ["Water tank cleaning", 6, 0], ["Chimney cleaning", 3, 0], ["Bike wash", 0, 15]];
const METER_TYPES = [["electricity", "⚡ Electricity", "kWh"], ["water", "🚰 Water", "kL"], ["gas", "🔥 Gas", "SCM"], ["other", "📟 Other", "units"]];

export default function HouseholdPage() {
  const life = useLife(["possession", "chore", "meter", "reading", "grocery"]);
  const today = todayISO();
  const [tab, setTab] = useState("maintenance");
  const [form, setForm] = useState(null);
  const [newItem, setNewItem] = useState("");
  // Ticks show at once; the save follows in the background.
  const [ticked, setTicked] = useState({});
  if (!life.loaded) return <Loading />;

  const save = async (item, close = true) => {
    try { await life.save(item); if (close) setForm(null); } catch (e) { showToast(e.message, "⚠️"); }
  };
  const possessions = life.of("possession");
  const chores = life.of("chore").map((c) => ({ ...c, nx: choreNext(c, today) })).sort((a, b) => (a.nx.daysLeft ?? 999) - (b.nx.daysLeft ?? 999));
  const meters = life.of("meter");
  const readings = life.of("reading");
  const grocery = life.of("grocery").sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  const ADD = {
    inventory: { kind: "possession", name: "", room: "", date: "" },
    maintenance: { kind: "chore", name: "", everyMonths: 6, date: today },
    utilities: { kind: "meter", name: "Electricity", type: "electricity", unit: "kWh" },
  };

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<HomeIcon size={22} color="var(--accent-solid)" />} title="Home" sub="Maintenance reminders, meters, things you own, and the grocery list.">
        {ADD[tab] && <button type="button" className="chip active" onClick={() => setForm({ ...ADD[tab] })}><Plus size={14} /> Add</button>}
      </PageHeader>
      <div className="h-scroll" style={{ marginBottom: 12 }}>
        {[["maintenance", "🔧 Maintenance"], ["utilities", "⚡ Meters"], ["grocery", `🛒 Grocery (${grocery.filter((g) => !g.done).length})`], ["inventory", "📦 Things I own"]].map(([id, l]) => (
          <button key={id} type="button" className={`chip${tab === id ? " active" : ""}`} onClick={() => { setTab(id); setForm(null); }}>{l}</button>
        ))}
      </div>

      {/* ---- Maintenance ---- */}
      {tab === "maintenance" && (
        <>
          {form?.kind === "chore" && (
            <form onSubmit={(e) => { e.preventDefault(); save({ kind: "chore", id: form.id, date: form.date || null, data: { name: form.name, everyMonths: form.everyMonths, everyDays: form.everyDays, cost: form.cost, vendor: form.vendor, phone: form.phone } }); }}
              className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit" : "Add"} maintenance</div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button></div>
              {!form.id && <div className="h-scroll">{CHORE_IDEAS.map(([n, mo, dy]) => <button key={n} type="button" className="chip" onClick={() => setForm({ ...form, name: n, everyMonths: mo, everyDays: dy })}>{n}</button>)}</div>}
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="What needs doing" />
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Every (months)</span><input type="number" inputMode="numeric" value={form.everyMonths ?? ""} onChange={(e) => setForm({ ...form, everyMonths: e.target.value, everyDays: "" })} /></label>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">or every (days)</span><input type="number" inputMode="numeric" value={form.everyDays ?? ""} onChange={(e) => setForm({ ...form, everyDays: e.target.value, everyMonths: "" })} /></label>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Last done</span><input type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" inputMode="decimal" value={form.cost ?? ""} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="Usual cost ₹" style={{ flex: 1 }} />
                <input value={form.vendor || ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Who does it" style={{ flex: 1 }} />
                <input type="tel" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" style={{ flex: 1 }} />
              </div>
              <button type="submit" className="btn btn-primary btn-block">Save</button>
            </form>
          )}
          {chores.length === 0 && !form && <Empty text="AC service, RO filter, pest control… add what repeats and you'll be reminded when it's due." />}
          {chores.map((c) => (
            <div key={c.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: c.nx.daysLeft != null && c.nx.daysLeft <= 7 ? "var(--amber)" : "var(--muted)" }}>
                    {c.nx.never ? "Not done yet" : c.nx.daysLeft == null ? `last done ${d(c.date)}` : c.nx.daysLeft < 0 ? `overdue by ${-c.nx.daysLeft} days` : `next ${d(c.nx.next)} (in ${c.nx.daysLeft} days)`}
                    {c.vendor ? ` · ${c.vendor}` : ""}{c.cost ? ` · ~${fmt(c.cost)}` : ""}
                  </div>
                </div>
                <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...c, kind: "chore" })}><Pencil size={16} /></button>
                <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(c.id, `Delete ${c.name}?`)}><Trash2 size={16} /></button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" className="chip" onClick={async () => {
                  await save({ kind: "chore", id: c.id, date: today, data: { name: c.name, everyMonths: c.everyMonths, everyDays: c.everyDays, cost: c.cost, vendor: c.vendor, phone: c.phone } }, false);
                  showToast("Done. Next one scheduled", "✅");
                  if (c.cost) openQuickAdd({ amount: c.cost, note: c.name, category: "Bills" });
                }}>✅ Done today</button>
                {c.phone && <a className="chip" href={`tel:${c.phone}`} style={{ textDecoration: "none" }}>📞 Call</a>}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ---- Meters ---- */}
      {tab === "utilities" && (
        <>
          {form?.kind === "meter" && (
            <form onSubmit={(e) => { e.preventDefault(); save({ kind: "meter", id: form.id, data: { name: form.name, type: form.type, unit: form.unit, rate: form.rate, consumerNo: form.consumerNo } }); }}
              className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="h-scroll">{METER_TYPES.map(([k, l, u]) => <button key={k} type="button" className={`chip${form.type === k ? " active" : ""}`} onClick={() => setForm({ ...form, type: k, unit: u, name: form.name || l.split(" ")[1] })}>{l}</button>)}</div>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" style={{ flex: 2 }} />
                <input value={form.consumerNo || ""} onChange={(e) => setForm({ ...form, consumerNo: e.target.value })} placeholder="Consumer / service no." style={{ flex: 2 }} />
              </div>
              <input type="number" inputMode="decimal" value={form.rate ?? ""} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder={`Rough ₹ per ${form.unit} (optional; learned from bills)`} />
              <button type="submit" className="btn btn-primary btn-block">Save</button>
            </form>
          )}
          {form?.kind === "reading" && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              await save({ kind: "reading", refId: form.refId, date: form.date, data: { reading: form.reading, amount: form.amount } });
              if (parseFloat(form.amount) > 0 && window.confirm("Log the bill as an expense too?")) openQuickAdd({ amount: parseFloat(form.amount), note: `${form.meterName} bill`, category: "Bills" });
            }} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>Reading: {form.meterName}</div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button></div>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Meter reading</span><input type="number" inputMode="decimal" value={form.reading} onChange={(e) => setForm({ ...form, reading: e.target.value })} /></label>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Bill ₹ (if any)</span><input type="number" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Date</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              </div>
              <button type="submit" className="btn btn-primary btn-block">Save</button>
            </form>
          )}
          {meters.length === 0 && !form && <Empty text="Add your electricity (or water/gas) meter, then note the reading when the bill comes. You'll see units per month and when a month is unusually high." />}
          {meters.map((m) => {
            const st = meterStats(m, readings);
            return (
              <div key={m.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{METER_TYPES.find(([k]) => k === m.type)?.[1].split(" ")[0]} {m.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{[m.consumerNo && `#${m.consumerNo}`, st.latest && `last reading ${st.latest.reading} on ${d(st.latest.date)}`].filter(Boolean).join(" · ") || "No readings yet"}</div>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...m, kind: "meter" })}><Pencil size={16} /></button>
                  <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(m.id, `Delete ${m.name} and its readings?`)}><Trash2 size={16} /></button>
                </div>
                {st.last && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <Stat label="Last period" value={`${st.last.perMonth} ${m.unit || "units"}/mo`} tone={st.change > 20 ? "bad" : undefined} sub={st.change != null ? `${st.change > 0 ? "+" : ""}${st.change}% vs usual` : undefined} />
                    {st.costPerUnit && <Stat label="Cost" value={`₹${st.costPerUnit}/${m.unit || "unit"}`} sub={st.estMonth ? `~${fmt(st.estMonth)} a month` : undefined} />}
                  </div>
                )}
                <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setForm({ kind: "reading", refId: m.id, meterName: m.name, reading: "", amount: "", date: today })}>+ Reading</button>
              </div>
            );
          })}
        </>
      )}

      {/* ---- Grocery ---- */}
      {tab === "grocery" && (
        <>
          <form onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; const [name, qty] = newItem.split(/\s+-\s+|,\s*/); await save({ kind: "grocery", date: today, data: { name: name.trim(), qty: (qty || "").trim() } }, false); setNewItem(""); }}
            style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add: milk, 2 L" style={{ flex: 1 }} />
            <button type="submit" className="btn btn-primary">Add</button>
          </form>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button type="button" className="chip" onClick={async () => {
              let prefs = { goal: "maintain", diet: "veg" };
              try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem("diet_prefs_v1") || "{}") }; } catch { /* ignore */ }
              const plan = weeklyPlan({ goal: prefs.goal, diet: prefs.diet, startIso: today });
              const have = new Set(grocery.filter((g) => !g.done).map((g) => g.name.toLowerCase()));
              for (const x of plan.shopping.filter((x) => !have.has(x.item.toLowerCase()))) await life.save({ kind: "grocery", date: today, data: { name: x.item, qty: x.qty } });
              showToast("Added this week's diet plan", "🥗");
            }}>🥗 Add from my diet plan</button>
            {grocery.some((g) => !g.done) && (
              <a className="chip" style={{ textDecoration: "none" }} target="_blank" rel="noopener noreferrer"
                href={`https://wa.me/?text=${encodeURIComponent("🛒 Grocery list\n" + grocery.filter((g) => !g.done).map((g) => `• ${g.name}${g.qty ? ` — ${g.qty}` : ""}`).join("\n"))}`}><Share2 size={14} /> Share on WhatsApp</a>
            )}
            {grocery.some((g) => g.done) && <button type="button" className="chip" onClick={async () => { for (const g of grocery.filter((x) => x.done)) await life.remove(g.id); }}>Clear bought</button>}
          </div>
          {grocery.length === 0 && <Empty text="Nothing on the list. Add items, or fill it from your diet plan." />}
          <div className="card" style={{ borderRadius: 16, padding: "2px 14px" }}>
            {grocery.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--line)", opacity: g.done ? 0.5 : 1 }}>
                <input type="checkbox" checked={ticked[g.id] ?? !!g.done} aria-label={`Bought ${g.name}`} style={{ width: 20, height: 20 }}
                  onChange={() => {
                    const done = !(ticked[g.id] ?? !!g.done);
                    setTicked((t) => ({ ...t, [g.id]: done }));
                    save({ kind: "grocery", id: g.id, date: g.date, data: { name: g.name, qty: g.qty, price: g.price, done } }, false)
                      .finally(() => setTicked((t) => { const n = { ...t }; delete n[g.id]; return n; }));
                  }} />
                <span style={{ flex: 1, fontSize: 14, textDecoration: g.done ? "line-through" : "none" }}>{g.name}{g.qty ? <span style={{ color: "var(--muted)", fontSize: 12 }}> · {g.qty}</span> : null}</span>
                <button type="button" className="icon-btn danger" aria-label={`Remove ${g.name}`} onClick={() => life.remove(g.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>This list is yours; share it on WhatsApp for family.</div>
        </>
      )}

      {/* ---- Inventory ---- */}
      {tab === "inventory" && (
        <>
          {form?.kind === "possession" && <PossessionForm form={form} setForm={setForm} life={life} />}
          {possessions.length === 0 && !form && <Empty text="Note the valuable things at home (TV, fridge, laptop, jewellery) with a photo and value. Handy for insurance claims and moving." />}
          {possessions.length > 0 && <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>{possessions.length} items · {fmt(possessions.reduce((s, p) => s + (p.value || 0), 0))} total value</div>}
          {[...new Set(possessions.map((p) => p.room || "Other"))].map((room) => (
            <div key={room} style={{ marginBottom: 12 }}>
              <div className="field-label">{room}</div>
              {possessions.filter((p) => (p.room || "Other") === room).map((p) => (
                <div key={p.id} className="card" style={{ borderRadius: 14, padding: 12, marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{[p.brand, p.value && fmt(p.value), p.date && `bought ${d(p.date)}`, p.serial && `S/N ${p.serial}`].filter(Boolean).join(" · ")}</div>
                  </div>
                  {p.hasPhoto && <button type="button" className="icon-btn" aria-label="Photo" onClick={async () => { const { photo } = await apiGet("life-photo", { id: p.id }); const w = window.open("", "_blank"); if (w && photo) { const i = w.document.createElement("img"); i.src = photo; i.style.maxWidth = "100%"; w.document.body.appendChild(i); } }}><ImageIcon size={16} /></button>}
                  <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...p, kind: "possession" })}><Pencil size={16} /></button>
                  <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(p.id, `Delete ${p.name}?`)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const Empty = ({ text }) => <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{text}</div>;

function PossessionForm({ form, setForm, life }) {
  const [photo, setPhoto] = useState(undefined);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    try { await life.save({ kind: "possession", id: form.id, date: form.date || null, photo, data: { name: form.name, room: form.room, value: form.value, brand: form.brand, serial: form.serial, note: form.note } }); setForm(null); } catch (err) { showToast(err.message, "⚠️"); }
  }
  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit" : "Add"} item</div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button></div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.name || ""} onChange={set("name")} placeholder="e.g. LG fridge" style={{ flex: 2 }} />
        <input value={form.room || ""} onChange={set("room")} placeholder="Room" style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.brand || ""} onChange={set("brand")} placeholder="Brand / model" style={{ flex: 1 }} />
        <input type="number" inputMode="decimal" value={form.value ?? ""} onChange={set("value")} placeholder="Value ₹" style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.serial || ""} onChange={set("serial")} placeholder="Serial no." style={{ flex: 1 }} />
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Bought on</span><input type="date" value={form.date || ""} onChange={set("date")} /></label>
      </div>
      <label className="chip" style={{ cursor: "pointer", justifySelf: "start" }}><Camera size={14} /> {photo ? "Photo ✓" : form.hasPhoto ? "Replace photo" : "Photo"}
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPhoto(await fileToCompressedDataUrl(f, { maxDimension: 1200, quality: 0.6 })); }} /></label>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>For warranty reminders, add it under Renewals → Warranties too.</div>
      <button type="submit" className="btn btn-primary btn-block">Save</button>
    </form>
  );
}
