// Writing nightly prices back to Previo — EQC AvailRateUpdate.
//
// Previo's XML API (api.previo.app/x1) is read/reservation only: every rate
// write operation name is rejected with `2001 Invalid operation ... service
// 'hotel'`. Previo documents a separate channel for sending prices:
//
//   EQC (a copy of Expedia QuickConnect 0.8.5)
//   POST https://api.previo.app/eqc1/ar
//   Authorization: ApiKey <key>
//   <AvailRateUpdateRQ xmlns="http://www.expediaconnect.com/EQC/AR/2007/02">
//     <Hotel id="…"/>
//     <DateRange from="…" to="…"/>
//     <RoomType id="…">
//       <RatePlan id="…">
//         <Rate currency="EUR"><PerOccupancy rate="150.00" occupancy="2"/></Rate>
//       </RatePlan>
//     </RoomType>
//   </AvailRateUpdateRQ>
//
// This module speaks exactly that call. Reading a price back for verification
// still uses the XML API's getRates.

import { callPrevioXml, type PrevioCredentials } from "./previoCredentials.ts";

const EQC_AR_ENDPOINT = "https://api.previo.app/eqc1/ar";
const EQC_AR_NS = "http://www.expediaconnect.com/EQC/AR/2007/02";
const PREVIO_WRITE_TIMEOUT_MS = 10_000;

/** The single supported write transport. */
export const RATE_WRITE_METHOD = "eqc:AvailRateUpdate";
/** Kept for callers that report what was attempted. */
export const RATE_WRITE_METHODS = [RATE_WRITE_METHOD] as const;
export type RateWriteMethod = string;

export interface RateWriteTarget {
  /** Previo rate plan (pricelist) id. */
  prlId: string;
  /** Previo room type id. */
  obkId: string;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  occupancy: number;
  price: number;
  currency: string;
  /**
   * Previo refuses a price for occupancy N unless every level below it is in
   * the same message ("levels have to be created sequentially", error 3092).
   * When set, these are sent instead of the single occupancy/price above, in
   * ascending order and with no gaps.
   */
  levels?: Array<{ occupancy: number; price: number }>;
}

function esc(v: string | number): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The API key EQC authenticates with — a dedicated EQC key wins when present. */
export function eqcApiKey(creds: PrevioCredentials): string {
  const dedicated = (creds as { eqcApiKey?: string }).eqcApiKey;
  if (dedicated) return dedicated;
  if (creds.protocol === "xml") return creds.apiKey;
  return creds.apiKey || creds.password || "";
}

/** Ascending, gap-free occupancy levels for one room type / date. */
export function normalizeLevels(t: RateWriteTarget): Array<{ occupancy: number; price: number }> {
  const raw = (t.levels && t.levels.length > 0)
    ? t.levels
    : [{ occupancy: Math.max(1, Math.round(t.occupancy || 2)), price: Number(t.price) }];

  const byOcc = new Map<number, number>();
  for (const l of raw) {
    const occ = Math.max(1, Math.round(Number(l.occupancy) || 1));
    const price = Number(l.price);
    if (!Number.isFinite(price)) continue;
    byOcc.set(occ, price);
  }
  const max = Math.max(...byOcc.keys());
  const out: Array<{ occupancy: number; price: number }> = [];
  let lastKnown: number | null = null;
  for (let occ = 1; occ <= max; occ++) {
    const price = byOcc.get(occ) ?? lastKnown;
    if (price === null || price === undefined) continue; // no price for level 1 yet — skip until one is known
    lastKnown = price;
    out.push({ occupancy: occ, price });
  }
  return out.length > 0 ? out : [{ occupancy: max, price: byOcc.get(max)! }];
}

export function buildAvailRateUpdateXml(hotelId: string, t: RateWriteTarget): string {
  const levels = normalizeLevels(t);
  const perOccupancy = levels
    .map((l) => `        <PerOccupancy rate="${esc(Number(l.price).toFixed(2))}" occupancy="${esc(l.occupancy)}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<AvailRateUpdateRQ xmlns="${EQC_AR_NS}">
  <Hotel id="${esc(hotelId)}" />
  <DateRange from="${esc(t.from)}" to="${esc(t.to)}" />
  <RoomType id="${esc(t.obkId)}">
    <RatePlan id="${esc(t.prlId)}">
      <Rate currency="${esc(t.currency || "EUR")}">
${perOccupancy}
      </Rate>
    </RatePlan>
  </RoomType>
</AvailRateUpdateRQ>`;
}


export interface RateWriteAttempt {
  method: string;
  ok: boolean;
  status: number;
  /** Previo's own message, or the first part of the raw body. */
  message: string;
}

export interface RateWriteResult {
  ok: boolean;
  /** The transport Previo accepted, when it did. */
  method: string | null;
  attempts: RateWriteAttempt[];
}

/** Write one nightly price through Previo EQC. */
export async function writePrevioRate(opts: {
  creds: PrevioCredentials;
  pmsHotelId: string;
  target: RateWriteTarget;
  /** Ignored — kept so existing callers compile. */
  preferredMethod?: string | null;
  onlyPreferred?: boolean;
}): Promise<RateWriteResult> {
  const key = eqcApiKey(opts.creds);
  if (!key) {
    return {
      ok: false,
      method: null,
      attempts: [{
        method: RATE_WRITE_METHOD,
        ok: false,
        status: 0,
        message:
          "No Previo API key available for EQC. Save the property's EQC api key on its Previo credentials secret (field \"eqcApiKey\").",
      }],
    };
  }

  const body = buildAvailRateUpdateXml(String(opts.pmsHotelId ?? ""), opts.target);
  let status = 0;
  let text = "";
  try {
    const resp = await fetch(EQC_AR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Authorization": `ApiKey ${key}`,
      },
      body,
      signal: AbortSignal.timeout(PREVIO_WRITE_TIMEOUT_MS),
    });
    status = resp.status;
    text = await resp.text();
  } catch (e) {
    return {
      ok: false,
      method: null,
      attempts: [{
        method: RATE_WRITE_METHOD,
        ok: false,
        status: 0,
        message: e instanceof Error ? e.message : String(e),
      }],
    };
  }

  const err = text.match(/<Error[^>]*code="([^"]*)"[^>]*>([^<]*)<\/Error>/i);
  const success = /<Success\s*\/?>/i.test(text);
  const ok = status >= 200 && status < 300 && !err && success;
  const message = err
    ? `${err[1]}: ${err[2].trim()}`
    : ok
      ? "Success"
      : text.replace(/\s+/g, " ").trim().slice(0, 300);

  return {
    ok,
    method: ok ? RATE_WRITE_METHOD : null,
    attempts: [{ method: RATE_WRITE_METHOD, ok, status, message }],
  };
}

/** Read back one price so a push can be confirmed against Previo itself. */
export async function readPrevioRate(opts: {
  creds: PrevioCredentials;
  pmsHotelId: string;
  from: string;
  to: string;
  obkId: string;
  occupancy: number;
  prlId?: string | null;
}): Promise<number | null> {
  const res = await callPrevioXml({
    method: "getRates",
    creds: opts.creds,
    pmsHotelId: opts.pmsHotelId,
    extraXml: `<term><from>${esc(opts.from)}</from><to>${esc(opts.to)}</to></term>`,
  });
  if (!res.ok) return null;

  // Narrow the response down to the object kind we asked about, then read the
  // price for the requested occupancy.
  const kindBlocks = res.text.split(/<objectKind>/i).slice(1);
  for (const raw of kindBlocks) {
    const block = raw.split(/<\/objectKind>/i)[0] ?? "";
    const obk = block.match(/<obkId>([^<]*)<\/obkId>/i)?.[1]?.trim();
    if (obk !== opts.obkId) continue;
    for (const rateRaw of block.split(/<rate>/i).slice(1)) {
      const rate = rateRaw.split(/<\/rate>/i)[0] ?? "";
      const occ = parseInt(rate.match(/<occupancy>([^<]*)<\/occupancy>/i)?.[1] ?? "", 10);
      if (occ !== opts.occupancy) continue;
      const price = parseFloat(
        rate.match(/<amount>([^<]*)<\/amount>/i)?.[1]
          ?? rate.match(/<price>\s*([\d.,]+)\s*<\/price>/i)?.[1]
          ?? "",
      );
      if (Number.isFinite(price)) return price;
    }
  }
  return null;
}

/** Pull `occupancy -> price` pairs out of one XML fragment, tolerating the
 *  element form (`<occupancy>2</occupancy><amount>150</amount>`) and the
 *  attribute form (`<rate occupancy="2" amount="150"/>`). */
function parseRateLevels(fragment: string, into: Map<number, number>) {
  for (const rateRaw of fragment.split(/<rate\b/i).slice(1)) {
    const rate = rateRaw.split(/<\/rate>/i)[0] ?? rateRaw.slice(0, 400);
    const occ = parseInt(
      rate.match(/<occupancy>([^<]*)<\/occupancy>/i)?.[1]
        ?? rate.match(/\boccupancy\s*=\s*"([^"]*)"/i)?.[1]
        ?? "",
      10,
    );
    if (!Number.isFinite(occ)) continue;
    const rawPrice = rate.match(/<amount>([^<]*)<\/amount>/i)?.[1]
      ?? rate.match(/<price>\s*([\d.,]+)\s*<\/price>/i)?.[1]
      ?? rate.match(/\b(?:amount|price|rate)\s*=\s*"([\d.,]+)"/i)?.[1]
      ?? "";
    const price = parseFloat(String(rawPrice).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(price)) into.set(occ, price);
  }
}

/**
 * All published occupancy levels for one room type on one date.
 * Used to fill the levels the user did not edit so a push never "skips a
 * level" (Previo error 3092), and to confirm a push landed.
 *
 * Previo's getRates answer is not always shaped the same way, so this reads
 * the object-kind block when it can find one and falls back to the whole
 * document, and retries once before giving up.
 */
export async function readPrevioRateLevels(opts: {
  creds: PrevioCredentials;
  pmsHotelId: string;
  date: string;
  obkId: string;
  prlId?: string | null;
}): Promise<Map<number, number>> {
  const attempt = async (): Promise<Map<number, number>> => {
    const out = new Map<number, number>();
    const res = await callPrevioXml({
      method: "getRates",
      creds: opts.creds,
      pmsHotelId: opts.pmsHotelId,
      extraXml:
        `<term><from>${esc(opts.date)}</from><to>${esc(opts.date)}</to></term>` +
        (opts.prlId ? `<prlId>${esc(opts.prlId)}</prlId>` : ""),
    });
    if (!res.ok) return out;

    const kindBlocks = res.text.split(/<objectKind>/i).slice(1);
    let matchedKind = false;
    for (const raw of kindBlocks) {
      const block = raw.split(/<\/objectKind>/i)[0] ?? "";
      const obk = block.match(/<obkId>([^<]*)<\/obkId>/i)?.[1]?.trim()
        ?? block.match(/\bobkId\s*=\s*"([^"]*)"/i)?.[1]?.trim();
      if (obk !== opts.obkId) continue;
      matchedKind = true;
      parseRateLevels(block, out);
    }
    // Some answers do not wrap rates in <objectKind> at all — if the room type
    // id appears anywhere in the document, read the rates from the whole body.
    if (!matchedKind && res.text.includes(opts.obkId)) parseRateLevels(res.text, out);
    return out;
  };

  const first = await attempt();
  if (first.size > 0) return first;
  return await attempt();
}


// ---------------------------------------------------------------------------
// Restrictions (minimum stay)
//
// Same EQC AvailRateUpdate channel as prices — <Restrictions minLOS> on the
// rate plan inside the message shape the price writer already uses. Inventory
// ("rooms to sell") is NOT accepted by Previo's EQC copy; see below.
// ---------------------------------------------------------------------------

export interface RestrictionWriteTarget {
  /** Previo room type id. */
  obkId: string;
  /** Previo rate plan (pricelist) id — required for a stay restriction. */
  prlId?: string | null;
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  /** Minimum nights, 1 = no restriction. Omit to leave the stay rule alone. */
  minStay?: number | null;
  /** Not supported by Previo — kept so callers compile; always rejected. */
  roomsToSell?: number | null;

}

/**
 * Previo's EQC copy accepts `<Restrictions minLOS>` only. Verified against the
 * live account: any `<Inventory>` element, and a `closed` attribute on either
 * RoomType or RatePlan, is refused with error 3010 ("validation against schema
 * failed"). Rooms to sell therefore stays a Previo-side setting.
 */
export const PREVIO_INVENTORY_UNSUPPORTED =
  "Previo does not accept availability (rooms to sell) over its price channel \u2014 change it in Previo itself.";

export function buildRestrictionUpdateXml(hotelId: string, t: RestrictionWriteTarget): string {
  const minStay = Number.isFinite(Number(t.minStay)) && t.minStay !== null && t.minStay !== undefined
    ? Math.max(1, Math.round(Number(t.minStay)))
    : null;
  const ratePlan = minStay !== null && t.prlId
    ? `    <RatePlan id="${esc(t.prlId)}">\n` +
      `      <Restrictions minLOS="${esc(minStay)}" />\n` +
      `    </RatePlan>\n`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<AvailRateUpdateRQ xmlns="${EQC_AR_NS}">
  <Hotel id="${esc(hotelId)}" />
  <DateRange from="${esc(t.from)}" to="${esc(t.to)}" />
  <RoomType id="${esc(t.obkId)}">
${ratePlan}  </RoomType>
</AvailRateUpdateRQ>`;
}

/** Send a minimum-stay change to Previo. Inventory is not supported there. */
export async function writePrevioRestrictions(opts: {
  creds: PrevioCredentials;
  pmsHotelId: string;
  target: RestrictionWriteTarget;
}): Promise<RateWriteResult> {
  const key = eqcApiKey(opts.creds);
  if (!key) {
    return {
      ok: false,
      method: null,
      attempts: [{
        method: RATE_WRITE_METHOD,
        ok: false,
        status: 0,
        message: "No Previo API key available for EQC.",
      }],
    };
  }

  if (opts.target.roomsToSell !== null && opts.target.roomsToSell !== undefined && (opts.target.minStay === null || opts.target.minStay === undefined)) {
    return {
      ok: false,
      method: null,
      attempts: [{ method: RATE_WRITE_METHOD, ok: false, status: 0, message: PREVIO_INVENTORY_UNSUPPORTED }],
    };
  }

  const body = buildRestrictionUpdateXml(String(opts.pmsHotelId ?? ""), opts.target);
  let status = 0;
  let text = "";
  try {
    const resp = await fetch(EQC_AR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Authorization": `ApiKey ${key}`,
      },
      body,
      signal: AbortSignal.timeout(PREVIO_WRITE_TIMEOUT_MS),
    });
    status = resp.status;
    text = await resp.text();
  } catch (e) {
    return {
      ok: false,
      method: null,
      attempts: [{ method: RATE_WRITE_METHOD, ok: false, status: 0, message: e instanceof Error ? e.message : String(e) }],
    };
  }

  const err = text.match(/<Error[^>]*code="([^"]*)"[^>]*>([^<]*)<\/Error>/i);
  const success = /<Success\s*\/?>/i.test(text);
  const ok = status >= 200 && status < 300 && !err && success;
  const message = err ? `${err[1]}: ${err[2].trim()}` : ok ? "Success" : text.replace(/\s+/g, " ").trim().slice(0, 300);
  return { ok, method: ok ? RATE_WRITE_METHOD : null, attempts: [{ method: RATE_WRITE_METHOD, ok, status, message }] };
}
