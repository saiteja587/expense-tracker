import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { vibrate } from "../lib/haptics";

// Wraps a list row so swiping it left on a touchscreen reveals a delete
// button underneath — the standard mobile list gesture. It's deliberately
// two-step (swipe reveals, then a separate tap confirms) rather than
// deleting on the swipe itself, so a stray sideways scroll on a bumpy bus
// ride can't quietly delete an expense.
const REVEAL_WIDTH = 76;
const TRIGGER_DISTANCE = 40;

export default function SwipeRow({ children, onDelete, disabled }) {
  const [dragX, setDragX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startX = useRef(null);
  const startY = useRef(null);
  const dragging = useRef(false);
  const lockedAxis = useRef(null);

  if (disabled) return children;

  function onTouchStart(e) {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    dragging.current = true;
    lockedAxis.current = null;
  }

  function onTouchMove(e) {
    if (!dragging.current || startX.current === null) return;
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;

    if (!lockedAxis.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      lockedAxis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (lockedAxis.current !== "x") return; // let a vertical scroll pass through untouched

    e.preventDefault();
    const base = revealed ? -REVEAL_WIDTH : 0;
    let next = base + dx;
    next = Math.min(0, Math.max(-REVEAL_WIDTH - 24, next));
    setDragX(next);
  }

  function onTouchEnd() {
    dragging.current = false;
    if (lockedAxis.current !== "x") return;
    const shouldReveal = dragX < -TRIGGER_DISTANCE;
    if (shouldReveal && !revealed) vibrate(8);
    setRevealed(shouldReveal);
    setDragX(shouldReveal ? -REVEAL_WIDTH : 0);
  }

  function close() {
    setRevealed(false);
    setDragX(0);
  }

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "stretch", justifyContent: "flex-end",
        }}
      >
        <button
          onClick={() => { close(); onDelete(); }}
          aria-label="Delete"
          style={{
            width: REVEAL_WIDTH, background: "#A34A38", color: "#fff", border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 10,
          }}
        >
          <Trash2 size={16} />
          Delete
        </button>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => revealed && close()}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging.current ? "none" : "transform 0.2s var(--ease-fluid, ease)",
          background: "var(--page-bg, #FBF8F2)",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}
