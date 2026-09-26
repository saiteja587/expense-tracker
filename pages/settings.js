"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Trash2, Check, Moon, Sun, Lock, Download, Upload, Pencil, X, Bell, Copy, Fingerprint } from "lucide-react";

const BASE_CATEGORY_COLORS = ["#B5533C", "#C98A2C", "#3F6E5B", "#5B3A5C", "#2F4858", "#A3763F", "#6B7A3E", "#8A4B6B", "#6B6558"];

export default function SettingsPage() {
  const [categories, setCategories] = useState([]);
  const [newCat, setNewCat] = useState("");
  const [theatres, setTheatres] = useState([]);
  const [newTheatre, setNewTheatre] = useState("");
  const [ottPlatforms, setOttPlatforms] = useState([]);
  const [newOtt, setNewOtt] = useState("");
  const [recurring, setRecurring] = useState([]);
  const [recForm, setRecForm] = useState({ amount: "", category: "Bills", note: "", dayOfMonth: "1" });
  const [recError, setRecError] = useState("");
  const [editingRecId, setEditingRecId] = useState(null);

  const [recurringIncome, setRecurringIncome] = useState([]);
  const [incForm, setIncForm] = useState({ amount: "", note: "", dayOfMonth: "1" });
  const [incError, setIncError] = useState("");
  const [editingIncId, setEditingIncId] = useState(null);

  const [recurringConfirmations, setRecurringConfirmations] = useState({});

  const [savingsGoal, setSavingsGoalState] = useState(null);
  const [goalForm, setGoalForm] = useState({ label: "", targetAmount: "", targetDate: "" });
  const [goalError, setGoalError] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);

  const MILESTONE_DAYS = [7, 14, 21, 30, 41];
  const [milestoneRewards, setMilestoneRewardsState] = useState({});
  const [rewardSaving, setRewardSaving] = useState(false);

  const [hasPin, setHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSaving, setPinSaving] = useState(false);

  const [darkMode, setDarkMode] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const [notifStatus, setNotifStatus] = useState("checking"); // checking | unsupported | denied | off | on
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [copied, setCopied] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const [catRes, recRes, incRes, confRes, pinRes, theatreRes, ottRes, goalRes, rewardRes] = await Promise.all([
        fetch("/api/data?type=categories"),
        fetch("/api/data?type=recurring"),
        fetch("/api/data?type=recurring-income"),
        fetch("/api/data?type=recurring-confirmations"),
        fetch("/api/data?type=pin-status"),
        fetch("/api/data?type=theatres"),
        fetch("/api/data?type=ott-platforms"),
        fetch("/api/data?type=savings-goal"),
        fetch("/api/data?type=milestone-rewards"),
      ]);
      if (catRes.ok) setCategories((await catRes.json()).categories || []);
      if (recRes.ok) setRecurring((await recRes.json()).recurring || []);
      if (incRes.ok) setRecurringIncome((await incRes.json()).recurringIncome || []);
      if (confRes.ok) setRecurringConfirmations((await confRes.json()).confirmations || {});
      if (pinRes.ok) setHasPin((await pinRes.json()).hasPin);
      if (theatreRes.ok) setTheatres((await theatreRes.json()).theatres || []);
      if (ottRes.ok) setOttPlatforms((await ottRes.json()).ottPlatforms || []);
      if (goalRes.ok) {
        const g = (await goalRes.json()).goal;
        setSavingsGoalState(g);
        if (g) setGoalForm({ label: g.label || "", targetAmount: String(g.targetAmount), targetDate: g.targetDate || "" });
      }
      if (rewardRes.ok) setMilestoneRewardsState((await rewardRes.json()).rewards || {});
    } catch (e) {
      // best-effort
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    setDarkMode(localStorage.getItem("darkMode") === "1");
    checkNotifStatus();
    checkBiometricSupport();
  }, []);

  async function checkBiometricSupport() {
    setBioEnabled(localStorage.getItem("biometricEnabled") === "1" && !!localStorage.getItem("biometricCredentialId"));
    if (!window.PublicKeyCredential || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      setBioSupported(false);
      return;
    }
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      setBioSupported(available);
    } catch {
      setBioSupported(false);
    }
  }

  function toBase64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64url(str) {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  async function enableBiometric() {
    setBioBusy(true);
    setBioError("");
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Expense Ledger" },
          user: { id: userId, name: "device-owner", displayName: "Device owner" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 60000,
        },
      });
      if (!credential) throw new Error("No credential returned");
      localStorage.setItem("biometricCredentialId", toBase64url(credential.rawId));
      localStorage.setItem("biometricEnabled", "1");
      setBioEnabled(true);
    } catch (e) {
      setBioError("Couldn't set up biometric unlock on this device. Your phone may have declined the request.");
    } finally {
      setBioBusy(false);
    }
  }

  function disableBiometric() {
    localStorage.removeItem("biometricCredentialId");
    localStorage.removeItem("biometricEnabled");
    setBioEnabled(false);
  }

  async function checkNotifStatus() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setNotifStatus("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setNotifStatus(sub ? "on" : "off");
    } catch {
      setNotifStatus("off");
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function enableNotifications() {
    setNotifBusy(true);
    setNotifError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNotifStatus(permission === "denied" ? "denied" : "off");
        setNotifBusy(false);
        return;
      }
      const keyRes = await fetch("/api/data?type=vapid-public-key");
      const { key } = await keyRes.json();
      if (!key) {
        setNotifError("Notifications aren't set up on the server yet — the VAPID keys need to be added as environment variables first.");
        setNotifBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save-subscription", subscription: sub.toJSON() }),
      });
      setNotifStatus("on");
    } catch (e) {
      setNotifError("Couldn't enable notifications on this device. Try again.");
    } finally {
      setNotifBusy(false);
    }
  }

  async function disableNotifications() {
    setNotifBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "remove-subscription", endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setNotifStatus("off");
    } catch {
      setNotifError("Couldn't turn off notifications. Try again.");
    } finally {
      setNotifBusy(false);
    }
  }

  function copyWaterUrl() {
    const url = `${window.location.origin}/api/notify-water?secret=YOUR_WATER_NOTIFY_SECRET`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleDarkMode() {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem("darkMode", next ? "1" : "0");
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
  }

  async function addCategory(e) {
    e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    const color = BASE_CATEGORY_COLORS[categories.length % BASE_CATEGORY_COLORS.length];
    const next = [...categories, { name, color }];
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "categories", categories: next }),
    });
    if (res.ok) {
      setCategories(next);
      setNewCat("");
    }
  }

  async function removeCategory(name) {
    if (!window.confirm("Remove this category? Past entries keep it, but you won't be able to pick it again.")) return;
    const next = categories.filter((c) => c.name !== name);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "categories", categories: next }),
    });
    if (res.ok) setCategories(next);
  }

  async function addTheatre(e) {
    e.preventDefault();
    const name = newTheatre.trim();
    if (!name || theatres.includes(name)) return;
    const next = [...theatres, name];
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "theatres", theatres: next }),
    });
    if (res.ok) { setTheatres(next); setNewTheatre(""); }
  }

  async function removeTheatre(name) {
    const next = theatres.filter((t) => t !== name);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "theatres", theatres: next }),
    });
    if (res.ok) setTheatres(next);
  }

  async function addOtt(e) {
    e.preventDefault();
    const name = newOtt.trim();
    if (!name || ottPlatforms.includes(name)) return;
    const next = [...ottPlatforms, name];
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ott-platforms", ottPlatforms: next }),
    });
    if (res.ok) { setOttPlatforms(next); setNewOtt(""); }
  }

  async function removeOtt(name) {
    const next = ottPlatforms.filter((o) => o !== name);
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ott-platforms", ottPlatforms: next }),
    });
    if (res.ok) setOttPlatforms(next);
  }

  async function addRecurring(e) {
    e.preventDefault();
    const amount = parseFloat(recForm.amount);
    const dayOfMonth = parseInt(recForm.dayOfMonth, 10);
    if (!amount || amount <= 0) { setRecError("Enter an amount greater than 0"); return; }
    if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 28) { setRecError("Day must be between 1 and 28"); return; }
    setRecError("");
    const isEdit = editingRecId !== null;
    const res = await fetch("/api/data", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recurring", ...(isEdit ? { id: editingRecId } : {}), amount, category: recForm.category, note: recForm.note, dayOfMonth, affectsBalance: true }),
    });
    if (res.ok) {
      setRecForm({ amount: "", category: "Bills", note: "", dayOfMonth: "1" });
      setEditingRecId(null);
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setRecError(d.error || "Couldn't save. Try again.");
    }
  }

  function startEditRecurring(r) {
    setEditingRecId(r.id);
    setRecForm({ amount: String(r.amount), category: r.category, note: r.note || "", dayOfMonth: String(r.day_of_month) });
    setRecError("");
  }

  function cancelEditRecurring() {
    setEditingRecId(null);
    setRecForm({ amount: "", category: "Bills", note: "", dayOfMonth: "1" });
    setRecError("");
  }

  async function removeRecurring(id) {
    if (!window.confirm("Delete this recurring expense? This can't be undone.")) return;
    const prev = recurring;
    setRecurring(recurring.filter((r) => r.id !== id));
    const res = await fetch(`/api/data?type=recurring&id=${id}`, { method: "DELETE" });
    if (!res.ok) setRecurring(prev);
  }

  const QUIET_DAYS = 90;
  function daysSince(dateStr) {
    return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  }
  function isQuietRecurring(r) {
    const lastConfirmed = recurringConfirmations[r.id] || (r.created_at || "").slice(0, 10);
    if (!lastConfirmed) return false;
    return daysSince(lastConfirmed) >= QUIET_DAYS;
  }

  async function confirmStillUsingRecurring(id) {
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "confirm-recurring", id }),
    });
    if (res.ok) {
      const d = await res.json();
      setRecurringConfirmations(d.confirmations || {});
    }
  }

  async function saveGoal(e) {
    e.preventDefault();
    const targetAmount = parseFloat(goalForm.targetAmount);
    if (!targetAmount || targetAmount <= 0) {
      setGoalError("Enter a target amount greater than 0");
      return;
    }
    setGoalError("");
    setGoalSaving(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "savings-goal", label: goalForm.label.trim(), targetAmount, targetDate: goalForm.targetDate || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't save");
      }
      const d = await res.json();
      setSavingsGoalState(d.goal);
    } catch (err) {
      setGoalError(err.message || "Couldn't save. Try again.");
    } finally {
      setGoalSaving(false);
    }
  }

  async function clearGoal() {
    if (!window.confirm("Remove this savings goal?")) return;
    setGoalForm({ label: "", targetAmount: "", targetDate: "" });
    setSavingsGoalState(null);
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "savings-goal", clear: true }),
    }).catch(() => {});
  }

  async function saveMilestoneReward(day, text) {
    const next = { ...milestoneRewards, [day]: text };
    if (!text.trim()) delete next[day];
    setMilestoneRewardsState(next);
    setRewardSaving(true);
    try {
      await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "milestone-rewards", rewards: next }),
      });
    } finally {
      setRewardSaving(false);
    }
  }

  async function addRecurringIncome(e) {
    e.preventDefault();
    const amount = parseFloat(incForm.amount);
    const dayOfMonth = parseInt(incForm.dayOfMonth, 10);
    if (!amount || amount <= 0) { setIncError("Enter an amount greater than 0"); return; }
    if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 28) { setIncError("Day must be between 1 and 28"); return; }
    setIncError("");
    const isEdit = editingIncId !== null;
    const res = await fetch("/api/data", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recurring-income", ...(isEdit ? { id: editingIncId } : {}), amount, note: incForm.note, dayOfMonth }),
    });
    if (res.ok) {
      setIncForm({ amount: "", note: "", dayOfMonth: "1" });
      setEditingIncId(null);
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setIncError(d.error || "Couldn't save. Try again.");
    }
  }

  function startEditRecurringIncome(r) {
    setEditingIncId(r.id);
    setIncForm({ amount: String(r.amount), note: r.note || "", dayOfMonth: String(r.day_of_month) });
    setIncError("");
  }

  function cancelEditRecurringIncome() {
    setEditingIncId(null);
    setIncForm({ amount: "", note: "", dayOfMonth: "1" });
    setIncError("");
  }

  async function removeRecurringIncome(id) {
    if (!window.confirm("Delete this recurring income? This can't be undone.")) return;
    const prev = recurringIncome;
    setRecurringIncome(recurringIncome.filter((r) => r.id !== id));
    const res = await fetch(`/api/data?type=recurring-income&id=${id}`, { method: "DELETE" });
    if (!res.ok) setRecurringIncome(prev);
  }

  async function savePin(e) {
    e.preventDefault();
    if (pinInput && !/^\d{4,8}$/.test(pinInput)) { setPinError("PIN must be 4-8 digits"); return; }
    setPinError("");
    setPinSaving(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set-pin", pin: pinInput }),
      });
      if (!res.ok) throw new Error();
      setHasPin(!!pinInput);
      setPinInput("");
      sessionStorage.setItem("unlocked", "1");
    } catch {
      setPinError("Couldn't save. Try again.");
    } finally {
      setPinSaving(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/data?type=export-all");
      if (!res.ok) throw new Error();
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expense-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Couldn't export your data. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!window.confirm("Import will ADD every record from this file to your current data — it does not replace anything. If you already have data, this can create duplicates. Best used to restore into a fresh, empty setup. Continue?")) return;
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "import-all", data }),
      });
      if (!res.ok) throw new Error("Import failed");
      const result = await res.json();
      setImportResult(result.results);
      await load();
    } catch (err) {
      setImportError("Couldn't import that file — make sure it's an export from this app.");
    } finally {
      setImporting(false);
    }
  }

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 32, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600 }}>Settings</div>
      </div>

      {/* Data backup */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Back up your data</div>
          <div style={{ fontSize: 11, color: "#8a8477" }}>Downloads everything — expenses, movies, balance, budget rules, challenge history — as one file.</div>
        </div>
        <button onClick={exportData} disabled={exporting} className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12, cursor: exporting ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <Download size={13} /> {exporting ? "Exporting…" : "Export"}
        </button>
      </div>

      {/* Data restore */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Restore from a backup</div>
            <div style={{ fontSize: 11, color: "#8a8477" }}>Adds every record from an exported .json file back into this database. Meant for restoring into a fresh setup, not merging with existing data.</div>
          </div>
          <label style={{ background: importing ? "#EAE5D9" : "#241F1A", color: importing ? "#241F1A" : "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12, cursor: importing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <Upload size={13} /> {importing ? "Importing…" : "Import"}
            <input type="file" accept="application/json" onChange={handleImportFile} disabled={importing} style={{ display: "none" }} />
          </label>
        </div>
        {importResult && (
          <div style={{ fontSize: 12, color: "#2F6F5E", marginTop: 10 }}>
            Restored: {importResult.expenses} expenses, {importResult.movies} movies, {importResult.topups} top-ups, {importResult.budgetRules} rules, {importResult.recurring} recurring, {importResult.challengeDays} challenge days.
          </div>
        )}
        {importError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 10 }}>{importError}</div>}
      </div>

      {/* Notifications */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={16} />
            <div>
              <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Notifications</div>
              <div style={{ fontSize: 11, color: "#8a8477" }}>
                {notifStatus === "unsupported" && "Not supported in this browser."}
                {notifStatus === "denied" && "Blocked — allow notifications for this site in your browser settings to turn this on."}
                {notifStatus === "off" && "Off. Turn on to get real device notifications, even with the app closed."}
                {notifStatus === "on" && "On for this device. Movie-day and recurring-expense reminders will arrive automatically."}
                {notifStatus === "checking" && "Checking…"}
              </div>
            </div>
          </div>
          {(notifStatus === "off" || notifStatus === "on") && (
            <button
              onClick={notifStatus === "on" ? disableNotifications : enableNotifications}
              disabled={notifBusy}
              style={{ background: notifStatus === "on" ? "#EAE5D9" : "#241F1A", color: notifStatus === "on" ? "#241F1A" : "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12, cursor: notifBusy ? "default" : "pointer", whiteSpace: "nowrap" }}
            >
              {notifBusy ? "Working…" : notifStatus === "on" ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
        {notifError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 10 }}>{notifError}</div>}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #EAE5D9" }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Water reminder every 1.5 hours</div>
          <div style={{ fontSize: 11, color: "#8a8477", lineHeight: 1.6, marginBottom: 10 }}>
            Vercel's free plan can only run scheduled checks once a day — not frequently enough for a water reminder. To get one every 90 minutes at no cost, use a free external scheduler (e.g. cron-job.org): create an account, add a new cron job set to run every 90 minutes, and point it at the URL below. Replace YOUR_WATER_NOTIFY_SECRET with the actual value of the WATER_NOTIFY_SECRET environment variable you set on Vercel.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ fontSize: 11, background: "#F1ECDF", padding: "8px 10px", borderRadius: 3, flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
              {typeof window !== "undefined" ? window.location.origin : ""}/api/notify-water?secret=YOUR_WATER_NOTIFY_SECRET
            </code>
            <button onClick={copyWaterUrl} style={{ background: "#EAE5D9", border: "none", borderRadius: 3, padding: "8px 10px", cursor: "pointer", display: "flex" }}>
              <Copy size={13} />
            </button>
          </div>
          {copied && <div style={{ fontSize: 11, color: "#2F6F5E", marginTop: 6 }}>Copied</div>}
          <div style={{ fontSize: 10, color: "#8a8477", marginTop: 8 }}>This same schedule also nudges you about the sugar challenge if it's past 8pm and today isn't marked yet.</div>
        </div>
      </div>

      {/* Dark mode */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {darkMode ? <Moon size={16} /> : <Sun size={16} />}
          <div>
            <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Dark mode</div>
            <div style={{ fontSize: 11, color: "#8a8477" }}>Applied as a color filter, not a full redesign — simple, reversible.</div>
          </div>
        </div>
        <button onClick={toggleDarkMode} style={{ background: darkMode ? "#241F1A" : "#EAE5D9", color: darkMode ? "#FBF8F2" : "#241F1A", border: "none", borderRadius: 20, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}>
          {darkMode ? "On" : "Off"}
        </button>
      </div>

      {/* PIN lock */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Lock size={16} />
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>App lock</div>
        </div>
        <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 10 }}>
          {hasPin ? "A PIN is set. Change it below, or clear the field and save to remove it." : "No PIN set — anyone who opens this can see everything. Set one below."}
        </div>
        <form onSubmit={savePin} style={{ display: "flex", gap: 8 }}>
          <input type="password" inputMode="numeric" placeholder={hasPin ? "New PIN (blank to remove)" : "4-8 digit PIN"} value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))} maxLength={8} style={{ width: 180 }} />
          <button type="submit" disabled={pinSaving} className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>{pinSaving ? "Saving…" : "Save"}</button>
        </form>
        {pinError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{pinError}</div>}

        {bioSupported && hasPin && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #EAE5D9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Fingerprint size={16} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Fingerprint / Face unlock</div>
                  <div style={{ fontSize: 11, color: "#8a8477" }}>
                    {bioEnabled ? "On for this device — checked locally, nothing is sent to a server." : "Skip typing your PIN on this device."}
                  </div>
                </div>
              </div>
              <button
                onClick={bioEnabled ? disableBiometric : enableBiometric}
                disabled={bioBusy}
                className="pill"
                style={{ background: bioEnabled ? "#EAE5D9" : "#241F1A", color: bioEnabled ? "#241F1A" : "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 12, cursor: bioBusy ? "default" : "pointer", whiteSpace: "nowrap" }}
              >
                {bioBusy ? "Working…" : bioEnabled ? "Turn off" : "Set up"}
              </button>
            </div>
            {bioError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{bioError}</div>}
          </div>
        )}
        {!bioSupported && hasPin && (
          <div style={{ fontSize: 11, color: "#8a8477", marginTop: 12, paddingTop: 12, borderTop: "1px solid #EAE5D9" }}>
            Fingerprint/Face unlock isn't available on this device or browser.
          </div>
        )}
      </div>

      {/* Custom categories */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Custom categories</div>
        {categories.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {categories.map((c) => (
              <span key={c.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 20, background: c.color + "1A", color: c.color, fontWeight: 500 }}>
                {c.name}
                <button onClick={() => removeCategory(c.name)} style={{ background: "none", border: "none", cursor: "pointer", color: c.color, display: "flex", padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addCategory} style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. Gym, Gifts" value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={30} style={{ width: 200 }} />
          <button type="submit" className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Plus size={13} /> Add</button>
        </form>
      </div>

      {/* Theatres */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Theatres</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 10 }}>Shows up in the "Watched via: Theatre" dropdown on the Movies page.</div>
        {theatres.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {theatres.map((t) => (
              <span key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 20, background: "#F1ECDF", color: "#5f5a4f", fontWeight: 500 }}>
                {t}
                <button onClick={() => removeTheatre(t)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", display: "flex", padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addTheatre} style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. Prasads IMAX" value={newTheatre} onChange={(e) => setNewTheatre(e.target.value)} maxLength={60} style={{ width: 200 }} />
          <button type="submit" className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Plus size={13} /> Add</button>
        </form>
      </div>

      {/* OTT Platforms */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>OTT platforms</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 10 }}>Shows up in the "Watched via: OTT" dropdown on the Movies page.</div>
        {ottPlatforms.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {ottPlatforms.map((o) => (
              <span key={o} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 20, background: "#F1ECDF", color: "#5f5a4f", fontWeight: 500 }}>
                {o}
                <button onClick={() => removeOtt(o)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8a8477", display: "flex", padding: 0 }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addOtt} style={{ display: "flex", gap: 8 }}>
          <input type="text" placeholder="e.g. Aha, Lionsgate Play" value={newOtt} onChange={(e) => setNewOtt(e.target.value)} maxLength={60} style={{ width: 200 }} />
          <button type="submit" className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Plus size={13} /> Add</button>
        </form>
      </div>

      {/* Recurring expenses */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Recurring expenses</div>
          {recurring.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div className="tabnum" style={{ fontSize: 16, fontWeight: 600 }}>
                ₹{recurring.reduce((s, r) => s + parseFloat(r.amount), 0).toLocaleString("en-IN")}/mo
              </div>
              <div style={{ fontSize: 10, color: "#8a8477" }}>total committed</div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 12 }}>Logged automatically each month on the day you set — e.g. rent or an EMI. Shows on your Expense Ledger as "scheduled" before the actual day arrives.</div>

        {recurring.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {recurring.map((r) => (
              <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid #EAE5D9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span>{r.note || r.category} · day {r.day_of_month} · ₹{Math.round(parseFloat(r.amount)).toLocaleString("en-IN")}</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => startEditRecurring(r)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Pencil size={13} /></button>
                    <button onClick={() => removeRecurring(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Trash2 size={14} /></button>
                  </span>
                </div>
                {isQuietRecurring(r) && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F7EEDD", borderRadius: 4, padding: "6px 10px", marginTop: 6, fontSize: 11, color: "#A3763F" }}>
                    <span>It's been {daysSince(recurringConfirmations[r.id] || (r.created_at || "").slice(0, 10))} days — still using this?</span>
                    <span style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => confirmStillUsingRecurring(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#2F6F5E", fontSize: 11, fontWeight: 600 }}>Yes, keep it</button>
                      <button onClick={() => removeRecurring(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A34A38", fontSize: 11, fontWeight: 600 }}>No, remove it</button>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {editingRecId && <div style={{ fontSize: 11, color: "#A3763F", marginBottom: 8 }}>Editing — change values below and Save, or Cancel.</div>}
        <form onSubmit={addRecurring} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="number" placeholder="Amount (₹)" value={recForm.amount} onChange={(e) => setRecForm({ ...recForm, amount: e.target.value })} style={{ width: 110 }} />
          <input type="text" placeholder="Category" value={recForm.category} onChange={(e) => setRecForm({ ...recForm, category: e.target.value })} style={{ width: 110 }} />
          <input type="text" placeholder="Note (e.g. Rent)" value={recForm.note} onChange={(e) => setRecForm({ ...recForm, note: e.target.value })} style={{ width: 130 }} />
          <input type="number" placeholder="Day (1-28)" value={recForm.dayOfMonth} onChange={(e) => setRecForm({ ...recForm, dayOfMonth: e.target.value })} min="1" max="28" style={{ width: 100 }} />
          <button type="submit" className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Check size={13} /> {editingRecId ? "Save changes" : "Save"}</button>
          {editingRecId && (
            <button type="button" onClick={cancelEditRecurring} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><X size={13} /> Cancel</button>
          )}
        </form>
        {recError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{recError}</div>}
      </div>

      {/* Recurring income */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Recurring income</div>
          {recurringIncome.length > 0 && (
            <div style={{ textAlign: "right" }}>
              <div className="tabnum" style={{ fontSize: 16, fontWeight: 600, color: "#2F6F5E" }}>
                ₹{recurringIncome.reduce((s, r) => s + parseFloat(r.amount), 0).toLocaleString("en-IN")}/mo
              </div>
              <div style={{ fontSize: 10, color: "#8a8477" }}>total expected</div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 12 }}>Added automatically to your balance each month on the day you set — e.g. salary or a regular payout.</div>

        {recurringIncome.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {recurringIncome.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "8px 0", borderBottom: "1px solid #EAE5D9" }}>
                <span>{r.note || "Income"} · day {r.day_of_month} · ₹{Math.round(parseFloat(r.amount)).toLocaleString("en-IN")}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEditRecurringIncome(r)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Pencil size={13} /></button>
                  <button onClick={() => removeRecurringIncome(r.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", display: "flex" }}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        )}

        {editingIncId && <div style={{ fontSize: 11, color: "#A3763F", marginBottom: 8 }}>Editing — change values below and Save, or Cancel.</div>}
        <form onSubmit={addRecurringIncome} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="number" placeholder="Amount (₹)" value={incForm.amount} onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })} style={{ width: 110 }} />
          <input type="text" placeholder="Note (e.g. Salary)" value={incForm.note} onChange={(e) => setIncForm({ ...incForm, note: e.target.value })} style={{ width: 150 }} />
          <input type="number" placeholder="Day (1-28)" value={incForm.dayOfMonth} onChange={(e) => setIncForm({ ...incForm, dayOfMonth: e.target.value })} min="1" max="28" style={{ width: 100 }} />
          <button type="submit" className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><Check size={13} /> {editingIncId ? "Save changes" : "Save"}</button>
          {editingIncId && (
            <button type="button" onClick={cancelEditRecurringIncome} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}><X size={13} /> Cancel</button>
          )}
        </form>
        {incError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{incError}</div>}
      </div>

      {/* Savings goal — a long-term target with a date, separate from the
          monthly savings rule under Money Rules. */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginTop: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Savings goal</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 12 }}>A bigger target with a date — e.g. "₹50,000 by December." Tracked against your current balance on the home screen.</div>
        <form onSubmit={saveGoal} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" placeholder="What for? (optional)" value={goalForm.label} onChange={(e) => setGoalForm({ ...goalForm, label: e.target.value })} maxLength={60} style={{ width: 160 }} />
          <input type="number" placeholder="Target (₹)" value={goalForm.targetAmount} onChange={(e) => setGoalForm({ ...goalForm, targetAmount: e.target.value })} style={{ width: 130 }} />
          <input type="date" value={goalForm.targetDate} onChange={(e) => setGoalForm({ ...goalForm, targetDate: e.target.value })} style={{ width: 150 }} />
          <button type="submit" disabled={goalSaving} className="pill" style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <Check size={13} /> {goalSaving ? "Saving…" : "Save"}
          </button>
          {savingsGoal && (
            <button type="button" onClick={clearGoal} style={{ background: "none", border: "none", color: "#A34A38", cursor: "pointer", fontSize: 12 }}>Remove goal</button>
          )}
        </form>
        {goalError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 8 }}>{goalError}</div>}
      </div>

      {/* Custom milestone rewards — what you promise yourself for hitting a
          sugar-free streak, shown on the No-Sugar Challenge page. */}
      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginTop: 16 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Milestone rewards</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 12 }}>What you'll get yourself for hitting each sugar-free streak milestone. Leave blank to skip one.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {MILESTONE_DAYS.map((day) => (
            <div key={day} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="tabnum" style={{ fontSize: 12, color: "#8a8477", width: 56, flexShrink: 0 }}>{day} days</span>
              <input
                type="text"
                placeholder="e.g. New shoes, a movie night…"
                defaultValue={milestoneRewards[day] || ""}
                onBlur={(e) => { if (e.target.value !== (milestoneRewards[day] || "")) saveMilestoneReward(day, e.target.value); }}
                maxLength={80}
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </div>
        {rewardSaving && <div style={{ fontSize: 11, color: "#8a8477", marginTop: 8 }}>Saving…</div>}
      </div>

      {/* About */}
      <div style={{ textAlign: "center", marginTop: 32, paddingTop: 24, borderTop: "1px solid #EAE5D9" }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12, margin: "0 auto 10px",
            background: "linear-gradient(135deg, #A34A38 0%, #8C4470 50%, #2F6F5E 100%)",
          }}
        />
        <div className="lora" style={{ fontSize: 15, fontWeight: 600 }}>Expense Ledger</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginTop: 2 }}>Version 2.0 · Money, Movies & Diet, together</div>
        <div style={{ fontSize: 10, color: "#C4BDAC", marginTop: 8 }}>Built for one person. No ads, no accounts, your own database.</div>
      </div>
    </div>
  );
}
