import { describe, it, expect } from "vitest";
import { ottKey, userOttApps, onYourApps, movieStats, avgNightOut, theatreVerdict } from "../lib/movieStats";

describe("streaming apps", () => {
  it("treats different spellings of a service as one", () => {
    expect(ottKey("Disney+ Hotstar")).toBe("hotstar");
    expect(ottKey("JioHotstar")).toBe("hotstar");
    expect(ottKey("Amazon Prime Video")).toBe("prime");
    expect(ottKey("Prime Video")).toBe("prime");
    expect(ottKey("Netflix basic with Ads")).toBe("netflix");
    expect(ottKey("aha")).toBe("aha");
  });

  it("knows your apps from OTT movies and subscription payments", () => {
    const apps = userOttApps({
      todayIso: "2026-11-19",
      movies: [{ venueType: "OTT", venueName: "Amazon Prime Video", date: "2026-10-01" }, { venueType: "OTT", venueName: "Netflix", date: "2025-01-01" }],
      expenses: [{ note: "Netflix", amount: 649, date: "2026-11-03" }, { note: "Lunch", amount: 120, date: "2026-11-03" }],
    });
    expect([...apps].sort()).toEqual(["netflix", "prime"]);
    expect(onYourApps({ stream: [{ name: "Netflix" }, { name: "Netflix Kids" }, { name: "ZEE5" }] }, apps).map((p) => p.name)).toEqual(["Netflix"]);
  });
});

describe("movieStats", () => {
  const meta = {
    1: { runtime: 180, cast: ["Prabhas", "Amitabh"], directors: ["Nag Ashwin"], language: "Telugu", collection: { id: 9 } },
    2: { runtime: 120, cast: ["Prabhas", "Rana"], directors: ["Rajamouli"], language: "Telugu" },
    3: { runtime: 150, cast: ["Dulquer"], directors: ["Venky"], language: "Tamil" },
  };
  const movies = [
    { tmdbId: 1, venueType: "Theatre", ticketPrice: 300, canteenPrice: 300, quantity: 1, date: "2026-10-01", myTake: "loved" },
    { tmdbId: 2, venueType: "Theatre", ticketPrice: 200, canteenPrice: 0, quantity: 1, date: "2026-10-10", myTake: "liked" },
    { tmdbId: 3, venueType: "OTT", ticketPrice: 0, canteenPrice: 0, quantity: 1, date: "2026-11-01", myTake: "liked" },
    { tmdbId: null, venueType: "Theatre", ticketPrice: 150, canteenPrice: 0, quantity: 1, date: "2026-11-02", myTake: "okay" },
  ];
  const collections = { 9: { name: "Kalki Collection", parts: [{ tmdbId: 1, title: "Kalki", releaseDate: "2024-06-27" }, { tmdbId: 7, title: "Kalki 2", releaseDate: "2026-05-01" }, { tmdbId: 8, title: "Kalki 3", releaseDate: "2029-01-01" }] } };
  const s = movieStats({ movies, meta, collections, todayIso: "2026-11-19", expenses: [{ note: "Netflix", amount: 649, date: "2026-11-05" }] });

  it("adds up hours and cost per hour (unmatched movies don't skew it)", () => {
    expect(s.hours).toBe(8); // 450 min
    expect(s.theatreHours).toBe(5);
    expect(s.costPerHourTheatre).toBe(160); // ₹800 over 5 hours
    expect(s.costPerHourOtt).toBe(260); // ₹649 over 2.5 hours
  });

  it("finds favourite people, languages and franchise progress", () => {
    expect(s.topActors).toEqual([{ name: "Prabhas", count: 2 }]);
    expect(s.languages[0]).toEqual({ name: "Telugu", count: 2, pct: 67 });
    expect(s.franchises).toEqual([{ name: "Kalki Collection", seen: 1, total: 2, next: { tmdbId: 7, title: "Kalki 2", releaseDate: "2026-05-01" } }]);
    expect(s.matched).toBe(3);
    expect(s.total).toBe(4);
  });

  it("average night out", () => {
    expect(avgNightOut(movies)).toBe(317);
    expect(avgNightOut([])).toBeNull();
  });
});

describe("theatre or wait?", () => {
  const base = { todayIso: "2026-11-19", nightOut: 780 };
  it("says go for strong films, wait for weak ones, stream if you have it", () => {
    expect(theatreVerdict({ ...base, rating: 8.1, releaseDate: "2026-11-14" }).verdict).toBe("go");
    const w = theatreVerdict({ ...base, rating: 6.1, releaseDate: "2026-11-14" });
    expect(w.verdict).toBe("wait");
    expect(w.text).toContain("₹780");
    expect(w.text).toContain("12 Dec"); // ~4 weeks after release
    expect(theatreVerdict({ ...base, rating: 7.1, releaseDate: "2026-11-14", lovedGenre: true }).verdict).toBe("go");
    expect(theatreVerdict({ ...base, rating: 7.0, releaseDate: "2026-11-14" }).verdict).toBe("maybe");
    expect(theatreVerdict({ ...base, rating: 5, releaseDate: "2026-11-14", onYourApps: [{ name: "Netflix" }] }).verdict).toBe("stream");
  });
});
