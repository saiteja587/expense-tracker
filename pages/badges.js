// All badges, earned and in progress, with what it takes to get each.
import { useMemo } from "react";
import Link from "next/link";
import { useLedger } from "../lib/useLedger";
import { computeBadges, levelFor } from "../lib/achievements";

export default function BadgesPage() {
  const { data, today, loaded } = useLedger();
  const badges = useMemo(() => (data ? computeBadges(data, today) : []), [data, today]);
  const level = levelFor(badges);
  const sorted = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || b.progress - a.progress);

  return (
    <div className="page-container" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 100px" }}>
      <Link href="/me" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>← Me</Link>
      <h1 className="lora gradient-title" style={{ fontSize: 28, fontWeight: 700, margin: "6px 0 4px" }}>Badges</h1>
      <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 18 }}>
        {loaded ? `${badges.filter((b) => b.earned).length} of ${badges.length} earned · Level ${level.level} ${level.name} · ${level.xp} XP` : "Loading…"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {sorted.map((b) => (
          <div key={b.id} className="card" style={{ padding: 16, borderRadius: 18, textAlign: "center", opacity: b.earned ? 1 : 0.85 }}>
            <div style={{ fontSize: 34, filter: b.earned ? "none" : "grayscale(1)", opacity: b.earned ? 1 : 0.5 }} aria-hidden="true">{b.emoji}</div>
            <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 6 }}>{b.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2, minHeight: 34 }}>{b.desc}</div>
            {b.earned ? (
              <div style={{ fontSize: 12.5, color: "var(--success)", fontWeight: 600, marginTop: 8 }}>✓ Earned · +{b.points} XP</div>
            ) : (
              <>
                <div style={{ height: 6, borderRadius: 4, background: "var(--line)", marginTop: 10, overflow: "hidden" }} aria-label={`${b.value} of ${b.target}`}>
                  <div style={{ height: "100%", width: `${Math.round(b.progress * 100)}%`, background: "var(--accent-gradient)", borderRadius: 4 }} />
                </div>
                <div className="tabnum" style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{b.value} / {b.target} · {b.points} XP</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
