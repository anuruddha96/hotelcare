import { describe, expect, it } from 'vitest';
import { buildPricingReview } from '../../supabase/functions/_shared/pricingReview';
import { buildRatePlan, canonicalJson, planHash, rateConsentText, ratePlanRanges } from '../../supabase/functions/_shared/ratePlan';

function review() {
  const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map((stay_date, i) => ({
    stay_date, occupancyPct: [95, 92, 40, 41][i], roomsLeft: [1, 2, 25, 24][i], roomsAvailable: 42, netPickup: [4, 3, 0, 0][i], hasData: true,
  }));
  return buildPricingReview({
    today: '2026-11-17',
    days,
    rates: days.map((d) => ({ stay_date: d.stay_date, price: 150 })),
    // The market sits above our 150 entry rate, so the last rooms have room to rise.
    competitorRates: days.flatMap((d) => [{ stay_date: d.stay_date, rate: 160 }, { stay_date: d.stay_date, rate: 165 }]),
    competitorFresh: true,
    events: [{ title: 'Concert', event_date: '2026-11-21', expected_impact: 'high' }],
    minimumRateEur: 60,
  });
}

describe('Mira rate plan', () => {
  const plan = buildRatePlan({
    review: review(),
    hotelId: 'ottofiori',
    hotelName: 'Hotel Ottofiori',
    currency: 'EUR',
    generatedAt: '2026-11-17T19:00:00Z',
    dataAsOf: '2026-11-17T18:30:00Z',
    minimumRate: 60,
    marketScanAgeHours: 5,
    adrByDate: { '2026-11-20': 141 },
    roomsAvailableByDate: { '2026-11-20': 42 },
    signalsByDate: { '2026-11-20': { score: 80, band: 'surge', action: 'raise', pickup24h: 1, pickup7d: 4, paceTargetPct: 90, drivers: ['Pace'] } },
  });

  it('carries every signal per night and the steps of the pricing review', () => {
    expect(plan.days).toHaveLength(4);
    const first = plan.days[0];
    expect(first.adr).toBe(141);
    expect(first.signal?.band).toBe('surge');
    expect(first.deltaEur).toBeGreaterThan(0);
    expect(first.proposedEntryRate).toBe(150 + first.deltaEur);
    expect(plan.summary.changedNights).toBe(plan.days.filter((d) => d.deltaEur !== 0).length);
    expect(plan.days.every((d) => Math.abs(d.deltaEur) <= 20)).toBe(true);
  });

  it('turns the kept nights into publishing ranges of the same step', () => {
    const days = [
      { date: '2026-11-20', deltaEur: 10 }, { date: '2026-11-21', deltaEur: 10 }, { date: '2026-11-22', deltaEur: -5 },
      { date: '2026-11-23', deltaEur: -5 }, { date: '2026-11-24', deltaEur: 0 }, { date: '2026-11-25', deltaEur: -5 },
    ];
    expect(ratePlanRanges(days, new Set(days.map((d) => d.date)))).toEqual([
      { fromDate: '2026-11-20', toDate: '2026-11-21', deltaEur: 10, nights: 2 },
      { fromDate: '2026-11-22', toDate: '2026-11-23', deltaEur: -5, nights: 2 },
      { fromDate: '2026-11-25', toDate: '2026-11-25', deltaEur: -5, nights: 1 },
    ]);
    // A night left out splits the range.
    expect(ratePlanRanges(days, new Set(['2026-11-20', '2026-11-22']))).toEqual([
      { fromDate: '2026-11-20', toDate: '2026-11-20', deltaEur: 10, nights: 1 },
      { fromDate: '2026-11-22', toDate: '2026-11-22', deltaEur: -5, nights: 1 },
    ]);
  });

  it('never makes a range longer than seven nights', () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, deltaEur: 5 }));
    const ranges = ratePlanRanges(days, new Set(days.map((d) => d.date)));
    expect(ranges.map((r) => r.nights)).toEqual([7, 3]);
  });

  it('writes the consent sentence from the ranges', () => {
    const text = rateConsentText(plan, [{ fromDate: '2026-11-20', toDate: '2026-11-21', deltaEur: 10, nights: 2 }]);
    expect(text).toContain('Hotel Ottofiori');
    expect(text).toContain('2 nights');
    expect(text).toContain('2026-11-20–2026-11-21 +10 EUR');
  });

  it('hashes the same plan the same way, whatever the key order', async () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const a = await planHash({ x: 1, y: 2 });
    const b = await planHash({ y: 2, x: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
