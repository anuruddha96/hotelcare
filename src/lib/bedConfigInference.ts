// Infers a canonical bed configuration from a PMS note.
// Values match the manager-visible dropdown in the Room Settings popover:
//   Double Bed, Twin Beds, Twin Beds Separated, Single Bed, Baby Bed, Extra Cot Added
//
// Returns null when no keyword matches. Never overwrite a manager-set value
// with the result — callers should only fill in when the current bed
// configuration is empty.

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
      "queen",
      "king",
      "cama doble",
      "cama matrimonial",
    ],
  },
];

export function inferBedConfigFromNote(
  note: string | null | undefined,
): InferredBedConfig | null {
  if (!note) return null;
  const haystack = String(note).toLowerCase();
  if (!haystack.trim()) return null;
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw)) {
        return { value: rule.value, matchedKeyword: kw };
      }
    }
  }
  return null;
}
