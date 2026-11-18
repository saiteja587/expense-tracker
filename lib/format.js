// Shared client-side formatting helpers (previously copy-pasted per page).

// ₹1,23,456 — rounded, Indian digit grouping.
export function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// Today's date as YYYY-MM-DD in the device's local timezone
// (toISOString alone would give the UTC date).
export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}
