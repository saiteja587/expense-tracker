// Accounts & cards: where your money sits. Bank/UPI/cash/wallet balances,
// every credit card with its billing cycle (what's due, by when, what's
// unbilled), card logins, secret details in an encrypted vault, and
// transfers — including "pay card bill".
import { useMemo, useState } from "react";
import Link from "next/link";
import { Landmark, Plus, Pencil, Trash2, ArrowRightLeft, ExternalLink, Copy, FileUp, X } from "lucide-react";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { ACCOUNT_KINDS, kindOf, isCard, cardCycle } from "../lib/money";
import { sealSecrets, openSecrets, checkVaultPassphrase, MIN_PASSPHRASE } from "../lib/vault";
import { apiPost, apiPut, apiDelete } from "../lib/api";
import { fmt, todayISO } from "../lib/format";
import { showToast } from "../lib/toast";
import { newRequestId } from "../lib/offlineQueue";
import PageHeader, { Loading, pageStyle, Stat } from "../components/PageHeader";
import { RevealSecrets, SecretsEditor } from "../components/CardVault";
import { feeWaiver, pointsExpiring, pickCard } from "../lib/lifePlus";
import { allCategories, MOVIE_CATEGORY } from "../lib/categories";

const NETWORKS = ["Visa", "Mastercard", "RuPay", "Amex", "Diners"];
const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const emptyForm = (kind = "bank") => ({
  id: null, name: "", kind, openingBalance: "", openingDate: todayISO(), creditLimit: "", statementDay: "", dueDay: "",
  bank: "", network: "", last4: "", loginUrl: "", loginUsername: "", note: "", archived: false, hasVault: false, vault: "",
  rewardType: "", rewardDefault: "", rewardRules: [], points: "", pointsExpiry: "", annualFee: "", feeWaiverSpend: "", feeMonth: "",
});

export default function AccountsPage() {
  const { data, derived, today, loaded } = useLedger();
  const [form, setForm] = useState(null);
  const [transfer, setTransfer] = useState(null);

  const view = useMemo(() => {
    if (!data) return null;
    const accounts = data.accounts || [];
    const bal = derived.accountBalances || {};
    const live = accounts.filter((a) => !a.archived);
    const cards = live.filter(isCard).map((c) => ({ ...c, cycle: cardCycle(c, data.expenses, data.transfers || [], today), fw: feeWaiver(c, data.expenses, today), pts: pointsExpiring(c, today) }));
    const others = live.filter((a) => !isCard(a));
    const cash = others.reduce((s, a) => s + (bal[a.id] || 0), derived.balance);
    const owed = cards.reduce((s, c) => s + Math.max(0, c.cycle.outstanding), 0);
    const limit = cards.reduce((s, c) => s + c.creditLimit, 0);
    const name = (id) => (id == null ? "Main wallet" : accounts.find((a) => a.id === id)?.name || "Deleted account");
    return { accounts, cards, others, bal, cash, owed, limit, archived: accounts.filter((a) => a.archived), name };
  }, [data, derived, today]);

  if (!loaded || !view) return <Loading />;

  function edit(a) {
    setTransfer(null);
    setForm({
      ...emptyForm(a.kind), ...a, openingBalance: String(a.openingBalance || ""), openingDate: a.openingDate || "",
      creditLimit: a.creditLimit ? String(a.creditLimit) : "", statementDay: a.statementDay ? String(a.statementDay) : "",
      dueDay: a.dueDay ? String(a.dueDay) : "", hasVault: !!a.vault,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(a) {
    if (!window.confirm(`Delete ${a.name}? Its expenses move back to your main wallet and its transfers are deleted. Its saved card details are deleted too.`)) return;
    try {
      await apiDelete("accounts", a.id);
      notifyLedgerChanged();
      showToast(`${a.name} deleted`, "🗑️");
    } catch (e) { showToast(e.message, "⚠️"); }
  }

  function payBill(c) {
    setForm(null);
    setTransfer({ fromAccount: "", toAccount: String(c.id), amount: c.cycle.billedDue > 0 ? String(c.cycle.billedDue) : String(Math.max(0, c.cycle.outstanding)), date: todayISO(), note: `${c.name} bill`, kind: "transfer" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="page-container" style={pageStyle}>
      <PageHeader icon={<Landmark size={22} color="var(--accent-solid)" />} title="Accounts & cards" sub="Bank, UPI, cash, wallets and credit cards: balances, card bills and what's due.">
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="chip" onClick={() => { setForm(null); setTransfer({ fromAccount: "", toAccount: "", amount: "", date: todayISO(), note: "", kind: "transfer" }); }}><ArrowRightLeft size={14} /> Move</button>
          <button type="button" className="chip active" onClick={() => { setTransfer(null); setForm(emptyForm()); }}><Plus size={14} /> Add</button>
        </div>
      </PageHeader>

      {form && <AccountForm form={form} setForm={setForm} onDone={() => setForm(null)} />}
      {transfer && <TransferForm t={transfer} setT={setTransfer} accounts={view.accounts.filter((a) => !a.archived)} onDone={() => setTransfer(null)} />}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <Stat label="Money you have" value={fmt(view.cash)} tone="good" sub={`main wallet + ${view.others.length} account${view.others.length === 1 ? "" : "s"}`} />
        <Stat label={`Owed on ${view.cards.length} credit card${view.cards.length === 1 ? "" : "s"}`} value={fmt(view.owed)} tone={view.owed > 0 ? "bad" : undefined} sub={view.limit ? `of ${fmt(view.limit)} total limit` : undefined} />
      </div>

      <h2 className="lora" style={{ fontSize: 17, margin: "6px 0 8px" }}>Accounts</h2>
      <div className="card" style={{ borderRadius: 16, padding: "4px 14px", marginBottom: 20 }}>
        <Row emoji="👛" title="Main wallet" sub="Your original balance: top-ups and expenses with no account" amount={derived.balance} href="/transactions" />
        {view.others.map((a) => (
          <Row key={a.id} emoji={kindOf(a.kind).emoji} title={a.name} sub={[kindOf(a.kind).label, a.bank, a.last4 && `•••• ${a.last4}`].filter(Boolean).join(" · ")}
            amount={view.bal[a.id] || 0} onEdit={() => edit(a)} onDelete={() => remove(a)} />
        ))}
        {view.others.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Add your bank account, UPI Lite, cash or a wallet to see each balance separately.</div>
        )}
      </div>

      <h2 className="lora" style={{ fontSize: 17, margin: "6px 0 8px" }}>
        Credit cards {view.cards.length > 0 && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>· you have {view.cards.length}</span>}
      </h2>
      {view.cards.length === 0 && (
        <div className="card" style={{ borderRadius: 16, padding: 16, fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
          No cards yet. <button type="button" className="chip" onClick={() => setForm(emptyForm("card"))}><Plus size={14} /> Add a credit card</button>
        </div>
      )}
      {view.cards.length > 1 && <CardPicker cards={view.cards} data={data} today={today} />}
      {view.cards.map((c) => <CardTile key={c.id} c={c} onEdit={() => edit(c)} onDelete={() => remove(c)} onPay={() => payBill(c)} />)}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0" }}>
        <Link href="/import" className="chip" style={{ textDecoration: "none" }}><FileUp size={14} /> Import a bank / card statement</Link>
        <Link href="/networth" className="chip" style={{ textDecoration: "none" }}>📊 Net worth</Link>
        <Link href="/loans" className="chip" style={{ textDecoration: "none" }}>🏦 Loans & EMIs</Link>
      </div>

      <h2 className="lora" style={{ fontSize: 17, margin: "6px 0 8px" }}>Recent transfers</h2>
      <div className="card" style={{ borderRadius: 16, padding: "4px 14px" }}>
        {(data.transfers || []).slice(0, 25).map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{t.kind === "income" ? `Money in → ${view.name(t.toAccount)}` : `${view.name(t.fromAccount)} → ${view.name(t.toAccount)}`}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{shortDate(t.date)}{t.note ? ` · ${t.note}` : ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="tabnum" style={{ fontSize: 14 }}>{fmt(t.amount)}</span>
              <button type="button" className="icon-btn danger" aria-label="Delete transfer" onClick={async () => {
                if (!window.confirm("Delete this transfer?")) return;
                try { await apiDelete("transfer", t.id); notifyLedgerChanged(); } catch (e) { showToast(e.message, "⚠️"); }
              }}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
        {!(data.transfers || []).length && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>Moving money between accounts or paying a card bill shows up here. It never counts as spending.</div>}
      </div>

      {view.archived.length > 0 && (
        <div style={{ marginTop: 18, fontSize: 13, color: "var(--muted)" }}>
          Archived: {view.archived.map((a) => <button key={a.id} type="button" className="chip" onClick={() => edit(a)}>{a.name}</button>)}
        </div>
      )}
    </div>
  );
}

function Row({ emoji, title, sub, amount, onEdit, onDelete, href }) {
  const body = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
      <span style={{ fontSize: 22 }} aria-hidden="true">{emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</div>}
      </div>
      <span className="tabnum lora" style={{ fontSize: 16, fontWeight: 600, color: amount < 0 ? "var(--danger)" : "var(--ink)" }}>{fmt(amount)}</span>
      {onEdit && <button type="button" className="icon-btn" aria-label={`Edit ${title}`} onClick={onEdit}><Pencil size={16} /></button>}
      {onDelete && <button type="button" className="icon-btn danger" aria-label={`Delete ${title}`} onClick={onDelete}><Trash2 size={16} /></button>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>{body}</Link> : body;
}

function CardTile({ c, onEdit, onDelete, onPay }) {
  const cy = c.cycle;
  const util = cy.utilisation;
  const tone = cy.status === "overdue" ? "var(--danger)" : cy.status === "due-soon" ? "var(--amber)" : "var(--muted)";
  return (
    <div className="card" style={{ borderRadius: 18, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 46, height: 30, borderRadius: 6, background: c.color || "var(--accent-gradient)", flexShrink: 0, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 3, color: "#fff", fontSize: 9, fontWeight: 700 }}>{c.network?.slice(0, 4)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{[c.bank, c.network, c.last4 && `•••• ${c.last4}`].filter(Boolean).join(" · ") || "Credit card"}</div>
        </div>
        <button type="button" className="icon-btn" aria-label={`Edit ${c.name}`} onClick={onEdit}><Pencil size={16} /></button>
        <button type="button" className="icon-btn danger" aria-label={`Delete ${c.name}`} onClick={onDelete}><Trash2 size={16} /></button>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
        <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>Outstanding</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600 }}>{fmt(cy.outstanding)}</div></div>
        {cy.hasCycle && <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>Bill due</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600, color: cy.billedDue > 0 ? tone : "var(--success)" }}>{cy.billedDue > 0 ? fmt(cy.billedDue) : "Paid ✓"}</div></div>}
        {cy.hasCycle && <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>Unbilled</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600 }}>{fmt(cy.unbilled)}</div></div>}
        {cy.available != null && <div><div style={{ fontSize: 11.5, color: "var(--muted)" }}>Available</div><div className="lora tabnum" style={{ fontSize: 19, fontWeight: 600 }}>{fmt(cy.available)}</div></div>}
      </div>

      {cy.hasCycle && cy.billedDue > 0 && (
        <div style={{ fontSize: 13, color: tone, marginTop: 6 }}>
          {cy.status === "overdue" ? `Overdue since ${shortDate(cy.dueDate)}. Pay now to avoid interest and late fees.` : `Due ${shortDate(cy.dueDate)} (${cy.daysToDue === 0 ? "today" : cy.daysToDue === 1 ? "tomorrow" : `in ${cy.daysToDue} days`}) · statement of ${shortDate(cy.lastStatement)}`}
        </div>
      )}
      {cy.hasCycle && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Next statement {shortDate(cy.nextStatement)}</div>}
      {!cy.hasCycle && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Add the statement and due days (edit ✎) to track bills.</div>}

      {util != null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, util * 100))}%`, background: util > 0.3 ? "var(--amber)" : "var(--success)" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{Math.round(util * 100)}% of limit used{util > 0.3 ? ". Keeping it under 30% helps your credit score." : ""}</div>
        </div>
      )}

      {c.fw && (
        <div style={{ fontSize: 12.5, marginTop: 8, color: c.fw.done ? "var(--success)" : "var(--text-2)" }}>
          {c.fw.done ? `✅ Annual fee of ${fmt(c.annualFee)} waived this year` : `Spend ${fmt(c.fw.left)} more by ${shortDate(c.fw.end)} to waive the ${fmt(c.annualFee)} fee (~${fmt(c.fw.perMonth)}/month)`}
        </div>
      )}
      {c.pts && <div style={{ fontSize: 12.5, marginTop: 4, color: c.pts.daysLeft <= 14 ? "var(--danger)" : "var(--amber)" }}>⭐ {c.pts.points.toLocaleString("en-IN")} points expire {c.pts.daysLeft <= 0 ? "today" : `in ${c.pts.daysLeft} days`}. Redeem them.</div>}
      {!c.pts && c.points > 0 && <div style={{ fontSize: 12, marginTop: 4, color: "var(--muted)" }}>⭐ {c.points.toLocaleString("en-IN")} points</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {cy.outstanding > 0 && <button type="button" className="btn btn-primary" onClick={onPay}>Pay bill</button>}
        {c.loginUrl && <a className="chip" href={/^https?:\/\//.test(c.loginUrl) ? c.loginUrl : `https://${c.loginUrl}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><ExternalLink size={14} /> Log in</a>}
        {c.loginUsername && (
          <button type="button" className="chip" onClick={() => navigator.clipboard?.writeText(c.loginUsername).then(() => showToast("Username copied", "📋"))}>
            <Copy size={14} /> {c.loginUsername}
          </button>
        )}
      </div>
      <RevealSecrets vault={c.vault} />
    </div>
  );
}

function AccountForm({ form, setForm, onDone }) {
  const card = form.kind === "card";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  // Secrets: untouched → kept as they are. Editing them needs the passphrase
  // first (to load what's there), then they're re-sealed on save.
  const [secretsMode, setSecretsMode] = useState(form.hasVault ? "locked" : "closed"); // closed | locked | editing
  const [secrets, setSecrets] = useState({});
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unlockPass, setUnlockPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock(e) {
    e.preventDefault();
    try {
      setSecrets(await openSecrets(form.vault, unlockPass));
      setPass(unlockPass);
      setUnlockPass("");
      setSecretsMode("editing");
      setError("");
    } catch (err) { setError(err.message); }
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Give it a name, e.g. HDFC Millennia");
    for (const k of ["statementDay", "dueDay"]) {
      const d = parseInt(form[k], 10);
      if (form[k] && !(d >= 1 && d <= 31)) return setError("Days must be between 1 and 31");
    }
    setBusy(true); setError("");
    try {
      const body = {
        type: "accounts", ...(form.id ? { id: form.id } : {}), name: form.name.trim(), kind: form.kind,
        openingBalance: parseFloat(form.openingBalance) || 0, openingDate: form.openingDate || null,
        creditLimit: parseFloat(form.creditLimit) || 0, statementDay: form.statementDay, dueDay: form.dueDay,
        bank: form.bank, network: form.network, last4: form.last4, loginUrl: form.loginUrl, loginUsername: form.loginUsername,
        note: form.note, archived: form.archived,
        ...(card ? {
          rewardType: form.rewardType || "", rewardDefault: form.rewardDefault, points: form.points, pointsExpiry: form.pointsExpiry || null,
          rewardRules: (form.rewardRules || []).filter((r) => r.category && parseFloat(r.pct) > 0),
          annualFee: form.annualFee, feeWaiverSpend: form.feeWaiverSpend, feeMonth: form.feeMonth,
        } : {}),
      };
      if (secretsMode === "editing") {
        const clean = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, String(v || "").trim()]).filter(([, v]) => v));
        if (Object.keys(clean).length === 0) body.vault = "";
        else {
          if (pass.length < MIN_PASSPHRASE) throw new Error(`The passphrase needs at least ${MIN_PASSPHRASE} characters`);
          if (!form.hasVault && pass !== confirm) throw new Error("The two passphrases don't match");
          if (clean.number) {
            const digits = clean.number.replace(/\D/g, "");
            if (digits.length < 12 || digits.length > 19) throw new Error("That card number doesn't look right");
            clean.number = digits;
            body.last4 = digits.slice(-4);
          }
          await checkVaultPassphrase(pass);
          body.vault = await sealSecrets(clean, pass);
        }
      }
      if (form.id) await apiPut(body); else await apiPost(body);
      setSecrets({}); setPass(""); setConfirm("");
      notifyLedgerChanged();
      showToast(form.id ? "Saved" : `${form.name} added`, card ? "💳" : "🏦");
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 20, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{form.id ? `Edit ${form.name}` : "Add an account or card"}</div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onDone}><X size={18} /></button>
      </div>
      <div className="h-scroll" role="radiogroup" aria-label="Type">
        {ACCOUNT_KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={form.kind === k.id} className={`chip${form.kind === k.id ? " active" : ""}`} onClick={() => setForm({ ...form, kind: k.id })}>{k.emoji} {k.label}</button>
        ))}
      </div>
      <input value={form.name} onChange={set("name")} placeholder={card ? "Card name, e.g. HDFC Millennia" : "Name, e.g. SBI savings"} maxLength={40} />
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.bank} onChange={set("bank")} placeholder="Bank (optional)" maxLength={40} style={{ flex: 1 }} />
        <input value={form.last4} onChange={set("last4")} placeholder="Last 4 digits" inputMode="numeric" maxLength={4} style={{ width: 120 }} />
      </div>

      <label className="field-label">{card ? "What you owe on it right now" : "Balance right now"}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" inputMode="decimal" value={form.openingBalance} onChange={set("openingBalance")} placeholder="₹0" style={{ flex: 1 }} />
        <input type="date" value={form.openingDate} onChange={set("openingDate")} style={{ width: 160 }} aria-label="As of date" />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -6 }}>As of this date. Only entries after it are added on top.</div>

      {card && (
        <>
          <div className="h-scroll">
            {NETWORKS.map((n) => <button key={n} type="button" className={`chip${form.network === n ? " active" : ""}`} onClick={() => setForm({ ...form, network: form.network === n ? "" : n })}>{n}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Credit limit</span><input type="number" inputMode="decimal" value={form.creditLimit} onChange={set("creditLimit")} placeholder="₹" /></label>
            <label style={{ width: 90, display: "grid", gap: 3 }}><span className="field-label">Statement day</span><input type="number" inputMode="numeric" min="1" max="31" value={form.statementDay} onChange={set("statementDay")} placeholder="20" /></label>
            <label style={{ width: 90, display: "grid", gap: 3 }}><span className="field-label">Due day</span><input type="number" inputMode="numeric" min="1" max="31" value={form.dueDay} onChange={set("dueDay")} placeholder="8" /></label>
          </div>
          <details style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <summary style={{ fontSize: 14, fontWeight: 600, cursor: "pointer" }}>🎁 Rewards &amp; annual fee (for "Which card?")</summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <div className="h-scroll">{[["cashback", "💸 Cashback"], ["points", "⭐ Points"]].map(([k, l]) => <button key={k} type="button" className={`chip${form.rewardType === k ? " active" : ""}`} onClick={() => setForm({ ...form, rewardType: form.rewardType === k ? "" : k })}>{l}</button>)}</div>
              <label style={{ display: "grid", gap: 3 }}><span className="field-label">Usual reward % on everything</span><input type="number" inputMode="decimal" step="0.1" value={form.rewardDefault} onChange={set("rewardDefault")} placeholder="1" /></label>
              <div className="field-label">Higher % on some categories</div>
              {(form.rewardRules || []).map((r, k) => (
                <div key={k} style={{ display: "flex", gap: 8 }}>
                  <select value={r.category} onChange={(e) => setForm({ ...form, rewardRules: form.rewardRules.map((x, j) => (j === k ? { ...x, category: e.target.value } : x)) })} style={{ flex: 2 }}>
                    <option value="">Category…</option>
                    {allCategories().map((c) => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" step="0.1" value={r.pct} onChange={(e) => setForm({ ...form, rewardRules: form.rewardRules.map((x, j) => (j === k ? { ...x, pct: e.target.value } : x)) })} placeholder="%" style={{ flex: 1 }} />
                  <button type="button" className="icon-btn danger" aria-label="Remove" onClick={() => setForm({ ...form, rewardRules: form.rewardRules.filter((_, j) => j !== k) })}><X size={16} /></button>
                </div>
              ))}
              <button type="button" className="chip" style={{ justifySelf: "start" }} onClick={() => setForm({ ...form, rewardRules: [...(form.rewardRules || []), { category: "", pct: "" }] })}>+ Category rate</button>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Points balance</span><input type="number" inputMode="numeric" value={form.points} onChange={set("points")} /></label>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Points expire on</span><input type="date" value={form.pointsExpiry || ""} onChange={set("pointsExpiry")} /></label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Annual fee ₹</span><input type="number" inputMode="decimal" value={form.annualFee} onChange={set("annualFee")} /></label>
                <label style={{ flex: 1, display: "grid", gap: 3 }}><span className="field-label">Waived if you spend ₹</span><input type="number" inputMode="decimal" value={form.feeWaiverSpend} onChange={set("feeWaiverSpend")} /></label>
                <label style={{ width: 100, display: "grid", gap: 3 }}><span className="field-label">Fee month</span>
                  <select value={form.feeMonth || ""} onChange={set("feeMonth")}><option value="">—</option>{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, k) => <option key={m} value={k + 1}>{m}</option>)}</select>
                </label>
              </div>
            </div>
          </details>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.loginUrl} onChange={set("loginUrl")} placeholder="Login website or app link (optional)" maxLength={300} style={{ flex: 1 }} />
        <input value={form.loginUsername} onChange={set("loginUsername")} placeholder="Username / customer ID" maxLength={120} style={{ flex: 1 }} autoComplete="off" />
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>🔐 Secret details{card ? " (card number, CVV, PIN, password)" : " (PIN, password)"}</div>
        {secretsMode === "closed" && (
          <button type="button" className="chip" onClick={() => setSecretsMode("editing")}>+ Add secret details (encrypted)</button>
        )}
        {secretsMode === "locked" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Saved and encrypted. To change them, unlock first:</span>
            <input type="password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} placeholder="Vault passphrase" style={{ flex: 1, minWidth: 150 }} />
            <button type="button" className="chip" onClick={unlock} disabled={!unlockPass}>Unlock to edit</button>
            <button type="button" className="chip" onClick={() => { if (window.confirm("Remove the saved secret details for this card?")) { setSecrets({}); setSecretsMode("editing"); } }}>Remove them</button>
          </div>
        )}
        {secretsMode === "editing" && (
          <SecretsEditor value={secrets} onChange={setSecrets} passphrase={pass} onPassphrase={setPass} confirm={confirm} onConfirm={setConfirm} isNew={!form.hasVault} />
        )}
      </div>

      {form.id && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
          <input type="checkbox" checked={form.archived} onChange={set("archived")} style={{ width: 18, height: 18 }} /> Archived (closed account; hidden from totals)
        </label>
      )}
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? (secretsMode === "editing" ? "Encrypting…" : "Saving…") : "Save"}</button>
    </form>
  );
}

function TransferForm({ t, setT, accounts, onDone }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setT({ ...t, [k]: e.target.value });
  const income = t.kind === "income";
  async function save(e) {
    e.preventDefault();
    const amount = parseFloat(t.amount);
    if (!(amount > 0)) return setError("Enter an amount");
    if (!income && t.fromAccount === t.toAccount) return setError("Pick two different accounts");
    setBusy(true); setError("");
    try {
      await apiPost({ type: "transfer", kind: t.kind, fromAccount: income ? null : t.fromAccount || null, toAccount: t.toAccount || null, amount, date: t.date, note: t.note, clientRequestId: newRequestId() });
      notifyLedgerChanged();
      showToast(income ? `${fmt(amount)} added` : `${fmt(amount)} moved`, "🔁");
      onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const opts = [<option key="main" value="">👛 Main wallet</option>, ...accounts.map((a) => <option key={a.id} value={String(a.id)}>{kindOf(a.kind).emoji} {a.name}</option>)];
  return (
    <form onSubmit={save} className="card" style={{ borderRadius: 16, padding: 16, marginBottom: 20, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="h-scroll">
          <button type="button" className={`chip${!income ? " active" : ""}`} onClick={() => setT({ ...t, kind: "transfer" })}>🔁 Move / pay card</button>
          <button type="button" className={`chip${income ? " active" : ""}`} onClick={() => setT({ ...t, kind: "income" })}>💰 Money in (salary, refund…)</button>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onDone}><X size={18} /></button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {!income && <select value={t.fromAccount} onChange={set("fromAccount")} aria-label="From" style={{ flex: 1 }}>{opts}</select>}
        {!income && <span aria-hidden="true">→</span>}
        <select value={t.toAccount} onChange={set("toAccount")} aria-label="To" style={{ flex: 1 }}>{opts}</select>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input type="number" inputMode="decimal" value={t.amount} onChange={set("amount")} placeholder="Amount ₹" style={{ flex: 1 }} />
        <input type="date" value={t.date} onChange={set("date")} style={{ width: 160 }} />
      </div>
      <input value={t.note} onChange={set("note")} placeholder="Note (optional)" maxLength={120} />
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{income ? "Money from outside, e.g. salary into your bank. It isn't counted as spending." : "Moving your own money, or paying a card bill. It isn't counted as spending; the card's spending was counted when you used it."}</div>
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </form>
  );
}

// "Which card should I use?" — best reward that fits, explained.
function CardPicker({ cards, data, today }) {
  const [category, setCategory] = useState("Food");
  const [amount, setAmount] = useState("");
  const amt = parseFloat(amount) || 0;
  const cycles = Object.fromEntries(cards.map((c) => [c.id, c.cycle]));
  const ranked = amt > 0 ? pickCard({ cards, category, amount: amt, cycles, expenses: data.expenses, todayIso: today }) : [];
  const anyRewards = cards.some((c) => c.rewardDefault || (c.rewardRules || []).length || c.annualFee);
  return (
    <div className="card" style={{ borderRadius: 16, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>🤔 Which card should I use?</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ flex: 1 }}>
          {allCategories(data.customCategories).filter((c) => c.name !== MOVIE_CATEGORY.name).concat([MOVIE_CATEGORY]).map((c) => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
        </select>
        <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₹" style={{ flex: 1 }} />
      </div>
      {!anyRewards && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Add each card&apos;s reward % and annual fee (edit ✎ → Rewards) for better picks.</div>}
      {amt > 0 && ranked.length === 0 && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8 }}>No card has {fmt(amt)} of limit available.</div>}
      {ranked.slice(0, 3).map((r, k) => (
        <div key={r.card.id} style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: k === 0 ? "var(--success-bg)" : "var(--surface-2)" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{k === 0 ? "👉 " : ""}{r.card.name}{r.reward ? ` · ≈ ${fmt(r.reward)} back` : ""}</div>
          {r.reasons.length > 0 && <div style={{ fontSize: 12, color: "var(--text-2)" }}>{r.reasons.join(" · ")}</div>}
        </div>
      ))}
    </div>
  );
}
