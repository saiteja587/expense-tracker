// Votes in watch-together lists, following people, friends' ratings (opt-in
// both ways) and the sugar food log — through the real API and database.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const pushes = [];
vi.mock("../lib/push", () => ({ sendToUser: async (uid, p) => { pushes.push({ uid, ...p }); return { sent: 1 }; } }));

const { default: handler } = await import("../pages/api/data");
const { followAlerts } = await import("../pages/api/cron-daily-notifications");
const { freshReleases } = await import("../lib/tmdb");
const { shapeProduct } = await import("../lib/food");
const { lowerSugarSwap, sugarLevel, searchCommonFoods } = await import("../lib/sugarFoods");

function browser() {
  const jar = {};
  async function call(method, { query = {}, body } = {}) {
    const out = {};
    const res = {
      setHeader(k, v) {
        if (k !== "Set-Cookie") return;
        const [name, ...rest] = v.split(";")[0].split("=");
        if (rest.join("=")) jar[name] = rest.join("="); else delete jar[name];
      },
      status(c) { out.status = c; return this; },
      json(b) { out.body = b; return this; },
    };
    await handler({ method, query, body, headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") } }, res);
    return out;
  }
  return {
    get: (type, q = {}) => call("GET", { query: { type, ...q } }),
    post: (body) => call("POST", { body }),
    del: (type, q = {}) => call("DELETE", { query: { type, ...q } }),
  };
}

const me = browser();
const ravi = browser();
const priya = browser();
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

beforeAll(async () => {
  await me.post({ type: "set-pin", pin: "1234" });
  await me.post({ type: "rename", name: "Sai" });
  for (const [b, name, pin] of [[ravi, "Ravi", "1111"], [priya, "Priya", "2222"]]) {
    const code = (await me.post({ type: "invite" })).body.invite.code;
    expect((await b.post({ type: "join", code, name, pin })).status).toBe(201);
  }
});

describe("voting in a watch-together list", () => {
  it("counts votes, puts the favourite first, pings the others; outsiders can't vote", async () => {
    const listId = (await me.post({ type: "watch-list", name: "Friday", members: ["Ravi"] })).body.list.id;
    const a = (await me.post({ type: "watch-list-item", listId, title: "Alpha" })).body.item.id;
    const b = (await me.post({ type: "watch-list-item", listId, title: "Beta" })).body.item.id;
    pushes.length = 0;
    expect((await ravi.post({ type: "watch-list-vote", id: a, on: true })).status).toBe(200);
    await me.post({ type: "watch-list-vote", id: a, on: true });
    expect(pushes.map((p) => [p.uid, p.title])).toEqual([[1, "👍 Ravi voted for Alpha"], [2, "👍 Sai voted for Alpha"]]);

    const items = (await ravi.get("watch-lists")).body.lists[0].items;
    expect(items.map((i) => [i.title, i.votes, i.my_vote])).toEqual([["Alpha", 2, true], ["Beta", 0, false]]);
    expect(items[0].voters).toBe("Sai, Ravi");

    expect((await priya.post({ type: "watch-list-vote", id: b, on: true })).status).toBe(404);
    await ravi.post({ type: "watch-list-vote", id: a, on: false });
    expect((await me.get("watch-lists")).body.lists[0].items[0]).toMatchObject({ title: "Alpha", votes: 1, my_vote: true });
  });
});

describe("following actors and directors", () => {
  it("follows, lists ids in prefs, unfollows — per person", async () => {
    await me.post({ type: "follow", personId: 77, name: "Prabhas", role: "actor" });
    await me.post({ type: "follow", personId: 88, name: "Rajamouli", role: "director" });
    await ravi.post({ type: "follow", personId: 99, name: "Nani" });
    expect((await me.get("movie-prefs")).body.followIds).toEqual([77, 88]);
    await me.del("follow", { id: "88" });
    expect((await me.get("movie-prefs")).body.followIds).toEqual([77]);
    expect((await ravi.get("movie-prefs")).body.followIds).toEqual([99]);
  });

  it("alerts once per new film, at most one a day per person", async () => {
    process.env.TMDB_API_KEY = "test-key";
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
      cast: [
        { id: 501, title: "Raja Saab", release_date: "2026-12-05", order: 0 },
        { id: 502, title: "Spirit", release_date: "2026-12-20", order: 0 },
        { id: 503, title: "Cameo", release_date: "2026-12-01", order: 14 },
        { id: 504, title: "Old one", release_date: "2020-01-01", order: 0 },
      ],
      crew: [],
    }) }));
    const sent = [];
    const send = async (p) => sent.push(p);
    await followAlerts(1, "2026-11-20", send);
    await followAlerts(1, "2026-11-21", send);
    await followAlerts(1, "2026-11-22", send);
    expect(sent.map((p) => p.title)).toEqual(["🎬 New Prabhas movie: Raja Saab", "🎬 New Prabhas movie: Spirit"]);
    expect(sent[0]).toMatchObject({ body: "Releases 5 Dec — tap for details and where to watch.", url: "/movies?details=501" });
    delete process.env.TMDB_API_KEY;
  });

  it("fresh releases: last week to 45 days ahead, skipping ones already sent", () => {
    const films = [{ tmdbId: 1, releaseDate: "2026-11-10" }, { tmdbId: 2, releaseDate: "2026-11-15" }, { tmdbId: 3, releaseDate: "2027-02-01" }, { tmdbId: 4, releaseDate: "2026-12-01" }];
    expect(freshReleases(films, "2026-11-20", ["4"]).map((f) => f.tmdbId)).toEqual([2]);
  });
});

describe("friends' ratings", () => {
  it("only between people who both chose to share", async () => {
    await ravi.post({ type: "movies", title: "Kalki", date: "2026-11-01", ticketPrice: 200, myTake: "loved", publicTake: "liked", tmdbId: 42, rating: 5, review: "Goosebumps" });
    await priya.post({ type: "movies", title: "Kalki", date: "2026-11-02", ticketPrice: 200, myTake: "okay", publicTake: "liked", tmdbId: 42, rating: 3 });

    // I haven't opted in: I see nothing.
    expect((await me.get("friend-ratings", { tmdbId: "42" })).body).toEqual({ sharing: false, ratings: [] });
    await me.post({ type: "movie-prefs", shareRatings: true });
    // Neither friend shares yet.
    expect((await me.get("friend-ratings", { tmdbId: "42" })).body.ratings).toEqual([]);
    await ravi.post({ type: "movie-prefs", shareRatings: true });
    const r = (await me.get("friend-ratings", { tmdbId: "42" })).body.ratings;
    expect(r.map((x) => [x.name, x.rating, x.review])).toEqual([["Ravi", 5, "Goosebumps"]]);
    expect(Object.keys(r[0])).not.toContain("ticket_price");
  });

  it("saves a yearly goal", async () => {
    await me.post({ type: "movie-prefs", goal: 30 });
    expect((await me.get("movie-prefs")).body).toMatchObject({ goal: 30, shareRatings: true });
    await me.post({ type: "movie-prefs", goal: 0 });
    expect((await me.get("movie-prefs")).body.goal).toBe(null);
  });
});

describe("sugar food log", () => {
  it("logs, lists per person, deletes; rejects bad input", async () => {
    expect((await me.post({ type: "sugar-log", name: "", grams: 5 })).status).toBe(400);
    expect((await me.post({ type: "sugar-log", name: "Cola", grams: 5000 })).status).toBe(400);
    const e = (await me.post({ type: "sugar-log", date: "2026-11-20", name: "Maaza (250 g)", grams: 37.25, code: "8901764092206" })).body.entry;
    await me.post({ type: "sugar-log", date: "2026-11-20", name: "Banana (1)", grams: 14, added: false });
    const log = (await me.get("sugar-log")).body.log;
    expect(log.map((l) => [l.name, Number(l.grams), l.added])).toEqual(expect.arrayContaining([["Maaza (250 g)", 37.3, true], ["Banana (1)", 14, false]]));
    expect((await ravi.get("sugar-log")).body.log).toEqual([]);
    await ravi.del("sugar-log", { id: String(e.id) });
    expect((await me.get("sugar-log")).body.log).toHaveLength(2);
    await me.del("sugar-log", { id: String(e.id) });
    expect((await me.get("sugar-log")).body.log).toHaveLength(1);
  });

  it("searches Open Food Facts + common foods, and caches", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ hits: [
      { code: "1", product_name: "Mango drink", brands: ["Maaza"], nutriments: { sugars_100g: 14.9 }, serving_quantity: 250, categories_tags: ["en:beverages"] },
      { code: "2", product_name: "No data" },
    ] }) }));
    const d = (await me.get("food-search", { q: "mango" })).body;
    expect(d.common.map((c) => c.name)).toEqual(["Mango lassi (1 glass)", "Packaged mango drink (250 ml)", "Mango (1 medium)"]);
    expect(d.products).toEqual([expect.objectContaining({ code: "1", brand: "Maaza", sugarPer100: 14.9, sugarPerServing: 37.3, drink: true })]);
    await me.get("food-search", { q: "mango" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = String(global.fetch.mock.calls[0][0]);
    expect(url).toContain("search.openfoodfacts.org");
    expect(global.fetch.mock.calls[0][1].headers["User-Agent"]).not.toMatch(/@/);
  });

  it("looks up a barcode; unknown → null; network down → 502", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 1, product: { product_name: "Parle-G", brands: "Parle", nutriments: { sugars_100g: 25 } } }) }));
    expect((await me.get("food-barcode", { code: "8901719100956" })).body.product).toMatchObject({ name: "Parle-G", sugarPer100: 25, code: "8901719100956" });
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 0 }) }));
    expect((await me.get("food-barcode", { code: "1234567890123" })).body.product).toBe(null);
    global.fetch = vi.fn(async () => { throw new Error("offline"); });
    expect((await me.get("food-barcode", { code: "2234567890123" })).status).toBe(502);
  });

  it("comes back from a backup without duplicating", async () => {
    const db = await import("../lib/db");
    const entry = { day_date: "2026-11-01", name: "Jalebi (100 g)", grams: "45.0", added: true };
    expect((await db.importAll(3, { sugarFoodLog: [entry] })).sugarFoodLog).toBe(1);
    expect((await db.importAll(3, { sugarFoodLog: [entry] })).sugarFoodLog).toBe(0);
    expect((await priya.get("sugar-log")).body.log.length).toBeGreaterThanOrEqual(0);
    expect((await db.listSugarLog(3, "1900-01-01")).map((l) => l.name)).toEqual(["Jalebi (100 g)"]);
  });

  it("traffic lights and swaps", () => {
    expect(sugarLevel(4, false)).toBe("low");
    expect(sugarLevel(30, false)).toBe("high");
    expect(sugarLevel(14.9, true)).toBe("high");
    const p = shapeProduct({ code: "a", product_name: "Cola", nutriments: { sugars_100g: 10.6 }, categories_tags: ["en:sodas"] });
    const zero = shapeProduct({ code: "b", product_name: "Cola Zero", nutriments: { sugars_100g: 0 }, categories_tags: ["en:sodas"] });
    const biscuit = shapeProduct({ code: "c", product_name: "Biscuit", nutriments: { sugars_100g: 1 }, categories_tags: ["en:biscuits"] });
    expect(lowerSugarSwap(p, [p, biscuit, zero])?.name).toBe("Cola Zero");
    expect(searchCommonFoods("gulab")[0].grams).toBe(30);
  });
});
