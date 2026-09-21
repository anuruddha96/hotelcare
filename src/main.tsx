// Keep this entry free of static imports: recovery must run even if React or
// an optimized dependency cannot be fetched by an already-open mobile tab.
const RELOAD_FLAG = "chunk_reload_at";
const RECOVERY_PARAM = "chunk-recovery";
const isSlntRoute = /^\/slnt(?:\/|$)/.test(window.location.pathname);
const isModuleLoadFailure = (message: string) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|module script/i.test(message);

/** Dependency-free SLNT escape route after one failed cache-busting reload. */
function showSlntRecoveryNotice() {
  if (document.getElementById("hotelcare-slnt-recovery")) return;
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
  explanation.textContent = "The SLNT revenue page encountered another application-file loading error. Automatic refreshing has stopped. Your login has not been cleared.";
  explanation.style.cssText = "margin:0 0 20px;color:#cbd5e1";
  const workspace = document.createElement("a");
  // Executives are normally redirected back into revenue by /slnt. The
  // explicit tab query bypasses that redirect and opens the real dashboard.
  workspace.href = "/slnt?tab=housekeeping";
  workspace.textContent = "Open SLNT workspace";
  workspace.style.cssText = "display:block;text-align:center;padding:12px;border-radius:8px;background:#2563eb;color:white;text-decoration:none;font-weight:600";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry revenue page";
  retry.style.cssText = "display:block;width:100%;margin-top:10px;padding:12px;border:1px solid #64748b;border-radius:8px;background:transparent;color:white;font:inherit;cursor:pointer";
  retry.addEventListener("click", () => {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* private mode */ }
    const clean = new URL(window.location.href);
    clean.searchParams.delete(RECOVERY_PARAM);
    window.location.assign(clean.toString());
  });
  panel.append(heading, explanation, workspace, retry);
  notice.appendChild(panel);
  // Never modify the React root. This works even when React failed to load.
  document.body.appendChild(notice);
}

const recoverFromStaleChunk = (message: string) => {
  if (!isModuleLoadFailure(message)) return;
  if (isSlntRoute && new URL(window.location.href).searchParams.has(RECOVERY_PARAM)) {
    // An already-recovered document has failed again: do not reload forever.
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
  } catch { /* storage blocked — still allow the initial reload */ }
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
