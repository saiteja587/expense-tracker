// Server-side date helpers. Vercel runs in UTC, but "today" for this app
// means today where the user lives — otherwise between midnight and 05:30
// IST the server still thinks it's yesterday.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

// { year, month (1-12), day, weekday (0=Sun), iso: "YYYY-MM-DD", ym: "YYYY-MM" }
export function localDateParts(date = new Date(), timeZone = APP_TIMEZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const ym = `${parts.year}-${parts.month}`;
  return { year, month, day, weekday, ym, iso: `${ym}-${parts.day}` };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// A recurring item set for day 29–31 lands on the last day of shorter
// months (e.g. "31" = Feb 28/29, Apr 30).
export function effectiveDay(dayOfMonth, year, month) {
  return Math.min(dayOfMonth, daysInMonth(year, month));
}

// Shift an ISO date ("YYYY-MM-DD") by n days.
export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
