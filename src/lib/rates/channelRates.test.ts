import { describe, expect, it } from 'vitest';
import { applyChannelRule, describeRule, roundRate } from './channelRates';

describe('applyChannelRule', () => {
  it('applies percent markups and discounts', () => {
    expect(applyChannelRule(100, { adjustment_kind: 'percent', adjustment_value: 15, rounding: 'none' })).toBe(115);
    expect(applyChannelRule(100, { adjustment_kind: 'percent', adjustment_value: -10, rounding: 'none' })).toBe(90);
    expect(applyChannelRule(99.9, { adjustment_kind: 'percent', adjustment_value: 0, rounding: 'none' })).toBe(99.9);
  });

  it('applies fixed adjustments and never goes negative', () => {
    expect(applyChannelRule(100, { adjustment_kind: 'fixed', adjustment_value: 12.5, rounding: 'none' })).toBe(112.5);
    expect(applyChannelRule(10, { adjustment_kind: 'fixed', adjustment_value: -50, rounding: 'none' })).toBe(0);
  });

  it('rounds per the rule', () => {
    expect(applyChannelRule(100, { adjustment_kind: 'percent', adjustment_value: 15.4, rounding: 'whole' })).toBe(115);
    expect(applyChannelRule(100, { adjustment_kind: 'percent', adjustment_value: 19.6, rounding: 'ninety_nine' })).toBe(119.99);
    expect(applyChannelRule(100, { adjustment_kind: 'percent', adjustment_value: 20.2, rounding: 'ninety_nine' })).toBe(119.99);
  });

  it('returns 0 for a missing or zero base', () => {
    expect(applyChannelRule(0, { adjustment_kind: 'percent', adjustment_value: 15, rounding: 'none' })).toBe(0);
    expect(applyChannelRule(NaN, { adjustment_kind: 'fixed', adjustment_value: 5, rounding: 'none' })).toBe(0);
  });
});

describe('roundRate', () => {
  it('keeps cents, rounds whole, or ends on .99', () => {
    expect(roundRate(115.456, 'none')).toBe(115.46);
    expect(roundRate(115.456, 'whole')).toBe(115);
    expect(roundRate(115.456, 'ninety_nine')).toBe(114.99);
    expect(roundRate(0.4, 'ninety_nine')).toBe(0.99); // floor at 1 - 0.01
  });
});

describe('describeRule', () => {
  it('summarizes markups for chips', () => {
    expect(describeRule({ adjustment_kind: 'percent', adjustment_value: 15 })).toBe('+15%');
    expect(describeRule({ adjustment_kind: 'percent', adjustment_value: -5 })).toBe('−5%');
    expect(describeRule({ adjustment_kind: 'fixed', adjustment_value: 10 })).toBe('+10');
    expect(describeRule({ adjustment_kind: 'fixed', adjustment_value: 0 })).toBe('same as base');
  });
});
