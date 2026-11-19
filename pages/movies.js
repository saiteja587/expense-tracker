import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Poster from "../components/Poster";
import { PosterWall, PickForMe } from "../components/MovieExtras";
import { Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Clapperboard, ArrowLeft, Minus, BarChart3, Bookmark, Sparkles } from "lucide-react";
import { queueRequest, newRequestId } from "../lib/offlineQueue";
import { showToast } from "../lib/toast";
import CountUp from "../components/CountUp";
import { fmt, todayISO } from "../lib/format";
import { isRated, movieStatus } from "../lib/ledger";
import RateMovieSheet, { TAKE_CHOICES } from "../components/RateMovieSheet";
import MovieSearchInput from "../components/MovieSearchInput";
import NowShowing from "../components/NowShowing";
import MovieDetailSheet from "../components/MovieDetailSheet";
import { useLedger } from "../lib/useLedger";
import { userOttApps, onYourApps, movieStats, avgNightOut, LANGUAGE_CODES, SERVICE_NAMES, ottKey } from "../lib/movieStats";

const TAKES = [
  { value: "loved", label: "Loved it", score: 3, color: "var(--success)" },
  { value: "liked", label: "Liked it", score: 2, color: "#3F6E5B" },
  { value: "okay", label: "It was okay", score: 1, color: "var(--amber)" },
  { value: "disliked", label: "Didn't like it", score: 0, color: "var(--danger)" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function nowTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function takeInfo(value) {
  return TAKES.find((t) => t.value === value) || TAKES[TAKES.length - 1];
}
// Only movies with both takes say anything about you vs the crowd.
const bothTakes = (m) => !!m.myTake && !!m.publicTake;

const GENRES = ["Action", "Comedy", "Drama", "Thriller", "Romance", "Horror", "Sci-Fi", "Animation", "Documentary", "Other"];

function getEmptyForm() {
  return {
    title: "", date: todayISO(), time: nowTimeHHMM(), ticketPrice: "", canteenPrice: "", companions: "",
    myTake: "", publicTake: "", note: "", affectsBalance: true, quantity: 1, booked: false,
    venueType: "Theatre", venueName: "", venueNameOther: "", genre: "", rating: 0, review: "", tmdbId: null,
  };
}


function QuantityStepper({ value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Times watched</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--line-strong)", borderRadius: 8, padding: "6px 10px", width: "fit-content" }}>
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          aria-label="Decrease"
          style={{ background: "var(--line)", border: "none", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--ink)" }}
        >
          <Minus size={14} />
        </button>
        <span className="tabnum" style={{ fontSize: 16, fontWeight: 600, minWidth: 20, textAlign: "center" }}>{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(20, value + 1))}
          aria-label="Increase"
          style={{ background: "var(--ink)", border: "none", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--bg)" }}
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
  const [form, setForm] = useState(getEmptyForm);
  // Title, venue, date/time and price cover most log entries — companions,
  // genre, ratings and the balance toggle are real but occasional, so they
  // start tucked behind one tap instead of six fields nobody asked for.
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [movieCountGuideline, setMovieCountGuideline] = useState(null);
  const [showAllTime, setShowAllTime] = useState(false);
  const [theatreOptions, setTheatreOptions] = useState(["Other"]);
  const [ottOptions, setOttOptions] = useState(["Other"]);
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistForm, setWatchlistForm] = useState({ title: "", note: "" });
  const [watchlistError, setWatchlistError] = useState("");
  const [showWrapUp, setShowWrapUp] = useState(false);
  const [pendingWatchlistId, setPendingWatchlistId] = useState(null);
  const [rateTarget, setRateTarget] = useState(null);
  // The TMDB match picked from the title dropdown (for the little hint).
  const [picked, setPicked] = useState(null);
  // TMDB extras: detail sheet, per-movie runtime/cast/etc., watchlist
  // availability, and recommendations.
  const [detail, setDetail] = useState(null);
  const [meta, setMeta] = useState(null);
  const [wlInfo, setWlInfo] = useState({});
  const [recs, setRecs] = useState([]);
  const { data: ledger } = useLedger();

  async function loadWatchlist() {
    try {
      const res = await fetch("/api/data?type=watchlist");
      if (res.ok) setWatchlist((await res.json()).watchlist || []);
    } catch {}
  }

  async function load() {
    try {
      const [res, ruleRes, theatreRes, ottRes] = await Promise.all([
        fetch("/api/data?type=movies"),
        fetch("/api/data?type=budget"),
        fetch("/api/data?type=theatres"),
        fetch("/api/data?type=ott-platforms"),
      ]);
      loadWatchlist();
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      if (ruleRes.ok) {
        const ruleData = await ruleRes.json();
        const rule = ruleData.rules.find((r) => r.rule_type === "movie_count");
        setMovieCountGuideline(rule ? parseFloat(rule.amount) : null);
      }
      if (theatreRes.ok) setTheatreOptions([...(await theatreRes.json()).theatres, "Other"]);
      if (ottRes.ok) setOttOptions([...(await ottRes.json()).ottPlatforms, "Other"]);
      const mapped = data.movies.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.watched_date.slice(0, 10),
        time: m.watched_time ? m.watched_time.slice(0, 5) : "",
        ticketPrice: parseFloat(m.ticket_price),
        canteenPrice: parseFloat(m.canteen_price),
        companions: m.companions || "",
        myTake: m.my_take,
        publicTake: m.public_take,
        rating: m.rating || 0,
        review: m.review || "",
        note: m.note || "",
        affectsBalance: m.affects_balance !== false,
        quantity: m.quantity || 1,
        venueType: m.venue_type || "Theatre",
        venueName: m.venue_name || "",
        genre: m.genre || "",
        tmdbId: m.tmdb_id > 0 ? m.tmdb_id : null,
      }));
      setMovies(mapped);
      localStorage.setItem("cache_movies", JSON.stringify(mapped));
      setLoadError("");
    } catch (err) {
      const cached = localStorage.getItem("cache_movies");
      if (cached) {
        try {
          setMovies(JSON.parse(cached));
          setLoadError("You're offline — showing what was last saved. New entries will sync once you're back online.");
        } catch {
          setLoadError("Couldn't load your movies. Check your connection and refresh.");
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
  }, []);

  useEffect(() => {
    if (editingId === null && !form.venueName && theatreOptions.length > 0) {
      setForm((f) => ({ ...f, venueName: theatreOptions[0] }));
    }
  }, [theatreOptions, editingId]);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("rate");
    const m = id && movies.find((x) => String(x.id) === id);
    if (m) setRateTarget(m);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // TMDB: runtimes/cast/franchises for stats (asks again while some of
  // your older movies are still being matched), then recommendations.
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    (async () => {
      for (let k = 0; k < 4 && live; k++) {
        const d = await fetch("/api/data?type=movie-meta").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!d || !live) return;
        setMeta(d);
        if (!d.pending) break;
      }
      const r = await fetch("/api/data?type=recommendations").then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (live && r) setRecs(r.results || []);
    })();
    return () => { live = false; };
  }, [loaded]);

  const watchKey = watchlist.map((w) => w.id).join(",");
  useEffect(() => {
    if (!watchKey) { setWlInfo({}); return; }
    fetch("/api/data?type=watchlist-info").then((r) => (r.ok ? r.json() : null)).then((d) => d && setWlInfo(d.items || {})).catch(() => {});
  }, [watchKey]);

  // Links from notifications: ?details=<tmdbId> opens the details sheet,
  // ?book=<tmdbId> starts a booking for that film.
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const det = parseInt(params.get("details"), 10);
    const book = parseInt(params.get("book"), 10);
    if (det) setDetail({ tmdbId: det });
    if (book) {
      fetch(`/api/data?type=movie-details&id=${book}`).then((r) => r.json()).then(({ details }) => {
        if (!details) return;
        applyPicked({ ...details, releaseDate: details.indiaRelease || details.releaseDate }, { forceBooked: true });
        setTimeout(() => titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      }).catch(() => {});
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayISO();
  const expenses = useMemo(() => ledger?.expenses || [], [ledger]);
  const moviesWithIds = useMemo(() => movies.map((m) => ({ ...m, tmdbId: m.tmdbId || meta?.ids?.[m.id] || null })), [movies, meta]);
  const userApps = useMemo(() => userOttApps({ movies, expenses, todayIso: today }), [movies, expenses, today]);
  const nightOut = useMemo(() => avgNightOut(movies), [movies]);
  const lovedGenres = useMemo(() => new Set(movies.filter((m) => m.myTake === "loved" && m.genre).map((m) => m.genre)), [movies]);
  const seenIds = useMemo(() => new Set(moviesWithIds.map((m) => m.tmdbId).filter(Boolean)), [moviesWithIds]);
  const savedIds = useMemo(() => new Set(Object.values(wlInfo).map((i) => i.tmdbId)), [wlInfo]);
  const tmdbStats = useMemo(() => (meta ? movieStats({ movies: moviesWithIds, meta: meta.meta, collections: meta.collections, expenses, todayIso: today }) : null), [meta, moviesWithIds, expenses, today]);
  const browseLangs = useMemo(() => (tmdbStats?.languages || []).filter((l) => LANGUAGE_CODES[l.name] && l.name !== "English").slice(0, 2).map((l) => ({ code: LANGUAGE_CODES[l.name], name: l.name })), [tmdbStats]);
  // Watchlist films you can stream tonight on an app you already have.
  const streamable = useMemo(() => {
    const byApp = {};
    for (const w of watchlist) {
      for (const p of onYourApps({ stream: wlInfo[w.id]?.stream || [] }, userApps)) {
        const k = ottKey(p.name);
        (byApp[k] = byApp[k] || []).push(w.title);
      }
    }
    return Object.entries(byApp).sort((a, b) => b[1].length - a[1].length);
  }, [watchlist, wlInfo, userApps]);

  function openDetail(m) {
    setDetail({ tmdbId: m.tmdbId || null, title: m.title, year: m.year || (m.date ? m.date.slice(0, 4) : "") });
  }

  const titleInputRef = useRef(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("quickadd") === "1") {
      setTimeout(() => {
        titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        titleInputRef.current?.focus();
      }, 300);
    }
  }, [loaded]);

  function startEdit(m) {
    setEditingId(m.id);
    setPendingWatchlistId(null);
    const venueType = m.venueType || "Theatre";
    const options = venueType === "OTT" ? ottOptions : theatreOptions;
    const knownOption = options.includes(m.venueName) ? m.venueName : (m.venueName ? "Other" : options[0]);
    setForm({
      title: m.title,
      date: m.date,
      time: m.time || "",
      ticketPrice: String(m.ticketPrice),
      canteenPrice: String(m.canteenPrice),
      companions: m.companions,
      myTake: m.myTake || "",
      publicTake: m.publicTake || "",
      rating: m.rating || 0,
      review: m.review || "",
      booked: !isRated(m) && movieStatus(m) === "upcoming",
      note: m.note,
      affectsBalance: m.affectsBalance !== false,
      quantity: m.quantity || 1,
      venueType,
      venueName: knownOption,
      venueNameOther: knownOption === "Other" ? m.venueName : "",
      genre: m.genre || "",
      tmdbId: m.tmdbId || null,
    });
    setMoreDetailsOpen(true);
    setFormError("");
  }

  // A movie picked from the TMDB dropdown (or Now showing): fill in what we
  // know — title, genre, and the crowd's verdict from TMDB's audience score.
  // An unreleased film switches the form to "Booked" on its release date.
  function applyPicked(m, { forceBooked } = {}) {
    const today = todayISO();
    const future = forceBooked || (m.releaseDate && m.releaseDate > today);
    setPicked(m);
    setForm((f) => {
      const booked = future ? true : f.booked;
      const date = booked && m.releaseDate > today && !forceBooked ? m.releaseDate : booked && f.date < today ? today : f.date;
      return {
        ...f,
        title: m.title,
        tmdbId: m.tmdbId || null,
        genre: f.genre || m.genre || "",
        publicTake: booked ? "" : f.publicTake || m.crowdTake || "",
        booked,
        date,
      };
    });
  }

  function cancelEdit() {
    setPicked(null);
    setEditingId(null);
    setForm(getEmptyForm());
    setMoreDetailsOpen(false);
    setPendingWatchlistId(null);
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
    const resolvedVenueName = form.venueName === "Other" ? form.venueNameOther.trim() : form.venueName;
    if (form.venueName === "Other" && !resolvedVenueName) {
      setFormError(`Name the ${form.venueType === "OTT" ? "platform" : "theatre"}`);
      return;
    }
    if (form.booked && form.date < todayISO()) {
      setFormError("That date has passed — switch to “Watched it”");
      return;
    }
    if (!form.booked && form.date > todayISO()) {
      setFormError("That's in the future — switch to “Booked”");
      return;
    }
    setFormError("");
    setSubmitting(true);
    const isEdit = editingId !== null;
    const booked = form.booked;
    const payload = {
      type: "movies",
      ...(isEdit ? { id: editingId } : {}),
      title: form.title.trim(),
      date: form.date,
      time: form.time,
      ticketPrice: tp,
      canteenPrice: booked ? 0 : cp,
      companions: form.companions.trim(),
      myTake: booked ? "" : form.myTake,
      publicTake: booked ? "" : form.publicTake,
      note: form.note.trim(),
      affectsBalance: form.affectsBalance,
      quantity: form.quantity,
      venueType: form.venueType,
      venueName: resolvedVenueName,
      genre: form.genre,
      tmdbId: form.tmdbId || undefined,
      rating: booked ? null : form.rating || null,
      review: booked ? "" : (form.review || "").trim(),
      ...(isEdit ? {} : { clientRequestId: newRequestId() }),
    };

    let res;
    try {
      res = await fetch("/api/data", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      queueRequest({ url: "/api/data", method: isEdit ? "PUT" : "POST", body: payload });
      if (!isEdit) {
        setMovies((prev) => [
          { id: `pending-${Date.now()}`, title: form.title.trim(), date: form.date, time: form.time, ticketPrice: tp, canteenPrice: cp, companions: form.companions.trim(), myTake: form.myTake, publicTake: form.publicTake, note: form.note.trim(), affectsBalance: form.affectsBalance !== false, quantity: form.quantity, pending: true },
          ...prev,
        ]);
      }
      cancelEdit();
      setSubmitting(false);
      return;
    }

    try {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save");
      }
      const wasEdit = isEdit;
      const watchlistIdToClear = pendingWatchlistId;
      cancelEdit();
      await load();
      if (watchlistIdToClear) await removeFromWatchlist(watchlistIdToClear);
      showToast(wasEdit ? "Movie updated" : booked ? "Booked — we'll ask how it was after the show" : "Movie logged", booked ? "🎟️" : "🎬");
    } catch (err) {
      setFormError(err.message || "Couldn't save that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMovie(id) {
    if (!window.confirm("Delete this movie? This can't be undone.")) return;
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

  async function addToWatchlist(e, direct) {
    e?.preventDefault?.();
    const entry = direct || { title: watchlistForm.title.trim(), note: watchlistForm.note.trim(), tmdbId: watchlistForm.tmdbId, releaseDate: watchlistForm.releaseDate };
    if (!entry.title) {
      setWatchlistError("Enter a movie title");
      return;
    }
    setWatchlistError("");
    const res = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "watchlist", title: entry.title, note: entry.note || "", tmdbId: entry.tmdbId, releaseDate: entry.releaseDate }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setWatchlistError(d.error || "Couldn't save. Try again.");
      return;
    }
    if (!direct) setWatchlistForm({ title: "", note: "" });
    await loadWatchlist();
    showToast("Added to watchlist", "🔖");
  }

  async function removeFromWatchlist(id) {
    const prev = watchlist;
    setWatchlist(watchlist.filter((w) => w.id !== id));
    const res = await fetch(`/api/data?type=watchlist&id=${id}`, { method: "DELETE" });
    if (!res.ok) setWatchlist(prev);
  }

  // "Move to watched" doesn't create the movie itself — it hands the title
  // to the log form and removes it from the watchlist once you actually
  // save, so a half-filled form never silently loses the watchlist entry.
  function moveToWatched(w) {
    setForm((f) => ({ ...f, title: w.title }));
    setPendingWatchlistId(w.id);
    titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => titleInputRef.current?.focus(), 300);
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

  const judged = monthMovies.filter(bothTakes);
  const matchedCount = judged.filter((x) => takeInfo(x.myTake).score === takeInfo(x.publicTake).score).length;
  const divergedCount = judged.filter((x) => Math.abs(takeInfo(x.myTake).score - takeInfo(x.publicTake).score) >= 2).length;
  // Booked but not yet seen, and seen but not yet rated (all months).
  const upcomingMovies = useMemo(() => movies.filter((m) => !m.pending && ["upcoming", "watching"].includes(movieStatus(m))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), [movies]);
  const toRate = useMemo(() => movies.filter((m) => !m.pending && movieStatus(m) === "rate"), [movies]);

  const allTimeStats = useMemo(() => {
    if (movies.length === 0) return null;
    const totalViewings = movies.reduce((s, m) => s + (m.quantity || 1), 0);
    const totalSpend = movies.reduce((s, m) => s + (m.ticketPrice + m.canteenPrice) * (m.quantity || 1), 0);
    const rewatches = movies.filter((m) => (m.quantity || 1) > 1).length;
    const avgCost = totalViewings > 0 ? totalSpend / totalViewings : 0;
    const judgedAll = movies.filter(bothTakes);
    const matched = judgedAll.filter((m) => takeInfo(m.myTake).score === takeInfo(m.publicTake).score).length;
    const agreementRate = judgedAll.length ? Math.round((matched / judgedAll.length) * 100) : 0;

    const companionCounts = {};
    for (const m of movies) {
      if (!m.companions) continue;
      for (const name of m.companions.split(",").map((s) => s.trim()).filter(Boolean)) {
        companionCounts[name] = (companionCounts[name] || 0) + 1;
      }
    }
    const topCompanion = Object.entries(companionCounts).sort((a, b) => b[1] - a[1])[0];

    const genreCounts = {};
    for (const m of movies) {
      if (!m.genre) continue;
      genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1;
    }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const rewatchRate = Math.round((rewatches / movies.length) * 100);

    return { totalTitles: movies.length, totalViewings, totalSpend, rewatches, rewatchRate, avgCost, agreementRate, topCompanion, topGenres };
  }, [movies]);

  const sorted = useMemo(() => {
    return [...monthMovies].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [monthMovies]);

  // Yearly wrap-up: a Spotify-Wrapped-style snapshot of the calendar year,
  // computed straight from what's already loaded — no extra fetch needed.
  const currentYear = new Date().getFullYear();
  const yearWrapUp = useMemo(() => {
    const yearMovies = movies.filter((m) => new Date(m.date + "T00:00:00").getFullYear() === currentYear);
    if (yearMovies.length === 0) return null;
    const totalSpendYear = yearMovies.reduce((s, m) => s + (m.ticketPrice + m.canteenPrice) * (m.quantity || 1), 0);
    const genreCounts = {};
    const companionCounts = {};
    const monthCounts = Array(12).fill(0);
    for (const m of yearMovies) {
      if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1;
      if (m.companions) {
        for (const name of m.companions.split(",").map((s) => s.trim()).filter(Boolean)) {
          companionCounts[name] = (companionCounts[name] || 0) + 1;
        }
      }
      monthCounts[new Date(m.date + "T00:00:00").getMonth()] += m.quantity || 1;
    }
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0];
    const topCompanion = Object.entries(companionCounts).sort((a, b) => b[1] - a[1])[0];
    const bestMonthIdx = monthCounts.indexOf(Math.max(...monthCounts));
    return {
      titles: yearMovies.length,
      viewings: yearMovies.reduce((s, m) => s + (m.quantity || 1), 0),
      totalSpend: totalSpendYear,
      topGenre, topCompanion,
      bestMonth: MONTH_NAMES[bestMonthIdx],
      bestMonthCount: monthCounts[bestMonthIdx],
    };
  }, [movies, currentYear]);

  // Ticket price trend: this month's average ticket price vs. three months
  // ago — a quick "are prices creeping up?" read, not a full chart.
  const ticketTrend = useMemo(() => {
    function avgTicketFor(ym) {
      const inMonth = movies.filter((m) => m.date.slice(0, 7) === ym && m.venueType !== "OTT" && m.ticketPrice > 0);
      if (inMonth.length === 0) return null;
      return inMonth.reduce((s, m) => s + m.ticketPrice, 0) / inMonth.length;
    }
    const now = new Date();
    const thisYm = todayISO().slice(0, 7);
    const pastDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const pastYm = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}`;
    const current = avgTicketFor(thisYm);
    const past = avgTicketFor(pastYm);
    if (current === null || past === null || past === 0) return null;
    const pct = Math.round(((current - past) / past) * 100);
    return { current, past, pct };
  }, [movies]);

  function diverges(m) {
    if (!bothTakes(m)) return false;
    return Math.abs(takeInfo(m.myTake).score - takeInfo(m.publicTake).score) >= 2;
  }

  if (!loaded) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
        Loading your movie log…
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

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 32, borderBottom: "1px solid var(--line-strong)", paddingBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="lora gradient-title" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Movie Nights
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
            Tickets, snacks, who you went with, and whether the crowd agreed with you.
          </div>
          <Link href="/shows" className="chip" style={{ textDecoration: "none", marginTop: 8, display: "inline-flex" }}>📺 Your TV shows →</Link>
        </div>
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

      {movieCountGuideline && monthMovies.length > movieCountGuideline && (
        <div style={{ fontSize: 13, color: "var(--warn)", marginBottom: 16, background: "var(--warn-bg)", borderRadius: 4, padding: "8px 12px" }}>
          You've watched {monthMovies.length} this month — {monthMovies.length - movieCountGuideline} over your usual {movieCountGuideline}. Just a heads-up, not a stop sign.
        </div>
      )}

      <div style={{ display: "flex", gap: 40, marginBottom: 40, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Spent in {MONTH_NAMES[month]}</div>
          <div className="lora tabnum" style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: 600, lineHeight: 1 }}>
            {fmt(totalSpend)}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            {fmt(ticketSpend)} tickets · {fmt(canteenSpend)} canteen
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Movies watched</div>
          <div className="lora tabnum" style={{ fontSize: "clamp(28px, 8vw, 44px)", fontWeight: 600, lineHeight: 1 }}>
            {viewingsCount}
          </div>
          {viewingsCount !== monthMovies.length && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{monthMovies.length} titles, some rewatched</div>
          )}
        </div>
        {judged.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>You vs the crowd</div>
            <div style={{ fontSize: 14, marginTop: 10 }}>
              <span style={{ color: "var(--success)", fontWeight: 500 }}>{matchedCount} matched</span>
              <span style={{ color: "var(--muted)" }}> · </span>
              <span style={{ color: "var(--danger)", fontWeight: 500 }}>{divergedCount} you disagreed</span>
            </div>
          </div>
        )}
      </div>

      {allTimeStats && (
        <div style={{ marginBottom: 32 }}>
          <button
            className="story-chip"
            onClick={() => setShowAllTime((v) => !v)}
            style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 20, padding: "7px 14px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <BarChart3 size={13} /> {showAllTime ? "Hide" : "Show"} all-time stats
          </button>
          {showAllTime && (
            <div className="panel-soft" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginTop: 14, padding: "16px 18px", background: "var(--surface-2)", borderRadius: 6 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Titles logged</div>
                <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600 }}><CountUp value={allTimeStats.totalTitles} /></div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Total viewings</div>
                <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600 }}><CountUp value={allTimeStats.totalViewings} /></div>
                {allTimeStats.rewatches > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{allTimeStats.rewatches} rewatched</div>}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Spent all-time</div>
                <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600 }}><CountUp value={allTimeStats.totalSpend} format={fmt} /></div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Avg. per viewing</div>
                <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600 }}><CountUp value={allTimeStats.avgCost} format={fmt} /></div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Agree with public</div>
                <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600 }}><CountUp value={allTimeStats.agreementRate} />%</div>
              </div>
              {allTimeStats.topCompanion && (
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Most watched with</div>
                  <div className="lora" style={{ fontSize: 16, fontWeight: 600 }}>{allTimeStats.topCompanion[0]}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{allTimeStats.topCompanion[1]} times</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Rewatch rate</div>
                <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 600 }}><CountUp value={allTimeStats.rewatchRate} />%</div>
              </div>
              {allTimeStats.topGenres.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Top genres</div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>
                    {allTimeStats.topGenres.map(([g, c]) => `${g} (${c})`).join(", ")}
                  </div>
                </div>
              )}
              {ticketTrend && (
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Ticket price trend</div>
                  <div className="lora tabnum" style={{ fontSize: 18, fontWeight: 600, color: ticketTrend.pct > 0 ? "var(--danger)" : "var(--success)" }}>
                    {ticketTrend.pct > 0 ? "↑" : ticketTrend.pct < 0 ? "↓" : "→"} {Math.abs(ticketTrend.pct)}%
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>vs. 3 months ago ({fmt(ticketTrend.past)} → {fmt(ticketTrend.current)})</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tmdbStats && tmdbStats.matched > 0 && (
        <section aria-label="Your movies in numbers" className="card" style={{ padding: "16px 18px", borderRadius: 18, marginBottom: 28 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>🎞️ Your movies in numbers</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Hours watched</div>
              <div className="lora tabnum" style={{ fontSize: 24, fontWeight: 700 }}><CountUp value={tmdbStats.hours} />h</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{tmdbStats.theatreHours}h theatre · {tmdbStats.ottHours}h OTT</div>
            </div>
            {tmdbStats.costPerHourTheatre != null && (
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Cost per hour</div>
                <div className="lora tabnum" style={{ fontSize: 24, fontWeight: 700 }}>{fmt(tmdbStats.costPerHourTheatre)}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>in theatres{tmdbStats.costPerHourOtt != null ? ` · ${fmt(tmdbStats.costPerHourOtt)}/h streaming` : ""}</div>
              </div>
            )}
            {tmdbStats.topActors[0] && (
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Favourite actor</div>
                <div className="lora" style={{ fontSize: 16, fontWeight: 700 }}>{tmdbStats.topActors[0].name}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{tmdbStats.topActors[0].count} movies{tmdbStats.topDirectors[0] ? ` · director: ${tmdbStats.topDirectors[0].name}` : ""}</div>
              </div>
            )}
          </div>
          {tmdbStats.languages.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "var(--line)" }}>
                {tmdbStats.languages.map((l, k) => <span key={l.name} title={`${l.name} ${l.pct}%`} style={{ width: `${l.pct}%`, background: ["#B0567F", "#3F6E5B", "#C98A00", "#4F6FB0"][k] }} />)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 5 }}>{tmdbStats.languages.map((l) => `${l.name} ${l.pct}%`).join(" · ")}</div>
            </div>
          )}
          {tmdbStats.franchises.slice(0, 2).map((f) => (
            <div key={f.name} style={{ marginTop: 12, fontSize: 13 }}>
              <b>{f.name}</b>: seen {f.seen} of {f.total}{f.next ? <> — next up: <button type="button" onClick={() => setDetail({ tmdbId: f.next.tmdbId, title: f.next.title })} style={{ background: "none", border: "none", padding: 0, color: "var(--accent-solid)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>{f.next.title}</button></> : " 🎉"}
            </div>
          ))}
          {tmdbStats.matched < tmdbStats.total && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Based on {tmdbStats.matched} of {tmdbStats.total} movies matched on TMDB.</div>}
        </section>
      )}

      {yearWrapUp && (
        <div style={{ marginBottom: 32 }}>
          <button
            onClick={() => setShowWrapUp((v) => !v)}
            style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "7px 14px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <Sparkles size={13} /> {showWrapUp ? "Hide" : "Show"} {currentYear} wrap-up
          </button>
          {showWrapUp && (
            <div className="panel-soft" style={{ marginTop: 14, padding: "20px 22px", borderRadius: 6, background: "linear-gradient(135deg, var(--danger) 0%, #8C4470 50%, var(--success) 100%)", color: "var(--bg)" }}>
              <div className="lora" style={{ fontSize: 18, fontWeight: 600, marginBottom: 14 }}>Your {currentYear} in movies</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Titles watched</div>
                  <div className="lora tabnum" style={{ fontSize: 26, fontWeight: 600 }}>{yearWrapUp.titles}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Total viewings</div>
                  <div className="lora tabnum" style={{ fontSize: 26, fontWeight: 600 }}>{yearWrapUp.viewings}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Spent on movies</div>
                  <div className="lora tabnum" style={{ fontSize: 26, fontWeight: 600 }}>{fmt(yearWrapUp.totalSpend)}</div>
                </div>
                {yearWrapUp.topGenre && (
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Top genre</div>
                    <div className="lora" style={{ fontSize: 18, fontWeight: 600 }}>{yearWrapUp.topGenre[0]}</div>
                    <div style={{ fontSize: 11.5, opacity: 0.8 }}>{yearWrapUp.topGenre[1]} times</div>
                  </div>
                )}
                {yearWrapUp.topCompanion && (
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Watched most with</div>
                    <div className="lora" style={{ fontSize: 18, fontWeight: 600 }}>{yearWrapUp.topCompanion[0]}</div>
                    <div style={{ fontSize: 11.5, opacity: 0.8 }}>{yearWrapUp.topCompanion[1]} times</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Biggest movie month</div>
                  <div className="lora" style={{ fontSize: 18, fontWeight: 600 }}>{yearWrapUp.bestMonth}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.8 }}>{yearWrapUp.bestMonthCount} viewings</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {toRate.length > 0 && (
        <section aria-label="Rate these" style={{ marginBottom: 24 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>⭐ How were they?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {toRate.map((m) => (
              <button key={m.id} type="button" onClick={() => setRateTarget(m)} className="card"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, borderRadius: 16, border: "1px solid var(--line)", cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}>
                <Poster title={m.title} width={40} radius={7} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Watched {new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · tap to rate</div>
                </div>
                <span style={{ fontSize: 22, letterSpacing: -2 }} aria-hidden="true">{TAKE_CHOICES.map((t) => t.emoji).slice(0, 3).join("")}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {upcomingMovies.length > 0 && (
        <section aria-label="Coming up" style={{ marginBottom: 24 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>🎟️ Coming up</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcomingMovies.map((m) => (
              <div key={m.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 10, borderRadius: 16, border: "1px solid var(--line)" }}>
                <Poster title={m.title} width={40} radius={7} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {movieStatus(m) === "watching" ? "Showing now — enjoy! 🍿" : new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                    {movieStatus(m) !== "watching" && m.time ? ` · ${m.time}` : ""}{m.venueName ? ` · ${m.venueName}` : ""}{m.ticketPrice ? ` · ${fmt(m.ticketPrice * m.quantity)}` : ""}
                  </div>
                </div>
                <button type="button" className="icon-btn" aria-label={`Edit ${m.title}`} onClick={() => { startEdit(m); titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><Pencil size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      <NowShowing
        savedTitles={watchlist.map((w) => w.title)}
        langs={browseLangs}
        nightOut={nightOut}
        onOpen={(m) => setDetail({ tmdbId: m.tmdbId, title: m.title })}
        onSave={(m) => addToWatchlist(null, { title: m.title, tmdbId: m.tmdbId, releaseDate: m.releaseDate, note: [m.language, m.releaseDate > todayISO() ? `releases ${new Date(m.releaseDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ") })}
        onBook={(m) => {
          cancelEdit();
          applyPicked(m, { forceBooked: true });
          setTimeout(() => {
            titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 50);
        }}
      />

      {recs.length > 0 && (
        <section aria-label="Recommended for you" style={{ marginBottom: 28 }}>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>✨ Because you loved {recs[0].because}{new Set(recs.map((r) => r.because)).size > 1 ? " & more" : ""}</div>
          <div className="h-scroll" data-no-tab-swipe="1" style={{ gap: 12, paddingBottom: 6 }}>
            {recs.map((r) => {
              const mine = onYourApps({ stream: r.stream }, userApps)[0];
              return (
                <button key={r.tmdbId} type="button" onClick={() => setDetail({ tmdbId: r.tmdbId, title: r.title })}
                  style={{ flex: "0 0 104px", width: 104, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}>
                  <img src={r.poster} alt="" width={104} height={156} loading="lazy" style={{ width: 104, height: 156, objectFit: "cover", borderRadius: 12, background: "var(--line)", display: "block" }} />
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 5, lineHeight: 1.2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2, color: mine || r.inTheatres ? "var(--success)" : "var(--muted)" }}>
                    {mine ? `📺 On ${mine.name}` : r.inTheatres ? "🍿 In theatres" : r.rating != null ? `★ ${r.rating.toFixed(1)}` : r.year}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <PosterWall movies={movies} />

      {/* Watchlist: movies you want to watch, kept separate from what you've logged */}
      <div style={{ marginBottom: 32 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Bookmark size={15} color="#7A3E56" /> Watchlist
        </div>
        {streamable.length > 0 && (
          <div className="card" style={{ padding: "10px 12px", borderRadius: 14, marginBottom: 12, borderLeft: "4px solid var(--success)" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              📺 {streamable[0][1].length} on your watchlist {streamable[0][1].length === 1 ? "is" : "are"} on {SERVICE_NAMES[streamable[0][0]] || streamable[0][0]} — an app you already use
            </div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{streamable[0][1].slice(0, 3).join(", ")}{streamable[0][1].length > 3 ? "…" : ""} — no ticket needed.</div>
          </div>
        )}
        <PickForMe watchlist={watchlist} movies={movies} info={wlInfo} recs={recs} userApps={userApps} />
        <form onSubmit={addToWatchlist} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <MovieSearchInput id="watch-title" placeholder="Movie to watch — type to search" value={watchlistForm.title}
            onChange={(v) => setWatchlistForm((w) => ({ ...w, title: v, tmdbId: null, releaseDate: null }))}
            onPick={(m) => setWatchlistForm((w) => ({ title: m.title, tmdbId: m.tmdbId, releaseDate: m.releaseDate, note: w.note || [m.language, m.releaseDate > todayISO() ? `releases ${new Date(m.releaseDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : m.year].filter(Boolean).join(" · ") }))}
            style={{ flex: "1 1 160px" }} />
          <input type="text" placeholder="Note (optional)" value={watchlistForm.note} onChange={(e) => setWatchlistForm({ ...watchlistForm, note: e.target.value })} maxLength={100} style={{ flex: "1 1 140px" }} />
          <button type="submit" className="pill" style={{ background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <Plus size={13} /> Add
          </button>
        </form>
        {watchlistError && <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>{watchlistError}</div>}
        {watchlist.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing on your watchlist yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {watchlist.map((w) => (
              <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", gap: 12 }}>
                <button type="button" onClick={() => openDetail({ ...w, tmdbId: wlInfo[w.id]?.tmdbId })} aria-label={`${w.title} details`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  <Poster title={w.title} width={40} radius={7} />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{w.title}{wlInfo[w.id]?.rating != null && <span style={{ fontSize: 12, color: "#C98A00", fontWeight: 600 }}> ★{wlInfo[w.id].rating.toFixed(1)}</span>}</div>
                  {(() => {
                    const i = wlInfo[w.id];
                    if (!i) return w.note ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{w.note}</div> : null;
                    const mine = onYourApps({ stream: i.stream }, userApps)[0];
                    const badge = mine ? { t: `📺 On ${mine.name} — you have it`, c: "var(--success)" }
                      : i.inTheatres ? { t: "🍿 In theatres now", c: "var(--success)" }
                      : i.releaseDate && i.releaseDate > today ? { t: `🗓️ Releases ${new Date(i.releaseDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} — we'll remind you`, c: "var(--text-2)" }
                      : i.stream?.length ? { t: `On ${i.stream.slice(0, 2).map((p) => p.name).join(", ")}`, c: "var(--text-2)" }
                      : null;
                    return (
                      <>
                        {badge && <div style={{ fontSize: 12, color: badge.c, fontWeight: 600 }}>{badge.t}</div>}
                        {w.note && <div style={{ fontSize: 12, color: "var(--muted)" }}>{w.note}</div>}
                      </>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <button type="button" onClick={() => moveToWatched(w)} style={{ background: "var(--surface-2)", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 500, color: "var(--text-2)", cursor: "pointer" }}>
                    Watched it →
                  </button>
                  <button onClick={() => removeFromWatchlist(w.id)} aria-label="Remove" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--faint)", display: "flex" }}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="responsive-grid">
        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            {editingId ? "Edit movie" : "Log a movie"}
          </div>
          <form onSubmit={submitMovie} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div role="radiogroup" aria-label="Watched or booked" style={{ display: "flex", gap: 6 }}>
              {[[false, "✅ Watched it"], [true, "🎟️ Booked — watching later"]].map(([b, label]) => (
                <button key={String(b)} type="button" role="radio" aria-checked={form.booked === b}
                  onClick={() => setForm({ ...form, booked: b, date: b ? (form.date < todayISO() ? todayISO() : form.date) : (form.date > todayISO() ? todayISO() : form.date) })}
                  className={`chip${form.booked === b ? " active" : ""}`} style={{ flex: 1, justifyContent: "center" }}>
                  {label}
                </button>
              ))}
            </div>
            {form.booked && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>Just the booking for now — after the show we&apos;ll ask how it was and what you spent on snacks.</div>}
            <MovieSearchInput ref={titleInputRef} id="log-title" placeholder="Movie title — start typing to search" value={form.title}
              onChange={(v) => { setForm((f) => ({ ...f, title: v, tmdbId: picked && v !== picked.title ? null : f.tmdbId })); if (picked && v !== picked.title) setPicked(null); }}
              onPick={(m) => applyPicked(m)} />
            {picked && (
              <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: -4 }}>
                ✓ {[picked.year, picked.language, picked.genre].filter(Boolean).join(" · ")}
                {picked.rating != null && <> · TMDB ★ {picked.rating.toFixed(1)}</>}
                {!form.booked && picked.crowdTake && form.publicTake === picked.crowdTake && <> — crowd take set to “{TAKES.find((t) => t.value === picked.crowdTake)?.label}”</>}
                {picked.overview && <div style={{ color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>{picked.overview}{picked.overview.length >= 220 ? "…" : ""}</div>}
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>{form.booked ? "Watching at" : "Watched via"}</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {["Theatre", "OTT"].map((vt) => (
                  <button
                    key={vt}
                    type="button"
                    onClick={() => {
                      const options = vt === "OTT" ? ottOptions : theatreOptions;
                      setForm({ ...form, venueType: vt, venueName: options[0], venueNameOther: "" });
                    }}
                    style={{
                      flex: 1, fontSize: 13, padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                      border: "1px solid " + (form.venueType === vt ? "var(--ink)" : "var(--line-strong)"),
                      background: form.venueType === vt ? "var(--ink)" : "transparent",
                      color: form.venueType === vt ? "var(--bg)" : "var(--text-2)",
                    }}
                  >
                    {vt === "OTT" ? "OTT / Streaming" : "Theatre"}
                  </button>
                ))}
              </div>
              <select value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value, venueNameOther: "" })}>
                {(form.venueType === "OTT" ? ottOptions : theatreOptions).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {form.venueName === "Other" && (
                <input
                  type="text"
                  placeholder={form.venueType === "OTT" ? "Platform name" : "Theatre name"}
                  value={form.venueNameOther}
                  onChange={(e) => setForm({ ...form, venueNameOther: e.target.value })}
                  maxLength={60}
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" aria-label={form.booked ? "Show date" : "Date watched"} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} {...(form.booked ? { min: todayISO() } : { max: todayISO() })} style={{ flex: 1 }} />
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="number" inputMode="decimal" placeholder="Ticket (₹)" value={form.ticketPrice} onChange={(e) => setForm({ ...form, ticketPrice: e.target.value })} step="0.01" min="0" />
              {!form.booked && <input type="number" inputMode="decimal" placeholder="Canteen (₹)" value={form.canteenPrice} onChange={(e) => setForm({ ...form, canteenPrice: e.target.value })} step="0.01" min="0" />}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>Per-viewing price — total below accounts for rewatches</div>
            <QuantityStepper value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
            {form.quantity > 1 && (
              <div style={{ fontSize: 12, color: "var(--text-2)" }}>
                Total for this entry: {fmt((parseFloat(form.ticketPrice) || 0) * form.quantity + (parseFloat(form.canteenPrice) || 0) * form.quantity)}
              </div>
            )}
            {!form.booked && (
              <div>
                <div className="field-label">How was it? (you can rate later too)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {TAKE_CHOICES.map((t) => {
                    const on = form.myTake === t.value;
                    return (
                      <button key={t.value} type="button" aria-pressed={on} onClick={() => setForm({ ...form, myTake: on ? "" : t.value })}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 2px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${on ? "var(--ink)" : "var(--line-strong)"}`, background: on ? "var(--surface-2)" : "transparent", color: "var(--ink)" }}>
                        <span style={{ fontSize: 22 }} aria-hidden="true">{t.emoji}</span>
                        <span style={{ fontSize: 11 }}>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {moreDetailsOpen ? (
              <>
                <input type="text" placeholder="Who you went with (optional)" value={form.companions} onChange={(e) => setForm({ ...form, companions: e.target.value })} maxLength={120} />
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Genre (optional)</label>
                  <select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}>
                    <option value="">Not set</option>
                    {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                {!form.booked && (<>
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>How the public/critics received it</label>
                  <select value={form.publicTake} onChange={(e) => setForm({ ...form, publicTake: e.target.value })}>
                    <option value="">Not sure / skip</option>
                    {TAKES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="field-label">Your rating</div>
                  <div role="radiogroup" aria-label="Your rating" style={{ display: "flex", gap: 4 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={form.rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                        onClick={() => setForm({ ...form, rating: form.rating === n ? 0 : n })}
                        style={{ background: "none", border: "none", padding: 4, cursor: "pointer", fontSize: 28, lineHeight: 1, color: n <= form.rating ? "#F5A524" : "var(--line-strong)" }}>
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <input type="text" placeholder="One-line review (optional)" value={form.review} onChange={(e) => setForm({ ...form, review: e.target.value })} maxLength={280} />
                </>)}
                <input type="text" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={140} />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.affectsBalance} onChange={(e) => setForm({ ...form, affectsBalance: e.target.checked })} style={{ width: "auto" }} />
                  Deduct from balance
                </label>
                {!editingId && (
                  <button type="button" onClick={() => setMoreDetailsOpen(false)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: "var(--muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                    Hide extra details
                  </button>
                )}
              </>
            ) : (
              <button type="button" onClick={() => setMoreDetailsOpen(true)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, color: "var(--muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
                {form.booked ? "Who with, genre, note →" : "Who with, genre, stars, review, note →"}
              </button>
            )}
            {formError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{formError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={submitting}
                style={{ flex: 1, marginTop: 4, background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={16} /> {submitting ? "Saving…" : editingId ? "Save changes" : form.booked ? "Save booking" : "Add movie"}
              </button>
              {editingId && (
                <button type="button" onClick={cancelEdit} style={{ marginTop: 4, background: "var(--line)", color: "var(--ink)", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div>
          <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            This month
          </div>
          {sorted.length === 0 ? (
            <div style={{ border: "1px dashed var(--line-strong)", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
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
                  <div key={m.id} className="card" style={{ border: "1px solid var(--line)", borderRadius: 4, padding: "14px 16px", display: "flex", gap: 14 }}>
                    <button type="button" onClick={() => openDetail(m)} aria-label={`${m.title} details`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", alignSelf: "flex-start" }}>
                      <Poster title={m.title} width={64} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="lora" style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                          {m.title}
                          {m.quantity > 1 && (
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#7A3E56", background: "#7A3E561A", padding: "2px 7px", borderRadius: 20 }}>
                              ×{m.quantity}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          {m.time && <> · {m.time}</>}
                          {m.venueName && <> · {m.venueName}{m.venueType === "OTT" ? " (OTT)" : ""}</>}
                          {m.genre && <> · {m.genre}</>}
                          {m.companions && <> · with {m.companions}</>}
                          {m.affectsBalance === false && <> · not deducted from balance</>}
                          {m.pending && <> · pending sync</>}
                          {!m.pending && (
                            <> · <button type="button" onClick={() => openDetail(m)} style={{ background: "none", border: "none", padding: 0, color: "var(--danger)", cursor: "pointer", fontSize: 12 }}>details →</button></>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span className="tabnum" style={{ fontSize: 15, fontWeight: 500 }}>{fmt(total)}</span>
                        {!m.pending && (
                          <>
                            <button onClick={() => startEdit(m)} aria-label="Edit" className="icon-btn">
                              <Pencil size={17} />
                            </button>
                            <button onClick={() => removeMovie(m.id)} aria-label="Delete" className="icon-btn danger">
                              <Trash2 size={17} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      {fmt(m.ticketPrice)} ticket · {fmt(m.canteenPrice)} canteen{m.quantity > 1 && <> · ×{m.quantity} viewings</>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {!isRated(m) ? (
                        ["upcoming", "watching"].includes(movieStatus(m)) ? (
                          <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 20, background: "var(--surface-2)", color: "var(--text-2)", fontWeight: 500 }}>🎟️ Booked</span>
                        ) : !m.pending && (
                          <button type="button" className="chip active" onClick={() => setRateTarget(m)} style={{ fontSize: 12, minHeight: 28, padding: "3px 10px" }}>⭐ Rate it</button>
                        )
                      ) : (<>
                      <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 20, background: mine.color + "1A", color: mine.color, fontWeight: 500 }}>
                        You: {mine.label}
                      </span>
                      {m.publicTake && (
                      <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 20, background: pub.color + "1A", color: pub.color, fontWeight: 500 }}>
                        Public: {pub.label}
                      </span>
                      )}
                      </>)}
                      {mismatch && (
                        <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 20, background: "#5B3A5C1A", color: "#5B3A5C", fontWeight: 500 }}>
                          You disagreed with the crowd
                        </span>
                      )}
                    </div>
                    {(m.rating > 0 || m.review) && (
                      <div style={{ marginTop: 8 }}>
                        {m.rating > 0 && <span aria-label={`${m.rating} of 5 stars`} style={{ color: "#F5A524", fontSize: 15, letterSpacing: 1 }}>{"★".repeat(m.rating)}<span style={{ color: "var(--line-strong)" }}>{"★".repeat(5 - m.rating)}</span></span>}
                        {m.review && <div style={{ fontSize: 13, color: "var(--ink)", marginTop: 2 }}>“{m.review}”</div>}
                      </div>
                    )}
                    {m.note && (
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8, fontStyle: "italic" }}>{m.note}</div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {rateTarget && <RateMovieSheet movie={rateTarget} onClose={() => setRateTarget(null)} onSaved={() => load()} />}
      {detail && (
        <MovieDetailSheet
          target={detail}
          onClose={() => setDetail(null)}
          userApps={userApps} nightOut={nightOut} lovedGenres={lovedGenres} seenIds={seenIds} savedIds={savedIds}
          onSave={(d) => { addToWatchlist(null, { title: d.title, tmdbId: d.tmdbId, releaseDate: d.indiaRelease || d.releaseDate, note: d.language || "" }); }}
          onLog={(d) => {
            setDetail(null);
            cancelEdit();
            applyPicked({ ...d, releaseDate: d.indiaRelease || d.releaseDate });
            setTimeout(() => titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
          }}
        />
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 32 }}>
        Movie data from TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </div>
  );
}
