import { describe, expect, it } from 'vitest';
import { buildHotelRoomsRealtimeFilter } from './hotelKeys';

describe('buildHotelRoomsRealtimeFilter', () => {
  it('limits room events to the canonical and display-name aliases', () => {
    expect(buildHotelRoomsRealtimeFilter(['memories-budapest', 'Hotel Memories Budapest']))
      .toBe('hotel=in.("memories-budapest","Hotel Memories Budapest")');
  });

  it('deduplicates aliases and escapes reserved filter characters', () => {
    expect(buildHotelRoomsRealtimeFilter(['ot-to', 'ot-to', 'A,B (hotel)']))
      .toBe('hotel=in.("ot-to","A,B (hotel)")');
    expect(buildHotelRoomsRealtimeFilter(['A "quoted" name']))
      .toBe('hotel=in.("A \\"quoted\\" name")');
  });

  it('does not allow a global/unfiltered room subscription', () => {
    expect(() => buildHotelRoomsRealtimeFilter([])).toThrow(/hotel key/i);
    expect(() => buildHotelRoomsRealtimeFilter(['  '])).toThrow(/hotel key/i);
  });
});
