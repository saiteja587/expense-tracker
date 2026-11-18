// One shared, cached copy of the app's data for every screen.
//
// The first screen to mount fetches everything; later screens render the
// cached copy instantly and refresh in the background. Any save calls
// notifyLedgerChanged() and every mounted screen refetches.
import { useCallback, useEffect, useMemo, useState } from "react";
import { mapExpense, mapMovie, mapTopup, mapRule, movieItems, recurringPending, balanceOf, isoOf } from "./ledger";

const EVENT = "ledger:changed";
export const WELCOMED_KEY = "welcomed_v1";
const CACHE_KEY = "cache_ledger_v2";
let memory = null;
let inflight = null;

export function notifyLedgerChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

async function fetchJson(type) {
  const res = await fetch(`/api/data?type=${type}`);
  if (!res.ok) throw new Error(`${type}: ${res.status}`);
  return res.json();
}

async function fetchAll() {
  const [exp, mov, bal, rules, chal, cats, rec, goal, ious, minis] = await Promise.all([
    fetchJson("expenses"), fetchJson("movies"), fetchJson("balance"), fetchJson("budget"), fetchJson("challenge"),
    fetchJson("categories"), fetchJson("recurring"), fetchJson("savings-goal"), fetchJson("ious"),
    fetchJson("mini-challenges").catch(() => ({ challenges: [] })),
  ]);
  const challengeDays = {};
  for (const d of chal.days || []) challengeDays[String(d.day_date).slice(0, 10)] = d.completed;
  return {
    expenses: exp.expenses.map(mapExpense),
    movies: mov.movies.map(mapMovie),
    topups: bal.topups.map(mapTopup),
    rules: rules.rules.map(mapRule),
    challengeMeta: chal.meta || null,
    challengeDays,
    challengeHistory: chal.history || [],
    customCategories: cats.categories || [],
    recurring: rec.recurring || [],
    savingsGoal: goal.goal || null,
    ious: ious.ious || [],
    miniChallenges: minis.challenges || [],
  };
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

export function useLedger() {
  const [data, setData] = useState(memory);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      inflight = inflight || fetchAll();
      const fresh = await inflight;
      memory = fresh;
      setData(fresh);
      setError("");
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch { /* storage full */ }
    } catch (e) {
      if (!memory) {
        const cached = readCache();
        if (cached) { memory = cached; setData(cached); }
      }
      setError(memory ? "You're offline — showing what was last saved." : "Couldn't load your data. Check your connection.");
    } finally {
      inflight = null;
    }
  }, []);

  useEffect(() => {
    if (!memory) {
      const cached = readCache();
      if (cached) { memory = cached; setData(cached); }
    }
    refresh();
    window.addEventListener(EVENT, refresh);
    return () => window.removeEventListener(EVENT, refresh);
  }, [refresh]);

  const today = isoOf(new Date());
  const derived = useMemo(() => {
    if (!data) return null;
    const items = [...data.expenses, ...movieItems(data.movies), ...recurringPending(data.recurring, today)];
    const bal = balanceOf(data.topups, items, today);
    return { items, ...bal, hasMoney: data.topups.length > 0 };
  }, [data, today]);

  return { data, derived, today, loaded: !!data, error, refresh };
}
