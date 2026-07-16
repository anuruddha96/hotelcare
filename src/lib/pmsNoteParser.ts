/**
 * Parses raw Previo/PMS "notes" strings (HTML-encoded, mixed labels like
 * "Systém - Partner … Total price … Note …") into a compact, manager-friendly
 * structure showing only:
 *   - bed arrangement (inferred)
 *   - guest special requests
 *   - meals included
 *   - smoking preference
 *   - guest / cot / extra bed capacity hints
 *
 * All finance/policy noise (VCC, commission, cancellation policy, payment,
 * reservation codes, prices, timestamps, Booking.com partner metadata) is
 * intentionally dropped from the manager view.
 *
 * The original raw string is preserved on the result under `raw` so callers
 * can still offer a "show original" fallback.
 */

import { inferBedConfigFromNote } from "./bedConfigInference";

export interface StructuredPmsNote {
  bedArrangement: string | null;
  specialRequests: string[];
  meals: "Breakfast" | "Half board" | "Full board" | null;
  smoking: "Non-smoking" | "Smoking" | null;
  extras: {
    guestsMax?: number;
    babyCotMax?: number;
    extraBeds?: number;
  };
  hasStructuredContent: boolean;
  raw: string;
}

const EMPTY = (raw: string): StructuredPmsNote => ({
  bedArrangement: null,
  specialRequests: [],
  meals: null,
  smoking: null,
  extras: {},
  hasStructuredContent: false,
  raw,
});

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;039;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripHtml(input: string): string {
  // Insert spaces at tag boundaries so adjacent words don't glue together.
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Pull the "Note" section that contains Booking.com "Special requests…" text.
 * Previo emits it as: "Note Special requestssmoking preference Non-Smoking
 * Commission note This is the total commission …"
 */
function extractSpecialRequests(text: string): string[] {
  const idx = text.search(/Special requests?/i);
  if (idx < 0) return [];
  // Slice out from the "Special requests" marker up to the next known
  // finance/policy section boundary.
  const tail = text.slice(idx);
  const stopMatch = tail.search(
    /(Commission note|Payment description|Payout type|Comment |Deposit Policy|Cancellation Policy|Children and Extra Bed Policy|You have received|Payment -|Needs to be charged|Note Breakfast is included)/i,
  );
  const segment = (stopMatch > 0 ? tail.slice(0, stopMatch) : tail)
    .replace(/^Special requests?:?\s*/i, "")
    .trim();

  const requests: string[] = [];

  // Smoking preference is a very common Booking.com "special request" — split it
  // out so we can render it as its own tag rather than a bullet.
  const withoutSmoking = segment
    .replace(/smoking preference\s*(non[-\s]?smoking|smoking)/i, "")
    .trim();

  // Common bed / arrival / floor phrases people actually care about.
  const patterns: Array<{ re: RegExp; label: (m: RegExpMatchArray) => string }> = [
    { re: /late arrival[^.]*/i, label: (m) => m[0].trim() },
    { re: /early (check[-\s]?in|arrival)[^.]*/i, label: (m) => m[0].trim() },
    { re: /high[-\s]?floor[^.]*/i, label: () => "High floor requested" },
    { re: /low[-\s]?floor[^.]*/i, label: () => "Low floor requested" },
    { re: /quiet room[^.]*/i, label: () => "Quiet room requested" },
    { re: /twin beds?[^.]*/i, label: (m) => m[0].trim() },
    { re: /double bed[^.]*/i, label: (m) => m[0].trim() },
    { re: /extra (bed|cot)[^.]*/i, label: (m) => m[0].trim() },
    { re: /baby (cot|bed)|crib[^.]*/i, label: (m) => m[0].trim() },
    { re: /allerg[^.]*/i, label: (m) => m[0].trim() },
    { re: /pet[s]?[^.]*/i, label: (m) => m[0].trim() },
  ];

  for (const p of patterns) {
    const m = withoutSmoking.match(p.re);
    if (m) {
      const label = p.label(m);
      if (label && !requests.includes(label)) requests.push(label);
    }
  }

  return requests;
}

function extractSmoking(text: string): StructuredPmsNote["smoking"] {
  const m = text.match(/smoking preference\s*(non[-\s]?smoking|smoking)/i);
  if (!m) return null;
  return /non/i.test(m[1]) ? "Non-smoking" : "Smoking";
}

function extractMeals(text: string): StructuredPmsNote["meals"] {
  // "Meals breakfast" from Previo labelled block, or "Breakfast is included…"
  if (/meals?\s*[:\-]?\s*breakfast/i.test(text) || /breakfast is included/i.test(text) || /breakfast included/i.test(text)) {
    return "Breakfast";
  }
  if (/half\s*board/i.test(text)) return "Half board";
  if (/full\s*board|all\s*inclusive/i.test(text)) return "Full board";
  return null;
}

function extractExtras(text: string): StructuredPmsNote["extras"] {
  const extras: StructuredPmsNote["extras"] = {};
  const guests = text.match(/maximum number of guests is\s*(\d+)/i);
  if (guests) extras.guestsMax = parseInt(guests[1], 10);
  const cots = text.match(/maximum number of cots is\s*(\d+)/i);
  if (cots) extras.babyCotMax = parseInt(cots[1], 10);
  const extraBeds = text.match(/(\d+)\s*extra beds?/i);
  if (extraBeds) extras.extraBeds = parseInt(extraBeds[1], 10);
  return extras;
}

/**
 * True when the raw note looks like PMS/Previo output (contains HTML entities,
 * the "Systém"/"Recepce" markers, or Booking.com-style key labels). Plain
 * manager-typed notes fall through to `false` so the raw text is shown as-is.
 */
export function looksLikePmsNote(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return (
    /&lt;|&gt;|<span|<br|Systém|Recepce|Partner's room name|Booking\.com|Special requests|Virtual [Cc]redit [Cc]ard|Commission note|Cancellation Policy/i.test(
      raw,
    )
  );
}

export function parsePmsNote(raw: string | null | undefined): StructuredPmsNote {
  if (!raw || !raw.trim()) return EMPTY(raw ?? "");
  const decoded = decodeEntities(String(raw));
  const text = stripHtml(decoded);

  const specialRequests = extractSpecialRequests(text);
  const smoking = extractSmoking(text);
  const meals = extractMeals(text);
  const extras = extractExtras(text);

  // Try to infer bed arrangement from special-request bullets first, then
  // from the partner's room name (e.g. "Deluxe Double or Twin Room …"), then
  // from the whole text as a last resort.
  const partnerNameMatch = text.match(/Partner'?s room name\s+([^]+?)(?:\s+Note\s|\s+Comment\s|\s+Payment\s|$)/i);
  const bedSources = [
    specialRequests.join(" "),
    partnerNameMatch?.[1] ?? "",
  ];
  let bedArrangement: string | null = null;
  for (const source of bedSources) {
    if (!source) continue;
    const inferred = inferBedConfigFromNote(source);
    if (inferred) {
      bedArrangement = inferred.value;
      break;
    }
  }
  // Ignore the ambiguous "Double or Twin" partner room name — that's a
  // Booking.com category label, not a guest preference.
  if (bedArrangement && /double or twin/i.test(partnerNameMatch?.[1] ?? "")) {
    // Only keep it if the special-requests text confirmed it.
    const confirmed = inferBedConfigFromNote(specialRequests.join(" "));
    if (!confirmed) bedArrangement = null;
  }

  const hasStructuredContent =
    !!bedArrangement ||
    specialRequests.length > 0 ||
    !!smoking ||
    !!meals ||
    Object.keys(extras).length > 0;

  return {
    bedArrangement,
    specialRequests,
    meals,
    smoking,
    extras,
    hasStructuredContent,
    raw: String(raw),
  };
}

/**
 * Short single-line summary suitable for a chip tooltip (`title` attribute).
 */
export function summarizePmsNote(raw: string | null | undefined): string {
  const parsed = parsePmsNote(raw);
  if (!parsed.hasStructuredContent) return (raw ?? "").trim();
  const parts: string[] = [];
  if (parsed.bedArrangement) parts.push(`Bed: ${parsed.bedArrangement}`);
  if (parsed.specialRequests.length) parts.push(`Requests: ${parsed.specialRequests.join("; ")}`);
  if (parsed.meals) parts.push(parsed.meals);
  if (parsed.smoking) parts.push(parsed.smoking);
  if (parsed.extras.guestsMax) parts.push(`Max guests: ${parsed.extras.guestsMax}`);
  if (parsed.extras.babyCotMax) parts.push(`Max cots: ${parsed.extras.babyCotMax}`);
  return parts.join(" · ");
}
