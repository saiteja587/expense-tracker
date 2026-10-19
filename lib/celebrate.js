// Fire-and-forget celebrations. The visuals live in _app.js (CelebrationHost);
// pages just call these, the same pub-sub pattern the toasts use.
function emit(name, detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// Full-screen confetti rain plus a card announcing the milestone and the
// reward you set for it in Settings.
export function celebrateMilestone(day, reward) {
  emit("app:milestone", { day, reward: reward || "" });
}

// A big heart that pops at a screen position and floats away — the
// double-tap "like" moment.
export function popHeart(x, y) {
  emit("app:heart", { x, y });
}
