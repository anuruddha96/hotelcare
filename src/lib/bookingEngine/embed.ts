// Talks to the hotel website when the booking page runs inside the embed
// iframe (public/booking-engine/loader.js): height, scroll and conversion.
export function isEmbedded(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

export function notifyParent(type: 'height' | 'scroll-top' | 'step' | 'booking-complete', payload: Record<string, unknown> = {}) {
  if (!isEmbedded()) return;
  const frame = new URLSearchParams(window.location.search).get('frame') ?? '';
  // No personal data is ever sent to the parent page: only step names, the
  // booking reference and the value needed for conversion tracking.
  window.parent.postMessage({ source: 'hotelcare-booking', type, frame, ...payload }, '*');
}

/** Keeps the iframe exactly as tall as the page; returns a cleanup function. */
export function startHeightReporting(): () => void {
  if (!isEmbedded() || typeof ResizeObserver === 'undefined') return () => undefined;
  let last = 0;
  const report = () => {
    const height = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(height - last) > 2) { last = height; notifyParent('height', { height }); }
  };
  const observer = new ResizeObserver(report);
  observer.observe(document.body);
  report();
  return () => observer.disconnect();
}
