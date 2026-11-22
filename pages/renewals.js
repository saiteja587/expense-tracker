// Renewals, warranties & documents: things with a date that cost money if
// you miss them (insurance, PUC, licence, passport…), warranty bills, and
// ID documents with their numbers sealed in your vault.
import { useState } from "react";
import { CalendarClock, Plus, Pencil, Trash2, X, Camera, Image as ImageIcon } from "lucide-react";
import { useLife } from "../lib/useLife";
import { dueStatus, addMonths, warrantyEnds } from "../lib/life";
import { sealSecrets, openSecrets, checkVaultPassphrase } from "../lib/vault";
import { fileToCompressedDataUrl } from "../lib/receiptImage";
import { apiGet } from "../lib/api";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { openQuickAdd } from "../components/QuickAddSheet";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";
import { RevealSecrets } from "../components/CardVault";

const d = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const RENEWAL_CATS = [["insurance", "🛡️ Insurance"], ["vehicle", "🛵 Vehicle (PUC, RC…)"], ["id", "🪪 ID (passport, licence)"], ["home", "🏠 Home (rent, Wi-Fi)"], ["subscription", "🔁 Subscription"], ["other", "📌 Other"]];
const DOC_TYPES = [["aadhaar", "Aadhaar"], ["pan", "PAN"], ["passport", "Passport"], ["licence", "Driving licence"], ["voter", "Voter ID"], ["insurance", "Insurance policy"], ["bank", "Bank / passbook"], ["other", "Other"]];
const IDEAS = [["Bike / car insurance", "insurance", 12], ["Health insurance", "insurance", 12], ["PUC certificate", "vehicle", 6], ["Driving licence", "id", 240], ["Passport", "id", 120], ["Rent agreement", "home", 11], ["Wi-Fi / broadband plan", "home", 12]];

function Badge({ due, today }) {
  const st = dueStatus(due, today);
  if (st.daysLeft == null) return null;
  const color = st.level === "overdue" ? "var(--danger)" : st.level === "soon" ? "var(--amber)" : st.level === "month" ? "var(--warn)" : "var(--muted)";
  const text = st.daysLeft < 0 ? `${-st.daysLeft} days overdue` : st.daysLeft === 0 ? "today" : st.daysLeft === 1 ? "tomorrow" : `in ${st.daysLeft} days`;
  return <span style={{ fontSize: 12, color, fontWeight: st.level === "ok" ? 400 : 600 }}>{text}</span>;
}

async function showPhoto(id) {
  try {
    const { photo } = await apiGet("life-photo", { id });
    if (!photo) return showToast("No photo", "🖼️");
    const w = window.open("", "_blank");
    if (w) { w.document.title = "Photo"; const img = w.document.createElement("img"); img.src = photo; img.style.maxWidth = "100%"; w.document.body.appendChild(img); }
  } catch (e) { showToast(e.message, "⚠️"); }
}

export default function RenewalsPage() {
  const life = useLife(["renewal", "warranty", "document"]);
  const today = todayISO();
  const [tab, setTab] = useState("renewal");
  const [form, setForm] = useState(null);
  if (!life.loaded) return <Loading />;

  const renewals = life.of("renewal").sort((a, b) => (a.date || "9") < (b.date || "9") ? -1 : 1);
  const warranties = life.of("warranty").map((w) => ({ ...w, ends: warrantyEnds(w) })).sort((a, b) => (a.ends < b.ends ? -1 : 1));
  const docs = life.of("document");

  async function renewed(r) {
    if (!r.everyMonths) { setForm({ ...r, kind: "renewal" }); return; }
    const next = addMonths(r.date || today, r.everyMonths);
    if (!window.confirm(`Mark ${r.name} renewed? Next due date: ${d(next)}.`)) return;
    try {
      await life.save({ kind: "renewal", id: r.id, date: next, data: strip(r, "renewal") });
      showToast(`Next due ${d(next)}`, "✅");
      if (r.amount) openQuickAdd({ amount: r.amount, note: r.name, category: r.category === "vehicle" ? "Transport" : "Bills" });
    } catch (e) { showToast(e.message, "⚠️"); }
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<CalendarClock size={22} color="var(--accent-solid)" />} title="Renewals & documents" sub="Reminders 30, 7 and 1 day before anything expires.">
        <button type="button" className="chip active" onClick={() => setForm({ kind: tab, name: "", date: tab === "warranty" ? today : "" })}><Plus size={14} /> Add</button>
      </PageHeader>
      <div className="h-scroll" style={{ marginBottom: 12 }}>
        {[["renewal", `Renewals (${renewals.length})`], ["warranty", `Warranties (${warranties.length})`], ["document", `Documents (${docs.length})`]].map(([id, l]) => (
          <button key={id} type="button" className={`chip${tab === id ? " active" : ""}`} onClick={() => { setTab(id); setForm(null); }}>{l}</button>
        ))}
      </div>

      {form && <ItemForm form={form} setForm={setForm} life={life} today={today} />}

      {tab === "renewal" && renewals.map((r) => (
        <Row key={r.id} title={r.name} sub={[RENEWAL_CATS.find(([k]) => k === r.category)?.[1], r.provider, r.policyNo && `#${r.policyNo}`, r.amount && fmt(r.amount), r.everyMonths && `every ${r.everyMonths} mo`].filter(Boolean).join(" · ")}
          right={<><div style={{ fontSize: 13 }}>{d(r.date)}</div><Badge due={r.date} today={today} /></>}
          onEdit={() => setForm({ ...r, kind: "renewal" })} onDelete={() => life.remove(r.id, `Delete ${r.name}?`)}>
          <button type="button" className="chip" onClick={() => renewed(r)}>✅ Renewed</button>
        </Row>
      ))}
      {tab === "renewal" && renewals.length === 0 && !form && <Empty text="Add insurance, PUC, licence, passport, rent agreement… anything with an expiry date." />}

      {tab === "warranty" && warranties.map((w) => (
        <Row key={w.id} title={w.name} sub={[w.store, w.price && fmt(w.price), `bought ${d(w.date)}`, w.serial && `S/N ${w.serial}`].filter(Boolean).join(" · ")}
          right={<><div style={{ fontSize: 13 }}>until {d(w.ends)}</div><Badge due={w.ends} today={today} /></>}
          onEdit={() => setForm({ ...w, kind: "warranty" })} onDelete={() => life.remove(w.id, `Delete ${w.name}?`)}>
          {w.hasPhoto && <button type="button" className="chip" onClick={() => showPhoto(w.id)}><ImageIcon size={14} /> Bill</button>}
        </Row>
      ))}
      {tab === "warranty" && warranties.length === 0 && !form && <Empty text="Snap the bill when you buy a phone, TV or appliance; you'll be reminded before the warranty runs out." />}

      {tab === "document" && docs.map((x) => (
        <Row key={x.id} title={x.name} sub={[DOC_TYPES.find(([k]) => k === x.type)?.[1], x.holder, x.date && `expires ${d(x.date)}`].filter(Boolean).join(" · ")}
          right={x.date ? <Badge due={x.date} today={today} /> : null}
          onEdit={() => setForm({ ...x, kind: "document" })} onDelete={() => life.remove(x.id, `Delete ${x.name}? Its photo and sealed number go too.`)}>
          {x.hasPhoto && <button type="button" className="chip" onClick={() => showPhoto(x.id)}><ImageIcon size={14} /> Photo</button>}
          <div style={{ width: "100%" }}><RevealSecrets vault={x.vault} /></div>
        </Row>
      ))}
      {tab === "document" && docs.length === 0 && !form && <Empty text="Keep your Aadhaar, PAN, passport and policy numbers handy. The numbers are sealed with your vault passphrase." />}
    </div>
  );
}

const FIELDS = {
  renewal: ["name", "category", "amount", "everyMonths", "provider", "policyNo", "note"],
  warranty: ["name", "store", "price", "months", "serial", "note"],
  document: ["name", "type", "holder", "note"],
};
function strip(item, kind) {
  const o = {};
  for (const f of FIELDS[kind]) if (item[f] !== undefined && item[f] !== "") o[f] = item[f];
  return o;
}

function Row({ title, sub, right, onEdit, onDelete, children }) {
  return (
    <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</div>}
        </div>
        <div style={{ textAlign: "right" }}>{right}</div>
        <button type="button" className="icon-btn" aria-label={`Edit ${title}`} onClick={onEdit}><Pencil size={16} /></button>
        <button type="button" className="icon-btn danger" aria-label={`Delete ${title}`} onClick={onDelete}><Trash2 size={16} /></button>
      </div>
      {children && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>{children}</div>}
    </div>
  );
}
const Empty = ({ text }) => <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)" }}>{text}</div>;

function ItemForm({ form, setForm, life, today }) {
  const kind = form.kind;
  const [photo, setPhoto] = useState(undefined);
  const [secret, setSecret] = useState(null); // documents: { number, pass }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function onPhoto(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) try { setPhoto(await fileToCompressedDataUrl(f, { maxDimension: 1400, quality: 0.6 })); } catch { setError("Couldn't read that photo"); }
  }
  async function unlock() {
    try { const s = form.vault ? await openSecrets(form.vault, secret.pass) : {}; setSecret({ ...secret, number: s.number || "", unlocked: true }); setError(""); } catch (e) { setError(e.message); }
  }
  async function save(e) {
    e.preventDefault();
    if (!form.name?.trim()) return setError("Give it a name");
    if (kind === "warranty" && !form.date) return setError("When did you buy it?");
    setBusy(true); setError("");
    try {
      let vault;
      if (kind === "document" && secret?.unlocked) {
        if (secret.number.trim()) { await checkVaultPassphrase(secret.pass); vault = await sealSecrets({ number: secret.number.trim() }, secret.pass); }
        else vault = "";
      }
      await life.save({ kind, id: form.id, date: form.date || null, data: strip(form, kind), photo, vault });
      setForm(null);
      showToast("Saved", "✅");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? "Edit" : "Add"} {kind}</div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
      </div>
      {kind === "renewal" && !form.id && (
        <div className="h-scroll">{IDEAS.map(([name, category, everyMonths]) => <button key={name} type="button" className="chip" onClick={() => setForm({ ...form, name, category, everyMonths })}>{name}</button>)}</div>
      )}
      <input value={form.name || ""} onChange={set("name")} placeholder={kind === "warranty" ? "Product, e.g. Samsung TV" : kind === "document" ? "e.g. My PAN card" : "e.g. Bike insurance"} maxLength={60} />

      {kind === "renewal" && (
        <>
          <select value={form.category || ""} onChange={set("category")}><option value="">Type…</option>{RENEWAL_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Due / expiry date</span><input type="date" value={form.date || ""} onChange={set("date")} /></label>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Cost ₹</span><input type="number" inputMode="decimal" value={form.amount ?? ""} onChange={set("amount")} /></label>
            <label style={{ width: 100, display: "grid", gap: 3 }}><span className="field-label">Every (months)</span><input type="number" inputMode="numeric" value={form.everyMonths ?? ""} onChange={set("everyMonths")} /></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.provider || ""} onChange={set("provider")} placeholder="Provider (optional)" style={{ flex: 1 }} />
            <input value={form.policyNo || ""} onChange={set("policyNo")} placeholder="Policy / ref no." style={{ flex: 1 }} />
          </div>
        </>
      )}

      {kind === "warranty" && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Bought on</span><input type="date" value={form.date || today} onChange={set("date")} /></label>
            <label style={{ width: 110, display: "grid", gap: 3 }}><span className="field-label">Warranty (months)</span><input type="number" inputMode="numeric" value={form.months ?? ""} onChange={set("months")} placeholder="12" /></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.store || ""} onChange={set("store")} placeholder="Store / site" style={{ flex: 1 }} />
            <input type="number" inputMode="decimal" value={form.price ?? ""} onChange={set("price")} placeholder="Price ₹" style={{ width: 120 }} />
          </div>
          <input value={form.serial || ""} onChange={set("serial")} placeholder="Serial / IMEI (optional)" />
        </>
      )}

      {kind === "document" && (
        <>
          <select value={form.type || ""} onChange={set("type")}><option value="">Type…</option>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.holder || ""} onChange={set("holder")} placeholder="Whose? (you, mom…)" style={{ flex: 1 }} />
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Expires (if any)</span><input type="date" value={form.date || ""} onChange={set("date")} /></label>
          </div>
          {!secret && <button type="button" className="chip" onClick={() => setSecret({ number: "", pass: "", unlocked: !form.vault })}>🔐 {form.vault ? "Change the sealed number" : "Add the number (sealed)"}</button>}
          {secret && !secret.unlocked && (
            <div style={{ display: "flex", gap: 8 }}><input type="password" value={secret.pass} onChange={(e) => setSecret({ ...secret, pass: e.target.value })} placeholder="Vault passphrase" style={{ flex: 1 }} /><button type="button" className="chip" onClick={unlock}>Unlock</button></div>
          )}
          {secret?.unlocked && (
            <>
              <input value={secret.number} onChange={(e) => setSecret({ ...secret, number: e.target.value })} placeholder="Document number" autoComplete="off" />
              {!form.vault && <input type="password" value={secret.pass} onChange={(e) => setSecret({ ...secret, pass: e.target.value })} placeholder="Vault passphrase (same as for your cards)" autoComplete="new-password" />}
            </>
          )}
        </>
      )}

      {kind !== "renewal" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label className="chip" style={{ cursor: "pointer" }}><Camera size={14} /> {photo ? "Photo ✓" : form.hasPhoto ? "Replace photo" : kind === "warranty" ? "Photo of bill" : "Photo"}
            <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: "none" }} /></label>
          {(photo || form.hasPhoto) && <button type="button" className="chip" onClick={() => setPhoto("")}>Remove photo</button>}
        </div>
      )}
      <input value={form.note || ""} onChange={set("note")} placeholder="Note (optional)" maxLength={200} />
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </form>
  );
}
