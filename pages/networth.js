// Net worth: everything you have (cash, accounts, investments, money owed to
// you) minus everything you owe (cards, loans, IOUs), with a monthly trend.
// Each visit saves this month's figure; the evening job does too.
import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Plus, Pencil, Trash2, X } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLedger } from "../lib/useLedger";
import { netWorth, mapLoan, mapAsset, ASSET_KINDS } from "../lib/money";
import { apiGet, apiPost, apiPut, apiDelete } from "../lib/api";
import { fmt, fmtShort } from "../lib/format";
import { showToast } from "../lib/toast";
import PageHeader, { Loading, pageStyle } from "../components/PageHeader";

export default function NetWorthPage() {
  const { data, derived, today, loaded } = useLedger();
  const [assets, setAssets] = useState(null);
  const [loans, setLoans] = useState([]);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState(null);

  async function load() {
    try {
      const [a, l, h] = await Promise.all([apiGet("assets"), apiGet("loans"), apiGet("networth")]);
      setAssets((a.assets || []).map(mapAsset));
      setLoans((l.loans || []).map(mapLoan));
      setHistory((h.history || []).map((r) => ({ ym: r.ym, net: parseFloat(r.net) })));
    } catch (e) { showToast(e.message, "⚠️"); setAssets([]); }
  }
  useEffect(() => { load(); }, []);

  const nw = useMemo(() => {
    if (!data || !assets) return null;
    return netWorth({ mainBalance: derived.balance, accounts: data.accounts || [], balances: derived.accountBalances || {}, assets, loans, ious: data.ious, todayIso: today });
  }, [data, derived, assets, loans, today]);

  // Save this month's figure (one point per month).
  useEffect(() => {
    if (!nw) return;
    const ym = today.slice(0, 7);
    apiPost({ type: "networth-snapshot", ym, net: nw.net, have: nw.have, owe: nw.owe }).catch(() => {});
    setHistory((h) => [...h.filter((x) => x.ym !== ym), { ym, net: nw.net }].sort((a, b) => (a.ym < b.ym ? -1 : 1)));
  }, [nw, today]);

  if (!loaded || !nw) return <Loading />;
  const prev = history.length > 1 ? history[history.length - 2] : null;
  const change = prev ? nw.net - prev.net : null;

  async function saveAsset(e) {
    e.preventDefault();
    try {
      const body = { type: "asset", ...form, value: parseFloat(form.value) || 0 };
      if (form.id) await apiPut(body); else await apiPost(body);
      setForm(null);
      await load();
    } catch (err) { showToast(err.message, "⚠️"); }
  }

  const line = (label, v, neg) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}>
      <span>{label}</span><span className="tabnum" style={{ color: neg && v > 0 ? "var(--danger)" : undefined }}>{neg && v > 0 ? "−" : ""}{fmt(v)}</span>
    </div>
  );

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<TrendingUp size={22} color="var(--accent-solid)" />} title="Net worth" sub="What you have minus what you owe, month by month." />

      <div style={{ borderRadius: 22, padding: 20, color: "#fff", background: "var(--accent-gradient)", boxShadow: "var(--accent-glow)", marginBottom: 16 }}>
        <div style={{ fontSize: 12, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Net worth</div>
        <div className="lora tabnum" style={{ fontSize: 34, fontWeight: 700 }}>{fmt(nw.net)}</div>
        {change != null && <div style={{ fontSize: 13, opacity: 0.95 }}>{change >= 0 ? "▲" : "▼"} {fmt(Math.abs(change))} since {new Date(prev.ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long" })}</div>}
      </div>

      {history.length > 1 && (
        <div className="card" style={{ borderRadius: 16, padding: "12px 8px 4px", marginBottom: 16, height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <XAxis dataKey="ym" tickFormatter={(v) => new Date(v + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short" })} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtShort} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={52} />
              <Tooltip formatter={(v) => [fmt(v), "Net worth"]} labelFormatter={(v) => new Date(v + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })} />
              <Line type="monotone" dataKey="net" stroke="var(--accent-solid)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card" style={{ borderRadius: 16, padding: "6px 14px 10px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", textTransform: "uppercase", padding: "6px 0" }}>You have · {fmt(nw.have)}</div>
        {line("Cash & accounts", nw.cash)}
        {line("Investments & savings", nw.invest)}
        {line("Owed to you", nw.owedToMe)}
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", textTransform: "uppercase", padding: "12px 0 6px" }}>You owe · {fmt(nw.owe)}</div>
        {line("Credit cards", nw.cards, true)}
        {line("Loans", nw.loans, true)}
        {line("To friends", nw.iOwe, true)}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 8px" }}>
        <h2 className="lora" style={{ fontSize: 17, margin: 0 }}>Investments & savings</h2>
        <button type="button" className="chip active" onClick={() => setForm({ name: "", kind: "fd", value: "", note: "" })}><Plus size={14} /> Add</button>
      </div>
      {form && (
        <form onSubmit={saveAsset} className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="h-scroll">{ASSET_KINDS.map((k) => <button key={k.id} type="button" className={`chip${form.kind === k.id ? " active" : ""}`} onClick={() => setForm({ ...form, kind: k.id })}>{k.emoji} {k.label}</button>)}</div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><X size={18} /></button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name, e.g. SBI FD" maxLength={60} style={{ flex: 2 }} />
            <input type="number" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Value today ₹" style={{ flex: 1 }} />
          </div>
          <button type="submit" className="btn btn-primary btn-block">Save</button>
        </form>
      )}
      <div className="card" style={{ borderRadius: 16, padding: "4px 14px" }}>
        {assets.map((a) => {
          const k = ASSET_KINDS.find((x) => x.id === a.kind) || ASSET_KINDS[ASSET_KINDS.length - 1];
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 20 }} aria-hidden="true">{k.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{k.label}{a.updatedAt ? ` · updated ${new Date(a.updatedAt + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</div>
              </div>
              <span className="tabnum" style={{ fontSize: 15 }}>{fmt(a.value)}</span>
              <button type="button" className="icon-btn" aria-label={`Update ${a.name}`} onClick={() => setForm({ ...a, value: String(a.value) })}><Pencil size={16} /></button>
              <button type="button" className="icon-btn danger" aria-label={`Delete ${a.name}`} onClick={async () => { if (window.confirm(`Delete ${a.name}?`)) { await apiDelete("asset", a.id).catch((e) => showToast(e.message, "⚠️")); load(); } }}><Trash2 size={16} /></button>
            </div>
          );
        })}
        {assets.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Add FDs, mutual funds, PF/PPF, gold and so on. Update their values now and then.</div>}
      </div>
    </div>
  );
}
