// Who is signed in on this device, from the client's point of view.
//
// Several people can use the app (each with their own name + PIN), and two
// of them might even share a phone. Everything cached in localStorage
// (ledger data, the offline queue, "welcomed", dismissed cards…) belongs to
// whoever was signed in, so when a different person signs in it's wiped
// before anything renders.
const ACCOUNT_KEY = "ledger_account";
export const LAST_NAME_KEY = "ledger_login_name";

// Per-person keys and prefixes. Device preferences (theme, install banner)
// are kept.
const PERSONAL_KEYS = ["cache_ledger_v2", "cache_movies", "cache_challenge", "cache_index", "pendingRequests", "welcomed_v1", "biometricEnabled", "biometricCredentialId"];
const PERSONAL_PREFIXES = ["checkin_", "goal_done_", "cache_"];

export function getAccount() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
  } catch {
    return null;
  }
}

function wipePersonalData() {
  try {
    for (const k of PERSONAL_KEYS) localStorage.removeItem(k);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && PERSONAL_PREFIXES.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}

// Call with the session's user after every sign-in / session check.
// Returns true when a DIFFERENT person than before is now signed in (the
// caller should reload so no screen keeps the previous person's data).
export function rememberAccount(user, extra = {}) {
  if (!user) return false;
  const prev = getAccount();
  const switched = !!prev && prev.id !== user.id;
  if (switched) wipePersonalData();
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ id: user.id, name: user.name, isOwner: !!user.isOwner, hasPin: !!user.hasPin, ...extra }));
    if (user.name) localStorage.setItem(LAST_NAME_KEY, user.name);
  } catch { /* ignore */ }
  return switched;
}
