// The ＋ button's bottom sheet: log an expense in a couple of taps.
// Amount on a big keypad → category chip → Save. Everything else (note,
// date, receipt, split with friends, paste an SMS, voice) is optional.
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Mic, ClipboardPaste, Users, X, Delete, Check, CalendarDays } from "lucide-react";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { allCategories, MOVIE_CATEGORY } from "../lib/categories";
import { quickSuggestions, addDays } from "../lib/ledger";
import { learnCategory } from "../lib/smart";
import { guessCategory } from "../lib/smsParse";
import { parseExpenseText } from "../lib/smsParse";
import { fmt, todayISO, nowHHMM } from "../lib/format";
import { queueRequest, newRequestId } from "../lib/offlineQueue";
import { fileToCompressedDataUrl } from "../lib/receiptImage";
import { showToast } from "../lib/toast";
import { vibrate } from "../lib/haptics";

const OPEN_EVENT = "ledger:quick-add";

// Open the sheet from anywhere; `prefill` = { amount, note, category }.
export function openQuickAdd(prefill = {}) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: prefill }));
}

export default function QuickAddSheet() {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState({});
  useEffect(() => {
    function onOpen(e) { setPrefill(e.detail || {}); setOpen(true); }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!open) return null;
  return <Sheet prefill={prefill} onClose={() => setOpen(false)} />;
}

async function postJson(body) {
  const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    const err = new Error(d.error || "Couldn't save");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function Sheet({ prefill, onClose }) {
  const { data } = useLedger();
  const today = todayISO();
  const custom = data?.customCategories || [];
  const categories = useMemo(() => allCategories(custom).filter((c) => c.name !== MOVIE_CATEGORY.name), [custom]);
  const suggestions = useMemo(() => (data ? quickSuggestions(data.expenses, today, new Date().getHours()) : []), [data, today]);

  const [amount, setAmount] = useState(prefill.amount ? String(prefill.amount) : "");
  const [category, setCategory] = useState(prefill.category || "");
  // True once you tap a category yourself; until then the note can pick one.
  const [pickedByHand, setPickedByHand] = useState(!!prefill.category);
  const [autoPicked, setAutoPicked] = useState(false);
  const [note, setNote] = useState(prefill.note || "");
  const [date, setDate] = useState(today);
  const [deduct, setDeduct] = useState(true);
  // "Roughly ₹500" now, the real amount (and receipt) later.
  const [estimate, setEstimate] = useState(false);
  const [photo, setPhoto] = useState("");
  const [splitNames, setSplitNames] = useState("");
  const [panel, setPanel] = useState(null); // null | "more" | "paste" | "split"
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const fileRef = useRef(null);

  const amt = parseFloat(amount) || 0;
  const friends = splitNames.split(",").map((s) => s.trim()).filter(Boolean);
  const share = friends.length ? Math.round((amt / (friends.length + 1)) * 100) / 100 : 0;

  // Learn the category from what you usually log with these words (falls back
  // to well-known merchants like Swiggy/Uber), unless you picked one yourself.
  function onNote(v) {
    setNote(v);
    if (pickedByHand) return;
    const guess = (data && learnCategory(data.expenses, v)) || guessCategory(v);
    if (guess && categories.some((c) => c.name === guess)) { setCategory(guess); setAutoPicked(true); }
  }

  function press(k) {
    vibrate(4);
    setError("");
    setAmount((a) => {
      if (k === "del") return a.slice(0, -1);
      if (k === ".") return a.includes(".") ? a : (a || "0") + ".";
      if (a.includes(".") && a.split(".")[1].length >= 2) return a;
      if (a === "0") return k;
      if (a.replace(".", "").length >= 8) return a;
      return a + k;
    });
  }

  function applyParsed(p) {
    if (!p) { setError("Couldn't find an amount in that text."); return; }
    if (p.isCredit) { setError("That looks like money received, not spent — add it as money in from Home instead."); return; }
    setAmount(String(p.amount));
    if (p.note) setNote(p.note);
    if (p.category) setCategory(p.category);
    setPanel(null);
    setError("");
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setPasteText(t); applyParsed(parseExpenseText(t)); return; }
    } catch { /* permission denied: fall back to the text box */ }
    setPanel("paste");
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setError("Voice input isn't supported in this browser."); return; }
    const r = new SR();
    r.lang = "en-IN";
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onerror = () => setError("Didn't catch that — try again or type it.");
    r.onresult = (e) => applyParsed(parseExpenseText(e.results[0][0].transcript));
    r.start();
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setPhoto(await fileToCompressedDataUrl(file)); } catch { setError("Couldn't read that photo."); }
  }

  async function save(entry) {
    const e = entry || { amount: amt, category, note: note.trim(), date, deduct, photo };
    if (!e.amount || e.amount <= 0) { setError("Enter an amount"); return; }
    if (!e.category) { setError("Pick a category"); return; }
    setSaving(true);
    setError("");
    const payload = {
      type: "expenses", clientRequestId: newRequestId(), amount: e.amount, category: e.category, note: e.note,
      date: e.date || today, time: (e.date || today) === today ? nowHHMM() : "", affectsBalance: e.deduct !== false, receiptPhoto: e.photo || "",
      isEstimate: !entry && estimate,
    };
    const firstToday = data && !data.expenses.some((x) => x.date === today);
    try {
      await postJson(payload);
      for (const name of entry ? [] : friends) {
        await postJson({ type: "ious", personName: name, amount: share, direction: "owed_to_me", note: `${e.note || e.category} (split)` });
      }
      vibrate([10, 40, 10]);
      notifyLedgerChanged();
      const msg = friends.length && !entry
        ? `${fmt(e.amount)} logged · ${friends.length} IOU${friends.length > 1 ? "s" : ""} of ${fmt(share)} added`
        : `${e.note || e.category} · ${!entry && estimate ? "≈" : ""}${fmt(e.amount)} logged${!entry && estimate ? " — update it when the bill comes" : ""}`;
      showToast(firstToday ? `First one today — ${msg}` : msg, firstToday ? "🎉" : "✅");
      onClose();
    } catch (err) {
      if (err.status) { setError(err.message); setSaving(false); return; }
      const q = queueRequest({ url: "/api/data", method: "POST", body: payload });
      if (!q.ok) { setError("You're offline and storage is full — couldn't save."); setSaving(false); return; }
      showToast(q.droppedPhoto ? "Saved offline without the photo — will sync later" : "Saved offline — will sync when you're back", "📥");
      onClose();
    }
  }

  const dateLabel = date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Add an expense" data-no-tab-swipe="1">
        <div className="sheet-handle" />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div className="lora" style={{ fontSize: 17, fontWeight: 600 }}>Add expense</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {suggestions.length > 0 && !amount && (
          <div style={{ marginBottom: 10 }}>
            <div className="field-label">Usual right now — tap to log</div>
            <div className="h-scroll">
              {suggestions.map((s) => (
                <button key={`${s.category}|${s.note}|${s.amount}`} type="button" className="chip" disabled={saving}
                  onClick={() => save({ amount: s.amount, category: s.category, note: s.note, date: today, deduct: true })}>
                  ⚡ {s.note || s.category} · {fmt(s.amount)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", padding: "6px 0 2px" }}>
          <div className="lora tabnum" aria-live="polite" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.1, color: amount ? "var(--ink)" : "var(--faint)" }}>
            ₹{amount || "0"}
          </div>
          {friends.length > 0 && amt > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Split {friends.length + 1} ways · each owes you {fmt(share)}
            </div>
          )}
        </div>

        <div className="h-scroll" style={{ margin: "10px 0" }} role="radiogroup" aria-label="Category">
          {categories.map((c) => (
            <button key={c.name} type="button" role="radio" aria-checked={category === c.name}
              className={`chip${category === c.name ? " active" : ""}`} onClick={() => { vibrate(4); setCategory(c.name); setPickedByHand(true); setAutoPicked(false); setError(""); }}>
              <span aria-hidden="true">{c.emoji}</span> {c.name}
            </button>
          ))}
        </div>

        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="Note (optional) — e.g. Swiggy dinner" maxLength={120} style={{ marginBottom: autoPicked ? 4 : 10 }} />
        {autoPicked && category && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>✨ Category set to <b>{category}</b> from your past entries — tap another to change.</div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button type="button" className={`chip${panel === "more" ? " active" : ""}`} onClick={() => setPanel(panel === "more" ? null : "more")}>
            <CalendarDays size={14} /> {dateLabel}{!deduct ? " · not deducted" : ""}
          </button>
          <button type="button" className={`chip${photo ? " active" : ""}`} onClick={() => fileRef.current?.click()}>
            <Camera size={14} /> {photo ? "Receipt ✓" : "Receipt"}
          </button>
          <button type="button" className={`chip${estimate ? " active" : ""}`} aria-pressed={estimate} onClick={() => setEstimate(!estimate)} title="Don't know the exact amount yet? Log a rough one and update it later.">
            ≈ {estimate ? "Estimate ✓" : "Estimate"}
          </button>
          <button type="button" className={`chip${panel === "split" || friends.length ? " active" : ""}`} onClick={() => setPanel(panel === "split" ? null : "split")}>
            <Users size={14} /> Split
          </button>
          <button type="button" className="chip" onClick={pasteFromClipboard}>
            <ClipboardPaste size={14} /> Paste SMS
          </button>
          <button type="button" className={`chip${listening ? " active" : ""}`} onClick={startVoice} disabled={listening}>
            <Mic size={14} /> {listening ? "Listening…" : "Speak"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: "none" }} />
        </div>

        {panel === "more" && (
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            <div className="h-scroll">
              {[["Today", today], ["Yesterday", addDays(today, -1)], ["2 days ago", addDays(today, -2)]].map(([label, d]) => (
                <button key={d} type="button" className={`chip${date === d ? " active" : ""}`} onClick={() => setDate(d)}>{label}</button>
              ))}
            </div>
            <label className="field-label" htmlFor="qa-date">Or pick a date (future dates are scheduled)</label>
            <input id="qa-date" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
              <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} style={{ width: 18, height: 18 }} />
              Deduct from my balance
            </label>
          </div>
        )}

        {panel === "split" && (
          <div style={{ marginBottom: 10 }}>
            <label className="field-label" htmlFor="qa-split">You paid for friends? Their names, comma-separated</label>
            <input id="qa-split" value={splitNames} onChange={(e) => setSplitNames(e.target.value)} placeholder="Ravi, Priya" />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>The full amount is logged as your expense, and an IOU is added for each friend's share.</div>
          </div>
        )}

        {panel === "paste" && (
          <div style={{ marginBottom: 10 }}>
            <label className="field-label" htmlFor="qa-paste">Paste a bank or UPI SMS</label>
            <textarea id="qa-paste" rows={3} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Rs.250 debited from A/c XX1234 to VPA swiggy@icici…" />
            <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => applyParsed(parseExpenseText(pasteText))}>Fill from SMS</button>
          </div>
        )}

        {photo && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <img src={photo} alt="Receipt preview" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} />
            <button type="button" className="chip" onClick={() => setPhoto("")}>Remove photo</button>
          </div>
        )}

        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div className="keypad" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
            <button key={k} type="button" onClick={() => press(k)} aria-label={k === "del" ? "Delete digit" : k}
              style={{ height: 52, borderRadius: 14, border: "none", background: "var(--surface)", boxShadow: "var(--shadow-sm)", fontSize: 22, fontWeight: 500, color: "var(--ink)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {k === "del" ? <Delete size={22} /> : k}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={() => save()} style={{ minHeight: 52, fontSize: 16 }}>
          <Check size={18} /> {saving ? "Saving…" : amt > 0 ? `Save ${estimate ? "≈" : ""}${fmt(amt)}` : "Save"}
        </button>
      </div>
    </>
  );
}
