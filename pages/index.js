// Home: one clear story for today. A ring with what's left to spend today,
// swipeable cards for money / sugar / movies / goal / challenge, the most
// useful insight, and today's entries. Everything detailed lives one tap away.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { WELCOMED_KEY } from "../lib/useLedger";
import { getAccount } from "../lib/account";
import Link from "next/link";
import { Search, ChevronRight, Check, X as XIcon, Sparkles, Wallet, Flame, Clapperboard, Target, Trophy } from "lucide-react";
import { useLedger, notifyLedgerChanged } from "../lib/useLedger";
import { todayBudget, sugarStreak, loggingStreak, itemsInMonth, ymOf, movieStatus } from "../lib/ledger";
import { generateInsights } from "../lib/insights";
import { affordability } from "../lib/smart";
import { seasonFor } from "../lib/festivals";
import { TRIGGERS } from "../lib/slipTriggers";
import { evaluateChallenge } from "../lib/miniChallenges";
import { categoryColor } from "../lib/categories";
import { fmt, greeting, dayLabel } from "../lib/format";
import { openQuickAdd } from "../components/QuickAddSheet";
import NeedsYou from "../components/NeedsYou";
import CategoryIcon from "../components/CategoryIcon";
import CountUp from "../components/CountUp";
import PullToRefresh from "../components/PullToRefresh";
import { showToast } from "../lib/toast";
import { vibrate } from "../lib/haptics";

function Ring({ pct, color, size = 200, stroke = 16, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--line)" }} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ stroke: color, transition: "stroke-dashoffset 0.9s var(--ease-fluid), stroke 0.4s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        {children}
      </div>
    </div>
  );
}

function Card({ href, icon, title, children, accent, onClick }) {
  const body = (
    <div className="card home-card" style={{ padding: 16, minHeight: 132, display: "flex", flexDirection: "column", gap: 6, borderRadius: 20, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: accent || "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
  if (onClick) return <div onClick={onClick} style={{ cursor: "pointer" }}>{body}</div>;
  return href ? <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block", height: "100%" }}>{body}</Link> : body;
}

export default function Home() {
  const { data, derived, today, loaded, error, refresh } = useLedger();
  const [marking, setMarking] = useState(false);
  const [affordOpen, setAffordOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [askTrigger, setAskTrigger] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [coins, setCoins] = useState(false);
  const prevLeft = useRef(null);
  const prevBalance = useRef(null);
  const router = useRouter();
  const [myName, setMyName] = useState("");
  useEffect(() => {
    const n = getAccount()?.name || "";
    setMyName(n && n.toLowerCase() !== "me" ? n.split(" ")[0] : "");
  }, []);

  // Brand-new user (nothing logged, no balance, never welcomed): set up first.
  useEffect(() => {
    if (!data) return;
    let welcomed = "1";
    try { welcomed = localStorage.getItem(WELCOMED_KEY); } catch { /* ignore */ }
    if (!welcomed && data.expenses.length === 0 && data.topups.length === 0 && data.movies.length === 0) router.replace("/welcome");
  }, [data, router]);

  const view = useMemo(() => {
    if (!data || !derived) return null;
    const budget = todayBudget({ items: derived.items, balance: derived.balance, todayIso: today, hasMoney: derived.hasMoney });
    const ym = ymOf(today);
    const monthItems = itemsInMonth(derived.items, ym);
    const todayItems = derived.items.filter((x) => x.date === today).sort((a, b) => (b.time || "").localeCompare(a.time || ""));
    const upcoming = derived.items.filter((x) => x.date > today && x.date <= ymOf(today) + "-31").sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
    const streak = sugarStreak(data.challengeMeta, data.challengeDays, today);
    const sugarToday = data.challengeDays[today];
    const moviesMonth = data.movies.filter((m) => ymOf(m.date) === ym);
    const insight = generateInsights({ items: derived.items, movies: data.movies, todayIso: today })[0] || null;
    const challenge = (data.miniChallenges || [])
      .filter((c) => !c.dismissed)
      .map((c) => evaluateChallenge(c, derived.items, today))
      .filter(Boolean)
      .find((c) => c.status === "active" || c.status === "upcoming") || null;
    const overall = data.rules.find((r) => r.ruleType === "overall");
    const overBudget = overall && budget.spentMonth > overall.amount;
    const nextMovie = data.movies.filter((m) => movieStatus(m) === "upcoming").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null;
    return { nextMovie, budget, monthItems, todayItems, upcoming, streak, sugarToday, moviesMonth, insight, challenge, overall, overBudget, logStreak: loggingStreak(data.expenses, today) };
  }, [data, derived, today]);

  async function markSugar(completed, reason = "") {
    setMarking(true);
    vibrate(10);
    try {
      const res = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "challenge-day", date: today, completed, reason }) });
      if (!res.ok) throw new Error();
      if (reason) showToast("Noted — spotting the pattern helps 💡", "💪");
      else showToast(completed ? "Sugar-free today — streak +1" : "Logged. Tomorrow's a fresh start.", completed ? "🔥" : "💪");
      setAskTrigger(!completed && !reason);
      notifyLedgerChanged();
    } catch {
      showToast("Couldn't save that — try again", "⚠️");
    } finally {
      setMarking(false);
    }
  }

  // App-icon badge = rupees left today (Android shows a dot, iOS the number).
  useEffect(() => {
    if (!view || typeof navigator === "undefined" || !navigator.setAppBadge) return;
    const left = Math.round(view.budget.left);
    if (view.budget.hasMoney && left > 0) navigator.setAppBadge(left).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  }, [view]);

  // Little reactions: the ring pulses when you spend, coins drop when money comes in.
  useEffect(() => {
    if (!view || !derived) return;
    if (prevLeft.current !== null && view.budget.left < prevLeft.current - 0.5) {
      setPulse(true);
      setTimeout(() => setPulse(false), 900);
    }
    if (prevBalance.current !== null && derived.balance > prevBalance.current + 0.5) {
      setCoins(true);
      setTimeout(() => setCoins(false), 1600);
    }
    prevLeft.current = view.budget.left;
    prevBalance.current = derived.balance;
  }, [view, derived]);

  if (!loaded || !view) {
    return (
      <div className="page-container home" style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px 100px" }}>
        <div className="skeleton" style={{ height: 22, width: 160, marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 200, width: 200, borderRadius: "50%", margin: "0 auto 28px" }} />
        <div className="skeleton" style={{ height: 132, marginBottom: 16, borderRadius: 20 }} />
        <div className="skeleton" style={{ height: 60, marginBottom: 10 }} />
      </div>
    );
  }

  const { budget } = view;
  const ringColor = !budget.hasMoney ? "var(--line-strong)" : budget.level === 2 ? "var(--danger)" : budget.level === 1 ? "var(--warn)" : "var(--success)";
  const ringPct = budget.hasMoney && budget.perDay > 0 ? Math.max(0, budget.left) / budget.perDay : 0;
  const dateLine = new Date(today + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const showWrapped = Number(today.slice(8, 10)) <= 7 && data.expenses.length > 0;
  const season = seasonFor(today);
  const afford = affordOpen ? affordability(budget, price, { goal: data.savingsGoal, balance: derived.balance }) : null;

  return (
    <div className="page-container home" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 100px" }}>
      <PullToRefresh onRefresh={refresh}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{dateLine}</div>
            <h1 className="lora" style={{ fontSize: 26, fontWeight: 700, margin: "2px 0 0", letterSpacing: "-0.01em" }}>
              {season?.greeting || greeting()}{myName ? `, ${myName}` : ""} <span aria-hidden="true" className={season ? "season-emoji" : ""}>{season?.emoji || "👋"}</span>
            </h1>
          </div>
          <Link href="/search" className="icon-btn" aria-label="Search" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
            <Search size={19} />
          </Link>
        </header>

        {error && <div role="status" style={{ background: "var(--warn-bg)", color: "var(--ink)", padding: "10px 14px", borderRadius: 12, fontSize: 13, margin: "10px 0" }}>{error}</div>}

        {/* Today ring */}
        <section aria-label="Today's budget" style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "18px 0 22px" }}>
          <div className={pulse ? "ring-pulse" : ""}>
          <Ring pct={ringPct} color={ringColor}>
            {budget.hasMoney ? (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{budget.left >= 0 ? "Left today" : "Over today by"}</div>
                <div className="lora tabnum" style={{ fontSize: 36, fontWeight: 700, color: budget.level === 2 ? "var(--danger)" : "var(--ink)", lineHeight: 1.1 }}>
                  <CountUp value={Math.abs(budget.left)} format={fmt} />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>of {fmt(budget.perDay)} / day</div>
              </>
            ) : (
              <>
                <Wallet size={26} color="var(--muted)" />
                <div style={{ fontSize: 13, color: "var(--text-2)", maxWidth: 140, marginTop: 6 }}>Add your balance to get a daily budget</div>
              </>
            )}
          </Ring>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", justifyContent: "center" }}>
            <span className="chip" style={{ cursor: "default" }}>Spent today · <b className="tabnum">{fmt(budget.spentToday)}</b></span>
            {budget.hasMoney ? (
              <button type="button" className="chip" onClick={() => { setAffordOpen(true); setPrice(""); }}>🤔 Can I afford it?</button>
            ) : (
              <Link href="/transactions?topup=1" className="btn btn-primary" style={{ textDecoration: "none", minHeight: 36 }}>Add money</Link>
            )}
          </div>
        </section>

        <NeedsYou data={data} derived={derived} today={today} focusBill={router.query.bill} />

        {/* Insight of the day */}
        {view.insight && (
          <Link href="/insights" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 16px", borderRadius: 18, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }} aria-hidden="true">{view.insight.emoji}</span>
              <div style={{ fontSize: 14, lineHeight: 1.4, flex: 1 }}>{view.insight.text}</div>
              <ChevronRight size={18} color="var(--muted)" />
            </div>
          </Link>
        )}

        {showWrapped && (
          <Link href="/wrapped" style={{ textDecoration: "none" }}>
            <div className="wrapped-banner" style={{ borderRadius: 18, padding: "14px 16px", marginBottom: 16, color: "#fff", background: "var(--accent-gradient)", display: "flex", alignItems: "center", gap: 10, boxShadow: "var(--accent-glow)" }}>
              <Sparkles size={22} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Your month, wrapped</div>
                <div style={{ fontSize: 12, opacity: 0.9 }}>Last month's story is ready — tap to watch</div>
              </div>
              <ChevronRight size={20} />
            </div>
          </Link>
        )}

        {/* Swipeable cards */}
        <div className="h-scroll home-cards" data-no-tab-swipe="1" style={{ scrollSnapType: "x mandatory", scrollPaddingInline: 20, margin: "0 -20px 20px", padding: "4px 20px 10px", gap: 12 }}>
          <div style={{ flex: "0 0 78%", scrollSnapAlign: "start" }}>
            <Card href="/transactions" icon={<Wallet size={14} />} title="Money">
              <div className="lora tabnum" style={{ fontSize: 28, fontWeight: 700, color: derived.balance < 0 ? "var(--danger)" : "var(--ink)" }}>{fmt(derived.balance)}</div>
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>balance · {fmt(budget.spentMonth)} spent this month</div>
              {view.overall && (
                <div style={{ marginTop: "auto" }}>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (budget.spentMonth / view.overall.amount) * 100)}%`, background: view.overBudget ? "var(--danger)" : "var(--success)", borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: view.overBudget ? "var(--danger)" : "var(--muted)", marginTop: 4 }}>
                    {view.overBudget ? `Over your ${fmt(view.overall.amount)} limit` : `${fmt(view.overall.amount - budget.spentMonth)} left of ${fmt(view.overall.amount)} limit`}
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div style={{ flex: "0 0 78%", scrollSnapAlign: "start" }}>
            <Card href={data.challengeMeta ? undefined : "/sugar-challenge"} icon={<Flame size={14} />} title="Sugar-free" accent="var(--warn)">
              {data.challengeMeta ? (
                <>
                  <Link href="/sugar-challenge" style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="lora tabnum" style={{ fontSize: 28, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      {view.streak} <span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-2)" }}>day streak</span>
                      <span aria-hidden="true" className="flame-grow" style={{ fontSize: 16 + Math.min(view.streak, 30) * 0.7 }}>🔥</span>
                    </div>
                  </Link>
                  {askTrigger && view.sugarToday === false ? (
                    <div style={{ marginTop: "auto" }}>
                      <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 6 }}>What triggered it? (optional)</div>
                      <div className="h-scroll">
                        {TRIGGERS.map((t) => (
                          <button key={t.id} type="button" className="chip" disabled={marking} onClick={() => markSugar(false, t.label)}>{t.emoji} {t.label}</button>
                        ))}
                      </div>
                    </div>
                  ) : view.sugarToday === undefined ? (
                    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                      <button type="button" className="btn btn-primary" disabled={marking} onClick={() => markSugar(true)} style={{ flex: 1, minHeight: 40, fontSize: 13 }}><Check size={15} /> Sugar-free</button>
                      <button type="button" className="btn btn-secondary" disabled={marking} onClick={() => markSugar(false)} style={{ flex: 1, minHeight: 40, fontSize: 13 }}><XIcon size={15} /> Slipped</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: view.sugarToday ? "var(--success)" : "var(--danger)", marginTop: "auto" }}>
                      {view.sugarToday ? "✓ Today marked sugar-free" : "Today marked as a slip"}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Try a no-sugar challenge</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>One tap a day. Watch the streak grow.</div>
                </>
              )}
            </Card>
          </div>

          <div style={{ flex: "0 0 78%", scrollSnapAlign: "start" }}>
            <Card href="/movies" icon={<Clapperboard size={14} />} title="Movies" accent="#B0567F">
              <div className="lora tabnum" style={{ fontSize: 28, fontWeight: 700 }}>{view.moviesMonth.length} <span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-2)" }}>this month</span></div>
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                {view.nextMovie ? <>🎟️ Next: <b>{view.nextMovie.title}</b> · {dayLabel(view.nextMovie.date, today)}</>
                  : data.movies[0] ? <>Last: <b>{data.movies[0].title}</b></> : "Log the movies you watch and what you thought."}
              </div>
            </Card>
          </div>

          {data.savingsGoal && data.savingsGoal.targetAmount > 0 && (
            <div style={{ flex: "0 0 78%", scrollSnapAlign: "start" }}>
              <Card href="/budget" icon={<Target size={14} />} title="Goal" accent="var(--accent-solid)">
                {coins && <div className="coin-drop" aria-hidden="true"><span>🪙</span><span>🪙</span><span>🪙</span></div>}
                <div style={{ fontSize: 16, fontWeight: 600 }}>{data.savingsGoal.label || "Savings goal"}</div>
                <div className="lora tabnum" style={{ fontSize: 24, fontWeight: 700 }}>{Math.min(100, Math.max(0, Math.round((derived.balance / data.savingsGoal.targetAmount) * 100)))}%</div>
                <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                  {derived.balance >= data.savingsGoal.targetAmount ? "🎉 Reached! Set your next goal below." : `${fmt(Math.max(0, derived.balance))} of ${fmt(data.savingsGoal.targetAmount)}`}
                </div>
              </Card>
            </div>
          )}

          <div style={{ flex: "0 0 78%", scrollSnapAlign: "start" }}>
            <Card href="/challenges" icon={<Trophy size={14} />} title="Challenge" accent="var(--success)">
              {view.challenge ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{view.challenge.emoji} {view.challenge.title}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }} aria-label={`Day ${view.challenge.day} of ${view.challenge.days}`}>
                    {view.challenge.dayStates.map((s, i) => (
                      <span key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: s === "ok" ? "var(--success)" : s === "broken" ? "var(--danger)" : s === "today" ? "var(--warn)" : "var(--line)" }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: "auto" }}>
                    {view.challenge.status === "upcoming" ? `Starts ${dayLabel(view.challenge.start, today)}` : `Day ${view.challenge.day} of ${view.challenge.days} — keep going`}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Pick a mini challenge</div>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>No-delivery week, daily cap, no-spend weekend…</div>
                </>
              )}
            </Card>
          </div>
        </div>

        {/* Today */}
        <section aria-label="Today's entries">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Today</h2>
            <Link href="/transactions" style={{ fontSize: 13, color: "var(--accent-solid)", textDecoration: "none", fontWeight: 600 }}>All transactions →</Link>
          </div>
          {view.todayItems.length === 0 ? (
            <button type="button" onClick={() => openQuickAdd()} className="card" style={{ width: "100%", border: "none", padding: "22px 16px", borderRadius: 18, textAlign: "center", cursor: "pointer", color: "var(--text-2)", fontSize: 14 }}>
              Nothing logged today yet.<br />
              <span style={{ color: "var(--accent-solid)", fontWeight: 600 }}>Tap to add your first expense</span>
              {view.logStreak > 1 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Keep your {view.logStreak}-day logging streak alive 🔥</div>}
            </button>
          ) : (
            <div className="card" style={{ borderRadius: 18, padding: "4px 14px" }}>
              {view.todayItems.map((x, i) => (
                <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <CategoryIcon category={x.category} color={categoryColor(x.category, data.customCategories)} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.note || x.category}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{x.category}{x.time ? ` · ${x.time}` : ""}{x.isRecurringPending ? " · scheduled" : ""}</div>
                  </div>
                  <div className="tabnum" style={{ fontWeight: 600, fontSize: 15 }}>{x.estimate ? "≈" : ""}{fmt(x.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {view.upcoming.length > 0 && (
          <section aria-label="Coming up" style={{ marginTop: 20 }}>
            <h2 className="section-title" style={{ fontSize: 15 }}>Coming up this month</h2>
            {view.upcoming.map((x) => (
              <div key={x.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0", color: "var(--text-2)" }}>
                <span>{dayLabel(x.date, today)} · {x.note || x.category}</span>
                <span className="tabnum">{x.estimate ? "≈" : ""}{fmt(x.amount)}</span>
              </div>
            ))}
          </section>
        )}
      </PullToRefresh>

      {afford && (
        <>
          <div className="sheet-scrim" onClick={() => setAffordOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Can I afford it?" data-no-tab-swipe="1">
            <div className="sheet-handle" />
            <div className="lora" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Can I afford it? 🤔</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Type a price — see what it does to your daily budget.</div>
            <input autoFocus type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="₹ price, e.g. 4500" aria-label="Price" style={{ fontSize: 22, padding: "12px 14px" }} />
            {afford.verdict !== "enter" && (
              <div className="card" style={{ marginTop: 14, padding: 16, borderRadius: 18, borderLeft: `5px solid ${afford.verdict === "yes" ? "var(--success)" : afford.verdict === "tight" ? "var(--warn)" : "var(--danger)"}` }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {afford.verdict === "yes" ? "✅ Yes, comfortably" : afford.verdict === "tight" ? "⚠️ Yes, but it's tight" : "❌ Not this month"}
                </div>
                <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>
                  {afford.verdict === "no"
                    ? <>You&apos;d be short by <b>{fmt(afford.shortBy)}</b> before the month ends.</>
                    : <>Your daily budget goes from <b>{fmt(afford.perDayBefore)}</b> to <b>{fmt(afford.perDayAfter)}</b> for the next {budget.daysLeft} days.</>}
                  {afford.goalAfter !== null && <><br />Savings goal would be at <b>{Math.round(afford.goalAfter * 100)}%</b>.</>}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setAffordOpen(false)}>Close</button>
              {afford.verdict !== "enter" && afford.verdict !== "no" && (
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setAffordOpen(false); openQuickAdd({ amount: afford.price, category: "Shopping" }); }}>I bought it — log it</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
