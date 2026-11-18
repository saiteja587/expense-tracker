import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// In-memory app_settings; the API handler's data functions are stubbed.
const settings = new Map();
vi.mock("../lib/db", () => ({
  getSetting: async (k) => (settings.has(k) ? settings.get(k) : null),
  setSetting: async (k, v) => void settings.set(k, v),
  listExpenses: async () => [{ id: 1, amount: "10" }],
  deleteExpense: async () => {},
  upsertBudgetRule: async (r) => ({ id: 1, rule_type: r.ruleType, category: "", amount: r.amount }),
}));

const { default: handler } = await import("../pages/api/data");
const { hashPin, verifyPin } = await import("../lib/auth");

// Minimal req/res pair with a cookie jar, so a test reads like a browser session.
let jar = {};
async function call(method, { query = {}, body, cookie } = {}) {
  const cookieHeader = cookie !== undefined ? cookie : Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const out = { headers: {} };
  const res = {
    setHeader(k, v) {
      out.headers[k] = v;
      if (k === "Set-Cookie") {
        const [name, ...rest] = v.split(";")[0].split("=");
        const value = rest.join("=");
        if (value) jar[name] = value;
        else delete jar[name];
      }
    },
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
  };
  await handler({ method, query, body, headers: { cookie: cookieHeader } }, res);
  return out;
}

beforeEach(() => {
  settings.clear();
  jar = {};
});

describe("PIN hashing", () => {
  it("uses salted scrypt (same PIN, different hashes) and verifies", () => {
    const a = hashPin("1234");
    const b = hashPin("1234");
    expect(a).toMatch(/^scrypt\$/);
    expect(a).not.toBe(b);
    expect(verifyPin("1234", a)).toEqual({ ok: true, needsUpgrade: false });
    expect(verifyPin("9999", a).ok).toBe(false);
  });

  it("accepts an old unsalted SHA-256 hash once and asks for an upgrade", () => {
    const legacy = crypto.createHash("sha256").update("1234").digest("hex");
    expect(verifyPin("1234", legacy)).toEqual({ ok: true, needsUpgrade: true });
    expect(verifyPin("0000", legacy).ok).toBe(false);
  });
});

describe("API session gate", () => {
  it("is open when no PIN is set", async () => {
    expect((await call("GET", { query: { type: "expenses" } })).status).toBe(200);
  });

  it("blocks reads, deletes and PIN changes without a session", async () => {
    await call("POST", { body: { type: "set-pin", pin: "1234" } });
    expect((await call("GET", { query: { type: "export-all" }, cookie: "" })).status).toBe(401);
    expect((await call("DELETE", { query: { type: "expenses", id: "1" }, cookie: "" })).status).toBe(401);
    expect((await call("POST", { body: { type: "set-pin", pin: "" }, cookie: "" })).status).toBe(401);
    expect((await call("GET", { query: { type: "expenses" }, cookie: "ledger_session=9999999999999.forged" })).status).toBe(401);
  });

  it("keeps the lock-screen calls public", async () => {
    await call("POST", { body: { type: "set-pin", pin: "1234" } });
    const s = await call("GET", { query: { type: "session" }, cookie: "" });
    expect(s.body).toEqual({ hasPin: true, authenticated: false });
    expect((await call("GET", { query: { type: "pin-status" }, cookie: "" })).body.hasPin).toBe(true);
  });

  it("issues a session on the right PIN only", async () => {
    await call("POST", { body: { type: "set-pin", pin: "1234" } });
    jar = {};
    expect((await call("POST", { body: { type: "verify-pin", pin: "0000" } })).body.ok).toBe(false);
    expect(jar.ledger_session).toBeUndefined();
    expect((await call("POST", { body: { type: "verify-pin", pin: "1234" } })).body.ok).toBe(true);
    expect((await call("GET", { query: { type: "expenses" } })).status).toBe(200);
  });

  it("signs out other devices when the PIN changes", async () => {
    await call("POST", { body: { type: "set-pin", pin: "1234" } });
    const otherDevice = jar.ledger_session;
    await call("POST", { body: { type: "set-pin", pin: "5678" } });
    expect((await call("GET", { query: { type: "expenses" } })).status).toBe(200);
    expect((await call("GET", { query: { type: "expenses" }, cookie: `ledger_session=${otherDevice}` })).status).toBe(401);
  });

  it("upgrades a legacy SHA-256 PIN to scrypt on the next unlock", async () => {
    settings.set("app_pin_hash", crypto.createHash("sha256").update("2468").digest("hex"));
    expect((await call("POST", { body: { type: "verify-pin", pin: "2468" } })).body.ok).toBe(true);
    expect(settings.get("app_pin_hash")).toMatch(/^scrypt\$/);
    expect((await call("GET", { query: { type: "expenses" } })).status).toBe(200);
  });

  it("logout clears the session", async () => {
    await call("POST", { body: { type: "set-pin", pin: "1234" } });
    await call("POST", { body: { type: "logout" } });
    expect((await call("GET", { query: { type: "expenses" } })).status).toBe(401);
  });
});

describe("budget rules", () => {
  it("accepts the low-balance and movie-count rules the Rules page saves", async () => {
    for (const ruleType of ["low_balance", "movie_count"]) {
      const r = await call("POST", { body: { type: "budget", ruleType, amount: 5 } });
      expect(r.status).toBe(201);
    }
    expect((await call("POST", { body: { type: "budget", ruleType: "bogus", amount: 5 } })).status).toBe(400);
  });
});
