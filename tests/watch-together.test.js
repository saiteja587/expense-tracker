// Watchlist order and watch-together lists, through the real API with two
// (and three) people.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));
const pushes = [];
vi.mock("../lib/push", () => ({ sendToUser: async (uid, p) => { pushes.push({ uid, ...p }); return { sent: 1 }; } }));

const { default: handler } = await import("../pages/api/data");

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
    put: (body) => call("PUT", { body }),
    del: (type, q = {}) => call("DELETE", { query: { type, ...q } }),
  };
}

const me = browser();
const ravi = browser();
const priya = browser();

beforeAll(async () => {
  await me.post({ type: "set-pin", pin: "1234" });
  await me.post({ type: "rename", name: "Sai" });
  for (const [b, name, pin] of [[ravi, "Ravi", "1111"], [priya, "Priya", "2222"]]) {
    const code = (await me.post({ type: "invite" })).body.invite.code;
    expect((await b.post({ type: "join", code, name, pin })).status).toBe(201);
  }
});

describe("watchlist order", () => {
  it("keeps your drag-and-drop order; new movies go on top", async () => {
    const ids = [];
    for (const t of ["A", "B", "C"]) ids.push((await me.post({ type: "watchlist", title: t })).body.item.id);
    expect((await me.get("watchlist")).body.watchlist.map((w) => w.title)).toEqual(["C", "B", "A"]);
    await me.post({ type: "watchlist-order", ids: [ids[1], ids[0], ids[2]] });
    expect((await me.get("watchlist")).body.watchlist.map((w) => w.title)).toEqual(["B", "A", "C"]);
    await me.post({ type: "watchlist", title: "D" });
    expect((await me.get("watchlist")).body.watchlist.map((w) => w.title)).toEqual(["D", "B", "A", "C"]);
  });

  it("can't reorder someone else's watchlist", async () => {
    const r = (await ravi.post({ type: "watchlist", title: "Ravi's pick" })).body.item.id;
    const mine = (await me.get("watchlist")).body.watchlist.map((w) => w.id);
    await ravi.post({ type: "watchlist-order", ids: [...mine].reverse() });
    expect((await me.get("watchlist")).body.watchlist.map((w) => w.title)).toEqual(["D", "B", "A", "C"]);
    expect((await ravi.get("watchlist")).body.watchlist.map((w) => w.id)).toEqual([r]);
  });
});

describe("watch together", () => {
  let listId;

  it("creates a list with friends by their sign-in names, and tells them", async () => {
    expect((await me.post({ type: "watch-list", name: "Weekend", members: ["Nobody"] })).status).toBe(400);
    pushes.length = 0;
    const r = await me.post({ type: "watch-list", name: "Weekend", members: ["ravi"] });
    expect(r.status).toBe(201);
    listId = r.body.list.id;
    expect(pushes).toEqual([expect.objectContaining({ uid: 2, title: "🍿 New watch-together list" })]);
  });

  it("both can add; the other gets a ping; outsiders see and touch nothing", async () => {
    pushes.length = 0;
    await ravi.post({ type: "watch-list-item", listId, title: "Kalki 2898 AD", tmdbId: 5 });
    expect(pushes).toEqual([expect.objectContaining({ uid: 1, title: "🎬 Ravi added Kalki 2898 AD" })]);
    await me.post({ type: "watch-list-item", listId, title: "Salaar" });

    const mine = (await me.get("watch-lists")).body.lists[0];
    expect(mine.members.map((m) => m.name)).toEqual(["Sai", "Ravi"]);
    expect(mine.items.map((i) => [i.title, i.added_by_name])).toEqual([["Salaar", "Sai"], ["Kalki 2898 AD", "Ravi"]]);

    // Priya isn't in it.
    expect((await priya.get("watch-lists")).body.lists).toEqual([]);
    expect((await priya.post({ type: "watch-list-item", listId, title: "Sneaky" })).status).toBe(403);
    const itemId = mine.items[0].id;
    expect((await priya.put({ type: "watch-list-item", id: itemId, watched: true })).status).toBe(404);
    await priya.del("watch-list-item", { id: String(itemId) });
    await priya.del("watch-list", { id: String(listId) });
    expect((await ravi.get("watch-lists")).body.lists[0].items).toHaveLength(2);
  });

  it("ticking off is shared; a member leaves, the owner deletes for everyone", async () => {
    const items = (await ravi.get("watch-lists")).body.lists[0].items;
    await ravi.put({ type: "watch-list-item", id: items[0].id, watched: true });
    expect((await me.get("watch-lists")).body.lists[0].items.find((i) => i.id === items[0].id).watched).toBe(true);

    await ravi.del("watch-list", { id: String(listId) });
    expect((await ravi.get("watch-lists")).body.lists).toEqual([]);
    expect((await me.get("watch-lists")).body.lists).toHaveLength(1);

    await me.del("watch-list", { id: String(listId) });
    expect((await me.get("watch-lists")).body.lists).toEqual([]);
    expect(await fake`SELECT * FROM watch_list_items`).toEqual([]);
  });
});
