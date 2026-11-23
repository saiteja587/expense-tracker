// Wishlist with the 30-day rule: note what you want and a target price;
// if you still want it after 30 days (or the price drops to your target),
// buy it. Checking prices is up to you; shops don't offer a free API.
import { useState } from "react";
import { ShoppingBag, Plus, Pencil, Trash2, X, ExternalLink } from "lucide-react";
import { useLife } from "../lib/useLife";
import { wishStatus } from "../lib/lifePlus";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { openQuickAdd } from "../components/QuickAddSheet";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

const FIELDS = ["name", "link", "target", "price", "bought", "boughtPrice", "note"];
const strip = (w) => Object.fromEntries(FIELDS.filter((f) => w[f] !== undefined && w[f] !== "").map((f) => [f, w[f]]));

export default function WishlistPage() {
  const life = useLife(["wish"]);
  const today = todayISO();
  const [form, setForm] = useState(null);
  if (!life.loaded) return <Loading />;
  const items = life.of("wish").map((w) => ({ ...w, st: wishStatus(w, today) }));
  const open = items.filter((w) => !w.bought).sort((a, b) => b.st.waited - a.st.waited);
  const bought = items.filter((w) => w.bought);
  const skipped = open.filter((w) => w.st.waited >= 60);

  async function save(e) {
    e.preventDefault();
    try { await life.save({ kind: "wish", id: form.id, date: form.date || today, data: strip(form) }); setForm(null); } catch (err) { showToast(err.message, "⚠️"); }
  }
  async function markBought(w) {
    const p = window.prompt(`What did you pay for ${w.name}?`, String(w.price || w.target || ""));
    if (p === null) return;
    const paid = parseFloat(p) || 0;
    await life.save({ kind: "wish", id: w.id, date: w.date, data: { ...strip(w), bought: true, boughtPrice: paid } });
    if (paid > 0) openQuickAdd({ amount: paid, note: w.name, category: "Shopping" });
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<ShoppingBag size={22} color="var(--accent-solid)" />} title="Wishlist" sub="Wait 30 days before buying. If you still want it, it's worth it.">
        <button type="button" className="chip active" onClick={() => setForm({ name: "", target: "", price: "", link: "" })}><Plus size={14} /> Add</button>
      </PageHeader>

      {form && (
        <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit" : "I want…"}</div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button></div>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Noise-cancelling headphones" />
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Price now ₹</span><input type="number" inputMode="decimal" value={form.price ?? ""} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">I&apos;d buy at ₹</span><input type="number" inputMode="decimal" value={form.target ?? ""} onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
          </div>
          <input value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="Link (optional)" />
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}

      {skipped.length > 0 && <div className="panel-soft" style={{ borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, background: "var(--success-bg)" }}>🎉 {skipped.length} thing{skipped.length === 1 ? "" : "s"} waiting 60+ days: {fmt(skipped.reduce((s, w) => s + (w.price || w.target || 0), 0))} you haven&apos;t spent. Still want {skipped.length === 1 ? "it" : "them"}?</div>}
      {open.length === 0 && !form && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>Next time you&apos;re about to buy something non-essential, add it here instead and wait.</div>}
      {open.map((w) => (
        <div key={w.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{w.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{[w.price && `${fmt(w.price)} now`, w.target && `target ${fmt(w.target)}`].filter(Boolean).join(" · ")}</div>
              <div style={{ fontSize: 12.5, marginTop: 3, color: w.st.atTarget || w.st.coolingDone ? "var(--success)" : "var(--amber)" }}>
                {w.st.atTarget ? "✅ At your target price" : w.st.coolingDone ? `✅ Waited ${w.st.waited} days; buy it if you still want it` : `⏳ Day ${w.st.waited} of 30`}
              </div>
            </div>
            {w.link && <a className="icon-btn" href={/^https?:\/\//.test(w.link) ? w.link : `https://${w.link}`} target="_blank" rel="noopener noreferrer" aria-label="Open link"><ExternalLink size={16} /></a>}
            <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...w })}><Pencil size={16} /></button>
            <button type="button" className="icon-btn danger" aria-label="Don't want it any more" onClick={() => life.remove(w.id, `Remove ${w.name}? (Nice, money saved!)`)}><Trash2 size={16} /></button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="chip" onClick={async () => { const p = window.prompt("Price now ₹", String(w.price || "")); if (p) await life.save({ kind: "wish", id: w.id, date: w.date, data: { ...strip(w), price: p } }); }}>Update price</button>
            <button type="button" className="chip" onClick={() => markBought(w)}>🛍️ Bought it</button>
          </div>
        </div>
      ))}
      {bought.length > 0 && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>Bought: {bought.map((w) => `${w.name}${w.boughtPrice ? ` (${fmt(w.boughtPrice)})` : ""}`).join(", ")}</div>}
    </div>
  );
}
