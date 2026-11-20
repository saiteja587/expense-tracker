import { describe, it, expect } from "vitest";
import { parseBooking, matchTheatre } from "../lib/bookingParse";
import { subscriptionValue, showPriceTips, savedByWaiting, yearRecap, movieGoal, tasteVsCrowd, pickPool } from "../lib/movieInsights";

const TODAY = "2026-11-20";

describe("booking text", () => {
  it("reads a BookMyShow SMS", () => {
    const b = parseBooking("Hi, your booking for Kalki 2898 AD (UA) - Telugu is confirmed. Booking ID: WXYZ12. 2 Ticket(s) for Sat, 14 Nov, 2026 07:00 PM at PVR: Inorbit Mall, Cyberabad, Hyderabad. Seats: EXECUTIVE - H12, H13. Amount: Rs. 560.00", TODAY);
    expect(b).toMatchObject({ title: "Kalki 2898 AD", date: "2026-11-14", time: "19:00", seats: 2, total: 560, language: "Telugu" });
    expect(b.theatre).toBe("PVR: Inorbit Mall, Cyberabad");
  });

  it("reads a District-style message with seat codes and ₹", () => {
    const b = parseBooking("Your tickets for Pushpa 2: The Rule are confirmed! Thu, 5 Dec | 9:30 PM | AMB Cinemas, Gachibowli | Seats: F7, F8, F9 | Amount paid: ₹1,170", TODAY);
    expect(b).toMatchObject({ title: "Pushpa 2: The Rule", date: "2026-12-05", time: "21:30", seats: 3, total: 1170 });
    expect(b.theatre).toMatch(/^AMB Cinemas/);
  });

  it("reads an email laid out on lines", () => {
    const b = parseBooking("Booking confirmed\nDevara (U/A 13+)\nTelugu, 2D\nFri, 27 Sep 2024 | 10:15 AM\nPrasads Multiplex: Hyderabad\nSCREEN 3\nSeats: PRIME - D4\nTotal Amount Rs.295.00", TODAY);
    expect(b).toMatchObject({ title: "Devara", date: "2024-09-27", time: "10:15", seats: 1, total: 295 });
  });

  it("a year-less January date in November means next year", () => {
    expect(parseBooking("Booking for Test Movie (A) is confirmed. 3 Jan 6:00 PM", TODAY).date).toBe("2027-01-03");
  });

  it("matches the venue to a saved theatre", () => {
    expect(matchTheatre("PVR: Inorbit Mall, Cyberabad", ["AMB Cinemas", "PVR Inorbit", "Other"])).toBe("PVR Inorbit");
    expect(matchTheatre("Sudarshan 35mm", ["AMB Cinemas"])).toBe("");
  });
});

const mv = (o) => ({ quantity: 1, venueType: "Theatre", venueName: "", ticketPrice: 0, canteenPrice: 0, myTake: "liked", rating: 0, time: "", ...o });

describe("movie money", () => {
  it("rates each streaming app by cost per watch", () => {
    const out = subscriptionValue({
      todayIso: TODAY,
      recurring: [{ amount: "649", note: "Netflix", category: "Subscriptions" }],
      expenses: [{ amount: 1499, note: "Prime yearly", date: "2026-10-01" }, { amount: 299, note: "Hotstar", date: "2026-11-02" }],
      movies: [mv({ venueType: "OTT", venueName: "Netflix", date: "2026-11-10" }), mv({ venueType: "OTT", venueName: "Prime Video", date: "2026-11-11" }), mv({ venueType: "OTT", venueName: "Amazon Prime", date: "2026-11-12" })],
      tvShows: [{ platform: "Prime Video", status: "watching" }],
    });
    const by = Object.fromEntries(out.map((s) => [s.key, s]));
    expect(by.hotstar).toMatchObject({ uses: 0, verdict: "unused", monthly: 299 });
    expect(by.netflix).toMatchObject({ monthly: 649, uses: 1, perUse: 649, verdict: "pricey" });
    expect(by.prime).toMatchObject({ monthly: 125, uses: 3, perUse: 42, verdict: "good" });
    expect(out[0].key).toBe("hotstar"); // unused first
  });

  it("finds cheaper days, times and theatres", () => {
    const ms = [
      mv({ date: "2026-11-02", time: "11:00", ticketPrice: 150, venueName: "Asian" }), // Mon
      mv({ date: "2026-11-03", time: "12:00", ticketPrice: 150, venueName: "Asian" }), // Tue
      mv({ date: "2026-11-06", time: "19:00", ticketPrice: 350, venueName: "PVR" }),   // Fri
      mv({ date: "2026-11-07", time: "20:00", ticketPrice: 350, venueName: "PVR" }),   // Sat
    ];
    const tips = showPriceTips(ms, TODAY);
    expect(tips.map((t) => t.emoji).sort()).toEqual(["☀️", "📅", "🏟️"].sort());
    expect(tips.find((t) => t.emoji === "📅").text).toContain("57% less");
    expect(tips[0].saving).toBe(200);
  });

  it("counts films you waited to stream as money saved", () => {
    const s = savedByWaiting({
      todayIso: TODAY, nightOut: 400,
      movies: [mv({ venueType: "OTT", tmdbId: 1, date: "2026-10-30" }), mv({ venueType: "OTT", tmdbId: 2, date: "2026-10-30" })],
      meta: { 1: { releaseDate: "2026-09-25" }, 2: { releaseDate: "2019-01-01" } },
    });
    expect(s).toMatchObject({ count: 1, saved: 400, countThisYear: 1 });
  });
});

describe("goal, badges, taste, recap", () => {
  const meta = { 1: { language: "Telugu", runtime: 180, releaseDate: "2026-03-01", rating: 6 }, 2: { language: "Tamil", runtime: 120, rating: 8 }, 3: { language: "Telugu", runtime: 150, rating: 5 }, 4: { language: "Hindi", runtime: 100, rating: 7 } };
  const movies = [
    mv({ tmdbId: 1, title: "A", date: "2026-03-01", venueName: "PVR", rating: 5, ticketPrice: 300 }),
    mv({ tmdbId: 2, title: "B", date: "2026-09-10", venueName: "AMB", rating: 3, ticketPrice: 250 }),
    mv({ tmdbId: 3, title: "C", date: "2026-10-12", venueName: "PVR", rating: 4, ticketPrice: 200 }),
    mv({ tmdbId: 4, title: "D", date: "2026-11-01", venueType: "OTT", venueName: "Netflix", rating: 3 }),
  ];

  it("tracks a yearly goal, streak and badges", () => {
    const g = movieGoal({ movies, meta, goal: 24, todayIso: TODAY });
    expect(g).toMatchObject({ done: 4, goal: 24, streak: 3, pace: "behind" });
    const b = Object.fromEntries(g.badges.map((x) => [x.id, x]));
    expect(b.polyglot.earned).toBe(true);
    expect(b.fdfs.earned).toBe(true);
    expect(b.regular.earned).toBe(true);
    expect(b.hopper).toMatchObject({ have: 2, earned: false });
  });

  it("compares your stars with TMDB audiences", () => {
    const t = tasteVsCrowd({ movies, meta });
    expect(t.count).toBe(4);
    expect(t.lines[0]).toContain("Telugu");
    expect(t.lines[0]).toContain("higher");
    expect(t.biggest).toMatchObject({ title: "A", mine: 5, crowd: 6 });
  });

  it("sums up the year", () => {
    const r = yearRecap({ movies, meta, year: 2026, todayIso: TODAY });
    expect(r).toMatchObject({ viewings: 4, hours: 9, spend: 750, theatre: 3, streamed: 1, topLanguage: "Telugu", favTheatre: "PVR", topRated: { title: "A", rating: 5 } });
  });

  it("filters the tonight picker", () => {
    const wl = [{ id: 1, title: "X" }, { id: 2, title: "Y" }, { id: 3, title: "Z" }];
    const info = { 1: { runtime: 110, language: "Telugu", stream: [{ name: "Netflix" }] }, 2: { runtime: 170, language: "Telugu", stream: [{ name: "Netflix" }] }, 3: { runtime: 95, language: "Hindi", stream: [] } };
    const apps = new Set(["netflix"]);
    expect(pickPool({ watchlist: wl, info, userApps: apps, onMyApps: true, maxMinutes: 120 }).map((w) => w.title)).toEqual(["X"]);
    expect(pickPool({ watchlist: wl, info, userApps: apps, language: "Hindi" }).map((w) => w.title)).toEqual(["Z"]);
  });
});
