// Vehicles: fuel fills → real mileage (km/L), cost per km, and when the next
// service is due by kilometres. A fill can also be logged as an expense.
import { useState } from "react";
import { Bike, Plus, Pencil, Trash2, X, Fuel, Wrench } from "lucide-react";
import { useLife } from "../lib/useLife";
import { vehicleStats } from "../lib/life";
import { apiPost } from "../lib/api";
import { notifyLedgerChanged } from "../lib/useLedger";
import { newRequestId } from "../lib/offlineQueue";
import { fmt, todayISO, nowHHMM } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle, Stat } from "../components/PageHeader";

const TYPES = [["bike", "🏍️ Bike"], ["scooter", "🛵 Scooter"], ["car", "🚗 Car"], ["other", "🚙 Other"]];
const d = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function VehiclesPage() {
  const life = useLife(["vehicle", "fuel"]);
  const today = todayISO();
  const [form, setForm] = useState(null);
  const [fill, setFill] = useState(null);
  if (!life.loaded) return <Loading />;
  const vehicles = life.of("vehicle");
  const fuel = life.of("fuel");

  async function saveVehicle(e) {
    e.preventDefault();
    try {
      await life.save({ kind: "vehicle", id: form.id, data: { name: form.name, type: form.type, number: form.number, serviceEveryKm: form.serviceEveryKm, lastServiceKm: form.lastServiceKm, lastServiceDate: form.lastServiceDate } });
      setForm(null);
    } catch (err) { showToast(err.message, "⚠️"); }
  }
  async function saveFill(e) {
    e.preventDefault();
    const amount = parseFloat(fill.amount) || 0;
    if (!(parseFloat(fill.litres) > 0) && !amount) return showToast("Enter litres or the amount", "⚠️");
    try {
      await life.save({ kind: "fuel", refId: fill.vehicleId, date: fill.date, data: { odometer: fill.odometer, litres: fill.litres, amount, full: fill.full, note: fill.note } });
      if (fill.addExpense && amount > 0) {
        const v = vehicles.find((x) => x.id === fill.vehicleId);
        await apiPost({ type: "expenses", clientRequestId: newRequestId(), amount, category: "Transport", note: `Fuel — ${v?.name || "vehicle"}`, date: fill.date, time: fill.date === today ? nowHHMM() : "" });
        notifyLedgerChanged();
      }
      setFill(null);
      showToast("Fill saved", "⛽");
    } catch (err) { showToast(err.message, "⚠️"); }
  }
  async function serviced(v, st) {
    const km = window.prompt(`Serviced ${v.name} today? Odometer reading (km):`, String(st.odometer || ""));
    if (!km) return;
    try {
      await life.save({ kind: "vehicle", id: v.id, data: { name: v.name, type: v.type, number: v.number, serviceEveryKm: v.serviceEveryKm, lastServiceKm: parseInt(km, 10), lastServiceDate: today } });
      showToast("Service recorded", "🔧");
    } catch (err) { showToast(err.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Bike size={22} color="var(--accent-solid)" />} title="Vehicles" sub="Mileage, fuel cost per km, and service reminders.">
        <button type="button" className="chip active" onClick={() => setForm({ name: "", type: "bike", number: "", serviceEveryKm: "", lastServiceKm: "" })}><Plus size={14} /> Vehicle</button>
      </PageHeader>

      {form && (
        <form onSubmit={saveVehicle} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="h-scroll">{TYPES.map(([k, l]) => <button key={k} type="button" className={`chip${form.type === k ? " active" : ""}`} onClick={() => setForm({ ...form, type: k })}>{l}</button>)}</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, e.g. Activa" maxLength={40} style={{ flex: 1 }} />
            <input value={form.number || ""} onChange={(e) => setForm({ ...form, number: e.target.value.toUpperCase() })} placeholder="TS09AB1234" maxLength={20} style={{ width: 140 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Service every (km)</span><input type="number" inputMode="numeric" value={form.serviceEveryKm ?? ""} onChange={(e) => setForm({ ...form, serviceEveryKm: e.target.value })} placeholder="3000" /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Last service at (km)</span><input type="number" inputMode="numeric" value={form.lastServiceKm ?? ""} onChange={(e) => setForm({ ...form, lastServiceKm: e.target.value })} /></label>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Insurance and PUC dates go in Renewals, so you get reminders for them too.</div>
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}

      {fill && (
        <form onSubmit={saveFill} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>⛽ Fuel fill</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setFill(null)}><X size={18} /></button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Amount ₹</span><input type="number" inputMode="decimal" value={fill.amount} onChange={(e) => setFill({ ...fill, amount: e.target.value })} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Litres</span><input type="number" inputMode="decimal" step="0.01" value={fill.litres} onChange={(e) => setFill({ ...fill, litres: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Odometer (km)</span><input type="number" inputMode="numeric" value={fill.odometer} onChange={(e) => setFill({ ...fill, odometer: e.target.value })} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Date</span><input type="date" value={fill.date} onChange={(e) => setFill({ ...fill, date: e.target.value })} /></label>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={fill.full} onChange={(e) => setFill({ ...fill, full: e.target.checked })} style={{ width: 18, height: 18 }} /> Filled the tank full (needed for accurate mileage)</label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={fill.addExpense} onChange={(e) => setFill({ ...fill, addExpense: e.target.checked })} style={{ width: 18, height: 18 }} /> Also log it as a Transport expense</label>
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}

      {vehicles.length === 0 && !form && <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>Add your bike or car, then log each fuel fill with the odometer reading.</div>}

      {vehicles.map((v) => {
        const st = vehicleStats(v, fuel);
        const fills = fuel.filter((f) => f.refId === v.id).sort((a, b) => (a.date < b.date ? 1 : -1));
        return (
          <div key={v.id} className="card" style={{ borderRadius: 18, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{TYPES.find(([k]) => k === v.type)?.[1].split(" ")[0]} {v.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{[v.number, st.odometer ? `${st.odometer.toLocaleString("en-IN")} km` : null].filter(Boolean).join(" · ")}</div>
              </div>
              <button type="button" className="icon-btn" aria-label="Edit vehicle" onClick={() => setForm({ ...v })}><Pencil size={16} /></button>
              <button type="button" className="icon-btn danger" aria-label="Delete vehicle" onClick={() => life.remove(v.id, `Delete ${v.name} and its fuel log?`)}><Trash2 size={16} /></button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <Stat label="Mileage" value={st.mileage ? `${st.mileage} km/L` : "—"} sub={st.mileage ? undefined : "needs 2 full-tank fills"} />
              <Stat label="Fuel cost" value={st.costPerKm ? `₹${st.costPerKm}/km` : "—"} sub={`${fmt(st.spent)} on ${st.fills} fills`} />
              {st.kmToService != null && <Stat label="Next service" value={st.kmToService <= 0 ? "Due now" : `${st.kmToService.toLocaleString("en-IN")} km`} tone={st.kmToService <= 200 ? "bad" : undefined} sub={`at ${st.nextServiceKm.toLocaleString("en-IN")} km`} />}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-primary" onClick={() => { setForm(null); setFill({ vehicleId: v.id, amount: "", litres: "", odometer: "", date: today, full: true, addExpense: true, note: "" }); }}><Fuel size={15} /> Log fuel</button>
              {v.serviceEveryKm > 0 && <button type="button" className="chip" onClick={() => serviced(v, st)}><Wrench size={14} /> Serviced</button>}
            </div>
            {fills.slice(0, 5).map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "var(--text-2)", paddingTop: 6 }}>
                <span>{d(f.date)} · {f.litres ? `${f.litres} L` : ""}{f.odometer ? ` · ${f.odometer.toLocaleString("en-IN")} km` : ""}{f.full ? " · full" : ""}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span className="tabnum">{fmt(f.amount || 0)}</span>
                  <button type="button" className="icon-btn danger" aria-label="Delete fill" onClick={() => life.remove(f.id, "Delete this fill?")}><Trash2 size={14} /></button></span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
