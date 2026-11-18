// #7 — Seasonal touches. Festival dates move every year, so they're listed
// per year; seasons (monsoon) are by month.
const FESTIVALS = [
  // Diwali (main day ±2)
  { name: "Diwali", emoji: "🪔", greeting: "Happy Diwali", dates: ["2026-11-08", "2027-10-29", "2028-10-17"], span: 2, theme: "diwali" },
  { name: "Holi", emoji: "🎨", greeting: "Happy Holi", dates: ["2026-03-04", "2027-03-22", "2028-03-11"], span: 1, theme: "holi" },
  { name: "Christmas", emoji: "🎄", greeting: "Merry Christmas", dates: ["2026-12-25", "2027-12-25", "2028-12-25"], span: 3, theme: "winter" },
  { name: "New Year", emoji: "🎆", greeting: "Happy New Year", dates: ["2027-01-01", "2028-01-01", "2029-01-01"], span: 1, theme: "newyear" },
];

function dayDiff(a, b) {
  return Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000);
}

// Returns { name, emoji, greeting, theme } or null.
export function seasonFor(todayIso) {
  for (const f of FESTIVALS) {
    if (f.dates.some((d) => Math.abs(dayDiff(todayIso, d)) <= f.span)) return { name: f.name, emoji: f.emoji, greeting: f.greeting, theme: f.theme };
  }
  const m = Number(todayIso.slice(5, 7));
  if (m >= 6 && m <= 9) return { name: "Monsoon", emoji: "🌧️", greeting: null, theme: "monsoon" };
  return null;
}
