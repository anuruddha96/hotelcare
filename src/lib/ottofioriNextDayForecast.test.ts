import { describe, expect, it } from 'vitest';
import { buildOttofioriNightForecast, nextMorningDate, type OttofioriMorningRow } from './ottofioriNextDayForecast';

const captured_at = '2026-11-03T14:00:01.847Z';
const now = Date.parse('2026-11-03T14:05:00.000Z');
const row = (room_number: string, arrival_date: string, departure_date: string): OttofioriMorningRow =>
  ({ room_number, arrival_date, departure_date, captured_at });

// Reproduces Ottofiori Nov 4 / Nov 5 2026 occupancy structure:
// 14 departures + 7 stayovers need Nov 4 morning housekeeping;
// 6 Nov 4 arrivals + those 7 stayovers = 13 booked on Nov 4 night.
const morning = [
  ...Array.from({length: 14}, (_, i) => row(String(101+i), '2026-11-02', '2026-11-04')),
  ...Array.from({length: 7}, (_, i) => row(String(201+i), '2026-11-02', '2026-11-06')),
];
const following = [
  ...morning.slice(14),
  ...Array.from({length: 6}, (_, i) => row(String(101+i), '2026-11-04', '2026-11-05')),
];
const forecast = (a: Partial<Parameters<typeof buildOttofioriNightForecast>[0]> = {}) =>
  buildOttofioriNightForecast({
    selectedDate:'2026-11-04', physicalRoomCount:21,
    housekeepingMorning:morning, followingMorning:following, now, ...a,
  });

describe('Ottofiori next-day occupancy vs housekeeping roster', () => {
  it('uses the following morning to count arrivals, booked nights and real vacancies', () => {
    expect(forecast()).toMatchObject({
      morningOccupied:21, checkIns:6, stayoversTonight:7,
      nightBooked:13, nightUnbooked:8,
    });
    expect(forecast()?.checkInRooms).toEqual(['101','102','103','104','105','106']);
  });
  it('does not turn 14 morning departures into 14 rooms occupied tonight', () => {
    expect(forecast()?.nightBooked).toBeLessThan(morning.length);
    expect(forecast()?.nightUnbooked).toBe(8);
  });
  it('refuses missing or stale later-night PMS evidence', () => {
    expect(forecast({followingMorning:[]})).toBeNull();
    expect(forecast({followingMorning:following.map(r=>({...r,captured_at:'2026-11-03T13:10:00Z'}))})).toBeNull();
    expect(forecast({followingMorning:following.map(r=>({...r,captured_at:'2026-11-03T14:04:00Z'}))})).toBeNull();
  });
  it('refuses duplicate room labels, impossible stay dates, and mismatched carryovers', () => {
    expect(forecast({followingMorning:[...following.slice(0,12), following[0]]})).toBeNull();
    expect(forecast({followingMorning:following.map((r,i)=>i===0? {...r,arrival_date:'2026-11-05'}:r)})).toBeNull();
    expect(forecast({followingMorning:following.map((r,i)=>i===0? {...r,departure_date:'2026-11-04'}:r)})).toBeNull();
  });
  it('handles calendar rollover without using the device timezone', () => {
    expect(nextMorningDate('2026-12-31')).toBe('2027-01-01');
    expect(nextMorningDate('2028-02-28')).toBe('2028-02-29');
    expect(()=>nextMorningDate('2026-02-29')).toThrow();
  });
});
