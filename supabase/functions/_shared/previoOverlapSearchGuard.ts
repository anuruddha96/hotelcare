// Previo's searchReservations defaults are not reliable for housekeeping
// reconciliation: a query for today can return the reservation that ended
// today while omitting a new/continuing reservation occupying the same room.
// Force overlap semantics only when the caller did not already choose a
// termType. Existing explicit Previo searches are left unchanged.

export function installPrevioOverlapSearchGuard(): void {
  const marker = "__hotelcarePrevioOverlapSearchGuardInstalled";
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  if (globalRecord[marker] === true) return;
  globalRecord[marker] = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    const body = typeof init?.body === "string" ? init.body : "";
    const isPrevioReservationSearch = url.includes("/x1/hotel/searchReservations");
    const hasWindow = /<term>[\s\S]*?<from>[^<]+<\/from>[\s\S]*?<to>[^<]+<\/to>[\s\S]*?<\/term>/i.test(body);
    const hasTermType = /<termType>[^<]*<\/termType>/i.test(body);

    if (!isPrevioReservationSearch || !body || !hasWindow || hasTermType) {
      return nativeFetch(input, init);
    }

    const widenedBody = body.replace(/<term>/i, "<term><termType>overlap</termType>");
    return nativeFetch(input, { ...init, body: widenedBody });
  };
}
