import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";
import {
  starsOf, pickTonight, cheapestWay, snackStats, passValue, heatmap, peopleStats, rewatches, onThisDay,
  rankFilms, nextDuel, makeQuiz, tasteMatch, bookingOverBudget, parseMovieCsv,
} from "../lib/movieLab";
import { mapExpense, mapMovie } from "../lib/ledger";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const pushes = [];
vi.mock("../lib/push", () => ({ sendToUser: async (uid, p) => { pushes.push({ uid, ...p }); return { sent: 1 }; } }));
const today = "2026-11-24";
const mv = (o) => ({ id: 1, title: "A", date: "2026-11-01", venueType: "Theatre", venueName: "PVR", ticketPrice: 200, canteenPrice: 100, quantity: 1, rating: 0, myTake: "", ...o });
const seeded = () => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

describe("choosing", () => {
  const film = (id, o = {}) => ({ tmdbId: id, title: `F${id}`, rating: 7, runtime: 120, genres: ["Comedy"], providers: { stream: [{ name: "Netflix" }] }, ...o });
  it("tonight: only unseen films on your apps that fit mood, time and company", () => {
    const films = [film(1), film(2, { rating: 8 }), film(3, { saved: true }), film(4, { runtime: 190 }), film(5, { genres: ["Horror", "Comedy"] }), film(6, { providers: { stream: [{ name: "MUBI" }] } }), film(7, { genres: ["Drama"] }), film(8)];
    const r = pickTonight({ films, apps: new Set(["netflix"]), mood: "laugh", maxMinutes: 130, company: "family", seenIds: new Set([8]) });
    expect(r.map((f) => f.tmdbId)).toEqual([3, 2, 1]);
    expect(r[0].on).toEqual(["Netflix"]);
  });
  it("cheapest way: what you have first, known prices, then unknown", () => {
    const providers = { stream: [{ name: "Amazon Prime Video" }], free: [], rent: [{ name: "Apple TV" }, { name: "Google Play Movies" }], buy: [] };
    const r = cheapestWay({ providers, apps: new Set(), prices: [{ name: "Apple TV", rent: 120 }], nightOut: 350, inTheatres: true, people: 2 });
    expect(r.map((o) => [o.how, o.cost])).toEqual([["Rent on Apple TV", 120], ["Theatre for 2", 700], ["Rent on Google Play Movies", null]]);
    expect(cheapestWay({ providers, apps: new Set(["prime"]), prices: [] })[0]).toMatchObject({ how: "Stream on Amazon Prime Video", cost: 0 });
  });
});

describe("money", () => {
  it("snacks vs tickets", () => {
    const s = snackStats([mv(), mv({ id: 2, venueName: "AMB", canteenPrice: 300 }), mv({ id: 3, venueType: "OTT" })], today);
    expect(s).toMatchObject({ tickets: 400, snacks: 400, pct: 50 });
    expect(s.theatres[0]).toEqual({ name: "AMB", visits: 1, perVisit: 300 });
    expect(snackStats([], today)).toBe(null);
  });
  it("theatre pass: counts at most the covered tickets each month", () => {
    const movies = ["2026-11-02", "2026-11-03", "2026-11-04"].map((date, i) => mv({ id: i, date })); // Mon–Wed
    expect(passValue({ movies, pass: { price: 50, tickets: 2 }, todayIso: today, months: 6 })).toMatchObject({ visits: 3, would: 400, cost: 300, saving: 100, worth: true, breakEven: 1 });
    expect(passValue({ movies: [mv({ date: "2026-11-07" })], pass: { price: 50, tickets: 2, weekdaysOnly: true }, todayIso: today }).visits).toBe(0);
  });
  it("warns only when a booking takes the month over budget", () => {
    expect(bookingOverBudget({ movies: [mv()], budget: 500, date: "2026-11-30", cost: 250 })).toEqual({ spent: 300, after: 550, over: 50 });
    expect(bookingOverBudget({ movies: [mv()], budget: 500, date: "2026-12-01", cost: 250 })).toBe(null);
    expect(bookingOverBudget({ movies: [mv({ id: 9 })], budget: 500, date: "2026-11-30", cost: 400, ignoreId: 9 })).toBe(null);
  });
});

describe("history", () => {
  it("heatmap has every day of the year, Monday first", () => {
    const h = heatmap([mv(), mv({ id: 2 }), mv({ id: 3, date: "2026-11-08" })], 2026, today);
    const cells = h.weeks.flat().filter(Boolean);
    expect(cells.length).toBe(365);
    expect(h.weeks.every((w) => w.length === 7)).toBe(true);
    expect(cells.find((c) => c.date === "2026-11-01").n).toBe(2);
    expect(h).toMatchObject({ total: 3, topDay: "Sun", topMonth: { ym: "2026-11", n: 3 } });
  });
  it("people: films counted once, best needs two ratings", () => {
    const meta = { 1: { directors: ["R"], cast: ["P"] }, 2: { directors: ["R"], cast: ["P"] }, 3: { directors: ["S"], cast: ["P"] } };
    const p = peopleStats([mv({ tmdbId: 1, rating: 5 }), mv({ id: 2, tmdbId: 1, rating: 3 }), mv({ id: 3, tmdbId: 2, myTake: "liked" }), mv({ id: 4, tmdbId: 3 })], meta, today);
    expect(p.actors.most[0]).toMatchObject({ name: "P", count: 3, avg: 4.5 });
    expect(p.directors.best).toMatchObject([{ name: "R", count: 2, avg: 4.5 }]);
  });
  it("rewatches and on this day", () => {
    expect(rewatches([mv(), mv({ id: 2, date: "2025-01-01" }), mv({ id: 3, title: "B" })], today)).toEqual([{ title: "A", times: 2, dates: ["2025-01-01", "2026-11-01"] }]);
    expect(onThisDay([mv({ date: "2024-11-24" }), mv({ id: 2, date: today })], today).map((m) => m.yearsAgo)).toEqual([2]);
  });
});

describe("games", () => {
  it("ranking starts from stars and moves with each choice", () => {
    const movies = [mv({ title: "A", rating: 3 }), mv({ title: "B", rating: 3 }), mv({ title: "C", rating: 5 })];
    expect(rankFilms(movies, [], today).map((f) => f.title)).toEqual(["C", "A", "B"]);
    const duels = [{ winner: "B", loser: "A" }];
    const r = rankFilms(movies, duels, today);
    expect(r.map((f) => f.title)).toEqual(["C", "B", "A"]);
    expect(nextDuel(r, duels, seeded()).map((f) => f.title)).toContain("C"); // not played yet
    expect(nextDuel(r.slice(0, 1))).toBe(null);
  });
  it("quiz: four different options including the answer", () => {
    const meta = {}, movies = [];
    for (let i = 1; i <= 6; i++) { meta[i] = { directors: [`D${i}`], cast: [`X${i}`], releaseDate: `20${10 + i}-01-01` }; movies.push(mv({ id: i, tmdbId: i, title: `F${i}`, rating: (i % 5) + 1, venueName: `V${i}` })); }
    const q = makeQuiz(movies, meta, { rand: seeded(), todayIso: today });
    expect(q.length).toBe(8);
    for (const x of q) { expect(new Set(x.options).size).toBe(4); expect(x.options).toContain(x.answer); }
    expect(makeQuiz(movies.slice(0, 3), meta)).toEqual([]);
  });
  it("taste match", () => {
    expect(tasteMatch([{ title: "A", mine: 5, theirs: 5 }, { title: "B", mine: 5, theirs: 1 }])).toMatchObject({ pct: 50, count: 2, enough: false, both: ["A"], clash: { title: "B" } });
    expect(starsOf({ rating: 0, myTake: "loved" })).toBe(5);
  });
});

describe("CSV exports", () => {
  it("Letterboxd diary, with quoted reviews over lines", () => {
    const r = parseMovieCsv('Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\r\n2026-01-03,"Good, Bad",2020,https://boxd.it/x,4.5,,"Line ""one""\nline two",,2026-01-02\r\n', "reviews.csv");
    expect(r).toMatchObject({ source: "letterboxd", kind: "watched", exactDates: true, skipped: 0 });
    expect(r.items).toEqual([{ title: "Good, Bad", year: "2020", date: "2026-01-02", rating: 5, review: 'Line "one"\nline two' }]);
  });
  it("Letterboxd watchlist by file name; IMDb ratings skip TV", () => {
    expect(parseMovieCsv("Date,Name,Year,Letterboxd URI\n2026-01-03,A,2020,x", "watchlist.csv").kind).toBe("watchlist");
    expect(parseMovieCsv("Date,Name,Year,Letterboxd URI\n2026-01-03,A,2020,x", "watched.csv").kind).toBe("watched");
    const r = parseMovieCsv("Const,Your Rating,Date Rated,Title,Title Type,Year\ntt1,7,2026-01-01,A,Movie,2020\ntt2,9,2026-01-01,B,TV Series,2021", "ratings.csv");
    expect(r).toMatchObject({ source: "imdb", kind: "watched", exactDates: false, skipped: 1, items: [{ title: "A", rating: 4 }] });
    expect(() => parseMovieCsv("a,b\n1,2")).toThrow(/Letterboxd or IMDb/);
  });
});

describe("dates from the database", () => {
  it("Date objects and text both become YYYY-MM-DD", () => {
    const d = new Date("2026-11-23T00:00:00Z");
    expect(mapExpense({ amount: "1", expense_date: d }).date).toBe("2026-11-23");
    expect(mapMovie({ watched_date: d }).date).toBe("2026-11-23");
    expect(mapMovie({ watched_date: "2026-11-23T00:00:00.000Z" }).date).toBe("2026-11-23");
  });
});

describe("API", () => {
  let handler, db, cron, uid2;
  const realFetch = globalThis.fetch;
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  let cookie = "";
  async function call(method, { query = {}, body } = {}) {
    const out = {};
    const res = { setHeader(k, v) { if (k === "Set-Cookie") cookie = v.split(";")[0]; }, status(c) { out.status = c; return this; }, json(b) { out.body = JSON.parse(JSON.stringify(b)); return this; } };
    await handler({ method, query, body, headers: { cookie } }, res);
    return out;
  }
  const details = (id, o = {}) => ({
    id, title: `Film ${id}`, release_date: "2020-01-01", poster_path: "/p.jpg", vote_average: 7.5, vote_count: 500, original_language: "te", runtime: 120, genres: [{ id: 35, name: "Comedy" }],
    credits: { cast: [{ id: 900, name: "Star" }], crew: [{ id: 901, job: "Director", name: "Boss" }] }, "watch/providers": { results: { IN: { flatrate: [{ provider_name: "Netflix" }] } } }, ...o,
  });
  beforeAll(async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    vi.stubEnv("OMDB_API_KEY", "o");
    globalThis.fetch = async (url) => {
      const u = new URL(String(url)), path = u.pathname.replace("/3", "");
      const ok = (b) => ({ ok: true, status: 200, json: async () => b });
      if (u.hostname.includes("omdbapi")) return ok({ Response: "True", imdbID: "tt7", imdbRating: "8.0", Ratings: [{ Source: "Rotten Tomatoes", Value: "91%" }] });
      if (path === "/discover/movie") return ok({ results: [details(1), details(50), details(51, {})].map((d) => ({ ...d, release_date: today })) });
      if (path === "/search/movie") return ok({ results: [] });
      if (path.endsWith("/external_ids")) return ok({ imdb_id: "tt7" });
      if (path.startsWith("/person/")) return ok({ cast: [], crew: [{ id: 60, title: "Film 60", job: "Director", release_date: "2021-01-01", poster_path: "/p.jpg" }, { id: 1, title: "Film 1", job: "Director", release_date: "2020-01-01", poster_path: "/p.jpg" }] });
      const m = path.match(/^\/movie\/(\d+)$/);
      if (m) return ok(details(Number(m[1])));
      return ok({ results: [] });
    };
    db = await import("../lib/db");
    ({ default: handler } = await import("../pages/api/data"));
    cron = await import("../pages/api/cron-daily-notifications");
    await call("POST", { body: { type: "set-pin", pin: "1234" } });
    for (const [id, title] of [[1, "Film 1"], [2, "Film 2"]]) await db.createMovie(1, { title, date: today, venueType: "OTT", venueName: "Netflix", rating: 5, myTake: "loved", tmdbId: id });
    uid2 = (await fake`INSERT INTO users (name, name_key) VALUES ('Ravi', 'ravi') RETURNING id;`)[0].id;
  });
  afterAll(() => { globalThis.fetch = realFetch; vi.unstubAllEnvs(); });

  it("tonight leaves out films you've seen", async () => {
    const r = await call("GET", { query: { type: "tonight", mood: "laugh", minutes: "130" } });
    expect(r.status).toBe(200);
    expect(r.body.apps).toContain("netflix");
    expect(r.body.picks.map((p) => p.tmdbId).sort()).toEqual([50, 51]);
    expect((await call("GET", { query: { type: "tonight", skip: "50" } })).body.picks.map((p) => p.tmdbId)).toEqual([51]);
  });
  it("for you: from people you rate highly, minus what you've seen", async () => {
    const r = await call("GET", { query: { type: "for-you" } });
    expect(r.body.results.map((f) => [f.tmdbId, f.why])).toEqual([[60, "By Boss"]]);
  });
  it("watchlist ratings", async () => {
    const w = await db.createWatchlistItem?.(1, { title: "Seven", tmdbId: 7 }) || (await fake`INSERT INTO movie_watchlist (user_id, title, tmdb_id) VALUES (1, 'Seven', 7) RETURNING *;`)[0];
    expect((await call("GET", { query: { type: "watchlist-ratings" } })).body.ratings[w.id]).toEqual({ imdb: 8, rt: "91%" });
  });
  it("import is safe to run twice, and diary rewatches are kept", async () => {
    const body = { type: "movie-import", source: "letterboxd", kind: "watched", exactDates: true, items: [{ title: "Kalki", year: "2024", date: "2024-07-01", rating: 4 }, { title: "Kalki", year: "2024", date: "2025-07-01", rating: 5 }, { title: "Film 1", date: today }] };
    expect((await call("POST", { body })).body).toEqual({ added: 2, skipped: 1 });
    expect((await call("POST", { body })).body).toEqual({ added: 0, skipped: 3 });
    expect((await call("POST", { body: { ...body, source: "imdb", exactDates: false, items: [{ title: "kalki", date: "2026-01-01" }, { title: "New", date: "2026-02-31x" }] } })).body).toEqual({ added: 1, skipped: 1 });
    const k = (await db.listMovies(1)).find((m) => m.title === "Kalki");
    expect(k).toMatchObject({ affects_balance: false, venue_type: "OTT", note: "Imported from Letterboxd" });
    expect((await call("POST", { body: { ...body, kind: "watchlist", items: [{ title: "Kalki" }, { title: "Later" }, { title: "later" }] } })).body).toEqual({ added: 1, skipped: 2 });
    expect((await call("POST", { body: { ...body, source: "x" } })).status).toBe(400);
  });
  it("movie night dates: members only, votes counted", async () => {
    const list = await db.createWatchList(1, "Weekend", [uid2]);
    const day = { type: "watch-list-date", listId: list.id, day: soon, at: "19:30" };
    expect((await call("POST", { body: day })).status).toBe(201);
    expect((await call("POST", { body: { ...day, day: "2020-01-01" } })).status).toBe(400);
    const get = async () => (await call("GET", { query: { type: "watch-lists" } })).body.lists[0].dates[0];
    const d = await get();
    expect(d).toMatchObject({ day: soon, at: "19:30", votes: 1, my_vote: true });
    await db.voteWatchListDate(uid2, d.id, true);
    expect((await get()).votes).toBe(2);
    const stranger = (await fake`INSERT INTO users (name, name_key) VALUES ('Zed', 'zed') RETURNING id;`)[0].id;
    expect(await db.voteWatchListDate(stranger, d.id, true)).toBe(null);
    expect(await db.addWatchListDate(stranger, list.id, { day: soon })).toBe(null);
    await db.deleteWatchListDate(stranger, d.id);
    expect((await get()).votes).toBe(2);
    await call("DELETE", { query: { type: "watch-list-date", id: String(d.id) } });
    expect(await get()).toBe(undefined);
  });
  it("taste match only between people who both share", async () => {
    await db.createMovie(uid2, { title: "Film 1", date: today, rating: 4, myTake: "liked", tmdbId: 1 });
    expect((await call("GET", { query: { type: "taste-match" } })).body.sharing).toBe(false);
    await db.setUserSetting(1, "share_ratings", "1");
    expect((await call("GET", { query: { type: "taste-match" } })).body).toEqual({ sharing: true, friends: [] });
    await db.setUserSetting(uid2, "share_ratings", "1");
    expect((await call("GET", { query: { type: "taste-match" } })).body.friends).toMatchObject([{ name: "Ravi", count: 1, pct: 75 }]);
  });
  it("Friday releases: once per Friday, unseen films only", async () => {
    const sent = [];
    const rows = await db.listMovies(1);
    await cron.fridayReleases(1, today, rows, async (p) => sent.push(p));
    await cron.fridayReleases(1, today, rows, async (p) => sent.push(p));
    expect(sent.length).toBe(1);
    expect(sent[0].title).toContain("Telugu");
    expect(sent[0].body).toBe("Film 50 · Film 51");
  });
});
