// People: birthdays & occasions (with a gift budget and what you gave
// before), and things you've lent out ("Ravi has my power bank").
import { useState } from "react";
import { Gift, Plus, Pencil, Trash2, X, MessageCircle } from "lucide-react";
import { useLife } from "../lib/useLife";
import { nextOccurrence } from "../lib/life";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { openQuickAdd } from "../components/QuickAddSheet";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const TYPES = [["birthday", "🎂 Birthday"], ["anniversary", "💍 Anniversary"], ["festival", "🪔 Festival"], ["other", "🎉 Other"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const when = (n) => (n === 0 ? "today 🎉" : n === 1 ? "tomorrow" : `in ${n} days`);

export default function PeoplePage() {
  const life = useLife(["occasion", "gift", "lent"]);
  const today = todayISO();
  const [tab, setTab] = useState("occasions");
  const [form, setForm] = useState(null);
  const [gift, setGift] = useState(null);
  const [lent, setLent] = useState(null);
  if (!life.loaded) return <Loading />;

  const occasions = life.of("occasion").map((o) => ({ ...o, next: nextOccurrence(o, today) })).sort((a, b) => a.next.daysLeft - b.next.daysLeft);
  const gifts = life.of("gift");
  const lentItems = life.of("lent").sort((a, b) => (a.returned === b.returned ? (a.date < b.date ? -1 : 1) : a.returned ? 1 : -1));

  async function save(kind, item, close) {
    try { await life.save(item); close(null); showToast("Saved", "✅"); } catch (e) { showToast(e.message, "⚠️"); }
  }
  const wish = (o) => `https://wa.me/${(o.phone || "").replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}?text=${encodeURIComponent(o.type === "anniversary" ? `Happy anniversary, ${o.person}! 💐` : `Happy birthday, ${o.person}! 🎂 Have a great year ahead!`)}`;

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Gift size={22} color="var(--accent-solid)" />} title="People" sub="Birthdays, gifts and things you've lent.">
        <button type="button" className="chip active" onClick={() => (tab === "occasions" ? setForm({ person: "", type: "birthday", month: new Date().getMonth() + 1, day: 1, budget: "" }) : setLent({ item: "", person: "", date: today }))}><Plus size={14} /> Add</button>
      </PageHeader>
      <div className="h-scroll" style={{ marginBottom: 12 }}>
        {[["occasions", `Occasions (${occasions.length})`], ["lent", `Lent out (${lentItems.filter((x) => !x.returned).length})`]].map(([id, l]) => <button key={id} type="button" className={`chip${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>

      {tab === "occasions" && (
        <>
          {form && (
            <form onSubmit={(e) => { e.preventDefault(); save("occasion", { kind: "occasion", id: form.id, data: { person: form.person, type: form.type, month: form.month, day: form.day, budget: form.budget, phone: form.phone, note: form.note } }, setForm); }}
              className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="h-scroll">{TYPES.map(([k, l]) => <button key={k} type="button" className={`chip${form.type === k ? " active" : ""}`} onClick={() => setForm({ ...form, type: k })}>{l}</button>)}</div>
                <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
              </div>
              <input value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="Who? e.g. Amma, Ravi" maxLength={40} />
              <div style={{ display: "flex", gap: 8 }}>
                <select value={form.day} onChange={(e) => setForm({ ...form, day: +e.target.value })} aria-label="Day" style={{ width: 90 }}>{[...Array(31)].map((_, k) => <option key={k + 1} value={k + 1}>{k + 1}</option>)}</select>
                <select value={form.month} onChange={(e) => setForm({ ...form, month: +e.target.value })} aria-label="Month" style={{ flex: 1 }}>{MONTHS.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}</select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" inputMode="decimal" value={form.budget ?? ""} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="Gift budget ₹" style={{ flex: 1 }} />
                <input type="tel" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="WhatsApp number (optional)" style={{ flex: 1 }} />
              </div>
              <button type="submit" className="btn btn-primary btn-block">Save</button>
            </form>
          )}
          {occasions.length === 0 && !form && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>Add birthdays and anniversaries. You&apos;ll get a reminder a week before (time to plan a gift) and on the day.</div>}
          {occasions.map((o) => {
            const past = gifts.filter((g) => g.refId === o.id).sort((a, b) => (a.date < b.date ? 1 : -1));
            return (
              <div key={o.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{TYPES.find(([k]) => k === o.type)?.[1].split(" ")[0]} {o.person}</div>
                    <div style={{ fontSize: 12, color: o.next.daysLeft <= 7 ? "var(--amber)" : "var(--muted)" }}>{o.day} {MONTHS[o.month - 1]} · {when(o.next.daysLeft)}{o.budget ? ` · budget ${fmt(o.budget)}` : ""}</div>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...o })}><Pencil size={16} /></button>
                  <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(o.id, `Delete ${o.person}'s ${o.type} and gift history?`)}><Trash2 size={16} /></button>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button type="button" className="chip" onClick={() => setGift({ refId: o.id, what: "", amount: "", date: today, logExpense: true })}>🎁 Log a gift</button>
                  {o.next.daysLeft <= 1 && <a className="chip" href={wish(o)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><MessageCircle size={14} /> Send wishes</a>}
                </div>
                {gift?.refId === o.id && (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    await save("gift", { kind: "gift", refId: o.id, date: gift.date, data: { what: gift.what, amount: gift.amount } }, setGift);
                    if (gift.logExpense && parseFloat(gift.amount) > 0) openQuickAdd({ amount: parseFloat(gift.amount), note: `Gift for ${o.person}`, category: "Shopping" });
                  }} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={gift.what} onChange={(e) => setGift({ ...gift, what: e.target.value })} placeholder="What did you give?" style={{ flex: 2 }} />
                      <input type="number" inputMode="decimal" value={gift.amount} onChange={(e) => setGift({ ...gift, amount: e.target.value })} placeholder="₹" style={{ flex: 1 }} />
                    </div>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={gift.logExpense} onChange={(e) => setGift({ ...gift, logExpense: e.target.checked })} style={{ width: 18, height: 18 }} /> Also log it as an expense</label>
                    <div style={{ display: "flex", gap: 8 }}><button type="submit" className="btn btn-primary">Save gift</button><button type="button" className="chip" onClick={() => setGift(null)}>Cancel</button></div>
                  </form>
                )}
                {past.length > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 8 }}>
                    Past gifts: {past.slice(0, 4).map((g) => `${g.what}${g.amount ? ` (${fmt(g.amount)})` : ""}, ${g.date.slice(0, 4)}`).join(" · ")}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === "lent" && (
        <>
          {lent && (
            <form onSubmit={(e) => { e.preventDefault(); save("lent", { kind: "lent", id: lent.id, date: lent.date, data: { item: lent.item, person: lent.person, note: lent.note, returned: lent.returned, returnedOn: lent.returnedOn } }, setLent); }}
              className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>Lent something</div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setLent(null)}><X size={18} /></button></div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={lent.item} onChange={(e) => setLent({ ...lent, item: e.target.value })} placeholder="What? e.g. Power bank" style={{ flex: 1 }} />
                <input value={lent.person} onChange={(e) => setLent({ ...lent, person: e.target.value })} placeholder="To whom?" style={{ flex: 1 }} />
              </div>
              <label style={{ display: "grid", gap: 3 }}><span className="field-label">Since</span><input type="date" value={lent.date} onChange={(e) => setLent({ ...lent, date: e.target.value })} /></label>
              <button type="submit" className="btn btn-primary btn-block">Save</button>
            </form>
          )}
          {lentItems.length === 0 && !lent && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>Books, chargers, tools… note who has what. For money, use Who owes what.</div>}
          {lentItems.map((x) => (
            <div key={x.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10, opacity: x.returned ? 0.55 : 1, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{x.item} → {x.person}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>since {d(x.date)}{x.returned ? ` · returned${x.returnedOn ? ` ${d(x.returnedOn)}` : ""}` : ""}</div>
              </div>
              {!x.returned && <button type="button" className="chip" onClick={() => save("lent", { kind: "lent", id: x.id, date: x.date, data: { item: x.item, person: x.person, note: x.note, returned: true, returnedOn: today } }, () => {})}>✅ Got it back</button>}
              <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(x.id, "Delete this?")}><Trash2 size={16} /></button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
