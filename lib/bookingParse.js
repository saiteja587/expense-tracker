// Reads a pasted ticket confirmation (BookMyShow / District / Paytm SMS or
// email) and pulls out the movie, date, time, theatre, seats and amount.
// Runs in the browser only — nothing pasted is sent anywhere.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const LANGS = ["Telugu", "Tamil", "Hindi", "Malayalam", "Kannada", "English", "Bengali", "Marathi", "Punjabi", "Gujarati", "Korean", "Japanese"];
const CERT = String.raw`\(\s*(?:U\s*\/\s*A|UA|A|U|S)(?:\s*\d{1,2}\+)?\s*\)`;
const CHAINS = /\b(PVR|INOX|Cinepolis|AMB|Asian|Prasads?|Sathyam|SPI|Miraj|Carnival|Mukta|Gokulam|Allu|AAA|Movietime|Cinemax|Rajhans|Wave|Mallikarjuna|Sudarshan|Devi|Sandhya|Vimal|Shanti|Big Cinemas|[A-Z][\w']+ (?:Cinemas?|Multiplex|Theatres?|Talkies))\b/;

const pad = (n) => String(n).padStart(2, "0");
const clean = (s) => s.replace(/\s+/g, " ").trim();

function pickTitle(text) {
  const pats = [
    new RegExp(String.raw`(?:booking|tickets?)\s+for\s+(.+?)\s*(?:${CERT})?\s*(?:[-–,]\s*(?:${LANGS.join("|")})[^.|\n]*?)?\s+(?:is|are|has|have)\s+(?:been\s+)?confirmed`, "i"),
    new RegExp(String.raw`(?:^|\n)\s*(?:movie|film)\s*[:\-]\s*(.+)`, "i"),
    new RegExp(String.raw`(?:^|\n|[.!]\s)\s*([^\n.|:]{2,60}?)\s*${CERT}`, "i"),
    /(?:you(?:'re| are) (?:all set|going) (?:for|to watch)|enjoy(?: watching)?)\s+(.+?)(?:[!.]|\s+on\s|\s+at\s|$)/i,
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m && m[1]) {
      const t = clean(m[1])
        .replace(new RegExp(CERT, "ig"), "")
        .replace(new RegExp(String.raw`\s*[-–,(]\s*(?:${LANGS.join("|")})\b.*$`, "i"), "")
        .replace(/\s*[-–(]\s*(?:2D|3D|4DX|IMAX|MX4D|ICE)\b.*$/i, "")
        .replace(/^(?:your|the)\s+/i, "")
        .replace(/[\s:,-]+$/, "");
      if (t.length >= 1 && !/^(booking|ticket|order)/i.test(t)) return t;
    }
  }
  return "";
}

function pickDate(text, todayIso) {
  let y, mo, d, at = -1;
  let m = text.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+${MONTH_RE}\b[\s,'-]*(\d{4}|'?\d{2}(?!\s*[:.]\d))?`, "i"));
  if (m) { d = +m[1]; mo = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)]; y = m[3]; at = m.index; }
  if (!m) {
    m = text.match(new RegExp(String.raw`\b${MONTH_RE}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?`, "i"));
    if (m) { mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; d = +m[2]; y = m[3]; at = m.index; }
  }
  if (!m) {
    m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) { d = +m[1]; mo = +m[2]; y = m[3]; at = m.index; }
  }
  if (!mo || !d || d > 31 || mo > 12) return { date: "", at: -1 };
  const [ty] = todayIso.split("-").map(Number);
  let year = y ? Number(String(y).replace("'", "")) : ty;
  if (year < 100) year += 2000;
  let iso = `${year}-${pad(mo)}-${pad(d)}`;
  // No year printed: the booking is near today — a date far in the past
  // means it's for early next year.
  if (!y && (new Date(todayIso) - new Date(iso)) / 86400000 > 180) iso = `${year + 1}-${pad(mo)}-${pad(d)}`;
  return { date: iso, at };
}

function pickTime(text) {
  const withAmPm = text.match(/\b(\d{1,2})[:.](\d{2})\s*([ap])\.?\s*m\.?\b/i);
  const m = withAmPm || text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:hrs?\s*)?(?:min|mins))/);
  if (!m) return "";
  let h = +m[1];
  const min = +m[2];
  if (min > 59 || h > 23) return "";
  if (m[3]) {
    const pm = m[3].toLowerCase() === "p";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return `${pad(h)}:${pad(min)}`;
}

function pickTheatre(text) {
  const labelled = text.match(/(?:venue|cinema|theatre|theater|location)\s*[:\-]\s*([^\n|]+)/i);
  let raw = labelled?.[1] || "";
  if (!raw) {
    // "… 07:00 PM at PVR: Inorbit Mall, Cyberabad. Seats …"
    const at = [...text.matchAll(/\bat\s+([A-Z][^\n|]+?)(?=\s*(?:\.\s|\||\n|seats?\b|screen\b|audi\b|amount\b|total\b|$))/g)].map((x) => x[1]).find((s) => !/^\d/.test(s));
    raw = at || "";
  }
  if (!raw) {
    const line = text.split(/\n|\|/).map((l) => l.trim()).find((l) => CHAINS.test(l) && !/confirmed|booking id/i.test(l));
    raw = line || "";
  }
  return clean(raw).replace(/\.$/, "").split(",").slice(0, 2).join(",").trim().slice(0, 60);
}

function pickSeats(text) {
  const n = text.match(/\b(\d{1,2})[ \t]*(?:x[ \t]*)?(?:tickets?|tkts?|seats?)(?:[ \t]*\(s\))?\b/i) || text.match(/\b(?:tickets?|quantity|qty|no\.? of seats)[ \t]*[:\-][ \t]*(\d{1,2})\b/i);
  if (n) return Math.max(1, Math.min(20, +n[1]));
  const s = text.match(/seats?\s*(?:no\.?|numbers?)?\s*[:\-]\s*([^\n|.]+)/i);
  if (s) {
    const codes = s[1].match(/\b[A-Z]{1,2}\s?-?\s?\d{1,3}\b/g);
    if (codes?.length) return Math.min(20, codes.length);
  }
  return 0;
}

function pickAmount(text) {
  const money = String.raw`(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)`;
  const labelled = text.match(new RegExp(String.raw`(?:grand total|total amount|amount paid|total paid|amount|total|paid)[^\d₹\n]{0,15}${money}`, "i"));
  if (labelled) return parseFloat(labelled[1].replace(/,/g, "")) || 0;
  const all = [...text.matchAll(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((x) => parseFloat(x[1].replace(/,/g, "")) || 0);
  return all.length ? Math.max(...all) : 0;
}

export function parseBooking(input, todayIso) {
  const text = String(input || "").replace(/\r/g, "").slice(0, 4000);
  if (!text.trim()) return null;
  const { date } = pickDate(text, todayIso);
  const out = {
    title: pickTitle(text),
    date,
    time: pickTime(text),
    theatre: pickTheatre(text),
    seats: pickSeats(text),
    total: pickAmount(text),
    language: LANGS.find((l) => new RegExp(`\\b${l}\\b`, "i").test(text)) || "",
  };
  out.found = ["title", "date", "time", "theatre", "total"].filter((k) => out[k]).length;
  return out;
}

// Your saved theatre that this booking's venue most likely is ("PVR:
// Inorbit Mall, Cyberabad" → "PVR Inorbit"), or "" if none fits.
export function matchTheatre(venue, options = []) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "cinemas", "cinema", "mall", "multiplex", "theatre"].includes(w));
  const v = new Set(words(venue));
  let best = "", score = 0;
  for (const o of options) {
    if (!o || o === "Other") continue;
    const ws = words(o);
    if (!ws.length) continue;
    const hits = ws.filter((w) => v.has(w)).length;
    const s = hits / ws.length;
    if (hits && s > score) { best = o; score = s; }
  }
  return score >= 0.5 ? best : "";
}
