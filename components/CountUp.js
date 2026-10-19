import { useEffect, useRef, useState } from "react";

// A number that rolls to its value instead of snapping — from 0 the first
// time it appears, and from the previous value whenever it changes.
export default function CountUp({ value, format, duration = 700 }) {
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setShown(target);
      return;
    }
    let raf;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return <>{format ? format(shown) : Math.round(shown)}</>;
}
