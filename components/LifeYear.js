// Year page: the year outside money: habits, health, journal, trips, km
// driven, gifts and goals, as a shareable card.
import { useMemo } from "react";
import { useLife } from "../lib/useLife";
import { useLedger } from "../lib/useLedger";
import { lifeYear } from "../lib/lifePlus";

export default function LifeYear({ year }) {
  const life = useLife(["habit", "habit_log", "day_log", "fuel", "gift", "goal"]);
  const { data } = useLedger();
  const y = useMemo(() => (life.loaded ? lifeYear({ year, life: life.items, trips: data?.trips || [] }) : null), [life, data, year]);
  if (!y) return null;
  const tiles = [
    y.habitCheckins && ["✅", y.habitCheckins, "habit check-ins", y.topHabit ? `most: ${y.topHabit.name} (${y.topHabit.days} days)` : ""],
    y.weightChange != null && ["⚖️", `${y.weightChange > 0 ? "+" : ""}${y.weightChange} kg`, "weight change", ""],
    y.avgSleep && ["😴", `${y.avgSleep} h`, "average sleep", ""],
    y.moodDays && ["🙂", `${y.goodDays}/${y.moodDays}`, "good days", ""],
    y.journalEntries && ["📓", y.journalEntries, "journal entries", ""],
    y.trips && ["✈️", y.trips, y.trips === 1 ? "trip" : "trips", ""],
    y.km && ["🛵", y.km.toLocaleString("en-IN"), "km driven", ""],
    y.gifts && ["🎁", y.gifts, "gifts given", ""],
    y.goalsDone && ["🎯", y.goalsDone, "goals reached", ""],
  ].filter(Boolean);
  if (!tiles.length) return null;
  const text = `My ${year}: ${tiles.map(([e, v, l]) => `${e} ${v} ${l}`).join(" · ")}`;
  return (
    <div style={{ marginTop: 28 }}>
      <div className="lora" style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Your {year}, beyond money</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {tiles.map(([e, v, l, sub]) => (
          <div key={l} className="card" style={{ borderRadius: 16, padding: "12px 14px" }}>
            <div style={{ fontSize: 20 }} aria-hidden="true">{e}</div>
            <div className="lora tabnum" style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{l}</div>
            {sub && <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{sub}</div>}
          </div>
        ))}
      </div>
      <a className="chip" style={{ marginTop: 10, textDecoration: "none", display: "inline-flex" }} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
    </div>
  );
}
