/**
 * Multi-OTA rate rules for the Rate & Pickup calendar.
 *
 * The base price per rate plan/date lives in pms_ari_rates and is what the
 * channel manager distributes. Each connected OTA can carry a rule (markup or
 * fixed adjustment + rounding) so the calendar shows the effective price a
 * guest sees on that channel, per day, next to the base price.
 */

export type AdjustmentKind = 'percent' | 'fixed';
export type Rounding = 'none' | 'whole' | 'ninety_nine';

export interface ChannelRateRule {
  id: string;
  hotel_id: string;
  channel_key: string; // stable slug, e.g. booking_com, expedia, open_channel
  channel_title: string; // what the user sees, e.g. "Booking.com"
  adjustment_kind: AdjustmentKind;
  adjustment_value: number; // percent (e.g. 15 = +15%) or fixed amount in hotel currency
  rounding: Rounding;
  active: boolean;
  sort_order: number;
}

export const CHANNEL_PRESETS: Array<{ key: string; title: string }> = [
  { key: 'booking_com', title: 'Booking.com' },
  { key: 'expedia', title: 'Expedia' },
  { key: 'airbnb', title: 'Airbnb' },
  { key: 'szallas_hu', title: 'Szallas.hu' },
  { key: 'open_channel', title: 'Direct / website' },
];

export function roundRate(value: number, rounding: Rounding): number {
  if (!Number.isFinite(value)) return 0;
  switch (rounding) {
    case 'whole': return Math.round(value);
    case 'ninety_nine': {
      // Psychological price: nearest whole, then end on .99 one unit below
      // when rounding up would overshoot (119.5 -> 119.99, 120.2 -> 119.99).
      const whole = Math.max(1, Math.round(value));
      return Math.round((whole - 0.01) * 100) / 100;
    }
    default: return Math.round(value * 100) / 100;
  }
}

/** Effective per-OTA price for a base rate under one channel rule. */
export function applyChannelRule(baseRate: number, rule: Pick<ChannelRateRule, 'adjustment_kind' | 'adjustment_value' | 'rounding'>): number {
  if (!Number.isFinite(baseRate) || baseRate <= 0) return 0;
  const adjusted = rule.adjustment_kind === 'percent'
    ? baseRate * (1 + rule.adjustment_value / 100)
    : baseRate + rule.adjustment_value;
  return roundRate(Math.max(0, adjusted), rule.rounding);
}

/** One-line description of a rule for chips and tooltips. */
export function describeRule(rule: Pick<ChannelRateRule, 'adjustment_kind' | 'adjustment_value'>): string {
  const v = rule.adjustment_value;
  if (v === 0) return 'same as base';
  const sign = v > 0 ? '+' : '−';
  const abs = Math.abs(v);
  return rule.adjustment_kind === 'percent' ? `${sign}${abs}%` : `${sign}${abs}`;
}
