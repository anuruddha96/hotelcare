import { describe, expect, it } from 'vitest';
import { parsePrevioLateCheckoutTime } from '../previoLateCheckout';

describe('parsePrevioLateCheckoutTime', () => {
  it('reads room 302-style HTML-escaped Previo reception note without returning private text', () => {
    const note = 'Systém - OTA booking and payment details &lt;div&gt;Recepce - LCO UNTIL 1500 - internal booking details&lt;/div&gt;';
    expect(parsePrevioLateCheckoutTime(note)).toBe('15:00');
  });

  it.each([
    ['LCO UNTIL 1500', '15:00'],
    ['LCO until 15:00', '15:00'],
    ['Late check-out till 3pm', '15:00'],
    ['Late checkout at 3 PM', '15:00'],
    ['late check out until 12:30', '12:30'],
    ['LCO 0930', '09:30'],
    ['LCO until 12AM', '00:00'],
    ['LCO until 12PM', '12:00'],
  ])('parses explicitly marked time in %s', (note, time) => {
    expect(parsePrevioLateCheckoutTime(note)).toBe(time);
  });

  it.each([
    null,
    undefined,
    '',
    'Checkout at 15:00', // No confirmed late-checkout marker.
    'Standard checkout 10:00',
    'LCO until 2560',
    'LCO until 25:30',
    'LCO until 3', // No safe AM/PM inference.
    'LCO cancelled',
  ])('does not infer a late checkout from ambiguous input %s', (note) => {
    expect(parsePrevioLateCheckoutTime(note)).toBeNull();
  });
});
