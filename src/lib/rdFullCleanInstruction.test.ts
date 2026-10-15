import { describe, expect, it } from 'vitest';
import { getRdFullCleanInstruction, isRdHousekeepingHotel } from './rdFullCleanInstruction';

describe('RD Hotels full room clean instruction', () => {
  const base = { hotel: 'Hotel Ottofiori', isCheckout: false, linenChangeRequired: true, currentNight: 5 };
  it('requires both towels and linen on the fifth night', () => {
    expect(getRdFullCleanInstruction(base)?.message).toBe(
      'Guest stayed 4 nights (now on night 5). Please change the bed linen and all towels.',
    );
  });
  it('supports full-room-clean flags even without the linen-change flag', () => {
    expect(getRdFullCleanInstruction({ ...base, linenChangeRequired: false, fullRoomCleaningRequired: true })?.message)
      .toContain('bed linen and all towels');
  });
  it('does not convert towel-only or checkout cleans into full-clean instructions', () => {
    expect(getRdFullCleanInstruction({ ...base, linenChangeRequired: false })).toBeNull();
    expect(getRdFullCleanInstruction({ ...base, isCheckout: true })).toBeNull();
  });
  it('handles unknown nights without making up a count', () => {
    expect(getRdFullCleanInstruction({ ...base, currentNight: undefined })?.message)
      .toBe('Please change the bed linen and all towels.');
  });
  it('supports Budapest and the other RD Hotels without applying to SLNT', () => {
    for (const hotel of ['Hotel Mika Downtown', 'Gozsdu Court Budapest', 'Hotel Memories Budapest', 'hotel ottofiori']) {
      expect(isRdHousekeepingHotel(hotel)).toBe(true);
      expect(getRdFullCleanInstruction({ ...base, hotel })).not.toBeNull();
    }
    expect(getRdFullCleanInstruction({ ...base, hotel: 'slnt-group' })).toBeNull();
  });
  it('has Hungarian copy and consistent completed-night logic', () => {
    const value = getRdFullCleanInstruction({ ...base, language: 'hu' });
    expect(value?.message).toContain('4 éjszakát');
    expect(value?.message).toContain('összes törölközőt');
    expect(getRdFullCleanInstruction({ ...base, currentNight: 1 })?.message).toContain('night 1');
  });
});
