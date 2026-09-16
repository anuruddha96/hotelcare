/**
 * Safari can occasionally fulfil a lazy module import with an undefined module
 * namespace after a deployment or an interrupted mobile session. React then
 * throws while reading `_result.default`; named-export lazy imports fail while
 * reading the export. Both are recoverable only through a fresh document, not
 * by resetting a React error boundary (the lazy payload is already settled).
 */
export function isLazyModuleCrash(
  error: Error | null,
  componentStack: string | null,
): boolean {
  if (!error || !componentStack || !/(?:^|\n)\s*Lazy(?:\n|$)/.test(componentStack)) {
    return false;
  }

  return /(?:undefined is not an object|cannot read properties of (?:undefined|null)|dynamically imported module|importing a module script failed|failed to fetch dynamically|error loading dynamically|module script)/i.test(error.message);
}

/** New HTML URL, same tenant/path/search/hash; also selects recovered-entry. */
export function freshApplicationUrl(href: string, timestamp: number): string {
  const url = new URL(href);
  url.searchParams.set('chunk-recovery', String(timestamp));
  return url.toString();
}
