// Gozsdu checkout-poll adapter only. The normal poll previously requested one
// overlap search; Previo may omit already-departed reservations from that search.
// The one-click PMS sync also requests termType=check-out for precisely this
// reason. Here we obtain BOTH snapshots, prime the existing room-state guard
// with the overlap response, and add only explicit, same-day departures.
//
// Never infer checkout from /rest/rooms missing a reservation, room clean status,
// RTC on an assignment, or a housekeeper starting work. Never modify PMS, room,
// assignment, or linen records here. The existing poll and DB access guard
// remain responsible for confirming and authorizing actual checkout.

const GOZSDU_PREVIO_HOTEL_ID = '102572';

type PrevioRosterRoom = { roomId: number; name: string };
export type PhysicalRoomAlias = { originalName: string; localNumber: string };

function xmlTag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([^<]*)<\\/${name}>`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function physicalRoom(block: string): { id: number; name: string } | null {
  const match = block.match(/<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/i);
  if (!match) return null;
  return { id: Number(match[1]), name: match[2].trim() };
}

function sameDayCheckout(block: string, date: string): boolean {
  const status = Number(xmlTag(block, 'statusId') || xmlTag(block, 'cosId'));
  return (status === 6 || status === 9) && xmlTag(block, 'to').slice(0, 10) === date;
}

function currentInHouse(block: string, date: string): boolean {
  const status = Number(xmlTag(block, 'statusId') || xmlTag(block, 'cosId'));
  return (status === 3 || status === 5)
    && xmlTag(block, 'from').slice(0, 10) <= date
    && xmlTag(block, 'to').slice(0, 10) > date;
}

function reservationBlocks(xml: string): string[] {
  return xml.match(/<reservation>[\s\S]*?<\/reservation>/gi) ?? [];
}

/**
 * The room importer stores a final numeric token only if it is UNIQUE across
 * all physical rooms. Mirror that rule; e.g. 1B-4005 -> 4005, but do not
 * collapse ST-109 and AP-109, or composite names like TRP - 2/1.
 * We additionally match the actual Previo object ID and full name before
 * rewriting a response's alias, so a coincidental number is insufficient.
 */
export function buildGozsduRoomAliases(roster: PrevioRosterRoom[]): Map<number, PhysicalRoomAlias> {
  const candidates = new Map<number, PhysicalRoomAlias>();
  const counts = new Map<string, number>();
  for (const room of roster) {
    const originalName = String(room.name ?? '').trim();
    if (!originalName || /\d+\s*\/\s*\d+(?:\s*\([^)]*\))?\s*$/.test(originalName)) continue;
    const numeric = originalName.match(/\d+/g);
    const localNumber = numeric?.[numeric.length - 1] ?? '';
    if (!localNumber) continue;
    counts.set(localNumber, (counts.get(localNumber) ?? 0) + 1);
    const id = Number(room.roomId);
    if (Number.isSafeInteger(id) && id > 0 && originalName !== localNumber) {
      candidates.set(id, { originalName, localNumber });
    }
  }
  return new Map([...candidates].filter(([, alias]) => counts.get(alias.localNumber) === 1));
}

function canonicalizeCheckout(block: string, aliases: Map<number, PhysicalRoomAlias>, date: string): string {
  if (!sameDayCheckout(block, date)) return block;
  const physical = physicalRoom(block);
  if (!physical) return block;
  const alias = aliases.get(physical.id);
  if (!alias || alias.originalName !== physical.name) return block;
  // Change only the <object><name> inside this one confirmed checkout block;
  // preserve the reservation status, date, object ID, and guest information.
  return block.replace(/(<object>[\s\S]*?<objId>\d+<\/objId>[\s\S]*?<name>)([^<]*)(<\/name>[\s\S]*?<\/object>)/i,
    (_whole, before: string, _name: string, after: string) => `${before}${alias.localNumber}${after}`);
}

function reservationKey(block: string): string {
  const physical = physicalRoom(block);
  return [xmlTag(block, 'resId') || xmlTag(block, 'reservationId') || xmlTag(block, 'id'),
    physical?.id ?? physical?.name ?? '', xmlTag(block, 'from'), xmlTag(block, 'to'),
    xmlTag(block, 'statusId') || xmlTag(block, 'cosId')].join('|');
}

export function mergeGozsduCheckoutEvidence(
  overlapXml: string,
  explicitCheckoutXml: string,
  aliases: Map<number, PhysicalRoomAlias>,
  date: string,
): { xml: string; added: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { xml: overlapXml, added: 0 };
  const original = reservationBlocks(overlapXml);
  const current = original.filter(block => currentInHouse(block, date))
    .map(physicalRoom).filter((room): room is { id: number; name: string } => room !== null);
  const rewritten = overlapXml.replace(/<reservation>[\s\S]*?<\/reservation>/gi,
    block => canonicalizeCheckout(block, aliases, date));
  const seen = new Set(original.map(reservationKey));
  const added: string[] = [];
  for (const block of reservationBlocks(explicitCheckoutXml)) {
    if (!sameDayCheckout(block, date)) continue;
    const physical = physicalRoom(block);
    // Defense in depth: even if a regression in the upstream shared state
    // guard lets an old checkout through, a currently in-house reservation for
    // that SAME physical room blocks re-release. Never compare numbers alone.
    if (physical && current.some(room => room.id === physical.id || room.name === physical.name)) continue;
    const key = reservationKey(block);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(canonicalizeCheckout(block, aliases, date));
  }
  if (added.length === 0) return { xml: rewritten, added: 0 };
  if (original.length === 0) {
    // Return the complete, valid XML document from the explicit checkout
    // endpoint instead of guessing where an empty <reservations/> node ends.
    return {
      xml: explicitCheckoutXml.replace(/<reservation>[\s\S]*?<\/reservation>/gi,
        block => canonicalizeCheckout(block, aliases, date)),
      added: added.length,
    };
  }
  // Insert siblings just before the first reservation INSIDE the existing
  // reservations parent. Do not concatenate two XML documents.
  return { xml: rewritten.replace(/<reservation>/i, `${added.join('')}<reservation>`), added: added.length };
}

function restoreResponse(response: Response, xml: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(xml, { status: response.status, statusText: response.statusText, headers });
}

/** Installed exclusively by previo-poll-checkouts/index.ts, not other functions. */
export function installGozsduCheckoutPollRecovery(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);
  let aliases = new Map<number, PhysicalRoomAlias>();
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const hotelHeader = new Headers(init?.headers).get('X-Previo-Hotel-ID');
    if (url.includes('/rest/rooms') && hotelHeader === GOZSDU_PREVIO_HOTEL_ID) {
      const response = await originalFetch(input, init);
      if (response.ok) {
        const data: unknown = await response.clone().json().catch(() => null);
        if (Array.isArray(data)) {
          aliases = buildGozsduRoomAliases(data as PrevioRosterRoom[]);
        }
      }
      return response;
    }

    const body = typeof init?.body === 'string' ? init.body : '';
    if (!url.includes('/x1/hotel/searchReservations')
      || !new RegExp(`<hotId>\\s*${GOZSDU_PREVIO_HOTEL_ID}\\s*<\\/hotId>`, 'i').test(body)
      || !/<term>\s*<from>\d{4}-\d{2}-\d{2}<\/from>/i.test(body)
      || /<termType>/i.test(body)) {
      return originalFetch(input, init);
    }

    // Explicit overlap primes the existing room-state guard with today's
    // ongoing occupants BEFORE the checkout-only request is filtered.
    const overlapBody = body.replace(/<term>/i, '<term><termType>overlap</termType>');
    const overlap = await originalFetch(input, { ...init, body: overlapBody });
    if (!overlap.ok) return overlap;
    const overlapText = await overlap.clone().text();
    if (/<error>/i.test(overlapText)) return overlap;

    const checkoutBody = body.replace(/<term>/i, '<term><termType>check-out</termType>');
    let explicit: Response;
    try {
      explicit = await originalFetch(input, { ...init, body: checkoutBody });
    } catch {
      // No extra privilege is conferred by a failed fetch: retain the
      // original overlap response and the normal checkout guards.
      return overlap;
    }
    if (!explicit.ok) return overlap;
    const explicitText = await explicit.clone().text();
    if (/<error>/i.test(explicitText) || /^\s*\d{4}\s+/.test(explicitText)) return overlap;
    const date = body.match(/<term>\s*<from>(\d{4}-\d{2}-\d{2})<\/from>/i)?.[1] ?? '';
    const recovered = mergeGozsduCheckoutEvidence(overlapText, explicitText, aliases, date);
    if (recovered.added > 0) {
      console.info(`[gozsdu-checkout-recovery] recovered ${recovered.added} explicit same-day departure record(s)`);
    }
    return restoreResponse(overlap, recovered.xml);
  };
}
