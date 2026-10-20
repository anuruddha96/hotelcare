import { describe, expect, it, vi } from 'vitest';
import {
  HOTELCARE_BUILD_ID,
  checkHotelCareRelease,
  isNewHotelCareRelease,
} from './hotelcareVersion';

describe('HotelCare static version discovery', () => {
  it('rejects bad or identical release markers', () => {
    expect(isNewHotelCareRelease(HOTELCARE_BUILD_ID, {})).toBe(false);
    expect(isNewHotelCareRelease(HOTELCARE_BUILD_ID, { buildId: HOTELCARE_BUILD_ID })).toBe(false);
    expect(isNewHotelCareRelease(HOTELCARE_BUILD_ID, { buildId: 'new-build-99999' })).toBe(true);
    expect(isNewHotelCareRelease(HOTELCARE_BUILD_ID, { buildId: '<script>' })).toBe(false);
  });

  it('makes a no-store static fetch and never calls Supabase', async () => {
    const request = vi.fn(async () => new Response(
      JSON.stringify({ buildId: 'new-build-99999' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    expect(await checkHotelCareRelease(request as typeof fetch, 4567)).toBe(true);
    expect(request).toHaveBeenCalledWith('/hotelcare-release.json?v=4567', {
      cache: 'no-store', headers: { Accept: 'application/json' },
    });
  });

  it('does not force an update for a stale HTML or failed response', async () => {
    const request = vi.fn(async () => new Response('<html>offline</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }));
    expect(await checkHotelCareRelease(request as typeof fetch)).toBe(false);
  });
});
