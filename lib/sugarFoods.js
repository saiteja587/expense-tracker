// Sugar helpers shared by the sugar page and the server (no imports, so
// the page can use them without pulling in database code).

// Common Indian foods with typical sugar per serving (grams, approximate;
// "added" false = sugar that comes naturally, as in fruit or plain milk).
export const COMMON_FOODS = [
  { name: "Chai with sugar (1 cup)", grams: 10, added: true },
  { name: "Filter coffee with sugar (1 cup)", grams: 9, added: true },
  { name: "Gulab jamun (2 pieces)", grams: 30, added: true },
  { name: "Jalebi (100 g)", grams: 45, added: true },
  { name: "Rasgulla (2 pieces)", grams: 26, added: true },
  { name: "Kaju katli (2 pieces)", grams: 10, added: true },
  { name: "Besan laddu (1 piece)", grams: 14, added: true },
  { name: "Mysore pak (1 piece)", grams: 13, added: true },
  { name: "Payasam / kheer (1 bowl)", grams: 28, added: true },
  { name: "Sweet lassi (1 glass)", grams: 28, added: true },
  { name: "Mango lassi (1 glass)", grams: 32, added: true },
  { name: "Cold drink / cola (330 ml can)", grams: 35, added: true },
  { name: "Packaged mango drink (250 ml)", grams: 33, added: true },
  { name: "Sugarcane juice (1 glass)", grams: 40, added: true },
  { name: "Ice cream (1 scoop)", grams: 14, added: true },
  { name: "Milk chocolate (small bar, 25 g)", grams: 14, added: true },
  { name: "Glucose biscuits (4)", grams: 6, added: true },
  { name: "Cake / pastry (1 slice)", grams: 25, added: true },
  { name: "Banana (1)", grams: 14, added: false },
  { name: "Mango (1 medium)", grams: 45, added: false },
  { name: "Apple (1)", grams: 19, added: false },
  { name: "Dates (3)", grams: 16, added: false },
  { name: "Fresh orange juice, no sugar (1 glass)", grams: 21, added: false },
  { name: "Plain milk (1 glass)", grams: 12, added: false },
];

export const searchCommonFoods = (q) => {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return COMMON_FOODS.filter((f) => words.every((w) => f.name.toLowerCase().includes(w))).slice(0, 5);
};

export const teaspoons = (g) => Math.round(((g || 0) / 4) * 10) / 10;

// UK traffic-light thresholds per 100 g (drinks use per 100 ml halves).
export function sugarLevel(per100, drink = false) {
  if (per100 == null) return null;
  const [low, high] = drink ? [2.5, 11.25] : [5, 22.5];
  return per100 <= low ? "low" : per100 > high ? "high" : "medium";
}

// WHO: under 50 g of added sugar a day, ideally under 25 g.
export const DAILY_IDEAL = 25;
export const DAILY_MAX = 50;

// From a list of results, a noticeably lower-sugar option (for "try this
// instead") — at least 30% less sugar per 100 g.
export function lowerSugarSwap(product, results) {
  if (!product || product.sugarPer100 == null) return null;
  return results
    .filter((r) => r.code !== product.code && r.sugarPer100 != null && r.drink === product.drink && r.sugarPer100 <= product.sugarPer100 * 0.7)
    .sort((a, b) => a.sugarPer100 - b.sugarPer100)[0] || null;
}
