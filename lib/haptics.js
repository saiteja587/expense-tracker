// Tiny wrapper around the vibration API. Silently does nothing on iOS Safari
// and any browser that doesn't support it — this is a nice-to-have, never
// something a flow should depend on.
export function vibrate(ms = 10) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
  } catch {
    // ignore
  }
}
