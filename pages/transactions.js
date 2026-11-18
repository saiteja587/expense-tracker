import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Wallet, X, Clock, Flame, Clapperboard, ShieldCheck, ShieldAlert, Mic, MoreHorizontal, Camera, Receipt, Paperclip } from "lucide-react";
import { queueRequest, newRequestId } from "../lib/offlineQueue";
import { showToast } from "../lib/toast";
import { vibrate } from "../lib/haptics";
import { fileToCompressedDataUrl } from "../lib/receiptImage";
import SwipeRow from "../components/SwipeRow";
import PullToRefresh from "../components/PullToRefresh";
import CountUp from "../components/CountUp";
import CategoryIcon from "../components/CategoryIcon";
import { fmt, todayISO } from "../lib/format";
import { describeChange } from "../lib/ledger";

const CATEGORIES = [
  { name: "Food", color: "#B5533C" },
  { name: "Groceries", color: "#C98A2C" },
  { name: "Transport", color: "#3F6E5B" },
  { name: "Bills", color: "#5B3A5C" },
  { name: "Rent", color: "#2F4858" },
  { name: "Shopping", color: "#A3763F" },
  { name: "Health", color: "#6B7A3E" },
  { name: "Entertainment", color: "#8A4B6B" },
  { name: "Other", color: "#6B6558" },
];

const MOVIE_CATEGORY = { name: "Movies", color: "#7A3E56" };

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function nowTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getEmptyExpenseForm() {
  return { amount: "", category: CATEGORIES[0].name, note: "", date: todayISO(), time: nowTimeHHMM(), affectsBalance: true, receiptPhoto: "" };
}
// A function, not a constant: a constant computed at module load keeps
// yesterday's date if the app stays open past midnight.
function getEmptyTopupForm() {
  return { amount: "", note: "", date: todayISO(), mode: "add" };
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up?";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// A number that counts up/down to its target instead of snapping — makes the
// balance feel alive rather than a static database read.
function useCountUp(target, durationMs = 500) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;
    let raf;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return display;
}

export default function TransactionsPage() {
  const [expenses, setExpenses] = useState([]);
  const [freshIds, setFreshIds] = useState([]);
  const [removingIds, setRemovingIds] = useState([]);
  const seenIds = useRef(null);
  const [movies, setMovies] = useState([]);
  const [topups, setTopups] = useState([]);
  const [budgetRules, setBudgetRules] = useState([]);
  const [customCategories, setCustomCategories] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [challengeMeta, setChallengeMeta] = useState(null);
  const [challengeDays, setChallengeDays] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [viewDate, setViewDate] = useState(new Date());

  const [expenseForm, setExpenseForm] = useState(getEmptyExpenseForm);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  // Most expenses are logged today, right now, deducted normally — so the
  // date/time/deduct-toggle fields start tucked away and only need a tap
  // when today's entry is the unusual one (backdated, future, or excluded).
  const [expenseMoreOpen, setExpenseMoreOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // On a phone the add-expense form lives in a bottom sheet, collapsed to a
  // peek strip until tapped or triggered (editing, voice, a shared amount).
  // On a wide screen this flag has no visual effect — the form is always
  // shown inline there.
  const [sheetOpen, setSheetOpen] = useState(false);
  const receiptInputRef = useRef(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptView, setReceiptView] = useState(null); // null | "loading" | data URL

  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreOpen]);

  const [showTopup, setShowTopup] = useState(false);
  const [topupForm, setTopupForm] = useState(getEmptyTopupForm);
  const [editingTopupId, setEditingTopupId] = useState(null);
  const [topupError, setTopupError] = useState("");
  const [topupSubmitting, setTopupSubmitting] = useState(false);

  const [savingsGoal, setSavingsGoal] = useState(null);
  useEffect(() => {
    fetch("/api/data?type=savings-goal")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSavingsGoal(d.goal))
      .catch(() => {});
  }, []);

  async function load() {
    try {
      const [expRes, movRes, balRes, ruleRes, chalRes, catRes, recRes] = await Promise.all([
        fetch("/api/data?type=expenses"),
        fetch("/api/data?type=movies"),
        fetch("/api/data?type=balance"),
        fetch("/api/data?type=budget"),
        fetch("/api/data?type=challenge"),
        fetch("/api/data?type=categories"),
        fetch("/api/data?type=recurring"),
      ]);
      if (!expRes.ok) throw new Error("Request failed");
      const expData = await expRes.json();
      const mappedExpenses = expData.expenses.map((x) => ({
        id: x.id,
        amount: parseFloat(x.amount),
        category: x.category,
        note: x.note || "",
        date: x.expense_date.slice(0, 10),
        time: x.expense_time ? x.expense_time.slice(0, 5) : "",
        affectsBalance: x.affects_balance !== false,
        hasReceipt: !!x.has_receipt,
      }));
      setExpenses(mappedExpenses);
      let mappedMovies = [];
      if (movRes.ok) {
        const movData = await movRes.json();
        mappedMovies = movData.movies.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.watched_date.slice(0, 10),
          ticketPrice: parseFloat(m.ticket_price),
          canteenPrice: parseFloat(m.canteen_price),
          affectsBalance: m.affects_balance !== false,
          quantity: m.quantity || 1,
        }));
        setMovies(mappedMovies);
      }
      let mappedTopups = [];
      if (balRes.ok) {
        const balData = await balRes.json();
        mappedTopups = balData.topups.map((t) => ({
          id: t.id,
          amount: parseFloat(t.amount),
          note: t.note || "",
          date: t.topup_date.slice(0, 10),
          mode: t.mode === "set" ? "set" : "add",
          createdAt: t.created_at,
        }));
        setTopups(mappedTopups);
      }
      let mappedRules = [];
      if (ruleRes.ok) {
        const ruleData = await ruleRes.json();
        mappedRules = ruleData.rules.map((r) => ({ id: r.id, ruleType: r.rule_type, category: r.category, amount: parseFloat(r.amount) }));
        setBudgetRules(mappedRules);
      }
      let mappedChalMeta = null, mappedChalDays = {};
      if (chalRes.ok) {
        const chalData = await chalRes.json();
        mappedChalMeta = chalData.meta;
        setChallengeMeta(chalData.meta);
        for (const d of chalData.days || []) mappedChalDays[d.day_date.slice(0, 10)] = d.completed;
        setChallengeDays(mappedChalDays);
      }
      let mappedCategories = [];
      if (catRes.ok) {
        const catData = await catRes.json();
        mappedCategories = catData.categories || [];
        setCustomCategories(mappedCategories);
      }
      let mappedRecurring = [];
      if (recRes.ok) {
        const recData = await recRes.json();
        mappedRecurring = recData.recurring || [];
        setRecurring(mappedRecurring);
      }
      localStorage.setItem("cache_index", JSON.stringify({
        expenses: mappedExpenses, movies: mappedMovies, topups: mappedTopups,
        budgetRules: mappedRules, challengeMeta: mappedChalMeta, challengeDays: mappedChalDays,
        customCategories: mappedCategories, recurring: mappedRecurring,
      }));
      setLoadError("");
    } catch (err) {
      const cached = localStorage.getItem("cache_index");
      if (cached) {
        try {
          const c = JSON.parse(cached);
          setExpenses(c.expenses || []);
          setMovies(c.movies || []);
          setTopups(c.topups || []);
          setBudgetRules(c.budgetRules || []);
          setChallengeMeta(c.challengeMeta || null);
          setChallengeDays(c.challengeDays || {});
          setCustomCategories(c.customCategories || []);
          setRecurring(c.recurring || []);
          setLoadError("You're offline — showing what was last saved. New entries will sync once you're back online.");
        } catch {
          setLoadError("Couldn't load your expenses. Check your connection and refresh.");
        }
      } else {
        setLoadError("You're offline and nothing's cached yet — connect once so this page can save a local copy.");
      }
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // Reload when something is added from the global ＋ sheet.
    const onChanged = () => load();
    window.addEventListener("ledger:changed", onChanged);
    // Home's "Add money" button links here with ?topup=1.
    if (new URLSearchParams(window.location.search).get("topup") === "1") setShowTopup(true);
    return () => window.removeEventListener("ledger:changed", onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountInputRef = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("quickadd") === "expense") {
      setSheetOpen(true);
      setTimeout(() => {
        amountInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        amountInputRef.current?.focus();
      }, 300);
    }
  }, [loaded]);

  // Handles the phone's native "Share" sheet, once this app is registered as
  // a share target (see manifest.json): sharing a UPI notification or a
  // note to Expense Ledger lands here as a URL like /?shared_text=...,
  // which gets parsed the same way a spoken amount does and dropped straight
  // into the form, open and ready to confirm.
  useEffect(() => {
    if (typeof window === "undefined" || !loaded) return;
    const params = new URLSearchParams(window.location.search);
    const sharedText = params.get("shared_text") || params.get("shared_title") || "";
    if (!sharedText.trim()) return;
    const parsed = parseVoiceExpense(sharedText);
    setExpenseForm((f) => ({
      ...f,
      amount: parsed.amount || f.amount,
      category: parsed.category || f.category,
      note: parsed.note || f.note,
    }));
    setSheetOpen(true);
    setTimeout(() => {
      amountInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      amountInputRef.current?.focus();
    }, 350);
    window.history.replaceState({}, "", "/transactions");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const movieItems = useMemo(() => {
    const items = [];
    for (const m of movies) {
      const qty = m.quantity || 1;
      const qtyLabel = qty > 1 ? ` ×${qty}` : "";
      if (m.ticketPrice > 0) {
        items.push({ id: `movie-${m.id}-ticket`, amount: m.ticketPrice * qty, category: MOVIE_CATEGORY.name, note: `${m.title} (ticket${qtyLabel})`, date: m.date, affectsBalance: m.affectsBalance });
      }
      if (m.canteenPrice > 0) {
        items.push({ id: `movie-${m.id}-canteen`, amount: m.canteenPrice * qty, category: MOVIE_CATEGORY.name, note: `${m.title} (canteen${qtyLabel})`, date: m.date, affectsBalance: m.affectsBalance });
      }
    }
    return items;
  }, [movies]);

  // Recurring templates not yet auto-generated for the current month show up
  // as a preview here — same date they'll actually land on — so you can see
  // the commitment coming instead of only after the cron job creates it.
  const recurringPendingItems = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return recurring
      .filter((r) => r.last_generated_month !== ym)
      .map((r) => ({
        id: `recurring-${r.id}`,
        amount: parseFloat(r.amount),
        category: r.category,
        note: r.note || "(recurring)",
        date: `${ym}-${String(Math.min(r.day_of_month, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())).padStart(2, "0")}`,
        affectsBalance: r.affects_balance !== false,
        isRecurringPending: true,
      }));
  }, [recurring]);

  const allItems = useMemo(() => [...expenses, ...movieItems, ...recurringPendingItems], [expenses, movieItems, recurringPendingItems]);

  const totalRecurringPerMonth = useMemo(() => recurring.reduce((s, r) => s + parseFloat(r.amount), 0), [recurring]);

  // Balance: expenses/movies dated in the future (e.g. an EMI you logged ahead of
  // time) don't reduce the balance until their date actually arrives. They still
  // show up in the "Upcoming" total below so you can plan for them.
  const today = todayISO();

  // If a "set current balance" top-up exists, it becomes the baseline: everything
  // before its date is ignored (the amount you typed already accounts for it),
  // and only additions/spend after that date apply on top.
  const baselineTopup = useMemo(() => {
    const setTopups = topups.filter((t) => t.mode === "set");
    if (setTopups.length === 0) return null;
    return [...setTopups].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })[0];
  }, [topups]);

  const balanceCalc = useMemo(() => {
    if (baselineTopup) {
      const afterAdds = topups
        .filter((t) => t.mode === "add" && t.date > baselineTopup.date)
        .reduce((s, t) => s + t.amount, 0);
      const spentAfter = allItems
        .filter((x) => x.affectsBalance !== false && x.date > baselineTopup.date && x.date <= today)
        .reduce((s, x) => s + x.amount, 0);
      return {
        balance: baselineTopup.amount + afterAdds - spentAfter,
        addedLabel: `${fmt(baselineTopup.amount)} set on ${new Date(baselineTopup.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${afterAdds > 0 ? ` + ${fmt(afterAdds)} added` : ""}`,
        spentLabel: fmt(spentAfter),
      };
    }
    const totalAdded = topups.filter((t) => t.mode === "add").reduce((s, t) => s + t.amount, 0);
    const totalSpent = allItems.filter((x) => x.affectsBalance !== false && x.date <= today).reduce((s, x) => s + x.amount, 0);
    return { balance: totalAdded - totalSpent, addedLabel: `${fmt(totalAdded)} added`, spentLabel: fmt(totalSpent) };
  }, [topups, allItems, baselineTopup, today]);

  function startEditExpense(x) {
    setEditingExpenseId(x.id);
    setExpenseForm({ amount: String(x.amount), category: x.category, note: x.note, date: x.date, time: x.time || "", affectsBalance: x.affectsBalance !== false, receiptPhoto: null, hasReceipt: !!x.hasReceipt });
    // Editing always shows the full form — the person may specifically be
    // here to fix the date or the deduct toggle.
    setExpenseMoreOpen(true);
    setSheetOpen(true);
    setFormError("");
  }

  function cancelEditExpense() {
    setEditingExpenseId(null);
    setExpenseForm(getEmptyExpenseForm());
    setExpenseMoreOpen(false);
    setSheetOpen(false);
    setFormError("");
  }

  function parseVoiceExpense(transcript) {
    const text = transcript.toLowerCase();
    const numMatch = text.match(/\d+(\.\d+)?/);
    const amount = numMatch ? numMatch[0] : "";
    const allCatNames = [...CATEGORIES.map((c) => c.name), ...customCategories.map((c) => c.name)];
    let matchedCategory = null;
    for (const name of allCatNames) {
      if (text.includes(name.toLowerCase())) { matchedCategory = name; break; }
    }
    let note = transcript;
    if (numMatch) note = note.replace(numMatch[0], "");
    if (matchedCategory) note = note.replace(new RegExp(matchedCategory, "i"), "");
    note = note.replace(/\b(rupees?|rs\.?|for|on|spent|paid|bucks)\b/gi, "").trim().replace(/\s+/g, " ");
    return { amount, category: matchedCategory, note };
  }

  function startVoiceAdd() {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      setVoiceError("Voice input isn't supported in this browser.");
      return;
    }
    setSheetOpen(true);
    setVoiceError("");
    const recognition = new SR();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const parsed = parseVoiceExpense(transcript);
      setExpenseForm((f) => ({
        ...f,
        amount: parsed.amount || f.amount,
        category: parsed.category || f.category,
        note: parsed.note || f.note,
      }));
    };
    recognition.onerror = () => setVoiceError("Didn't catch that — try again or type it in.");
    recognition.onend = () => setVoiceListening(false);
    recognition.start();
  }

  async function handleReceiptChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file) return;
    setReceiptUploading(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setExpenseForm((f) => ({ ...f, receiptPhoto: dataUrl }));
    } catch {
      setFormError("Couldn't process that photo — try again.");
    } finally {
      setReceiptUploading(false);
    }
  }

  // Photos aren't in the list payload; fetch one when it's asked for and show
  // it in an in-app overlay (browsers block window.open on data: URLs).
  async function openReceipt(x) {
    if (x.receiptPhoto) { setReceiptView(x.receiptPhoto); return; }
    setReceiptView("loading");
    try {
      const res = await fetch(`/api/data?type=receipts&ids=${x.id}`);
      if (!res.ok) throw new Error();
      const { receipts } = await res.json();
      if (!receipts[x.id]) throw new Error();
      setReceiptView(receipts[x.id]);
    } catch {
      setReceiptView(null);
      showToast("Couldn't load that receipt", "⚠️");
    }
  }

  async function submitExpense(e) {
    e.preventDefault();
    const amt = parseFloat(expenseForm.amount);
    if (!expenseForm.amount || isNaN(amt) || amt <= 0) {
      setFormError("Enter an amount greater than 0");
      return;
    }
    if (!expenseForm.date) {
      setFormError("Pick a date");
      return;
    }
    if (expenseForm.category === "Other" && !expenseForm.note.trim()) {
      setFormError("Add a reason for this Other expense");
      return;
    }
    setFormError("");
    setSubmitting(true);
    const isEdit = editingExpenseId !== null;
    const payload = {
      type: "expenses",
      ...(isEdit ? { id: editingExpenseId } : { clientRequestId: newRequestId() }),
      amount: amt,
      category: expenseForm.category,
      note: expenseForm.note.trim(),
      date: expenseForm.date,
      time: expenseForm.time,
      affectsBalance: expenseForm.affectsBalance,
      // On edit: null keeps the stored photo, "" removes it, a data URL replaces it.
      receiptPhoto: isEdit ? expenseForm.receiptPhoto : expenseForm.receiptPhoto || "",
    };

    let res;
    try {
      res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      // Genuine network failure (offline) — queue it and show it locally right away.
      const queued = queueRequest({ url: "/api/data", method: isEdit ? "PUT" : "POST", body: payload });
      if (!queued.ok) {
        setSubmitting(false);
        setFormError("You're offline and this phone's storage is full — couldn't save. Try again when online.");
        return;
      }
      if (!isEdit) {
        const keptPhoto = queued.droppedPhoto ? "" : expenseForm.receiptPhoto || "";
        setExpenses((prev) => [
          { id: `pending-${Date.now()}`, amount: amt, category: expenseForm.category, note: expenseForm.note.trim(), date: expenseForm.date, time: expenseForm.time, affectsBalance: expenseForm.affectsBalance !== false, receiptPhoto: keptPhoto, hasReceipt: !!keptPhoto, pending: true },
          ...prev,
        ]);
      }
      cancelEditExpense();
      setSubmitting(false);
      showToast(
        queued.droppedPhoto ? "Saved without the photo (storage full) — will sync once online" : "Saved — will sync once you're back online",
        "📥"
      );
      return;
    }

    try {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      // Big-expense check, using history from before this save: flag a new
      // entry that's well above what's normal for its category — a nudge,
      // not a block, so it's shown after the success toast rather than
      // instead of it.
      if (!isEdit) {
        const sameCategoryPast = expenses.filter((x) => x.category === expenseForm.category && x.affectsBalance !== false);
        if (sameCategoryPast.length >= 3) {
          const avg = sameCategoryPast.reduce((s, x) => s + x.amount, 0) / sameCategoryPast.length;
          if (amt > avg * 2.5 && amt - avg > 200) {
            setTimeout(() => showToast(`That's ${Math.round(amt / avg)}x your usual ${expenseForm.category} spend (avg ${fmt(avg)})`, "👀"), 900);
          }
        }
      }
      vibrate(10);
      cancelEditExpense();
      await load();
      showToast(isEdit ? "Expense updated" : "Expense logged", isEdit ? "✏️" : "✅");
    } catch (err) {
      setFormError(err.message || "Couldn't save that expense. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Spot entries that weren't there a moment ago so they can pop in.
  useEffect(() => {
    if (expenses.length === 0) return;
    const ids = new Set(expenses.map((x) => x.id));
    if (seenIds.current) {
      const added = expenses.filter((x) => !seenIds.current.has(x.id)).map((x) => x.id);
      if (added.length > 0 && added.length <= 3) {
        setFreshIds(added);
        setTimeout(() => setFreshIds([]), 900);
      }
    }
    seenIds.current = ids;
  }, [expenses]);

  async function removeExpense(id) {
    if (!window.confirm("Delete this expense? This can't be undone.")) return;
    const prev = expenses;
    setRemovingIds((r) => [...r, id]);
    await new Promise((r) => setTimeout(r, 300));
    setExpenses(expenses.filter((x) => x.id !== id));
    setRemovingIds((r) => r.filter((x) => x !== id));
    try {
      const res = await fetch(`/api/data?type=expenses&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setExpenses(prev);
      setLoadError("Couldn't delete that entry. Try again.");
    }
  }

  function startEditTopup(t) {
    setEditingTopupId(t.id);
    setTopupForm({ amount: String(t.amount), note: t.note, date: t.date, mode: t.mode });
    setShowTopup(true);
    setTopupError("");
  }

  function cancelEditTopup() {
    setEditingTopupId(null);
    setTopupForm(getEmptyTopupForm());
    setShowTopup(false);
    setTopupError("");
  }

  async function submitTopup(e) {
    e.preventDefault();
    const amt = parseFloat(topupForm.amount);
    if (!topupForm.amount || isNaN(amt) || amt <= 0) {
      setTopupError("Enter an amount greater than 0");
      return;
    }
    if (!topupForm.date) {
      setTopupError("Pick a date");
      return;
    }
    setTopupError("");
    setTopupSubmitting(true);
    try {
      const isEdit = editingTopupId !== null;
      const res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "balance", ...(isEdit ? { id: editingTopupId } : {}), amount: amt, note: topupForm.note.trim(), date: topupForm.date, mode: topupForm.mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      const wasEdit = editingTopupId !== null;
      vibrate(10);
      cancelEditTopup();
      await load();
      showToast(wasEdit ? "Balance entry updated" : "Balance updated", "💰");
    } catch (err) {
      setTopupError(err.message || "Couldn't save that. Try again.");
    } finally {
      setTopupSubmitting(false);
    }
  }

  async function removeTopup(id) {
    if (!window.confirm("Delete this top-up? This can't be undone.")) return;
    const prev = topups;
    setTopups(topups.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/data?type=balance&id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setTopups(prev);
      setLoadError("Couldn't remove that top-up. Try again.");
    }
  }

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthItems = useMemo(() => {
    return allItems.filter((x) => {
      const d = new Date(x.date + "T00:00:00");
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [allItems, year, month]);

  const spentSoFar = monthItems.filter((x) => x.date <= today).reduce((s, x) => s + x.amount, 0);
  const upcomingItems = useMemo(() => monthItems.filter((x) => x.date > today), [monthItems, today]);
  const upcomingTotal = upcomingItems.reduce((s, x) => s + x.amount, 0);
  const total = spentSoFar + upcomingTotal;

  const lastMonthDate = new Date(year, month - 1, 1);
  const lastMonthTotal = useMemo(() => {
    return allItems
      .filter((x) => {
        const d = new Date(x.date + "T00:00:00");
        return d.getFullYear() === lastMonthDate.getFullYear() && d.getMonth() === lastMonthDate.getMonth();
      })
      .reduce((s, x) => s + x.amount, 0);
  }, [allItems, year, month]);

  const diff = lastMonthTotal > 0 ? ((spentSoFar - lastMonthTotal) / lastMonthTotal) * 100 : null;

  const byCategory = useMemo(() => {
    const map = {};
    for (const c of CATEGORIES) map[c.name] = 0;
    for (const c of customCategories) map[c.name] = 0;
    map[MOVIE_CATEGORY.name] = 0;
    for (const x of monthItems) map[x.category] = (map[x.category] || 0) + x.amount;
    return [...CATEGORIES, ...customCategories, MOVIE_CATEGORY]
      .map((c) => ({ name: c.name, value: map[c.name], color: c.color }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [monthItems, customCategories]);

  const overallRule = budgetRules.find((r) => r.ruleType === "overall");
  const lowBalanceRule = budgetRules.find((r) => r.ruleType === "low_balance");
  const balanceStatus = balanceCalc.balance < 0 ? "negative" : (lowBalanceRule && balanceCalc.balance < lowBalanceRule.amount) ? "low" : "ok";
  const balanceColor = balanceStatus === "negative" ? "var(--danger)" : balanceStatus === "low" ? "var(--warn)" : "var(--ink)";
  const balancePanelBg = balanceStatus === "negative" ? "var(--danger-bg)" : balanceStatus === "low" ? "var(--warn-bg)" : "var(--surface-2)";
  const animatedBalance = useCountUp(balanceCalc.balance);

  // ---- Forecast + safe-to-spend (current month only) ----
  const forecast = useMemo(() => {
    const now = new Date();
    if (year !== now.getFullYear() || month !== now.getMonth()) return null;
    const dim = new Date(year, month + 1, 0).getDate();
    const dom = now.getDate();
    const daysLeft = dim - dom + 1; // includes today
    const spentBeforeToday = monthItems.filter((x) => x.date < today).reduce((s, x) => s + x.amount, 0);
    const spentToday = monthItems.filter((x) => x.date === today).reduce((s, x) => s + x.amount, 0);
    const pastDays = Math.max(1, dom - 1);
    const dailyAvg = dom > 1 ? spentBeforeToday / pastDays : spentToday;
    const projected = spentSoFar + upcomingTotal + dailyAvg * (dim - dom);
    const upcomingDeducting = upcomingItems.filter((x) => x.affectsBalance !== false).reduce((s, x) => s + x.amount, 0);
    // Money you can spend per day for the rest of the month without dipping below zero.
    const pool = balanceCalc.balance + spentToday - upcomingDeducting;
    const safePerDay = Math.max(0, pool / daysLeft);
    return { dim, dom, daysLeft, projected, spentToday, safePerDay, dailyAvg, enough: dom >= 3 };
  }, [monthItems, year, month, today, spentSoFar, upcomingTotal, upcomingItems, balanceCalc.balance]);

  // ---- Quick-add chips: your most repeated entries, one tap to log ----
  const quickChips = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const map = {};
    for (const x of expenses) {
      if (x.category === MOVIE_CATEGORY.name || x.date < cutoff || x.pending) continue;
      if (x.category === "Other" && !x.note) continue;
      const key = `${x.category}|${x.note || ""}|${x.amount}`;
      map[key] = map[key] || { category: x.category, note: x.note || "", amount: x.amount, count: 0 };
      map[key].count++;
    }
    return Object.values(map).filter((c) => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [expenses]);

  async function quickAdd(c) {
    vibrate(12);
    const payload = { type: "expenses", clientRequestId: newRequestId(), amount: c.amount, category: c.category, note: c.note, date: todayISO(), time: nowTimeHHMM(), affectsBalance: true, receiptPhoto: "" };
    try {
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      await load();
      showToast(`${c.note || c.category} ${fmt(c.amount)} logged`, "✅");
    } catch {
      queueRequest({ url: "/api/data", method: "POST", body: payload });
      setExpenses((prev) => [{ id: `pending-${Date.now()}`, ...c, date: todayISO(), time: nowTimeHHMM(), affectsBalance: true, hasReceipt: false, pending: true }, ...prev]);
      showToast("Saved — will sync once you're back online", "📥");
    }
  }
  const categoryRuleMap = useMemo(() => {
    const map = {};
    for (const r of budgetRules) if (r.ruleType === "category") map[r.category] = r.amount;
    return map;
  }, [budgetRules]);
  const categoryBreaches = byCategory.filter((c) => categoryRuleMap[c.name] && c.value > categoryRuleMap[c.name]);
  const overallBreach = overallRule && spentSoFar > overallRule.amount;

  const currentStreak = useMemo(() => {
    if (!challengeMeta) return null;
    let streak = 0;
    const start = challengeMeta.start_date.slice(0, 10);
    for (let i = 0; i < challengeMeta.length_days; i++) {
      const d = new Date(start + "T00:00:00");
      d.setDate(d.getDate() + i);
      const off = d.getTimezoneOffset() * 60000;
      const iso = new Date(d - off).toISOString().slice(0, 10);
      if (iso > today) break;
      if (challengeDays[iso] === true) streak++;
      else if (iso in challengeDays) streak = 0;
    }
    return streak;
  }, [challengeMeta, challengeDays, today]);

  const moviesThisMonth = useMemo(() => movies.filter((m) => m.date.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`).length, [movies, year, month]);

  const loggedToday = useMemo(() => {
    return expenses.some((x) => x.date === today) || movies.some((m) => m.date === today) || (challengeMeta && today in challengeDays);
  }, [expenses, movies, challengeMeta, challengeDays, today]);

  const grouped = useMemo(() => {
    const sorted = [...monthItems].sort((a, b) => (a.date < b.date ? 1 : -1));
    const map = new Map();
    for (const x of sorted) {
      if (!map.has(x.date)) map.set(x.date, []);
      map.get(x.date).push(x);
    }
    return Array.from(map.entries());
  }, [monthItems]);

  function formatDateLabel(iso) {
    const d = new Date(iso + "T00:00:00");
    if (iso === today) return "Today";
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }

  function catColor(name) {
    if (name === MOVIE_CATEGORY.name) return MOVIE_CATEGORY.color;
    return CATEGORIES.find((c) => c.name === name)?.color || customCategories.find((c) => c.name === name)?.color || "#6B6558";
  }

  if (!loaded) {
    return (
      <div className="page-container" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
        <div className="skeleton" style={{ height: 30, width: 190, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 14, width: 270, maxWidth: "100%", marginBottom: 30 }} />
        <div className="skeleton" style={{ height: 36, width: 230, maxWidth: "100%", marginBottom: 22, borderRadius: 999 }} />
        <div className="skeleton" style={{ height: 112, marginBottom: 28, borderRadius: 20 }} />
        <div className="skeleton" style={{ height: 46, width: 210, marginBottom: 28 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 54, marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
      {loadError && (
        <div style={{ background: "var(--danger-bg)", border: "1px solid #D85A30", color: "#712B13", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link href="/" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>← Home</Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
          <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>Transactions</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setViewDate(new Date(year, month - 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "var(--text-2)" }} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <div className="tabnum" style={{ fontSize: 14, fontWeight: 500, minWidth: 130, textAlign: "center" }}>
            {MONTH_NAMES[month]} {year}
          </div>
          <button onClick={() => setViewDate(new Date(year, month + 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "var(--text-2)" }} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
        </div>
      </div>

      {/* Balance */}
      <div className="panel-soft" style={{ background: balancePanelBg, borderRadius: 6, padding: "18px 20px", marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Balance available</div>
            <div className="lora tabnum count-up" style={{ fontSize: "clamp(24px, 7vw, 32px)", fontWeight: 600, lineHeight: 1, color: balanceColor }}>
              {fmt(animatedBalance)}
            </div>
            {balanceStatus === "low" && (
              <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 4 }}>Below your {fmt(lowBalanceRule.amount)} alert threshold</div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              {balanceCalc.addedLabel} · {balanceCalc.spentLabel} deducted
            </div>
          </div>
          <button
            onClick={() => (showTopup ? cancelEditTopup() : setShowTopup(true))}
            style={{ background: showTopup ? "var(--line)" : "var(--ink)", color: showTopup ? "var(--ink)" : "var(--bg)", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            {showTopup ? <X size={14} /> : <Plus size={14} />} {showTopup ? "Cancel" : "Add money"}
          </button>
        </div>

        {showTopup && (
          <form onSubmit={submitTopup} style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setTopupForm({ ...topupForm, mode: "add" })}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 20, border: "1px solid " + (topupForm.mode === "add" ? "var(--ink)" : "var(--line-strong)"), background: topupForm.mode === "add" ? "var(--ink)" : "transparent", color: topupForm.mode === "add" ? "var(--bg)" : "var(--text-2)", cursor: "pointer" }}
              >
                Add to balance
              </button>
              <button
                type="button"
                onClick={() => setTopupForm({ ...topupForm, mode: "set" })}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 20, border: "1px solid " + (topupForm.mode === "set" ? "var(--ink)" : "var(--line-strong)"), background: topupForm.mode === "set" ? "var(--ink)" : "transparent", color: topupForm.mode === "set" ? "var(--bg)" : "var(--text-2)", cursor: "pointer" }}
              >
                Set current balance
              </button>
            </div>
            {topupForm.mode === "set" && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, maxWidth: 420 }}>
                Use this when you're pasting in whatever amount you currently have on hand, partway through the month. It replaces the balance as of this date — expenses before this date won't be subtracted again.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              <input type="number" inputMode="decimal" placeholder="Amount (₹)" value={topupForm.amount} onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })} step="0.01" min="0" style={{ width: 140 }} />
              <input type="text" placeholder="Source (optional)" value={topupForm.note} onChange={(e) => setTopupForm({ ...topupForm, note: e.target.value })} maxLength={60} style={{ width: 160 }} />
              <input type="date" value={topupForm.date} onChange={(e) => setTopupForm({ ...topupForm, date: e.target.value })} max={todayISO()} style={{ width: 150 }} />
              <button type="submit" disabled={topupSubmitting} className="pill" style={{ background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 500, cursor: topupSubmitting ? "default" : "pointer", opacity: topupSubmitting ? 0.6 : 1 }}>
                {topupSubmitting ? "Saving…" : editingTopupId ? "Save changes" : "Add"}
              </button>
            </div>
            {topupError && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{topupError}</div>}
          </form>
        )}

        {topups.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line-strong)", paddingTop: 10 }}>
            {topups.slice(0, 5).map((t) => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-2)", padding: "4px 0" }}>
                <span>
                  {new Date(t.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  {t.note && <> · {t.note}</>}
                  {t.mode === "set" && <span style={{ color: "#7A3E56" }}> · set balance</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="tabnum" style={{ color: t.mode === "set" ? "#7A3E56" : "var(--success)" }}>{t.mode === "set" ? "= " : "+"}{fmt(t.amount)}</span>
                  <button onClick={() => startEditTopup(t)} aria-label="Edit top-up" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--faint)", padding: 2, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-2)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--faint)")}>
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => removeTopup(t.id)} aria-label="Delete top-up" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--faint)", padding: 2, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--faint)")}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hero total */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Spent in {MONTH_NAMES[month]}</div>
          <div className="lora tabnum" style={{ fontSize: "clamp(30px, 9vw, 44px)", fontWeight: 600, lineHeight: 1 }}>
            <CountUp value={spentSoFar} format={fmt} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Includes movie tickets and canteen spend</div>
        </div>
        {diff !== null && (
          <div style={{ fontSize: 13, color: diff > 0 ? "var(--danger)" : "var(--success)", paddingBottom: 8 }}>
            {describeChange(spentSoFar, lastMonthTotal)} vs {MONTH_NAMES[lastMonthDate.getMonth()]}
            <span style={{ color: "var(--muted)" }}> ({fmt(lastMonthTotal)})</span>
          </div>
        )}
      </div>

      {upcomingTotal > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--amber)", marginBottom: 40 }}>
          <Clock size={14} />
          <span><strong className="tabnum"><CountUp value={upcomingTotal} format={fmt} /></strong> scheduled later this month ({upcomingItems.length} item{upcomingItems.length !== 1 ? "s" : ""}, not yet deducted from balance)</span>
        </div>
      )}
      {upcomingTotal === 0 && <div style={{ marginBottom: upcomingTotal > 0 || overallBreach || categoryBreaches.length > 0 ? 0 : 40 }} />}

      {(overallBreach || categoryBreaches.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--danger)", marginBottom: 40, flexWrap: "wrap" }}>
          <span>
            Over budget:{" "}
            {overallBreach && <>overall by <strong className="tabnum">{fmt(spentSoFar - overallRule.amount)}</strong></>}
            {overallBreach && categoryBreaches.length > 0 && ", "}
            {categoryBreaches.map((c, i) => (
              <span key={c.name}>
                {c.name} by <strong className="tabnum">{fmt(c.value - categoryRuleMap[c.name])}</strong>{i < categoryBreaches.length - 1 ? ", " : ""}
              </span>
            ))}
          </span>
          <Link href="/budget" style={{ color: "var(--danger)", fontSize: 12, textDecoration: "underline" }}>Adjust rules →</Link>
        </div>
      )}

      {sheetOpen && <div className="sheet-backdrop" onClick={() => !editingExpenseId && setSheetOpen(false)} />}

      <button
        type="button"
        className="mobile-fab-add"
        aria-label="Add expense"
        onClick={() => {
          setSheetOpen(true);
          setTimeout(() => {
            amountInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            amountInputRef.current?.focus();
          }, 350);
        }}
      >
        <Plus size={24} />
      </button>

      <div className="responsive-grid">
        <div>
          {editingExpenseId !== null && (<>
          <div className="sheet-scrim" onClick={cancelEditExpense} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Edit expense" data-no-tab-swipe="1">
            <div className="sheet-handle" />
            <div className="sheet-peek" onClick={() => setSheetOpen((v) => !v)}>
              <span className="sheet-drag-handle" />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>
                  {editingExpenseId ? "Edit expense" : "Add an expense"}
                </div>
                {!editingExpenseId && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startVoiceAdd(); }}
                    disabled={voiceListening}
                    title="Speak an expense, e.g. '250 for food swiggy'"
                    style={{ display: "flex", alignItems: "center", gap: 5, background: voiceListening ? "var(--danger)" : "var(--surface-2)", color: voiceListening ? "var(--bg)" : "var(--text-2)", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 12, cursor: voiceListening ? "default" : "pointer" }}
                  >
                    <Mic size={13} /> {voiceListening ? "Listening…" : "Speak to add"}
                  </button>
                )}
              </div>
            </div>
          {voiceError && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: -6, marginBottom: 10 }}>{voiceError}</div>}
          {!editingExpenseId && quickChips.length > 0 && (
            <div data-no-tab-swipe="1" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
              {quickChips.map((c) => (
                <button key={`${c.category}|${c.note}|${c.amount}`} type="button" className="story-chip" onClick={() => quickAdd(c)} style={{ flexShrink: 0, background: "none", borderRadius: 20, padding: "6px 12px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", whiteSpace: "nowrap" }}>
                  ⚡ {c.note || c.category} · {fmt(c.amount)}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submitExpense} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input ref={amountInputRef} type="number" inputMode="decimal" placeholder="Amount (₹)" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} step="0.01" min="0" />
            <select value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
              {customCategories.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder={expenseForm.category === "Other" ? "Reason (required)" : "Note (optional)"}
                value={expenseForm.note}
                onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })}
                maxLength={80}
                style={{ flex: 1, ...(expenseForm.category === "Other" ? { borderColor: "var(--danger)" } : {}) }}
              />
              <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" onChange={handleReceiptChange} style={{ display: "none" }} />
              <button
                type="button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={receiptUploading}
                title="Attach a photo of the receipt"
                aria-label="Attach receipt photo"
                style={{ flexShrink: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center", background: expenseForm.receiptPhoto ? "var(--surface-2)" : "none", border: "1px solid var(--line-strong)", borderRadius: 8, color: expenseForm.receiptPhoto ? "var(--danger)" : "var(--text-2)", cursor: receiptUploading ? "default" : "pointer" }}
              >
                <Camera size={16} />
              </button>
            </div>
            {receiptUploading && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -6 }}>Processing photo…</div>}
            {(expenseForm.receiptPhoto || (expenseForm.receiptPhoto === null && expenseForm.hasReceipt)) && !receiptUploading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: -4 }}>
                {expenseForm.receiptPhoto ? (
                  <img src={expenseForm.receiptPhoto} alt="Receipt" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line-strong)" }} />
                ) : (
                  <button type="button" onClick={() => openReceipt({ id: editingExpenseId })} style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                    View
                  </button>
                )}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Receipt attached</span>
                <button type="button" onClick={() => setExpenseForm({ ...expenseForm, receiptPhoto: "", hasReceipt: false })} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                  Remove
                </button>
              </div>
            )}
            {expenseMoreOpen ? (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} style={{ flex: 1 }} />
                  <input type="time" value={expenseForm.time} onChange={(e) => setExpenseForm({ ...expenseForm, time: e.target.value })} style={{ flex: 1 }} />
                </div>
                {expenseForm.date > todayISO() && (
                  <div style={{ fontSize: 12, color: "var(--amber)", marginTop: -6 }}>Future date — won't reduce your balance until this day arrives</div>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
                  <input type="checkbox" checked={expenseForm.affectsBalance} onChange={(e) => setExpenseForm({ ...expenseForm, affectsBalance: e.target.checked })} style={{ width: "auto" }} />
                  Deduct from balance
                </label>
                {!editingExpenseId && (
                  <button type="button" onClick={() => setExpenseMoreOpen(false)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: "var(--muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                    Hide date &amp; time options
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => setExpenseMoreOpen(true)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: "var(--muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                Backdate, schedule, or exclude from balance →
              </button>
            )}
            {formError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={submitting}
                style={{ flex: 1, marginTop: 4, background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={16} /> {submitting ? "Saving…" : editingExpenseId ? "Save changes" : "Add expense"}
              </button>
              {editingExpenseId && (
                <button type="button" onClick={cancelEditExpense} style={{ marginTop: 4, background: "var(--line)", color: "var(--ink)", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          </div>
          </>)}

          {byCategory.length > 0 && (
            <div style={{ marginTop: 36 }}>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                By category
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {byCategory.map((c) => (
                  <div key={c.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: c.color }} />{c.name}
                      </span>
                      <span className="tabnum" style={{ color: "var(--text-2)" }}>{fmt(c.value)} · {Math.round((c.value / Math.max(1, byCategory.reduce((t, x) => t + x.value, 0))) * 100)}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
                      <div className="bar-grow" style={{ height: "100%", width: `${(c.value / byCategory[0].value) * 100}%`, background: c.color, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Transactions
          </div>
          <PullToRefresh onRefresh={load}>
          {grouped.length === 0 ? (
            <div style={{ border: "1px dashed var(--line-strong)", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
              <Wallet size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>Nothing logged for {MONTH_NAMES[month]} yet.</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>Tap ＋ at the bottom to add one.</div>
            </div>
          ) : (
            <div>
              {grouped.map(([dateKey, items]) => (
                <div key={dateKey} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, color: dateKey > today ? "var(--amber)" : "var(--muted)", marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                    <span>{formatDateLabel(dateKey)}{dateKey > today && " · scheduled"}</span>
                    <span className="tabnum">{fmt(items.reduce((s, x) => s + x.amount, 0))}</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--line)" }}>
                    {items.map((x) => {
                      const isMovie = x.category === MOVIE_CATEGORY.name;
                      const canSwipeDelete = !isMovie && !x.pending && !x.isRecurringPending;
                      const rowClass = removingIds.includes(x.id) ? "row-leave" : freshIds.includes(x.id) ? "row-new" : "";
                      const row = (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line)", gap: 12, background: "var(--bg)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <CategoryIcon category={x.category} color={catColor(x.category)} size={34} />
                            {x.hasReceipt && (
                              <button
                                type="button"
                                onClick={() => openReceipt(x)}
                                aria-label="View receipt"
                                title="View receipt"
                                style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, flexShrink: 0, cursor: "pointer", background: "var(--surface-2)", border: "1px solid var(--line-strong)", color: "var(--text-2)", padding: 0 }}
                              >
                                <Paperclip size={14} />
                              </button>
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {x.note || x.category}
                                {x.time && <span style={{ fontSize: 11.5, color: "var(--muted)" }}> · {x.time}</span>}
                                {x.affectsBalance === false && <span style={{ fontSize: 11.5, color: "var(--muted)" }}> · not deducted</span>}
                                {x.pending && <span style={{ fontSize: 11.5, color: "var(--warn)" }}> · pending sync</span>}
                                {x.isRecurringPending && <span style={{ fontSize: 11.5, color: "var(--amber)" }}> · recurring, not yet posted</span>}
                              </div>
                              {x.note && <div style={{ fontSize: 12, color: "var(--muted)" }}>{x.category}</div>}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <span className="tabnum" style={{ fontSize: 14, fontWeight: 500 }}>{fmt(x.amount)}</span>
                            {!isMovie && !x.pending && !x.isRecurringPending && (
                              <>
                                <button onClick={() => startEditExpense(x)} aria-label="Edit" className="icon-btn">
                                  <Pencil size={17} />
                                </button>
                                <button onClick={() => removeExpense(x.id)} aria-label="Delete" className="icon-btn danger">
                                  <Trash2 size={17} />
                                </button>
                              </>
                            )}
                            {x.pending && <span style={{ fontSize: 11.5, color: "var(--warn)" }}>syncing…</span>}
                            {x.isRecurringPending && <Link href="/settings" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>edit in Settings →</Link>}
                            {isMovie && (
                              <Link href="/movies" style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none" }}>edit on Movies →</Link>
                            )}
                          </div>
                        </div>
                      );
                      return canSwipeDelete ? (
                        <SwipeRow key={x.id} className={rowClass} onDelete={() => removeExpense(x.id)}>{row}</SwipeRow>
                      ) : (
                        <div key={x.id} className={rowClass}>{row}</div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          </PullToRefresh>
        </div>
      </div>
      {receiptView && (
        <div
          role="dialog"
          aria-label="Receipt"
          onClick={() => setReceiptView(null)}
          style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(20,17,14,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          {receiptView === "loading" ? (
            <span style={{ color: "var(--bg)", fontSize: 13 }}>Loading receipt…</span>
          ) : (
            <img src={receiptView} alt="Receipt" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }} />
          )}
          <button
            type="button"
            onClick={() => setReceiptView(null)}
            aria-label="Close"
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(251,248,242,0.15)", border: "none", borderRadius: 999, color: "var(--bg)", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
