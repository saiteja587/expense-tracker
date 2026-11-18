// A movie poster: the real one from TMDB when the server has a TMDB_API_KEY,
// otherwise a generated tile (title-derived gradient + initials) so the
// movie diary still looks like a poster wall.
import { useEffect, useState } from "react";

const CACHE_KEY = "posterCache_v1";
const memory = (() => {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
})();
const inflight = {};

function remember(key, url) {
  memory[key] = url;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(memory)); } catch { /* full */ }
}

async function lookup(title) {
  const key = title.trim().toLowerCase();
  if (key in memory) return memory[key];
  inflight[key] = inflight[key] || fetch(`/api/data?type=poster&title=${encodeURIComponent(title)}`)
    .then((r) => (r.ok ? r.json() : { url: null }))
    .then((d) => { remember(key, d.url || null); return d.url || null; })
    .catch(() => null);
  return inflight[key];
}

function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export default function Poster({ title, width = 56, radius = 10 }) {
  const key = title.trim().toLowerCase();
  const [url, setUrl] = useState(memory[key]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!(key in memory)) lookup(title).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [key, title]);

  const height = Math.round(width * 1.5);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={`${title} poster`} width={width} height={height} loading="lazy" onError={() => setFailed(true)}
        style={{ width, height, objectFit: "cover", borderRadius: radius, flexShrink: 0, boxShadow: "var(--shadow-md)", background: "var(--surface-2)" }} />
    );
  }
  const h = hue(key);
  const initials = title.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div aria-hidden="true" style={{
      width, height, borderRadius: radius, flexShrink: 0, boxShadow: "var(--shadow-md)", color: "#fff",
      background: `linear-gradient(160deg, hsl(${h} 70% 55%), hsl(${(h + 50) % 360} 65% 32%))`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Lora', Georgia, serif", fontWeight: 700, fontSize: Math.round(width * 0.36), letterSpacing: "0.02em",
    }}>
      {initials || "🎬"}
    </div>
  );
}
