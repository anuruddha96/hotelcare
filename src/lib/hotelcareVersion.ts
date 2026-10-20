/** Client update detection uses static hosting, not the busy Supabase API. */
export const HOTELCARE_BUILD_ID = __HOTELCARE_BUILD_ID__;

export function isNewHotelCareRelease(
  current: string, response: unknown,
): response is { buildId: string } {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const buildId = (response as Record<string, unknown>).buildId;
  return typeof buildId === 'string'
    && /^[a-zA-Z0-9._-]{5,120}$/.test(buildId)
    && buildId !== current;
}

export async function checkHotelCareRelease(
  request: typeof fetch = fetch,
  timestamp = Date.now(),
): Promise<boolean> {
  // Both no-store and an ever-changing URL avoid shared-host cache delays.
  const response = await request('/hotelcare-release.json?v=' + timestamp, {
    cache: 'no-store',
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) {
    return false;
  }
  return isNewHotelCareRelease(HOTELCARE_BUILD_ID, await response.json());
}
