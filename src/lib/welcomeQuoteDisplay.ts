// Presentation only. The welcome overlay remains the sole owner of quote claims.
// Keep the latest quote in memory for this signed-in account, not in persistent
// browser history. A header mount, route change or hotel switch never claims one.
export type DisplayedWelcomeQuote = { quote_key: string; quote_text: string; author: string };

let current: { userId: string; quote: DisplayedWelcomeQuote } | null = null;
const listeners = new Set<() => void>();

export function rememberDisplayedWelcomeQuote(userId: string, quote: DisplayedWelcomeQuote): void {
  if (!userId) return;
  if (current?.userId === userId && current.quote.quote_key === quote.quote_key) return;
  current = { userId, quote };
  listeners.forEach((listener) => listener());
}

export function displayedWelcomeQuote(userId: string | null | undefined): DisplayedWelcomeQuote | null {
  return userId && current?.userId === userId ? current.quote : null;
}

export function clearDisplayedWelcomeQuote(): void {
  if (!current) return;
  current = null;
  listeners.forEach((listener) => listener());
}

export function subscribeDisplayedWelcomeQuote(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
