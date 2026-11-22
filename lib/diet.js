// Free, offline diet helper: a table of common Indian foods (per usual
// serving, approximate values in the spirit of NIN's IFCT 2017 / typical
// recipes), daily targets, a rule-based weekly plan with a shopping list,
// and a ready-made prompt for the Claude app. No AI or API key needed.
import { addDays } from "./ledger";

// [name, serving, kcal, protein g, carbs g, fat g, sugar g, tags]
// tags: v = vegetarian, e = has egg, n = non-veg, s = sweet
const F = [
  ["Roti / chapati", "1 medium", 110, 3, 18, 3, 0.4, "v"],
  ["Phulka (no ghee)", "1", 80, 2.5, 16, 0.5, 0.3, "v"],
  ["Paratha (plain)", "1", 210, 4, 28, 9, 0.5, "v"],
  ["Aloo paratha", "1", 290, 6, 40, 12, 1.5, "v"],
  ["Steamed rice", "1 cup cooked", 205, 4, 45, 0.4, 0.1, "v"],
  ["Brown rice", "1 cup cooked", 215, 5, 45, 1.8, 0.7, "v"],
  ["Jeera rice", "1 cup", 250, 4.5, 46, 6, 0.3, "v"],
  ["Veg biryani", "1 plate", 420, 9, 62, 14, 4, "v"],
  ["Chicken biryani", "1 plate", 550, 25, 60, 22, 3, "n"],
  ["Curd rice", "1 cup", 240, 7, 36, 7, 4, "v"],
  ["Lemon rice", "1 cup", 280, 5, 45, 9, 1, "v"],
  ["Dal (toor / moong)", "1 katori", 150, 9, 20, 4, 2, "v"],
  ["Rajma", "1 katori", 210, 11, 30, 5, 2, "v"],
  ["Chana masala", "1 katori", 240, 11, 32, 8, 5, "v"],
  ["Sambar", "1 katori", 140, 6, 20, 4, 4, "v"],
  ["Rasam", "1 katori", 60, 2, 9, 2, 2, "v"],
  ["Palak paneer", "1 katori", 280, 14, 10, 20, 3, "v"],
  ["Paneer bhurji", "1 katori", 300, 17, 8, 22, 3, "v"],
  ["Paneer (raw)", "100 g", 265, 18, 3, 20, 2, "v"],
  ["Mixed veg curry", "1 katori", 150, 4, 15, 8, 5, "v"],
  ["Aloo sabzi", "1 katori", 180, 3, 25, 8, 2, "v"],
  ["Bhindi fry", "1 katori", 160, 3, 12, 11, 3, "v"],
  ["Cabbage / beans poriyal", "1 katori", 110, 3, 12, 6, 4, "v"],
  ["Gongura / leafy curry", "1 katori", 120, 4, 10, 7, 2, "v"],
  ["Idli", "2", 120, 4, 25, 0.5, 0.5, "v"],
  ["Plain dosa", "1", 170, 4, 28, 5, 1, "v"],
  ["Masala dosa", "1", 330, 7, 45, 14, 3, "v"],
  ["Pesarattu", "1", 180, 9, 26, 5, 1, "v"],
  ["Upma", "1 cup", 250, 6, 38, 8, 2, "v"],
  ["Poha", "1 cup", 250, 5, 42, 7, 3, "v"],
  ["Uttapam", "1", 220, 6, 35, 6, 2, "v"],
  ["Vada", "1", 130, 4, 12, 8, 0.5, "v"],
  ["Pongal", "1 cup", 300, 8, 42, 11, 1, "v"],
  ["Oats (with milk)", "1 bowl", 250, 10, 38, 6, 12, "v"],
  ["Besan chilla", "2", 240, 12, 28, 8, 2, "v"],
  ["Boiled egg", "1", 78, 6, 0.6, 5, 0.5, "e"],
  ["Omelette (2 eggs)", "1", 190, 13, 2, 15, 1, "e"],
  ["Egg curry", "1 katori (2 eggs)", 260, 14, 8, 19, 4, "e"],
  ["Chicken curry", "1 katori", 280, 25, 7, 17, 3, "n"],
  ["Grilled / tandoori chicken", "150 g", 250, 38, 4, 9, 1, "n"],
  ["Fish curry", "1 katori", 220, 22, 6, 12, 2, "n"],
  ["Mutton curry", "1 katori", 340, 24, 6, 25, 2, "n"],
  ["Curd / dahi", "1 cup", 100, 6, 8, 5, 7, "v"],
  ["Buttermilk", "1 glass", 40, 2, 4, 1.5, 4, "v"],
  ["Milk (toned)", "1 glass", 120, 6, 10, 6, 10, "v"],
  ["Tea with sugar", "1 cup", 70, 2, 10, 2, 8, "vs"],
  ["Tea without sugar", "1 cup", 35, 2, 3, 2, 3, "v"],
  ["Coffee with sugar", "1 cup", 80, 3, 11, 3, 9, "vs"],
  ["Sprouts salad", "1 bowl", 120, 8, 18, 1, 3, "v"],
  ["Green salad", "1 bowl", 40, 2, 7, 0.3, 4, "v"],
  ["Roasted chana", "30 g", 110, 6, 18, 2, 3, "v"],
  ["Peanuts", "30 g", 170, 7, 5, 14, 1.2, "v"],
  ["Almonds", "10", 70, 2.5, 2.5, 6, 0.5, "v"],
  ["Makhana (roasted)", "1 cup", 100, 3, 20, 1, 0, "v"],
  ["Banana", "1 medium", 105, 1.3, 27, 0.4, 14, "v"],
  ["Apple", "1 medium", 95, 0.5, 25, 0.3, 19, "v"],
  ["Papaya", "1 cup", 60, 0.7, 15, 0.4, 11, "v"],
  ["Guava", "1", 70, 2.5, 14, 1, 9, "v"],
  ["Samosa", "1", 260, 4, 30, 14, 2, "v"],
  ["Pakoda / bajji", "4 pieces", 280, 5, 25, 18, 2, "v"],
  ["Mirchi bajji", "2", 250, 5, 22, 16, 2, "v"],
  ["Pani puri", "6", 200, 4, 32, 7, 6, "v"],
  ["Gulab jamun", "1", 150, 2, 22, 6, 18, "vs"],
  ["Jalebi", "2 pieces", 300, 2, 50, 11, 35, "vs"],
  ["Laddu (besan)", "1", 180, 3, 22, 9, 14, "vs"],
  ["Ice cream", "1 scoop", 140, 2.5, 16, 7, 14, "vs"],
  ["Cold drink (cola)", "300 ml", 130, 0, 33, 0, 33, "vs"],
  ["Fruit juice (packed)", "200 ml", 110, 0.5, 27, 0, 24, "vs"],
  ["Pizza slice", "1", 280, 12, 33, 11, 4, "v"],
  ["Burger (veg)", "1", 350, 9, 45, 15, 7, "v"],
  ["Noodles / Maggi", "1 pack", 380, 8, 52, 15, 2, "v"],
  ["Protein / whey shake", "1 scoop", 120, 24, 3, 1.5, 2, "v"],
  ["Soya chunks (cooked)", "1 katori", 170, 17, 12, 5, 2, "v"],
];
export const FOODS = F.map(([name, serving, kcal, protein, carbs, fat, sugar, tags]) => ({ name, serving, kcal, protein, carbs, fat, sugar, veg: tags.includes("v"), egg: tags.includes("e"), sweet: tags.includes("s") }));

export function searchFoods(q, limit = 8) {
  const w = String(q || "").toLowerCase().trim();
  if (!w) return [];
  return FOODS.filter((f) => f.name.toLowerCase().includes(w)).slice(0, limit);
}

// ---- Daily targets ---------------------------------------------------------------
export const GOALS = [
  { id: "lose", label: "Lose weight", kcalPerKg: 24, proteinPerKg: 1.4 },
  { id: "maintain", label: "Stay healthy", kcalPerKg: 30, proteinPerKg: 1.0 },
  { id: "muscle", label: "Build muscle", kcalPerKg: 34, proteinPerKg: 1.8 },
  { id: "lowsugar", label: "Low sugar", kcalPerKg: 28, proteinPerKg: 1.1 },
];
// Rough targets from body weight (no weight yet: 65 kg). Added sugar ≤ 25 g (WHO ideal).
export function dailyTargets(goalId, weightKg) {
  const g = GOALS.find((x) => x.id === goalId) || GOALS[1];
  const w = weightKg > 0 ? weightKg : 65;
  return { kcal: Math.round((g.kcalPerKg * w) / 50) * 50, protein: Math.round(g.proteinPerKg * w), sugar: goalId === "lowsugar" ? 15 : 25 };
}

export function dayTotals(foodLogs, date) {
  const xs = foodLogs.filter((f) => f.date === date);
  const tot = (k) => Math.round(xs.reduce((s, f) => s + (f[k] || 0) * (f.qty || 1), 0));
  return { items: xs, kcal: tot("kcal"), protein: tot("protein"), carbs: tot("carbs"), fat: tot("fat"), sugar: tot("sugar") };
}

// ---- Rule-based weekly plan -------------------------------------------------------
// Each meal: foods (names from FOODS with servings) + shopping ingredients
// [item, qty, unit, approx ₹]. Prices are rough Indian city averages.
const M = (slot, diet, name, foods, shop, goals = "all") => ({ slot, diet, name, foods, shop, goals });
const MEALS = [
  M("breakfast", "v", "Idli + sambar", [["Idli", 1.5], ["Sambar", 1]], [["Idli batter", 0.5, "kg", 45], ["Toor dal", 50, "g", 8]]),
  M("breakfast", "v", "Pesarattu + chutney", [["Pesarattu", 2]], [["Green moong", 100, "g", 14]]),
  M("breakfast", "v", "Vegetable upma", [["Upma", 1]], [["Rava", 80, "g", 5], ["Mixed vegetables", 100, "g", 8]]),
  M("breakfast", "v", "Poha with peanuts", [["Poha", 1], ["Peanuts", 0.5]], [["Poha", 80, "g", 5], ["Peanuts", 15, "g", 3]]),
  M("breakfast", "v", "Besan chilla + curd", [["Besan chilla", 1], ["Curd / dahi", 1]], [["Besan", 80, "g", 8], ["Curd", 200, "g", 14]]),
  M("breakfast", "v", "Oats with banana", [["Oats (with milk)", 1], ["Banana", 1]], [["Oats", 50, "g", 9], ["Milk", 250, "ml", 14], ["Banana", 1, "pc", 7]], "lose,maintain,muscle"),
  M("breakfast", "e", "Omelette + 2 phulkas", [["Omelette (2 eggs)", 1], ["Phulka (no ghee)", 2]], [["Eggs", 2, "pc", 14], ["Atta", 60, "g", 3]]),
  M("breakfast", "e", "Boiled eggs + toast + fruit", [["Boiled egg", 3], ["Guava", 1]], [["Eggs", 3, "pc", 21], ["Guava", 1, "pc", 10]]),
  M("lunch", "v", "Rice, dal, poriyal, curd", [["Steamed rice", 1], ["Dal (toor / moong)", 1], ["Cabbage / beans poriyal", 1], ["Curd / dahi", 1]], [["Rice", 100, "g", 6], ["Toor dal", 60, "g", 9], ["Cabbage / beans", 200, "g", 12], ["Curd", 200, "g", 14]]),
  M("lunch", "v", "Rajma + rice + salad", [["Rajma", 1], ["Steamed rice", 1], ["Green salad", 1]], [["Rajma", 70, "g", 10], ["Rice", 100, "g", 6], ["Cucumber & tomato", 200, "g", 12]]),
  M("lunch", "v", "Phulkas + palak paneer + salad", [["Phulka (no ghee)", 3], ["Palak paneer", 1], ["Green salad", 1]], [["Atta", 90, "g", 4], ["Paneer", 100, "g", 40], ["Spinach", 1, "bunch", 15]]),
  M("lunch", "v", "Brown rice, sambar, veg", [["Brown rice", 1], ["Sambar", 1], ["Mixed veg curry", 1]], [["Brown rice", 100, "g", 10], ["Toor dal", 50, "g", 8], ["Mixed vegetables", 200, "g", 16]], "lose,lowsugar,maintain"),
  M("lunch", "v", "Chana masala + 2 rotis", [["Chana masala", 1], ["Roti / chapati", 2], ["Buttermilk", 1]], [["Kabuli chana", 70, "g", 9], ["Atta", 60, "g", 3], ["Curd", 100, "g", 7]]),
  M("lunch", "n", "Chicken curry + rice + salad", [["Chicken curry", 1], ["Steamed rice", 1], ["Green salad", 1]], [["Chicken", 150, "g", 40], ["Rice", 100, "g", 6], ["Cucumber & tomato", 150, "g", 9]]),
  M("lunch", "n", "Fish curry + rice", [["Fish curry", 1], ["Steamed rice", 1], ["Cabbage / beans poriyal", 1]], [["Fish", 150, "g", 50], ["Rice", 100, "g", 6], ["Cabbage / beans", 150, "g", 9]]),
  M("lunch", "e", "Egg curry + phulkas", [["Egg curry", 1], ["Phulka (no ghee)", 3]], [["Eggs", 2, "pc", 14], ["Atta", 90, "g", 4], ["Onion & tomato", 200, "g", 10]]),
  M("snack", "v", "Sprouts salad", [["Sprouts salad", 1]], [["Green moong", 60, "g", 8]]),
  M("snack", "v", "Roasted chana + buttermilk", [["Roasted chana", 1], ["Buttermilk", 1]], [["Roasted chana", 30, "g", 5], ["Curd", 100, "g", 7]]),
  M("snack", "v", "Fruit + almonds", [["Papaya", 1], ["Almonds", 1]], [["Papaya", 250, "g", 12], ["Almonds", 15, "g", 15]]),
  M("snack", "v", "Makhana + tea (no sugar)", [["Makhana (roasted)", 1], ["Tea without sugar", 1]], [["Makhana", 25, "g", 20], ["Milk", 100, "ml", 6]]),
  M("snack", "v", "Whey shake + banana", [["Protein / whey shake", 1], ["Banana", 1]], [["Whey protein", 30, "g", 60], ["Banana", 1, "pc", 7]], "muscle"),
  M("dinner", "v", "Phulkas + dal + veg", [["Phulka (no ghee)", 3], ["Dal (toor / moong)", 1], ["Bhindi fry", 1]], [["Atta", 90, "g", 4], ["Moong dal", 60, "g", 9], ["Bhindi", 200, "g", 16]]),
  M("dinner", "v", "Paneer bhurji + 2 rotis", [["Paneer bhurji", 1], ["Roti / chapati", 2]], [["Paneer", 100, "g", 40], ["Atta", 60, "g", 3], ["Onion & tomato", 150, "g", 8]]),
  M("dinner", "v", "Soya curry + rice", [["Soya chunks (cooked)", 1], ["Steamed rice", 0.75], ["Green salad", 1]], [["Soya chunks", 50, "g", 8], ["Rice", 75, "g", 5], ["Cucumber & tomato", 150, "g", 9]]),
  M("dinner", "v", "Pongal + sambar (light)", [["Pongal", 1], ["Sambar", 1]], [["Rice", 60, "g", 4], ["Moong dal", 40, "g", 6]], "maintain,lowsugar"),
  M("dinner", "v", "Dosa + sambar", [["Plain dosa", 2], ["Sambar", 1]], [["Dosa batter", 0.5, "kg", 45], ["Toor dal", 50, "g", 8]]),
  M("dinner", "n", "Tandoori chicken + salad + roti", [["Grilled / tandoori chicken", 1], ["Green salad", 1], ["Roti / chapati", 1]], [["Chicken", 150, "g", 40], ["Curd", 100, "g", 7], ["Cucumber & tomato", 150, "g", 9]]),
  M("dinner", "e", "Egg bhurji + phulkas + salad", [["Omelette (2 eggs)", 1], ["Phulka (no ghee)", 2], ["Green salad", 1]], [["Eggs", 2, "pc", 14], ["Atta", 60, "g", 3], ["Cucumber & tomato", 150, "g", 9]]),
];
const allowed = (meal, diet) => meal.diet === "v" || (meal.diet === "e" && diet !== "veg") || (meal.diet === "n" && diet === "nonveg");
const fitsGoal = (meal, goal) => meal.goals === "all" || meal.goals.split(",").includes(goal);

function mealNutrition(meal) {
  const tot = { kcal: 0, protein: 0, sugar: 0 };
  for (const [name, qty] of meal.foods) {
    const f = FOODS.find((x) => x.name === name);
    if (f) { tot.kcal += f.kcal * qty; tot.protein += f.protein * qty; tot.sugar += f.sugar * qty; }
  }
  return { kcal: Math.round(tot.kcal), protein: Math.round(tot.protein), sugar: Math.round(tot.sugar) };
}

// 7 days × 4 meals. Rotates options so the same meal doesn't repeat on
// consecutive days; `seed` reshuffles. diet: "veg" | "egg" | "nonveg".
export function weeklyPlan({ goal = "maintain", diet = "veg", startIso, seed = 0 }) {
  const slots = ["breakfast", "lunch", "snack", "dinner"];
  const pools = Object.fromEntries(slots.map((sl) => [sl, MEALS.filter((m) => m.slot === sl && allowed(m, diet) && fitsGoal(m, goal))]));
  const days = [];
  for (let k = 0; k < 7; k++) {
    const meals = slots.map((sl, j) => {
      const pool = pools[sl];
      const m = pool[(k * (j + 2) + seed + j) % pool.length];
      return { slot: sl, name: m.name, ...mealNutrition(m), shop: m.shop };
    });
    days.push({ date: addDays(startIso, k), meals, kcal: meals.reduce((s, m) => s + m.kcal, 0), protein: meals.reduce((s, m) => s + m.protein, 0) });
  }
  // Shopping list: same item + unit added up; cost scaled per unit.
  const shop = {};
  for (const day of days) for (const m of day.meals) for (const [item, qty, unit, cost] of m.shop) {
    const key = `${item}|${unit}`;
    shop[key] = shop[key] || { item, unit, qty: 0, cost: 0 };
    shop[key].qty += qty; shop[key].cost += cost;
  }
  const list = Object.values(shop).map((x) => ({ ...x, qty: unitRound(x.qty, x.unit), cost: Math.round(x.cost) })).sort((a, b) => a.item.localeCompare(b.item));
  return { days, shopping: list, totalCost: list.reduce((s, x) => s + x.cost, 0) };
}
function unitRound(q, unit) {
  if (unit === "g" && q >= 1000) return `${Math.round(q / 100) / 10} kg`;
  if (unit === "ml" && q >= 1000) return `${Math.round(q / 100) / 10} L`;
  if (unit === "kg") return `${Math.round(q * 10) / 10} kg`;
  return `${Math.round(q)} ${unit}`;
}

// ---- A prompt for the free Claude app ---------------------------------------------
// Your goal, targets and the last week of food, so Claude can review it or
// make a plan. Nothing financial beyond the grocery budget is included.
export function claudePrompt({ goal, diet, weight, targets, foodLogs, todayIso, budget, question }) {
  const g = GOALS.find((x) => x.id === goal)?.label || "Stay healthy";
  const since = addDays(todayIso, -6);
  const lines = foodLogs.filter((f) => f.date >= since).sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((f) => `${f.date} ${f.meal || ""}: ${f.name}${f.qty && f.qty !== 1 ? ` ×${f.qty}` : ""} (~${Math.round((f.kcal || 0) * (f.qty || 1))} kcal)`);
  return [
    `I'm in India. Goal: ${g}. Diet: ${diet === "veg" ? "vegetarian" : diet === "egg" ? "vegetarian + eggs" : "non-vegetarian"}.${weight ? ` Weight: ${weight} kg.` : ""}`,
    `My daily targets: ~${targets.kcal} kcal, ${targets.protein} g protein, under ${targets.sugar} g added sugar.`,
    budget ? `Grocery budget: about ₹${budget} a week.` : "",
    lines.length ? `What I ate in the last 7 days:\n${lines.join("\n")}` : "I haven't logged food this week yet.",
    question || "Please review my eating, point out 3 simple improvements, and suggest a realistic 7-day Indian meal plan with a shopping list and rough ₹ costs. Keep portions practical.",
    "Keep it practical. I understand this is general guidance, not medical advice.",
  ].filter(Boolean).join("\n\n");
}
