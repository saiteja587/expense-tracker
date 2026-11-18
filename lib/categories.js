// Built-in expense categories and their colours. Custom categories (from
// Settings) are added on top of these at runtime.
export const CATEGORIES = [
  { name: "Food", color: "#B5533C", emoji: "🍔" },
  { name: "Groceries", color: "#C98A2C", emoji: "🛒" },
  { name: "Transport", color: "#3F6E5B", emoji: "🛺" },
  { name: "Bills", color: "#5B3A5C", emoji: "🧾" },
  { name: "Rent", color: "#2F4858", emoji: "🏠" },
  { name: "Shopping", color: "#A3763F", emoji: "🛍️" },
  { name: "Health", color: "#6B7A3E", emoji: "💊" },
  { name: "Entertainment", color: "#8A4B6B", emoji: "🎟️" },
  { name: "Other", color: "#6B6558", emoji: "✨" },
];

export const MOVIE_CATEGORY = { name: "Movies", color: "#7A3E56", emoji: "🎬" };

export function allCategories(custom = []) {
  return [...CATEGORIES, ...custom.map((c) => ({ emoji: "🏷️", ...c })), MOVIE_CATEGORY];
}

export function categoryColor(name, custom = []) {
  return allCategories(custom).find((c) => c.name === name)?.color || "#6B6558";
}

export function categoryEmoji(name, custom = []) {
  return allCategories(custom).find((c) => c.name === name)?.emoji || "🏷️";
}
