// Sugar in foods, from Open Food Facts (openfoodfacts.org — free, open
// data, no key) plus a small built-in list of common Indian foods and
// drinks that aren't packaged products. Server-only for the API calls;
// the helpers at the bottom are pure and shared with the page.
import { getCache, setCache } from "./db";

const UA = "ExpenseLedger/1.0 (personal budgeting app)";
const FIELDS = "code,product_name,brands,nutriments,serving_size,serving_quantity,image_small_url,nutriscore_grade,categories_tags";
const HOUR = 3600 * 1000;
const mem = new Map();

async function cached(key, ttl, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const row = await getCache(key).catch(() => null);
  if (row && Date.now() - new Date(row.fetched_at).getTime() < ttl) {
    const value = JSON.parse(row.data);
    mem.set(key, { at: Date.now(), value });
    return value;
  }
  const value = await fn();
  if (mem.size > 500) mem.clear();
  mem.set(key, { at: Date.now(), value });
  await setCache(key, JSON.stringify(value)).catch(() => {});
  return value;
}

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`Open Food Facts ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const n = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

export function shapeProduct(p) {
  if (!p) return null;
  const nu = p.nutriments || {};
  const sugar100 = n(nu.sugars_100g);
  const added100 = n(nu["added-sugars_100g"]);
  const servingG = n(p.serving_quantity);
  const brands = Array.isArray(p.brands) ? p.brands.join(", ") : p.brands || "";
  const cats = (p.categories_tags || []).join(" ");
  return {
    code: String(p.code || ""),
    name: (p.product_name || "").trim() || "Unnamed product",
    brand: brands.split(",")[0].trim(),
    image: p.image_small_url || null,
    sugarPer100: sugar100,
    addedPer100: added100,
    servingSize: p.serving_size || "",
    servingGrams: servingG && servingG < 2000 ? servingG : null,
    sugarPerServing: sugar100 != null && servingG ? n((sugar100 * servingG) / 100) : null,
    nutriscore: /^[a-e]$/.test(p.nutriscore_grade || "") ? p.nutriscore_grade : null,
    drink: /beverage|drink|juice|soda|milk/.test(cats),
  };
}

export async function searchFoods(q) {
  const key = `off:s:${q.toLowerCase()}`;
  return cached(key, 7 * 24 * HOUR, async () => {
    const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=12&fields=${FIELDS}`;
    const d = await get(url);
    return (d.hits || []).map(shapeProduct).filter((p) => p && p.sugarPer100 != null).slice(0, 8);
  });
}

export async function productByBarcode(code) {
  const clean = String(code).replace(/\D/g, "").slice(0, 14);
  if (clean.length < 8) return null;
  return cached(`off:p:${clean}`, 30 * 24 * HOUR, async () => {
    const d = await get(`https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${FIELDS}`);
    return d.status === 1 && d.product ? shapeProduct({ ...d.product, code: clean }) : null;
  });
}

export { COMMON_FOODS, searchCommonFoods, teaspoons, sugarLevel, lowerSugarSwap, DAILY_IDEAL, DAILY_MAX } from "./sugarFoods";
