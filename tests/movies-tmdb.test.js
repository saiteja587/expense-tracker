// TMDB-powered routes and the watchlist alerts, end to end against a real
// (in-process) Postgres with TMDB and push notifications faked.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const pushes = [];
vi.mock("../lib/push", () => ({ sendToUser: async (uid, p) => { pushes.push({ uid, ...p }); return { sent: 1 }; } }));
process.env.TMDB_API_KEY = "test-key";
process.env.CRON_SECRET = "cron-test";

// A tiny TMDB: Kalki (in theatres, on Prime later), Baahubali 1 & 2, a show.
let primeHasKalki = false;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const movie = (id, title, extra = {}) => ({ id, title, release_date: "2015-07-10", poster_path: `/p${id}.jpg`, genre_ids: [28], vote_average: 8, vote_count: 500, original_language: "te", popularity: 10, overview: "", ...extra });
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const path = u.pathname.replace("/3", "");
    const ok = (body) => ({ ok: true, json: async () => body });
    if (path === "/search/movie") {
      const q = u.searchParams.get("query").toLowerCase();
      if (q.includes("baahubali 2")) return ok({ results: [movie(2, "Baahubali 2: The Conclusion", { release_date: "2017-04-28" })] });
      if (q.includes("baahubali")) return ok({ results: [movie(1, "Baahubali: The Beginning")] });
      if (q.includes("kalki")) return ok({ results: [movie(5, "Kalki 2898 AD", { release_date: "2024-06-27" })] });
      if (q.includes("game changer")) return ok({ results: [movie(6, "Game Changer", { release_date: tomorrow })] });
      return ok({ results: [] });
    }
    if (path === "/movie/now_playing" || path === "/movie/upcoming" || path === "/trending/movie/week") return ok({ results: [movie(5, "Kalki 2898 AD")] });
    const m = path.match(/^\/movie\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      const base = { 1: movie(1, "Baahubali: The Beginning"), 2: movie(2, "Baahubali 2: The Conclusion", { release_date: "2017-04-28" }), 5: movie(5, "Kalki 2898 AD"), 6: movie(6, "Game Changer", { release_date: tomorrow }), 50: movie(50, "Salaar") }[id];
      return ok({
        ...base, runtime: 150, genres: [{ id: 28, name: "Action" }], tagline: "",
        belongs_to_collection: id <= 2 ? { id: 99, name: "Baahubali Collection" } : null,
        credits: { cast: [{ name: "Prabhas", character: "Hero", profile_path: null }], crew: [{ job: "Director", name: "S. S. Rajamouli" }] },
        videos: { results: [{ site: "YouTube", type: "Trailer", official: true, key: "abc123" }] },
        "watch/providers": { results: { IN: { flatrate: id === 5 && primeHasKalki ? [{ provider_name: "Amazon Prime Video", logo_path: "/l.png" }] : [], link: "https://tmdb/x" } } },
        release_dates: { results: id === 6 ? [{ iso_3166_1: "IN", release_dates: [{ type: 3, release_date: `${tomorrow}T00:00:00.000Z` }] }] : [] },
        recommendations: { results: id === 1 ? [movie(2, "Baahubali 2: The Conclusion"), movie(50, "Salaar")] : [] },
      });
    }
    if (path === "/collection/99") return ok({ id: 99, name: "Baahubali Collection", parts: [movie(1, "Baahubali: The Beginning"), movie(2, "Baahubali 2: The Conclusion", { release_date: "2017-04-28" })] });
    if (path === "/search/tv") return ok({ results: [{ id: 700, name: "Panchayat", first_air_date: "2020-04-03", poster_path: "/t.jpg", vote_average: 9, vote_count: 300, original_language: "hi", popularity: 5 }] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
});
afterAll(() => { globalThis.fetch = realFetch; });

const { default: handler } = await import("../pages/api/data");
const { default: cron } = await import("../pages/api/cron-daily-notifications");
const db = await import("../lib/db");

async function call(h, method, { query = {}, body, headers = {} } = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await h({ method, query, body, headers }, res);
  return out;
}
const get = (type, q = {}) => call(handler, "GET", { query: { type, ...q } });
const post = (body) => call(handler, "POST", { body });

describe("TMDB features", () => {
  it("movie details: trailer, director, cast, franchise", async () => {
    const d = (await get("movie-details", { id: "1" })).body.details;
    expect(d).toMatchObject({ title: "Baahubali: The Beginning", runtime: 150, directors: ["S. S. Rajamouli"], trailer: "https://www.youtube.com/watch?v=abc123" });
    expect(d.collectionParts.map((p) => p.title)).toEqual(["Baahubali: The Beginning", "Baahubali 2: The Conclusion"]);
    expect((await get("movie-details", { title: "Kalki" })).body.details.tmdbId).toBe(5);
  });

  it("movie-meta matches old movies to TMDB once, and stores the id", async () => {
    await post({ type: "movies", title: "Baahubali", date: "2016-01-01", myTake: "loved", rating: 5, publicTake: "liked", ticketPrice: 100 });
    await post({ type: "movies", title: "Some home video", date: "2026-01-01", myTake: "okay", publicTake: "" });
    const r = (await get("movie-meta")).body;
    expect(r.pending).toBe(0);
    expect(Object.keys(r.meta)).toEqual(["1"]);
    expect(r.collections[99].name).toBe("Baahubali Collection");
    const rows = await fake`SELECT title, tmdb_id FROM movies ORDER BY id`;
    expect(rows.map((x) => x.tmdb_id)).toEqual([1, 0]); // 0 = no match, not searched again
  });

  it("recommendations skip what you've seen or saved", async () => {
    const r = (await get("recommendations")).body.results;
    expect(r.map((x) => x.title)).toEqual(["Baahubali 2: The Conclusion", "Salaar"]);
    expect(r[0].because).toBe("Baahubali: The Beginning");
    await post({ type: "watchlist", title: "Salaar", tmdbId: 50 });
    expect((await get("recommendations")).body.results.map((x) => x.title)).toEqual(["Baahubali 2: The Conclusion"]);
  });

  it("watchlist-info finds ids, release dates and streaming apps", async () => {
    await post({ type: "watchlist", title: "Kalki 2898 AD" });
    const items = (await get("watchlist-info")).body.items;
    const kalki = Object.values(items).find((i) => i.tmdbId === 5);
    expect(kalki).toMatchObject({ inTheatres: true, stream: [] });
  });

  it("TV: search and track shows per person", async () => {
    expect((await get("tv-search", { q: "panch" })).body.results[0]).toMatchObject({ tmdbId: 700, title: "Panchayat", language: "Hindi" });
    const { show } = (await post({ type: "tv-show", tmdbId: 700, title: "Panchayat", platform: "Prime Video" })).body;
    await call(handler, "PUT", { body: { type: "tv-show", id: show.id, status: "watching", season: 2, episode: 5, platform: "Prime Video" } });
    const list = (await get("tv-shows")).body.shows;
    expect(list[0]).toMatchObject({ title: "Panchayat", season: 2, episode: 5 });
    expect(await db.listTvShows(999)).toEqual([]);
  });
});

describe("watchlist alerts (daily cron)", () => {
  it("reminds the day before release, once", async () => {
    await post({ type: "watchlist", title: "Game Changer", tmdbId: 6 });
    pushes.length = 0;
    await call(cron, "GET", { headers: { authorization: "Bearer cron-test" } });
    expect(pushes.some((p) => p.title === "🎟️ Game Changer releases tomorrow" && p.url === "/movies?book=6")).toBe(true);
    pushes.length = 0;
    await call(cron, "GET", { headers: { authorization: "Bearer cron-test" } });
    expect(pushes.some((p) => p.title.includes("Game Changer releases"))).toBe(false);
  });

  it("alerts when a watchlist movie starts streaming (not on the first look)", async () => {
    // Earlier runs recorded "not streaming". Now Prime gets Kalki.
    primeHasKalki = true;
    const { clearTmdbMemory } = await import("../lib/tmdb");
    clearTmdbMemory();
    await fake`DELETE FROM tmdb_cache WHERE key = 'movie:5'`;
    pushes.length = 0;
    await call(cron, "GET", { headers: { authorization: "Bearer cron-test" } });
    expect(pushes.find((p) => p.title.startsWith("📺 Kalki 2898 AD is now on"))).toMatchObject({ url: "/movies?details=5" });
  });
});
