// "How much sugar is in this?": search a food or scan a packet's barcode
// (Open Food Facts — free, open data), see grams and teaspoons with a
// traffic-light, get a lower-sugar swap, and log what you had. Today's
// added sugar is shown against the WHO limits (ideal 25 g, max 50 g).
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { showToast } from "../lib/toast";
import { todayISO } from "../lib/format";
import { teaspoons, sugarLevel, lowerSugarSwap, DAILY_IDEAL, DAILY_MAX } from "../lib/sugarFoods";

const LEVEL = {
  low: { label: "Low sugar", color: "var(--success)", bg: "rgba(34,160,90,.12)" },
  medium: { label: "Medium sugar", color: "#B7791F", bg: "rgba(201,138,0,.14)" },
  high: { label: "High sugar", color: "var(--danger)", bg: "rgba(216,90,48,.14)" },
};
const g1 = (x) => Math.round((x || 0) * 10) / 10;

async function getJson(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Couldn't load");
  return d;
}

function Scanner({ onCode, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stream, stop = false;
    (async () => {
      try {
        // eslint-disable-next-line no-undef
        const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stop) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) { onCode(codes[0].rawValue); return; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setErr("Couldn't open the camera — type the number under the barcode instead.");
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ marginTop: 10 }}>
      {err ? <div style={{ fontSize: 13, color: "var(--danger)" }}>{err}</div> : (
        <video ref={video} muted playsInline style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 14, background: "#000" }} />
      )}
      <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8, minHeight: 40 }} onClick={onClose}>{err ? "OK" : "Stop scanning"}</button>
    </div>
  );
}

export default function FoodSugar() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null); // { item, grams eaten, sugar }
  const [log, setLog] = useState([]);
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState("");
  const canScan = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
  const today = todayISO();

  async function loadLog() {
    try { setLog((await getJson("/api/data?type=sugar-log")).log || []); } catch { /* offline */ }
  }
  useEffect(() => { loadLog(); }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const d = await getJson(`/api/data?type=food-search&q=${encodeURIComponent(term)}`);
        if (live) setRes(d);
      } catch { if (live) setRes({ common: [], products: [], offline: true }); }
      if (live) setBusy(false);
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  async function lookup(raw) {
    const c = String(raw).replace(/\D/g, "");
    setScan(false);
    if (c.length < 8) { showToast("Barcodes are 8–13 digits", "ℹ️"); return; }
    setBusy(true);
    try {
      const { product } = await getJson(`/api/data?type=food-barcode&code=${c}`);
      if (!product) showToast("Not in Open Food Facts yet — try searching by name", "🔍");
      else choose(product);
    } catch (e) { showToast(e.message, "⚠️"); }
    setBusy(false);
  }

  function choose(item) {
    if (item.grams != null) setPick({ item, kind: "common", amount: 1, sugar: item.grams });
    else {
      const amount = item.servingGrams || 100;
      setPick({ item, kind: "product", amount, sugar: g1((item.sugarPer100 * amount) / 100) });
    }
  }
  function setAmount(a) {
    const amount = Math.max(0, parseFloat(a) || 0);
    setPick((p) => ({ ...p, amount, sugar: p.kind === "common" ? g1(p.item.grams * amount) : g1((p.item.sugarPer100 * amount) / 100) }));
  }
  async function logIt() {
    const { item, kind, amount, sugar } = pick;
    const name = kind === "common" ? (amount === 1 ? item.name : `${item.name} ×${amount}`) : `${item.brand && !item.name.toLowerCase().startsWith(item.brand.toLowerCase()) ? `${item.brand} ` : ""}${item.name} (${amount} g)`;
    try {
      const r = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "sugar-log", date: today, name, grams: sugar, added: kind === "common" ? item.added : true, code: item.code || "" }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Couldn't save");
      showToast(`Logged ${sugar} g sugar`, "🍬");
      setPick(null); setQ(""); loadLog();
    } catch (e) { showToast(e.message, "⚠️"); }
  }
  async function remove(id) {
    await fetch(`/api/data?type=sugar-log&id=${id}`, { method: "DELETE" }).catch(() => {});
    loadLog();
  }

  const todays = log.filter((l) => String(l.day_date).slice(0, 10) === today);
  const added = g1(todays.filter((l) => l.added).reduce((s, l) => s + parseFloat(l.grams), 0));
  const natural = g1(todays.filter((l) => !l.added).reduce((s, l) => s + parseFloat(l.grams), 0));
  const week = (() => {
    const days = {};
    for (const l of log) {
      const d = String(l.day_date).slice(0, 10);
      if ((new Date(today) - new Date(d)) / 86400000 < 7 && l.added) days[d] = (days[d] || 0) + parseFloat(l.grams);
    }
    const n = Object.keys(days).length;
    return n ? { days: n, avg: g1(Object.values(days).reduce((s, x) => s + x, 0) / n), sugarFree: 7 - n } : null;
  })();
  const pct = Math.min(100, (added / DAILY_MAX) * 100);
  const barColor = added <= DAILY_IDEAL ? "var(--success)" : added <= DAILY_MAX ? "#C98A00" : "var(--danger)";
  const level = pick && pick.kind === "product" ? sugarLevel(pick.item.sugarPer100, pick.item.drink) : pick ? (pick.item.grams >= 20 ? "high" : pick.item.grams >= 8 ? "medium" : "low") : null;
  const swap = pick && pick.kind === "product" ? lowerSugarSwap(pick.item, res?.products || []) : null;

  return (
    <section aria-label="Sugar checker" className="card" style={{ padding: "18px 18px", borderRadius: 18, marginTop: 32 }}>
      <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>🔍 How much sugar is in it?</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, marginBottom: 12 }}>Search a food or scan a packet — then log it to see your day.</div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
          <span><b className="tabnum">{added} g</b> added sugar today <span style={{ color: "var(--muted)" }}>≈ {teaspoons(added)} tsp</span></span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>ideal &lt; {DAILY_IDEAL} g</span>
        </div>
        <div role="progressbar" aria-valuenow={added} aria-valuemin={0} aria-valuemax={DAILY_MAX} aria-label="Added sugar today" style={{ position: "relative", height: 10, borderRadius: 6, background: "var(--line)", overflow: "hidden" }}>
          <span style={{ position: "absolute", inset: 0, width: `${pct}%`, background: barColor, transition: "width .4s" }} />
          <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 2, background: "var(--bg)" }} />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
          {added === 0 ? "Nothing sweet logged today 🌿" : added <= DAILY_IDEAL ? "Within the WHO ideal." : added <= DAILY_MAX ? "Over the ideal, under the WHO max (50 g)." : "Over the WHO daily max of 50 g."}
          {natural > 0 && ` · plus ${natural} g natural sugar (fruit, milk)`}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder="e.g. Maaza, Parle-G, gulab jamun" aria-label="Search a food" style={{ flex: 1, minWidth: 0 }} />
        {canScan && <button type="button" className="chip" onClick={() => { setScan(true); setPick(null); }} aria-label="Scan a barcode">📷 Scan</button>}
      </div>
      {!canScan && (
        <form onSubmit={(e) => { e.preventDefault(); lookup(code); }} style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="…or type the barcode number" aria-label="Barcode number" style={{ flex: 1, minWidth: 0, fontSize: 13 }} />
          <button type="submit" className="chip" disabled={code.replace(/\D/g, "").length < 8}>Look up</button>
        </form>
      )}
      {scan && <Scanner onCode={lookup} onClose={() => setScan(false)} />}
      {busy && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>Looking it up…</div>}

      {pick ? (
        <div className="card" style={{ marginTop: 12, padding: 14, borderRadius: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {pick.item.image && <img src={pick.item.image} alt="" width={56} height={56} style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 10, background: "#fff", flexShrink: 0 }} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{pick.item.name}</div>
              {pick.item.brand && <div style={{ fontSize: 12, color: "var(--muted)" }}>{pick.item.brand}</div>}
              {level && <span style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", borderRadius: 10, fontSize: 11.5, fontWeight: 700, color: LEVEL[level].color, background: LEVEL[level].bg }}>{LEVEL[level].label}</span>}
            </div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 10 }} className="tabnum">{pick.sugar} g sugar</div>
          <div style={{ fontSize: 13, color: "var(--text-2)" }}>
            ≈ {teaspoons(pick.sugar)} teaspoons{pick.sugar > 0 && ` · ${Math.round((pick.sugar / DAILY_IDEAL) * 100)}% of a day's ideal`}
          </div>
          {pick.kind === "product" && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {pick.item.sugarPer100} g per 100 g{pick.item.addedPer100 != null ? ` (${pick.item.addedPer100} g added)` : ""}{pick.item.servingSize ? ` · serving: ${pick.item.servingSize}` : ""}{pick.item.nutriscore ? ` · Nutri-Score ${pick.item.nutriscore.toUpperCase()}` : ""}
            </div>
          )}
          {pick.kind === "common" && !pick.item.added && <div style={{ fontSize: 12, color: "var(--success)", marginTop: 4 }}>Natural sugar — doesn&apos;t count toward added sugar.</div>}
          {pick.kind === "common" && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Typical amount — homemade sweets vary a lot.</div>}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
            {pick.kind === "common" ? "Servings" : "How much (g or ml)"}
            <input type="number" inputMode="decimal" min="0" step={pick.kind === "common" ? 1 : 10} value={pick.amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
          </label>
          {swap && (
            <button type="button" onClick={() => choose(swap)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 10, padding: "8px 10px", borderRadius: 12, border: "1px dashed var(--success)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12.5 }}>
              💡 <b>Lower-sugar swap:</b> {[swap.brand, swap.name].filter(Boolean).join(" ")} — {swap.sugarPer100} g per 100 g ({Math.round((1 - swap.sugarPer100 / pick.item.sugarPer100) * 100)}% less)
            </button>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1, minHeight: 42 }} onClick={() => setPick(null)}>Back</button>
            <button type="button" className="btn btn-primary" style={{ flex: 2, minHeight: 42 }} onClick={logIt}>Log it for today</button>
          </div>
        </div>
      ) : res && (
        <div style={{ marginTop: 10 }}>
          {[...res.common, ...res.products].length === 0 && !busy && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{res.offline ? "Couldn't reach Open Food Facts right now." : "No match — try the brand name, or scan the barcode."}</div>
          )}
          {res.common.map((f) => (
            <button key={f.name} type="button" onClick={() => choose(f)} style={rowBtn}>
              <span style={{ fontSize: 22, width: 40, textAlign: "center" }}>{f.added ? "🍬" : "🍎"}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13.5 }}>{f.name}</b><span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>~{f.grams} g sugar{f.added ? "" : " (natural)"}</span></span>
            </button>
          ))}
          {res.products.map((p) => {
            const lv = sugarLevel(p.sugarPer100, p.drink);
            return (
              <button key={p.code} type="button" onClick={() => choose(p)} style={rowBtn}>
                {p.image ? <img src={p.image} alt="" width={40} height={40} loading="lazy" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 8, background: "#fff" }} /> : <span style={{ width: 40, textAlign: "center", fontSize: 22 }}>📦</span>}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</b>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.brand ? `${p.brand} · ` : ""}{p.sugarPer100} g / 100 g</span>
                </span>
                {lv && <span aria-label={LEVEL[lv].label} style={{ width: 10, height: 10, borderRadius: 5, background: LEVEL[lv].color, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}

      {todays.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Today</div>
          {todays.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0 }}>{l.name}</span>
              <span className="tabnum" style={{ color: l.added ? "var(--text-2)" : "var(--success)", whiteSpace: "nowrap" }}>{g1(l.grams)} g{l.added ? "" : " natural"}</span>
              <button type="button" className="icon-btn danger" aria-label={`Remove ${l.name}`} onClick={() => remove(l.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      {week && (
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 12 }}>
          Last 7 days: {week.avg} g added sugar on the {week.days} day{week.days === 1 ? "" : "s"} you had some{week.sugarFree > 0 ? ` · ${week.sugarFree} with none logged 🌿` : ""}.
        </div>
      )}
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 12 }}>
        Packaged-food data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Open Food Facts</a> (open database, ODbL) — values can be wrong; check the label. Daily limits: WHO guideline on free sugars.
      </div>
    </section>
  );
}

const rowBtn = { display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "8px 4px", background: "none", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", color: "inherit" };
