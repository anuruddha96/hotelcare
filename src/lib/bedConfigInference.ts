// Infers a canonical bed configuration from a PMS note.
// Values match the manager-visible dropdown in the Room Settings popover:
//   Double Bed, Twin Beds, Twin Beds Separated, Single Bed, Baby Bed, Extra Cot Added
//
// Returns null when no keyword matches. Never overwrite a manager-set value
// with the result — callers should only fill in when the current bed
// configuration is empty.
//
// IMPORTANT: The matcher is deliberately conservative. Booking.com / Previo
// notes carry a lot of *policy* text that mentions bed vocabulary without
// being a guest request, e.g.:
//   - "You haven't added any extra beds."
//   - "The maximum number of cots is 1."
//   - "Children and Extra Bed Policy: children of any age are allowed."
//   - "Deluxe Double or Twin Room" (partner room-name category)
// We must NOT treat those as guest preferences. So we (a) match on word
// boundaries, and (b) reject any keyword hit whose surrounding context looks
// like a negation or a policy/capacity phrase.

export type InferredBedConfig = {
  value:
    | "Double Bed"
    | "Twin Beds"
    | "Twin Beds Separated"
    | "Single Bed"
    | "Baby Bed"
    | "Extra Cot Added";
  matchedKeyword: string;
};

// Order matters: check more specific phrases first (e.g. "twin beds separated"
// before "twin beds"; "extra cot" before "cot").
const RULES: Array<{ value: InferredBedConfig["value"]; keywords: string[] }> = [
  {
    value: "Twin Beds Separated",
    keywords: [
      "twin beds separated",
      "two separate beds",
      "beds separated",
      "separate beds",
      "separated beds",
      "külön ágy",
      "kulon agy",
      "letti separati",
      "camas separadas",
    ],
  },
  {
    value: "Extra Cot Added",
    keywords: [
      "extra cot",
      "extra bed",
      "rollaway",
      "pótágy",
      "potagy",
      "cama extra",
      "letto extra",
    ],
  },
  {
    value: "Baby Bed",
    keywords: [
      "baby bed",
      "baby cot",
      "crib",
      "kiságy",
      "kisagy",
      "cuna",
      "culla",
    ],
  },
  {
    value: "Twin Beds",
    keywords: [
      "twin beds",
      "twin bed",
      "two singles",
      "2 singles",
      "single beds", // plural implies two
      "ikerágy",
      "ikeragy",
      "letti singoli",
      "camas individuales",
    ],
  },
  {
    value: "Single Bed",
    keywords: ["single bed", "one single", "1 single"],
  },
  {
    value: "Double Bed",
    keywords: [
      "double bed",
      "matrimoniale",
      "franciaágy",
      "franciaagy",
      "queen bed",
      "king bed",
      "beds together",
      "put beds together",
      "queen",
      "king",
      "cama doble",
      "cama matrimonial",
    ],
  },
];

// Words that, when they appear immediately before a matched keyword, mean the
// guest is NOT requesting it.
const NEGATION_PATTERNS = [
  /\bno\b/i,
  /\bnot\b/i,
  /\bwithout\b/i,
  /\bhaven'?t\b/i,
  /\bhasn'?t\b/i,
  /\bdon'?t\b/i,
  /\bdoesn'?t\b/i,
  /\bnever\b/i,
  /\bzero\b/i,
  /\b0\b/,
  /\bany\b/i, // "any extra beds" appears in "haven't added any extra beds"
];

// Phrases anywhere in the surrounding context that mark the sentence as
// policy / capacity boilerplate rather than a guest request.
const POLICY_CONTEXT_PATTERNS = [
  /maximum number of/i,
  /extra bed policy/i,
  /children and extra bed/i,
  /cancellation policy/i,
  /commission/i,
  /virtual credit card/i,
  /payment description/i,
  /you haven'?t/i,
  /payout type/i,
];

// Escape a literal keyword for use inside a RegExp source.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary check that also handles keywords whose edges are non-ASCII
// letters (Hungarian, Italian, Spanish accents). JS's \b doesn't consider
// accented letters as word chars, so we approximate: the keyword must be
// preceded/followed by either start/end, whitespace, or punctuation.
function keywordMatch(haystack: string, keyword: string): { index: number; length: number } | null {
  const escaped = escapeRegex(keyword);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "iu");
  const m = re.exec(haystack);
  if (!m) return null;
  // Index of the actual keyword (skip the leading boundary char if any).
  const boundaryLen = m[1] ? m[1].length : 0;
  return { index: m.index + boundaryLen, length: m[2].length };
}

function isFalsePositive(haystack: string, index: number, length: number): boolean {
  // Look at ~40 chars before the match for negation words, and the full
  // sentence around it for policy context.
  const preStart = Math.max(0, index - 40);
  const pre = haystack.slice(preStart, index);
  if (NEGATION_PATTERNS.some((p) => p.test(pre))) return true;

  // Sentence window: split on `.`, `;`, `!`, `?`, or line breaks around the
  // match so we don't drag context in from unrelated sentences.
  const sentenceStart = Math.max(
    haystack.lastIndexOf(".", index),
    haystack.lastIndexOf(";", index),
    haystack.lastIndexOf("!", index),
    haystack.lastIndexOf("?", index),
    haystack.lastIndexOf("\n", index),
  );
  const afterIdx = index + length;
  const nextStops = [".", ";", "!", "?", "\n"]
    .map((ch) => {
      const i = haystack.indexOf(ch, afterIdx);
      return i === -1 ? haystack.length : i;
    });
  const sentenceEnd = Math.min(...nextStops);
  const sentence = haystack.slice(sentenceStart + 1, sentenceEnd);
  if (POLICY_CONTEXT_PATTERNS.some((p) => p.test(sentence))) return true;

  return false;
}

export function inferBedConfigFromNote(
  note: string | null | undefined,
): InferredBedConfig | null {
  if (!note) return null;
  const haystack = String(note);
  if (!haystack.trim()) return null;
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const hit = keywordMatch(haystack, kw);
      if (!hit) continue;
      if (isFalsePositive(haystack, hit.index, hit.length)) continue;
      return { value: rule.value, matchedKeyword: kw };
    }
  }
  return null;
}
