// Developer trace view. Off by default and only reachable by an admin who
// switches it on explicitly; normal users can never see tool internals.

const KEY = "hc-assistant-debug";

export function isAssistantDebugEnabled(role: string | null | undefined): boolean {
  if (role !== "admin") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAssistantDebug(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
