import { describe, it, expect, vi, afterEach } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const m = await import("../lib/movieApis");
const { default: handler } = await import("../pages/api/data");
const { clearTmdbMemory } = await import("../lib/tmdb");

async function call(method, { query = {}, body } = {}) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method, query, body, headers: {} }, res);
  return out;
}
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearTmdbMemory(); });

describe("parsers", () => {
  it("OMDb ratings", () => {
    const r = m.shapeOmdb({ Response: "True", imdbID: "tt1", imdbRating: "8.1", imdbVotes: "1,234", Metascore: "70", Awards: "N/A",
      Ratings: [{ Source: "Internet Movie Database", Value: "8.1/10" }, { Source: "Rotten Tomatoes", Value: "92%" }] });
    expect(r).toMatchObject({ imdb: 8.1, rottenTomatoes: "92%", metacritic: 70, awards: null, imdbUrl: "https://www.imdb.com/title/tt1/" });
    expect(m.shapeOmdb({ Response: "False" })).toBe(null);
  });

  it("Wikidata: budget vs worldwide box office in the same currency → verdict", () => {
    const inr = "http://www.wikidata.org/entity/Q80524", usd = "http://www.wikidata.org/entity/Q4917";
    const r = m.shapeWikidata({ results: { bindings: [
      { budget: { value: "2500000000" }, budgetUnit: { value: inr }, box: { value: "6500000000" }, boxUnit: { value: inr }, article: { value: "https://en.wikipedia.org/wiki/Baahubali_2:_The_Conclusion" } },
      { budget: { value: "2500000000" }, budgetUnit: { value: inr }, box: { value: "18000000000" }, boxUnit: { value: inr } },
      { box: { value: "20000000" }, boxUnit: { value: usd } },
    ] } });
    expect(r.budget).toEqual({ amount: 2500000000, currency: "₹" });
    expect(r.boxOffice).toEqual({ amount: 18000000000, currency: "₹" });
    expect(r.verdict).toEqual({ ratio: 7.2, label: "Blockbuster" });
    expect(r.title).toBe("Baahubali 2: The Conclusion");
    expect(m.shapeWikidata({ results: { bindings: [] } })).toBe(null);
  });

  it("fanart.tv prefers English art", () => {
    expect(m.shapeFanart({ hdmovielogo: [{ url: "te.png", lang: "te" }, { url: "en.png", lang: "en" }], moviebackground: [{ url: "bg.jpg", lang: "" }] }))
      .toEqual({ logo: "en.png", background: "bg.jpg" });
    expect(m.shapeFanart({})).toBe(null);
  });

  it("OpenSubtitles languages, most first", () => {
    expect(m.shapeSubtitles({ data: [{ attributes: { language: "en" } }, { attributes: { language: "te" } }, { attributes: { language: "en" } }] }))
      .toEqual([{ code: "en", name: "English", count: 2 }, { code: "te", name: "Telugu", count: 1 }]);
  });

  it("YouTube videos, entities decoded", () => {
    const v = m.shapeYoutube({ items: [{ id: { videoId: "abc" }, snippet: { title: "Pushpa 2 &#39;Review&#39;", channelTitle: "Ch", thumbnails: { medium: { url: "t.jpg" } } } }, { id: {} }] });
    expect(v).toEqual([{ id: "abc", title: "Pushpa 2 'Review'", channel: "Ch", thumb: "t.jpg", url: "https://www.youtube.com/watch?v=abc" }]);
  });

  it("TVmaze next episode", () => {
    expect(m.shapeTvmaze({ network: { name: "HBO" }, status: "Running", url: "u" }, { airstamp: "2026-11-24T02:00:00+00:00", season: 2, number: 5, name: "X" }))
      .toEqual({ network: "HBO", status: "Running", url: "u", next: { airstamp: "2026-11-24T02:00:00+00:00", season: 2, episode: 5, name: "X" } });
  });

  it("Trakt history with ratings → takes", () => {
    const movies = m.traktToMovies(
      [{ id: 9, watched_at: "2026-10-01T18:00:00.000Z", movie: { title: "RRR", year: 2022, ids: { trakt: 1, tmdb: 579974 } } },
        { id: 10, watched_at: "2026-10-02T18:00:00.000Z", movie: { title: "Unrated", ids: { trakt: 2 } } }],
      [{ rating: 9, movie: { ids: { trakt: 1 } } }],
    );
    expect(movies).toEqual([
      { traktHistoryId: 9, title: "RRR", year: 2022, tmdbId: 579974, date: "2026-10-01", myTake: "loved" },
      { traktHistoryId: 10, title: "Unrated", year: null, tmdbId: null, date: "2026-10-02", myTake: "" },
    ]);
  });
});

describe("through the API", () => {
  it("lists which sources are on: keyless ones always, others only with a key", async () => {
    vi.stubEnv("OMDB_API_KEY", "k");
    const r = (await call("GET", { query: { type: "movie-sources" } })).body.sources;
    expect(r).toMatchObject({ omdb: true, fanart: false, youtube: false, wikipedia: true, tvmaze: true });
  });

  it("movie extras: only configured sources are called, failures don't break the rest", async () => {
    vi.stubEnv("OMDB_API_KEY", "k");
    const seen = [];
    vi.stubGlobal("fetch", vi.fn((url) => {
      const u = String(url);
      seen.push(new URL(u).host);
      if (u.includes("omdbapi")) return json({ Response: "True", imdbID: "tt0000001", imdbRating: "7.5", Ratings: [] });
      if (u.includes("wikidata")) return json({}, 503);
      return json({}, 404);
    }));
    const r = (await call("GET", { query: { type: "movie-extras", tmdbId: "5", imdbId: "tt0000001", title: "X", year: "2024" } })).body;
    expect(r.ratings.imdb).toBe(7.5);
    expect(r.wiki).toBe(null);
    expect(r.art).toBe(null);
    expect(seen).not.toContain("webservice.fanart.tv");
    expect(seen).not.toContain("www.googleapis.com");
  });

  it("Trakt import adds movies and watchlist once, skipping films already logged", async () => {
    vi.stubEnv("TRAKT_CLIENT_ID", "cid");
    await call("POST", { body: { type: "movies", title: "Already here", date: "2026-10-03", ticketPrice: 200, myTake: "liked", publicTake: "liked" } });
    vi.stubGlobal("fetch", vi.fn((url) => {
      const u = String(url);
      if (u.includes("/history/movies")) return json([
        { id: 1, watched_at: "2026-10-01T10:00:00Z", movie: { title: "RRR", ids: { trakt: 1, tmdb: 579974 } } },
        { id: 2, watched_at: "2026-10-04T10:00:00Z", movie: { title: "Already here", ids: { trakt: 2 } } },
      ]);
      if (u.includes("/ratings/movies")) return json([{ rating: 8, movie: { ids: { trakt: 1 } } }]);
      if (u.includes("/watchlist/movies")) return json([{ movie: { title: "Kalki", ids: { tmdb: 801688 } } }]);
      return json({}, 404);
    }));
    const first = (await call("POST", { body: { type: "trakt-import", username: "me" } })).body;
    expect(first).toEqual({ movies: 1, watchlist: 1, skipped: 1 });
    const again = (await call("POST", { body: { type: "trakt-import", username: "me" } })).body;
    expect(again).toEqual({ movies: 0, watchlist: 0, skipped: 2 });
    const rrr = (await fake`SELECT my_take, venue_type, affects_balance FROM movies WHERE title = 'RRR'`)[0];
    expect(rrr).toEqual({ my_take: "liked", venue_type: "OTT", affects_balance: false });
  });

  it("a private or missing Trakt profile says so", async () => {
    vi.stubEnv("TRAKT_CLIENT_ID", "cid");
    vi.stubGlobal("fetch", vi.fn(() => json({}, 404)));
    const r = await call("POST", { body: { type: "trakt-import", username: "nobody" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/public/);
  });
});
