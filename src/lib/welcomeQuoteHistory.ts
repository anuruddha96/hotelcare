// One-time bridge from the two previous browser-only rotations to permanent
// server-side history. Quote IDs are stable across role and property changes.
const PREFIXES = ['hc.quoteRotation.v3.', 'hc.quoteRotation.v4.'] as const;

export function readLegacyQuoteHistory(userId: string, storage?: Storage): string[] {
  if (!userId) return [];
  try {
    const store = storage ?? window.localStorage;
    const result = new Set<string>();
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key || !PREFIXES.some((prefix) => key.startsWith(prefix)) || !key.endsWith(`.${userId}`)) continue;
      const value = store.getItem(key);
      if (!value) continue;
      try {
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || !('seen' in parsed) || !Array.isArray(parsed.seen)) continue;
        parsed.seen.forEach((quoteId: unknown) => {
          if (typeof quoteId === 'string' && quoteId.length <= 100) result.add(quoteId);
        });
      } catch { /* Ignore one bad old record, not the whole migration. */ }
    }
    return Array.from(result).slice(0, 500);
  } catch {
    // Storage is unavailable in privacy mode; the server still prevents any
    // repeats that occurred after server-side tracking was introduced.
    return [];
  }
}
