"use client";

import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmt(n) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export default function YearPage() {
  const [expenses, setExpenses] = useState([]);
  const [movies, setMovies] = useState([]);
  const [challengeDays, setChallengeDays] = useState([]);
  const [topups, setTopups] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    Promise.all([
      fetch("/api/data?type=expenses"),
      fetch("/api/data?type=movies"),
      fetch("/api/data?type=challenge"),
      fetch("/api/data?type=balance"),
    ])
      .then(async ([e, m, c, b]) => {
        if (e.ok) setExpenses((await e.json()).expenses || []);
        if (m.ok) setMovies((await m.json()).movies || []);
        if (c.ok) setChallengeDays((await c.json()).days || []);
        if (b.ok) setTopups((await b.json()).topups || []);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Net worth / savings trend: approximate balance as of the end of each
  // month, using the latest "set current balance" entry (if any) as a
  // baseline and adding/subtracting everything after it.
  const balanceAsOf = useMemo(() => {
    const spendItems = [
      ...expenses.filter((x) => x.affects_balance !== false).map((x) => ({ date: x.expense_date.slice(0, 10), amount: parseFloat(x.amount) })),
      ...movies.filter((m) => m.affects_balance !== false).map((m) => ({
        date: m.watched_date.slice(0, 10),
        amount: (parseFloat(m.ticket_price) + parseFloat(m.canteen_price)) * (m.quantity || 1),
      })),
    ];
    return (dateStr) => {
      const setTopups = topups.filter((t) => t.mode === "set" && t.topup_date.slice(0, 10) <= dateStr);
      const baseline = setTopups.length > 0
        ? [...setTopups].sort((a, b) => (a.topup_date < b.topup_date ? 1 : -1))[0]
        : null;
      const startDate = baseline ? baseline.topup_date.slice(0, 10) : null;
      const addTotal = topups
        .filter((t) => t.mode === "add" && t.topup_date.slice(0, 10) <= dateStr && (!startDate || t.topup_date.slice(0, 10) > startDate))
        .reduce((s, t) => s + parseFloat(t.amount), 0);
      const spendTotal = spendItems
        .filter((x) => x.date <= dateStr && (!startDate || x.date > startDate))
        .reduce((s, x) => s + x.amount, 0);
      const base = baseline ? parseFloat(baseline.amount) : 0;
      return base + addTotal - spendTotal;
    };
  }, [expenses, movies, topups]);

  const monthly = useMemo(() => {
    const rows = MONTH_SHORT.map((label, idx) => ({
      month: label,
      spend: 0,
      movieSpend: 0,
      movieCount: 0,
      sugarFreeDays: 0,
      slipDays: 0,
    }));
    for (const x of expenses) {
      const d = new Date(x.expense_date);
      if (d.getFullYear() !== year) continue;
      rows[d.getMonth()].spend += parseFloat(x.amount);
    }
    for (const m of movies) {
      const d = new Date(m.watched_date);
      if (d.getFullYear() !== year) continue;
      const qty = m.quantity || 1;
      const amt = (parseFloat(m.ticket_price) + parseFloat(m.canteen_price)) * qty;
      rows[d.getMonth()].movieSpend += amt;
      rows[d.getMonth()].spend += amt;
      rows[d.getMonth()].movieCount += qty;
    }
    for (const d of challengeDays) {
      const dt = new Date(d.day_date);
      if (dt.getFullYear() !== year) continue;
      if (d.completed) rows[dt.getMonth()].sugarFreeDays++;
      else rows[dt.getMonth()].slipDays++;
    }
    for (let m = 0; m < 12; m++) {
      const lastDay = new Date(year, m + 1, 0).getDate();
      const monthEnd = `${year}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      rows[m].balance = Math.round(balanceAsOf(monthEnd));
    }
    return rows;
  }, [expenses, movies, challengeDays, year, balanceAsOf]);

  const totals = useMemo(() => {
    return monthly.reduce(
      (acc, r) => ({
        spend: acc.spend + r.spend,
        movieSpend: acc.movieSpend + r.movieSpend,
        movieCount: acc.movieCount + r.movieCount,
        sugarFreeDays: acc.sugarFreeDays + r.sugarFreeDays,
        slipDays: acc.slipDays + r.slipDays,
      }),
      { spend: 0, movieSpend: 0, movieCount: 0, sugarFreeDays: 0, slipDays: 0 }
    );
  }, [monthly]);

  if (!loaded) {
    return <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8a8477" }}>Loading…</div>;
  }

  return (
    <div className="page-container" style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 64px" }}>
      <div style={{ marginBottom: 28, borderBottom: "1px solid #D9D2C2", paddingBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8a8477", textDecoration: "none", marginBottom: 6 }}>
            <ArrowLeft size={12} /> Expense ledger
          </a>
          <div className="lora" style={{ fontSize: 24, fontWeight: 600 }}>Year view</div>
          <div style={{ fontSize: 13, color: "#8a8477", marginTop: 2 }}>Money, movies and diet across the whole year.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => setYear(year - 1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }} aria-label="Previous year"><ChevronLeft size={18} /></button>
          <div className="tabnum" style={{ fontSize: 16, fontWeight: 600, minWidth: 60, textAlign: "center" }}>{year}</div>
          <button onClick={() => setYear(year + 1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "#5f5a4f" }} aria-label="Next year"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        <div className="panel-soft" style={{ flex: "1 1 140px", borderRadius: 6, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "#8a8477" }}>Total spend</div>
          <div className="lora tabnum" style={{ fontSize: 20, fontWeight: 600 }}>{fmt(totals.spend)}</div>
        </div>
        <div className="panel-soft" style={{ flex: "1 1 140px", borderRadius: 6, padding: "14px 16px", background: "#F7ECF1" }}>
          <div style={{ fontSize: 11, color: "#8a8477" }}>Movies</div>
          <div className="lora tabnum" style={{ fontSize: 20, fontWeight: 600, color: "#7A3E56" }}>{totals.movieCount} · {fmt(totals.movieSpend)}</div>
        </div>
        <div className="panel-soft" style={{ flex: "1 1 140px", borderRadius: 6, padding: "14px 16px", background: "#EAF3EF" }}>
          <div style={{ fontSize: 11, color: "#8a8477" }}>Sugar-free days</div>
          <div className="lora tabnum" style={{ fontSize: 20, fontWeight: 600, color: "#2F6F5E" }}>{totals.sugarFreeDays}</div>
        </div>
        <div className="panel-soft" style={{ flex: "1 1 140px", borderRadius: 6, padding: "14px 16px", background: "#FAECE7" }}>
          <div style={{ fontSize: 11, color: "#8a8477" }}>Slip days</div>
          <div className="lora tabnum" style={{ fontSize: 20, fontWeight: 600, color: "#A34A38" }}>{totals.slipDays}</div>
        </div>
      </div>

      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 20 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Monthly spend</div>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#EAE5D9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #EAE5D9" }} />
              <Line type="monotone" dataKey="spend" name="Total spend" stroke="#A34A38" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="movieSpend" name="Movie spend" stroke="#8C4470" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 20 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Balance over the year</div>
        <div style={{ fontSize: 11, color: "#8a8477", marginBottom: 10 }}>Approximate balance at the end of each month — a rough net-worth trend, not exact for months before a "set current balance" entry.</div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#EAE5D9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} width={60} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #EAE5D9" }} />
              <Line type="monotone" dataKey="balance" name="Balance" stroke="#2F6F5E" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px", marginBottom: 20 }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Movies per month</div>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#EAE5D9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #EAE5D9" }} />
              <Line type="monotone" dataKey="movieCount" name="Movies watched" stroke="#7A3E56" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ border: "1px solid #EAE5D9", borderRadius: 6, padding: "16px 18px" }}>
        <div className="lora" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Sugar-free vs. slip days</div>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#EAE5D9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8a8477" }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #EAE5D9" }} />
              <Line type="monotone" dataKey="sugarFreeDays" name="Sugar-free" stroke="#2F6F5E" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="slipDays" name="Slips" stroke="#A34A38" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
