// Pure presentation hint only. The database separately verifies the actual
// authenticated profile before prioritizing a quote; this grants no access.
export function isPremiumQuoteViewer(nickname?: string | null): boolean {
  return nickname?.trim().toLowerCase() === 'anu_000';
}
