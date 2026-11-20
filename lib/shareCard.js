// A shareable "I watched…" card (1080×1920, story-sized): the poster, your
// stars, your take and one-line review. Drawn on a canvas in the browser,
// then shared as an image (WhatsApp, Instagram stories…) or downloaded.
import { posterUrlFor, posterHue } from "../components/Poster";

const TAKE_TEXT = { loved: "😍 Loved it", liked: "🙂 Liked it", okay: "😐 It was okay", disliked: "👎 Didn't like it" };

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous"; // TMDB images allow this, so the canvas stays exportable
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  return lines;
}

export async function drawMovieCard(movie, { noPoster = false } = {}) {
  const W = 1080, H = 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const hue = posterHue(movie.title);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `hsl(${hue} 55% 22%)`);
  bg.addColorStop(1, `hsl(${(hue + 60) % 360} 50% 10%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Poster (or a generated tile)
  const pw = 640, ph = 960, px = (W - pw) / 2, py = 200;
  const url = noPoster ? null : await posterUrlFor(movie.title).catch(() => null);
  const img = await loadImage(url ? url.replace("/w154/", "/w500/").replace("/w342/", "/w500/") : null);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, px, py, pw, ph, 36);
  ctx.fillStyle = `hsl(${hue} 60% 40%)`;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 36);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, px, py, pw, ph);
  } else {
    const g = ctx.createLinearGradient(px, py, px + pw, py + ph);
    g.addColorStop(0, `hsl(${hue} 70% 55%)`);
    g.addColorStop(1, `hsl(${(hue + 50) % 360} 65% 32%)`);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = "#fff";
    ctx.font = "700 120px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("🎬", W / 2, py + ph / 2 + 40);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  let y = py + ph + 120;
  ctx.font = "700 72px Georgia, serif";
  for (const line of wrap(ctx, movie.title, W - 160, 2)) { ctx.fillText(line, W / 2, y); y += 84; }

  if (movie.rating > 0) {
    ctx.font = "64px sans-serif";
    ctx.fillStyle = "#F5B82E";
    ctx.fillText("★".repeat(movie.rating) + "☆".repeat(5 - movie.rating), W / 2, y + 20);
    y += 100;
  }
  if (movie.myTake && TAKE_TEXT[movie.myTake]) {
    ctx.font = "600 48px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(TAKE_TEXT[movie.myTake], W / 2, y + 10);
    y += 80;
  }
  if (movie.review) {
    ctx.font = "italic 44px Georgia, serif";
    ctx.fillStyle = "rgba(255,255,255,.9)";
    for (const line of wrap(ctx, `“${movie.review}”`, W - 200, 3)) { ctx.fillText(line, W / 2, y + 10); y += 58; }
  }

  const where = [movie.venueName, movie.date && new Date(movie.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · ");
  ctx.font = "40px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.fillText(where, W / 2, H - 150);
  ctx.font = "600 36px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.fillText("🎬 Movie Nights · Expense Ledger", W / 2, H - 90);
  return c;
}

// Share as an image where the phone supports it; otherwise download it.
export async function shareMovieCard(movie) {
  const canvas = await drawMovieCard(movie);
  let blob;
  try {
    blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  } catch {
    blob = null; // a poster without CORS would taint the canvas
  }
  if (!blob) {
    // Redraw without the poster image, which is what blocked the export.
    const fallback = await drawMovieCard(movie, { noPoster: true });
    blob = await new Promise((r) => fallback.toBlob(r, "image/png"));
  }
  const name = `${movie.title.replace(/[^\w]+/g, "-").toLowerCase()}.png`;
  return shareOrDownload(blob, name, movie.title, `${movie.title}${movie.rating ? ` — ${"★".repeat(movie.rating)}` : ""}`);
}

async function shareOrDownload(blob, name, title, text) {
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}

// "My 2026 in movies" story card from yearRecap().
export function drawYearCard(r) {
  const W = 1080, H = 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2B1055"); bg.addColorStop(0.55, "#7A3E56"); bg.addColorStop(1, "#E8731F");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.fillStyle = "#fff";
  ctx.font = "600 56px Georgia, serif"; ctx.fillText(`My ${r.year} in movies`, W / 2, 230);
  ctx.font = "800 260px Georgia, serif"; ctx.fillText(String(r.viewings), W / 2, 520);
  ctx.font = "500 52px sans-serif"; ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.fillText(r.viewings === 1 ? "movie" : "movies", W / 2, 640);
  const rows = [
    r.hours ? ["⏱️", `${r.hours} hours watched`] : null,
    [r.theatre ? "🍿" : "📺", [r.theatre && `${r.theatre} in theatres`, r.streamed && `${r.streamed} streamed`].filter(Boolean).join(" · ")],
    r.topRated ? ["⭐", `Favourite: ${r.topRated.title}`] : null,
    r.topLanguage ? ["🌏", `Mostly ${r.topLanguage}`] : null,
    r.favTheatre ? ["🏟️", `Home theatre: ${r.favTheatre}`] : null,
    r.topCompanion ? ["👥", `Most watched with ${r.topCompanion}`] : null,
  ].filter(Boolean).slice(0, 6);
  ctx.font = "500 50px sans-serif"; ctx.fillStyle = "#fff";
  rows.forEach(([e, t], i) => {
    let line = `${e}  ${t}`;
    while (ctx.measureText(line).width > W - 140 && line.length > 10) line = line.slice(0, -2);
    if (line !== `${e}  ${t}`) line = line.trimEnd() + "…";
    ctx.fillText(line, W / 2, 820 + i * 120);
  });
  ctx.font = "600 36px sans-serif"; ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.fillText("🎬 Movie Nights · Expense Ledger", W / 2, H - 100);
  return c;
}

export async function shareYearCard(r) {
  const canvas = drawYearCard(r);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  return shareOrDownload(blob, `my-${r.year}-in-movies.png`, `My ${r.year} in movies`, `${r.viewings} movies in ${r.year} 🎬`);
}
