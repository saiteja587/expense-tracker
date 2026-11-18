// Shared client-side formatting helpers.

// ₹1,23,456 — rounded, Indian digit grouping. Negative amounts read
// "−₹1,580" rather than "₹-1,580".
export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  const s = "₹" + Math.abs(v).toLocaleString("en-IN");
  return v < 0 ? "−" + s : s;
}

// Compact: ₹950, ₹12.4k, ₹1.2L.
export function fmtShort(n) {
  const v = Math.abs(Math.round(Number(n) || 0));
  const sign = n < 0 ? "−" : "";
  if (v >= 100000) return `${sign}₹${(v / 100000).toFixed(v >= 1000000 ? 0 : 1).replace(/\.0$/, "")}L`;
  if (v >= 10000) return `${sign}₹${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return sign + "₹" + v.toLocaleString("en-IN");
}

// Today's date as YYYY-MM-DD in the device's local timezone
// (toISOString alone would give the UTC date).
export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

export function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

export function dayLabel(iso, todayIso) {
  if (iso === todayIso) return "Today";
  const y = new Date(todayIso + "T00:00:00");
  y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (iso === yIso) return "Yesterday";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
