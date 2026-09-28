import { describe, expect, it } from 'vitest';
import { resolveGozsduOperationalBucket, selectGozsduOperationalRooms } from './gozsduOperationalBuckets';

describe('Gozsdu shared operational bucket authority', () => {
  const room = (id: string, hotel = 'gozsdu-court', currentNight = 2, totalNights = 5) => ({
    id, hotel, room_number: id, is_checkout_room: false, guest_nights_stayed: null,
    pms_metadata: { currentNight, totalNights, pmsSyncDate: '2026-09-28', isNoShow: false },
  });

  it('prefers the room row that owns today assignment before canonical hotel alias', () => {
    const legacy = { ...room('legacy', 'Gozsdu Court Budapest'), room_number: '4005' };
    const canonical = { ...room('canonical'), room_number: '4005' };
    expect(selectGozsduOperationalRooms([legacy, canonical], [
      { room_id: 'legacy', assignment_type: 'daily_cleaning', status: 'assigned' },
    ]).map(value => value.id)).toEqual(['legacy']);
  });

  it('uses the same PMS 3/N, 5/N, 7/N service policy as manager fallback', () => {
    expect(resolveGozsduOperationalBucket(room('n2', 'gozsdu-court', 2, 5), undefined, '2026-09-28')).toBe('other');
    expect(resolveGozsduOperationalBucket(room('n3', 'gozsdu-court', 3, 5), undefined, '2026-09-28')).toBe('service');
    expect(resolveGozsduOperationalBucket(room('n4', 'gozsdu-court', 4, 5), undefined, '2026-09-28')).toBe('other');
    expect(resolveGozsduOperationalBucket(room('n5', 'gozsdu-court', 5, 7), undefined, '2026-09-28')).toBe('service');
  });

  it('never lets stale housekeeping snapshots manufacture a second-day service room', () => {
    const value = room('stale', 'gozsdu-court', 2, 5);
    value.pms_metadata.gozsduHousekeeping = { serviceDue: true, serviceType: 'towel_change' };
    expect(resolveGozsduOperationalBucket(value, undefined, '2026-09-28')).toBe('other');
  });

  it('regresses the production 28-vs-12 drift: stale plans cannot inflate twelve real service rooms to twenty-eight', () => {
    const realService = Array.from({ length: 12 }, (_, index) => {
      const value = room(`service-${index + 1}`, 'gozsdu-court', index % 2 === 0 ? 3 : 5, 7);
      value.pms_metadata.gozsduHousekeeping = { serviceDue: true, serviceType: 'towel_change' };
      return value;
    });
    const staleFalsePositives = Array.from({ length: 16 }, (_, index) => {
      const value = room(`other-${index + 1}`, 'gozsdu-court', index % 2 === 0 ? 2 : 4, 7);
      value.pms_metadata.gozsduHousekeeping = { serviceDue: true, serviceType: 'towel_change' };
      return value;
    });
    const all = [...realService, ...staleFalsePositives];
    const buckets = all.map(value => resolveGozsduOperationalBucket(value, undefined, '2026-09-28'));
    expect(buckets.filter(value => value === 'service')).toHaveLength(12);
    expect(buckets.filter(value => value === 'other')).toHaveLength(16);
  });

  it('always lets the verified manager roster override fallback metadata', () => {
    const value = room('verified', 'gozsdu-court', 3, 5);
    expect(resolveGozsduOperationalBucket(value, undefined, '2026-09-28', { bucket: 'other' })).toBe('other');
  });
});
