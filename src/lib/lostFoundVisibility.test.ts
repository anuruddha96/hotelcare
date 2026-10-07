import { describe, expect, it } from 'vitest';
import { isLostFoundItemVisibleInHotel, normalizeLostFoundHotelKey } from './lostFoundVisibility';

describe('lostFoundVisibility', () => {
  it('normalizes legacy display names and canonical slugs consistently', () => {
    expect(normalizeLostFoundHotelKey('Hotel Memories Budapest')).toBe('memories budapest');
    expect(normalizeLostFoundHotelKey('memories-budapest')).toBe('memories budapest');
  });

  it('keeps a room-linked item visible in the selected hotel', () => {
    expect(isLostFoundItemVisibleInHotel({
      room_id: 'room-110',
      reported_by: 'kamila',
      organization_slug: 'rdhotels',
      rooms: { hotel: 'Hotel Memories Budapest' },
    }, {
      hotelKeys: ['memories-budapest', 'Hotel Memories Budapest'],
      organizationSlug: 'rdhotels',
      userId: 'manager-1',
    })).toBe(true);
  });

  it('does not leak a room-linked item into another hotel', () => {
    expect(isLostFoundItemVisibleInHotel({
      room_id: 'room-110',
      reported_by: 'kamila',
      organization_slug: 'rdhotels',
      rooms: { hotel: 'Hotel Memories Budapest' },
    }, {
      hotelKeys: ['gozsdu-court', 'Gozsdu Court Budapest'],
      organizationSlug: 'rdhotels',
      userId: 'manager-1',
    })).toBe(false);
  });

  it('keeps a legacy roomless manager item recoverable by its reporter', () => {
    expect(isLostFoundItemVisibleInHotel({
      room_id: null,
      reported_by: 'manager-1',
      organization_slug: 'rdhotels',
      rooms: null,
    }, {
      hotelKeys: ['memories-budapest'],
      organizationSlug: 'rdhotels',
      userId: 'manager-1',
    })).toBe(true);
  });

  it('does not expose another users roomless legacy item across properties', () => {
    expect(isLostFoundItemVisibleInHotel({
      room_id: null,
      reported_by: 'manager-2',
      organization_slug: 'rdhotels',
      rooms: null,
    }, {
      hotelKeys: ['memories-budapest'],
      organizationSlug: 'rdhotels',
      userId: 'manager-1',
    })).toBe(false);
  });

  it('rejects a row explicitly scoped to another organization', () => {
    expect(isLostFoundItemVisibleInHotel({
      room_id: 'room-110',
      reported_by: 'kamila',
      organization_slug: 'slnt',
      rooms: { hotel: 'Hotel Memories Budapest' },
    }, {
      hotelKeys: ['Hotel Memories Budapest'],
      organizationSlug: 'rdhotels',
      userId: 'manager-1',
    })).toBe(false);
  });
});
