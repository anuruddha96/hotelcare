// This file deliberately has no static imports. It must execute before React or
// any optimized dependency so it can recover when one of those module files was
// replaced while a mobile tab remained open.
const RELOAD_FLAG = "chunk_reload_at";
const RECOVERY_PARAM = "chunk-recovery";
const isModuleLoadFailure = (message: string) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|module script/i.test(message);

const recoverFromStaleChunk = (message: string) => {
  if (!isModuleLoadFailure(message)) return;

  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch { /* storage blocked — still worth one reload */ }

  // A plain reload can reuse the same stale module response on mobile Safari.
  // A one-time URL nonce forces a fresh document and dependency graph while
  // preserving the current path, tenant route and all other query parameters.
  const next = new URL(window.location.href);
  next.searchParams.set(RECOVERY_PARAM, String(Date.now()));
  window.location.replace(next.toString());
};

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const payload = (event as Event & { payload?: { message?: string } }).payload;
  recoverFromStaleChunk(payload?.message ?? "dynamically imported module");
});
window.addEventListener("error", (event) => recoverFromStaleChunk(event.message ?? ""));
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  recoverFromStaleChunk(reason instanceof Error ? reason.message : String(reason ?? ""));
});

const recoveredDocument = new URL(window.location.href).searchParams.has(RECOVERY_PARAM);
const loadApplication = recoveredDocument
  ? import("./app-entry.tsx?recovered")
  : import("./app-entry.tsx");

void loadApplication.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  recoverFromStaleChunk(message);
  if (!isModuleLoadFailure(message)) throw error;
});
