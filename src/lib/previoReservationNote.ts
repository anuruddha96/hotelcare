/**
 * Parses the raw Previo reservation note (the HTML-encoded "Recepce - … Systém -
 * <span class=container-N>Label <span class=value-N>Value</span></span>…" blob
 * that Booking.com / Expedia XML bookings carry) into a structured view for the
 * front desk and managers.
 *
 * Unlike `pmsNoteParser` (housekeeping view, drops all finance), this keeps the
 * booking, payment and policy facts — but groups them so the reservation page
 * can show them as labelled rows instead of a wall of markup.
 */

export interface PrevioReservationNote {
  /** Free text the reception typed in Previo ("Recepce - …"). */
  receptionNote: string | null;
  booking: {
    channel: string | null;
    totalPrice: string | null;
    pricePerRoom: string | null;
    commission: string | null;
    createdAt: string | null;
    meals: string | null;
    roomName: string | null;
    rateName: string | null;
  };
  guest: {
    requests: string[];
    smoking: "Non-smoking" | "Smoking" | null;
  };
  payment: {
    method: string | null;
    collectedBy: "OTA" | "Property" | null;
    chargeableFrom: string | null;
    instructions: string[];
  };
  policies: {
    cancellation: string | null;
    deposit: string | null;
    children: string | null;
    meals: string | null;
    other: string[];
  };
  /**
   * Labelled blocks this parser does not recognise (other channels, new Previo
   * fields). Kept and shown as-is so nothing a guest or OTA wrote is hidden.
   */
  extras: Array<{ label: string; value: string }>;
  /** True when at least one structured field was found. */
  isStructured: boolean;
  /** Plain, readable version of the raw note (tags/entities stripped). */
  plainText: string;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/gi, "&")
    .replace(/&amp;/gi, "&") // double-encoded (&amp;039;)
    .replace(/&#0?39;|&039;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const stripTags = (s: string) =>
  s
    .replace(/<\s*br\s*\/?>|<\/\s*br\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

const clean = (s: string | null | undefined) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim().replace(/^[-:–\s]+/, "").replace(/[\s.]+$/, "");
  return v || null;
};

/** Ensure sentences glued together by Previo ("…EUR)Payment") get a space. */
const unglue = (s: string) => s.replace(/([a-z0-9).])([A-Z][a-z])/g, "$1 $2");

const NOTE_MARKERS: Array<{ key: string; re: RegExp }> = [
  { key: "special", re: /Special requests?/i },
  { key: "smoking", re: /smoking preference/i },
  { key: "commission", re: /Commission note/i },
  { key: "paymentDesc", re: /Payment description/i },
  { key: "children", re: /Children and Extra Bed Policy/i },
  { key: "deposit", re: /Deposit Policy/i },
  { key: "cancellation", re: /Cancellation Policy/i },
];

/** Split a Booking.com "Note" value into its labelled sub-sections. */
function segmentNote(text: string): Array<{ key: string; value: string }> {
  const hits: Array<{ key: string; start: number; end: number }> = [];
  for (const m of NOTE_MARKERS) {
    const re = new RegExp(m.re.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) hits.push({ key: m.key, start: match.index, end: match.index + match[0].length });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Array<{ key: string; value: string }> = [];
  const lead = text.slice(0, hits[0]?.start ?? text.length).trim();
  if (lead) out.push({ key: "lead", value: lead });
  hits.forEach((h, i) => {
    out.push({ key: h.key, value: text.slice(h.end, hits[i + 1]?.start ?? text.length).trim() });
  });
  return out;
}

function formatCreated(v: string): string {
  const m = v.match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}):?(\d{2}):?(\d{2})?/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : v;
}

function sentences(s: string): string[] {
  return unglue(s)
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function looksLikePrevioReservationNote(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /container-\d|value-\d|Systém\s*-|Recepce\s*-|&lt;span|<span/i.test(raw);
}

export function parsePrevioReservationNote(raw: string | null | undefined): PrevioReservationNote {
  const source = decode(String(raw ?? ""));
  const result: PrevioReservationNote = {
    receptionNote: null,
    booking: { channel: null, totalPrice: null, pricePerRoom: null, commission: null, createdAt: null, meals: null, roomName: null, rateName: null },
    guest: { requests: [], smoking: null },
    payment: { method: null, collectedBy: null, chargeableFrom: null, instructions: [] },
    policies: { cancellation: null, deposit: null, children: null, meals: null, other: [] },
    extras: [],
    isStructured: false,
    plainText: stripTags(source),
  };
  if (!source.trim()) return result;

  // Reception note: "Recepce - …" up to "Systém -".
  const recepce = source.match(/Recepce\s*-\s*([\s\S]*?)(?=Syst[ée]m\s*-|$)/i);
  if (recepce) result.receptionNote = clean(stripTags(recepce[1]).replace(/\n+/g, " · "));

  // Labelled blocks. Previo strips the `="…"` from class attributes, so accept
  // both `class="container-1"` and `classcontainer-1`.
  const blockRe = /<span\s*class\s*=?\s*["']?container-\d+["']?\s*>\s*([^<]*?)\s*<span\s*class\s*=?\s*["']?value-\d+["']?\s*>([\s\S]*?)<\/span>\s*<\/span>/gi;
  const blocks: Array<{ label: string; value: string }> = [];
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(source))) {
    blocks.push({ label: bm[1].trim(), value: stripTags(bm[2]).replace(/\n+/g, " ").trim() });
  }

  for (const { label, value } of blocks) {
    const l = label.toLowerCase();
    if (l === "partner") result.booking.channel = clean(value.replace(/\s*XML$/i, ""));
    else if (l === "total price") result.booking.totalPrice = clean(value);
    else if (l === "price per room") result.booking.pricePerRoom = clean(value);
    else if (l === "commission") result.booking.commission = clean(value);
    else if (l === "created") result.booking.createdAt = formatCreated(value);
    else if (l === "meals") result.booking.meals = clean(value.charAt(0).toUpperCase() + value.slice(1));
    else if (l.includes("room name")) {
      const parts = value.split(/\s+-\s+/);
      result.booking.roomName = clean(parts[0]);
      result.booking.rateName = clean(parts.slice(1).join(" – ")) ;
    } else if (l === "payment") {
      const ss = sentences(value);
      if (/\(ota\)/i.test(value)) result.payment.collectedBy = "OTA";
      else if (/\(hotel\)|property/i.test(value)) result.payment.collectedBy = "Property";
      for (const s of ss) {
        const method = s.match(/^Payment\s*-\s*(.+?)\.?$/i);
        if (method) result.payment.method = clean(method[1]);
        else if (/needs to be charged|charge/i.test(s)) result.payment.instructions.push(clean(s)!);
      }
    } else if (l === "comment") {
      const charge = value.match(/charge it as of\s*(\d{4}-\d{2}-\d{2})/i);
      if (charge) result.payment.chargeableFrom = charge[1];
      if (/virtual credit card/i.test(value)) result.payment.method ??= "Virtual credit card";
      const rest = sentences(value).filter((s) => !/virtual credit card|charge it as of/i.test(s));
      result.policies.other.push(...rest);
    } else if (l === "note") {
      for (const seg of segmentNote(unglue(value))) {
        const v = seg.value;
        switch (seg.key) {
          case "special": {
            const req = clean(v);
            if (req) result.guest.requests.push(req);
            break;
          }
          case "smoking": {
            const m = v.match(/^(non[-\s]?smoking|smoking)/i);
            if (m) result.guest.smoking = /non/i.test(m[1]) ? "Non-smoking" : "Smoking";
            const rest = clean(v.slice(m?.[0].length ?? 0));
            if (rest) result.guest.requests.push(rest);
            break;
          }
          case "commission": {
            const amt = v.match(/\(([\d.,]+\s*[A-Z]{3})\)/);
            if (amt) result.booking.commission ??= amt[1];
            break;
          }
          case "paymentDesc": {
            const payout = v.match(/Payout type\s*([^)]+)/i);
            if (payout) result.payment.method ??= clean(payout[1]);
            if (/payment_on_booking|on_booking/i.test(v)) result.payment.collectedBy ??= "OTA";
            break;
          }
          case "children":
            result.policies.children = clean(v);
            break;
          case "deposit":
            result.policies.deposit = clean(v);
            break;
          case "cancellation":
            result.policies.cancellation = clean(v);
            break;
          default: {
            // Lead text, e.g. "Breakfast is included in the room rate. Lunch costs …"
            const ss = sentences(v);
            const meal = ss.filter((s) => /breakfast|lunch|dinner|half board|full board/i.test(s));
            if (meal.length) result.policies.meals = meal.map((s) => s.replace(/\.$/, "")).join(" · ");
            result.policies.other.push(...ss.filter((s) => !meal.includes(s)));
          }
        }
      }
    } else if (value) {
      result.extras.push({ label: clean(label) ?? "—", value });
    }
  }

  // Normalise a few values for display.
  if (result.payment.method && /^virtual credit card$/i.test(result.payment.method)) result.payment.method = "Virtual credit card";
  if (result.booking.meals && /^breakfast$/i.test(result.booking.meals)) result.booking.meals = "Breakfast included";
  result.payment.instructions = [...new Set(result.payment.instructions)];
  result.policies.other = [...new Set(result.policies.other.map((s) => s.trim()).filter(Boolean))];

  const b = result.booking;
  result.isStructured =
    blocks.length > 0 &&
    !!(b.channel || b.totalPrice || b.roomName || result.guest.smoking || result.guest.requests.length || result.policies.cancellation || result.payment.method || result.extras.length);

  return result;
}

/**
 * One-line version of a reservation note for tight spaces (check-in dialog):
 * what reception typed, what the guest asked for, smoking preference and a
 * virtual-card reminder. Booking/commission/policy boilerplate is left out.
 * Plain notes come back unchanged; a Previo note with nothing actionable -> null.
 */
export function summarizeReservationNote(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (!looksLikePrevioReservationNote(text)) return text;
  const note = parsePrevioReservationNote(text);
  if (!note.isStructured) return note.plainText || null;
  const parts: string[] = [];
  if (note.receptionNote) parts.push(note.receptionNote);
  parts.push(...note.guest.requests);
  if (note.guest.smoking) parts.push(note.guest.smoking);
  if (note.payment.method && /virtual/i.test(note.payment.method)) {
    parts.push(note.payment.chargeableFrom
      ? `${note.payment.method} (chargeable from ${note.payment.chargeableFrom})`
      : note.payment.method);
  }
  parts.push(...note.extras.map((e) => `${e.label}: ${e.value}`));
  return parts.length ? [...new Set(parts)].join(" · ") : null;
}
