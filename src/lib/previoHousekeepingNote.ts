// Previo can concatenate several department tabs into one reservation note,
// for example `Systém - ... Recepce - ... Housekeeping - ...`.
// HotelCare's housekeeping surfaces must show only the housekeeping/cleaning
// section. Reception, kitchen, OTA/payment and policy text are deliberately
// excluded.

const RESERVATION_NOTE_BLOB = /Booking\.com|Partner'?s room name|Commission note|Virtual [Cc]redit [Cc]ard|Cancellation Policy|Payment description|Payout type|Total price|Deposit Policy|Syst[ée]m\s*[-:]/i;
const PAYMENT_NOISE_RE = /\b(VCC\b[^.\n]*|Collect payment from guests[^.\n]*|Payment[^.\n]*|Virtual [Cc]redit [Cc]ard[^.\n]*)/gi;

const SECTION_LABEL_SOURCE = String.raw`Syst[ée]m|Recepce|Reception|Front\s*Desk|Kuchyn[ěe]|Kitchen|Housekeeping|Cleaning|Úklid|Uklid|H[aá]zvezet[ée]s|Takar[ií]t[aá]s|Pozn[aá]mka`;
const HOUSEKEEPING_LABEL_RE = /^(Housekeeping|Cleaning|Úklid|Uklid|H[aá]zvezet[ée]s|Takar[ií]t[aá]s)$/i;
const SYSTEM_LABEL_RE = /^Syst[ée]m$/i;

interface NoteSection {
  label: string;
  body: string;
}

const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;039;|&#039;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&");

const cleanText = (raw: unknown): string => {
  if (raw == null) return "";
  return decodeHtmlEntities(String(raw))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const cleanSectionBody = (body: string): string =>
  body
    .replace(PAYMENT_NOISE_RE, " ")
    .replace(/^[\s•·|]+|[\s•·|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseSections = (raw: unknown): { text: string; sections: NoteSection[] } => {
  const text = cleanText(raw);
  if (!text) return { text: "", sections: [] };

  // A fresh RegExp is required because matchAll needs the global flag and a
  // reused global regex carries lastIndex state between calls.
  const re = new RegExp(`(${SECTION_LABEL_SOURCE})\\s*[-:]\\s*`, "giu");
  const matches = Array.from(text.matchAll(re));
  const sections: NoteSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const label = String(match[1] || "").trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = cleanSectionBody(text.slice(start, end));
    if (body) sections.push({ label, body });
  }
  return { text, sections };
};

const normalizeForCompare = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Extract the note intended for the cleaning/housekeeping department.
 *
 * - If Previo supplies labelled department sections, only a housekeeping /
 *   cleaning label is accepted.
 * - A plain unlabelled note is accepted only when it is not an OTA/payment
 *   reservation blob. This keeps compatibility with tenants that expose a
 *   dedicated housekeeping note field without a label.
 */
export const extractHousekeepingSectionsFromRawNote = (
  raw: string | null | undefined,
): string | null => {
  const { text, sections } = parseSections(raw);
  if (!text) return null;

  if (sections.length === 0) {
    return RESERVATION_NOTE_BLOB.test(text) ? null : text;
  }

  const housekeeping = sections
    .filter(({ label }) => HOUSEKEEPING_LABEL_RE.test(label))
    .map(({ body }) => cleanSectionBody(body))
    .filter(Boolean);

  return housekeeping.length ? housekeeping.join(" • ") : null;
};

/**
 * Pick the one note HotelCare may write to rooms.notes for housekeeping.
 *
 * The raw concatenated Note is checked first because it preserves the actual
 * department label. `NoteInternal` is only a fallback: some Previo tenants use
 * that field for reception notes. When it matches a labelled non-housekeeping
 * section from the raw note, it is rejected rather than leaked to housekeepers.
 */
export const pickPrevioHousekeepingNote = (row: any): string | null => {
  const raw = row?.Note ?? row?.NoteOta ?? null;
  const parsedRaw = parseSections(raw);
  const fromRaw = extractHousekeepingSectionsFromRawNote(raw);
  if (fromRaw) return fromRaw;

  const internalText = cleanText(row?.NoteInternal ?? null);
  if (!internalText || RESERVATION_NOTE_BLOB.test(internalText)) return null;

  // An explicitly labelled housekeeping NoteInternal is safe even when the raw
  // reservation note also contains other department sections.
  const internalSections = parseSections(internalText).sections;
  const labelledInternalHousekeeping = internalSections.some(({ label }) =>
    HOUSEKEEPING_LABEL_RE.test(label),
  );
  if (labelledInternalHousekeeping) {
    return extractHousekeepingSectionsFromRawNote(internalText);
  }

  // Do not surface text that is demonstrably the Reception/Kitchen/etc. tab.
  // This is the regression that caused values such as a reception payment note
  // to replace the actual cleaning instruction.
  const normalizedInternal = normalizeForCompare(internalText);
  const matchesNonHousekeepingSection = parsedRaw.sections.some(({ label, body }) => {
    if (HOUSEKEEPING_LABEL_RE.test(label) || SYSTEM_LABEL_RE.test(label)) return false;
    return normalizeForCompare(body) === normalizedInternal;
  });
  if (matchesNonHousekeepingSection) return null;

  // If the raw note is department-labelled but contains no housekeeping tab,
  // an unlabelled internal value is ambiguous. Prefer showing no note over
  // leaking a reception/kitchen note to housekeepers.
  if (parsedRaw.sections.length > 0) return null;

  // Tenants with a truly dedicated, unlabelled internal housekeeping field.
  return internalText;
};
