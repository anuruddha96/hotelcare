import { describe, expect, it } from 'vitest';
import { canonicalRdHotelId, isSameRdHotel, rdHotelDisplayName } from './rdSchedulingHotels';

describe('RD schedule property aliases', () => {
  it('maps both profile names and hotel IDs to one immutable key', () => {
    expect(canonicalRdHotelId('Hotel Memories Budapest')).toBe('memories-budapest');
    expect(canonicalRdHotelId('Gozsdu Court Budapest')).toBe('gozsdu-court');
    expect(canonicalRdHotelId('mika-downtown')).toBe('mika-downtown');
    expect(rdHotelDisplayName('ottofiori')).toBe('Hotel Ottofiori');
  });
  it('does not match empty identifiers or unrelated hotels', () => {
    expect(isSameRdHotel('Hotel Memories Budapest','memories-budapest')).toBe(true);
    expect(isSameRdHotel('Hotel Memories Budapest','mika-downtown')).toBe(false);
    expect(isSameRdHotel(null,null)).toBe(false);
  });
});
