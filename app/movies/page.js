"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, ChevronLeft, ChevronRight, Clapperboard, ArrowLeft } from "lucide-react";

const TAKES = [
  { value: "loved", label: "Loved it", score: 3, color: "#2F6F5E" },
  { value: "liked", label: "Liked it", score: 2, color: "#3F6E5B" },
  { value: "okay", label: "It was okay", score: 1, color: "#A3763F" },
  { value: "disliked", label: "Didn't like it", score: 0, color: "#A34A38" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

function takeInfo(value) {
  return TAKES.find((t) => t.value === value) || TAKES[TAKES.length - 1];
}

export default function MoviesPage() {
  const [movies, setMovies] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [ticketPrice, setTicketPrice] = useState("");
  const [canteenPrice, setCanteenPrice] = useState("");
  const [companions, setCompanions] = useState("");
  const [myTake, setMyTake] = useState("liked");
  const [publicTake, setPublicTake] = useState("liked");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());

  async function load() {
    try {
      const res = await fetch("/api/movies");
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setMovies(
        data.movies.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.watched_date.slice(0, 10),
          ticketPrice: parseFloat(m.ticket_price),
          canteenPrice: parseFloat(m.canteen_price),
          companions: m.companions || "",
          myTake: m.my_take,
          publicTake: m.public_take,
          note: m.note || "",
        }))
      );
      setLoadError("");
    } catch (err) {
      setLoadError("Couldn't load your movies. Check the database connection and refresh.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addMovie(e) {
    e.preventDefault();
    const tp = parseFloat(ticketPrice) || 0;
    const cp = parseFloat(canteenPrice) || 0;
    if (!title.trim()) {
      setFormError("Enter the movie's name");
      return;
    }
    if (!date) {
      setFormError("Pick a date");
      return;
    }
    if (tp < 0 || cp < 0) {
      setFormError("Prices can't be negative");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          date,
          ticketPrice: tp,
          canteenPrice: cp,
          companions: companions.trim(),
          myTake,
          publicTake,
          note: note.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      setTitle("");
      setTicketPrice("");
      setCanteenPrice("");
      setCompanions("");
      setNote("");
      setMyTake("liked");
      setPublicTake("liked");
      await load();
    } catch (err) {
      setFormError(err.message || "Couldn't save that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMovie(id) {
    const prev = movies;
    setMovies(movies.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/movies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch (err) {
      setMovies(prev);
      setLoadError("Couldn't delete that entry. Try again.");
    }
  }

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const monthMovies = useMemo(() => {
    return movies.filter((x) => {
      const d = new Date(x.date + "T00:00:00");
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [movies, year, month]);

  const totalSpend = monthMovies.reduce((s, x) => s + x.ticketPrice + x.canteenPrice, 0);
  const ticketSpend = monthMovies.reduce((s, x) => s + x.ticketPrice, 0);
  const canteenSpend = monthMovies.reduce((s, x) => s + x.canteenPrice, 0);

  const matchedCount = monthMovies.filter((x) => takeInfo(x.myTake).score === takeInfo(x.publicTake).score).length;
  const divergedCount = monthMovies.filter((x) => Math.abs(takeInfo(x.myTake).score - takeInfo(x.publicTake).score) >= 2).length;

  const sorted = useMemo(() => {
    return [...monthMovies].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [monthMovies]);

  function diverges(m) {
    return Math.abs(takeInfo(m.myTake).score - takeInfo(m.publicTake).score) >= 2;
  }

  if (!loaded) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>
        Loading your movie log…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
      {loadError && (
        <div style={{ background: "#FAECE7", border: "1px solid #D85A30", color: "#712B13", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 32, borderBottom: "1px solid #D9D2C2", paddingBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
            <ArrowLeft size={12} /> Expense ledger
          </a>
          <div className="lora" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Movie Nights
          </div>
          <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>
            Tickets, snacks, who you went with, and whether the crowd agreed with you.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }}
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="tabnum" style={{ fontSize: 14, fontWeight: 500, minWidth: 130, textAlign: "center" }}>
            {MONTH_NAMES[month]} {year}
          </div>
          <button
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }}
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Hero stats */}
      <div style={{ display: "flex", gap: 40, marginBottom: 40, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Spent in {MONTH_NAMES[month]}</div>
          <div className="lora tabnum" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1 }}>
            {fmt(totalSpend)}
          </div>
          <div style={{ fontSize: 12, color: "#8a8477", marginTop: 6 }}>
            {fmt(ticketSpend)} tickets · {fmt(canteenSpend)} canteen
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Movies watched</div>
          <div className="lora tabnum" style={{ fontSize: 44, fontWeight: 600, lineHeight: 1 }}>
            {monthMovies.length}
          </div>
        </div>
        {monthMovies.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>You vs the crowd</div>
            <div style={{ fontSize: 14, marginTop: 10 }}>
              <span style={{ color: "#2F6F5E", fontWeight: 500 }}>{matchedCount} matched</span>
              <span style={{ color: "#8a8477" }}> · </span>
              <span style={{ color: "#A34A38", fontWeight: 500 }}>{divergedCount} you disagreed</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 40 }}>
        {/* Left: add form */}
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Log a movie
          </div>
          <form onSubmit={addMovie} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="text"
              placeholder="Movie title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                inputMode="decimal"
                placeholder="Ticket (₹)"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
                step="0.01"
                min="0"
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="Canteen (₹)"
                value={canteenPrice}
                onChange={(e) => setCanteenPrice(e.target.value)}
                step="0.01"
                min="0"
              />
            </div>
            <input
              type="text"
              placeholder="Who you went with (optional)"
              value={companions}
              onChange={(e) => setCompanions(e.target.value)}
              maxLength={120}
            />
            <div>
              <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>Your take</label>
              <select value={myTake} onChange={(e) => setMyTake(e.target.value)}>
                {TAKES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>How the public/critics received it</label>
              <select value={publicTake} onChange={(e) => setPublicTake(e.target.value)}>
                {TAKES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={140}
            />
            {formError && <div style={{ fontSize: 12, color: "#A34A38" }}>{formError}</div>}
            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 4,
                background: "#241F1A",
                color: "#FBF8F2",
                border: "none",
                borderRadius: 3,
                padding: "10px 14px",
                fontSize: 14,
                fontWeight: 500,
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Plus size={16} /> {submitting ? "Saving…" : "Add movie"}
            </button>
          </form>
        </div>

        {/* Right: movie list */}
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Watched this month
          </div>
          {sorted.length === 0 ? (
            <div style={{ border: "1px dashed #D9D2C2", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "#8a8477", fontSize: 14 }}>
              <Clapperboard size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>No movies logged for {MONTH_NAMES[month]} yet.</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>Add your first one on the left.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {sorted.map((m) => {
                const mine = takeInfo(m.myTake);
                const pub = takeInfo(m.publicTake);
                const total = m.ticketPrice + m.canteenPrice;
                const mismatch = diverges(m);
                return (
                  <div key={m.id} style={{ border: "1px solid #EAE5D9", borderRadius: 4, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: "#8a8477", marginTop: 2 }}>
                          {new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          {m.companions && <> · with {m.companions}</>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <span className="tabnum" style={{ fontSize: 15, fontWeight: 500 }}>{fmt(total)}</span>
                        <button
                          onClick={() => removeMovie(m.id)}
                          aria-label="Delete"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 4, display: "flex" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#A34A38")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "#8a8477", marginTop: 4 }}>
                      {fmt(m.ticketPrice)} ticket · {fmt(m.canteenPrice)} canteen
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: mine.color + "1A", color: mine.color, fontWeight: 500 }}>
                        You: {mine.label}
                      </span>
                      <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: pub.color + "1A", color: pub.color, fontWeight: 500 }}>
                        Public: {pub.label}
                      </span>
                      {mismatch && (
                        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: "#5B3A5C1A", color: "#5B3A5C", fontWeight: 500 }}>
                          You disagreed with the crowd
                        </span>
                      )}
                    </div>
                    {m.note && (
                      <div style={{ fontSize: 12, color: "#5f5a4f", marginTop: 8, fontStyle: "italic" }}>{m.note}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
