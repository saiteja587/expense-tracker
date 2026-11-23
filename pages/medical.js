// Medical: medicines (doses with reminders, stock & refill), doctor visits
// and reports (with photos, by person), and an emergency card you can open
// from the lock screen.
import { useEffect, useState } from "react";
import { Pill, Plus, Pencil, Trash2, X, Camera, Image as ImageIcon, Check } from "lucide-react";
import { useLife } from "../lib/useLife";
import { medicineDay, doseTimes } from "../lib/lifePlus";
import { fileToCompressedDataUrl } from "../lib/receiptImage";
import { apiGet } from "../lib/api";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { openQuickAdd } from "../components/QuickAddSheet";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";
import { EMERGENCY_KEY } from "../components/EmergencyInfo";

const d = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const REC_TYPES = [["visit", "🩺 Visit"], ["report", "🧪 Report"], ["prescription", "📝 Prescription"], ["vaccine", "💉 Vaccine"], ["other", "📄 Other"]];
const EM_FIELDS = [["name", "Name"], ["bloodGroup", "Blood group"], ["allergies", "Allergies"], ["conditions", "Conditions"], ["medicines", "Regular medicines"],
  ["contact1Name", "Emergency contact"], ["contact1Phone", "Their phone"], ["contact2Name", "Second contact"], ["contact2Phone", "Their phone"],
  ["insurer", "Health insurer"], ["policyNo", "Policy no."], ["doctorName", "Doctor"], ["doctorPhone", "Doctor's phone"], ["note", "Anything else"]];

async function showPhoto(id) {
  try {
    const { photo } = await apiGet("life-photo", { id });
    if (!photo) return showToast("No photo", "🖼️");
    const w = window.open("", "_blank");
    if (w) { const img = w.document.createElement("img"); img.src = photo; img.style.maxWidth = "100%"; w.document.body.appendChild(img); }
  } catch (e) { showToast(e.message, "⚠️"); }
}

export default function MedicalPage() {
  const life = useLife(["medicine", "dose", "medical", "emergency"]);
  const today = todayISO();
  const [tab, setTab] = useState("medicines");
  const [form, setForm] = useState(null);

  // Keep a copy of the emergency card on this phone for the lock screen.
  const em = life.of("emergency")[0] || null;
  useEffect(() => {
    if (!life.loaded) return;
    try { if (em) localStorage.setItem(EMERGENCY_KEY, JSON.stringify(em)); else localStorage.removeItem(EMERGENCY_KEY); } catch { /* ignore */ }
  }, [em, life.loaded]);

  if (!life.loaded) return <Loading />;
  const meds = life.of("medicine");
  const doses = life.of("dose");
  const records = life.of("medical");

  async function take(m, time, on) {
    try {
      if (on) {
        await life.save({ kind: "dose", refId: m.id, date: today, data: { time } });
        if (m.stock != null) await life.save({ kind: "medicine", id: m.id, data: { ...strip(m), stock: Math.max(0, (m.stock || 0) - (m.perDose || 1)) } });
      } else {
        const dose = doses.find((x) => x.refId === m.id && x.date === today && x.time === time);
        if (dose) await life.remove(dose.id);
        if (m.stock != null) await life.save({ kind: "medicine", id: m.id, data: { ...strip(m), stock: (m.stock || 0) + (m.perDose || 1) } });
      }
    } catch (e) { showToast(e.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Pill size={22} color="var(--danger)" />} title="Medical" sub="Medicines, doctor visits and reports, and your emergency card.">
        {tab !== "emergency" && <button type="button" className="chip active" onClick={() => setForm(tab === "medicines" ? { kind: "medicine", name: "", times: "08:00", perDose: 1 } : { kind: "medical", title: "", type: "visit", date: today })}><Plus size={14} /> Add</button>}
      </PageHeader>
      <div className="h-scroll" style={{ marginBottom: 12 }}>
        {[["medicines", "💊 Medicines"], ["records", "🩺 Visits & reports"], ["emergency", "🆘 Emergency card"]].map(([id, l]) => <button key={id} type="button" className={`chip${tab === id ? " active" : ""}`} onClick={() => { setTab(id); setForm(null); }}>{l}</button>)}
      </div>

      {form?.kind === "medicine" && <MedForm form={form} setForm={setForm} life={life} />}
      {form?.kind === "medical" && <RecordForm form={form} setForm={setForm} life={life} />}

      {tab === "medicines" && (
        <>
          {meds.length === 0 && !form && <Empty text="Add a medicine with its times. You'll get a reminder when a dose is due, and a heads-up before the strip runs out. (Reminders use the same scheduler as the water reminder.)" />}
          {meds.map((m) => {
            const day = medicineDay(m, doses, today);
            return (
              <div key={m.id} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10, opacity: m.paused ? 0.55 : 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>💊 {m.name}{m.dose ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {m.dose}</span> : null}</div>
                    <div style={{ fontSize: 12, color: day.refill ? "var(--danger)" : "var(--muted)" }}>
                      {[m.person && `for ${m.person}`, m.stock != null && `${m.stock} left`, day.daysLeft != null && `~${day.daysLeft} days`, day.refill && "time to refill", m.paused && "paused"].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...m, kind: "medicine" })}><Pencil size={16} /></button>
                  <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(m.id, `Delete ${m.name}?`)}><Trash2 size={16} /></button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {day.times.map((t) => (
                    <button key={t.time} type="button" className={`chip${t.taken ? " active" : ""}`} aria-pressed={t.taken} onClick={() => take(m, t.time, !t.taken)}>
                      {t.taken ? <Check size={14} /> : "⏰"} {t.time}
                    </button>
                  ))}
                  {day.refill && <button type="button" className="chip" onClick={() => openQuickAdd({ note: `${m.name} refill`, category: "Health" })}>🛒 Log refill cost</button>}
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === "records" && (
        <>
          {records.length === 0 && !form && <Empty text="Keep prescriptions, lab reports and vaccine records in one place, for you and your family." />}
          {[...new Set(records.map((r) => r.person || "Me"))].map((person) => (
            <div key={person} style={{ marginBottom: 12 }}>
              <div className="field-label">{person}</div>
              {records.filter((r) => (r.person || "Me") === person).map((r) => (
                <div key={r.id} className="card" style={{ borderRadius: 14, padding: 12, marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{REC_TYPES.find(([k]) => k === r.type)?.[1].split(" ")[0]} {r.title}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{[d(r.date), r.doctor, r.amount && fmt(r.amount), r.note].filter(Boolean).join(" · ")}</div>
                  </div>
                  {r.hasPhoto && <button type="button" className="icon-btn" aria-label="Photo" onClick={() => showPhoto(r.id)}><ImageIcon size={16} /></button>}
                  <button type="button" className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...r, kind: "medical" })}><Pencil size={16} /></button>
                  <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => life.remove(r.id, `Delete ${r.title}?`)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === "emergency" && <EmergencyForm em={em} life={life} />}
    </div>
  );
}

const MED_FIELDS = ["name", "dose", "times", "stock", "perDose", "refillAt", "person", "paused", "note"];
function strip(m) { const o = {}; for (const f of MED_FIELDS) if (m[f] !== undefined && m[f] !== "") o[f] = m[f]; return o; }
const Empty = ({ text }) => <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>{text}</div>;

function MedForm({ form, setForm, life }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!doseTimes(form).length) return showToast("Add at least one time, like 08:00", "⚠️");
    try { await life.save({ kind: "medicine", id: form.id, data: strip(form) }); setForm(null); } catch (err) { showToast(err.message, "⚠️"); }
  }
  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit" : "Add"} medicine</div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button></div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.name || ""} onChange={set("name")} placeholder="Name, e.g. Vitamin D3" style={{ flex: 2 }} />
        <input value={form.dose || ""} onChange={set("dose")} placeholder="Dose, e.g. 1 tablet" style={{ flex: 1 }} />
      </div>
      <label style={{ display: "grid", gap: 3 }}><span className="field-label">Times (comma-separated, 24-hour)</span><input value={form.times || ""} onChange={set("times")} placeholder="08:00, 20:00" /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Tablets left</span><input type="number" inputMode="numeric" value={form.stock ?? ""} onChange={set("stock")} /></label>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Per dose</span><input type="number" inputMode="decimal" value={form.perDose ?? 1} onChange={set("perDose")} /></label>
        <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Remind at</span><input type="number" inputMode="numeric" value={form.refillAt ?? ""} onChange={set("refillAt")} placeholder="5 left" /></label>
      </div>
      <input value={form.person || ""} onChange={set("person")} placeholder="For whom? (blank = you)" />
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={!!form.paused} onChange={set("paused")} style={{ width: 18, height: 18 }} /> Paused (no reminders)</label>
      <button type="submit" className="btn btn-primary btn-block">Save</button>
    </form>
  );
}

function RecordForm({ form, setForm, life }) {
  const [photo, setPhoto] = useState(undefined);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    try {
      await life.save({ kind: "medical", id: form.id, date: form.date, photo, data: { title: form.title, person: form.person, type: form.type, doctor: form.doctor, amount: form.amount, note: form.note } });
      if (!form.id && parseFloat(form.amount) > 0 && window.confirm("Also log the cost as a Health expense?")) openQuickAdd({ amount: parseFloat(form.amount), note: form.title, category: "Health" });
      setForm(null);
    } catch (err) { showToast(err.message, "⚠️"); }
  }
  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="h-scroll">{REC_TYPES.map(([k, l]) => <button key={k} type="button" className={`chip${form.type === k ? " active" : ""}`} onClick={() => setForm({ ...form, type: k })}>{l}</button>)}</div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
      </div>
      <input value={form.title || ""} onChange={set("title")} placeholder="e.g. Thyroid test, Dr. Rao check-up" />
      <div style={{ display: "flex", gap: 8 }}>
        <input type="date" value={form.date || ""} onChange={set("date")} style={{ flex: 1 }} />
        <input value={form.person || ""} onChange={set("person")} placeholder="Whose? (blank = you)" style={{ flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.doctor || ""} onChange={set("doctor")} placeholder="Doctor / lab" style={{ flex: 2 }} />
        <input type="number" inputMode="decimal" value={form.amount ?? ""} onChange={set("amount")} placeholder="Cost ₹" style={{ flex: 1 }} />
      </div>
      <input value={form.note || ""} onChange={set("note")} placeholder="Note (results, next visit…)" />
      <label className="chip" style={{ cursor: "pointer", justifySelf: "start" }}><Camera size={14} /> {photo ? "Photo ✓" : form.hasPhoto ? "Replace photo" : "Photo of report / prescription"}
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setPhoto(await fileToCompressedDataUrl(f, { maxDimension: 1600, quality: 0.65 })); }} /></label>
      <button type="submit" className="btn btn-primary btn-block">Save</button>
    </form>
  );
}

function EmergencyForm({ em, life }) {
  const [f, setF] = useState(() => ({ ...(em || {}) }));
  async function save(e) {
    e.preventDefault();
    const data = {};
    for (const [k] of EM_FIELDS) if (f[k]) data[k] = f[k];
    try { await life.save({ kind: "emergency", id: em?.id, data }); showToast("Emergency card saved on this phone too", "🆘"); } catch (err) { showToast(err.message, "⚠️"); }
  }
  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, display: "grid", gap: 8 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
        Shown on the lock screen with <b>🆘 Emergency info</b>, so someone helping you can see it <b>without your PIN</b>. Only add what you&apos;re happy for a stranger to read. It&apos;s kept on this phone; open this page once on each phone to copy it there.
      </div>
      {EM_FIELDS.map(([k, label]) => (
        <label key={k} style={{ display: "grid", gap: 3 }}>
          <span className="field-label">{label}</span>
          <input value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} type={/Phone/.test(k) ? "tel" : "text"} />
        </label>
      ))}
      <button type="submit" className="btn btn-primary btn-block">Save</button>
    </form>
  );
}
