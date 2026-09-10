const DEFAULT_BREAKFAST_PATH = "/bb";

export function safeBreakfastReturnPath(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_BREAKFAST_PATH;

  const value = candidate.trim();
  const pathname = value.split(/[?#]/, 1)[0];
  const boundary = value.charAt(3);

  if (!value.startsWith(DEFAULT_BREAKFAST_PATH)) return DEFAULT_BREAKFAST_PATH;
  if (boundary && boundary !== "/" && boundary !== "?" && boundary !== "#") return DEFAULT_BREAKFAST_PATH;
  if (pathname === "/bb/auth" || pathname.startsWith("/bb/auth/")) return DEFAULT_BREAKFAST_PATH;

  return value;
}

export function breakfastReturnPathFromSearch(search: string): string {
  return safeBreakfastReturnPath(new URLSearchParams(search).get("returnTo"));
}

export function breakfastAuthUrl(returnPath: string): string {
  return `/bb/auth?returnTo=${encodeURIComponent(safeBreakfastReturnPath(returnPath))}`;
}
