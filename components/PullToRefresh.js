import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { vibrate } from "../lib/haptics";

// A standard mobile "pull down at the top of the page to refresh" gesture.
// Only engages when the page is already scrolled to the very top — otherwise
// an ordinary scroll gesture would get hijacked. onRefresh should return a
// promise (it's awaited so the spinner stays up until the reload finishes).
const TRIGGER_DISTANCE = 64;
const MAX_PULL = 110;

export default function PullToRefresh({ onRefresh, children }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pulling = useRef(false);
  const triggeredHaptic = useRef(false);

  function onTouchStart(e) {
    if (refreshing) return;
    if (window.scrollY > 2) { pulling.current = false; return; }
    startY.current = e.touches[0].clientY;
    pulling.current = true;
    triggeredHaptic.current = false;
  }

  function onTouchMove(e) {
    if (!pulling.current || startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) { setPull(0); return; }
    if (window.scrollY > 2) { pulling.current = false; setPull(0); return; }
    e.preventDefault();
    const damped = Math.min(MAX_PULL, dy * 0.5);
    setPull(damped);
    if (damped > TRIGGER_DISTANCE && !triggeredHaptic.current) {
      vibrate(8);
      triggeredHaptic.current = true;
    }
  }

  async function onTouchEnd() {
    if (!pulling.current) return;
    pulling.current = false;
    if (pull > TRIGGER_DISTANCE) {
      setRefreshing(true);
      setPull(TRIGGER_DISTANCE);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }

  const progress = Math.min(1, pull / TRIGGER_DISTANCE);

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        style={{
          height: refreshing ? TRIGGER_DISTANCE : pull,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden", transition: pulling.current ? "none" : "height 0.2s var(--ease-fluid, ease)",
        }}
      >
        {(pull > 4 || refreshing) && (
          <RefreshCw
            size={18}
            color="#A34A38"
            style={{
              opacity: progress,
              transform: `rotate(${refreshing ? 0 : progress * 360}deg)`,
              animation: refreshing ? "spin 0.7s linear infinite" : "none",
            }}
          />
        )}
      </div>
      {children}
    </div>
  );
}
