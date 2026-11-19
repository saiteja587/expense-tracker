// Server-side session auth for /api/data.
//
// After a correct PIN, the server sets an HttpOnly cookie holding a signed
// expiry timestamp. The browser sends it automatically with every same-origin
// fetch, and page JavaScript can't read or forge it, so the API can trust it.
//
// Each person has their own name + PIN; the cookie says which person it is
// (see "Sessions" below). No session table to maintain.
import crypto from "crypto";
import { getSetting, setSetting, getUser, listUsers } from "./db";

const COOKIE = "ledger_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
// Re-issue the cookie once it's more than a day old, so a session stays
// alive as long as the app is used at least once a month.
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

let cachedSecret = null;

// Prefer an AUTH_SECRET env var; otherwise generate one on first use and keep
// it in app_settings so the app still works with zero extra setup on Vercel.
async function getServerSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (cachedSecret) return cachedSecret;
  let secret = await getSetting("auth_secret");
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    await setSetting("auth_secret", secret);
    // Another instance may have raced us; re-read so everyone agrees.
    secret = await getSetting("auth_secret");
  }
  cachedSecret = secret;
  return secret;
}

function sign(key, payload) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookieAttrs(maxAgeSeconds) {
  const attrs = [`Path=/api`, `HttpOnly`, `SameSite=Strict`, `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

// ---- PIN hashing ----
// Salted scrypt: deliberately slow, so a leaked hash of a 4–8 digit PIN
// can't be brute-forced in milliseconds the way plain SHA-256 can.
// Stored as "scrypt$<salt hex>$<hash hex>". Older installs stored an
// unsalted SHA-256 hex digest; verifyPin accepts that once and asks the
// caller to upgrade it.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// Returns { ok, needsUpgrade }.
export function verifyPin(pin, stored) {
  if (!stored) return { ok: false, needsUpgrade: false };
  if (stored.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = stored.split("$");
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length, SCRYPT_PARAMS);
    return { ok: crypto.timingSafeEqual(actual, expected), needsUpgrade: false };
  }
  const legacy = Buffer.from(crypto.createHash("sha256").update(pin).digest("hex"));
  const storedBuf = Buffer.from(stored);
  const ok = legacy.length === storedBuf.length && crypto.timingSafeEqual(legacy, storedBuf);
  return { ok, needsUpgrade: ok };
}

// ---- Sessions ----
// The cookie is "<userId>.<expiry>.<signature>". The signing key mixes the
// server secret with that user's id and PIN hash, so changing your PIN signs
// out all of YOUR other devices (and nobody else's), and a cookie for one
// user can't be edited into another's.
async function userKey(user) {
  const secret = await getServerSecret();
  return crypto.createHmac("sha256", secret).update(`user:${user.id}:pin:${user.pin_hash || ""}`).digest();
}

export async function issueSession(res, user) {
  const exp = String(Date.now() + SESSION_MS);
  const body = `${user.id}.${exp}`;
  const token = `${body}.${sign(await userKey(user), body)}`;
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(SESSION_MS / 1000)}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; ${cookieAttrs(0)}`);
}

// The signed-in user for this request, or null. Refreshes an ageing cookie.
export async function getSessionUser(req, res) {
  const token = readCookie(req);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idStr, exp, sig] = parts;
  const id = parseInt(idStr, 10);
  const expMs = parseInt(exp, 10);
  if (!id || !expMs || expMs < Date.now()) return null;
  const user = await getUser(id);
  if (!user) return null;
  const expected = sign(await userKey(user), `${idStr}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (res && SESSION_MS - (expMs - Date.now()) > REFRESH_AFTER_MS) await issueSession(res, user);
  return user;
}

// Who is making this request: the session's user, or — only while the app
// has a single person who never set a PIN — that person, so a fresh
// install keeps working with zero setup, exactly as before.
export async function resolveUser(req, res) {
  const user = await getSessionUser(req, res);
  if (user) return user;
  const users = await listUsers();
  if (users.length === 1 && !users[0].has_pin) return getUser(users[0].id);
  return null;
}
