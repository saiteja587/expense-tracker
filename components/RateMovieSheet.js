// "How was it?" — rate a movie after watching it. Opened from the Movies
// page, the Home card, or a notification (/movies?rate=<id>). Only fills in
// what you know afterwards: your take, the crowd's, stars, snacks, who came.
import { useState } from "react";
import { showToast } from "../lib/toast";
import { vibrate } from "../lib/haptics";

export const TAKE_CHOICES = [
  { value: "loved", emoji: "😍", label: "Loved it" },
  { value: "liked", emoji: "🙂", label: "Liked it" },
  { value: "okay", emoji: "😐", label: "Okay" },
  { value: "disliked", emoji: "👎", label: "Didn't like" },
];

function TakeRow({ label, value, onChange, allowUnsure }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="field-label">{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {TAKE_CHOICES.map((t) => {
          const on = value === t.value;
          return (
            <button key={t.value} type="button" aria-pressed={on} onClick={() => { vibrate(4); onChange(on && allowUnsure ? "" : t.value); }}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "8px 2px", borderRadius: 14, cursor: "pointer",
                border: `1.5px solid ${on ? "var(--ink)" : "var(--line-strong)"}`, background: on ? "var(--surface-2)" : "transparent", color: "var(--ink)",
              }}>
              <span style={{ fontSize: 24 }} aria-hidden="true">{t.emoji}</span>
              <span style={{ fontSize: 11.5, fontWeight: on ? 700 : 500 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
      {allowUnsure && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Not sure? Leave it — tap again to clear.</div>}
    </div>
  );
}

export default function RateMovieSheet({ movie, onClose, onSaved }) {
  const [myTake, setMyTake] = useState(movie.myTake || "");
  const [publicTake, setPublicTake] = useState(movie.publicTake || "");
  const [rating, setRating] = useState(movie.rating || 0);
  const [review, setReview] = useState(movie.review || "");
  const [canteen, setCanteen] = useState(movie.canteenPrice ? String(movie.canteenPrice) : "");
  const [companions, setCompanions] = useState(movie.companions || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const theatre = movie.venueType !== "OTT";

  async function save() {
    if (!myTake) { setError("Pick how you found it"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/data", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "movie-rate", id: movie.id, myTake, publicTake, rating: rating || null, review, canteenPrice: theatre ? canteen : null, companions }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't save");
      vibrate([10, 40, 10]);
      showToast(`${movie.title} rated`, myTake === "loved" ? "😍" : "🎬");
      onSaved?.(d.movie);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Rate ${movie.title}`} data-no-tab-swipe="1">
        <div className="sheet-handle" />
        <div className="lora" style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>How was {movie.title}? 🍿</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Takes ten seconds — only the first row is needed.</div>

        <TakeRow label="You" value={myTake} onChange={(v) => { setMyTake(v); setError(""); }} />
        <TakeRow label="The crowd / reviews" value={publicTake} onChange={setPublicTake} allowUnsure />

        <div className="field-label">Stars</div>
        <div role="radiogroup" aria-label="Your rating" style={{ display: "flex", gap: 2, marginBottom: 12 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => setRating(rating === n ? 0 : n)}
              style={{ background: "none", border: "none", padding: 4, cursor: "pointer", fontSize: 30, lineHeight: 1, color: n <= rating ? "#F5A524" : "var(--line-strong)" }}>
              ★
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: theatre ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 8 }}>
          {theatre && (
            <div>
              <label className="field-label" htmlFor="rate-canteen">Snacks (₹)</label>
              <input id="rate-canteen" type="number" inputMode="decimal" min="0" value={canteen} onChange={(e) => setCanteen(e.target.value)} placeholder="0" />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="rate-who">Who came</label>
            <input id="rate-who" value={companions} onChange={(e) => setCompanions(e.target.value)} placeholder="e.g. Ravi, Priya" maxLength={120} />
          </div>
        </div>
        <input aria-label="One-line review" value={review} onChange={(e) => setReview(e.target.value)} placeholder="One-line review (optional)" maxLength={280} style={{ marginBottom: 10 }} />

        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Later</button>
          <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save rating"}</button>
        </div>
      </div>
    </>
  );
}
