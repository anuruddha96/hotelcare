// Keep this entry free of static imports: recovery must work even if React or
// an optimized dependency cannot be fetched by an already-open browser tab.
const RECOVERY_PARAM = "chunk-recovery";
const isSlntRoute = /^\/slnt(?:\/|$)/.test(window.location.pathname);
const isModuleLoadFailure = (message: string) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|module script|ChunkLoadError|loading chunk/i.test(message);

/** An independent fallback: never turn a failed import into a white screen. */
function showModuleRecoveryNotice() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", showModuleRecoveryNotice, { once: true });
    return;
  }
  if (document.getElementById("hotelcare-module-recovery")) return;

  const notice = document.createElement("section");
  notice.id = "hotelcare-module-recovery";
  notice.setAttribute("role", "alertdialog");
  notice.setAttribute("aria-modal", "true");
  notice.setAttribute("aria-labelledby", "hotelcare-module-recovery-title");
  notice.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.65);backdrop-filter:blur(8px);color:#f8fafc;font:16px/1.5 system-ui,-apple-system,sans-serif";

  const panel = document.createElement("div");
  panel.style.cssText = "max-width:440px;width:100%;padding:24px;border:1px solid #475569;border-radius:16px;background:#1e293b;box-shadow:0 20px 50px rgba(0,0,0,.3);text-align:center";
  const heading = document.createElement("h1");
  heading.id = "hotelcare-module-recovery-title";
  heading.textContent = "This page needs a refresh";
  heading.style.cssText = "margin:0 0 12px;font-size:22px;font-weight:650";
  const explanation = document.createElement("p");
  explanation.textContent = "An application file could not load, which can happen when an older tab is reopened. Refresh to load the latest version. Your login has not been cleared; unsaved changes may be lost.";
  explanation.style.cssText = "margin:0 0 20px;color:#cbd5e1";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Refresh HotelCare";
  retry.style.cssText = "display:block;width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:white;font:inherit;font-weight:600;cursor:pointer";
  retry.addEventListener("click", () => {
    const next = new URL(window.location.href);
    // Select a fresh document/module graph without losing the active hotel,
    // route, search filters or hash. Only a direct user click navigates.
    next.searchParams.set(RECOVERY_PARAM, String(Date.now()));
    window.location.replace(next.toString());
  });
  panel.append(heading, explanation, retry);

  if (isSlntRoute) {
    const workspace = document.createElement("a");
    workspace.href = "/slnt?tab=housekeeping";
    workspace.textContent = "Open SLNT workspace instead";
    workspace.style.cssText = "display:block;margin-top:12px;text-align:center;padding:12px;border:1px solid #64748b;border-radius:8px;color:white;text-decoration:none";
    panel.appendChild(workspace);
  }

  notice.appendChild(panel);
  // The React root must remain untouched, even when its JavaScript never ran.
  document.body.appendChild(notice);
  retry.focus();
}

function recoverFromStaleChunk(message: string) {
  if (isModuleLoadFailure(message)) showModuleRecoveryNotice();
}

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
  // Even unexpected entrypoint failures must be recoverable without a blank
  // page or an unbounded sequence of automatic reloads.
  console.error("HotelCare could not load its application entry", error);
  showModuleRecoveryNotice();
});
