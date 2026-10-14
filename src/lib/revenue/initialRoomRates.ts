/** First-time pricing is explicit: never manufacture a default price from the room count. */
export function inferredGuestCapacity(name: string, knownLevels?: number[]): number {
  const valid = (knownLevels ?? []).filter((n) => Number.isInteger(n) && n > 0 && n <= 12);
  if (valid.length > 0) return Math.max(...valid);
  // "Double or twin 2+1" is a three-guest category, NOT 21 guests.
  const guests = /\b(\d+)\s*\+\s*(\d+)\b/.exec(name);
  if (guests) return Math.max(1, Math.min(12, Number(guests[1]) + Number(guests[2])));
  return 2;
}

export function validateFirstRateLadder(values: string[], guestCount: number): number[] | null {
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 12 || values.length !== guestCount) return null;
  const prices = values.map((v) => v.trim() === "" ? NaN : Number(v));
  if (prices.some((v) => !Number.isInteger(v) || v <= 0 || v > 100000)) return null;
  if (prices.some((v, i) => i > 0 && v < prices[i - 1])) return null;
  return prices;
}

export function initialRateDates(start: string, days: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || ![1, 7, 14, 30].includes(days)) return [];
  const origin = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(origin.getTime()) || origin.toISOString().slice(0, 10) !== start) return [];
  return Array.from({ length: days }, (_, i) => {
    const at = new Date(origin);
    at.setUTCDate(at.getUTCDate() + i);
    return at.toISOString().slice(0, 10);
  });
}
