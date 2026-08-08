// Writing nightly prices back to Previo.
//
// Previo splits its API: the XML API is the read/reservation API (that is what
// `getRates` lives in) while rates and availability are documented as the EQC
// channel. Which write scope an account actually has is a per-property
// entitlement, so this module keeps a short, ordered list of candidate write
// calls, tries them in order, and reports the verbatim Previo answer. Once a
// hotel is known to accept one of them, the method name is stored on
// `hotel_revenue_settings.rate_write_method` and used directly from then on.

import { callPrevioXml, type PrevioCredentials } from "./previoCredentials.ts";

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
}

/** Ordered candidates. The first that Previo accepts wins and gets stored. */
export const RATE_WRITE_METHODS = [
  "setRates",
  "setRate",
  "setPrices",
  "setPrice",
  "updateRates",
] as const;

export type RateWriteMethod = string;

function esc(v: string | number): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Body shaped like the `getRates` response: rate plan -> season -> object kind
 * -> rate(occupancy, price). Previo's write methods mirror the read shape.
 */
export function buildRateWriteXml(t: RateWriteTarget): string {
  return `<ratePlan>
  <prlId>${esc(t.prlId)}</prlId>
  <season>
    <from>${esc(t.from)}</from>
    <to>${esc(t.to)}</to>
    <objectKind>
      <obkId>${esc(t.obkId)}</obkId>
      <rate>
        <occupancy>${esc(t.occupancy)}</occupancy>
        <price>
          <amount>${esc(t.price)}</amount>
          <code>${esc(t.currency || "EUR")}</code>
        </price>
      </rate>
    </objectKind>
  </season>
</ratePlan>`;
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
  /** The method that Previo accepted, when one did. */
  method: string | null;
  attempts: RateWriteAttempt[];
}

function summarise(text: string, errorMessage: string | null): string {
  const msg = (errorMessage ?? "").trim();
  if (msg) return msg;
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Try to write one price. When `preferredMethod` is set it is attempted first
 * and, if it works, nothing else is sent.
 */
export async function writePrevioRate(opts: {
  creds: PrevioCredentials;
  pmsHotelId: string;
  target: RateWriteTarget;
  preferredMethod?: string | null;
  /** Only try the preferred method — used by the push path once verified. */
  onlyPreferred?: boolean;
}): Promise<RateWriteResult> {
  const extraXml = buildRateWriteXml(opts.target);
  const ordered = opts.preferredMethod
    ? (opts.onlyPreferred
      ? [opts.preferredMethod]
      : [opts.preferredMethod, ...RATE_WRITE_METHODS.filter((m) => m !== opts.preferredMethod)])
    : [...RATE_WRITE_METHODS];

  const attempts: RateWriteAttempt[] = [];
  for (const method of ordered) {
    const res = await callPrevioXml({
      method,
      creds: opts.creds,
      pmsHotelId: opts.pmsHotelId,
      extraXml,
    });
    const message = summarise(res.text, res.errorMessage);
    attempts.push({ method, ok: res.ok, status: res.status, message });
    if (res.ok) return { ok: true, method, attempts };

    // An unknown/forbidden method means "try the next candidate"; anything
    // else is a real validation error and must surface as-is.
    const unknownMethod = res.status === 404
      || /unknown method|method not|not supported|not implemented|no permission|not allowed|access denied|forbidden|2004|2005/i
        .test(message);
    if (!unknownMethod) return { ok: false, method: null, attempts };
  }
  return { ok: false, method: null, attempts };
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
