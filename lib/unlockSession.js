// Unlock state used to live only in sessionStorage, which a PWA throws away
// the instant it's fully closed — so re-opening the app to log a ₹40 tea
// meant typing the PIN again every single time. This keeps a rolling
// "unlocked until" timestamp in localStorage instead: any touch/click/key
// activity while the app is open pushes it forward, so a normal day of use
// never re-prompts, but setting the phone down for a few hours does.
const KEY = "unlockedUntil";
export const SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours of inactivity before re-locking

export function isSessionValid() {
  try {
    const until = parseInt(localStorage.getItem(KEY) || "0", 10);
    return until > Date.now();
  } catch {
    return false;
  }
}

export function extendSession() {
  try {
    localStorage.setItem(KEY, String(Date.now() + SESSION_MS));
  } catch {
    // ignore
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
