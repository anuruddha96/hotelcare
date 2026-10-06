import { describe, expect, it } from 'vitest';
import {
  MIKA_TOWEL_CHANGE_ONLY_MARKER,
  appendTowelChangeOnlyOutcome,
  isHotelMikaDowntown,
  isTowelChangeOnlyOutcome,
  stripTowelChangeOnlyOutcome,
} from './mika-towel-service';

describe('Mika towel-only service helpers', () => {
  it('gates the shortcut to Hotel Mika Downtown aliases only', () => {
    expect(isHotelMikaDowntown('Hotel Mika Downtown')).toBe(true);
    expect(isHotelMikaDowntown('mika-downtown')).toBe(true);
    expect(isHotelMikaDowntown('Mika')).toBe(true);
    expect(isHotelMikaDowntown('Hotel Memories Budapest')).toBe(false);
    expect(isHotelMikaDowntown('Hotel Ottofiori')).toBe(false);
  });

  it('records a non-cleaning towel outcome without duplicating its marker', () => {
    const first = appendTowelChangeOnlyOutcome('Guest requested fresh towels', '2026-09-10T10:00:00.000Z');
    const second = appendTowelChangeOnlyOutcome(first, '2026-09-10T10:05:00.000Z');

    expect(isTowelChangeOnlyOutcome(second)).toBe(true);
    expect(second.split(MIKA_TOWEL_CHANGE_ONLY_MARKER)).toHaveLength(2);
    expect(second).toContain('Full room cleaning was not performed');
  });

  it('removes only the technical towel marker from user-facing notes', () => {
    const marked = appendTowelChangeOnlyOutcome('Keep balcony door closed', '2026-09-10T10:00:00.000Z');
    expect(stripTowelChangeOnlyOutcome(marked)).toBe('Keep balcony door closed');
  });
});
