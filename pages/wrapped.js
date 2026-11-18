// Monthly Wrapped: full-screen story slides. Tap right/left to move, hold to
// pause, share a summary card at the end.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { X, Share2 } from "lucide-react";
import { useLedger } from "../lib/useLedger";
import { wrappedFor } from "../lib/wrapped";
import { prevMonth } from "../lib/insights";
import { computeBadges } from "../lib/achievements";
import { fmt, todayISO } from "../lib/format";

const SLIDE_MS = 5000;
const BG = [
  "linear-gradient(160deg, #FF8A3D, #F0457B 55%, #9B3FD0)",
  "linear-gradient(160deg, #4F6BED, #9B3FD0 60%, #F0457B)",
  "linear-gradient(160deg, #0D9488, #22C55E 60%, #A3E635)",
  "linear-gradient(160deg, #7C3AED, #C026D3 55%, #F472B6)",
  "linear-gradient(160deg, #E8731F, #D63C78 60%, #4338CA)",
];
const monthName = (ym) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

function buildSlides(w, badgeCount) {
  const s = [];
  s.push({ big: "✨", title: `Your ${monthName(w.ym)}`, sub: "wrapped" });
  if (w.empty) {
    s.push({ big: "🌙", title: "A quiet month", sub: "Nothing was logged. Next month's story starts with one tap on ＋." });
    return s;
  }
  const diff = w.prevTotal ? w.total - w.prevTotal : null;
  s.push({ kicker: "You spent", big: fmt(w.total), sub: diff === null ? `across ${w.entries} entries` : diff <= 0 ? `${fmt(-diff)} less than the month before 👏` : `${fmt(diff)} more than the month before` });
  if (w.top) s.push({ kicker: "Top category", big: w.top.emoji, title: w.top.name, sub: `${fmt(w.top.value)} — ${Math.round(w.top.share * 100)}% of everything` });
  if (w.habit) s.push({ kicker: "Your signature move", big: `${w.habit.count}×`, title: w.habit.note, sub: `${fmt(w.habit.total)} in total` });
  if (w.bigDay) s.push({ kicker: "Biggest day", big: fmt(w.bigDay.amount), sub: new Date(w.bigDay.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) });
  s.push({ kicker: "No-spend days", big: String(w.noSpendDays), sub: w.noSpendDays >= 3 ? "Your wallet thanks you 🌿" : "Try for a few more next month" });
  if (w.movies) s.push({ kicker: "At the movies", big: `🎬 ${w.movies}`, sub: w.lovedMovie ? `Favourite: ${w.lovedMovie}` : "" });
  if (w.sugarFree) s.push({ kicker: "Sugar-free days", big: `🍬 ${w.sugarFree}`, sub: "Every one of them counted." });
  s.push({ big: "🏅", title: `${badgeCount} badge${badgeCount !== 1 ? "s" : ""} earned so far`, sub: "See you next month!", share: true });
  return s;
}

async function shareCard(w) {
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1350;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 1080, 1350);
  g.addColorStop(0, "#FF8A3D"); g.addColorStop(0.5, "#F0457B"); g.addColorStop(1, "#9B3FD0");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = "600 48px Georgia, serif"; ctx.fillText(`My ${monthName(w.ym)}`, 540, 200);
  ctx.font = "800 140px Georgia, serif"; ctx.fillText(fmt(w.total), 540, 420);
  ctx.font = "500 44px sans-serif"; ctx.fillText("spent", 540, 490);
  const lines = [
    w.top && `${w.top.emoji} Top: ${w.top.name} (${Math.round(w.top.share * 100)}%)`,
    w.habit && `☕ ${w.habit.count}× ${w.habit.note}`,
    `🌿 ${w.noSpendDays} no-spend days`,
    w.movies && `🎬 ${w.movies} movies`,
    w.sugarFree && `🍬 ${w.sugarFree} sugar-free days`,
  ].filter(Boolean);
  ctx.font = "500 50px sans-serif";
  lines.forEach((l, i) => ctx.fillText(l, 540, 650 + i * 100));
  ctx.font = "500 36px sans-serif"; ctx.globalAlpha = 0.85; ctx.fillText("Expense Ledger", 540, 1270);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const file = new File([blob], `wrapped-${w.ym}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: `My ${monthName(w.ym)} wrapped` }).catch(() => {});
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

export default function WrappedPage() {
  const router = useRouter();
  const { data, derived } = useLedger();
  const today = todayISO();
  const ym = typeof router.query.month === "string" && /^\d{4}-\d{2}$/.test(router.query.month) ? router.query.month : prevMonth(today.slice(0, 7));
  const w = useMemo(() => (derived ? wrappedFor({ ym, items: derived.items, movies: data.movies, challengeDays: data.challengeDays, custom: data.customCategories, todayIso: today }) : null), [derived, data, ym, today]);
  const badgeCount = useMemo(() => (data ? computeBadges(data, today).filter((b) => b.earned).length : 0), [data, today]);
  const slides = useMemo(() => (w ? buildSlides(w, badgeCount) : []), [w, badgeCount]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Progress bar for the current slide (pauses while held down).
  useEffect(() => setElapsed(0), [i]);
  useEffect(() => {
    if (!slides.length || paused) return;
    let raf;
    let lastT = performance.now();
    const tick = (t) => {
      const dt = t - lastT;
      lastT = t;
      setElapsed((e) => Math.min(SLIDE_MS, e + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slides.length, paused, i]);
  // Auto-advance when the bar fills; the last slide stays put.
  useEffect(() => {
    if (elapsed >= SLIDE_MS && i < slides.length - 1) setI(i + 1);
  }, [elapsed, i, slides.length]);

  function go(d) {
    setI((k) => Math.max(0, Math.min(slides.length - 1, k + d)));
  }
  const close = () => (window.history.length > 1 ? router.back() : router.push("/"));

  if (!w) return <div style={{ position: "fixed", inset: 0, background: BG[0] }} />;
  const s = slides[i];

  return (
    <div
      role="region" aria-roledescription="story" aria-label={`Wrapped, slide ${i + 1} of ${slides.length}`}
      onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}
      style={{ position: "fixed", inset: 0, zIndex: 95, background: BG[i % BG.length], color: "#fff", display: "flex", flexDirection: "column", transition: "background 0.6s ease", userSelect: "none" }}
    >
      <div style={{ display: "flex", gap: 4, padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px 0" }}>
        {slides.map((_, k) => (
          <div key={k} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.35)", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "#fff", width: k < i ? "100%" : k === i ? `${(elapsed / SLIDE_MS) * 100}%` : "0%" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 8px 0" }}>
        <button type="button" onClick={close} aria-label="Close" style={{ background: "rgba(0,0,0,0.18)", color: "#fff", border: "none", borderRadius: 999, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={20} /></button>
      </div>

      <div key={i} className="wrapped-slide" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 28px 60px", position: "relative" }}>
        <button type="button" aria-label="Previous" onClick={() => go(-1)} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "35%", background: "none", border: "none" }} />
        <button type="button" aria-label="Next" onClick={() => go(1)} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "65%", background: "none", border: "none" }} />
        {s.kicker && <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>{s.kicker}</div>}
        {s.big && <div className="lora" style={{ fontSize: s.big.length > 6 ? 64 : 88, fontWeight: 800, lineHeight: 1.05 }}>{s.big}</div>}
        {s.title && <div className="lora" style={{ fontSize: 30, fontWeight: 700, marginTop: 12 }}>{s.title}</div>}
        {s.sub && <div style={{ fontSize: 18, opacity: 0.92, marginTop: 14, maxWidth: 320, lineHeight: 1.4 }}>{s.sub}</div>}
        {s.share && (
          <button type="button" onClick={(e) => { e.stopPropagation(); shareCard(w); }}
            style={{ position: "relative", zIndex: 2, marginTop: 28, background: "#fff", color: "#9B3FD0", border: "none", borderRadius: 999, padding: "14px 26px", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <Share2 size={18} /> Share my month
          </button>
        )}
      </div>
    </div>
  );
}
