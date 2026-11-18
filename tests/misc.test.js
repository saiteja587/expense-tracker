import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { localDateParts, effectiveDay, addDaysISO } from "../lib/dates";
import { isAuthorizedCron } from "../lib/cronAuth";

describe("dates", () => {
  it("returns the IST date even when UTC is still on the previous day", () => {
    const p = localDateParts(new Date("2026-03-31T20:00:00Z")); // 01:30 IST Apr 1
    expect(p).toMatchObject({ iso: "2026-04-01", ym: "2026-04", day: 1, month: 4, weekday: 3 });
  });
  it("clamps day 29-31 to the month's last day", () => {
    expect(effectiveDay(31, 2026, 2)).toBe(28);
    expect(effectiveDay(31, 2028, 2)).toBe(29);
    expect(effectiveDay(31, 2026, 4)).toBe(30);
    expect(effectiveDay(15, 2026, 2)).toBe(15);
  });
  it("adds days across month boundaries", () => {
    expect(addDaysISO("2026-03-03", -7)).toBe("2026-02-24");
  });
});

describe("cron auth", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("refuses everything when CRON_SECRET is not set", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorizedCron({ headers: { authorization: "Bearer " } })).toBe(false);
  });
  it("accepts only the exact bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isAuthorizedCron({ headers: { authorization: "Bearer s3cret" } })).toBe(true);
    expect(isAuthorizedCron({ headers: { authorization: "Bearer nope" } })).toBe(false);
    expect(isAuthorizedCron({ headers: {} })).toBe(false);
  });
});

describe("offline queue", () => {
  let store;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        if (store.__full && v.length > 300) throw new Error("QuotaExceededError");
        store[k] = v;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("drops requests the server rejects (4xx) but keeps server errors and 401s for retry", async () => {
    const { queueRequest, flushQueue, getQueue } = await import("../lib/offlineQueue");
    queueRequest({ url: "/api/data", method: "POST", body: { n: "bad" } });
    queueRequest({ url: "/api/data", method: "POST", body: { n: "down" } });
    queueRequest({ url: "/api/data", method: "POST", body: { n: "locked" } });
    queueRequest({ url: "/api/data", method: "POST", body: { n: "ok" } });
    const status = { bad: 400, down: 503, locked: 401, ok: 201 };
    vi.stubGlobal("fetch", async (_u, init) => {
      const s = status[JSON.parse(init.body).n];
      return { ok: s < 300, status: s, json: async () => ({ error: "Amount must be greater than 0" }) };
    });
    const r = await flushQueue();
    expect(r.synced).toBe(1);
    expect(r.dropped).toEqual([{ body: { n: "bad" }, error: "Amount must be greater than 0" }]);
    expect(getQueue().map((q) => q.body.n)).toEqual(["down", "locked"]);
  });

  it("queues without the photo when storage is full, instead of failing silently", async () => {
    const { queueRequest, getQueue } = await import("../lib/offlineQueue");
    store.__full = true;
    // Small enough to fit once the photo is stripped.
    const r = queueRequest({ url: "/a", method: "POST", body: { receiptPhoto: "x".repeat(500) } });
    store.__full = false;
    expect(r).toEqual({ ok: true, droppedPhoto: true });
    expect(getQueue()[0].body.receiptPhoto).toBe("");
  });
});
