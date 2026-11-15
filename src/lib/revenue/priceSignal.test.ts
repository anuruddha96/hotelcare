import { describe, expect, it } from 'vitest';
import { priceSignalCellLabel, priceSignalTitle, type PriceSignalRow } from './priceSignal';

const row: PriceSignalRow = {
  stay_date: '2026-12-05', days_out: 20, score: 79, band: 'strong', action: 'raise',
  occupancy_pct: 85.7, pace_target_pct: 55, rooms_remaining: 3, pickup_24h: 1, pickup_7d: 8,
  reference_price: 406, market_median: null, event_title: 'Budapest Acro Cup', event_impact: 'medium',
  engine_direction: 'hold', engine_reason: 'ai_supervisor_observation', engine_at: null,
  drivers: ['Pace: 86% sold vs 55% target 20 days out (35/35)', 'Pickup: 8 rooms in 7 days, 1 in 24h (24/25)'],
};

describe('price signal presentation', () => {
  it('shows the direction arrow and the score in the cell', () => {
    expect(priceSignalCellLabel(row)).toBe('▲ 79');
    expect(priceSignalCellLabel({ score: 52, action: 'hold' })).toBe('● 52');
    expect(priceSignalCellLabel({ score: 18, action: 'lower' })).toBe('▼ 18');
  });
  it('explains the band, the action and every driver on hover', () => {
    const title = priceSignalTitle(row);
    expect(title.split('\n')[0]).toBe('2026-12-05 · Price signal 79/100 · Strong → Price up');
    expect(title).toContain('Pace: 86% sold vs 55% target');
    expect(title).toContain('pace 35 · pickup 25 · event 20 · market 10 · inventory 10');
  });
});
