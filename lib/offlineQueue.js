// Client-only localStorage queue for requests made while offline.
// Pure browser JS — never imported by any server-side code.

const KEY = "pendingRequests";

// Unique id attached to every new-record request. The server ignores a
// repeat of an id it has already saved, so re-sending a request whose first
// attempt actually got through (but whose response was lost) can't create a
// duplicate.
export function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getQueue() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

// Returns { ok, droppedPhoto }. localStorage holds only ~5MB, so a receipt
// photo can overflow it; in that case the request is queued without the
// photo rather than silently not saved at all.
export function queueRequest({ url, method, body }) {
  const queue = getQueue();
  const item = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, method, body, queuedAt: Date.now() };
  try {
    saveQueue([...queue, item]);
    return { ok: true, droppedPhoto: false };
  } catch {
    if (body && body.receiptPhoto) {
      try {
        // On an edit, null means "keep the stored photo" rather than delete it.
        const slimBody = { ...body, receiptPhoto: method === "PUT" ? null : "" };
        saveQueue([...queue, { ...item, body: slimBody }]);
        return { ok: true, droppedPhoto: true };
      } catch {
        // fall through
      }
    }
    return { ok: false, droppedPhoto: false };
  }
}

// Statuses worth retrying later: offline/server trouble, rate limiting, and
// 401 (locked — retried after the user unlocks). Any other 4xx means the
// server rejected the request itself; retrying can never succeed, so it's
// dropped instead of clogging the queue forever.
function isRetryable(status) {
  return status >= 500 || status === 401 || status === 408 || status === 429;
}

// Returns { synced, remaining, dropped: [{ body, error }] }.
export async function flushQueue() {
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0, dropped: [] };
  const remaining = [];
  const dropped = [];
  let synced = 0;
  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });
      if (res.ok) synced++;
      else if (isRetryable(res.status)) remaining.push(item);
      else {
        const data = await res.json().catch(() => ({}));
        dropped.push({ body: item.body, error: data.error || `HTTP ${res.status}` });
      }
    } catch {
      remaining.push(item);
    }
  }
  try {
    // Items queued while this flush was running are kept too.
    const queuedMeanwhile = getQueue().filter((q) => !queue.some((o) => o.id === q.id));
    saveQueue([...remaining, ...queuedMeanwhile]);
  } catch {
    // ignore
  }
  return { synced, remaining: remaining.length, dropped };
}
