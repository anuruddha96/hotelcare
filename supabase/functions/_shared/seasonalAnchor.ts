// Seasonal anchor (Hotel Ottofiori).
//
// The old engine used one generic €100 floor for every far-out date, which is
// why quiet February Tuesdays and busy September Fridays were pulled towards
// the same number. The anchor below is built from the hotel's OWN realised
// average rate per month and weekday, with graceful fallbacks so a thin month
// never produces a nonsense anchor.

export interface AnchorSample {
  month: number;   // 1..12
  dow: number;     // 1..7, ISO (Mon = 1)
  anchorEur: number;
  samples: number;
}

export interface AnchorTable {
  /** month|dow -> anchor */
  byMonthDow: Map<string, number>;
  byMonth: Map<number, number>;
  overall: number | null;
}

const key = (month: number, dow: number) => `${month}|${dow}`;

export function buildAnchorTable(samples: AnchorSample[], minSamples = 4): AnchorTable {
  const byMonthDow = new Map<string, number>();
  const monthTotals = new Map<number, { sum: number; n: number }>();
  let sum = 0;
  let n = 0;

  for (const s of samples) {
    const value = Number(s.anchorEur);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (Number(s.samples) >= minSamples) byMonthDow.set(key(s.month, s.dow), Math.round(value));
    const m = monthTotals.get(s.month) ?? { sum: 0, n: 0 };
    m.sum += value * s.samples;
    m.n += s.samples;
    monthTotals.set(s.month, m);
    sum += value * s.samples;
    n += s.samples;
  }

  const byMonth = new Map<number, number>();
  for (const [month, m] of monthTotals) {
    if (m.n > 0) byMonth.set(month, Math.round(m.sum / m.n));
  }

  return { byMonthDow, byMonth, overall: n > 0 ? Math.round(sum / n) : null };
}

/**
 * Anchor for a stay date. `floorPrice` keeps the anchor inside the price band
 * so a weak history can never anchor a date below what the hotel will sell at.
 */
export function anchorFor(
  stayDate: string,
  table: AnchorTable,
  bounds?: { min?: number | null; max?: number | null },
): number | null {
  const parsed = new Date(`${stayDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = parsed.getUTCMonth() + 1;
  const dow = parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();

  const raw = table.byMonthDow.get(key(month, dow))
    ?? table.byMonth.get(month)
    ?? table.overall;
  if (raw == null || !(raw > 0)) return null;

  let value = Math.round(raw);
  if (bounds?.min != null && Number.isFinite(Number(bounds.min))) value = Math.max(value, Math.round(Number(bounds.min)));
  if (bounds?.max != null && Number.isFinite(Number(bounds.max))) value = Math.min(value, Math.round(Number(bounds.max)));
  return value;
}
