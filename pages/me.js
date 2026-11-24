// "Me": your level and badges, plus every page that isn't a main tab.
import { useMemo } from "react";
import Link from "next/link";
import { Flame, PiggyBank, HandCoins, Search, Settings, Trophy, Wind, ChevronRight, Award, Wallet, Users, Tv, Landmark, TrendingUp, Building2, Plane, Receipt, ListChecks, HeartPulse, Salad, CalendarClock, Bike, Gift, Target, ShoppingBag, Pill, BookOpen, Home as HomeIcon } from "lucide-react";
import { useLedger } from "../lib/useLedger";
import { computeBadges, levelFor } from "../lib/achievements";
import { sugarStreak, loggingStreak } from "../lib/ledger";
import { fmt } from "../lib/format";
import { isCard } from "../lib/money";
import { useT } from "../lib/i18n";

function Row({ href, Icon, color, title, sub }) {
  return (
    <Link href={href} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 4px", textDecoration: "none", color: "var(--ink)", borderTop: "1px solid var(--line)" }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={19} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{title}</span>
        {sub && <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>{sub}</span>}
      </span>
      <ChevronRight size={18} color="var(--muted)" />
    </Link>
  );
}

export default function MePage() {
  const { data, derived, today, loaded } = useLedger();
  const { t } = useT();
  const view = useMemo(() => {
    if (!data) return null;
    const badges = computeBadges(data, today);
    const owedToMe = data.ious.filter((i) => !i.settled && i.direction === "owed_to_me").reduce((s, i) => s + parseFloat(i.amount), 0);
    const iOwe = data.ious.filter((i) => !i.settled && i.direction === "i_owe").reduce((s, i) => s + parseFloat(i.amount), 0);
    return {
      badges, level: levelFor(badges), earned: badges.filter((b) => b.earned),
      sugar: sugarStreak(data.challengeMeta, data.challengeDays, today),
      logStreak: loggingStreak(data.expenses, today), owedToMe, iOwe,
    };
  }, [data, today]);

  if (!loaded || !view) {
    return <div className="page-container" style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px 100px" }}><div className="skeleton" style={{ height: 150, borderRadius: 22 }} /></div>;
  }
  const { level } = view;

  return (
    <div className="page-container" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 100px" }}>
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "0 0 16px" }}>{t("Me")}</h1>

      <Link href="/badges" style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{ borderRadius: 22, padding: 20, color: "#fff", background: "var(--accent-gradient)", boxShadow: "var(--accent-glow)", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800 }}>
              {level.level}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Level {level.level}</div>
              <div className="lora" style={{ fontSize: 22, fontWeight: 700 }}>{level.name}</div>
            </div>
            <Award size={26} />
          </div>
          <div style={{ height: 8, borderRadius: 5, background: "rgba(255,255,255,0.25)", marginTop: 14, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(level.progress * 100)}%`, background: "#fff", borderRadius: 5, transition: "width 0.8s var(--ease-fluid)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 6, opacity: 0.95 }}>
            <span>{level.xp} XP</span>
            <span>{level.next ? `${level.next - level.xp} XP to level ${level.level + 1}` : "Max level!"}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {view.earned.slice(-6).map((b) => (
              <span key={b.id} title={b.title} style={{ background: "rgba(255,255,255,0.22)", borderRadius: 999, padding: "4px 10px", fontSize: 13 }}>{b.emoji} {b.title}</span>
            ))}
            {view.earned.length === 0 && <span style={{ fontSize: 13, opacity: 0.9 }}>Log your first expense to earn a badge →</span>}
          </div>
        </div>
      </Link>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 18 }}>
        {[
          ["🔥", view.logStreak, "day logging streak"],
          ["🍬", view.sugar, "days sugar-free"],
          ["🏅", `${view.earned.length}/${view.badges.length}`, "badges"],
        ].map(([e, v, l]) => (
          <div key={l} className="card" style={{ padding: "12px 10px", borderRadius: 16, textAlign: "center" }}>
            <div style={{ fontSize: 18 }} aria-hidden="true">{e}</div>
            <div className="lora tabnum" style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{l}</div>
          </div>
        ))}
      </div>

      {[
        ["Money", [
          ["/transactions", Wallet, "#2F4858", "Balance & transactions", `${fmt(derived.balance)} balance`],
          ["/accounts", Landmark, "#1F5F8B", "Accounts & cards", (() => {
            const accs = (data.accounts || []).filter((a) => !a.archived);
            const cards = accs.filter(isCard).length;
            return accs.length ? `${accs.length - cards} account${accs.length - cards === 1 ? "" : "s"} · ${cards} credit card${cards === 1 ? "" : "s"}` : "Bank, UPI, cash, credit cards and bills";
          })()],
          ["/budget", PiggyBank, "#7C3AED", "Budget & goals", "Limits, savings goal, alerts"],
          ["/goals", Target, "#2F6F5E", "Goals", "Save, lose weight, build a habit: live progress"],
          ["/networth", TrendingUp, "#2F6F5E", "Net worth", "Accounts, funds (live NAV), loans"],
          ["/loans", Building2, "#5B3A5C", "Loans & EMIs", "Payoff dates and prepayment savings"],
          ["/ious", HandCoins, "#B5533C", "Who owes what", view.owedToMe || view.iOwe ? `${fmt(view.owedToMe)} owed to you · you owe ${fmt(view.iOwe)}` : "Track money between friends, settle by UPI"],
          ["/wishlist", ShoppingBag, "#A3763F", "Wishlist", "Wait 30 days before buying"],
          ["/trips", Plane, "#C98A2C", "Trips & events", "What a trip really cost, per person"],
          ["/tax", Receipt, "#6B7A3E", "Tax deductions", "80C, 80D, rent… for the financial year"],
          ["/shared", Users, "#0D9488", "Shared spaces", "Split rent, groceries or a trip with someone"],
        ]],
        ["Health & life", [
          ["/habits", ListChecks, "#2F6F5E", "Habits", "Walk, gym, read, sleep on time: streaks"],
          ["/health", HeartPulse, "#B5533C", "Health", "Weight, sleep, mood, steps, water"],
          ["/diet", Salad, "#6B7A3E", "Diet", "Indian food log, 7-day plan, shopping list"],
          ["/medical", Pill, "#B5533C", "Medical", "Medicine reminders, reports, emergency card"],
          ["/journal", BookOpen, "#4F6BED", "Journal", "A line a day, with your mood"],
          ["/sugar-challenge", Flame, "#E8731F", "No-sugar challenge", data.challengeMeta ? `${view.sugar}-day streak` : "Start a challenge"],
          ["/challenges", Trophy, "#2F6F5E", "Mini challenges", "No-delivery week, daily cap, no-spend weekend"],
        ]],
        ["Home & people", [
          ["/household", HomeIcon, "#2F4858", "Home upkeep", "Maintenance, meters, grocery list, things you own"],
          ["/renewals", CalendarClock, "#8A4B6B", "Renewals & documents", "Insurance, PUC, licence, warranties, IDs"],
          ["/vehicles", Bike, "#3F6E5B", "Vehicles", "Mileage, fuel cost, service due"],
          ["/people", Gift, "#C98A2C", "People", "Birthdays, gifts, things you lent"],
        ]],
        ["More", [
          ["/movie-corner", Trophy, "#8A4B6B", "Movie corner", "Rank films, quiz, ticket stubs, Letterboxd import"],
          ["/shows", Tv, "#4F6FB0", "Shows", "Series you're watching — next episode, where it streams"],
          ["/search", Search, "#3F6E5B", "Search", "Every expense, movie and note"],
          ["/pause", Wind, "#4F6BED", "Pause", "A moment before you spend"],
          ["/settings", Settings, "#6B6558", "Settings", "PIN, backup, theme, language, notifications"],
        ]],
      ].map(([group, rows]) => (
        <div key={group} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", margin: "0 6px 6px" }}>{t(group)}</div>
          <div className="card" style={{ borderRadius: 20, padding: "0 14px" }}>
            <div style={{ marginTop: -1 }}>
              {rows.map(([href, Icon, color, title, sub]) => <Row key={href} href={href} Icon={Icon} color={color} title={t(title)} sub={sub} />)}
            </div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
        Movie and TV data from TMDB; streaming info via JustWatch.<br />This app uses the TMDB API but is not endorsed or certified by TMDB.<br />Extra movie info (when switched on) from OMDb, Wikipedia/Wikidata (CC BY-SA), TVmaze (CC BY-SA), fanart.tv, OpenSubtitles and YouTube. Fund prices from mfapi.in; exchange rates from Frankfurter (ECB).
      </div>
    </div>
  );
}
