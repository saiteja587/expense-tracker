import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import "../styles/globals.css";
import { flushQueue, getQueue } from "../lib/offlineQueue";
import { showToast } from "../lib/toast";
import { isSessionValid, extendSession, clearSession } from "../lib/unlockSession";
import { vibrate } from "../lib/haptics";
import { applyTheme, getTheme } from "../lib/theme";
import { Home, Clapperboard, BarChart3, UserRound, Plus, Download, X, Fingerprint, Delete } from "lucide-react";
import QuickAddSheet, { openQuickAdd } from "../components/QuickAddSheet";
import { parseExpenseText } from "../lib/smsParse";
import { todayISO } from "../lib/format";
import { notifyLedgerChanged } from "../lib/useLedger";

const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
  { href: "/movies", label: "Movies", Icon: Clapperboard },
  { href: "/me", label: "Me", Icon: UserRound },
];

// Which tab a page belongs to, so sub-pages keep their parent tab lit.
const TAB_FOR_PATH = {
  "/transactions": "/",
  "/report": "/insights", "/year": "/insights", "/wrapped": "/insights",
  "/budget": "/me", "/sugar-challenge": "/me", "/settings": "/me", "/ious": "/me",
  "/search": "/me", "/pause": "/me", "/badges": "/me", "/challenges": "/me",
};
// Full-screen pages with no nav bar or top bar.
const IMMERSIVE = new Set(["/wrapped", "/welcome"]);

export function tabFor(path) {
  return TAB_FOR_PATH[path] || path;
}

// The API answers 401 once the server-side session is missing or expired
// (e.g. the PIN was changed on another device). Watch every API call in one
// place and tell the app to show the lock screen, instead of each page
// having to handle it.
const AUTH_REQUIRED_EVENT = "ledger:auth-required";
if (typeof window !== "undefined" && !window.__ledgerFetchWrapped) {
  window.__ledgerFetchWrapped = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (res.status === 401 && url.includes("/api/data")) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    return res;
  };
}

async function fetchSession() {
  const r = await fetch("/api/data?type=session");
  return r.json(); // { hasPin, authenticated }
}

// Which way the next page should slide in. Set just before navigating by
// a tab tap or a swipe, read when the new page mounts.
let navDirection = "";
function goToTab(router, href, fromHref) {
  const a = NAV_ITEMS.findIndex((i) => i.href === fromHref);
  const b = NAV_ITEMS.findIndex((i) => i.href === href);
  navDirection = b > a ? "from-right" : "from-left";
  vibrate(6);
  router.push(href);
}

// Emojis that mark something genuinely worth celebrating (a save, a
// milestone) — plain errors and info toasts don't get confetti.
const CELEBRATE = new Set(["✅", "💰", "🔥", "🎉", "🏆", "✨", "📥"]);

function makeBurst() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const dots = Array.from({ length: 18 }, (_, i) => {
    const angle = (Math.PI * (0.1 + 0.8 * Math.random())) * -1 + (Math.random() - 0.5) * 0.2; // fan upward
    const dist = 70 + Math.random() * 90;
    return {
      key: i,
      bar: i % 3 === 0,
      style: {
        "--h": Math.floor(Math.random() * 360),
        "--dx": `${Math.cos(angle) * dist}px`,
        "--dy": `${Math.sin(angle) * dist}px`,
        "--rot": `${Math.floor(Math.random() * 540 - 270)}deg`,
      },
    };
  });
  return { id, dots };
}

// Any tap on a button (or a nav icon / story chip) gets a ripple that grows
// from the exact point of contact, plus a barely-there haptic tick on phones
// that support it. One listener on the document covers every button on every
// page, including ones added later.
function useTapFeedback() {
  useEffect(() => {
    function onDown(e) {
      const el = e.target.closest && e.target.closest("button, .bottom-nav a, .story-chip");
      if (!el || el.disabled) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const size = Math.max(rect.width, rect.height) * 2;
      const ripple = document.createElement("span");
      ripple.className = "rfx";
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
      el.classList.add("rfx-host");
      el.appendChild(ripple);
      vibrate(4);
      setTimeout(() => {
        ripple.remove();
        if (!el.querySelector(".rfx")) el.classList.remove("rfx-host");
      }, 650);
    }
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}

function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const [bursts, setBursts] = useState([]);
  useTapFeedback();

  useEffect(() => {
    function handleToast(e) {
      const toast = { ...e.detail, leaving: false };
      setToasts((prev) => [...prev, toast]);
      if (CELEBRATE.has(toast.emoji)) {
        const burst = makeBurst();
        setBursts((prev) => [...prev, burst]);
        setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== burst.id)), 1100);
      }
      setTimeout(() => {
        setToasts((prev) => prev.map((t) => (t.id === toast.id ? { ...t, leaving: true } : t)));
      }, 1800);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 2100);
    }
    window.addEventListener("app:toast", handleToast);
    return () => window.removeEventListener("app:toast", handleToast);
  }, []);

  return (
    <>
      {bursts.map((b) => (
        <div key={b.id} className="burst-host">
          {b.dots.map((d) => (
            <span key={d.key} className={`burst-dot${d.bar ? " bar" : ""}`} style={d.style} />
          ))}
        </div>
      ))}
      {toasts.length > 0 && (
        <div className="toast-host">
          {toasts.map((t) => (
            <div key={t.id} className={`toast-bubble${t.leaving ? " leaving" : ""}`}>
              {t.emoji && <span>{t.emoji}</span>}
              {t.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BottomNav({ currentPath, router }) {
  const navRef = useRef(null);
  const itemRefs = useRef([]);
  const [highlight, setHighlight] = useState(null);
  const currentTab = tabFor(currentPath);
  const activeIndex = NAV_ITEMS.findIndex((i) => i.href === currentTab);

  useEffect(() => {
    function measure() {
      const el = itemRefs.current[activeIndex];
      if (!el || !navRef.current) { setHighlight(null); return; }
      const navRect = navRef.current.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      setHighlight({ left: rect.left - navRect.left, width: rect.width });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeIndex]);

  function tab({ href, label, Icon }, i) {
    const active = currentTab === href;
    return (
      <a
        key={href}
        href={href}
        ref={(el) => (itemRefs.current[i] = el)}
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          if (currentPath !== href) goToTab(router, href, currentPath);
        }}
      >
        <Icon size={21} strokeWidth={active ? 2.3 : 1.8} />
        <span className="nav-label">{label}</span>
      </a>
    );
  }

  return (
    <div className="bottom-nav-wrap">
      <nav className="bottom-nav" ref={navRef} aria-label="Main">
        {highlight && <span className="bottom-nav-highlight" style={{ left: highlight.left, width: highlight.width }} />}
        {NAV_ITEMS.slice(0, 2).map((item, i) => tab(item, i))}
        <button type="button" className="nav-fab" aria-label="Add an expense" onClick={() => { vibrate(10); openQuickAdd(); }}>
          <Plus size={26} strokeWidth={2.4} />
        </button>
        {NAV_ITEMS.slice(2).map((item, i) => tab(item, i + 2))}
      </nav>
    </div>
  );
}

function CollapsingBar({ pathname }) {
  const [title, setTitle] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(false);
    const t = setTimeout(() => {
      const el = document.querySelector(".gradient-title");
      setTitle(el ? el.textContent.trim() : "");
    }, 250);
    function onScroll() {
      setShow(window.scrollY > 90);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  if (pathname === "/pause" || !title) return null;
  return (
    <div className={`top-bar${show ? " show" : ""}`} aria-hidden="true">
      <span className="top-bar-title">{title}</span>
    </div>
  );
}

// Full-screen confetti + reward card for streak milestones, and the
// double-tap heart. Pages only fire events (lib/celebrate).
function CelebrationHost() {
  const [party, setParty] = useState(null);
  const [hearts, setHearts] = useState([]);

  useEffect(() => {
    function onMilestone(e) {
      const pieces = Array.from({ length: 70 }, (_, i) => ({
        key: i,
        style: {
          left: `${Math.random() * 100}%`,
          "--h": Math.floor(Math.random() * 360),
          "--dur": `${2.2 + Math.random() * 1.8}s`,
          "--delay": `${Math.random() * 0.9}s`,
          "--drift": `${Math.floor(Math.random() * 160 - 80)}px`,
          "--spin": `${Math.floor(Math.random() * 900 - 450)}deg`,
        },
      }));
      setParty({ ...e.detail, pieces, id: Date.now() });
      vibrate([20, 40, 20, 40, 60]);
    }
    function onHeart(e) {
      const h = { id: `${Date.now()}-${Math.random()}`, x: e.detail.x, y: e.detail.y };
      setHearts((prev) => [...prev, h]);
      vibrate(15);
      setTimeout(() => setHearts((prev) => prev.filter((x) => x.id !== h.id)), 1000);
    }
    window.addEventListener("app:milestone", onMilestone);
    window.addEventListener("app:heart", onHeart);
    return () => {
      window.removeEventListener("app:milestone", onMilestone);
      window.removeEventListener("app:heart", onHeart);
    };
  }, []);

  return (
    <>
      {hearts.map((h) => (
        <div key={h.id} className="heart-pop" style={{ left: h.x, top: h.y }}>
          💚
        </div>
      ))}
      {party && (
        <div className="celebrate-overlay" onClick={() => setParty(null)}>
          {party.pieces.map((p) => (
            <span key={p.key} className="confetti-piece" style={p.style} />
          ))}
          <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
            <div className="celebrate-trophy">🏆</div>
            <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 24, fontWeight: 700, marginTop: 10, color: "var(--ink)" }}>
              {party.day}-day streak!
            </div>
            {party.reward ? (
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.45, color: "#4A4338" }}>
                Your reward: <strong>{party.reward}</strong>
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 14, color: "#6B6558" }}>Keep it going — you're unstoppable.</div>
            )}
            <button
              onClick={() => setParty(null)}
              style={{ marginTop: 18, background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 999, padding: "10px 26px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Yay!
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function fromBase64url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioTrying, setBioTrying] = useState(false);

  useEffect(() => {
    setBioAvailable(localStorage.getItem("biometricEnabled") === "1" && !!localStorage.getItem("biometricCredentialId"));
  }, []);

  async function tryBiometric() {
    setBioTrying(true);
    setError("");
    try {
      const credentialId = localStorage.getItem("biometricCredentialId");
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: fromBase64url(credentialId), type: "public-key" }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      if (assertion) {
        // Biometrics only unlock this screen; the server still needs a valid
        // session cookie from an earlier PIN entry (good for 30 days).
        const s = await fetchSession().catch(() => null);
        if (s && !s.authenticated) {
          setError("Please enter your PIN once to sign this device back in.");
          return;
        }
        extendSession();
        onUnlock();
      }
    } catch (e) {
      setError("Biometric check didn't succeed — use your PIN instead.");
    } finally {
      setBioTrying(false);
    }
  }

  const [shake, setShake] = useState(false);

  async function submit() {
    if (pin.length < 4 || checking) return;
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "verify-pin", pin }),
      });
      const data = await res.json();
      if (data.ok) {
        vibrate(15);
        extendSession();
        onUnlock();
        return;
      }
      vibrate([30, 40, 30]);
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin("");
      setError(
        data.locked
          ? `Too many wrong attempts — wait ${data.waitSeconds}s and try again.`
          : data.attemptsLeft !== undefined
            ? `Wrong PIN — ${data.attemptsLeft} attempt${data.attemptsLeft !== 1 ? "s" : ""} left before a cooldown.`
            : "Wrong PIN"
      );
    } catch {
      setError("Couldn't check PIN. Try again.");
    } finally {
      setChecking(false);
    }
  }

  function press(k) {
    setError("");
    vibrate(5);
    if (k === "del") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 8 ? p + k : p));
  }

  // Physical keyboards still work.
  useEffect(() => {
    function onKey(e) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
      else if (e.key === "Enter") submit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dots = Math.max(4, pin.length);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: "24px 16px" }}>
      <div style={{ textAlign: "center", width: "100%", maxWidth: 320 }} role="form" aria-label="Unlock">
        <img src="/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 18, boxShadow: "var(--shadow-md)" }} />
        <div className="lora gradient-title" style={{ fontSize: 24, fontWeight: 700, marginTop: 12 }}>Expense Ledger</div>
        <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>Enter your PIN</div>
        <div className={`pin-dots${shake ? " shake" : ""}`} aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: dots }, (_, i) => <span key={i} className={`pin-dot${i < pin.length ? " filled" : ""}`} />)}
        </div>
        <div role="alert" style={{ minHeight: 20, color: "var(--danger)", fontSize: 13 }}>{error}</div>
        <div className="pin-pad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" className="pin-key" onClick={() => press(k)}>{k}</button>
          ))}
          {bioAvailable ? (
            <button type="button" className="pin-key ghost" onClick={tryBiometric} disabled={bioTrying} aria-label="Unlock with fingerprint or face">
              <Fingerprint size={28} />
            </button>
          ) : <span />}
          <button type="button" className="pin-key" onClick={() => press("0")}>0</button>
          <button type="button" className="pin-key ghost" onClick={() => press("del")} aria-label="Delete digit"><Delete size={24} /></button>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={submit} disabled={checking || pin.length < 4} style={{ marginTop: 22, minHeight: 50 }}>
          {checking ? "Checking…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (localStorage.getItem("installBannerDismissed") === "1") return;
    // Already running as an installed app — nothing to offer.
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return;

    function handler(e) {
      e.preventDefault();
      setPromptEvent(e);
      setDismissed(false);
    }
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    setDismissed(true);
    localStorage.setItem("installBannerDismissed", "1");
  }

  async function install() {
    if (!promptEvent) return;
    promptEvent.prompt();
    await promptEvent.userChoice;
    setDismissed(true);
  }

  if (dismissed || !promptEvent) return null;
  return (
    <div
      style={{
        position: "fixed", left: 12, right: 12, bottom: "calc(78px + env(safe-area-inset-bottom, 0px))", zIndex: 45,
        background: "var(--ink)", color: "var(--bg)", borderRadius: 14, padding: "12px 14px",
        display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 20px rgba(36,31,26,0.25)",
      }}
    >
      <Download size={18} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.35 }}>
        Install Expense Ledger for faster, full-screen access
      </div>
      <button
        onClick={install}
        style={{ background: "var(--bg)", color: "var(--ink)", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
      >
        Install
      </button>
      <button onClick={dismiss} aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 }}>
        <X size={16} />
      </button>
    </div>
  );
}

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [locked, setLocked] = useState(null); // null = checking, true/false once known

  // App-icon shortcuts and the phone's Share sheet land on a URL with a hint
  // (?quickadd=expense, ?mark=sugar, ?shared_text=…). Act on it once unlocked.
  useEffect(() => {
    if (locked !== false) return;
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("shared_text") || params.get("shared_title");
    const hinted = params.get("quickadd") === "expense" || params.get("mark") === "sugar" || shared;
    if (!hinted) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (shared) {
      const p = parseExpenseText(shared);
      openQuickAdd(p && !p.isCredit ? { amount: p.amount, note: p.note, category: p.category || "" } : {});
    } else if (params.get("quickadd") === "expense") {
      openQuickAdd();
    } else {
      fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "challenge-day", date: todayISO(), completed: true }) })
        .then((r) => {
          if (!r.ok) throw new Error();
          showToast("Today marked sugar-free 🔥", "✅");
          notifyLedgerChanged();
        })
        .catch(() => showToast("Couldn't mark today — open the Diet page", "⚠️"));
    }
  }, [locked]);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const routerRef = useRef(router);
  routerRef.current = router;
  const pathRef = useRef(router.pathname);
  pathRef.current = router.pathname;

  function refreshPending() {
    setPendingCount(getQueue().length);
  }

  // Send queued offline changes; tell the user about any the server rejected
  // (those are dropped rather than retried forever).
  async function syncQueue() {
    const { dropped } = await flushQueue();
    refreshPending();
    if (dropped.length > 0) {
      showToast(`${dropped.length} offline change${dropped.length !== 1 ? "s" : ""} couldn't be saved: ${dropped[0].error}`, "⚠️");
    }
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    setIsOnline(navigator.onLine);
    refreshPending();
    syncQueue();

    const handleOnline = async () => {
      setIsOnline(true);
      await syncQueue();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const interval = setInterval(refreshPending, 5000);
    applyTheme(getTheme());
    if (document.documentElement.getAttribute("data-theme") === "dark" || localStorage.getItem("darkMode") === "1") {
      document.documentElement.setAttribute("data-theme", "dark");
    }

    // Open straight away if this device was recently unlocked, then confirm
    // with the server in the background; the server's answer wins.
    const recentlyUnlocked = isSessionValid();
    if (recentlyUnlocked) setLocked(false);
    fetchSession()
      .then((s) => {
        if (s.hasPin && (!s.authenticated || !recentlyUnlocked)) {
          clearSession();
          setLocked(true);
        } else {
          setLocked(false);
        }
      })
      .catch(() => setLocked(false)); // offline: nothing to fetch anyway

    function onAuthRequired() {
      clearSession();
      setLocked(true);
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);

    // While unlocked, any touch/click/key activity pushes the session
    // forward (see lib/unlockSession) so a normal day of use never
    // re-prompts for the PIN. A periodic check catches the case where the
    // session has quietly expired — e.g. the phone sat untouched for hours —
    // and locks the app back up next time it's checked.
    function extendIfUnlocked() {
      if (isSessionValid()) extendSession();
    }
    const activityEvents = ["mousedown", "touchstart", "keydown"];
    activityEvents.forEach((ev) => window.addEventListener(ev, extendIfUnlocked));

    const expiryCheck = setInterval(() => {
      if (!isSessionValid() && localStorage.getItem("unlockedUntil")) {
        fetch("/api/data?type=pin-status")
          .then((r) => r.json())
          .then((d) => {
            if (d.hasPin) {
              clearSession();
              setLocked(true);
            }
          })
          .catch(() => {});
      }
    }, 30 * 1000);

    // Swipe left/right anywhere (except inputs, rows with their own swipe,
    // and scrollable strips) to move between the bottom-nav tabs.
    let sx = 0, sy = 0, st = 0, swipeOk = false;
    function onTouchStart(e) {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      const el = e.target;
      swipeOk =
        e.touches.length === 1 &&
        !(el.closest && el.closest("input, textarea, select, [data-no-tab-swipe], .no-swipe, [role='dialog']"));
    }
    function onTouchEnd(e) {
      if (!swipeOk) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 90 || Math.abs(dy) > 55 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - st > 600) return;
      const cur = NAV_ITEMS.findIndex((i) => i.href === pathRef.current);
      if (cur === -1) return;
      const next = NAV_ITEMS[cur + (dx < 0 ? 1 : -1)];
      if (next) goToTab(routerRef.current, next.href, pathRef.current);
    }
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
      clearInterval(interval);
      clearInterval(expiryCheck);
      activityEvents.forEach((ev) => window.removeEventListener(ev, extendIfUnlocked));
    };
  }, []);

  return (
    <>
      <Head>
        <title>Expense Ledger</title>
        <meta name="description" content="Personal expense tracker" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="var(--ink)" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Ledger" />
      </Head>
      {locked === null ? null : locked ? (
        <LockScreen
          onUnlock={() => {
            setLocked(false);
            // Anything saved while locked out was rejected; send it now.
            syncQueue();
          }}
        />
      ) : (
        <>
          {(!isOnline || pendingCount > 0) && (
            <div style={{ position: "sticky", top: 0, zIndex: 50, background: !isOnline ? "var(--danger)" : "var(--warn)", color: "var(--bg)", fontSize: 12, textAlign: "center", padding: "6px 12px" }}>
              {!isOnline
                ? `You're offline${pendingCount > 0 ? ` — ${pendingCount} change${pendingCount !== 1 ? "s" : ""} will sync automatically` : ""}`
                : `Syncing ${pendingCount} change${pendingCount !== 1 ? "s" : ""}…`}
            </div>
          )}
          {!IMMERSIVE.has(router.pathname) && <CollapsingBar pathname={router.pathname} />}
          <div key={router.pathname} className={`route-wrap ${navDirection}`}>
            <Component {...pageProps} />
          </div>
          <ToastHost />
          <CelebrationHost />
          {!IMMERSIVE.has(router.pathname) && (
            <>
              <InstallBanner />
              <BottomNav currentPath={router.pathname} router={router} />
            </>
          )}
          <QuickAddSheet />
        </>
      )}
    </>
  );
}
