// Client-only localStorage queue for requests made while offline.
// Pure browser JS — never imported by any server-side code.

const KEY = "pendingRequests";

export function getQueue() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function queueRequest({ url, method, body }) {
  const queue = getQueue();
  queue.push({ id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, method, body, queuedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export async function flushQueue() {
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };
  const remaining = [];
  let synced = 0;
  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });
      if (res.ok) synced++;
      else remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  localStorage.setItem(KEY, JSON.stringify(remaining));
  return { synced, remaining: remaining.length };
}
