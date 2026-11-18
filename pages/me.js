// "Me": your level and badges, plus every page that isn't a main tab.
import { useMemo } from "react";
import Link from "next/link";
import { Flame, PiggyBank, HandCoins, Search, Settings, Trophy, Wind, ChevronRight, Award, Wallet, Users } from "lucide-react";
import { useLedger } from "../lib/useLedger";
import { computeBadges, levelFor } from "../lib/achievements";
import { sugarStreak, loggingStreak } from "../lib/ledger";
import { fmt } from "../lib/format";

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
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "0 0 16px" }}>Me</h1>

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

      <div className="card" style={{ borderRadius: 20, padding: "0 14px" }}>
        <div style={{ marginTop: -1 }}>
          <Row href="/sugar-challenge" Icon={Flame} color="#E8731F" title="No-sugar challenge" sub={data.challengeMeta ? `${view.sugar}-day streak` : "Start a challenge"} />
          <Row href="/challenges" Icon={Trophy} color="#2F6F5E" title="Mini challenges" sub="No-delivery week, daily cap, no-spend weekend" />
          <Row href="/budget" Icon={PiggyBank} color="#7C3AED" title="Budget & goals" sub="Limits, savings goal, alerts" />
          <Row href="/transactions" Icon={Wallet} color="#2F4858" title="Balance & transactions" sub={`${fmt(derived.balance)} balance`} />
          <Row href="/ious" Icon={HandCoins} color="#B5533C" title="Who owes what" sub={view.owedToMe || view.iOwe ? `${fmt(view.owedToMe)} owed to you · you owe ${fmt(view.iOwe)}` : "Track money between friends"} />
          <Row href="/shared" Icon={Users} color="#0D9488" title="Shared spaces" sub="Split rent, groceries or a trip with someone" />
          <Row href="/search" Icon={Search} color="#3F6E5B" title="Search" sub="Every expense, movie and note" />
          <Row href="/pause" Icon={Wind} color="#4F6BED" title="Pause" sub="A moment before you spend" />
          <Row href="/settings" Icon={Settings} color="#6B6558" title="Settings" sub="PIN, backup, theme, notifications" />
        </div>
      </div>
    </div>
  );
}
