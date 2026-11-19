// A movie title box that searches TMDB as you type and shows a dropdown of
// matches (poster, year, language, audience score). Typing a title that
// isn't found still works — the dropdown is a helper, never a requirement.
import { forwardRef, useEffect, useRef, useState } from "react";
import { rememberPoster } from "./Poster";

const cache = new Map();

async function search(q) {
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`/api/data?type=movie-search&q=${encodeURIComponent(q)}`);
  const d = res.ok ? await res.json() : { results: [] };
  cache.set(key, d.results || []);
  return d.results || [];
}

const MovieSearchInput = forwardRef(function MovieSearchInput({ value, onChange, onPick, placeholder = "Movie title", id, style }, ref) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const typed = useRef(false); // only search after the user types, not when a title is set for them
  const boxRef = useRef(null);
  const listId = `${id || "movie-search"}-list`;

  useEffect(() => {
    if (!typed.current) return;
    const q = value.trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        if (!live) return;
        setResults(r);
        setOpen(r.length > 0);
        setActive(-1);
      } catch { /* offline: just a plain text box */ } finally {
        if (live) setLoading(false);
      }
    }, 280);
    return () => { live = false; clearTimeout(t); };
  }, [value]);

  // Close when tapping elsewhere.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function pick(m) {
    typed.current = false;
    setOpen(false);
    if (m.poster) rememberPoster(m.title, m.poster.replace("/w154/", "/w342/"));
    onPick?.(m);
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(results[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: "relative", ...style }}>
      <input
        ref={ref} id={id} type="text" value={value} placeholder={placeholder} maxLength={100} autoComplete="off"
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onFocus={() => results.length && typed.current && setOpen(true)}
        onKeyDown={onKeyDown}
        style={{ width: "100%" }}
      />
      {loading && value.trim().length >= 2 && typed.current && (
        <span aria-hidden="true" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--muted)" }}>…</span>
      )}
      {open && (
        <ul id={listId} role="listbox" className="card"
          style={{ position: "absolute", zIndex: 40, left: 0, right: 0, top: "calc(100% + 6px)", margin: 0, padding: 6, listStyle: "none", borderRadius: 16, maxHeight: 360, overflowY: "auto", boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,.18))", border: "1px solid var(--line)" }}>
          {results.map((m, i) => (
            <li key={m.tmdbId} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onPointerDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setActive(i)}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: 6, borderRadius: 12, cursor: "pointer", background: i === active ? "var(--surface-2)" : "transparent" }}>
              {m.poster
                ? <img src={m.poster} alt="" width={36} height={54} loading="lazy" style={{ borderRadius: 6, objectFit: "cover", flexShrink: 0, background: "var(--line)" }} />
                : <span style={{ width: 36, height: 54, borderRadius: 6, background: "var(--line)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🎬</span>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {[m.year, m.language, m.genre].filter(Boolean).join(" · ")}
                </div>
              </div>
              {m.rating != null && <span className="tabnum" style={{ fontSize: 12.5, fontWeight: 700, color: "#C98A00", flexShrink: 0 }}>★ {m.rating.toFixed(1)}</span>}
            </li>
          ))}
          <li style={{ fontSize: 11, color: "var(--faint, var(--muted))", padding: "4px 8px 2px", textAlign: "right" }}>Search by TMDB</li>
        </ul>
      )}
    </div>
  );
});

export default MovieSearchInput;
