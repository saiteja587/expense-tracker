// Free money data, no keys. Server-only, cached in tmdb_cache.
//   mfapi.in      Indian mutual fund search and latest NAV (AMFI data)
//   frankfurter   daily currency rates (European Central Bank)
import { cached } from "./tmdb";

const HOUR = 3600 * 1000;
const UA = "ExpenseLedger/1.0 (personal finance app)";
async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

export async function mfSearch(q) {
  const t = String(q || "").trim();
  if (t.length < 3) return [];
  return cached(`mfsearch:${t.toLowerCase()}`, 7 * 24 * HOUR, async () =>
    ((await getJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(t)}`)) || []).slice(0, 15).map((x) => ({ code: String(x.schemeCode), name: x.schemeName })));
}

// { code, name, nav, date } — NAVs update once a day.
export function shapeNav(j) {
  const d = j?.data?.[0];
  if (!d) return null;
  const [dd, mm, yy] = String(d.date).split("-");
  return { code: String(j.meta?.scheme_code || ""), name: j.meta?.scheme_name || "", nav: parseFloat(d.nav), date: `${yy}-${mm}-${dd}` };
}
export async function mfNav(code) {
  if (!/^\d{1,10}$/.test(String(code || ""))) return null;
  return cached(`mfnav:${code}`, 6 * HOUR, async () => shapeNav(await getJson(`https://api.mfapi.in/mf/${code}/latest`)));
}

// Only currencies the ECB publishes (no AED, LKR or NPR there).
export const CURRENCIES = ["USD", "EUR", "GBP", "SGD", "THB", "MYR", "IDR", "JPY", "KRW", "CNY", "HKD", "AUD", "NZD", "CAD", "CHF"];
// ₹ for 1 unit of `from` on a date (the last working day's rate on weekends).
export async function fxRate(from, date) {
  const c = String(from || "").toUpperCase();
  if (!CURRENCIES.includes(c)) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : "latest";
  return cached(`fx:${c}:${day}`, day === "latest" ? 6 * HOUR : 365 * 24 * HOUR, async () => {
    const j = await getJson(`https://api.frankfurter.dev/v1/${day}?base=${c}&symbols=INR`);
    return j?.rates?.INR ? { rate: j.rates.INR, date: j.date } : null;
  });
}
