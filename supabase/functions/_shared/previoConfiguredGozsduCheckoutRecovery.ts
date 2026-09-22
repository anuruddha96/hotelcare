// Gozsdu-only, config-driven adapter. Keep the original room-state/occupancy
// guards installed before this adapter; never infer checkout from an absent
// REST reservation, clean status, an RTC chip, or the clock.
import { buildGozsduRoomAliases, mergeGozsduCheckoutEvidence, type PhysicalRoomAlias } from './previoGozsduCheckoutRecovery.ts';

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

export function isConfiguredGozsduRoster(url: string, header: string | null, hotelId: string): boolean {
  return url.includes('/rest/rooms') && header === hotelId;
}

export function isConfiguredGozsduReservationSearch(url: string, body: string, hotelId: string): boolean {
  if (!url.includes('/x1/hotel/searchReservations') || !/^\d+$/.test(hotelId)) return false;
  const requestedHotelId = body.match(/<hotId>\s*(\d+)\s*<\/hotId>/i)?.[1];
  return requestedHotelId === hotelId
    && /<term>\s*<from>\d{4}-\d{2}-\d{2}<\/from>/i.test(body)
    && !/<termType>/i.test(body);
}

function restoreResponse(response: Response, xml: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(xml, { status: response.status, statusText: response.statusText, headers });
}

/** Call only with the Gozsdu pms_configurations.pms_hotel_id looked up in the DB. */
export function installConfiguredGozsduCheckoutRecovery(hotelId: string): void {
  if (!/^\d+$/.test(hotelId)) throw new Error('Gozsdu Previo hotel ID is not configured');
  const originalFetch = globalThis.fetch.bind(globalThis);
  let aliases = new Map<number, PhysicalRoomAlias>();
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (isConfiguredGozsduRoster(url, new Headers(init?.headers).get('X-Previo-Hotel-ID'), hotelId)) {
      const response = await originalFetch(input, init);
      if (response.ok) {
        const roster: unknown = await response.clone().json().catch(() => null);
        if (Array.isArray(roster)) aliases = buildGozsduRoomAliases(roster);
      }
      return response;
    }

    const body = typeof init?.body === 'string' ? init.body : '';
    if (!isConfiguredGozsduReservationSearch(url, body, hotelId)) return originalFetch(input, init);

    // Explicit overlap primes the existing in-house guard before departures
    // are checked. An extension or current occupant blocks an old checkout.
    const overlap = await originalFetch(input, {
      ...init, body: body.replace(/<term>/i, '<term><termType>overlap</termType>'),
    });
    if (!overlap.ok) return overlap;
    const overlapXml = await overlap.clone().text();
    if (/<error>/i.test(overlapXml) || /^\s*\d{4}\s+/.test(overlapXml)) return overlap;

    let checkout: Response;
    try {
      checkout = await originalFetch(input, {
        ...init, body: body.replace(/<term>/i, '<term><termType>check-out</termType>'),
      });
    } catch {
      return overlap;
    }
    if (!checkout.ok) return overlap;
    const checkoutXml = await checkout.clone().text();
    if (/<error>/i.test(checkoutXml) || /^\s*\d{4}\s+/.test(checkoutXml)) return overlap;

    const date = body.match(/<term>\s*<from>(\d{4}-\d{2}-\d{2})<\/from>/i)?.[1] ?? '';
    const merged = mergeGozsduCheckoutEvidence(overlapXml, checkoutXml, aliases, date);
    if (merged.added) console.info(`[gozsdu-checkout-recovery] ${merged.added} explicitly confirmed same-day departures recovered`);
    return restoreResponse(overlap, merged.xml);
  };
}
