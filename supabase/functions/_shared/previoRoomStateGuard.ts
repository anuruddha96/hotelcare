// Guards Previo XML reservation responses against one specific but important
// housekeeping race: a reservation that ended today can remain visible as
// checked-out even after reception extends the guest in the same physical room
// under a new reservation. In that case the CURRENT in-house reservation wins.
//
// This is deliberately applied at the shared Previo response boundary so both
// the checkout poll and the one-click PMS sync see the same room-day truth.
// A normal same-day turnover to a different guest is NOT suppressed: we only
// supersede the old checkout when the continuing reservation is explicitly
// in-house, or when the old/new reservation share a guest identity.

interface CurrentRoomState {
  strongInHouse: boolean;
  guestKeys: Set<string>;
  expiresAt: number;
}

const STATE_TTL_MS = 2 * 60 * 1000;
const stateByHotel = new Map<string, Map<string, CurrentRoomState>>();

function cleanDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

function grab(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function normalize(value: string): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

function roomKeys(block: string): string[] {
  const objectMatch = block.match(
    /<object>[\s\S]*?<objId>(\d+)<\/objId>[\s\S]*?<name>([^<]*)<\/name>[\s\S]*?<\/object>/i,
  );
  if (!objectMatch) return [];

  const keys = new Set<string>();
  const objId = objectMatch[1]?.trim();
  const name = normalize(objectMatch[2] ?? "");
  if (objId) keys.add(`id:${objId}`);
  if (name) {
    keys.add(`name:${name}`);
    const numericTail = name.match(/(\d{3})(?:\D*)$/)?.[1];
    if (numericTail) keys.add(`room:${numericTail}`);
  }
  return Array.from(keys);
}

function guestKeys(block: string): Set<string> {
  const keys = new Set<string>();
  const guestMatch = block.match(/<guest\b[^>]*>([\s\S]*?)<\/guest>/i);
  if (!guestMatch) return keys;
  const guest = guestMatch[1];

  for (const tag of ["guestId", "customerId", "clientId", "personId"]) {
    const value = normalize(grab(guest, tag));
    if (value) keys.add(`${tag.toLowerCase()}:${value}`);
  }

  const email = normalize(grab(guest, "email"));
  if (email) keys.add(`email:${email}`);

  const first = normalize(
    grab(guest, "firstName") || grab(guest, "firstname") || grab(guest, "givenName"),
  );
  const last = normalize(
    grab(guest, "lastName") || grab(guest, "lastname") || grab(guest, "surname") || grab(guest, "familyName"),
  );
  if (first && last) keys.add(`name:${first}|${last}`);

  return keys;
}

function statusId(block: string): number {
  const value = grab(block, "statusId") || grab(block, "cosId");
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

function getRequestBody(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof init?.body === "string") return init.body;
  // callPrevioXml uses a URL string plus init.body, so Request bodies normally
  // never reach this path. Avoid consuming a Request body just for diagnostics.
  return "";
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function hotelState(hotelId: string): Map<string, CurrentRoomState> {
  let state = stateByHotel.get(hotelId);
  if (!state) {
    state = new Map();
    stateByHotel.set(hotelId, state);
  }
  const now = Date.now();
  for (const [key, value] of state) {
    if (value.expiresAt <= now) state.delete(key);
  }
  return state;
}

function mergeCurrentState(
  state: Map<string, CurrentRoomState>,
  keys: string[],
  strongInHouse: boolean,
  guests: Set<string>,
): void {
  const expiresAt = Date.now() + STATE_TTL_MS;
  for (const key of keys) {
    const existing = state.get(key);
    if (!existing) {
      state.set(key, { strongInHouse, guestKeys: new Set(guests), expiresAt });
      continue;
    }
    existing.strongInHouse = existing.strongInHouse || strongInHouse;
    for (const guestKey of guests) existing.guestKeys.add(guestKey);
    existing.expiresAt = expiresAt;
  }
}

function shouldSuppressCheckout(
  state: Map<string, CurrentRoomState>,
  keys: string[],
  oldGuests: Set<string>,
): boolean {
  for (const key of keys) {
    const current = state.get(key);
    if (!current) continue;
    if (current.strongInHouse) return true;
    if (oldGuests.size > 0 && intersects(oldGuests, current.guestKeys)) return true;
  }
  return false;
}

function rebuildResponse(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Install once per isolate. The guard only touches Previo XML
 * hotel/searchReservations responses; every other request is byte-for-byte
 * unaffected.
 */
export function installPrevioRoomStateGuard(): void {
  const marker = "__hotelcarePrevioRoomStateGuardInstalled";
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  if (globalRecord[marker] === true) return;
  globalRecord[marker] = true;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const url = getRequestUrl(input);
    if (!response.ok || !url.includes("/x1/hotel/searchReservations")) return response;

    const requestBody = getRequestBody(input, init);
    const hotId = grab(requestBody, "hotId") || "unknown";
    const today = new Date().toISOString().slice(0, 10);
    const isOverlapSnapshot = /<termType>\s*overlap\s*<\/termType>/i.test(requestBody);

    const text = await response.text();
    const blocks = text.match(/<reservation>[\s\S]*?<\/reservation>/gi) ?? [];
    if (blocks.length === 0) return rebuildResponse(response, text);

    if (isOverlapSnapshot) stateByHotel.delete(hotId);
    const state = hotelState(hotId);

    // Pass 1: remember the reservation that represents CURRENT occupancy.
    // status 3/5 is explicit in-house. A non-cancelled current reservation is
    // also retained with its guest identity so same-guest extensions can win
    // even when reception has not yet changed the new reservation's status.
    for (const block of blocks) {
      const from = cleanDate(grab(block, "from"));
      const to = cleanDate(grab(block, "to"));
      const status = statusId(block);
      if (!from || !to || from > today || to <= today || status === 7 || status === 8) continue;

      const keys = roomKeys(block);
      if (keys.length === 0) continue;
      const explicitInHouse = status === 3 || status === 5;
      mergeCurrentState(state, keys, explicitInHouse, guestKeys(block));
    }

    let suppressed = 0;
    const filtered = text.replace(/<reservation>[\s\S]*?<\/reservation>/gi, (block) => {
      const departure = cleanDate(grab(block, "to"));
      const status = statusId(block);
      if (departure !== today || (status !== 6 && status !== 9)) return block;

      const keys = roomKeys(block);
      if (keys.length === 0) return block;
      if (!shouldSuppressCheckout(state, keys, guestKeys(block))) return block;

      suppressed++;
      return "";
    });

    if (suppressed > 0) {
      console.log(
        `[previo-room-state-guard] suppressed ${suppressed} historical checkout reservation(s) because a current same-room stay supersedes them (hotel=${hotId})`,
      );
    }

    return rebuildResponse(response, filtered);
  };
}
