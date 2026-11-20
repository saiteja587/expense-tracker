// Tiny pub-sub for celebratory toasts, so any page can call showToast(...)
// without prop-drilling or a context provider. <ToastHost/> (mounted once in
// _app.js) listens for these and renders the bubbles.
// Optional { actionLabel, onAction } adds a button (e.g. "Undo") and keeps
// the toast up a little longer.
export function showToast(message, emoji, opts = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, emoji, id: Date.now() + Math.random(), actionLabel: opts.actionLabel, onAction: opts.onAction } }));
}
