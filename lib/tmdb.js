// Everything the app asks TMDB (themoviedb.org). Server-only: it needs the
// TMDB_API_KEY env var (a v3 key or a v4 "eyJ…" read token). Results are
// cached — in memory for searches/lists, and in the database for movie and
// show details — so pages and the daily cron don't hammer the API.
//
// This product uses the TMDB API but is not endorsed or certified by TMDB.
import { getCache, setCache } from "./db";

export const hasTmdb = () => !!process.env.TMDB_API_KEY;

export async function tmdb(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  const isBearer = apiKey.startsWith("eyJ");
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (!isBearer) url.searchParams.set("api_key", apiKey);
  const r = await fetch(url, { headers: isBearer ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

const IMG = "https://image.tmdb.org/t/p";
const img = (path, size) => (path ? `${IMG}/${size}${path}` : null);

// TMDB genre ids → the app's genre list.
const TMDB_GENRES = {
  28: "Action", 12: "Action", 10752: "Action", 37: "Action", 16: "Animation", 35: "Comedy", 10751: "Comedy",
  80: "Thriller", 53: "Thriller", 9648: "Thriller", 99: "Documentary", 18: "Drama", 36: "Drama",
  27: "Horror", 10749: "Romance", 878: "Sci-Fi", 14: "Sci-Fi",
};
export const LANGS = { te: "Telugu", ta: "Tamil", hi: "Hindi", ml: "Malayalam", kn: "Kannada", en: "English", bn: "Bengali", mr: "Marathi", ko: "Korean", ja: "Japanese", pa: "Punjabi", gu: "Gujarati" };
export const LANG_CODES = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [v, k]));

// The crowd's verdict from TMDB's audience score (only with enough votes).
export function crowdTake(avg, votes) {
  if (!votes || votes < 15 || !avg) return "";
  return avg >= 7.5 ? "loved" : avg >= 6.5 ? "liked" : avg >= 5.5 ? "okay" : "disliked";
}

export function shapeMovie(m) {
  return {
    tmdbId: m.id,
    title: m.title || m.original_title,
    year: (m.release_date || "").slice(0, 4),
    releaseDate: m.release_date || "",
    poster: img(m.poster_path, "w154"),
    genre: (m.genre_ids || []).map((g) => TMDB_GENRES[g]).find(Boolean) || "",
    rating: m.vote_count >= 15 ? Math.round(m.vote_average * 10) / 10 : null,
    votes: m.vote_count || 0,
    crowdTake: crowdTake(m.vote_average, m.vote_count),
    language: LANGS[m.original_language] || "",
    overview: (m.overview || "").slice(0, 220),
  };
}

// ---- in-memory cache for lists and searches ----
const mem = new Map();
// For tests: forget everything cached in this server instance.
export function clearTmdbMemory() {
  mem.clear();
}
const HOUR = 3600 * 1000;
async function memo(key, ttl, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  if (mem.size > 800) mem.clear();
  mem.set(key, { at: Date.now(), value });
  return value;
}
// ---- database cache for details (survives cold starts, shared by crons) ----
export async function cached(key, ttl, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const row = await getCache(key).catch(() => null);
  if (row && Date.now() - new Date(row.fetched_at).getTime() < ttl) {
    const value = JSON.parse(row.data);
    mem.set(key, { at: new Date(row.fetched_at).getTime(), value });
    return value;
  }
  const value = await fn();
  mem.set(key, { at: Date.now(), value });
  await setCache(key, JSON.stringify(value)).catch(() => {});
  return value;
}

export async function searchMovies(q) {
  return memo(`search:${q.toLowerCase()}`, 6 * HOUR, async () => {
    const d = await tmdb("/search/movie", { query: q, include_adult: "false", region: "IN" });
    return (d.results || []).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 7).map(shapeMovie);
  });
}

const withPosters = (list, n = 12) => (list.results || []).filter((m) => m.poster_path).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, n).map(shapeMovie);

export async function nowShowing() {
  return memo("now-showing", 6 * HOUR, async () => {
    const [now, soon] = await Promise.all([
      tmdb("/movie/now_playing", { region: "IN", page: 1 }),
      tmdb("/movie/upcoming", { region: "IN", page: 1 }),
    ]);
    return { nowPlaying: withPosters(now), upcoming: withPosters(soon) };
  });
}

export async function trending() {
  return memo("trending", 6 * HOUR, async () => withPosters(await tmdb("/trending/movie/week", {}), 15));
}

const isoDaysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
// Recent and upcoming releases in one language (e.g. "New in Telugu").
export async function newInLanguage(code) {
  if (!LANGS[code]) return [];
  return memo(`lang:${code}`, 6 * HOUR, async () => withPosters(await tmdb("/discover/movie", {
    with_original_language: code, region: "IN", sort_by: "popularity.desc",
    "primary_release_date.gte": isoDaysFromNow(-60), "primary_release_date.lte": isoDaysFromNow(45),
  }), 15));
}

function providersOf(block) {
  const inProv = block?.results?.IN || {};
  const list = (arr) => (arr || []).map((p) => ({ name: p.provider_name, logo: img(p.logo_path, "w92") }));
  return { stream: list(inProv.flatrate), free: list(inProv.free || inProv.ads), rent: list(inProv.rent), buy: list(inProv.buy), link: inProv.link || null };
}

function shapeDetails(d) {
  const inRel = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === "IN")?.release_dates || [];
  const firstOf = (types) => inRel.filter((r) => types.includes(r.type)).map((r) => r.release_date.slice(0, 10)).sort()[0] || "";
  const vids = (d.videos?.results || []).filter((v) => v.site === "YouTube");
  const trailer = vids.find((v) => v.type === "Trailer" && v.official) || vids.find((v) => v.type === "Trailer") || vids.find((v) => v.type === "Teaser");
  return {
    tmdbId: d.id,
    imdbId: d.imdb_id || "",
    title: d.title || d.original_title,
    year: (d.release_date || "").slice(0, 4),
    releaseDate: d.release_date || "",
    indiaRelease: firstOf([3, 2]) || d.release_date || "",
    digitalRelease: firstOf([4]),
    runtime: d.runtime || 0,
    poster: img(d.poster_path, "w342"),
    backdrop: img(d.backdrop_path, "w780"),
    genres: (d.genres || []).map((g) => g.name),
    genre: (d.genres || []).map((g) => TMDB_GENRES[g.id]).find(Boolean) || "",
    language: LANGS[d.original_language] || "",
    rating: d.vote_count >= 15 ? Math.round(d.vote_average * 10) / 10 : null,
    votes: d.vote_count || 0,
    crowdTake: crowdTake(d.vote_average, d.vote_count),
    overview: d.overview || "",
    tagline: d.tagline || "",
    directors: (d.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name).slice(0, 2),
    directorPeople: (d.credits?.crew || []).filter((c) => c.job === "Director").slice(0, 2).map((c) => ({ id: c.id, name: c.name })),
    cast: (d.credits?.cast || []).slice(0, 8).map((c) => ({ id: c.id, name: c.name, character: c.character || "", photo: img(c.profile_path, "w185") })),
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    providers: providersOf(d["watch/providers"]),
    collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null,
    recommendations: (d.recommendations?.results || []).filter((m) => m.poster_path).slice(0, 12).map(shapeMovie),
  };
}

// Full details for one movie, cached for a day (streaming availability changes).
export async function movieDetails(id) {
  return cached(`movie:${id}`, 24 * HOUR, async () => shapeDetails(await tmdb(`/movie/${id}`, {
    append_to_response: "credits,videos,watch/providers,release_dates,recommendations",
  })));
}

// A franchise ("Baahubali Collection") with its released films in order.
export async function collection(id) {
  return cached(`collection:${id}`, 7 * 24 * HOUR, async () => {
    const d = await tmdb(`/collection/${id}`, {});
    return {
      id: d.id, name: d.name,
      parts: (d.parts || []).filter((p) => p.release_date).sort((a, b) => a.release_date.localeCompare(b.release_date)).map(shapeMovie),
    };
  });
}

// Best TMDB match for a movie logged before ids were stored: exact title
// first, released no later than the year it was watched, most popular.
export async function matchMovie(title, watchedYear) {
  const results = await searchMovies(title);
  const exact = results.filter((m) => m.title.toLowerCase() === title.trim().toLowerCase());
  const pool = (exact.length ? exact : results).filter((m) => !watchedYear || !m.year || Number(m.year) <= Number(watchedYear));
  return pool[0] || null;
}

// ---- TV shows ----
function shapeTv(t) {
  return {
    tmdbId: t.id,
    title: t.name || t.original_name,
    year: (t.first_air_date || "").slice(0, 4),
    poster: img(t.poster_path, "w154"),
    rating: t.vote_count >= 15 ? Math.round(t.vote_average * 10) / 10 : null,
    language: LANGS[t.original_language] || "",
    overview: (t.overview || "").slice(0, 220),
  };
}
export async function searchTv(q) {
  return memo(`tvsearch:${q.toLowerCase()}`, 6 * HOUR, async () => {
    const d = await tmdb("/search/tv", { query: q, include_adult: "false" });
    return (d.results || []).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 7).map(shapeTv);
  });
}
export async function tvDetails(id) {
  return cached(`tv:${id}`, 12 * HOUR, async () => {
    const d = await tmdb(`/tv/${id}`, { append_to_response: "watch/providers" });
    const seasons = (d.seasons || []).filter((s) => s.season_number > 0).map((s) => ({ number: s.season_number, episodes: s.episode_count || 0, airDate: s.air_date || "" }));
    const nx = d.next_episode_to_air;
    return {
      ...shapeTv(d),
      poster: img(d.poster_path, "w342"),
      backdrop: img(d.backdrop_path, "w780"),
      status: d.status || "",
      seasons,
      nextEpisode: nx ? { airDate: nx.air_date, season: nx.season_number, episode: nx.episode_number, name: nx.name || "" } : null,
      providers: providersOf(d["watch/providers"]),
      episodeRuntime: (d.episode_run_time || [])[0] || 0,
    };
  });
}

// ---- People you follow ----
// A person's films (as a lead actor — top 6 billed — or director), newest
// first, cached for a day. Used for "new film by someone you follow".
export async function personMovies(id) {
  return cached(`person:${id}`, 24 * HOUR, async () => {
    const d = await tmdb(`/person/${id}/movie_credits`, {});
    const lead = (d.cast || []).filter((c) => c.order == null || c.order <= 5);
    const directed = (d.crew || []).filter((c) => c.job === "Director");
    const seen = new Set();
    return [...lead, ...directed]
      .filter((m) => (seen.has(m.id) ? false : seen.add(m.id)))
      .map((m) => ({ tmdbId: m.id, title: m.title || m.original_title, releaseDate: m.release_date || "", poster: img(m.poster_path, "w154") }))
      .sort((a, b) => (b.releaseDate || "9999").localeCompare(a.releaseDate || "9999"));
  });
}

// Films by a followed person that are out (or out soon) and not yet
// announced to you: released in the last week or due in the next 45 days.
export function freshReleases(films, todayIso, notifiedIds = []) {
  const from = new Date(new Date(todayIso + "T00:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date(new Date(todayIso + "T00:00:00Z").getTime() + 45 * 86400000).toISOString().slice(0, 10);
  const done = new Set(notifiedIds.map(String));
  return films.filter((f) => f.releaseDate && f.releaseDate >= from && f.releaseDate <= to && !done.has(String(f.tmdbId)))
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
}
