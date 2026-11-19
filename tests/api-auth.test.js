// The API end to end against a real (in-process) Postgres: PIN hashing,
// sessions, invites, and — most importantly — that one person can never
// read or change another person's data.
import { describe, it, expect, vi, beforeAll } from "vitest";
import crypto from "crypto";
import { createFakeNeon } from "./helpers/pgliteNeon";

const fake = createFakeNeon();
vi.mock("@neondatabase/serverless", () => ({ neon: () => fake }));

const { default: handler } = await import("../pages/api/data");
const { hashPin, verifyPin } = await import("../lib/auth");
const db = await import("../lib/db");

// A browser: its own cookie jar.
function browser() {
  const jar = {};
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
  return {
    jar,
    get: (type, q = {}) => call("GET", { query: { type, ...q } }),
    post: (body) => call("POST", { body }),
    put: (body) => call("PUT", { body }),
    del: (type, q = {}) => call("DELETE", { query: { type, ...q } }),
    call,
  };
}

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

describe("one person, as before", () => {
  const me = browser();

  it("is open while the only person has no PIN", async () => {
    expect((await me.get("expenses")).status).toBe(200);
    const s = await me.get("session");
    expect(s.body).toMatchObject({ hasPin: false, authenticated: true, multiUser: false });
  });

  it("blocks everything without a session once a PIN is set", async () => {
    expect((await me.post({ type: "set-pin", pin: "1234" })).status).toBe(201);
    const stranger = browser();
    expect((await stranger.get("export-all")).status).toBe(401);
    expect((await stranger.del("expenses", { id: "1" })).status).toBe(401);
    expect((await stranger.post({ type: "set-pin", pin: "" })).status).toBe(401);
    expect((await stranger.call("GET", { query: { type: "expenses" }, cookie: "ledger_session=1.9999999999999.forged" })).status).toBe(401);
    expect((await stranger.get("session")).body).toMatchObject({ hasPin: true, authenticated: false });
    // The same device that set the PIN stays signed in.
    expect((await me.get("expenses")).status).toBe(200);
  });

  it("signs in with just the PIN while there's one person", async () => {
    const phone = browser();
    expect((await phone.post({ type: "verify-pin", pin: "0000" })).body.ok).toBe(false);
    expect(phone.jar.ledger_session).toBeUndefined();
    expect((await phone.post({ type: "verify-pin", pin: "1234" })).body.ok).toBe(true);
    expect((await phone.get("expenses")).status).toBe(200);
  });

  it("signs out other devices when the PIN changes", async () => {
    const other = browser();
    await other.post({ type: "verify-pin", pin: "1234" });
    await me.post({ type: "set-pin", pin: "5678" });
    expect((await me.get("expenses")).status).toBe(200);
    expect((await other.get("expenses")).status).toBe(401);
  });

  it("upgrades a legacy SHA-256 PIN to scrypt on the next sign-in", async () => {
    await db.setUserPin(1, crypto.createHash("sha256").update("2468").digest("hex"));
    const phone = browser();
    expect((await phone.post({ type: "verify-pin", pin: "2468" })).body.ok).toBe(true);
    expect((await db.getUser(1)).pin_hash).toMatch(/^scrypt\$/);
    expect((await phone.get("expenses")).status).toBe(200);
  });

  it("logout clears the session", async () => {
    const phone = browser();
    await phone.post({ type: "verify-pin", pin: "2468" });
    await phone.post({ type: "logout" });
    expect((await phone.get("expenses")).status).toBe(401);
  });

  it("accepts the low-balance and movie-count rules the Rules page saves", async () => {
    const phone = browser();
    await phone.post({ type: "verify-pin", pin: "2468" });
    for (const ruleType of ["low_balance", "movie_count"]) {
      expect((await phone.post({ type: "budget", ruleType, amount: 5 })).status).toBe(201);
    }
    expect((await phone.post({ type: "budget", ruleType: "bogus", amount: 5 })).status).toBe(400);
  });
});

describe("two people", () => {
  const owner = browser();
  const friend = browser();
  let code;
  let ownerExpenseId;

  beforeAll(async () => {
    await owner.post({ type: "verify-pin", pin: "2468" });
    const e = await owner.post({ type: "expenses", amount: 500, category: "Food", note: "owner's dinner", date: "2026-11-01" });
    ownerExpenseId = e.body.expense.id;
    await owner.post({ type: "balance", amount: 40000, date: "2026-11-01", mode: "set" });
    await owner.post({ type: "savings-goal", targetAmount: 100000, label: "Bike" });
  });

  it("only the owner (with a PIN) can create invites", async () => {
    const r = await owner.post({ type: "invite" });
    expect(r.status).toBe(201);
    code = r.body.invite.code;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await browser().get("invite-check", { code })).body.valid).toBe(true);
    expect((await browser().get("invite-check", { code: "NOPE2345" })).body.valid).toBe(false);
  });

  it("joining needs a valid code, a free name and a PIN", async () => {
    expect((await browser().post({ type: "join", code: "WRONG234", name: "Ravi", pin: "1111" })).status).toBe(404);
    expect((await browser().post({ type: "join", code, name: "me", pin: "1111" })).status).toBe(400); // name taken (case-insensitive)
    expect((await browser().post({ type: "join", code, name: "Ravi", pin: "12" })).status).toBe(400);
    const r = await friend.post({ type: "join", code, name: "Ravi", pin: "1111" });
    expect(r.status).toBe(201);
    expect(r.body.user.name).toBe("Ravi");
    // Single use.
    expect((await browser().post({ type: "join", code, name: "Priya", pin: "2222" })).status).toBe(404);
  });

  it("the friend starts with a completely empty ledger", async () => {
    expect((await friend.get("expenses")).body.expenses).toEqual([]);
    expect((await friend.get("balance")).body.topups).toEqual([]);
    expect((await friend.get("savings-goal")).body.goal).toBeNull();
    const exp = await friend.get("export-all");
    expect(exp.body.expenses).toEqual([]);
    expect((await friend.get("session")).body).toMatchObject({ authenticated: true, multiUser: true, user: { name: "Ravi", isOwner: false } });
  });

  it("nobody can read, change or delete someone else's rows by id", async () => {
    // Friend tries the owner's expense id every way.
    const put = await friend.put({ type: "expenses", id: ownerExpenseId, amount: 1, category: "Food", date: "2026-11-01" });
    expect(put.body.expense).toBeUndefined();
    await friend.del("expenses", { id: String(ownerExpenseId) });
    await friend.post({ type: "finalize-expense", id: ownerExpenseId, amount: 1 });
    expect((await friend.get("receipts", { ids: String(ownerExpenseId) })).body.receipts[ownerExpenseId]).toBe("");
    const mine = (await owner.get("expenses")).body.expenses;
    expect(mine.find((x) => x.id === ownerExpenseId)).toMatchObject({ amount: "500.00", note: "owner's dinner" });
  });

  it("each person's writes stay theirs", async () => {
    await friend.post({ type: "expenses", amount: 75, category: "Auto", note: "ravi auto", date: "2026-11-02" });
    await friend.post({ type: "budget", ruleType: "overall", amount: 9000 });
    await friend.post({ type: "challenge-meta", startDate: "2026-11-01", lengthDays: 21 });
    await friend.post({ type: "categories", categories: [{ name: "Gym" }] });
    expect((await owner.get("expenses")).body.expenses.some((x) => x.note === "ravi auto")).toBe(false);
    expect((await owner.get("budget")).body.rules.find((r) => r.rule_type === "overall")).toBeUndefined();
    expect((await owner.get("challenge")).body.meta).toBeNull();
    expect((await owner.get("categories")).body.categories).toEqual([]);
    expect((await friend.get("expenses")).body.expenses.map((x) => x.note)).toEqual(["ravi auto"]);
  });

  it("a cookie can't be edited into someone else's", async () => {
    const [, exp, sig] = decodeURIComponent(friend.jar.ledger_session).split(".");
    const forged = encodeURIComponent(`1.${exp}.${sig}`);
    expect((await browser().call("GET", { query: { type: "expenses" }, cookie: `ledger_session=${forged}` })).status).toBe(401);
  });

  it("with two people, sign-in needs the right name + PIN", async () => {
    const phone = browser();
    expect((await phone.post({ type: "verify-pin", pin: "1111" })).body.needName).toBe(true);
    expect((await phone.post({ type: "verify-pin", name: "Me", pin: "1111" })).body.ok).toBe(false);
    expect((await phone.post({ type: "verify-pin", name: "Nobody", pin: "1111" })).body).toMatchObject({ ok: false, error: "Name or PIN doesn't match" });
    expect((await phone.post({ type: "verify-pin", name: "  ravi ", pin: "1111" })).body.ok).toBe(true);
    expect((await phone.get("expenses")).body.expenses.map((x) => x.note)).toEqual(["ravi auto"]);
  });

  it("wrong PINs lock only that person out for a while", async () => {
    const phone = browser();
    for (let i = 0; i < 5; i++) await phone.post({ type: "verify-pin", name: "Ravi", pin: "0000" });
    expect((await phone.post({ type: "verify-pin", name: "Ravi", pin: "1111" })).body.locked).toBe(true);
    expect((await browser().post({ type: "verify-pin", name: "Me", pin: "2468" })).body.ok).toBe(true);
    await db.recordLoginAttempt((await db.getUserByName("Ravi")).id, { ok: true });
  });

  it("the friend can't invite people, and nobody can remove their PIN now", async () => {
    expect((await friend.post({ type: "invite" })).status).toBe(403);
    expect((await owner.post({ type: "set-pin", pin: "" })).status).toBe(400);
  });

  it("owners see who uses the app; names can be changed but not to a taken one", async () => {
    const d = (await owner.get("invites")).body;
    expect(d.people.map((p) => p.name)).toEqual(["Me", "Ravi"]);
    expect(d.invites[0]).toMatchObject({ code, used_by_name: "Ravi" });
    expect((await friend.get("invites")).body.people).toEqual([]);
    expect((await owner.post({ type: "rename", name: "ravi" })).status).toBe(400);
    expect((await owner.post({ type: "rename", name: "Sai" })).body.user.name).toBe("Sai");
  });

  it("recurring items are generated for their own owner", async () => {
    await friend.post({ type: "recurring", amount: 300, category: "Bills", note: "ravi phone", dayOfMonth: 1 });
    await db.generateAllRecurring();
    expect((await friend.get("expenses")).body.expenses.some((x) => x.note === "ravi phone")).toBe(true);
    expect((await owner.get("expenses")).body.expenses.some((x) => x.note === "ravi phone")).toBe(false);
  });

  it("imports land in the importer's own ledger", async () => {
    await friend.post({ type: "import-all", data: { expenses: [{ amount: "12", category: "Food", note: "imported", expense_date: "2026-10-01", created_at: "2026-10-01T00:00:00.000Z" }] } });
    expect((await friend.get("expenses")).body.expenses.some((x) => x.note === "imported")).toBe(true);
    expect((await owner.get("expenses")).body.expenses.some((x) => x.note === "imported")).toBe(false);
  });
});
