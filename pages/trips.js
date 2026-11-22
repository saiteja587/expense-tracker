// Trips & events: give a date range a name ("Goa", "Diwali shopping"),
// tag its expenses (quick-add does it automatically while a trip is on),
// and see the total, per person, per day and by category.
import { useMemo, useState } from "react";
import { Plane, Plus, Pencil, Trash2, X, Tag } from "lucide-react";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { tripSummary, activeTrip } from "../lib/money";
import { categoryEmoji } from "../lib/categories";
import { apiPost, apiPut, apiDelete } from "../lib/api";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle, Stat } from "../components/PageHeader";

const d = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

export default function TripsPage() {
  const { data, today, loaded } = useLedger();
  const [form, setForm] = useState(null);
  const [openId, setOpenId] = useState(null);

  const trips = useMemo(() => (data ? (data.trips || []).map((t) => ({ ...t, sum: tripSummary(t, data.expenses) })) : null), [data]);
  if (!loaded || !trips) return <Loading />;
  const current = activeTrip(data.trips || [], today);

  async function save(e) {
    e.preventDefault();
    try {
      const body = { type: "trip", ...form, budget: parseFloat(form.budget) || 0, people: parseInt(form.people, 10) || 1 };
      const r = form.id ? await apiPut(body) : await apiPost(body);
      notifyLedgerChanged();
      setForm(null);
      showToast(r.tagged ? `Trip saved · ${r.tagged} expense${r.tagged === 1 ? "" : "s"} tagged` : "Trip saved", "✈️");
    } catch (err) { showToast(err.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Plane size={22} color="var(--accent-solid)" />} title="Trips & events" sub="What a trip or an occasion really cost, per person and per day.">
        <button type="button" className="chip active" onClick={() => setForm({ name: "", startDate: todayISO(), endDate: "", budget: "", people: "1", note: "", tagExisting: true })}><Plus size={14} /> New</button>
      </PageHeader>

      {current && <div className="panel-soft" style={{ borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 13, background: "var(--success-bg)" }}>✈️ <b>{current.name}</b> is on. New expenses are added to it automatically (you can untick it in quick-add).</div>}

      {form && (
        <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit trip" : "New trip or event"}</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
          </div>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, e.g. Goa with college gang" maxLength={60} />
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">From</span><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">To (blank = ongoing)</span><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Budget (optional)</span><input type="number" inputMode="decimal" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></label>
            <label style={{ width: 110, display: "grid", gap: 3 }}><span className="field-label">People</span><input type="number" inputMode="numeric" min="1" value={form.people} onChange={(e) => setForm({ ...form, people: e.target.value })} /></label>
          </div>
          {!form.id && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={form.tagExisting} onChange={(e) => setForm({ ...form, tagExisting: e.target.checked })} style={{ width: 18, height: 18 }} /> Add expenses already logged in these dates</label>}
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}

      {trips.length === 0 && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>No trips yet. Create one before you leave and everything you log during it is tagged automatically.</div>}

      {trips.map((t) => {
        const s = t.sum;
        const open = openId === t.id;
        return (
          <div key={t.id} className="card" style={{ borderRadius: 18, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <button type="button" onClick={() => setOpenId(open ? null : t.id)} style={{ flex: 1, background: "none", border: "none", padding: 0, textAlign: "left", color: "inherit", cursor: "pointer" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{d(t.startDate)}{t.endDate ? ` – ${d(t.endDate)}` : " – ongoing"} · {t.people} {t.people === 1 ? "person" : "people"} · {s.items.length} expenses</div>
              </button>
              <button type="button" className="icon-btn" aria-label="Tag expenses in these dates" title="Add untagged expenses from these dates" onClick={async () => {
                try { const r = await apiPost({ type: "trip-tag", id: t.id }); notifyLedgerChanged(); showToast(`${r.tagged} expense${r.tagged === 1 ? "" : "s"} added`, "🏷️"); } catch (e) { showToast(e.message, "⚠️"); }
              }}><Tag size={16} /></button>
              <button type="button" className="icon-btn" aria-label="Edit trip" onClick={() => setForm({ ...t, budget: t.budget ? String(t.budget) : "", people: String(t.people) })}><Pencil size={16} /></button>
              <button type="button" className="icon-btn danger" aria-label="Delete trip" onClick={async () => {
                if (!window.confirm(`Delete ${t.name}? Its expenses stay, just untagged.`)) return;
                try { await apiDelete("trip", t.id); notifyLedgerChanged(); } catch (e) { showToast(e.message, "⚠️"); }
              }}><Trash2 size={16} /></button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <Stat label="Total" value={fmt(s.total)} />
              {t.people > 1 && <Stat label="Per person" value={fmt(s.perPerson)} />}
              <Stat label="Per day" value={fmt(s.perDay)} />
              {s.budgetLeft != null && <Stat label={s.budgetLeft >= 0 ? "Budget left" : "Over budget"} value={fmt(Math.abs(s.budgetLeft))} tone={s.budgetLeft >= 0 ? "good" : "bad"} />}
            </div>
            {open && (
              <div style={{ marginTop: 12 }}>
                {s.byCategory.map((c) => (
                  <div key={c.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
                    <span>{categoryEmoji(c.name, data.customCategories)} {c.name}</span><span className="tabnum">{fmt(c.value)}</span>
                  </div>
                ))}
                <div className="field-label" style={{ marginTop: 10 }}>Every expense</div>
                {s.items.map((x) => (
                  <div key={x.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: "var(--text-2)" }}>
                    <span>{d(x.date)} · {x.note || x.category}</span><span className="tabnum">{fmt(x.amount)}</span>
                  </div>
                ))}
                {t.people > 1 && s.total > 0 && (
                  <a className="chip" style={{ marginTop: 10, textDecoration: "none", display: "inline-flex" }} href={`https://wa.me/?text=${encodeURIComponent(`${t.name}: total ${fmt(s.total)} for ${t.people} people = ${fmt(s.perPerson)} each 🙂`)}`} target="_blank" rel="noopener noreferrer">
                    Share the split on WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
