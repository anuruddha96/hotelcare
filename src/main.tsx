// This file deliberately has no static imports. It must execute before React or
// any optimized dependency so it can recover when one of those module files was
// replaced while a mobile tab remained open.
const RELOAD_FLAG = "chunk_reload_at";
const RECOVERY_PARAM = "chunk-recovery";
const isSlntRoute = /^\/slnt(?:\/|$)/.test(window.location.pathname);
const isModuleLoadFailure = (message: string) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|module script/i.test(message);

let slntRecoveryNoticeShown = false;

/**
 * A stale JS chunk is not fixed by reloading the same broken document forever.
 * SLNT's mobile revenue route must offer a safe escape after one automatic
 * recovery attempt, without clearing login credentials or another tenant's
 * data. Keep this notice dependency-free so it also works when React fails.
 */
function showSlntRecoveryNotice() {
  if (slntRecoveryNoticeShown) return;
  slntRecoveryNoticeShown = true;

  const notice = document.createElement("section");
  notice.id = "hotelcare-slnt-recovery";
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#101827;color:white;font:16px/1.5 system-ui,-apple-system,sans-serif";
  const panel = document.createElement("div");
  panel.style.cssText = "max-width:440px;width:100%;padding:24px;border:1px solid #475569;border-radius:16px;background:#1e293b";
  const heading = document.createElement("h1");
  heading.textContent = "This page could not finish loading";
  heading.style.cssText = "margin:0 0 12px;font-size:22px;font-weight:650";
  const explanation = document.createElement("p");
  explanation.textContent = "The SLNT revenue page encountered another application-file loading error. Automatic refreshing has stopped so you can use the rest of your workspace. Your login has not been cleared.";
  explanation.style.cssText = "margin:0 0 20px;color:#cbd5e1";

  const workspace = document.createElement("a");
  workspace.href = "/slnt";
  workspace.textContent = "Open SLNT workspace";
  workspace.style.cssText = "display:block;text-align:center;padding:12px;border-radius:8px;background:#2563eb;color:white;text-decoration:none;font-weight:600";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry revenue page";
  retry.style.cssText = "display:block;width:100%;margin-top:10px;padding:12px;border:1px solid #64748b;border-radius:8px;background:transparent;color:white;font:inherit;cursor:pointer";
  retry.addEventListener("click", () => {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* storage unavailable */ }
    const clean = new URL(window.location.href);
    clean.searchParams.delete(RECOVERY_PARAM);
    window.location.assign(clean.toString());
  });

  panel.append(heading, explanation, workspace, retry);
  notice.appendChild(panel);
  // An app may not have created #root yet, but the document body exists by
  // the time a module script is evaluated. Never mutate React's root DOM.
  document.body.appendChild(notice);
}

const recoverFromStaleChunk = (message: string) => {
  if (!isModuleLoadFailure(message)) return;

  // This is the second failure in an already cache-busted SLNT document.
  // A new nonce every 30 seconds created an endless reload cycle on Safari.
  if (isSlntRoute && new URL(window.location.href).searchParams.has(RECOVERY_PARAM)) {
    showSlntRecoveryNotice();
    return;
  }

  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (Date.now() - last < 30000) {
      if (isSlntRoute) showSlntRecoveryNotice();
      return;
    }
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
  ? import("./recovered-entry.ts")
  : import("./app-entry.tsx");

void loadApplication.catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  recoverFromStaleChunk(message);
  if (!isModuleLoadFailure(message)) throw error;
});
