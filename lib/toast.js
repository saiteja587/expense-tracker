// Tiny pub-sub for celebratory toasts, so any page can call showToast(...)
// without prop-drilling or a context provider. <ToastHost/> (mounted once in
// _app.js) listens for these and renders the bubbles.
export function showToast(message, emoji) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, emoji, id: Date.now() + Math.random() } }));
}
