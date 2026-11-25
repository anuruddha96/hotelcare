import { describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_CURRENCY, normalizeReservationNumberDraft as normalize, isReservationNumberDraftValid as valid } from './reservationFormInputs';

describe('new reservation number drafts', () => {
  it('defaults to EUR', () => expect(DEFAULT_RESERVATION_CURRENCY).toBe('EUR'));
  it('allows clearing the price and typing a new number without a leading zero', () => {
    expect(normalize('', 'rate')).toBe('');
    expect(normalize('0159', 'rate')).toBe('159');
    expect(normalize('0', 'rate')).toBe('0');
    expect(valid('', 'rate')).toBe(true);
  });
  it('accepts decimal rates and Hungarian decimal commas', () => {
    expect(normalize('00159,50', 'rate')).toBe('159.50');
    expect(normalize('.5', 'rate')).toBe('0.5');
    expect(valid('159.50', 'rate')).toBe(true);
    expect(valid('159.', 'rate')).toBe(true);
    expect(valid('159.555', 'rate')).toBe(false);
    expect(valid('-1', 'rate')).toBe(false);
    expect(valid('1e3', 'rate')).toBe(false);
  });
  it('keeps guest counts editable while rejecting invalid counts', () => {
    expect(normalize('02', 'adults')).toBe('2');
    expect(normalize('', 'adults')).toBe('');
    expect(valid('', 'adults')).toBe(false);
    expect(valid('0', 'adults')).toBe(false);
    expect(valid('2', 'adults')).toBe(true);
    expect(valid('', 'children')).toBe(true);
    expect(valid('0', 'children')).toBe(true);
    expect(valid('1.5', 'children')).toBe(false);
    expect(valid('-1', 'children')).toBe(false);
  });
});
