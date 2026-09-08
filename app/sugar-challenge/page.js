"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Check, X, Flame, Trophy } from "lucide-react";

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

export default function SugarChallengePage() {
  const [meta, setMeta] = useState(null);
  const [days, setDays] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [startDate, setStartDate] = useState(todayISO());
  const [lengthDays, setLengthDays] = useState(41);
  const [setupError, setSetupError] = useState("");
  const [setupSubmitting, setSetupSubmitting] = useState(false);

  const [selectedDay, setSelectedDay] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/sugar-challenge");
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setMeta(data.meta);
      const map = {};
      for (const d of data.days) {
        map[d.day_date.slice(0, 10)] = { completed: d.completed, note: d.note || "" };
      }
      setDays(map);
      setLoadError("");
    } catch (err) {
      setLoadError("Couldn't load your challenge. Check the database connection and refresh.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function startChallenge(e) {
    e.preventDefault();
    setSetupError("");
    setSetupSubmitting(true);
    try {
      const res = await fetch("/api/sugar-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, lengthDays: parseInt(lengthDays, 10) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to start");
      }
      await load();
    } catch (err) {
      setSetupError(err.message || "Couldn't start the challenge. Try again.");
    } finally {
      setSetupSubmitting(false);
    }
  }

  async function markDay(date, completed) {
    setDays((prev) => ({ ...prev, [date]: { completed, note: prev[date]?.note || "" } }));
    try {
      const res = await fetch("/api/sugar-challenge/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, completed, note: days[date]?.note || "" }),
      });
      if (!res.ok) throw new Error();
    } catch (err) {
      setLoadError("Couldn't save that day. Try again.");
    }
  }

  async function saveNote(date) {
    const completed = days[date]?.completed;
    if (completed === undefined) return;
    setDays((prev) => ({ ...prev, [date]: { completed, note: noteDraft } }));
    try {
      const res = await fetch("/api/sugar-challenge/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, completed, note: noteDraft }),
      });
      if (!res.ok) throw new Error();
    } catch (err) {
      setLoadError("Couldn't save that note. Try again.");
    }
    setSelectedDay(null);
  }

  const today = todayISO();

  const dayList = useMemo(() => {
    if (!meta) return [];
    const start = meta.start_date.slice(0, 10);
    const list = [];
    for (let i = 0; i < meta.length_days; i++) {
      const date = addDays(start, i);
      list.push({
        dayNumber: i + 1,
        date,
        isPast: date < today,
        isToday: date === today,
        isFuture: date > today,
        completed: days[date]?.completed,
        note: days[date]?.note || "",
      });
    }
    return list;
  }, [meta, days, today]);

  const completedCount = dayList.filter((d) => d.completed === true).length;
  const failedCount = dayList.filter((d) => d.completed === false).length;
  const elapsedCount = dayList.filter((d) => !d.isFuture).length;

  const currentStreak = useMemo(() => {
    let streak = 0;
    for (let i = dayList.length - 1; i >= 0; i--) {
      const d = dayList[i];
      if (d.isFuture) continue;
      if (d.completed === true) streak++;
      else break;
    }
    return streak;
  }, [dayList]);

  const longestStreak = useMemo(() => {
    let longest = 0, cur = 0;
    for (const d of dayList) {
      if (d.completed === true) { cur++; longest = Math.max(longest, cur); }
      else cur = 0;
    }
    return longest;
  }, [dayList]);

  const todayEntry = dayList.find((d) => d.isToday);

  if (!loaded) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>
        Loading your challenge…
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px" }}>
      {loadError && (
        <div style={{ background: "#FAECE7", border: "1px solid #D85A30", color: "#712B13", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      <div style={{ marginBottom: 32, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
          No-Sugar Challenge
        </div>
        <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>
          One box a day. No sugar, no jaggery, no honey, no sweetened drinks.
        </div>
      </div>

      {!meta ? (
        <form onSubmit={startChallenge} style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: 20 }}>
          <div className="lora" style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Start your challenge</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: 160 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>Length (days)</label>
              <input type="number" value={lengthDays} onChange={(e) => setLengthDays(e.target.value)} min="1" max="365" style={{ width: 100 }} />
            </div>
            <button type="submit" disabled={setupSubmitting} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: setupSubmitting ? "default" : "pointer" }}>
              {setupSubmitting ? "Starting…" : "Start"}
            </button>
          </div>
          {setupError && <div style={{ fontSize: 12, color: "#A34A38", marginTop: 10 }}>{setupError}</div>}
        </form>
      ) : (
        <>
          {/* Stats */}
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Day</div>
              <div className="lora tabnum" style={{ fontSize: "clamp(26px, 8vw, 36px)", fontWeight: 600, lineHeight: 1 }}>
                {Math.min(elapsedCount, meta.length_days)}<span style={{ fontSize: 18, color: "#8a8477" }}> / {meta.length_days}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Flame size={13} color="#C98A2C" /> Current streak</div>
              <div className="lora tabnum" style={{ fontSize: "clamp(26px, 8vw, 36px)", fontWeight: 600, lineHeight: 1, color: "#C98A2C" }}>{currentStreak}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Trophy size={13} color="#2F6F5E" /> Longest streak</div>
              <div className="lora tabnum" style={{ fontSize: "clamp(26px, 8vw, 36px)", fontWeight: 600, lineHeight: 1, color: "#2F6F5E" }}>{longestStreak}</div>
            </div>
            {failedCount > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Slipped</div>
                <div className="lora tabnum" style={{ fontSize: "clamp(26px, 8vw, 36px)", fontWeight: 600, lineHeight: 1, color: "#A34A38" }}>{failedCount}</div>
              </div>
            )}
          </div>

          {/* Today's quick action */}
          {todayEntry && (
            <div style={{ background: "#F1ECDF", borderRadius: 6, padding: "16px 18px", marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Day {todayEntry.dayNumber} — today</div>
                <div style={{ fontSize: 12, color: "#8a8477" }}>
                  {todayEntry.completed === true ? "Marked sugar-free ✓" : todayEntry.completed === false ? "Marked as slipped" : "Not marked yet"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => markDay(today, true)} style={{ background: todayEntry.completed === true ? "#2F6F5E" : "#EAE5D9", color: todayEntry.completed === true ? "#FBF8F2" : "#241F1A", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <Check size={14} /> Sugar-free
                </button>
                <button onClick={() => markDay(today, false)} style={{ background: todayEntry.completed === false ? "#A34A38" : "#EAE5D9", color: todayEntry.completed === false ? "#FBF8F2" : "#241F1A", border: "none", borderRadius: 3, padding: "9px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <X size={14} /> I slipped
                </button>
              </div>
            </div>
          )}

          {/* Grid */}
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>All {meta.length_days} days</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 6 }}>
            {dayList.map((d) => {
              let bg = "#EAE5D9", color = "#8a8477", border = "1px solid transparent";
              if (d.completed === true) { bg = "#2F6F5E"; color = "#FBF8F2"; }
              else if (d.completed === false) { bg = "#A34A38"; color = "#FBF8F2"; }
              else if (d.isToday) { border = "1px solid #241F1A"; }
              else if (d.isFuture) { bg = "#F5F2E9"; color = "#C4BDAC"; }
              return (
                <button
                  key={d.date}
                  disabled={d.isFuture}
                  onClick={() => { setSelectedDay(d.date); setNoteDraft(d.note); }}
                  title={d.note || undefined}
                  style={{ aspectRatio: "1", background: bg, color, border, borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: d.isFuture ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  className="tabnum"
                >
                  {d.dayNumber}
                </button>
              );
            })}
          </div>

          {selectedDay && (
            <div style={{ marginTop: 20, border: "1px solid #EAE5D9", borderRadius: 6, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button onClick={() => markDay(selectedDay, true)} style={{ background: days[selectedDay]?.completed === true ? "#2F6F5E" : "#EAE5D9", color: days[selectedDay]?.completed === true ? "#FBF8F2" : "#241F1A", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>Sugar-free</button>
                <button onClick={() => markDay(selectedDay, false)} style={{ background: days[selectedDay]?.completed === false ? "#A34A38" : "#EAE5D9", color: days[selectedDay]?.completed === false ? "#FBF8F2" : "#241F1A", border: "none", borderRadius: 3, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>Slipped</button>
              </div>
              <input type="text" placeholder="Note (optional — what happened, cravings, etc.)" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} maxLength={140} style={{ marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => saveNote(selectedDay)} style={{ background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Save note</button>
                <button onClick={() => setSelectedDay(null)} style={{ background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>Close</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
