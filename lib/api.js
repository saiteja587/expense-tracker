// Small fetch helpers for /api/data. Errors carry the server's message.
async function handle(res) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(d.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return d;
}
export const apiGet = (type, params = {}) =>
  fetch(`/api/data?${new URLSearchParams({ type, ...params })}`).then(handle);
export const apiSend = (method, body) =>
  fetch("/api/data", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(handle);
export const apiPost = (body) => apiSend("POST", body);
export const apiPut = (body) => apiSend("PUT", body);
export const apiDelete = (type, id) => fetch(`/api/data?type=${type}&id=${id}`, { method: "DELETE" }).then(handle);
