import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Clapperboard, ArrowLeft, Minus } from "lucide-react";

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

const emptyForm = {
  title: "", date: todayISO(), time: "", ticketPrice: "", canteenPrice: "", companions: "",
  myTake: "liked", publicTake: "liked", note: "", affectsBalance: true, quantity: 1,
};

function QuantityStepper({ value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>Times watched</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #D9D2C2", borderRadius: 3, padding: "6px 10px", width: "fit-content" }}>
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          aria-label="Decrease"
          style={{ background: "#EAE5D9", border: "none", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#241F1A" }}
        >
          <Minus size={14} />
        </button>
        <span className="tabnum" style={{ fontSize: 16, fontWeight: 600, minWidth: 20, textAlign: "center" }}>{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(20, value + 1))}
          aria-label="Increase"
          style={{ background: "#241F1A", border: "none", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#FBF8F2" }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

export default function MoviesPage() {
  const [movies, setMovies] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());

  async function load() {
    try {
      const res = await fetch("/api/data?type=movies");
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setMovies(
        data.movies.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.watched_date.slice(0, 10),
          time: m.watched_time ? m.watched_time.slice(0, 5) : "",
          ticketPrice: parseFloat(m.ticket_price),
          canteenPrice: parseFloat(m.canteen_price),
          companions: m.companions || "",
          myTake: m.my_take,
          publicTake: m.public_take,
          note: m.note || "",
          affectsBalance: m.affects_balance !== false,
          quantity: m.quantity || 1,
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

  function startEdit(m) {
    setEditingId(m.id);
    setForm({
      title: m.title,
      date: m.date,
      time: m.time || "",
      ticketPrice: String(m.ticketPrice),
      canteenPrice: String(m.canteenPrice),
      companions: m.companions,
      myTake: m.myTake,
      publicTake: m.publicTake,
      note: m.note,
      affectsBalance: m.affectsBalance !== false,
      quantity: m.quantity || 1,
    });
    setFormError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
  }

  async function submitMovie(e) {
    e.preventDefault();
    const tp = parseFloat(form.ticketPrice) || 0;
    const cp = parseFloat(form.canteenPrice) || 0;
    if (!form.title.trim()) {
      setFormError("Enter the movie's name");
      return;
    }
    if (!form.date) {
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
      const isEdit = editingId !== null;
      const res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "movies",
          ...(isEdit ? { id: editingId } : {}),
          title: form.title.trim(),
          date: form.date,
          time: form.time,
          ticketPrice: tp,
          canteenPrice: cp,
          companions: form.companions.trim(),
          myTake: form.myTake,
          publicTake: form.publicTake,
          note: form.note.trim(),
          affectsBalance: form.affectsBalance,
          quantity: form.quantity,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      cancelEdit();
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
      const res = await fetch(`/api/data?type=movies&id=${id}`, { method: "DELETE" });
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

  const totalSpend = monthMovies.reduce((s, x) => s + (x.ticketPrice + x.canteenPrice) * x.quantity, 0);
  const ticketSpend = monthMovies.reduce((s, x) => s + x.ticketPrice * x.quantity, 0);
  const canteenSpend = monthMovies.reduce((s, x) => s + x.canteenPrice * x.quantity, 0);
  const viewingsCount = monthMovies.reduce((s, x) => s + x.quantity, 0);

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
    <div className="page-container" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
      {loadError && (
        <div style={{ background: "#FAECE7", border: "1px solid #D85A30", color: "#712B13", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

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
          <button onClick={() => setViewDate(new Date(year, month - 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <div className="tabnum" style={{ fontSize: 14, fontWeight: 500, minWidth: 130, textAlign: "center" }}>
            {MONTH_NAMES[month]} {year}
          </div>
          <button onClick={() => setViewDate(new Date(year, month + 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 40, marginBottom: 40, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Spent in {MONTH_NAMES[month]}</div>
          <div className="lora tabnum" style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: 600, lineHeight: 1 }}>
            {fmt(totalSpend)}
          </div>
          <div style={{ fontSize: 12, color: "#8a8477", marginTop: 6 }}>
            {fmt(ticketSpend)} tickets · {fmt(canteenSpend)} canteen
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#8a8477", marginBottom: 4 }}>Movies watched</div>
          <div className="lora tabnum" style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: 600, lineHeight: 1 }}>
            {viewingsCount}
          </div>
          {viewingsCount !== monthMovies.length && (
            <div style={{ fontSize: 11, color: "#8a8477", marginTop: 6 }}>{monthMovies.length} titles, some rewatched</div>
          )}
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

      <div className="responsive-grid">
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            {editingId ? "Edit movie" : "Log a movie"}
          </div>
          <form onSubmit={submitMovie} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="text" placeholder="Movie title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={100} />
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} max={todayISO()} style={{ flex: 1 }} />
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="number" inputMode="decimal" placeholder="Ticket (₹)" value={form.ticketPrice} onChange={(e) => setForm({ ...form, ticketPrice: e.target.value })} step="0.01" min="0" />
              <input type="number" inputMode="decimal" placeholder="Canteen (₹)" value={form.canteenPrice} onChange={(e) => setForm({ ...form, canteenPrice: e.target.value })} step="0.01" min="0" />
            </div>
            <div style={{ fontSize: 11, color: "#8a8477", marginTop: -4 }}>Per-viewing price — total below accounts for rewatches</div>
            <QuantityStepper value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
            {form.quantity > 1 && (
              <div style={{ fontSize: 12, color: "#5f5a4f" }}>
                Total for this entry: {fmt((parseFloat(form.ticketPrice) || 0) * form.quantity + (parseFloat(form.canteenPrice) || 0) * form.quantity)}
              </div>
            )}
            <input type="text" placeholder="Who you went with (optional)" value={form.companions} onChange={(e) => setForm({ ...form, companions: e.target.value })} maxLength={120} />
            <div>
              <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>Your take</label>
              <select value={form.myTake} onChange={(e) => setForm({ ...form, myTake: e.target.value })}>
                {TAKES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#8a8477", display: "block", marginBottom: 4 }}>How the public/critics received it</label>
              <select value={form.publicTake} onChange={(e) => setForm({ ...form, publicTake: e.target.value })}>
                {TAKES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <input type="text" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={140} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5f5a4f", cursor: "pointer" }}>
              <input type="checkbox" checked={form.affectsBalance} onChange={(e) => setForm({ ...form, affectsBalance: e.target.checked })} style={{ width: "auto" }} />
              Deduct from balance
            </label>
            {formError && <div style={{ fontSize: 12, color: "#A34A38" }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={submitting}
                style={{ flex: 1, marginTop: 4, background: "#241F1A", color: "#FBF8F2", border: "none", borderRadius: 3, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={16} /> {submitting ? "Saving…" : editingId ? "Save changes" : "Add movie"}
              </button>
              {editingId && (
                <button type="button" onClick={cancelEdit} style={{ marginTop: 4, background: "#EAE5D9", color: "#241F1A", border: "none", borderRadius: 3, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

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
                const total = (m.ticketPrice + m.canteenPrice) * m.quantity;
                const mismatch = diverges(m);
                return (
                  <div key={m.id} style={{ border: "1px solid #EAE5D9", borderRadius: 4, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="lora" style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                          {m.title}
                          {m.quantity > 1 && (
                            <span style={{ fontSize: 11, fontWeight: 500, color: "#7A3E56", background: "#7A3E561A", padding: "2px 7px", borderRadius: 20 }}>
                              ×{m.quantity}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#8a8477", marginTop: 2 }}>
                          {new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          {m.time && <> · {m.time}</>}
                          {m.companions && <> · with {m.companions}</>}
                          {m.affectsBalance === false && <> · not deducted from balance</>}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span className="tabnum" style={{ fontSize: 15, fontWeight: 500 }}>{fmt(total)}</span>
                        <button onClick={() => startEdit(m)} aria-label="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 4, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#5f5a4f")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => removeMovie(m.id)} aria-label="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: "#C4BDAC", padding: 4, display: "flex" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#A34A38")} onMouseLeave={(e) => (e.currentTarget.style.color = "#C4BDAC")}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "#8a8477", marginTop: 4 }}>
                      {fmt(m.ticketPrice)} ticket · {fmt(m.canteenPrice)} canteen{m.quantity > 1 && <> · ×{m.quantity} viewings</>}
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
