// Movie type-ahead and "now showing": shaped TMDB results, mapped genres,
// and the crowd's verdict from the audience score. TMDB itself is faked.
import { describe, it, expect, vi, afterAll } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
process.env.TMDB_API_KEY = "test-key";

const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const u = new URL(String(url));
  const movie = (id, title, extra) => ({ id, title, release_date: "2024-06-27", poster_path: `/p${id}.jpg`, genre_ids: [878, 28], vote_average: 7.9, vote_count: 900, original_language: "te", popularity: 50, overview: "x", ...extra });
  let results = [];
  if (u.pathname.endsWith("/search/movie")) {
    results = [
      movie(1, "Kalki 2898 AD"),
      movie(2, "Kalki", { vote_average: 5.1, vote_count: 40, popularity: 5, genre_ids: [18], original_language: "ta" }),
      movie(3, "Kalki obscure", { vote_count: 3, popularity: 1, poster_path: null }),
    ];
  } else if (u.pathname.endsWith("/now_playing") || u.pathname.endsWith("/upcoming")) {
    results = [movie(9, "Now One"), movie(10, "No Poster", { poster_path: null })];
  }
  return { ok: true, json: async () => ({ results }) };
};
afterAll(() => { globalThis.fetch = realFetch; });

const { default: handler } = await import("../pages/api/data");
async function get(query) {
  const out = {};
  const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ method: "GET", query, headers: {} }, res);
  return out;
}

describe("movie search", () => {
  it("returns shaped matches, most popular first, with genre and crowd take", async () => {
    const r = await get({ type: "movie-search", q: "kalki" });
    expect(r.status).toBe(200);
    const [first, second, third] = r.body.results;
    expect(first).toMatchObject({ tmdbId: 1, title: "Kalki 2898 AD", year: "2024", genre: "Sci-Fi", rating: 7.9, crowdTake: "loved", language: "Telugu" });
    expect(first.poster).toContain("/w154/p1.jpg");
    expect(second).toMatchObject({ genre: "Drama", crowdTake: "disliked", language: "Tamil" });
    expect(third).toMatchObject({ rating: null, crowdTake: "", poster: null }); // too few votes to judge
  });

  it("caches searches and ignores one-letter queries", async () => {
    const before = calls.length;
    await get({ type: "movie-search", q: "KALKI" });
    expect(calls.length).toBe(before);
    expect((await get({ type: "movie-search", q: "k" })).body.results).toEqual([]);
    expect(calls.length).toBe(before);
  });

  it("now showing keeps only movies with posters", async () => {
    const r = await get({ type: "now-showing" });
    expect(r.body.nowPlaying.map((m) => m.title)).toEqual(["Now One"]);
    expect(r.body.upcoming).toHaveLength(1);
    expect(calls.some((c) => c.includes("region=IN"))).toBe(true);
  });
});
