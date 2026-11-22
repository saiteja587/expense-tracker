// Card secrets (full number, expiry, CVV, ATM PIN, net-banking password…)
// are sealed on THIS device with a passphrase only you know, then stored.
// The server, the database and backups only ever see the sealed form.
//
// PBKDF2-SHA256 (600k rounds) turns the passphrase into an AES-256-GCM key.
// GCM also detects a wrong passphrase: decryption simply fails.
// Forget the passphrase and the secrets can't be recovered by anyone.

export const VAULT_ITERATIONS = 600000;
export const MIN_PASSPHRASE = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("This browser can't encrypt (needs HTTPS).");
  return c;
}

async function keyFrom(passphrase, salt, iter) {
  const c = subtle();
  const base = await c.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return c.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// secrets: a plain object, e.g. { number, expiry, cvv, pin, password, notes }.
export async function sealSecrets(secrets, passphrase, iter = VAULT_ITERATIONS) {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const c = subtle();
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt, iter);
  const ct = await c.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(secrets)));
  return JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

export async function openSecrets(sealed, passphrase) {
  const o = typeof sealed === "string" ? JSON.parse(sealed) : sealed;
  if (!o || o.v !== 1) throw new Error("Nothing saved yet.");
  const key = await keyFrom(passphrase, unb64(o.salt), o.iter);
  try {
    const pt = await subtle().subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error("Wrong passphrase.");
  }
}

// Card number shown in groups of 4: "4111 1111 1111 1111".
export const groupCard = (n) => String(n || "").replace(/\D/g, "").replace(/(.{4})(?=.)/g, "$1 ");
