"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function InsightRow({ label, aVal, aLabel, bVal, bLabel, direction }) {
  const diff = aVal - bVal;
  const meaningful = Math.abs(diff) >= 8; // ignore noise under 8 percentage points
  return (
    <div style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ fontSize: 14, marginBottom: 10, lineHeight: 1.5 }}>{label}</div>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
        <div>
          <div className="tabnum" style={{ fontSize: 22, fontWeight: 600, color: direction === "bad" && aVal > bVal ? "#A34A38" : "#241F1A" }}>{aVal}%</div>
          <div style={{ fontSize: 11, color: "#8a8477" }}>{aLabel}</div>
        </div>
        <div style={{ fontSize: 18, color: "#C4BDAC" }}>vs</div>
        <div>
          <div className="tabnum" style={{ fontSize: 22, fontWeight: 600 }}>{bVal}%</div>
          <div style={{ fontSize: 11, color: "#8a8477" }}>{bLabel}</div>
        </div>
        {meaningful && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: diff > 0 ? "#A34A38" : "#2F6F5E" }}>
            {diff > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {Math.abs(diff)}pt difference
          </div>
        )}
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const [expenses, setExpenses] = useState([]);
  const [movies, setMovies] = useState([]);
  const [challengeDays, setChallengeDays] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/data?type=expenses"),
      fetch("/api/data?type=movies"),
      fetch("/api/data?type=challenge"),
    ]).then(async ([e, m, c]) => {
      if (e.ok) setExpenses((await e.json()).expenses.map((x) => ({ amount: parseFloat(x.amount), date: x.expense_date.slice(0, 10) })));
      if (m.ok) setMovies((await m.json()).movies.map((x) => ({ date: x.watched_date.slice(0, 10) })));
      if (c.ok) {
        const data = await c.json();
        setChallengeDays((data.days || []).map((d) => ({ date: d.day_date.slice(0, 10), completed: d.completed })));
      }
    }).finally(() => setLoaded(true));
  }, []);

  const movieDates = useMemo(() => new Set(movies.map((m) => m.date)), [movies]);

  const dailySpend = useMemo(() => {
    const map = {};
    for (const x of expenses) map[x.date] = (map[x.date] || 0) + x.amount;
    return map;
  }, [expenses]);

  const avgDailySpend = useMemo(() => {
    const vals = Object.values(dailySpend);
    if (vals.length === 0) return 0;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }, [dailySpend]);

  const highSpendDates = useMemo(() => {
    const set = new Set();
    for (const [date, amt] of Object.entries(dailySpend)) {
      if (amt > avgDailySpend * 1.3) set.add(date);
    }
    return set;
  }, [dailySpend, avgDailySpend]);

  const stats = useMemo(() => {
    if (challengeDays.length < 6) return null;

    const movieDays = challengeDays.filter((d) => movieDates.has(d.date));
    const nonMovieDays = challengeDays.filter((d) => !movieDates.has(d.date));
    const highSpendDays = challengeDays.filter((d) => highSpendDates.has(d.date));
    const normalSpendDays = challengeDays.filter((d) => !highSpendDates.has(d.date));

    const slipRate = (arr) => (arr.length === 0 ? null : Math.round((arr.filter((d) => d.completed === false).length / arr.length) * 100));

    return {
      movieSlipRate: slipRate(movieDays),
      nonMovieSlipRate: slipRate(nonMovieDays),
      movieDaysCount: movieDays.length,
      nonMovieDaysCount: nonMovieDays.length,
      highSpendSlipRate: slipRate(highSpendDays),
      normalSpendSlipRate: slipRate(normalSpendDays),
      highSpendDaysCount: highSpendDays.length,
      normalSpendDaysCount: normalSpendDays.length,
    };
  }, [challengeDays, movieDates, highSpendDates]);

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 28, borderBottom: "1px solid #D9D2C2", paddingBottom: 20 }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
          <ArrowLeft size={12} /> Expense ledger
        </a>
        <div className="lora" style={{ fontSize: 24, fontWeight: 600 }}>Patterns</div>
        <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>
          Real connections between your money, movies, and diet — things a single-purpose app could never show you.
        </div>
      </div>

      {!stats ? (
        <div style={{ border: "1px dashed #D9D2C2", borderRadius: 4, padding: "40px 20px", textAlign: "center", color: "#8a8477", fontSize: 14 }}>
          Not enough days logged yet to find real patterns — keep marking your sugar challenge daily and this page will fill in on its own.
        </div>
      ) : (
        <>
          {stats.movieSlipRate !== null && stats.nonMovieSlipRate !== null && (
            <InsightRow
              label={`Your sugar slip-rate on days you watched a movie, vs. days you didn't.`}
              aVal={stats.movieSlipRate}
              aLabel={`slip rate on movie days (${stats.movieDaysCount})`}
              bVal={stats.nonMovieSlipRate}
              bLabel={`slip rate on other days (${stats.nonMovieDaysCount})`}
              direction="bad"
            />
          )}

          {stats.highSpendSlipRate !== null && stats.normalSpendSlipRate !== null && (
            <InsightRow
              label={`Your sugar slip-rate on days you spent well above your average, vs. normal-spend days.`}
              aVal={stats.highSpendSlipRate}
              aLabel={`slip rate on big-spend days (${stats.highSpendDaysCount})`}
              bVal={stats.normalSpendSlipRate}
              bLabel={`slip rate on normal days (${stats.normalSpendDaysCount})`}
              direction="bad"
            />
          )}

          <div style={{ fontSize: 11, color: "#8a8477", marginTop: 20, lineHeight: 1.6 }}>
            "Big-spend day" means a day you spent over 130% of your average daily spend ({fmt(avgDailySpend)}/day so far). This page only counts days you've actually marked on the No-Sugar Challenge, and differences under 8 points are treated as noise, not shown as a pattern — small samples can look meaningful by chance.
          </div>
        </>
      )}
    </div>
  );
}
